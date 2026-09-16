#!/usr/bin/env python3
"""
score-blob-anchor.py - clip2 score-anchor + blob-start hybrid.

For muko clip2, detect score-overlay changes as END anchors, then scan backward
through blob activity to estimate START. Clip1 and fukui are copied from the
best fixed-camera-v1 baseline to avoid regression while testing this signal.

Default config reproduces the accepted clip2 score-anchor baseline:
  blob_threshold=14, lookback_sec=30, group_gap_sec=5, end_tail_sec=0,
  start_pad_sec=2, group_mode=latest

Additional score-event fallback flags can reproduce later hybrid runs:
  --fallback-short-interval-sec 40 --fallback-lead-sec 8 --fallback-tail-sec 7
  --fukui-score-state-run-id iter-score-state-gate1

Usage:
  /usr/local/bin/python3.11 scripts/eval/score-blob-anchor.py \
      --run-id iter-score-blob-anchor1 --iou-debug
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from _common import frame_number

BASE = Path(__file__).parent.parent.parent
DATASET = "fixed-camera-v1"
FRAMES_DIR = BASE / "eval/datasets/fixed-camera-v1/frames"
LABEL_DIR = BASE / "eval/datasets/fixed-camera-v1/labels"
BASELINE_RUN_ID = "iter-fc6-3clip"
CLIP2_ID = "yt-maitou-suzumura-muko-clip2"
FUKUI_ID = "yt-maitou-suzumura-fukui-clip1"
PASSTHROUGH_CLIPS = ("yt-maitou-suzumura-muko-clip1", FUKUI_ID)

SCORE_ROI = (55, 165, 175, 255)  # y1, y2, x1, x2 in source frame coordinates
HSV_H_LO, HSV_H_HI = 15, 35
HSV_S_MIN = 120
HSV_V_MIN = 150
YELLOW_NEG_DELTA_THRESH = 80
SCORE_MIN_INTERVAL_SEC = 6.0

TARGET_SIZE = (320, 180)
DIFF_THRESHOLD = 25
LARGE_REGION_MIN_AREA = 200
DILATE_RADIUS = 5
MIN_BLOB_AREA = 3
MAX_BLOB_AREA = 80
MIN_ASPECT = 0.4
MAX_ASPECT = 2.5
MIN_CIRCULARITY = 0.35


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default="iter-score-blob-anchor1")
    parser.add_argument("--baseline-run-id", default=BASELINE_RUN_ID)
    parser.add_argument("--blob-threshold", type=int, default=14)
    parser.add_argument("--lookback-sec", type=float, default=30.0)
    parser.add_argument("--group-gap-sec", type=float, default=5.0)
    parser.add_argument("--end-tail-sec", type=float, default=0.0)
    parser.add_argument("--start-pad-sec", type=float, default=2.0)
    parser.add_argument("--group-mode", choices=("latest", "longest"), default="latest")
    parser.add_argument("--min-duration-sec", type=float, default=4.0)
    parser.add_argument("--max-duration-sec", type=float, default=80.0)
    parser.add_argument("--fallback-short-interval-sec", type=float, default=0.0,
                        help="Enable score-interval fallback when event interval is <= this many seconds")
    parser.add_argument("--fallback-lead-sec", type=float, default=8.0)
    parser.add_argument("--fallback-tail-sec", type=float, default=0.0)
    parser.add_argument("--fallback-max-existing-iou", type=float, default=0.2)
    parser.add_argument("--fukui-score-state-run-id", default="",
                        help="If set, add score-state fallback windows for fukui from this gate run")
    parser.add_argument("--fukui-fallback-lead-sec", type=float, default=8.0)
    parser.add_argument("--fukui-fallback-tail-sec", type=float, default=8.0)
    parser.add_argument("--fukui-fallback-max-existing-iou", type=float, default=0.2)
    parser.add_argument("--iou-debug", action="store_true")
    return parser.parse_args()


def clip_frame_paths(clip_id: str) -> list[Path]:
    return sorted((FRAMES_DIR / clip_id).glob("*.jpg"), key=frame_number)


def count_yellow(patch: np.ndarray) -> int:
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
    mask = (
        (hsv[:, :, 0] >= HSV_H_LO)
        & (hsv[:, :, 0] <= HSV_H_HI)
        & (hsv[:, :, 1] > HSV_S_MIN)
        & (hsv[:, :, 2] > HSV_V_MIN)
    )
    return int(mask.sum())


def detect_score_events(clip_id: str, fps: float = 3.0) -> list[float]:
    y1, y2, x1, x2 = SCORE_ROI
    events: list[float] = []
    last_event = -999.0
    prev_yellow: int | None = None

    for path in clip_frame_paths(clip_id):
        img = cv2.imread(str(path))
        if img is None:
            continue
        t = frame_number(path) / fps
        yellow = count_yellow(img[y1:y2, x1:x2])
        if prev_yellow is not None:
            delta = yellow - prev_yellow
            if delta < -YELLOW_NEG_DELTA_THRESH and t - last_event >= SCORE_MIN_INTERVAL_SEC:
                events.append(float(t))
                last_event = float(t)
        prev_yellow = yellow

    return events


def read_gray_320(path: Path) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise FileNotFoundError(path)
    return cv2.resize(img, TARGET_SIZE, interpolation=cv2.INTER_NEAREST)


def remove_large_regions(mask: np.ndarray) -> np.ndarray:
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 4)
    large = np.zeros(mask.shape, dtype=np.uint8)
    for label in range(1, n_labels):
        if int(stats[label, cv2.CC_STAT_AREA]) > LARGE_REGION_MIN_AREA:
            large[labels == label] = 1

    if np.any(large):
        kernel = np.ones((DILATE_RADIUS * 2 + 1, DILATE_RADIUS * 2 + 1), dtype=np.uint8)
        large = cv2.dilate(large, kernel, iterations=1)

    cleaned = mask.copy().astype(np.uint8)
    cleaned[large > 0] = 0
    return cleaned


def count_blobs(mask: np.ndarray) -> int:
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 4)
    count = 0
    for label in range(1, n_labels):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < MIN_BLOB_AREA or area > MAX_BLOB_AREA:
            continue

        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])
        aspect = max(w, h) / max(1, min(w, h))
        if aspect < MIN_ASPECT or aspect > MAX_ASPECT:
            continue

        component = labels == label
        eroded = cv2.erode(component.astype(np.uint8), np.ones((3, 3), dtype=np.uint8), iterations=1)
        perimeter = int(component.sum() - eroded.sum())
        circularity = (4.0 * math.pi * area) / (perimeter * perimeter) if perimeter > 0 else 0.0
        if circularity < MIN_CIRCULARITY:
            continue
        count += 1
    return count


def compute_blob_series(clip_id: str, fps: float = 3.0) -> list[dict[str, float]]:
    paths = clip_frame_paths(clip_id)
    if len(paths) < 3:
        return []

    rows: list[dict[str, float]] = []
    prev = read_gray_320(paths[0])
    curr = read_gray_320(paths[1])

    for i in range(1, len(paths) - 1):
        next_gray = read_gray_320(paths[i + 1])
        raw = ((np.abs(curr.astype(np.int16) - prev.astype(np.int16)) > DIFF_THRESHOLD) &
               (np.abs(next_gray.astype(np.int16) - curr.astype(np.int16)) > DIFF_THRESHOLD)).astype(np.uint8)
        cleaned = remove_large_regions(raw)
        rows.append(
            {
                "timeSec": frame_number(paths[i]) / fps,
                "blobCount": float(count_blobs(cleaned)),
            }
        )
        prev, curr = curr, next_gray
    return rows


def group_active_rows(rows: list[dict[str, float]], group_gap_sec: float) -> list[tuple[int, int]]:
    if not rows:
        return []

    groups: list[tuple[int, int]] = []
    start = 0
    last = 0
    for i in range(1, len(rows)):
        if rows[i]["timeSec"] - rows[last]["timeSec"] <= group_gap_sec:
            last = i
        else:
            groups.append((start, last))
            start = i
            last = i
    groups.append((start, last))
    return groups


def build_anchor_windows(events: list[float], blob_rows: list[dict[str, float]], args: argparse.Namespace) -> list[dict[str, float]]:
    windows: list[dict[str, float]] = []

    for event_t in events:
        active = [
            row
            for row in blob_rows
            if event_t - args.lookback_sec <= row["timeSec"] <= event_t
            and row["blobCount"] >= args.blob_threshold
        ]
        groups = group_active_rows(active, args.group_gap_sec)
        if not groups:
            continue

        if args.group_mode == "longest":
            group = max(groups, key=lambda g: active[g[1]]["timeSec"] - active[g[0]]["timeSec"])
        else:
            group = groups[-1]

        start = max(0.0, active[group[0]]["timeSec"] - args.start_pad_sec)
        end = event_t + args.end_tail_sec
        duration = end - start
        if args.min_duration_sec <= duration <= args.max_duration_sec:
            windows.append(
                {
                    "startSec": round(float(start), 2),
                    "endSec": round(float(end), 2),
                    "confidence": 0.9,
                }
            )

    return windows


def load_gt(clip_id: str) -> list[dict[str, float]]:
    with open(LABEL_DIR / f"{clip_id}.json") as f:
        return json.load(f)["rallies"]


def iou(a: dict[str, float], b: dict[str, float]) -> float:
    inter = max(0.0, min(a["endSec"], b["endSec"]) - max(a["startSec"], b["startSec"]))
    if inter <= 0:
        return 0.0
    union = (a["endSec"] - a["startSec"]) + (b["endSec"] - b["startSec"]) - inter
    return inter / union if union > 0 else 0.0


def add_score_interval_fallbacks(events: list[float], windows: list[dict[str, float]], args: argparse.Namespace) -> list[dict[str, float]]:
    """
    Optional GT-free recovery for short score intervals.

    This only uses score event timing: if consecutive score events are close and
    no anchor window already covers the current event, add a low-confidence
    fallback ending at the score event. It is off by default because the current
    best did not benefit from a naive fallback, but keeping it as a gated option
    makes future recovery experiments reproducible.
    """
    if args.fallback_short_interval_sec <= 0:
        return windows

    result = list(windows)
    previous_events = [0.0] + events[:-1]
    for prev_t, event_t in zip(previous_events, events):
        if event_t - prev_t > args.fallback_short_interval_sec:
            continue
        fallback = {
            "startSec": round(max(0.0, event_t - args.fallback_lead_sec), 2),
            "endSec": round(event_t + args.fallback_tail_sec, 2),
            "confidence": 0.55,
        }
        if fallback["endSec"] - fallback["startSec"] < args.min_duration_sec:
            continue
        max_existing_iou = max([iou(fallback, window) for window in result] or [0.0])
        if max_existing_iou <= args.fallback_max_existing_iou:
            result.append(fallback)
    result.sort(key=lambda w: (w["startSec"], w["endSec"]))
    return result


def add_event_fallback_windows(
    events: list[float],
    windows: list[dict[str, float]],
    lead_sec: float,
    tail_sec: float,
    max_existing_iou: float,
    clip_duration: float,
) -> list[dict[str, float]]:
    """Add low-confidence windows around score events not already covered."""
    result = list(windows)
    for event_t in events:
        fallback = {
            "startSec": round(max(0.0, event_t - lead_sec), 2),
            "endSec": round(min(clip_duration, event_t + tail_sec), 2),
            "confidence": 0.55,
        }
        if fallback["endSec"] - fallback["startSec"] < 4.0:
            continue
        max_iou = max([iou(fallback, window) for window in result] or [0.0])
        if max_iou <= max_existing_iou:
            result.append(fallback)
    result.sort(key=lambda w: (w["startSec"], w["endSec"]))
    return result


def load_score_state_events(run_id: str, clip_id: str) -> list[float]:
    path = BASE / "eval/results" / run_id / "score-state-gate.json"
    if not path.exists():
        raise FileNotFoundError(f"score-state gate result missing: {path}")
    with open(path) as f:
        payload = json.load(f)
    return [float(t) for t in payload["perClip"][clip_id]["best"]["events"]]


def debug_iou(clip_id: str, windows: list[dict[str, float]]) -> None:
    gt = load_gt(clip_id)
    used: set[int] = set()
    tp = 0
    print(f"  GT={len(gt)} rallies  Det={len(windows)} windows")
    for gi, rally in enumerate(gt, start=1):
        best_iou = 0.0
        best_j = -1
        for j, window in enumerate(windows):
            if j in used:
                continue
            score = iou(rally, window)
            if score > best_iou:
                best_iou = score
                best_j = j
        marker = "MATCH" if best_iou >= 0.5 else "MISS "
        if best_iou >= 0.5:
            tp += 1
            used.add(best_j)
        det = windows[best_j] if best_j >= 0 else None
        det_s = f"[{det['startSec']:.1f},{det['endSec']:.1f}]" if det else "none"
        print(
            f"    {marker} GT#{gi:02d} [{rally['startSec']:.1f},{rally['endSec']:.1f}] "
            f"best={best_iou:.2f} det={det_s}"
        )
    fp = len(windows) - len(used)
    fn = len(gt) - tp
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    print(f"  TP={tp} FP={fp} FN={fn}  P={precision:.3f} R={recall:.3f} F1={f1:.3f}")


def copy_baseline_result(clip_id: str, baseline_run_id: str, out_dir: Path) -> None:
    src = BASE / "eval/results" / baseline_run_id / "per-video" / f"{clip_id}.json"
    if not src.exists():
        raise FileNotFoundError(f"Baseline result missing: {src}")
    shutil.copyfile(src, out_dir / f"{clip_id}.json")


def main() -> None:
    args = parse_args()
    run_dir = BASE / "eval/results" / args.run_id
    per_video_dir = run_dir / "per-video"
    per_video_dir.mkdir(parents=True, exist_ok=True)

    print(f"Run: {args.run_id}")
    print(f"Baseline passthrough: {args.baseline_run_id}")
    for clip_id in PASSTHROUGH_CLIPS:
        copy_baseline_result(clip_id, args.baseline_run_id, per_video_dir)
        print(f"  copied baseline windows: {clip_id}")

    if args.fukui_score_state_run_id:
        fukui_path = per_video_dir / f"{FUKUI_ID}.json"
        with open(fukui_path) as f:
            fukui_result = json.load(f)
        fukui_events = load_score_state_events(args.fukui_score_state_run_id, FUKUI_ID)
        fukui_result["detectedRallies"] = add_event_fallback_windows(
            fukui_events,
            fukui_result.get("detectedRallies", []),
            args.fukui_fallback_lead_sec,
            args.fukui_fallback_tail_sec,
            args.fukui_fallback_max_existing_iou,
            float(fukui_result.get("videoDurationSec", 600.0)),
        )
        with open(fukui_path, "w") as f:
            json.dump(fukui_result, f, indent=2)
        print(
            f"  augmented fukui with score-state fallback: events={len(fukui_events)} "
            f"windows={len(fukui_result['detectedRallies'])}"
        )
        if args.iou_debug:
            debug_iou(FUKUI_ID, fukui_result["detectedRallies"])

    print(f"\n-- {CLIP2_ID}")
    events = detect_score_events(CLIP2_ID)
    print(f"  score events={len(events)}  times={[round(e, 1) for e in events]}")
    blob_rows = compute_blob_series(CLIP2_ID)
    print(f"  blob rows={len(blob_rows)}")
    windows = build_anchor_windows(events, blob_rows, args)
    windows = add_score_interval_fallbacks(events, windows, args)
    print(f"  detected windows={len(windows)}")
    for window in windows:
        print(f"    [{window['startSec']:.1f}, {window['endSec']:.1f}] dur={window['endSec'] - window['startSec']:.1f}s")
    if args.iou_debug:
        debug_iou(CLIP2_ID, windows)

    with open(per_video_dir / f"{CLIP2_ID}.json", "w") as f:
        json.dump(
            {
                "videoId": CLIP2_ID,
                "videoDurationSec": 600.0,
                "scanFps": 3,
                "detectedRallies": windows,
            },
            f,
            indent=2,
        )

    manifest = {
        "runId": args.run_id,
        "dataset": DATASET,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "config": {
            "model": "hybrid: baseline passthrough + clip2 score-end/blob-start anchor",
            "baselineRunId": args.baseline_run_id,
            "clip2": {
                "scoreAnchor": "yellowdelta_neg",
                "yellowNegDeltaThreshold": YELLOW_NEG_DELTA_THRESH,
                "blobThreshold": args.blob_threshold,
                "lookbackSec": args.lookback_sec,
                "groupGapSec": args.group_gap_sec,
                "endTailSec": args.end_tail_sec,
                "startPadSec": args.start_pad_sec,
                "groupMode": args.group_mode,
                "fallbackShortIntervalSec": args.fallback_short_interval_sec,
                "fallbackLeadSec": args.fallback_lead_sec,
                "fallbackTailSec": args.fallback_tail_sec,
                "fallbackMaxExistingIou": args.fallback_max_existing_iou,
            },
            "fukui": {
                "scoreStateRunId": args.fukui_score_state_run_id or None,
                "fallbackLeadSec": args.fukui_fallback_lead_sec,
                "fallbackTailSec": args.fukui_fallback_tail_sec,
                "fallbackMaxExistingIou": args.fukui_fallback_max_existing_iou,
            },
        },
    }
    with open(run_dir / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    print("\nScore with:")
    print(f"  npm run eval:score -- --run-id {args.run_id} --dataset {DATASET} --baseline-run-id {args.baseline_run_id}")


if __name__ == "__main__":
    main()
