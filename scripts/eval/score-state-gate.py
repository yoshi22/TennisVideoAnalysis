#!/usr/bin/env python3
"""
score-state-gate.py - Scoreboard ROI state-change gate for fixed-camera-v1.

This gate uses fixed score ROIs and compact image-state vectors to detect
scoreboard state changes. It is meant to decide whether a stronger OCR/template
state signal can replace the existing yellow-delta END anchors.

Usage:
  /usr/local/bin/python3.11 scripts/eval/score-state-gate.py --run-id iter-score-state-gate1
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from _common import frame_number

BASE = Path(__file__).parent.parent.parent
FRAMES_DIR = BASE / "eval/datasets/fixed-camera-v1/frames"
LABEL_DIR = BASE / "eval/datasets/fixed-camera-v1/labels"
RESULTS_DIR = BASE / "eval/results"

CLIP_CONFIGS: dict[str, dict[str, Any]] = {
    "yt-maitou-suzumura-muko-clip1": {"fps": 30.0, "stride": 6, "roi": (0, 200, 150, 950), "mode": "gray"},
    "yt-maitou-suzumura-muko-clip2": {"fps": 3.0, "stride": 1, "roi": (55, 165, 175, 255), "mode": "yellow"},
    "yt-maitou-suzumura-fukui-clip1": {"fps": 3.0, "stride": 1, "roi": (55, 165, 175, 255), "mode": "gray"},
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default="iter-score-state-gate1")
    parser.add_argument("--threshold", type=float, default=None)
    parser.add_argument("--min-interval-sec", type=float, default=6.0)
    return parser.parse_args()


def load_gt(clip_id: str) -> list[dict[str, float]]:
    with open(LABEL_DIR / f"{clip_id}.json") as f:
        return json.load(f)["rallies"]


def load_frame_paths(clip_id: str) -> list[tuple[float, Path]]:
    cfg = CLIP_CONFIGS[clip_id]
    paths = sorted((FRAMES_DIR / clip_id).glob("*.jpg"), key=frame_number)
    out = []
    for i, path in enumerate(paths):
        if i % int(cfg["stride"]) == 0:
            out.append((frame_number(path) / float(cfg["fps"]), path))
    return out


def roi_vector(path: Path, cfg: dict[str, Any]) -> np.ndarray:
    y1, y2, x1, x2 = cfg["roi"]
    img = cv2.imread(str(path))
    if img is None:
        raise FileNotFoundError(path)
    patch = img[y1:y2, x1:x2]
    if cfg["mode"] == "yellow":
        hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
        mask = (
            (hsv[:, :, 0] >= 15)
            & (hsv[:, :, 0] <= 35)
            & (hsv[:, :, 1] > 100)
            & (hsv[:, :, 2] > 120)
        ).astype(np.float32)
        small = cv2.resize(mask, (32, 16), interpolation=cv2.INTER_AREA)
    else:
        gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
        small = cv2.resize(gray, (48, 16), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
        small = small - float(small.mean())
    return small.flatten().astype(np.float32)


def extract_state_signal(clip_id: str) -> tuple[np.ndarray, np.ndarray]:
    cfg = CLIP_CONFIGS[clip_id]
    frames = load_frame_paths(clip_id)
    times: list[float] = []
    diffs: list[float] = []
    prev: np.ndarray | None = None
    for t, path in frames:
        vec = roi_vector(path, cfg)
        if prev is None:
            diff = 0.0
        else:
            diff = float(np.mean(np.abs(vec - prev)))
        prev = vec
        times.append(t)
        diffs.append(diff)
    return np.array(times, dtype=np.float64), np.array(diffs, dtype=np.float64)


def detect_events(times: np.ndarray, signal: np.ndarray, threshold: float, min_interval_sec: float) -> list[float]:
    events: list[float] = []
    last = -999.0
    for t, value in zip(times, signal):
        if value >= threshold and t - last >= min_interval_sec:
            events.append(float(t))
            last = float(t)
    return events


def event_alignment(events: list[float], gt: list[dict[str, float]], tolerance: float = 8.0) -> dict[str, Any]:
    gt_ends = [float(r["endSec"]) for r in gt]
    used: set[int] = set()
    matched = 0
    errors: list[float] = []
    for event in events:
        best_i, best_err = -1, tolerance
        for i, end in enumerate(gt_ends):
            if i in used:
                continue
            err = abs(event - end)
            if err <= best_err:
                best_i, best_err = i, err
        if best_i >= 0:
            matched += 1
            used.add(best_i)
            errors.append(best_err)
    fp = len(events) - matched
    fn = len(gt_ends) - matched
    precision = matched / (matched + fp) if matched + fp else 0.0
    recall = matched / (matched + fn) if matched + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "eventF1At8Sec": round(f1, 6),
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "matched": matched,
        "fp": fp,
        "fn": fn,
        "maeSec": round(float(np.mean(errors)), 3) if errors else None,
    }


def percentile_thresholds(signal: np.ndarray) -> list[float]:
    return sorted(set(float(np.percentile(signal, p)) for p in (90, 92, 94, 96, 98, 99)))


def process_clip(clip_id: str, args: argparse.Namespace) -> dict[str, Any]:
    times, signal = extract_state_signal(clip_id)
    gt = load_gt(clip_id)
    candidates = [args.threshold] if args.threshold is not None else percentile_thresholds(signal)
    best: dict[str, Any] | None = None
    rows = []
    for threshold in candidates:
        events = detect_events(times, signal, threshold, args.min_interval_sec)
        score = event_alignment(events, gt)
        row = {"threshold": round(float(threshold), 6), "events": [round(e, 3) for e in events], "score": score}
        rows.append(row)
        if best is None or score["eventF1At8Sec"] > best["score"]["eventF1At8Sec"]:
            best = row
    return {
        "clipId": clip_id,
        "frames": len(times),
        "mode": CLIP_CONFIGS[clip_id]["mode"],
        "best": best,
        "candidates": rows,
    }


def main() -> None:
    args = parse_args()
    print(f"Run: {args.run_id}")
    per_clip = {}
    for clip_id in CLIP_CONFIGS:
        print(f"\n-- {clip_id}")
        summary = process_clip(clip_id, args)
        per_clip[clip_id] = summary
        best = summary["best"]
        print(
            f"  best threshold={best['threshold']} eventF1={best['score']['eventF1At8Sec']:.3f} "
            f"P={best['score']['precision']:.3f} R={best['score']['recall']:.3f} events={len(best['events'])}"
        )
    verdict = {
        "passed": any(s["best"]["score"]["eventF1At8Sec"] >= 0.65 for s in per_clip.values()),
        "reason": "At least one clip has score-state event F1 >= 0.65" if any(s["best"]["score"]["eventF1At8Sec"] >= 0.65 for s in per_clip.values()) else "No clip reached score-state event F1 >= 0.65",
    }
    run_dir = RESULTS_DIR / args.run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "runId": args.run_id,
        "dataset": "fixed-camera-v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "config": {"model": "score-state-gate", "minIntervalSec": args.min_interval_sec},
        "perClip": per_clip,
        "verdict": verdict,
    }
    with open(run_dir / "score-state-gate.json", "w") as f:
        json.dump(payload, f, indent=2)
    with open(run_dir / "manifest.json", "w") as f:
        json.dump({"runId": args.run_id, "dataset": "fixed-camera-v1", "createdAt": payload["createdAt"], "config": payload["config"]}, f, indent=2)
    print(f"\nVerdict: {'PASS' if verdict['passed'] else 'FAIL'} - {verdict['reason']}")
    print(f"Wrote {run_dir / 'score-state-gate.json'}")


if __name__ == "__main__":
    main()
