#!/usr/bin/env python3
"""
tracknet-gate.py - TrackNet ball-activity gate for fixed-camera-v1.

Uses public TrackNet V1-style weights to infer ball heatmaps from 3 consecutive
RGB frames. The gate measures whether ball confidence/visibility separates GT
rally frames from inter-point frames and writes jsonl ball tracks plus a gate
summary. It does not replace any run unless the gate shows real separation.

Usage:
  /usr/local/bin/python3.11 scripts/eval/tracknet-gate.py \
      --run-id iter-tracknet-gate1 --clip-id yt-maitou-suzumura-muko-clip1 \
      --max-triplets 300 --stride 30
"""

from __future__ import annotations

import argparse
import json
import math
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch
import torch.nn as nn

from _common import frame_number

BASE = Path(__file__).parent.parent.parent
DATASET_DIR = BASE / "eval/datasets/fixed-camera-v1"
LABEL_DIR = DATASET_DIR / "labels"
RESULTS_DIR = BASE / "eval/results"
TRACK_DIR = DATASET_DIR / "ball-tracks"
DEFAULT_WEIGHTS = Path("/private/tmp/tennis-eval-models/tracknet_weights.pth")
WEIGHTS_URL = "https://huggingface.co/vishnushenoy09/tracknet-v1-tennis/resolve/main/tracknet_weights.pth"
INPUT_SIZE = (640, 360)


class ConvBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int, kernel_size: int = 3, pad: int = 1, stride: int = 1, bias: bool = True):
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default="iter-tracknet-gate1")
    parser.add_argument("--clip-id", action="append", help="Clip id to process; default all labels")
    parser.add_argument("--weights", default=str(DEFAULT_WEIGHTS))
    parser.add_argument("--download-weights", action="store_true")
    parser.add_argument("--stride", type=int, default=30, help="Center-frame step in source frames")
    parser.add_argument("--max-triplets", type=int, default=600)
    parser.add_argument("--confidence-threshold", type=float, default=0.35)
    parser.add_argument("--gap-sec", type=float, default=3.0)
    parser.add_argument("--device", default="auto", choices=("auto", "cpu", "mps", "cuda"))
    parser.add_argument("--iou-debug", action="store_true")
    return parser.parse_args()


def clip_ids_from_labels(selected: list[str] | None) -> list[str]:
    wanted = set(selected or [])
    ids = []
    for path in sorted(LABEL_DIR.glob("*.json")):
        clip_id = path.stem
        if wanted and clip_id not in wanted:
            continue
        ids.append(clip_id)
    return ids


def frames_dir_for_clip(clip_id: str) -> tuple[Path, float]:
    frames30 = DATASET_DIR / "frames30" / clip_id
    if frames30.exists() and any(frames30.glob("*.jpg")):
        return frames30, 30.0
    frames = DATASET_DIR / "frames" / clip_id
    if not frames.exists():
        raise FileNotFoundError(f"No frames found for {clip_id}; run prepare-fixed-camera-assets.py first.")
    n = len(list(frames.glob("*.jpg")))
    fps = 30.0 if n > 5000 else 3.0
    return frames, fps


def load_gt(clip_id: str) -> list[dict[str, float]]:
    with open(LABEL_DIR / f"{clip_id}.json") as f:
        return json.load(f)["rallies"]


def is_rally_time(t: float, rallies: list[dict[str, float]]) -> int:
    return int(any(float(r["startSec"]) <= t <= float(r["endSec"]) for r in rallies))


def rank_auc(y_true: np.ndarray, scores: np.ndarray) -> float | None:
    y = y_true.astype(np.int32)
    n_pos = int(y.sum())
    n_neg = int(len(y) - n_pos)
    if n_pos == 0 or n_neg == 0:
        return None
    order = np.argsort(scores, kind="mergesort")
    ranks = np.empty(len(scores), dtype=np.float64)
    sorted_scores = scores[order]
    i = 0
    while i < len(scores):
        j = i + 1
        while j < len(scores) and sorted_scores[j] == sorted_scores[i]:
            j += 1
        ranks[order[i:j]] = (i + 1 + j) / 2.0
        i = j
    pos_rank_sum = float(ranks[y == 1].sum())
    return (pos_rank_sum - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)


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


