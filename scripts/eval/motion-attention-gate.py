#!/usr/bin/env python3
"""
motion-attention-gate.py - lightweight scoreless motion-attention proxy.

This eval-only script approximates the TrackNetV4 direction without training a
deep model. It extracts small, compact, fast-moving blobs from consecutive
frames, scores short temporal continuity, and measures whether that score
separates rally frames from non-rally frames.

Labels are used only for evaluation. Scoreboard, OCR, score-state, and score
transition inputs are never read.

Usage:
  /usr/local/bin/python3.11 scripts/eval/motion-attention-gate.py \
      --dataset fixed-camera-v2 --run-id iter-motion-attention-gate1
"""

from __future__ import annotations

import argparse
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np

BASE = Path(__file__).parent.parent.parent
DATASET = "fixed-camera-v2"
DATASET_DIR = BASE / "eval/datasets" / DATASET
LABEL_DIR = DATASET_DIR / "labels"
RESULTS_DIR = BASE / "eval/results"
TRACK_DIR = DATASET_DIR / "motion-tracks"

FRAME_SIZE = (640, 360)


@dataclass(frozen=True)
class MotionCandidate:
    x: float
    y: float
    area: int
    circularity: float
    mean_diff: float
    blob_score: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default=DATASET)
    parser.add_argument("--run-id", default="iter-motion-attention-gate1")
    parser.add_argument("--clip-id", action="append")
    parser.add_argument("--sample-fps", type=float, default=6.0)
    parser.add_argument("--max-samples", type=int, default=2400)
    parser.add_argument("--motion-threshold", type=int, default=24)
    parser.add_argument("--large-area", type=int, default=260)
    parser.add_argument("--min-blob-area", type=int, default=2)
    parser.add_argument("--max-blob-area", type=int, default=90)
    parser.add_argument("--max-aspect", type=float, default=3.0)
    parser.add_argument("--min-circularity", type=float, default=0.18)
    parser.add_argument("--max-jump-px-per-sec", type=float, default=360.0)
    parser.add_argument("--confidence-threshold", type=float, default=0.34)
    parser.add_argument("--gap-sec", type=float, default=3.0)
    parser.add_argument("--min-auc", type=float, default=0.65)
    return parser.parse_args()


def set_dataset(dataset: str) -> None:
    global DATASET, DATASET_DIR, LABEL_DIR, TRACK_DIR
    DATASET = dataset
    DATASET_DIR = BASE / "eval/datasets" / DATASET
    LABEL_DIR = DATASET_DIR / "labels"
    TRACK_DIR = DATASET_DIR / "motion-tracks"


def frame_number(path: Path) -> int:
    match = re.search(r"(\d+)", path.name)
    return int(match.group(1)) if match else 0


def load_json(path: Path) -> Any:
    with open(path) as f:
        return json.load(f)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)


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
        raise FileNotFoundError(f"No frames found for {clip_id}: {frames}")
    paths = list(frames.glob("*.jpg"))
    if not paths:
        raise FileNotFoundError(f"No frames found for {clip_id}: {frames}")
    return frames, 30.0 if len(paths) > 5000 else 3.0


def load_gt(clip_id: str) -> list[dict[str, float]]:
    return load_json(LABEL_DIR / f"{clip_id}.json")["rallies"]


def is_rally_time(t: float, rallies: list[dict[str, float]]) -> int:
    return int(any(float(r["startSec"]) <= t <= float(r["endSec"]) for r in rallies))


def read_gray(path: Path) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise FileNotFoundError(path)
    return cv2.resize(img, FRAME_SIZE, interpolation=cv2.INTER_AREA)


def remove_large_regions(mask: np.ndarray, large_area: int) -> np.ndarray:
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 4)
    keep = mask.copy().astype(np.uint8)
    for label in range(1, n_labels):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area > large_area:
            keep[labels == label] = 0
    return keep


def component_circularity(component: np.ndarray, area: int) -> float:
    eroded = cv2.erode(component.astype(np.uint8), np.ones((3, 3), dtype=np.uint8), iterations=1)
    perimeter = int(component.sum() - eroded.sum())
    return (4.0 * math.pi * area) / (perimeter * perimeter) if perimeter > 0 else 0.0


