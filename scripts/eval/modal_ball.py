#!/usr/bin/env python3
"""Modal GPU jobs for ball GT expansion and TrackNetV4 training."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from _common import COURT_LENGTH_M, DOUBLES_WIDTH_M, SINGLES_WIDTH_M

BASE = Path(__file__).resolve().parent.parent.parent

try:
    import modal  # noqa: F401
except ImportError:
    print(
        "ERROR: 'modal' is not installed in this Python environment.\n"
        "Use .venv-modal/bin/modal or .venv-modal/bin/python for this script.",
        file=sys.stderr,
    )
    sys.exit(1)

import modal

VOLUME_NAME = "tennis-ball-v0"
APP_NAME = "tennis-ball"
REMOTE_BASE = Path("/data")
REMOTE_DATASET = REMOTE_BASE / "eval" / "datasets" / "fixed-camera-v2"
REMOTE_RESULTS = REMOTE_BASE / "eval" / "results" / "tracknet-v4-modal"
REMOTE_RESULTS_SHOT = REMOTE_BASE / "eval" / "results" / "shot-events"
REMOTE_WEIGHTS = REMOTE_BASE / "weights" / "tracknet_weights.pth"
REMOTE_V4_CHECKPOINT = "eval/results/tracknet-v4-modal/latest.pt"

# Analysis works in a normalized 1280x720 / 30fps frame space (matches the
# shot_events pipeline's SOURCE_WIDTH/HEIGHT and the V4 training resolution).
NORM_WIDTH = 1280
NORM_HEIGHT = 720
NORM_FPS = 30

app = modal.App(APP_NAME)
volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("torch", "torchvision", "opencv-python-headless", "numpy<2", "tqdm", "pillow")
)

# The analyze endpoint also needs YOLO pose (B3 FH/BH). Keep it on a separate
# image so expand/train builds stay lean and cache-stable.
analyze_image = image.pip_install("ultralytics")


def _split_clip_ids(value: str | list[str]) -> list[str]:
    values = value if isinstance(value, list) else [value]
    clip_ids: list[str] = []
    for item in values:
        normalized = item.replace("\n", ",").replace(" ", ",")
        clip_ids.extend(part.strip() for part in normalized.split(",") if part.strip())
    return list(dict.fromkeys(clip_ids))


def _run(cmd: list[str], desc: str) -> None:
    print(f"\n>>> {desc}", flush=True)
    print(" ".join(cmd), flush=True)
    result = subprocess.run(cmd, cwd=str(REMOTE_BASE))
    if result.returncode != 0:
        raise RuntimeError(f"Command failed (exit {result.returncode}): {desc}")


def _gt_counts(clip_id: str) -> dict[str, int]:
    import json

    path = REMOTE_DATASET / "ball-gt" / f"{clip_id}.jsonl"
    counts = {"total": 0, "det": 0, "interp": 0}
    if not path.exists():
        return counts
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            counts["total"] += 1
            source = str(row.get("source", "det"))
            if source == "interp":
                counts["interp"] += 1
            else:
                counts["det"] += 1
    return counts


def _extract_sparse_training_frames(clip_id: str) -> dict[str, int]:
    import json
    import cv2

    gt_path = REMOTE_DATASET / "ball-gt" / f"{clip_id}.jsonl"
    video_path = REMOTE_DATASET / "clips" / f"{clip_id}.mp4"
    frames_dir = REMOTE_DATASET / "frames" / clip_id
    frames_dir.mkdir(parents=True, exist_ok=True)

    if not gt_path.exists():
        raise FileNotFoundError(f"GT not found: {gt_path}")
    if not video_path.exists():
        raise FileNotFoundError(f"Clip video not found: {video_path}")

    needed: set[int] = set()
    with open(gt_path, encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            frame_idx = int(json.loads(line)["frameIdx"])
            needed.update(idx for idx in (frame_idx - 1, frame_idx, frame_idx + 1) if idx >= 0)

    existing = 0
    select_indices: list[int] = []
    for frame_idx in sorted(needed):
        out_path = frames_dir / f"frame_{frame_idx:06d}.jpg"
        if out_path.exists():
            existing += 1
        else:
            select_indices.append(frame_idx)

    if select_indices:
        pending = set(select_indices)
        max_needed = max(pending)
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise RuntimeError(f"Could not open video for sparse frame extraction: {video_path}")
        frame_idx = 0
        try:
            while frame_idx <= max_needed and pending:
                ok, frame = cap.read()
                if not ok or frame is None:
                    break
                if frame_idx in pending:
                    out_path = frames_dir / f"frame_{frame_idx:06d}.jpg"
                    if not cv2.imwrite(str(out_path), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 95]):
                        raise OSError(f"Failed to write frame: {out_path}")
                    pending.remove(frame_idx)
                frame_idx += 1
        finally:
            cap.release()

    present = sum(1 for frame_idx in needed if (frames_dir / f"frame_{frame_idx:06d}.jpg").exists())
    return {
        "needed": len(needed),
        "existing": existing,
        "extracted": max(0, present - existing),
        "missing": max(0, len(needed) - present),
    }


def _extract_all_frames(clip_id: str, fps: int = NORM_FPS, normalize: bool = True) -> int:
    """Extract a dense, contiguous 30fps frame set from the clip mp4.

    Always clears the frames dir first: the volume may hold sparse
    GT-referenced training frames (non-contiguous), which would corrupt
    full-clip trajectory inference. analyze needs every frame in order.

    When normalize=True, frames are scaled to 1280x720 in the same pass
    (ffmpeg auto-applies rotation metadata first), so real-device footage of
    any resolution lands in the pipeline's expected frame space. Assumes
    roughly-16:9 landscape input (fixed camera); non-16:9 is stretched.
    """
    video_path = REMOTE_DATASET / "clips" / f"{clip_id}.mp4"
    frames_dir = REMOTE_DATASET / "frames" / clip_id
    frames_dir.mkdir(parents=True, exist_ok=True)
    if not video_path.exists():
        raise FileNotFoundError(f"Clip video not found: {video_path}")
    for stale in frames_dir.glob("frame_*.jpg"):
        stale.unlink()
    vf = f"scale={NORM_WIDTH}:{NORM_HEIGHT},fps={fps}" if normalize else f"fps={fps}"
    _run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(video_path),
            "-vf",
            vf,
            "-q:v",
            "3",
            str(frames_dir / "frame_%06d.jpg"),
        ],
        f"Extract {fps}fps frames ({'norm 1280x720' if normalize else 'native'}): {clip_id}",
    )
    return len(list(frames_dir.glob("frame_*.jpg")))


def _write_court_json(clip_id: str, corners_norm: list, court_type: str) -> Path:
    """Write court calibration from app-supplied normalized corners.

    corners_norm: 4 [x, y] pairs in [0,1], order near-left, near-right,
    far-right, far-left (relative to the frame the user calibrated on).
    """
    import json

    if court_type not in ("singles", "doubles"):
        raise ValueError(f"court_type must be singles|doubles, got {court_type!r}")
    if not (isinstance(corners_norm, list) and len(corners_norm) == 4):
        raise ValueError("court_corners must be 4 [x,y] normalized pairs")
    image_corners = [[float(x) * NORM_WIDTH, float(y) * NORM_HEIGHT] for x, y in corners_norm]
    width_m = SINGLES_WIDTH_M if court_type == "singles" else DOUBLES_WIDTH_M
    court_corners_m = [[0.0, 0.0], [width_m, 0.0], [width_m, COURT_LENGTH_M], [0.0, COURT_LENGTH_M]]
    payload = {
        "court": court_type,
        "image_corners": image_corners,
        "court_corners_m": court_corners_m,
        "corner_order": "near-left, near-right, far-right, far-left",
        "source": "app-supplied normalized corners",
    }
    path = REMOTE_DATASET / "court" / f"{clip_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def _write_labels_json(clip_id: str, rallies: list, fps: int = NORM_FPS) -> Path:
    """Write rally-window labels from app-supplied segments.

    rallies: list of {"startSec", "endSec"} (e.g. from on-device rallySegment).
    """
    import json

    if not (isinstance(rallies, list) and rallies):
        raise ValueError("rallies must be a non-empty list of {startSec,endSec}")
    normalized = []
    for r in rallies:
        normalized.append(
            {
                "startSec": float(r["startSec"]),
                "endSec": float(r["endSec"]),
                "server": r.get("server"),
                "winner": r.get("winner"),
                "endReason": r.get("endReason"),
            }
        )
    payload = {"fps": fps, "rallies": normalized, "source": "app-supplied rally windows"}
    path = REMOTE_DATASET / "labels" / f"{clip_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def _upload_local(dataset: str) -> None:
    dataset_local = BASE / "eval" / "datasets" / dataset
    _put(BASE / "scripts", "/scripts")
    _put(dataset_local / "clips", f"/eval/datasets/{dataset}/clips")
    _put(dataset_local / "labels", f"/eval/datasets/{dataset}/labels")
    _put(dataset_local / "ball-gt", f"/eval/datasets/{dataset}/ball-gt", required=False)
    _put(Path("/private/tmp/tennis-eval-models/tracknet_weights.pth"), "/weights/tracknet_weights.pth")
    print("[ok] upload complete")


def _expand_local(clip_ids: str, stride: int) -> None:
    ids = _split_clip_ids(clip_ids)
    fc = expand_gt.spawn(ids, stride)
    print(f"SPAWNED_CALL_ID {fc.object_id}")


def _train_local(clip_ids: str, epochs: int, batch_size: int, lr: float) -> None:
    ids = _split_clip_ids(clip_ids)
    fc = train_v4.spawn(ids, epochs, batch_size, lr)
    print(f"SPAWNED_CALL_ID {fc.object_id}")


def _status_local(call_id: str) -> None:
    try:
        fc = modal.FunctionCall.from_id(call_id)
        result = fc.get(timeout=0)
    except (modal.exception.OutputExpiredError, modal.exception.TimeoutError, TimeoutError):
        print(f"STATUS running {call_id}")
    except modal.exception.NotFoundError as exc:
        print(f"STATUS not_found {call_id}")
        print(str(exc))
    except Exception as exc:
        print(f"STATUS error {call_id}")
        print(f"{exc.__class__.__name__}: {exc}")
    else:
        print(f"STATUS finished {call_id}")
        print(result)


def _download_local(dataset: str) -> None:
    _get(f"/eval/datasets/{dataset}/ball-gt", BASE / "eval" / "datasets" / dataset / "ball-gt")
    _get("/eval/results/tracknet-v4-modal", BASE / "eval" / "results" / "tracknet-v4-modal")
    print("[ok] download complete")


@app.function(image=image, gpu="T4", memory=16384, timeout=10800, volumes={str(REMOTE_BASE): volume})
def expand_gt(clip_ids: list[str], stride: int = 2) -> list[dict[str, object]]:
    """Run TrackNetV1 expansion, clean trajectories, write GT, and commit."""
    results: list[dict[str, object]] = []
    python = sys.executable

    for clip_id in clip_ids:
        print(f"\n=== expand_gt: {clip_id} ===", flush=True)
        try:
            _run(
                [
                    python,
                    str(REMOTE_BASE / "scripts" / "eval" / "track-ball.py"),
                    "--dataset",
                    "fixed-camera-v2",
                    "--clip-id",
                    clip_id,
                    "--stride",
                    str(stride),
                    "--weights",
                    str(REMOTE_WEIGHTS),
                    "--device",
                    "auto",
                    "--overwrite",
                ],
                f"TrackNet dense inference: {clip_id}",
            )
            _run(
                [
                    python,
                    str(REMOTE_BASE / "scripts" / "eval" / "autolabel" / "trajectory_process.py"),
                    "--dataset",
                    "fixed-camera-v2",
                    "--clip-id",
                    clip_id,
                    "--model",
                    "tracknet-v1",
                    "--no-trails",
                ],
                f"Trajectory cleanup: {clip_id}",
            )
            _run(
                [
                    python,
                    str(REMOTE_BASE / "scripts" / "eval" / "autolabel" / "build_ball_gt_from_track.py"),
                    "--dataset",
                    "fixed-camera-v2",
                    "--clip-id",
                    clip_id,
                ],
                f"Build ball GT: {clip_id}",
            )
            counts = _gt_counts(clip_id)
            frames = _extract_sparse_training_frames(clip_id)
            print(f"{clip_id}: GT {counts} frames {frames}", flush=True)
            results.append({"clip_id": clip_id, "status": "ok", "counts": counts, "frames": frames})
        except Exception as exc:
            print(f"{clip_id}: ERROR {exc}", flush=True)
            results.append({"clip_id": clip_id, "status": "error", "error": str(exc)})

    volume.commit()
    return results


@app.function(image=image, gpu="T4", memory=16384, timeout=10800, volumes={str(REMOTE_BASE): volume})
def train_v4(clip_ids: list[str], epochs: int = 30, batch_size: int = 4, lr: float = 1e-4) -> dict[str, object]:
    """Train TrackNetV4 on Modal GPU and commit latest checkpoint."""
    python = sys.executable
    frame_summaries: dict[str, dict[str, int]] = {}
    for clip_id in clip_ids:
        frames = _extract_sparse_training_frames(clip_id)
        frame_summaries[clip_id] = frames
        print(f"{clip_id}: training frames {frames}", flush=True)
        if frames["missing"] > 0:
            raise RuntimeError(f"{clip_id}: missing {frames['missing']} GT-referenced frames")
    volume.commit()

    cmd = [
        python,
        str(REMOTE_BASE / "scripts" / "eval" / "tracknet_v4" / "train.py"),
        "--dataset",
        "fixed-camera-v2",
        "--epochs",
        str(epochs),
        "--batch-size",
        str(batch_size),
        "--lr",
        str(lr),
        "--output-dir",
        str(REMOTE_RESULTS.relative_to(REMOTE_BASE)),
        "--device",
        "cuda",
    ]
    for clip_id in clip_ids:
        cmd.extend(["--clip-id", clip_id])

    _run(cmd, f"TrackNetV4 training: {len(clip_ids)} clips, epochs={epochs}")
    volume.commit()
    checkpoint = REMOTE_RESULTS / "latest.pt"
    return {
        "clip_ids": clip_ids,
        "epochs": epochs,
        "batch_size": batch_size,
        "lr": lr,
        "checkpoint": str(checkpoint),
        "checkpoint_exists": checkpoint.exists(),
        "frames": frame_summaries,
    }


@app.function(
    image=analyze_image,
    gpu="T4",
    cpu=8.0,
    memory=16384,
    timeout=10800,
    volumes={str(REMOTE_BASE): volume},
)
def analyze(
    clip_id: str,
    court_corners: list | None = None,
    court_type: str = "singles",
    rallies: list | None = None,
    handedness: str = "right",
    stride: int = 1,
    run_pose: bool = True,
    normalize: bool = True,
    video_url: str | None = None,
    batch_size: int = 16,
    num_workers: int = 8,
    checkpoint: str = REMOTE_V4_CHECKPOINT,
) -> dict[str, object]:
    """Cloud analysis: clip mp4 -> V4 trajectory -> shot events (+ FH/BH) JSON.

    Data-driven production contract:
      - court_corners: 4 normalized [x,y] pairs (near-left, near-right,
        far-right, far-left) from the app's calibration screen. If None, an
        existing court/<clip>.json on the volume is used.
      - rallies: [{startSec,endSec}] from on-device rally segmentation. If None,
        an existing labels/<clip>.json is used.
      - normalize: scale frames to 1280x720@30fps for real-device footage.

    Returns the shot-events payload and stroke labels.
    """
    import json

    python = sys.executable
    scripts = REMOTE_BASE / "scripts" / "eval"

    if video_url:
        import urllib.request

        dest = REMOTE_DATASET / "clips" / f"{clip_id}.mp4"
        dest.parent.mkdir(parents=True, exist_ok=True)
        print(f"{clip_id}: downloading video from url", flush=True)
        with urllib.request.urlopen(video_url) as response, open(dest, "wb") as handle:
            while True:
                chunk = response.read(1 << 20)
                if not chunk:
                    break
                handle.write(chunk)
        print(f"{clip_id}: downloaded {dest.stat().st_size} bytes", flush=True)

    if court_corners is not None:
        court_path = _write_court_json(clip_id, court_corners, court_type)
        print(f"{clip_id}: wrote court calibration {court_path.name}", flush=True)
    if rallies is not None:
        labels_path = _write_labels_json(clip_id, rallies)
        print(f"{clip_id}: wrote {len(rallies)} rally windows {labels_path.name}", flush=True)

    # Always extract a dense contiguous 30fps set (see _extract_all_frames).
    n_frames = _extract_all_frames(clip_id, normalize=normalize)
    print(f"{clip_id}: dense frames extracted {n_frames}", flush=True)

    labels_path = REMOTE_DATASET / "labels" / f"{clip_id}.json"
    infer_cmd = [
        python,
        str(scripts / "tracknet_v4" / "infer_trajectory.py"),
        "--dataset", "fixed-camera-v2",
        "--clip-id", clip_id,
        "--checkpoint", checkpoint,
        "--device", "cuda",
        "--stride", str(stride),
        "--batch-size", str(batch_size),
        "--num-workers", str(num_workers),
        "--overwrite",
    ]
    # Only infer inside rally windows (skip dead time) when labels are available.
    if labels_path.exists():
        infer_cmd.extend(["--windows-json", str(labels_path)])
    _run(infer_cmd, f"TrackNetV4 rally-window inference (batch {batch_size}, workers {num_workers}): {clip_id}")
    _run(
        [
            python,
            str(scripts / "autolabel" / "trajectory_process.py"),
            "--dataset", "fixed-camera-v2",
            "--clip-id", clip_id,
            "--model", "tracknet-v4",
            "--no-trails",
        ],
        f"Trajectory cleanup: {clip_id}",
    )
    _run(
        [
            python,
            str(scripts / "shot_events" / "pipeline.py"),
            "--dataset", "fixed-camera-v2",
            "--clip-id", clip_id,
            "--track-model", "tracknet-v4",
        ],
        f"Shot events: {clip_id}",
    )

    strokes_payload: dict[str, object] | None = None
    if run_pose:
        _run(
            [
                python,
                str(scripts / "shot_events" / "stroke_pose.py"),
                "--dataset", "fixed-camera-v2",
                "--clip-id", clip_id,
                "--model", "yolo11n-pose.pt",
                "--handedness", handedness,
            ],
            f"Stroke pose (FH/BH): {clip_id}",
        )

    volume.commit()

    events_path = REMOTE_RESULTS_SHOT / f"{clip_id}.json"
    strokes_path = REMOTE_RESULTS_SHOT / f"{clip_id}_strokes.json"
    events_payload = json.loads(events_path.read_text(encoding="utf-8")) if events_path.exists() else None
    if run_pose and strokes_path.exists():
        strokes_payload = json.loads(strokes_path.read_text(encoding="utf-8"))

    summary = events_payload.get("summary", {}) if isinstance(events_payload, dict) else {}
    return {
        "clip_id": clip_id,
        "status": "ok" if events_payload else "error",
        "court_type": court_type,
        "normalized": normalize,
        "frames": n_frames,
        "summary": summary,
        "events": events_payload,
        "strokes": strokes_payload,
    }


def _load_job(job_path: str | None) -> dict[str, object]:
    """Load an analysis job spec {court_corners, court_type, rallies, handedness}."""
    import json

    if not job_path:
        return {}
    path = Path(job_path)
    if not path.is_absolute():
        path = BASE / path
    return json.loads(path.read_text(encoding="utf-8"))


def _analyze_local(clip_id: str, handedness: str, stride: int, run_pose: bool, job_path: str | None = None) -> None:
    job = _load_job(job_path)
    fc = analyze.spawn(
        clip_id,
        job.get("court_corners"),
        job.get("court_type", "singles"),
        job.get("rallies"),
        job.get("handedness", handedness),
        stride,
        run_pose,
        job.get("normalize", True),
        job.get("video_url"),
    )
    print(f"SPAWNED_CALL_ID {fc.object_id}")


web_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]")


@app.function(image=web_image)
@modal.fastapi_endpoint(method="POST", docs=True)
def submit(payload: dict) -> dict[str, object]:
    """HTTP entry for the app: enqueue an analysis job, return its call id.

    Body: {clip_id, video_url, court_corners, court_type, rallies, handedness}
    - clip_id: app-generated id (e.g. submissionId)
    - video_url: publicly/temporarily fetchable mp4 (e.g. Supabase signed URL)
    - court_corners: 4 normalized [x,y] (near-left,near-right,far-right,far-left)
    - rallies: [{startSec,endSec}] from on-device segmentation
    """
    clip_id = payload.get("clip_id")
    if not clip_id:
        return {"error": "clip_id required"}
    fc = analyze.spawn(
        clip_id,
        payload.get("court_corners"),
        payload.get("court_type", "singles"),
        payload.get("rallies"),
        payload.get("handedness", "right"),
        int(payload.get("stride", 1)),
        bool(payload.get("run_pose", True)),
        bool(payload.get("normalize", True)),
        payload.get("video_url"),
    )
    return {"call_id": fc.object_id, "clip_id": clip_id, "status": "queued"}


@app.function(image=web_image)
@modal.fastapi_endpoint(method="GET", docs=True)
def result(call_id: str) -> dict[str, object]:
    """HTTP status/result poll for the app. Returns running or the analysis payload."""
    try:
        fc = modal.FunctionCall.from_id(call_id)
        payload = fc.get(timeout=0)
    except (modal.exception.OutputExpiredError, modal.exception.TimeoutError, TimeoutError):
        return {"call_id": call_id, "status": "running"}
    except Exception as exc:  # noqa: BLE001 - surface any terminal error to the client
        return {"call_id": call_id, "status": "error", "error": f"{exc.__class__.__name__}: {exc}"}
    return {"call_id": call_id, "status": "done", "result": payload}


def _modal_cli() -> str:
    local = BASE / ".venv-modal" / "bin" / "modal"
    return str(local) if local.exists() else "modal"


def _put(local: Path, remote: str, required: bool = True) -> None:
    if not local.exists():
        if required:
            raise FileNotFoundError(local)
        print(f"skip missing optional path: {local}")
        return
    print(f"Uploading {local} -> {remote}")
    subprocess.run([_modal_cli(), "volume", "put", VOLUME_NAME, str(local), remote], check=True)


def _get(remote: str, local: Path) -> None:
    local.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {remote} -> {local}")
    subprocess.run([_modal_cli(), "volume", "get", VOLUME_NAME, remote, str(local)], check=True)


@app.local_entrypoint()
def upload(dataset: str = "fixed-camera-v2") -> None:
    _upload_local(dataset)


@app.local_entrypoint()
def expand(clip_ids: str, stride: int = 2) -> None:
    _expand_local(clip_ids, stride)


@app.local_entrypoint()
def train(clip_ids: str, epochs: int = 30, batch_size: int = 4, lr: float = 1e-4) -> None:
    _train_local(clip_ids, epochs, batch_size, lr)


@app.local_entrypoint()
def analyze_clip(
    clip_id: str,
    handedness: str = "right",
    stride: int = 1,
    run_pose: bool = True,
    job: str = "",
) -> None:
    _analyze_local(clip_id, handedness, stride, run_pose, job or None)


@app.local_entrypoint()
def status(call_id: str) -> None:
    _status_local(call_id)


@app.local_entrypoint()
def download(dataset: str = "fixed-camera-v2") -> None:
    _download_local(dataset)


if __name__ == "__main__":
    import argparse as _argparse

    parser = _argparse.ArgumentParser(description="Modal helpers for ball GT and TrackNetV4.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    up = sub.add_parser("upload")
    up.add_argument("--dataset", default="fixed-camera-v2")

    ex = sub.add_parser("expand")
    ex.add_argument("--clip-ids", required=True)
    ex.add_argument("--stride", type=int, default=2)

    tr = sub.add_parser("train")
    tr.add_argument("--clip-ids", required=True)
    tr.add_argument("--epochs", type=int, default=30)
    tr.add_argument("--batch-size", type=int, default=4)
    tr.add_argument("--lr", type=float, default=1e-4)

    an = sub.add_parser("analyze")
    an.add_argument("--clip-id", required=True)
    an.add_argument("--handedness", choices=("right", "left"), default="right")
    an.add_argument("--stride", type=int, default=1)
    an.add_argument("--no-pose", action="store_true")
    an.add_argument("--job", default="", help="Path to job JSON {court_corners, court_type, rallies}")

    dl = sub.add_parser("download")
    dl.add_argument("--dataset", default="fixed-camera-v2")

    st = sub.add_parser("status")
    st.add_argument("call_id")

    args = parser.parse_args()
    if args.cmd == "upload":
        _upload_local(args.dataset)
    elif args.cmd == "expand":
        _expand_local(args.clip_ids, args.stride)
    elif args.cmd == "train":
        _train_local(args.clip_ids, args.epochs, args.batch_size, args.lr)
    elif args.cmd == "analyze":
        _analyze_local(args.clip_id, args.handedness, args.stride, not args.no_pose, args.job or None)
    elif args.cmd == "download":
        _download_local(args.dataset)
    elif args.cmd == "status":
        _status_local(args.call_id)