def read_rgb(path: Path) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise FileNotFoundError(path)
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    return cv2.resize(img, INPUT_SIZE, interpolation=cv2.INTER_AREA)


def infer_triplet(model: BallTrackerNet, device: torch.device, paths: list[Path]) -> dict[str, float]:
    frames = [read_rgb(p).astype(np.float32) / 255.0 for p in paths]
    stacked = np.concatenate(frames, axis=2)  # H,W,9
    tensor = torch.from_numpy(stacked.transpose(2, 0, 1)).unsqueeze(0).to(device)
    with torch.no_grad():
        logits = model(tensor)
        probs = torch.softmax(logits, dim=1)
        # Expected heat value across 0..255 classes. This is robust to the
        # original TrackNet 256-class formulation.
        classes = torch.arange(256, device=device, dtype=probs.dtype).view(1, 256, 1)
        heat = (probs * classes).sum(dim=1).reshape(INPUT_SIZE[1], INPUT_SIZE[0]) / 255.0
        confidence = float(heat.max().detach().cpu())
        flat_idx = int(torch.argmax(heat).detach().cpu())
    y, x = divmod(flat_idx, INPUT_SIZE[0])
    return {"x": x / INPUT_SIZE[0], "y": y / INPUT_SIZE[1], "confidence": confidence}


def detections_to_windows(times: list[float], gap_sec: float) -> list[dict[str, float]]:
    if not times:
        return []
    times = sorted(times)
    groups: list[tuple[float, float]] = []
    start = last = times[0]
    for t in times[1:]:
        if t - last <= gap_sec:
            last = t
        else:
            groups.append((start, last))
            start = last = t
    groups.append((start, last))
    windows = []
    for start, end in groups:
        if end - start >= 2.0:
            windows.append({"startSec": max(0.0, start - 2.0), "endSec": end + 3.0, "confidence": 0.7})
    return windows


def iou(a: dict[str, float], b: dict[str, float]) -> float:
    inter = max(0.0, min(a["endSec"], b["endSec"]) - max(a["startSec"], b["startSec"]))
    if inter <= 0:
        return 0.0
    union = (a["endSec"] - a["startSec"]) + (b["endSec"] - b["startSec"]) - inter
    return inter / union if union > 0 else 0.0


def event_f1(windows: list[dict[str, float]], gt: list[dict[str, float]]) -> dict[str, float]:
    used: set[int] = set()
    tp = 0
    for rally in gt:
        best_iou, best_j = 0.5, -1
        for j, window in enumerate(windows):
            if j in used:
                continue
            score = iou(rally, window)
            if score > best_iou:
                best_iou, best_j = score, j
        if best_j >= 0:
            tp += 1
            used.add(best_j)
    fp = len(windows) - tp
    fn = len(gt) - tp
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"f1": f1, "precision": precision, "recall": recall, "tp": tp, "fp": fp, "fn": fn}


