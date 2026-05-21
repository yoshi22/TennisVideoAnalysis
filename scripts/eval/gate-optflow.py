#!/usr/bin/env python3
"""
gate-optflow.py - Optical-flow separability gate for fixed-camera-v1.

Computes Farneback flow on 320x180 grayscale frames and reports per-feature
ROC-AUC against rally GT labels. This is a gate only: if clip1 best adjusted
AUC is <= 0.65, do not build a full opt-flow classifier.

Usage:
  /usr/local/bin/python3.11 scripts/eval/gate-optflow.py \
      [--run-id iter-optflow-gate] [--iou-debug]

Writes:
  eval/results/<run-id>/gate-optflow.json
  eval/results/<run-id>/manifest.json
"""

from __future__ import annotations

import argparse
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np

BASE = Path(__file__).parent.parent.parent
FRAMES_DIR = BASE / "eval/datasets/fixed-camera-v1/frames"
LABEL_DIR = BASE / "eval/datasets/fixed-camera-v1/labels"

CLIP_CONFIGS: dict[str, dict[str, Any]] = {
    "yt-maitou-suzumura-muko-clip1": {"fps": 30.0, "stride": 6, "scan_fps": 5.0},
    "yt-maitou-suzumura-muko-clip2": {"fps": 3.0, "stride": 1, "scan_fps": 3.0},
    "yt-maitou-suzumura-fukui-clip1": {"fps": 3.0, "stride": 1, "scan_fps": 3.0},
}

FEATURES = ("mean", "p90", "top", "bottom", "minTB", "maxTB")
GATE_CLIP_ID = "yt-maitou-suzumura-muko-clip1"
GATE_AUC_THRESHOLD = 0.65
FLOW_SIZE = (320, 180)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default="iter-optflow-gate")
    parser.add_argument("--iou-debug", action="store_true", help="Print top frame samples per feature")
    return parser.parse_args()


def frame_number(path: Path) -> int:
    match = re.search(r"(\d+)", path.name)
    return int(match.group(1)) if match else 0


def load_frame_paths(clip_id: str) -> list[tuple[float, Path]]:
    cfg = CLIP_CONFIGS[clip_id]
    fps = float(cfg["fps"])
    stride = int(cfg["stride"])
    frames_dir = FRAMES_DIR / clip_id
    paths = sorted(frames_dir.glob("*.jpg"), key=frame_number)
    selected: list[tuple[float, Path]] = []
    for i, path in enumerate(paths):
        if i % stride != 0:
            continue
        selected.append((frame_number(path) / fps, path))
    return selected


def load_gt(clip_id: str) -> list[dict[str, float]]:
    with open(LABEL_DIR / f"{clip_id}.json") as f:
        return json.load(f)["rallies"]


def is_rally_time(t: float, rallies: list[dict[str, float]]) -> int:
    for rally in rallies:
        if float(rally["startSec"]) <= t <= float(rally["endSec"]):
            return 1
    return 0


def read_flow_gray(path: Path) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise FileNotFoundError(path)
    return cv2.resize(img, FLOW_SIZE, interpolation=cv2.INTER_AREA)


def extract_flow_rows(clip_id: str) -> list[dict[str, float]]:
    frames = load_frame_paths(clip_id)
    if len(frames) < 2:
        return []

    rallies = load_gt(clip_id)
    rows: list[dict[str, float]] = []

    prev_t, prev_path = frames[0]
    prev_gray = read_flow_gray(prev_path)

    for curr_t, curr_path in frames[1:]:
        curr_gray = read_flow_gray(curr_path)
        flow = cv2.calcOpticalFlowFarneback(
            prev_gray,
            curr_gray,
            None,
            pyr_scale=0.5,
            levels=3,
            winsize=15,
            iterations=3,
            poly_n=5,
            poly_sigma=1.2,
            flags=0,
        )
        mag = cv2.magnitude(flow[:, :, 0], flow[:, :, 1])
        mid = mag.shape[0] // 2
        top = float(np.mean(mag[:mid, :]))
        bottom = float(np.mean(mag[mid:, :]))
        sample_t = (prev_t + curr_t) / 2.0

        rows.append(
            {
                "timeSec": sample_t,
                "label": float(is_rally_time(sample_t, rallies)),
                "mean": float(np.mean(mag)),
                "p90": float(np.percentile(mag, 90)),
                "top": top,
                "bottom": bottom,
                "minTB": min(top, bottom),
                "maxTB": max(top, bottom),
            }
        )

        prev_t, prev_gray = curr_t, curr_gray

    return rows


