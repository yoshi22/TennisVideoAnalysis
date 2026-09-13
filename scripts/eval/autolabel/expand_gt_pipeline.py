#!/usr/bin/env python3.11
"""Disk-safe multi-clip ball-GT expansion pipeline."""

from __future__ import annotations

import argparse
import json
import shlex
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

BASE = Path(__file__).resolve().parents[3]
DATASETS_DIR = BASE / "eval" / "datasets"
DEFAULT_WEIGHTS = Path("/private/tmp/tennis-eval-models/tracknet_weights.pth")

if str(BASE) not in sys.path:
    sys.path.append(str(BASE))


@dataclass
class FrameExtractionResult:
    needed: int = 0
    existing: int = 0
    extracted: int = 0
    missing: int = 0


@dataclass
class ClipResult:
    clip_id: str
    status: str
    gt_rows: int = 0
    det_rows: int = 0
    interp_rows: int = 0
    per_rally: dict[int, dict[str, int]] = field(default_factory=dict)
    frames: FrameExtractionResult = field(default_factory=FrameExtractionResult)
    seconds: float = 0.0
    error: str = ""


class DiskTracker:
    def __init__(self, path: Path):
        self.path = path
        self.start_free = shutil.disk_usage(path).free
        self.min_free = self.start_free

    def mark(self) -> None:
        self.min_free = min(self.min_free, shutil.disk_usage(self.path).free)

    @property
    def peak_used(self) -> int:
        return max(0, self.start_free - self.min_free)

    @property
    def end_free(self) -> int:
        return shutil.disk_usage(self.path).free


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Expand ball GT across clips without full-frame extraction.")
    parser.add_argument("--dataset", default="fixed-camera-v2")
    parser.add_argument("--clip-ids", nargs="*", default=[], help="Clip ids; accepts spaces and/or commas.")
    parser.add_argument("--all-with-clips", action="store_true", help="Discover clips with mp4 and label JSON/DRAFT.")
    parser.add_argument("--stride", type=int, default=2)
    parser.add_argument("--track-model", default="tracknet-v1")
    parser.add_argument("--weights", default=str(DEFAULT_WEIGHTS))
    parser.add_argument("--device", default="mps", choices=("auto", "mps", "cpu"))
    parser.add_argument("--source-filter", choices=("det", "all"), default="det")
    parser.add_argument("--tracknet-confidence-threshold", type=float, default=0.35)
    parser.add_argument("--trajectory-min-conf", type=float, default=0.3)
    parser.add_argument("--max-track-frames", type=int, default=None, help="Optional local smoke cap for TrackNet outputs.")
    return parser.parse_args()


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(BASE))
    except ValueError:
        return str(path)


def human_bytes(value: int) -> str:
    size = float(value)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024.0 or unit == "TB":
            return f"{size:.1f}{unit}" if unit != "B" else f"{int(size)}B"
        size /= 1024.0
    return f"{size:.1f}TB"


def split_clip_ids(values: Sequence[str]) -> list[str]:
    clip_ids: list[str] = []
    for value in values:
        clip_ids.extend(part.strip() for part in value.split(",") if part.strip())
    return list(dict.fromkeys(clip_ids))


def labels_path(dataset_dir: Path, clip_id: str) -> Path | None:
    path = dataset_dir / "labels" / f"{clip_id}.json"
    if path.exists():
        return path
    draft_path = dataset_dir / "labels" / f"{clip_id}_DRAFT.json"
    if draft_path.exists():
        return draft_path
    return None


def discover_clip_ids(dataset: str) -> list[str]:
    dataset_dir = DATASETS_DIR / dataset
    clips_dir = dataset_dir / "clips"
    out: list[str] = []
    for mp4_path in sorted(clips_dir.glob("*.mp4")):
        clip_id = mp4_path.stem
        if labels_path(dataset_dir, clip_id) is not None:
            out.append(clip_id)
    return out


def resolve_clip_ids(args: argparse.Namespace) -> list[str]:
    explicit = split_clip_ids(args.clip_ids)
    if args.all_with_clips:
        discovered = discover_clip_ids(args.dataset)
        return list(dict.fromkeys(explicit + discovered))
    return explicit


def command_text(command: Sequence[str]) -> str:
    return " ".join(shlex.quote(part) for part in command)


def tail_text(value: str, limit: int = 18) -> str:
    lines = value.replace("\r", "\n").splitlines()
    lines = [line for line in lines if line.strip()]
    return "\n".join(lines[-limit:])


