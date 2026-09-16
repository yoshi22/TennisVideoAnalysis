#!/usr/bin/env python3.11
"""Positioning-error evaluation for TrackNetV4 ball heatmaps."""

from __future__ import annotations

import argparse
import json
import statistics
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
    from dataset import TrackNetV4BallDataset  # type: ignore
    from model import TrackNetV4, count_parameters  # type: ignore
else:
    from .dataset import TrackNetV4BallDataset
    from .model import TrackNetV4, count_parameters

BASE = Path(__file__).resolve().parents[3]
DEFAULT_CHECKPOINT = "eval/results/tracknet-v4-modal/latest.pt"
DEFAULT_OUTPUT_DIR = "eval/results/tracknet-v4-modal/pe-eval"
DEFAULT_HELDOUT_CLIP = "yt-gr4ves-ntp4-clip1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate TrackNetV4 center positioning error.")
    parser.add_argument("--dataset", default="fixed-camera-v2")
    parser.add_argument("--clip-id", default=DEFAULT_HELDOUT_CLIP)
    parser.add_argument("--checkpoint", default=DEFAULT_CHECKPOINT)
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--device", default="auto", choices=("auto", "mps", "cuda", "cpu"))
    parser.add_argument("--heatmap-threshold", type=float, default=0.5)
    parser.add_argument("--overlay-n", type=int, default=8)
    parser.add_argument("--source-width", type=int, default=1280)
    parser.add_argument("--source-height", type=int, default=720)
    return parser.parse_args()


def resolve_device(requested: str) -> torch.device:
    if requested == "auto":
        if torch.backends.mps.is_available():
            return torch.device("mps")
        if torch.cuda.is_available():
            return torch.device("cuda")
        return torch.device("cpu")
    if requested == "mps" and not torch.backends.mps.is_available():
        return torch.device("cpu")
    if requested == "cuda" and not torch.cuda.is_available():
        return torch.device("cpu")
    return torch.device(requested)


def state_dict_from_checkpoint(payload: Any) -> dict[str, torch.Tensor]:
    if isinstance(payload, dict):
        for key in ("model", "state_dict", "model_state_dict"):
            value = payload.get(key)
            if isinstance(value, dict):
                return normalize_state_dict(value)
        if payload and all(torch.is_tensor(value) for value in payload.values()):
            return normalize_state_dict(payload)
    raise ValueError("Unsupported checkpoint format; expected key 'model' or a state_dict-like dict")