def rank_auc(y_true: np.ndarray, scores: np.ndarray) -> float | None:
    """Mann-Whitney/rank ROC-AUC with average ranks for ties."""
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
        avg_rank = (i + 1 + j) / 2.0
        ranks[order[i:j]] = avg_rank
        i = j

    pos_rank_sum = float(ranks[y == 1].sum())
    return (pos_rank_sum - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)


def summarize_clip(clip_id: str, rows: list[dict[str, float]]) -> dict[str, Any]:
    labels = np.array([r["label"] for r in rows], dtype=np.float64)
    feature_rows: list[dict[str, Any]] = []

    for feature in FEATURES:
        values = np.array([r[feature] for r in rows], dtype=np.float64)
        auc = rank_auc(labels, values)
        if auc is None or math.isnan(auc):
            continue
        mean_rally = float(values[labels == 1].mean()) if np.any(labels == 1) else 0.0
        mean_inter = float(values[labels == 0].mean()) if np.any(labels == 0) else 0.0
        feature_rows.append(
            {
                "feature": feature,
                "auc": round(float(auc), 6),
                "adjustedAuc": round(float(max(auc, 1.0 - auc)), 6),
                "direction": "positive" if auc >= 0.5 else "negative",
                "meanRally": round(mean_rally, 6),
                "meanInter": round(mean_inter, 6),
            }
        )

    feature_rows.sort(key=lambda r: r["adjustedAuc"], reverse=True)
    best = feature_rows[0] if feature_rows else None
    return {
        "clipId": clip_id,
        "frames": len(rows),
        "rallyFrameFraction": round(float(labels.mean()), 6) if len(labels) else 0.0,
        "best": best,
        "features": feature_rows,
    }


def main() -> None:
    args = parse_args()
    run_dir = BASE / "eval/results" / args.run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    print(f"Run: {args.run_id}")
    per_clip: dict[str, Any] = {}
    for clip_id, cfg in CLIP_CONFIGS.items():
        print(f"\n-- {clip_id}  fps={cfg['fps']} stride={cfg['stride']} scan_fps={cfg['scan_fps']}")
        rows = extract_flow_rows(clip_id)
        summary = summarize_clip(clip_id, rows)
        per_clip[clip_id] = summary

        print(f"  flow rows={summary['frames']}  rally_frac={summary['rallyFrameFraction']:.3f}")
        for row in summary["features"]:
            print(
                f"  {row['feature']:6s} adjAUC={row['adjustedAuc']:.3f} "
                f"raw={row['auc']:.3f} dir={row['direction']:<8s} "
                f"rally={row['meanRally']:.4f} inter={row['meanInter']:.4f}"
            )

        if args.iou_debug and rows and summary["best"]:
            feature = summary["best"]["feature"]
            top = sorted(rows, key=lambda r: r[feature], reverse=True)[:8]
            print(f"  top {feature} samples: {[round(r['timeSec'], 1) for r in top]}")

    gate_auc = float(per_clip[GATE_CLIP_ID]["best"]["adjustedAuc"])
    passed = gate_auc > GATE_AUC_THRESHOLD
    verdict = {
        "gateClipId": GATE_CLIP_ID,
        "threshold": GATE_AUC_THRESHOLD,
        "clip1BestAdjustedAuc": round(gate_auc, 6),
        "passed": passed,
        "nextStep": "implement optflow-classify.py" if passed else "reject optflow; proceed to score-blob-anchor.py",
    }

    payload = {
        "runId": args.run_id,
        "dataset": "fixed-camera-v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "config": {
            "flow": "Farneback",
            "frameSize": {"width": FLOW_SIZE[0], "height": FLOW_SIZE[1]},
            "clipConfigs": CLIP_CONFIGS,
            "features": list(FEATURES),
        },
        "perClip": per_clip,
        "verdict": verdict,
    }
    with open(run_dir / "gate-optflow.json", "w") as f:
        json.dump(payload, f, indent=2)
    with open(run_dir / "manifest.json", "w") as f:
        json.dump(
            {
                "runId": args.run_id,
                "dataset": "fixed-camera-v1",
                "createdAt": payload["createdAt"],
                "config": {
                    "model": "optflow-gate",
                    "gateClipId": GATE_CLIP_ID,
                    "gateAucThreshold": GATE_AUC_THRESHOLD,
                },
            },
            f,
            indent=2,
        )

    print("\nGate verdict")
    print(f"  clip1 best adjusted AUC: {gate_auc:.3f}")
    print(f"  threshold: {GATE_AUC_THRESHOLD:.3f}")
    print(f"  {'PASS' if passed else 'FAIL'} - {verdict['nextStep']}")
    print(f"\nWrote {run_dir / 'gate-optflow.json'}")


if __name__ == "__main__":
    main()