def candidate_blobs(
    mask: np.ndarray,
    diff_energy: np.ndarray,
    args: argparse.Namespace,
) -> list[MotionCandidate]:
    n_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 4)
    candidates: list[MotionCandidate] = []
    for label in range(1, n_labels):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < args.min_blob_area or area > args.max_blob_area:
            continue

        width = int(stats[label, cv2.CC_STAT_WIDTH])
        height = int(stats[label, cv2.CC_STAT_HEIGHT])
        aspect = max(width, height) / max(1, min(width, height))
        if aspect > args.max_aspect:
            continue

        component = labels == label
        circularity = component_circularity(component, area)
        if circularity < args.min_circularity:
            continue

        mean_diff = float(diff_energy[component].mean()) if np.any(component) else 0.0
        area_score = min(1.0, area / 18.0)
        compact_score = min(1.0, circularity / 0.75)
        energy_score = min(1.0, mean_diff / 80.0)
        blob_score = 0.35 * area_score + 0.30 * compact_score + 0.35 * energy_score
        cx, cy = centroids[label]
        candidates.append(
            MotionCandidate(
                x=float(cx),
                y=float(cy),
                area=area,
                circularity=float(circularity),
                mean_diff=mean_diff,
                blob_score=float(blob_score),
            )
        )
    return sorted(candidates, key=lambda c: c.blob_score, reverse=True)


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


def detections_to_windows(times: list[float], gap_sec: float) -> list[dict[str, float]]:
    if not times:
        return []
    ordered = sorted(times)
    groups: list[tuple[float, float]] = []
    start = last = ordered[0]
    for t in ordered[1:]:
        if t - last <= gap_sec:
            last = t
        else:
            groups.append((start, last))
            start = last = t
    groups.append((start, last))

    windows = []
    for start, end in groups:
        if end - start >= 1.5:
            windows.append(
                {
                    "startSec": round(max(0.0, start - 2.0), 2),
                    "endSec": round(end + 3.0, 2),
                    "confidence": 0.7,
                }
            )
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


def process_clip(clip_id: str, args: argparse.Namespace) -> dict[str, Any]:
    frames_dir, source_fps = frames_dir_for_clip(clip_id)
    paths = sorted(frames_dir.glob("*.jpg"), key=frame_number)
    if len(paths) < 3:
        raise FileNotFoundError(f"Not enough frames for {clip_id}: {frames_dir}")

    stride = max(1, round(source_fps / args.sample_fps))
    centers = list(range(stride, len(paths) - stride, stride))
    centers = centers[: args.max_samples]
    gt = load_gt(clip_id)
    TRACK_DIR.mkdir(parents=True, exist_ok=True)
    track_path = TRACK_DIR / f"{clip_id}.jsonl"

    rows: list[dict[str, float]] = []
    prev_selected: MotionCandidate | None = None
    prev_time: float | None = None
    with open(track_path, "w") as f:
        for center in centers:
            prev = read_gray(paths[center - stride])
            curr = read_gray(paths[center])
            nxt = read_gray(paths[center + stride])
            t = frame_number(paths[center]) / source_fps

            diff_prev = np.abs(curr.astype(np.int16) - prev.astype(np.int16))
            diff_next = np.abs(nxt.astype(np.int16) - curr.astype(np.int16))
            motion = ((diff_prev > args.motion_threshold) & (diff_next > args.motion_threshold)).astype(np.uint8)
            motion = remove_large_regions(motion, args.large_area)
            diff_energy = ((diff_prev + diff_next) / 2.0).astype(np.float32)
            candidates = candidate_blobs(motion, diff_energy, args)

            selected = candidates[0] if candidates else None
            continuity = 0.0
            if selected is not None and prev_selected is not None and prev_time is not None:
                dt = max(1.0 / source_fps, t - prev_time)
                max_jump = args.max_jump_px_per_sec * dt
                dist = math.hypot(selected.x - prev_selected.x, selected.y - prev_selected.y)
                continuity = max(0.0, 1.0 - dist / max(1.0, max_jump))

            blob_score = selected.blob_score if selected is not None else 0.0
            confidence = 0.72 * blob_score + 0.28 * continuity
            row = {
                "timeSec": round(float(t), 6),
                "x": 0.0 if selected is None else round(selected.x / FRAME_SIZE[0], 6),
                "y": 0.0 if selected is None else round(selected.y / FRAME_SIZE[1], 6),
                "confidence": round(float(confidence), 6),
                "blobScore": round(float(blob_score), 6),
                "continuityScore": round(float(continuity), 6),
                "area": 0.0 if selected is None else float(selected.area),
                "circularity": 0.0 if selected is None else round(selected.circularity, 6),
                "meanDiff": 0.0 if selected is None else round(selected.mean_diff, 6),
                "candidateCount": float(len(candidates)),
                "label": float(is_rally_time(t, gt)),
            }
            rows.append(row)
            f.write(json.dumps(row) + "\n")

            if selected is not None:
                prev_selected = selected
                prev_time = t

    labels = np.array([row["label"] for row in rows], dtype=np.float64)
    confidence = np.array([row["confidence"] for row in rows], dtype=np.float64)
    blob_scores = np.array([row["blobScore"] for row in rows], dtype=np.float64)
    auc_conf = rank_auc(labels, confidence)
    auc_blob = rank_auc(labels, blob_scores)
    active_times = [row["timeSec"] for row in rows if row["confidence"] >= args.confidence_threshold]
    windows = detections_to_windows(active_times, args.gap_sec)
    score = event_f1(windows, gt)

    return {
        "clipId": clip_id,
        "framesDir": str(frames_dir.relative_to(BASE)),
        "sourceFps": source_fps,
        "sampleFps": args.sample_fps,
        "samples": len(rows),
        "trackPath": str(track_path.relative_to(BASE)),
        "rallyFrameFraction": round(float(labels.mean()), 6) if len(labels) else 0.0,
        "confidenceAuc": None if auc_conf is None else round(float(auc_conf), 6),
        "confidenceAdjustedAuc": None if auc_conf is None else round(float(max(auc_conf, 1 - auc_conf)), 6),
        "blobScoreAuc": None if auc_blob is None else round(float(auc_blob), 6),
        "windowOracle": {k: round(float(v), 6) if isinstance(v, float) else v for k, v in score.items()},
        "windowCount": len(windows),
    }