def process_clip(clip_id: str, model: BallTrackerNet, device: torch.device, args: argparse.Namespace) -> dict[str, Any]:
    frames_dir, fps = frames_dir_for_clip(clip_id)
    paths = sorted(frames_dir.glob("*.jpg"), key=frame_number)
    if len(paths) < 3:
        raise ValueError(f"Not enough frames for {clip_id}: {frames_dir}")

    centers = list(range(1, len(paths) - 1, max(1, args.stride)))
    centers = centers[: args.max_triplets]
    gt = load_gt(clip_id)
    TRACK_DIR.mkdir(parents=True, exist_ok=True)
    track_path = TRACK_DIR / f"{clip_id}.jsonl"

    rows: list[dict[str, float]] = []
    with open(track_path, "w") as f:
        for n, center in enumerate(centers, start=1):
            t = frame_number(paths[center]) / fps
            pred = infer_triplet(model, device, [paths[center - 1], paths[center], paths[center + 1]])
            row = {
                "timeSec": t,
                "x": pred["x"],
                "y": pred["y"],
                "confidence": pred["confidence"],
                "visible": float(pred["confidence"] >= args.confidence_threshold),
                "label": float(is_rally_time(t, gt)),
            }
            rows.append(row)
            f.write(json.dumps(row) + "\n")
            if n % 25 == 0:
                print(f"    {clip_id}: {n}/{len(centers)}", end="\r")
    print(f"    {clip_id}: {len(rows)}/{len(centers)}")

    y = np.array([r["label"] for r in rows], dtype=np.float64)
    conf = np.array([r["confidence"] for r in rows], dtype=np.float64)
    visible = np.array([r["visible"] for r in rows], dtype=np.float64)
    auc_conf = rank_auc(y, conf)
    auc_visible = rank_auc(y, visible)
    active_times = [r["timeSec"] for r in rows if r["visible"] >= 1.0]
    windows = detections_to_windows(active_times, args.gap_sec)
    score = event_f1(windows, gt)
    return {
        "clipId": clip_id,
        "framesDir": str(frames_dir.relative_to(BASE)),
        "fps": fps,
        "triplets": len(rows),
        "trackPath": str(track_path.relative_to(BASE)),
        "confidenceThreshold": args.confidence_threshold,
        "rallyFrameFraction": float(y.mean()) if len(y) else 0.0,
        "confidenceAuc": None if auc_conf is None else round(float(auc_conf), 6),
        "confidenceAdjustedAuc": None if auc_conf is None else round(float(max(auc_conf, 1 - auc_conf)), 6),
        "visibleAuc": None if auc_visible is None else round(float(auc_visible), 6),
        "windowOracle": {k: round(float(v), 6) if isinstance(v, float) else v for k, v in score.items()},
        "windowCount": len(windows),
    }


def main() -> None:
    args = parse_args()
    weights = Path(args.weights)
    ensure_weights(weights, args.download_weights)
    device = resolve_device(args.device)
    print(f"Run: {args.run_id}")
    print(f"Device: {device}")
    model = load_model(weights, device)

    per_clip: dict[str, Any] = {}
    for clip_id in clip_ids_from_labels(args.clip_id):
        print(f"\n-- {clip_id}")
        try:
            per_clip[clip_id] = process_clip(clip_id, model, device, args)
            s = per_clip[clip_id]
            print(
                f"  confAUC={s['confidenceAdjustedAuc']} windowF1={s['windowOracle']['f1']:.3f} "
                f"P={s['windowOracle']['precision']:.3f} R={s['windowOracle']['recall']:.3f}"
            )
        except Exception as exc:
            per_clip[clip_id] = {"clipId": clip_id, "error": str(exc)}
            print(f"  ERROR: {exc}")

    usable = [
        s for s in per_clip.values()
        if "error" not in s and s.get("confidenceAdjustedAuc") is not None and s["confidenceAdjustedAuc"] >= 0.65
    ]
    verdict = {
        "passed": any(s["windowOracle"]["f1"] >= 0.1 for s in usable),
        "reason": "TrackNet confidence has separability in at least one processed clip" if usable else "No processed clip reached adjusted AUC >= 0.65",
    }

    run_dir = RESULTS_DIR / args.run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "runId": args.run_id,
        "dataset": "fixed-camera-v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "config": {
            "model": "TrackNet V1 gate",
            "weights": str(weights),
            "weightsUrl": WEIGHTS_URL,
            "stride": args.stride,
            "maxTriplets": args.max_triplets,
            "confidenceThreshold": args.confidence_threshold,
            "gapSec": args.gap_sec,
        },
        "perClip": per_clip,
        "verdict": verdict,
    }
    with open(run_dir / "tracknet-gate.json", "w") as f:
        json.dump(payload, f, indent=2)
    with open(run_dir / "manifest.json", "w") as f:
        json.dump({"runId": args.run_id, "dataset": "fixed-camera-v1", "createdAt": payload["createdAt"], "config": payload["config"]}, f, indent=2)
    print(f"\nWrote {run_dir / 'tracknet-gate.json'}")
    print(f"Verdict: {'PASS' if verdict['passed'] else 'FAIL'} - {verdict['reason']}")


if __name__ == "__main__":
    main()