def normalize_state_dict(state: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    normalized: dict[str, torch.Tensor] = {}
    for key, value in state.items():
        clean_key = key
        for prefix in ("module.", "model."):
            if clean_key.startswith(prefix):
                clean_key = clean_key[len(prefix) :]
        normalized[clean_key] = value
    return normalized


def load_model(checkpoint_path: Path, device: torch.device) -> tuple[TrackNetV4, dict[str, Any]]:
    payload = torch.load(checkpoint_path, map_location="cpu")
    state = state_dict_from_checkpoint(payload)
    model = TrackNetV4()
    model.load_state_dict(state, strict=True)
    model.to(device)
    model.eval()
    meta = payload if isinstance(payload, dict) else {}
    return model, meta


def heatmap_argmax_to_source_xy(
    heatmap: torch.Tensor,
    source_width: int,
    source_height: int,
) -> tuple[float, float, float]:
    height, width = heatmap.shape[-2:]
    flat_idx = int(torch.argmax(heatmap).detach().cpu())
    y_idx, x_idx = divmod(flat_idx, width)
    confidence = float(heatmap.reshape(-1)[flat_idx].detach().cpu())
    return x_idx / width * source_width, y_idx / height * source_height, confidence


def overlay_indices(total: int, overlay_n: int) -> set[int]:
    if total <= 0 or overlay_n <= 0:
        return set()
    if total <= overlay_n:
        return set(range(total))
    return {int(round(i)) for i in np.linspace(0, total - 1, overlay_n)}


def draw_overlay(
    frame_path: Path,
    out_path: Path,
    gt_xy: tuple[float, float],
    pred_xy: tuple[float, float],
    distance_px: float,
    confidence: float,
) -> bool:
    image = cv2.imread(str(frame_path), cv2.IMREAD_COLOR)
    if image is None:
        return False
    gx, gy = gt_xy
    px, py = pred_xy
    cv2.circle(image, (int(round(gx)), int(round(gy))), 10, (0, 220, 0), 2, cv2.LINE_AA)
    cv2.circle(image, (int(round(px)), int(round(py))), 10, (0, 0, 255), 2, cv2.LINE_AA)
    cv2.line(
        image,
        (int(round(gx)), int(round(gy))),
        (int(round(px)), int(round(py))),
        (255, 255, 255),
        1,
        cv2.LINE_AA,
    )
    cv2.putText(
        image,
        f"d={distance_px:.1f}px p={confidence:.2f}",
        (max(0, int(round(px)) + 14), max(24, int(round(py)))),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (0, 0, 255),
        2,
        cv2.LINE_AA,
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    return bool(cv2.imwrite(str(out_path), image))


def main() -> None:
    args = parse_args()
    checkpoint_path = resolve_path(args.checkpoint, Path(args.checkpoint))
    output_dir = resolve_path(args.output_dir, Path(args.output_dir))
    output_dir.mkdir(parents=True, exist_ok=True)

    device = resolve_device(args.device)
    model, checkpoint = load_model(checkpoint_path, device)
    config = checkpoint.get("config", {}) if isinstance(checkpoint, dict) else {}
    input_height = int(config.get("input_height", 288))
    input_width = int(config.get("input_width", 512))

    dataset = TrackNetV4BallDataset(
        args.dataset,
        clip_ids=[args.clip_id],
        input_size=(input_height, input_width),
        output_size=(input_height, input_width),
    )
    draw_set = overlay_indices(len(dataset), args.overlay_n)
    frame_dir = BASE / "eval" / "datasets" / args.dataset / "frames" / args.clip_id

    rows: list[dict[str, Any]] = []
    distances: list[float] = []
    detections = 0
    overlays = 0

    with torch.no_grad():
        for index in range(len(dataset)):
            sample = dataset[index]
            label = dataset.samples[index]
            if not label.visible or label.x is None or label.y is None:
                continue

            inputs = sample["input"].unsqueeze(0).to(device)
            logits = model(inputs)
            center_heatmap = torch.sigmoid(logits[0, 1])
            pred_x, pred_y, confidence = heatmap_argmax_to_source_xy(
                center_heatmap,
                args.source_width,
                args.source_height,
            )
            gt_x = label.x * args.source_width
            gt_y = label.y * args.source_height
            distance = float(np.hypot(pred_x - gt_x, pred_y - gt_y))
            detected = confidence >= args.heatmap_threshold
            detections += int(detected)
            distances.append(distance)

            rows.append(
                {
                    "clipId": args.clip_id,
                    "frameIdx": label.frame_idx,
                    "timeSec": label.time_sec,
                    "gt": [round(gt_x, 2), round(gt_y, 2)],
                    "pred": [round(pred_x, 2), round(pred_y, 2)],
                    "confidence": round(confidence, 6),
                    "detected": detected,
                    "distancePx": round(distance, 3),
                }
            )

            if index in draw_set:
                frame_path = frame_dir / f"frame_{label.frame_idx:06d}.jpg"
                out_path = output_dir / f"{args.clip_id}_frame_{label.frame_idx:06d}.jpg"
                if draw_overlay(frame_path, out_path, (gt_x, gt_y), (pred_x, pred_y), distance, confidence):
                    overlays += 1

    n = len(distances)
    detection_rate = detections / n if n else 0.0
    within = {threshold: sum(1 for value in distances if value <= threshold) for threshold in (5, 10, 20, 40)}
    metrics = {
        "checkpoint": display_path(checkpoint_path),
        "dataset": args.dataset,
        "clip_id": args.clip_id,
        "samples": n,
        "device": device.type,
        "param_count": count_parameters(model),
        "heatmap_threshold": args.heatmap_threshold,
        "detection_rate": detection_rate,
        "detected": detections,
        "within_px": {str(key): (within[key] / n if n else 0.0) for key in within},
        "median_px": statistics.median(distances) if distances else None,
        "mean_px": statistics.mean(distances) if distances else None,
        "overlays": overlays,
        "caveat": "GT is TrackNet-teacher-derived, so this is a consistency check, not an independent benchmark.",
        "rows": rows,
    }

    with open(output_dir / "pe_results.json", "w", encoding="utf-8") as handle:
        json.dump(metrics, handle, indent=2)

    print("TrackNetV4 PE eval")
    print(metrics["caveat"])
    print(f"checkpoint={display_path(checkpoint_path)}")
    print(f"clip={args.clip_id} samples={n} device={device.type} params={count_parameters(model):,}")
    print(f"detection_rate={detections}/{n}={detection_rate:.1%} threshold={args.heatmap_threshold}")
    for threshold in (5, 10, 20, 40):
        pct = within[threshold] / n if n else 0.0
        print(f"within_{threshold}px={within[threshold]}/{n}={pct:.1%}")
    if distances:
        print(f"median_px={statistics.median(distances):.2f} mean_px={statistics.mean(distances):.2f}")
    print(f"overlays={overlays} output={display_path(output_dir)}")


if __name__ == "__main__":
    main()