def main() -> None:
    args = parse_args()
    set_dataset(args.dataset)
    print(f"Run: {args.run_id}")
    print(f"Dataset: {DATASET}")

    per_clip: dict[str, Any] = {}
    for clip_id in clip_ids_from_labels(args.clip_id):
        print(f"\n-- {clip_id}")
        try:
            per_clip[clip_id] = process_clip(clip_id, args)
            summary = per_clip[clip_id]
            print(
                f"  auc={summary['confidenceAdjustedAuc']} "
                f"windowF1={summary['windowOracle']['f1']:.3f} "
                f"P={summary['windowOracle']['precision']:.3f} "
                f"R={summary['windowOracle']['recall']:.3f}"
            )
        except Exception as exc:
            per_clip[clip_id] = {"clipId": clip_id, "error": str(exc)}
            print(f"  ERROR: {exc}")

    usable = [
        item for item in per_clip.values()
        if "error" not in item and item.get("confidenceAdjustedAuc") is not None
    ]
    passed_auc = bool(usable) and all(item["confidenceAdjustedAuc"] >= args.min_auc for item in usable)
    mean_auc = float(np.mean([item["confidenceAdjustedAuc"] for item in usable])) if usable else 0.0
    verdict = {
        "passed": passed_auc,
        "reason": (
            f"All processed clips reached adjusted AUC >= {args.min_auc}"
            if passed_auc
            else f"At least one processed clip is below adjusted AUC {args.min_auc}"
        ),
        "meanConfidenceAdjustedAuc": round(mean_auc, 6),
    }

    run_dir = RESULTS_DIR / args.run_id
    created_at = datetime.now(timezone.utc).isoformat()
    payload = {
        "runId": args.run_id,
        "dataset": DATASET,
        "createdAt": created_at,
        "config": {
            "model": "scoreless lightweight motion-attention proxy",
            "scoreInputs": "none",
            "sampleFps": args.sample_fps,
            "maxSamples": args.max_samples,
            "motionThreshold": args.motion_threshold,
            "largeArea": args.large_area,
            "minBlobArea": args.min_blob_area,
            "maxBlobArea": args.max_blob_area,
            "maxAspect": args.max_aspect,
            "minCircularity": args.min_circularity,
            "maxJumpPxPerSec": args.max_jump_px_per_sec,
            "confidenceThreshold": args.confidence_threshold,
            "gapSec": args.gap_sec,
            "minAuc": args.min_auc,
        },
        "perClip": per_clip,
        "verdict": verdict,
    }
    write_json(run_dir / "motion-attention-gate.json", payload)
    write_json(
        run_dir / "manifest.json",
        {
            "runId": args.run_id,
            "dataset": DATASET,
            "createdAt": created_at,
            "config": payload["config"],
        },
    )
    print(f"\nWrote {run_dir / 'motion-attention-gate.json'}")
    print(f"Verdict: {'PASS' if verdict['passed'] else 'FAIL'} - {verdict['reason']}")


if __name__ == "__main__":
    main()