def run_command(name: str, command: Sequence[str]) -> tuple[float, str]:
    print(f"  {name}: {command_text(command)}")
    start = time.perf_counter()
    completed = subprocess.run(
        list(command),
        cwd=BASE,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    seconds = time.perf_counter() - start
    if completed.returncode != 0:
        tail = tail_text(completed.stdout)
        raise RuntimeError(f"{name} failed after {seconds:.1f}s\n{tail}")
    print(f"  {name}: ok ({seconds:.1f}s)")
    return seconds, completed.stdout


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def summarize_gt(gt_path: Path) -> tuple[int, int, int, dict[int, dict[str, int]]]:
    det = 0
    interp = 0
    per_rally: dict[int, dict[str, int]] = {}
    rows = read_jsonl(gt_path)
    for row in rows:
        source = str(row.get("source", "det"))
        rally = int(row.get("rally", 0))
        per_rally.setdefault(rally, {"det": 0, "interp": 0})
        if source == "interp":
            interp += 1
            per_rally[rally]["interp"] += 1
        else:
            det += 1
            per_rally[rally]["det"] += 1
    return len(rows), det, interp, dict(sorted(per_rally.items()))


def gt_frame_indices(gt_path: Path) -> set[int]:
    indices: set[int] = set()
    for row in read_jsonl(gt_path):
        frame_idx = int(row["frameIdx"])
        indices.update(idx for idx in (frame_idx - 1, frame_idx, frame_idx + 1) if idx >= 0)
    return indices


def ffprobe_dimensions(video_path: Path) -> tuple[int, int]:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        str(video_path),
    ]
    completed = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if completed.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {video_path}: {completed.stderr.strip()}")
    data = json.loads(completed.stdout)
    stream = data.get("streams", [{}])[0]
    return int(stream["width"]), int(stream["height"])


def extract_missing_frames_with_ffmpeg(
    video_path: Path,
    frames_dir: Path,
    missing_indices: Sequence[int],
    result: FrameExtractionResult,
) -> None:
    import cv2
    import numpy as np

    width, height = ffprobe_dimensions(video_path)
    frame_bytes = width * height * 3
    pending = set(missing_indices)
    command = [
        "ffmpeg",
        "-v",
        "error",
        "-i",
        str(video_path),
        "-pix_fmt",
        "bgr24",
        "-f",
        "rawvideo",
        "pipe:1",
    ]
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.stdout is None:
        raise RuntimeError("Could not open ffmpeg stdout pipe for sparse frame extraction")

    frame_idx = 0
    max_needed = max(pending) if pending else -1
    stderr = b""
    try:
        while frame_idx <= max_needed:
            raw = proc.stdout.read(frame_bytes)
            if not raw:
                break
            if len(raw) != frame_bytes:
                raise RuntimeError(f"Partial frame read from ffmpeg for {video_path}")
            if frame_idx in pending:
                frame = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 3)
                out_path = frames_dir / f"frame_{frame_idx:06d}.jpg"
                if not cv2.imwrite(str(out_path), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 95]):
                    raise OSError(f"Failed to write frame: {out_path}")
                result.extracted += 1
                pending.remove(frame_idx)
            frame_idx += 1
    finally:
        proc.stdout.close()
        if proc.stderr is not None:
            stderr = proc.stderr.read()

    proc.wait()
    if pending:
        result.missing += len(pending)
    if result.extracted == 0 and result.missing > 0 and stderr:
        message = stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"ffmpeg sparse extraction failed for {video_path}: {message}")


def extract_gt_frames(dataset: str, clip_id: str, gt_path: Path) -> FrameExtractionResult:
    dataset_dir = DATASETS_DIR / dataset
    video_path = dataset_dir / "clips" / f"{clip_id}.mp4"
    frames_dir = dataset_dir / "frames" / clip_id
    frames_dir.mkdir(parents=True, exist_ok=True)

    needed = sorted(gt_frame_indices(gt_path))
    result = FrameExtractionResult(needed=len(needed))
    if not needed:
        return result

    missing_indices: list[int] = []
    for frame_idx in needed:
        out_path = frames_dir / f"frame_{frame_idx:06d}.jpg"
        if out_path.exists():
            result.existing += 1
        else:
            missing_indices.append(frame_idx)

    if missing_indices:
        extract_missing_frames_with_ffmpeg(video_path, frames_dir, missing_indices, result)

    return result


def verify_dataset_load(dataset: str, clip_id: str) -> None:
    from scripts.eval.tracknet_v4.dataset import TrackNetV4BallDataset

    ds = TrackNetV4BallDataset(dataset, clip_ids=[clip_id], max_samples=1)
    sample = ds[0]
    if tuple(sample["input"].shape) != (9, 288, 512):
        raise RuntimeError(f"Unexpected input shape: {tuple(sample['input'].shape)}")
    if tuple(sample["target"].shape) != (3, 288, 512):
        raise RuntimeError(f"Unexpected target shape: {tuple(sample['target'].shape)}")


