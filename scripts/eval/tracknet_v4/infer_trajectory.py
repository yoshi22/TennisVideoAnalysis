#!/usr/bin/env python3.11
"""Full-clip TrackNetV4 inference -> raw ball trajectory JSONL.

Unlike eval_pe.py (which only scores GT-labeled frames), this runs the trained
TrackNetV4 checkpoint over *every* frame of a clip and writes a raw detection
file in the same schema as scripts/eval/track-ball.py, so the existing
trajectory_process.py -> shot_events pipeline can consume it.

Reads:   eval/datasets/<dataset>/frames/<clipId>/frame_NNNNNN.jpg
Writes:  eval/datasets/<dataset>/ball-tracks/<model-name>/<clipId>.jsonl
         rows: {frameIdx, timeSec, x, y, visible, confidence}  (x,y normalized)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # scripts/eval, for _common
from _common import display_path, resolve_path

if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parent))
    from eval_pe import load_model, resolve_device  # type: ignore
else:
    from .eval_pe import load_model, resolve_device

BASE = Path(__file__).resolve().parents[3]
DATASETS_DIR = BASE / "eval" / "datasets"
DEFAULT_CHECKPOINT = "eval/results/tracknet-v4-modal/latest.pt"
TEMPORAL_OFFSETS = (-1, 0, 1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run TrackNetV4 over a full clip to produce a raw trajectory JSONL.")
    parser.add_argument("--dataset", default="fixed-camera-v2")
    parser.add_argument("--clip-id", required=True)
    parser.add_argument("--checkpoint", default=DEFAULT_CHECKPOINT)
    parser.add_argument("--model-name", default="tracknet-v4", help="Output subdir under ball-tracks/")
    parser.add_argument("--device", default="auto", choices=("auto", "mps", "cuda", "cpu"))
    parser.add_argument("--stride", type=int, default=1)
    parser.add_argument("--fps", type=float, default=0.0, help="0 = read from labels/<clip>.json, else fallback 30.")
    parser.add_argument("--conf-threshold", type=float, default=0.5)
    parser.add_argument("--max-frames", type=int, default=0, help="0 = all frames.")
    parser.add_argument("--batch-size", type=int, default=1, help="Frames per GPU forward pass.")
    parser.add_argument(
        "--num-workers",
        type=int,
        default=0,
        help="Parallel JPEG-decode workers (decode is the bottleneck; >0 overlaps decode with GPU).",
    )
    parser.add_argument(
        "--windows-json",
        default="",
        help="Path to JSON list [{startSec,endSec}]. If set, only infer frames inside rally windows.",
    )
    parser.add_argument(
        "--window-pad-sec",
        type=float,
        default=0.5,
        help="Seconds of padding added on each side of every rally window.",
    )
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def load_windows(path_value: str) -> list[tuple[float, float]] | None:
    if not path_value:
        return None
    path = Path(path_value)
    if not path.is_absolute():
        path = BASE / path
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload.get("rallies", payload) if isinstance(payload, dict) else payload
    windows: list[tuple[float, float]] = []
    for row in rows:
        windows.append((float(row["startSec"]), float(row["endSec"])))
    return windows


def frame_number(path: Path) -> int:
    digits = "".join(ch for ch in path.stem if ch.isdigit())
    if not digits:
        raise ValueError(f"Cannot parse frame index from {path.name}")
    return int(digits)


def resolve_fps(dataset_dir: Path, clip_id: str, requested: float) -> float:
    if requested and requested > 0:
        return requested
    for name in (f"{clip_id}.json", f"{clip_id}_DRAFT.json"):
        labels_path = dataset_dir / "labels" / name
        if labels_path.exists():
            with open(labels_path, encoding="utf-8") as handle:
                payload = json.load(handle)
            fps = float(payload.get("fps", 0.0))
            if fps > 0:
                return fps
    return 30.0


def read_frame(path: Path, input_height: int, input_width: int) -> np.ndarray | None:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        return None
    image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    image = cv2.resize(image, (input_width, input_height), interpolation=cv2.INTER_AREA)
    return (image.astype(np.float32) / 255.0).transpose(2, 0, 1)


class CenterStackDataset(torch.utils.data.Dataset):
    """Yields the 3-frame (9-channel) input stack for each center frame index.

    JPEG decode is the throughput bottleneck, so this is designed to run under a
    DataLoader with num_workers>0 to parallelize decode across CPU cores while
    the GPU runs the previous batch.
    """

    def __init__(self, frame_paths: list[Path], centers: list[int], input_height: int, input_width: int):
        self.frame_paths = frame_paths
        self.centers = centers
        self.input_height = input_height
        self.input_width = input_width

    def __len__(self) -> int:
        return len(self.centers)

    def _read(self, idx: int) -> np.ndarray:
        idx = min(max(idx, 0), len(self.frame_paths) - 1)
        frame = read_frame(self.frame_paths[idx], self.input_height, self.input_width)
        if frame is None:
            return np.zeros((3, self.input_height, self.input_width), dtype=np.float32)
        return frame

    def __getitem__(self, i: int) -> tuple[torch.Tensor, int]:
        center = self.centers[i]
        stack = np.concatenate([self._read(center + off) for off in TEMPORAL_OFFSETS], axis=0)
        return torch.from_numpy(stack), frame_number(self.frame_paths[center])


def main() -> None:
    args = parse_args()
    dataset_dir = DATASETS_DIR / args.dataset
    frames_dir = dataset_dir / "frames" / args.clip_id
    if not frames_dir.exists():
        raise SystemExit(f"Frames dir not found: {display_path(frames_dir)}")

    frame_paths = sorted(frames_dir.glob("frame_*.jpg"))
    if len(frame_paths) < 3:
        raise SystemExit(f"Not enough frames ({len(frame_paths)}) in {display_path(frames_dir)}")

    out_dir = dataset_dir / "ball-tracks" / args.model_name
    out_path = out_dir / f"{args.clip_id}.jsonl"
    if out_path.exists() and not args.overwrite:
        raise SystemExit(f"Output exists (use --overwrite): {display_path(out_path)}")
    out_dir.mkdir(parents=True, exist_ok=True)

    device = resolve_device(args.device)
    checkpoint_path = resolve_path(args.checkpoint, Path(args.checkpoint))
    model, checkpoint = load_model(checkpoint_path, device)
    config = checkpoint.get("config", {}) if isinstance(checkpoint, dict) else {}
    input_height = int(config.get("input_height", 288))
    input_width = int(config.get("input_width", 512))

    fps = resolve_fps(dataset_dir, args.clip_id, args.fps)

    centers = list(range(1, len(frame_paths) - 1, max(1, args.stride)))

    # Rally-window filtering: only infer frames inside a rally (skip dead time).
    windows = load_windows(args.windows_json)
    all_centers = len(centers)
    if windows is not None:
        pad = max(0.0, args.window_pad_sec)

        def in_window(frame_idx: int) -> bool:
            t = frame_idx / fps
            return any(start - pad <= t <= end + pad for start, end in windows)

        centers = [c for c in centers if in_window(frame_number(frame_paths[c]))]

    if args.max_frames and args.max_frames > 0:
        centers = centers[: args.max_frames]
    total = len(centers)
    batch_size = max(1, args.batch_size)
    num_workers = max(0, args.num_workers)

    dataset = CenterStackDataset(frame_paths, centers, input_height, input_width)
    loader = torch.utils.data.DataLoader(
        dataset,
        batch_size=batch_size,
        num_workers=num_workers,
        pin_memory=device.type == "cuda",
        persistent_workers=num_workers > 0,
    )

    detections = 0
    processed = 0
    tmp_path = out_path.with_suffix(".jsonl.tmp")
    with torch.no_grad(), open(tmp_path, "w", encoding="utf-8") as handle:
        for stacks, frame_idxs in loader:
            inputs = stacks.to(device, non_blocking=True)
            logits = model(inputs)
            center_heatmaps = torch.sigmoid(logits[:, 1])  # (B, H, W)
            height, width = center_heatmaps.shape[-2:]
            flat = center_heatmaps.reshape(center_heatmaps.shape[0], -1)
            confidences, flat_indices = torch.max(flat, dim=1)
            confidences = confidences.detach().cpu().tolist()
            flat_indices = flat_indices.detach().cpu().tolist()
            frame_idx_list = frame_idxs.tolist()

            for frame_idx, flat_idx, confidence in zip(frame_idx_list, flat_indices, confidences):
                y_idx, x_idx = divmod(int(flat_idx), width)
                visible = int(confidence >= args.conf_threshold)
                detections += visible
                row: dict[str, Any] = {
                    "frameIdx": int(frame_idx),
                    "timeSec": int(frame_idx) / fps,
                    "x": x_idx / width if visible else None,
                    "y": y_idx / height if visible else None,
                    "visible": visible,
                    "confidence": float(confidence),
                }
                handle.write(json.dumps(row, separators=(",", ":")) + "\n")

            processed += len(frame_idx_list)
            print(f"{args.clip_id}: {processed}/{total} frames", end="\n" if processed >= total else "\r", flush=True)

    tmp_path.replace(out_path)
    print(f"infer_trajectory {display_path(out_path)}")
    window_note = f" windows={len(windows)} ({all_centers}->{total} frames)" if windows is not None else ""
    print(
        f"clip={args.clip_id} device={device.type} frames={total} batch={batch_size} "
        f"workers={num_workers} detections={detections} fps={fps:g}{window_note}"
    )


if __name__ == "__main__":
    main()
