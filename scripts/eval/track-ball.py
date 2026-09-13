#!/usr/bin/env python3
"""
Emit TrackNet V1 ball trajectories for fixed-camera evaluation clips.

The output is one JSONL trajectory file plus one meta JSON file per clip.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import urllib.request
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch
import torch.nn as nn

BASE = Path(__file__).parent.parent.parent
DATASETS_DIR = BASE / "eval/datasets"
DEFAULT_DATASET = "fixed-camera-v2"
DEFAULT_MODEL = "tracknet-v1"
DEFAULT_WEIGHTS = Path("/private/tmp/tennis-eval-models/tracknet_weights.pth")
WEIGHTS_URL = "https://huggingface.co/vishnushenoy09/tracknet-v1-tennis/resolve/main/tracknet_weights.pth"
INPUT_SIZE = (640, 360)
FRAME_NUMBER_RE = re.compile(r"(\d+)")


class ConvBlock(nn.Module):
    def __init__(
        self,
        in_channels: int,
        out_channels: int,
        kernel_size: int = 3,
        pad: int = 1,
        stride: int = 1,
        bias: bool = True,
    ):
        super().__init__()
        self.block = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, kernel_size, stride=stride, padding=pad, bias=bias),
            nn.ReLU(),
            nn.BatchNorm2d(out_channels),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.block(x)


class BallTrackerNet(nn.Module):
    def __init__(self, out_channels: int = 256):
        super().__init__()
        self.out_channels = out_channels
        self.conv1 = ConvBlock(9, 64)
        self.conv2 = ConvBlock(64, 64)
        self.pool1 = nn.MaxPool2d(2, 2)
        self.conv3 = ConvBlock(64, 128)
        self.conv4 = ConvBlock(128, 128)
        self.pool2 = nn.MaxPool2d(2, 2)
        self.conv5 = ConvBlock(128, 256)
        self.conv6 = ConvBlock(256, 256)
        self.conv7 = ConvBlock(256, 256)
        self.pool3 = nn.MaxPool2d(2, 2)
        self.conv8 = ConvBlock(256, 512)
        self.conv9 = ConvBlock(512, 512)
        self.conv10 = ConvBlock(512, 512)
        self.ups1 = nn.Upsample(scale_factor=2)
        self.conv11 = ConvBlock(512, 256)
        self.conv12 = ConvBlock(256, 256)
        self.conv13 = ConvBlock(256, 256)
        self.ups2 = nn.Upsample(scale_factor=2)
        self.conv14 = ConvBlock(256, 128)
        self.conv15 = ConvBlock(128, 128)
        self.ups3 = nn.Upsample(scale_factor=2)
        self.conv16 = ConvBlock(128, 64)
        self.conv17 = ConvBlock(64, 64)
        self.conv18 = ConvBlock(64, out_channels)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        batch_size = x.size(0)
        x = self.conv1(x)
        x = self.conv2(x)
        x = self.pool1(x)
        x = self.conv3(x)
        x = self.conv4(x)
        x = self.pool2(x)
        x = self.conv5(x)
        x = self.conv6(x)
        x = self.conv7(x)
        x = self.pool3(x)
        x = self.conv8(x)
        x = self.conv9(x)
        x = self.conv10(x)
        x = self.ups1(x)
        x = self.conv11(x)
        x = self.conv12(x)
        x = self.conv13(x)
        x = self.ups2(x)
        x = self.conv14(x)
        x = self.conv15(x)
        x = self.ups3(x)
        x = self.conv16(x)
        x = self.conv17(x)
        x = self.conv18(x)
        return x.reshape(batch_size, self.out_channels, -1)


@dataclass(frozen=True)
class ClipSource:
    mode: str
    name: str
    path: Path
    fps: float | None
    low_fps: bool = False
    frame_paths: tuple[Path, ...] = ()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default="track-ball-run1")
    parser.add_argument("--dataset", default=DEFAULT_DATASET)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--clip-id", action="append", help="Clip id to process; default all dataset labels")
    parser.add_argument("--stride", type=int, default=2)
    parser.add_argument("--max-frames", type=int, default=None)
    parser.add_argument("--download-weights", action="store_true")
    parser.add_argument("--weights", default=str(DEFAULT_WEIGHTS))
    parser.add_argument("--confidence-threshold", type=float, default=0.35)
    parser.add_argument("--device", default="auto", choices=("auto", "mps", "cpu"))
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def frame_number(path: Path) -> int:
    match = FRAME_NUMBER_RE.search(path.name)
    return int(match.group(1)) if match else 0


def sorted_jpgs(path: Path) -> tuple[Path, ...]:
    return tuple(sorted(path.glob("*.jpg"), key=frame_number))


def load_json(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def dataset_dir(dataset: str) -> Path:
    return DATASETS_DIR / dataset


def output_dir(dataset: str, model: str) -> Path:
    return dataset_dir(dataset) / "ball-tracks" / model


def clip_ids_from_labels(dataset: str, selected: list[str] | None) -> list[str]:
    if selected:
        return list(dict.fromkeys(selected))
    labels_dir = dataset_dir(dataset) / "labels"
    clip_ids: list[str] = []
    for path in sorted(labels_dir.glob("*.json")):
        try:
            clip_ids.append(str(load_json(path).get("videoId", path.stem)))
        except json.JSONDecodeError:
            clip_ids.append(path.stem)
    return clip_ids


def clip_duration_sec(dataset: str, clip_id: str) -> float | None:
    label_path = dataset_dir(dataset) / "labels" / f"{clip_id}.json"
    if not label_path.exists():
        return None
    try:
        value = load_json(label_path).get("clipDurationSec")
    except json.JSONDecodeError:
        return None
    if value is None:
        return None
    duration = float(value)
    return duration if duration > 0 else None


def infer_frame_dir_fps(paths: tuple[Path, ...], duration_sec: float | None, default: float) -> float:
    # High frame count → was extracted at 30fps (matches tracknet-gate.py heuristic: n>5000 → 30fps)
    if len(paths) > 5000:
        return 30.0
    if duration_sec is None:
        return default
    fps = len(paths) / duration_sec
    return fps if fps > 0 else default


def resolve_clip_source(dataset: str, clip_id: str) -> ClipSource:
    fixed_v1 = DATASETS_DIR / "fixed-camera-v1"
    fixed_v2 = DATASETS_DIR / "fixed-camera-v2"

    frames30 = fixed_v1 / "frames30" / clip_id
    frames30_paths = sorted_jpgs(frames30) if frames30.exists() else ()
    if frames30_paths:
        return ClipSource("frames", "fixed-camera-v1/frames30", frames30, 30.0, False, frames30_paths)

    v2_clip = fixed_v2 / "clips" / f"{clip_id}.mp4"
    if v2_clip.exists():
        return ClipSource("video", "fixed-camera-v2/clips", v2_clip, None)

    v1_clip = fixed_v1 / "clips" / f"{clip_id}.mp4"
    if v1_clip.exists():
        return ClipSource("video", "fixed-camera-v1/clips", v1_clip, None)

    fallback_frames = (fixed_v2 / "frames" / clip_id).resolve()
    fallback_paths = sorted_jpgs(fallback_frames) if fallback_frames.exists() else ()
    if fallback_paths:
        fps = infer_frame_dir_fps(fallback_paths, clip_duration_sec(dataset, clip_id), 3.0)
        low_fps = fps <= 5.0
        return ClipSource("frames", "fixed-camera-v2/frames", fallback_frames, fps, low_fps, fallback_paths)

    raise FileNotFoundError(f"No usable frames or clip video found for {clip_id}")


def ensure_weights(path: Path, download: bool) -> None:
    if path.exists():
        return
    if not download:
        raise FileNotFoundError(f"TrackNet weights not found: {path}. Pass --download-weights or provide --weights.")
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading TrackNet weights to {path}")
    urllib.request.urlretrieve(WEIGHTS_URL, path)


def resolve_device(value: str) -> torch.device:
    if value == "auto":
        if torch.backends.mps.is_available():
            return torch.device("mps")
        if torch.cuda.is_available():
            return torch.device("cuda")
        return torch.device("cpu")
    return torch.device(value)


def load_model(weights_path: Path, device: torch.device) -> BallTrackerNet:
    state = torch.load(weights_path, map_location="cpu")
    model = BallTrackerNet()
    model.load_state_dict(state)
    model.to(device)
    model.eval()
    return model


def bgr_to_rgb_resized(img: np.ndarray) -> np.ndarray:
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    return cv2.resize(img, INPUT_SIZE, interpolation=cv2.INTER_AREA)


def read_rgb(path: Path) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise FileNotFoundError(path)
    return bgr_to_rgb_resized(img)


def prepare_frame(frame: Path | np.ndarray) -> np.ndarray:
    if isinstance(frame, Path):
        return read_rgb(frame).astype(np.float32) / 255.0
    return frame.astype(np.float32) / 255.0


def infer_triplet(
    model: BallTrackerNet,
    device: torch.device,
    frames: list[Path | np.ndarray],
    confidence_threshold: float,
) -> dict[str, float | int | None]:
    input_frames = [prepare_frame(frame) for frame in frames]
    stacked = np.concatenate(input_frames, axis=2)
    tensor = torch.from_numpy(stacked.transpose(2, 0, 1)).unsqueeze(0).to(device)
    with torch.no_grad():
        logits = model(tensor)
        probs = torch.softmax(logits, dim=1)
        classes = torch.arange(256, device=device, dtype=probs.dtype).view(1, 256, 1)
        heat = (probs * classes).sum(dim=1).reshape(INPUT_SIZE[1], INPUT_SIZE[0]) / 255.0
        confidence = float(heat.max().detach().cpu())
        flat_idx = int(torch.argmax(heat).detach().cpu())
    y, x = divmod(flat_idx, INPUT_SIZE[0])
    visible = int(confidence >= confidence_threshold)
    return {
        "x": x / INPUT_SIZE[0] if visible else None,
        "y": y / INPUT_SIZE[1] if visible else None,
        "visible": visible,
        "confidence": confidence,
    }


def progress(clip_id: str, n: int, total: int | None, done: bool = False) -> None:
    total_text = str(total) if total is not None else "?"
    print(f"{clip_id}: {n}/{total_text} frames", end="\n" if done else "\r", flush=True)


def row_from_prediction(frame_idx: int, fps: float, pred: dict[str, float | int | None]) -> dict[str, Any]:
    return {
        "frameIdx": frame_idx,
        "timeSec": frame_idx / fps,
        "x": pred["x"],
        "y": pred["y"],
        "visible": pred["visible"],
        "confidence": pred["confidence"],
    }


def write_frame_dir_tracks(
    clip_id: str,
    source: ClipSource,
    jsonl_path: Path,
    model: BallTrackerNet,
    device: torch.device,
    stride: int,
    max_frames: int | None,
    confidence_threshold: float,
) -> int:
    if source.fps is None:
        raise ValueError(f"Missing FPS for frame source: {source.path}")
    if len(source.frame_paths) < 3:
        raise ValueError(f"Not enough frames for {clip_id}: {source.path}")

    centers = list(range(1, len(source.frame_paths) - 1, stride))
    if max_frames is not None:
        centers = centers[:max_frames]
    total = len(centers)
    processed = 0

    with open(jsonl_path, "w", encoding="utf-8") as f:
        for center in centers:
            paths = [
                source.frame_paths[center - 1],
                source.frame_paths[center],
                source.frame_paths[center + 1],
            ]
            pred = infer_triplet(model, device, paths, confidence_threshold)
            frame_idx = frame_number(source.frame_paths[center])
            row = row_from_prediction(frame_idx, source.fps, pred)
            f.write(json.dumps(row, separators=(",", ":")) + "\n")
            processed += 1
            progress(clip_id, processed, total)
    progress(clip_id, processed, total, done=True)
    return processed


def video_stats(path: Path) -> tuple[float, int | None]:
    cap = cv2.VideoCapture(str(path))
    try:
        if cap.isOpened():
            fps = float(cap.get(cv2.CAP_PROP_FPS))
            if fps <= 0:
                fps = 30.0
            frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            return fps, frame_count if frame_count > 0 else None
    finally:
        cap.release()

    command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=avg_frame_rate,nb_frames,duration",
        "-of",
        "json",
        str(path),
    ]
    completed = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if completed.returncode != 0:
        raise FileNotFoundError(f"Could not open video: {path}\n{completed.stderr.strip()}")
    data = json.loads(completed.stdout)
    stream = data.get("streams", [{}])[0]
    fps_text = str(stream.get("avg_frame_rate", "30/1"))
    if "/" in fps_text:
        numerator, denominator = fps_text.split("/", 1)
        fps = float(numerator) / float(denominator or 1)
    else:
        fps = float(fps_text)
    if fps <= 0:
        fps = 30.0
    frame_count_raw = stream.get("nb_frames")
    frame_count = int(frame_count_raw) if str(frame_count_raw).isdigit() else None
    if frame_count is None and stream.get("duration") is not None:
        frame_count = int(round(float(stream["duration"]) * fps))
    return fps, frame_count


def expected_video_outputs(total_source_frames: int | None, stride: int, max_frames: int | None) -> int | None:
    if total_source_frames is None:
        return max_frames
    sampled = ((total_source_frames - 1) // stride) + 1
    total = max(0, sampled - 2)
    return min(total, max_frames) if max_frames is not None else total


def write_video_tracks(
    clip_id: str,
    source: ClipSource,
    jsonl_path: Path,
    model: BallTrackerNet,
    device: torch.device,
    stride: int,
    max_frames: int | None,
    confidence_threshold: float,
    fps: float,
    total_source_frames: int | None,
) -> int:
    cap = cv2.VideoCapture(str(source.path))
    if not cap.isOpened():
        return write_ffmpeg_video_tracks(
            clip_id,
            source,
            jsonl_path,
            model,
            device,
            stride,
            max_frames,
            confidence_threshold,
            fps,
            total_source_frames,
        )

    total = expected_video_outputs(total_source_frames, stride, max_frames)
    sampled_frames: deque[tuple[int, np.ndarray]] = deque(maxlen=3)
    processed = 0
    source_idx = 0

    try:
        with open(jsonl_path, "w", encoding="utf-8") as f:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                if source_idx % stride == 0:
                    sampled_frames.append((source_idx, bgr_to_rgb_resized(frame)))
                    if len(sampled_frames) == 3:
                        center_frame_idx = sampled_frames[1][0]
                        pred = infer_triplet(
                            model,
                            device,
                            [sampled_frames[0][1], sampled_frames[1][1], sampled_frames[2][1]],
                            confidence_threshold,
                        )
                        row = row_from_prediction(center_frame_idx, fps, pred)
                        f.write(json.dumps(row, separators=(",", ":")) + "\n")
                        processed += 1
                        progress(clip_id, processed, total)
                        if max_frames is not None and processed >= max_frames:
                            break
                source_idx += 1
    finally:
        cap.release()

    progress(clip_id, processed, total, done=True)
    return processed


def write_ffmpeg_video_tracks(
    clip_id: str,
    source: ClipSource,
    jsonl_path: Path,
    model: BallTrackerNet,
    device: torch.device,
    stride: int,
    max_frames: int | None,
    confidence_threshold: float,
    fps: float,
    total_source_frames: int | None,
) -> int:
    total = expected_video_outputs(total_source_frames, stride, max_frames)
    frame_bytes = INPUT_SIZE[0] * INPUT_SIZE[1] * 3
    command = [
        "ffmpeg",
        "-v",
        "error",
        "-i",
        str(source.path),
        "-vf",
        f"scale={INPUT_SIZE[0]}:{INPUT_SIZE[1]}",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "pipe:1",
    ]
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.stdout is None:
        raise RuntimeError("Could not open ffmpeg stdout pipe")

    sampled_frames: deque[tuple[int, np.ndarray]] = deque(maxlen=3)
    processed = 0
    source_idx = 0
    stderr = b""

    try:
        with open(jsonl_path, "w", encoding="utf-8") as f:
            while True:
                raw = proc.stdout.read(frame_bytes)
                if not raw:
                    break
                if len(raw) != frame_bytes:
                    raise RuntimeError(f"Partial frame read from ffmpeg for {source.path}")
                if source_idx % stride == 0:
                    frame = np.frombuffer(raw, dtype=np.uint8).reshape(INPUT_SIZE[1], INPUT_SIZE[0], 3).copy()
                    sampled_frames.append((source_idx, frame))
                    if len(sampled_frames) == 3:
                        center_frame_idx = sampled_frames[1][0]
                        pred = infer_triplet(
                            model,
                            device,
                            [sampled_frames[0][1], sampled_frames[1][1], sampled_frames[2][1]],
                            confidence_threshold,
                        )
                        row = row_from_prediction(center_frame_idx, fps, pred)
                        f.write(json.dumps(row, separators=(",", ":")) + "\n")
                        processed += 1
                        progress(clip_id, processed, total)
                        if max_frames is not None and processed >= max_frames:
                            break
                source_idx += 1
    finally:
        proc.stdout.close()
        if proc.stderr is not None:
            stderr = proc.stderr.read()

    returncode = proc.wait()
    if returncode != 0 and processed == 0:
        message = stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"ffmpeg video read failed for {source.path}: {message}")

    progress(clip_id, processed, total, done=True)
    return processed


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(BASE))
    except ValueError:
        return str(path)


def write_meta(
    meta_path: Path,
    args: argparse.Namespace,
    clip_id: str,
    source: ClipSource,
    fps: float,
    frames_processed: int,
    device: torch.device,
    weights: Path,
) -> None:
    payload = {
        "model": args.model,
        "weights": str(weights),
        "device": str(device),
        "sourceFps": float(fps),
        "stride": int(args.stride),
        "effectiveFps": float(fps / args.stride),
        "framesProcessed": int(frames_processed),
        "clipId": clip_id,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "runId": args.run_id,
        "dataset": args.dataset,
        "confidenceThreshold": float(args.confidence_threshold),
        "source": source.name,
        "sourcePath": display_path(source.path),
        "lowFps": bool(source.low_fps),
    }
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")


def process_clip(
    clip_id: str,
    model: BallTrackerNet,
    device: torch.device,
    weights: Path,
    args: argparse.Namespace,
) -> dict[str, Any]:
    out_dir = output_dir(args.dataset, args.model)
    out_dir.mkdir(parents=True, exist_ok=True)
    jsonl_path = out_dir / f"{clip_id}.jsonl"
    meta_path = out_dir / f"{clip_id}.meta.json"
    if jsonl_path.exists() and not args.overwrite:
        print(f"{clip_id}: output exists, skipping")
        return {"clipId": clip_id, "skipped": True, "path": display_path(jsonl_path)}

    source = resolve_clip_source(args.dataset, clip_id)
    tmp_jsonl = jsonl_path.with_suffix(".jsonl.tmp")
    tmp_meta = meta_path.with_suffix(".meta.json.tmp")

    try:
        if source.mode == "frames":
            if source.fps is None:
                raise ValueError(f"Missing FPS for {source.path}")
            frames_processed = write_frame_dir_tracks(
                clip_id,
                source,
                tmp_jsonl,
                model,
                device,
                args.stride,
                args.max_frames,
                args.confidence_threshold,
            )
            source_fps = source.fps
        elif source.mode == "video":
            source_fps, total_source_frames = video_stats(source.path)
            frames_processed = write_video_tracks(
                clip_id,
                source,
                tmp_jsonl,
                model,
                device,
                args.stride,
                args.max_frames,
                args.confidence_threshold,
                source_fps,
                total_source_frames,
            )
        else:
            raise ValueError(f"Unknown source mode: {source.mode}")

        write_meta(tmp_meta, args, clip_id, source, source_fps, frames_processed, device, weights)
        tmp_jsonl.replace(jsonl_path)
        tmp_meta.replace(meta_path)
        return {
            "clipId": clip_id,
            "framesProcessed": frames_processed,
            "path": display_path(jsonl_path),
            "metaPath": display_path(meta_path),
        }
    except Exception:
        tmp_jsonl.unlink(missing_ok=True)
        tmp_meta.unlink(missing_ok=True)
        raise


def is_mps_fallback_error(exc: BaseException) -> bool:
    message = str(exc).lower()
    return "mps" in message or "metal" in message or "not currently implemented" in message


def first_error_line(exc: BaseException) -> str:
    return str(exc).splitlines()[0] if str(exc).splitlines() else repr(exc)


def load_model_with_fallback(weights: Path, device: torch.device) -> tuple[BallTrackerNet, torch.device]:
    try:
        return load_model(weights, device), device
    except (RuntimeError, NotImplementedError) as exc:
        if device.type != "mps" or not is_mps_fallback_error(exc):
            raise
        print(f"WARNING: MPS model setup failed ({first_error_line(exc)}); falling back to CPU.")
        cpu = torch.device("cpu")
        return load_model(weights, cpu), cpu


def validate_args(args: argparse.Namespace) -> None:
    if args.model != DEFAULT_MODEL:
        raise SystemExit(f"Model {args.model!r} is not implemented; only {DEFAULT_MODEL!r} is available.")
    if args.stride < 1:
        raise SystemExit("--stride must be >= 1")
    if args.max_frames is not None and args.max_frames < 1:
        raise SystemExit("--max-frames must be >= 1")


def main() -> None:
    args = parse_args()
    validate_args(args)

    clip_ids = clip_ids_from_labels(args.dataset, args.clip_id)
    if not clip_ids:
        raise SystemExit(f"No clips found for dataset {args.dataset!r}")

    weights = Path(args.weights)
    out_dir = output_dir(args.dataset, args.model)
    pending_clip_ids = [
        clip_id
        for clip_id in clip_ids
        if args.overwrite or not (out_dir / f"{clip_id}.jsonl").exists()
    ]
    if not pending_clip_ids:
        for clip_id in clip_ids:
            print(f"{clip_id}: output exists, skipping")
        return

    ensure_weights(weights, args.download_weights)
    device = resolve_device(args.device)
    print(f"Run: {args.run_id}")
    print(f"Dataset: {args.dataset}")
    print(f"Device: {device}")
    model, device = load_model_with_fallback(weights, device)

    for clip_id in clip_ids:
        try:
            process_clip(clip_id, model, device, weights, args)
        except (RuntimeError, NotImplementedError) as exc:
            if device.type == "mps" and is_mps_fallback_error(exc):
                print(f"\nWARNING: MPS inference failed ({first_error_line(exc)}); falling back to CPU.")
                device = torch.device("cpu")
                model = load_model(weights, device)
                try:
                    process_clip(clip_id, model, device, weights, args)
                except Exception as retry_exc:
                    print(f"{clip_id}: ERROR: {retry_exc}")
            else:
                print(f"{clip_id}: ERROR: {exc}")
        except Exception as exc:
            print(f"{clip_id}: ERROR: {exc}")


if __name__ == "__main__":
    main()