def process_clip(args: argparse.Namespace, clip_id: str, disk: DiskTracker) -> ClipResult:
    start = time.perf_counter()
    dataset_dir = DATASETS_DIR / args.dataset
    video_path = dataset_dir / "clips" / f"{clip_id}.mp4"
    label_path = labels_path(dataset_dir, clip_id)
    if not video_path.exists():
        raise FileNotFoundError(f"Clip video not found: {video_path}")
    if label_path is None:
        raise FileNotFoundError(f"Label JSON/DRAFT not found for {clip_id}")

    print(f"\n{clip_id}: start mp4={rel(video_path)} labels={rel(label_path)}")
    python = "/usr/local/bin/python3.11"

    track_path = dataset_dir / "ball-tracks" / args.track_model / f"{clip_id}.jsonl"
    track_command = [
        python,
        "scripts/eval/track-ball.py",
        "--dataset",
        args.dataset,
        "--model",
        args.track_model,
        "--clip-id",
        clip_id,
        "--stride",
        str(args.stride),
        "--weights",
        args.weights,
        "--confidence-threshold",
        str(args.tracknet_confidence_threshold),
        "--device",
        args.device,
        "--overwrite",
    ]
    if args.max_track_frames is not None:
        track_command.extend(["--max-frames", str(args.max_track_frames)])
    _, track_output = run_command("track-ball", track_command)
    if not track_path.exists() or track_path.stat().st_size == 0:
        raise RuntimeError(f"track-ball did not write {rel(track_path)}\n{tail_text(track_output)}")
    disk.mark()

    clean_path = dataset_dir / "ball-tracks" / args.track_model / "clean" / f"{clip_id}.jsonl"
    _, clean_output = run_command(
        "trajectory",
        [
            python,
            "scripts/eval/autolabel/trajectory_process.py",
            "--dataset",
            args.dataset,
            "--clip-id",
            clip_id,
            "--model",
            args.track_model,
            "--min-conf",
            str(args.trajectory_min_conf),
            "--no-trails",
        ],
    )
    if not clean_path.exists() or clean_path.stat().st_size == 0:
        raise RuntimeError(f"trajectory did not write {rel(clean_path)}\n{tail_text(clean_output)}")
    disk.mark()

    gt_path = dataset_dir / "ball-gt" / f"{clip_id}.jsonl"
    _, gt_output = run_command(
        "build-gt",
        [
            python,
            "scripts/eval/autolabel/build_ball_gt_from_track.py",
            "--dataset",
            args.dataset,
            "--clip-id",
            clip_id,
            "--track-model",
            args.track_model,
            "--source-filter",
            args.source_filter,
        ],
    )
    if not gt_path.exists() or gt_path.stat().st_size == 0:
        raise RuntimeError(f"build-gt did not write {rel(gt_path)}\n{tail_text(gt_output)}")
    disk.mark()

    gt_rows, det_rows, interp_rows, per_rally = summarize_gt(gt_path)

    frames = extract_gt_frames(args.dataset, clip_id, gt_path)
    disk.mark()
    print(
        f"  sparse-frames: needed={frames.needed} existing={frames.existing} "
        f"extracted={frames.extracted} missing={frames.missing}"
    )

    verify_dataset_load(args.dataset, clip_id)
    disk.mark()
    seconds = time.perf_counter() - start
    print(f"{clip_id}: ok gt={gt_rows} det={det_rows} interp={interp_rows} ({seconds:.1f}s)")
    return ClipResult(
        clip_id=clip_id,
        status="ok",
        gt_rows=gt_rows,
        det_rows=det_rows,
        interp_rows=interp_rows,
        per_rally=per_rally,
        frames=frames,
        seconds=seconds,
    )


def print_table(results: list[ClipResult], disk: DiskTracker) -> None:
    print("\nGT aggregate")
    print("clip status gt det interp frames_needed existing extracted missing seconds")
    print("---- ------ -- --- ------ ------------- -------- --------- ------- -------")
    for result in results:
        print(
            f"{result.clip_id} {result.status} {result.gt_rows} {result.det_rows} {result.interp_rows} "
            f"{result.frames.needed} {result.frames.existing} {result.frames.extracted} "
            f"{result.frames.missing} {result.seconds:.1f}"
        )
        if result.error:
            print(f"  error: {result.error}")
    ok = [result for result in results if result.status == "ok"]
    print("---- ------ -- --- ------ ------------- -------- --------- ------- -------")
    print(
        f"all ok={len(ok)}/{len(results)} gt={sum(r.gt_rows for r in ok)} "
        f"det={sum(r.det_rows for r in ok)} interp={sum(r.interp_rows for r in ok)}"
    )
    print(
        f"disk observed_peak_used={human_bytes(disk.peak_used)} "
        f"start_free={human_bytes(disk.start_free)} end_free={human_bytes(disk.end_free)}"
    )
    print("temp_full_frame_extraction=none")


def main() -> None:
    args = parse_args()
    if args.stride < 1:
        raise SystemExit("--stride must be >= 1")

    clip_ids = resolve_clip_ids(args)
    if not clip_ids:
        raise SystemExit("Pass --clip-ids <id...> or --all-with-clips")

    disk = DiskTracker(BASE)
    results: list[ClipResult] = []
    print(f"dataset={args.dataset} clips={len(clip_ids)} stride={args.stride} source_filter={args.source_filter}")
    for clip_id in clip_ids:
        try:
            results.append(process_clip(args, clip_id, disk))
        except Exception as exc:
            disk.mark()
            message = str(exc).splitlines()[0] if str(exc).splitlines() else repr(exc)
            print(f"{clip_id}: ERROR {message}")
            results.append(ClipResult(clip_id=clip_id, status="error", error=message))

    print_table(results, disk)


if __name__ == "__main__":
    main()
