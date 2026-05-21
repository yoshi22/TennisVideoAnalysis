#!/usr/bin/env python3
"""
cv-rally-fallback.py - scoreless CV fallback for fixed-camera-v1 rally windows.

This script intentionally does not read scoreboard ROI state or score events.
It trains a leave-one-clip-out classifier on motion/geometry features extracted
from fixed-camera frames, then appends only non-overlapping fallback windows to
an existing base run.

Usage:
  /usr/local/bin/python3.11 scripts/eval/cv-rally-fallback.py \
      --run-id iter-cv-fallback1 \
      --base-run-id iter-score-blob-anchor8
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
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score
from sklearn.preprocessing import StandardScaler

BASE = Path(__file__).parent.parent.parent
DATASET = "fixed-camera-v1"
DATASET_DIR = BASE / "eval/datasets" / DATASET
FRAMES_DIR = DATASET_DIR / "frames"
LABEL_DIR = DATASET_DIR / "labels"
RESULTS_DIR = BASE / "eval/results"

FRAME_SIZE = (320, 180)
SCAN_FPS = 3.0
DIFF_THRESHOLD = 25
LARGE_REGION_MIN_AREA = 200
DILATE_RADIUS = 5
MIN_BLOB_AREA = 3
MAX_BLOB_AREA = 80
MIN_ASPECT = 0.4
MAX_ASPECT = 2.5
MIN_CIRCULARITY = 0.35

GAP_TOL_SEC = 3.0
PAD_START_SEC = 3.0
PAD_END_SEC = 4.0
MIN_DUR_SEC = 4.0
MAX_DUR_SEC = 30.0
MERGE_EPS_SEC = 0.25

FEATURE_NAMES = [
    "rawMotion",
    "cleanMotion",
    "blobCount",
    "rawTop",
    "rawBottom",
    "rawLeft",
    "rawRight",
    "rawMinTB",
    "rawMaxTB",
    "largeCount",
    "largeArea",
    "largeAreaRatio",
    "flowMean",
    "flowP90",
    "flowTop",
    "flowBottom",
    "flowMinTB",
    "flowMaxTB",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default="iter-cv-fallback1")
    parser.add_argument("--base-run-id", default="iter-score-blob-anchor8")
    parser.add_argument("--threshold", type=float, default=None)
    parser.add_argument("--window-half", type=int, default=5)
    parser.add_argument("--long-window-half", type=int, default=15)
    parser.add_argument("--max-base-iou", type=float, default=0.2)
    parser.add_argument("--max-fallbacks-per-clip", type=int, default=6)
    parser.add_argument("--min-window-confidence", type=float, default=0.55)
    parser.add_argument("--iou-debug", action="store_true")
    return parser.parse_args()


def frame_number(path: Path) -> int:
    match = re.search(r"(\d+)", path.name)
    return int(match.group(1)) if match else 0


def clip_ids() -> list[str]:
    return [path.stem for path in sorted(LABEL_DIR.glob("*.json"))]


def load_gt(clip_id: str) -> list[dict[str, float]]:
    with open(LABEL_DIR / f"{clip_id}.json") as f:
        return json.load(f)["rallies"]


def load_base_result(base_run_id: str, clip_id: str) -> dict[str, Any]:
    path = RESULTS_DIR / base_run_id / "per-video" / f"{clip_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"Base run result missing: {path}")
    with open(path) as f:
        return json.load(f)


def source_fps_for(paths: list[Path]) -> float:
    # The fixed-camera harness stores either 3fps (~1800 frames) or 30fps
    # (~18000 frames) 600s clips. Use count to avoid trusting label fps.
    return 30.0 if len(paths) > 5000 else 3.0


def read_gray(path: Path) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise FileNotFoundError(path)
    return cv2.resize(img, FRAME_SIZE, interpolation=cv2.INTER_AREA)


def compute_motion_mask(prev: np.ndarray, curr: np.ndarray, next_gray: np.ndarray) -> np.ndarray:
    return (
        (np.abs(curr.astype(np.int16) - prev.astype(np.int16)) > DIFF_THRESHOLD)
        & (np.abs(next_gray.astype(np.int16) - curr.astype(np.int16)) > DIFF_THRESHOLD)
    ).astype(np.uint8)


def remove_large_regions(mask: np.ndarray) -> tuple[np.ndarray, int, int]:
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 4)
    large = np.zeros(mask.shape, dtype=np.uint8)
    large_count = 0
    large_area = 0

    for label in range(1, n_labels):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area > LARGE_REGION_MIN_AREA:
            large[labels == label] = 1
            large_count += 1
            large_area += area

    if large_count > 0:
        kernel = np.ones((DILATE_RADIUS * 2 + 1, DILATE_RADIUS * 2 + 1), dtype=np.uint8)
        large = cv2.dilate(large, kernel, iterations=1)

    cleaned = mask.copy().astype(np.uint8)
    cleaned[large > 0] = 0
    return cleaned, large_count, large_area


def count_blobs(mask: np.ndarray) -> int:
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 4)
    count = 0
    for label in range(1, n_labels):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < MIN_BLOB_AREA or area > MAX_BLOB_AREA:
            continue
        width = int(stats[label, cv2.CC_STAT_WIDTH])
        height = int(stats[label, cv2.CC_STAT_HEIGHT])
        aspect = max(width, height) / max(1, min(width, height))
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


def quadrant_motion(mask: np.ndarray) -> tuple[int, int, int, int]:
    height, width = mask.shape
    mid_y = height // 2
    mid_x = width // 2
    top = int(mask[:mid_y, :].sum())
    bottom = int(mask[mid_y:, :].sum())
    left = int(mask[:, :mid_x].sum())
    right = int(mask[:, mid_x:].sum())
    return top, bottom, left, right


def extract_clip_features(clip_id: str) -> dict[str, Any]:
    frames_dir = FRAMES_DIR / clip_id
    paths = sorted(frames_dir.glob("*.jpg"), key=frame_number)
    if len(paths) < 3:
        raise FileNotFoundError(f"No usable frames for {clip_id}: {frames_dir}")

    source_fps = source_fps_for(paths)
    stride = max(1, round(source_fps / SCAN_FPS))
    rows: list[list[float]] = []
    times: list[float] = []

    prev = read_gray(paths[0])
    curr = read_gray(paths[stride])
    selected = list(range(stride, len(paths) - stride, stride))

    for n, idx in enumerate(selected):
        if n == 0:
            prev = read_gray(paths[idx - stride])
            curr = read_gray(paths[idx])
        next_gray = read_gray(paths[idx + stride])

        raw = compute_motion_mask(prev, curr, next_gray)
        cleaned, large_count, large_area = remove_large_regions(raw)
        raw_top, raw_bottom, raw_left, raw_right = quadrant_motion(raw)

        flow = cv2.calcOpticalFlowFarneback(
            prev,
            curr,
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
        flow_top = float(np.mean(mag[:mid, :]))
        flow_bottom = float(np.mean(mag[mid:, :]))

        rows.append(
            [
                float(raw.sum()),
                float(cleaned.sum()),
                float(count_blobs(cleaned)),
                float(raw_top),
                float(raw_bottom),
                float(raw_left),
                float(raw_right),
                float(min(raw_top, raw_bottom)),
                float(max(raw_top, raw_bottom)),
                float(large_count),
                float(large_area),
                float(large_area / raw.size),
                float(np.mean(mag)),
                float(np.percentile(mag, 90)),
                flow_top,
                flow_bottom,
                min(flow_top, flow_bottom),
                max(flow_top, flow_bottom),
            ]
        )
        times.append(frame_number(paths[idx]) / source_fps)

        prev, curr = curr, next_gray
        if (n + 1) % 300 == 0:
            print(f"    {clip_id}: {n + 1}/{len(selected)}", end="\r")
    print(f"    {clip_id}: {len(selected)}/{len(selected)}")

    return {
        "clipId": clip_id,
        "sourceFps": source_fps,
        "stride": stride,
        "times": np.array(times, dtype=np.float64),
        "features": np.array(rows, dtype=np.float32),
    }


def assign_labels(times: np.ndarray, rallies: list[dict[str, float]]) -> np.ndarray:
    labels = np.zeros(len(times), dtype=np.int32)
    for rally in rallies:
        labels[(times >= float(rally["startSec"])) & (times <= float(rally["endSec"]))] = 1
    return labels


def rank_normalize(features: np.ndarray) -> np.ndarray:
    result = np.zeros_like(features, dtype=np.float32)
    for col in range(features.shape[1]):
        values = features[:, col]
        order = np.argsort(values, kind="mergesort")
        ranks = np.empty(len(values), dtype=np.float32)
        i = 0
        while i < len(values):
            j = i + 1
            while j < len(values) and values[order[j]] == values[order[i]]:
                j += 1
            rank = (i + j - 1) / 2.0
            ranks[order[i:j]] = rank
            i = j
        denom = max(1, len(values) - 1)
        result[:, col] = ranks / denom
    return result


def window_features(features: np.ndarray, half_short: int, half_long: int) -> np.ndarray:
    normalized = rank_normalize(features)
    n, k = normalized.shape
    out = np.empty((n, k * 8), dtype=np.float32)
    out[:, :k] = normalized
    for i in range(n):
        lo = max(0, i - half_short)
        hi = min(n, i + half_short + 1)
        win = normalized[lo:hi]
        out[i, k : k * 2] = win.mean(axis=0)
        out[i, k * 2 : k * 3] = win.max(axis=0)
        out[i, k * 3 : k * 4] = win.std(axis=0)

        lo2 = max(0, i - half_long)
        hi2 = min(n, i + half_long + 1)
        long_win = normalized[lo2:hi2]
        out[i, k * 4 : k * 5] = long_win.mean(axis=0)
        out[i, k * 5 : k * 6] = long_win.max(axis=0)
        out[i, k * 6 : k * 7] = long_win.min(axis=0)
        out[i, k * 7 :] = long_win.std(axis=0)
    return out


def median_smooth(values: np.ndarray, radius: int = 2) -> np.ndarray:
    if len(values) == 0 or radius <= 0:
        return values
    result = np.empty_like(values)
    for i in range(len(values)):
        lo = max(0, i - radius)
        hi = min(len(values), i + radius + 1)
        result[i] = np.median(values[lo:hi])
    return result


def detections_to_windows(times: np.ndarray, probs: np.ndarray, threshold: float) -> list[dict[str, float]]:
    active_indices = np.flatnonzero(probs >= threshold)
    if len(active_indices) == 0:
        return []

    windows: list[dict[str, float]] = []
    first_idx = int(active_indices[0])
    start = last = float(times[first_idx])
    group_probs: list[float] = [float(probs[first_idx])]

    for raw_idx in active_indices[1:]:
        i = int(raw_idx)
        t = float(times[i])
        if t - last <= GAP_TOL_SEC:
            last = t
            group_probs.append(float(probs[i]))
        else:
            maybe_append_window(windows, start, last, group_probs)
            start = last = t
            group_probs = [float(probs[i])]
    maybe_append_window(windows, start, last, group_probs)
    return merge_overlapping_windows(windows)


def maybe_append_window(
    windows: list[dict[str, float]],
    start: float,
    end: float,
    group_probs: list[float],
) -> None:
    duration = end - start
    if MIN_DUR_SEC <= duration <= MAX_DUR_SEC:
        padded_start = max(0.0, start - PAD_START_SEC)
        padded_end = min(padded_start + MAX_DUR_SEC, end + PAD_END_SEC)
        confidence = float(np.mean(group_probs)) if group_probs else 0.5
        windows.append(
            {
                "startSec": round(padded_start, 3),
                "endSec": round(padded_end, 3),
                "confidence": round(confidence, 6),
            }
        )


def merge_overlapping_windows(windows: list[dict[str, float]]) -> list[dict[str, float]]:
    if len(windows) <= 1:
        return windows
    merged = [windows[0].copy()]
    for window in windows[1:]:
        prev = merged[-1]
        if window["startSec"] <= prev["endSec"] + MERGE_EPS_SEC:
            candidate_end = max(prev["endSec"], window["endSec"])
            if candidate_end - prev["startSec"] <= MAX_DUR_SEC:
                prev["endSec"] = candidate_end
                prev["confidence"] = max(prev["confidence"], window["confidence"])
            else:
                merged.append(window.copy())
        else:
            merged.append(window.copy())
    return merged


def iou(a: dict[str, float], b: dict[str, float]) -> float:
    inter = max(0.0, min(a["endSec"], b["endSec"]) - max(a["startSec"], b["startSec"]))
    if inter <= 0:
        return 0.0
    union = (a["endSec"] - a["startSec"]) + (b["endSec"] - b["startSec"]) - inter
    return inter / union if union > 0 else 0.0


def event_f1(windows: list[dict[str, float]], gt: list[dict[str, float]]) -> tuple[float, float, float]:
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
    return f1, precision, recall


def filter_fallbacks(
    candidates: list[dict[str, float]],
    base_windows: list[dict[str, float]],
    max_base_iou: float,
    min_confidence: float,
    max_count: int,
) -> list[dict[str, float]]:
    filtered = []
    for window in candidates:
        if float(window.get("confidence", 0.0)) < min_confidence:
            continue
        max_iou = max([iou(window, base) for base in base_windows] or [0.0])
        if max_iou <= max_base_iou:
            filtered.append(window)
    filtered.sort(key=lambda w: (-float(w["confidence"]), w["startSec"]))
    return sorted(filtered[:max_count], key=lambda w: (w["startSec"], w["endSec"]))


def choose_threshold(
    train_items: list[dict[str, Any]],
    train_probs: list[np.ndarray],
    args: argparse.Namespace,
) -> float:
    if args.threshold is not None:
        return args.threshold

    candidates = [0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85]
    best = (0.55, -1.0, 0.0)
    for threshold in candidates:
        f1s = []
        fallback_counts = []
        for item, probs in zip(train_items, train_probs):
            smoothed = median_smooth(probs, radius=2)
            candidate_windows = detections_to_windows(item["times"], smoothed, threshold)
            fallback_windows = filter_fallbacks(
                candidate_windows,
                item["baseWindows"],
                args.max_base_iou,
                args.min_window_confidence,
                args.max_fallbacks_per_clip,
            )
            augmented = sorted(
                item["baseWindows"] + fallback_windows,
                key=lambda w: (w["startSec"], w["endSec"]),
            )
            f1s.append(event_f1(augmented, item["gt"])[0])
            fallback_counts.append(len(fallback_windows))
        mean_f1 = float(np.mean(f1s)) if f1s else 0.0
        mean_count = float(np.mean(fallback_counts)) if fallback_counts else 0.0
        # Prefer fewer fallback windows when scores tie.
        if mean_f1 > best[1] or (mean_f1 == best[1] and mean_count < best[2]):
            best = (threshold, mean_f1, mean_count)
    return best[0]


def train_predict(items: list[dict[str, Any]], args: argparse.Namespace) -> dict[str, Any]:
    predictions: dict[str, Any] = {}
    for test_idx, test_item in enumerate(items):
        train_items = [item for i, item in enumerate(items) if i != test_idx]
        x_train = np.vstack([item["X"] for item in train_items])
        y_train = np.concatenate([item["labels"] for item in train_items])

        scaler = StandardScaler()
        x_train_s = scaler.fit_transform(x_train)
        x_test_s = scaler.transform(test_item["X"])

        clf = HistGradientBoostingClassifier(
            max_iter=300,
            max_depth=5,
            learning_rate=0.05,
            class_weight="balanced",
            random_state=42,
        )
        clf.fit(x_train_s, y_train)

        train_probs = [
            clf.predict_proba(scaler.transform(item["X"]))[:, 1]
            for item in train_items
        ]
        threshold = choose_threshold(train_items, train_probs, args)
        raw_probs = clf.predict_proba(x_test_s)[:, 1]
        probs = median_smooth(raw_probs, radius=2)

        try:
            auc = roc_auc_score(test_item["labels"], raw_probs)
        except ValueError:
            auc = None

        candidate_windows = detections_to_windows(test_item["times"], probs, threshold)
        fallback_windows = filter_fallbacks(
            candidate_windows,
            test_item["baseWindows"],
            args.max_base_iou,
            args.min_window_confidence,
            args.max_fallbacks_per_clip,
        )
        predictions[test_item["clipId"]] = {
            "threshold": threshold,
            "auc": None if auc is None else float(auc),
            "candidateWindows": candidate_windows,
            "fallbackWindows": fallback_windows,
            "trainClipIds": [item["clipId"] for item in train_items],
        }
        print(
            f"  {test_item['clipId']}: threshold={threshold:.2f} "
            f"auc={auc if auc is not None else 'n/a'} "
            f"candidates={len(candidate_windows)} fallbacks={len(fallback_windows)}"
        )
    return predictions


def main() -> None:
    args = parse_args()
    run_dir = RESULTS_DIR / args.run_id
    per_video_dir = run_dir / "per-video"
    per_video_dir.mkdir(parents=True, exist_ok=True)

    print(f"Run: {args.run_id}")
    print(f"Base run: {args.base_run_id}")
    items: list[dict[str, Any]] = []

    print("\n-- Extracting scoreless CV features")
    for clip_id in clip_ids():
        extracted = extract_clip_features(clip_id)
        gt = load_gt(clip_id)
        base_result = load_base_result(args.base_run_id, clip_id)
        labels = assign_labels(extracted["times"], gt)
        x = window_features(extracted["features"], args.window_half, args.long_window_half)
        item = {
            **extracted,
            "gt": gt,
            "labels": labels,
            "X": x,
            "baseWindows": base_result.get("detectedRallies", []),
            "baseResult": base_result,
        }
        items.append(item)
        print(
            f"  {clip_id}: frames={len(labels)} pos={int(labels.sum())} "
            f"({100 * labels.mean():.1f}%) X={x.shape}"
        )

    print("\n-- Leave-one-clip-out fallback prediction")
    predictions = train_predict(items, args)

    per_clip_summary: dict[str, Any] = {}
    for item in items:
        clip_id = item["clipId"]
        pred = predictions[clip_id]
        base_result = dict(item["baseResult"])
        augmented = sorted(
            list(item["baseWindows"]) + pred["fallbackWindows"],
            key=lambda w: (w["startSec"], w["endSec"]),
        )
        base_f1, base_p, base_r = event_f1(item["baseWindows"], item["gt"])
        aug_f1, aug_p, aug_r = event_f1(augmented, item["gt"])
        per_clip_summary[clip_id] = {
            "trainClipIds": pred["trainClipIds"],
            "threshold": pred["threshold"],
            "frameAuc": pred["auc"],
            "base": {"f1": base_f1, "precision": base_p, "recall": base_r},
            "augmented": {"f1": aug_f1, "precision": aug_p, "recall": aug_r},
            "candidateCount": len(pred["candidateWindows"]),
            "fallbackCount": len(pred["fallbackWindows"]),
            "fallbackWindows": pred["fallbackWindows"],
        }
        base_result["detectedRallies"] = augmented
        with open(per_video_dir / f"{clip_id}.json", "w") as f:
            json.dump(base_result, f, indent=2)
        print(
            f"  {clip_id}: baseF1={base_f1:.3f} augF1={aug_f1:.3f} "
            f"fallbacks={len(pred['fallbackWindows'])}"
        )

    manifest = {
        "runId": args.run_id,
        "dataset": DATASET,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "config": {
            "model": "scoreless-cv-hgb-fallback",
            "baseRunId": args.base_run_id,
            "frameSize": {"width": FRAME_SIZE[0], "height": FRAME_SIZE[1]},
            "scanFps": SCAN_FPS,
            "features": FEATURE_NAMES,
            "windowHalf": args.window_half,
            "longWindowHalf": args.long_window_half,
            "maxBaseIou": args.max_base_iou,
            "maxFallbacksPerClip": args.max_fallbacks_per_clip,
            "minWindowConfidence": args.min_window_confidence,
        },
        "perClip": per_clip_summary,
    }
    with open(run_dir / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    print("\nScore with:")
    print(
        f"  npm run eval:score -- --run-id {args.run_id} --dataset {DATASET} "
        f"--baseline-run-id {args.base_run_id}"
    )


if __name__ == "__main__":
    main()
