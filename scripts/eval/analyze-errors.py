#!/usr/bin/env python3
"""
analyze-errors.py - Compare a run with fixed-camera-v1 GT and explain errors.

Reports TP/FP/FN per clip, best-IoU tables, boundary shifts for matched pairs,
and coarse merge/split hints. Writes a structured JSON artifact for iteration
handoff.

Usage:
  /usr/local/bin/python3.11 scripts/eval/analyze-errors.py \
      --run-id iter-score-blob-anchor1 [--dataset fixed-camera-v1]
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from _common import load_json

BASE = Path(__file__).parent.parent.parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--dataset", default="fixed-camera-v1")
    parser.add_argument("--iou-threshold", type=float, default=0.5)
    return parser.parse_args()


def iou(a: dict[str, float], b: dict[str, float]) -> float:
    inter = max(0.0, min(a["endSec"], b["endSec"]) - max(a["startSec"], b["startSec"]))
    if inter <= 0:
        return 0.0
    union = (a["endSec"] - a["startSec"]) + (b["endSec"] - b["startSec"]) - inter
    return inter / union if union > 0 else 0.0


def overlap_seconds(a: dict[str, float], b: dict[str, float]) -> float:
    return max(0.0, min(a["endSec"], b["endSec"]) - max(a["startSec"], b["startSec"]))


def match_rallies(
    detected: list[dict[str, float]],
    gt: list[dict[str, float]],
    iou_threshold: float,
) -> tuple[list[dict[str, Any]], list[int], list[int]]:
    used_det: set[int] = set()
    used_gt: set[int] = set()
    matches: list[dict[str, Any]] = []

    for gi, rally in enumerate(gt):
        best_iou = iou_threshold
        best_di = -1
        for di, window in enumerate(detected):
            if di in used_det:
                continue
            score = iou(rally, window)
            if score > best_iou:
                best_iou = score
                best_di = di
        if best_di >= 0:
            matches.append({"gtIdx": gi, "detIdx": best_di, "iou": best_iou})
            used_gt.add(gi)
            used_det.add(best_di)

    unmatched_gt = [i for i in range(len(gt)) if i not in used_gt]
    unmatched_det = [i for i in range(len(detected)) if i not in used_det]
    return matches, unmatched_gt, unmatched_det


def best_counterpart(item: dict[str, float], others: list[dict[str, float]]) -> dict[str, Any]:
    best_i = -1
    best_iou = 0.0
    for i, other in enumerate(others):
        score = iou(item, other)
        if score > best_iou:
            best_iou = score
            best_i = i
    return {"idx": best_i, "iou": best_iou}


def analyze_clip(
    video_id: str,
    detected: list[dict[str, float]],
    gt: list[dict[str, float]],
    iou_threshold: float,
) -> dict[str, Any]:
    matches, unmatched_gt, unmatched_det = match_rallies(detected, gt, iou_threshold)

    tp = len(matches)
    fp = len(unmatched_det)
    fn = len(unmatched_gt)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0

    matched_rows: list[dict[str, Any]] = []
    for match in matches:
        rally = gt[match["gtIdx"]]
        window = detected[match["detIdx"]]
        matched_rows.append(
            {
                "gtIdx": match["gtIdx"],
                "detIdx": match["detIdx"],
                "iou": round(match["iou"], 6),
                "gt": {"startSec": rally["startSec"], "endSec": rally["endSec"]},
                "det": {"startSec": window["startSec"], "endSec": window["endSec"]},
                "startDeltaSec": round(window["startSec"] - rally["startSec"], 3),
                "endDeltaSec": round(window["endSec"] - rally["endSec"], 3),
            }
        )

    fn_rows: list[dict[str, Any]] = []
    for gi in unmatched_gt:
        rally = gt[gi]
        best = best_counterpart(rally, detected)
        overlapping_det = [
            di for di, window in enumerate(detected) if overlap_seconds(rally, window) > 0
        ]
        if len(overlapping_det) >= 2:
            hint = "possible_split"
        elif best["idx"] >= 0 and best["iou"] > 0:
            hint = "boundary_or_duration_miss"
        else:
            hint = "no_overlapping_detection"
        fn_rows.append(
            {
                "gtIdx": gi,
                "gt": {"startSec": rally["startSec"], "endSec": rally["endSec"]},
                "bestDetIdx": best["idx"],
                "bestIoU": round(best["iou"], 6),
                "overlappingDetections": overlapping_det,
                "hint": hint,
            }
        )

    fp_rows: list[dict[str, Any]] = []
    for di in unmatched_det:
        window = detected[di]
        best = best_counterpart(window, gt)
        overlapping_gt = [
            gi for gi, rally in enumerate(gt) if overlap_seconds(window, rally) > 0
        ]
        if len(overlapping_gt) >= 2:
            hint = "possible_merge"
        elif best["idx"] >= 0 and best["iou"] > 0:
            hint = "boundary_or_duration_miss"
        else:
            hint = "no_overlapping_gt"
        fp_rows.append(
            {
                "detIdx": di,
                "det": {"startSec": window["startSec"], "endSec": window["endSec"]},
                "bestGtIdx": best["idx"],
                "bestIoU": round(best["iou"], 6),
                "overlappingGt": overlapping_gt,
                "hint": hint,
            }
        )

    return {
        "videoId": video_id,
        "summary": {
            "tp": tp,
            "fp": fp,
            "fn": fn,
            "precision": round(precision, 6),
            "recall": round(recall, 6),
            "f1": round(f1, 6),
            "gtCount": len(gt),
            "detectedCount": len(detected),
        },
        "matches": matched_rows,
        "falseNegatives": fn_rows,
        "falsePositives": fp_rows,
    }


def choose_next_hypothesis(per_clip: dict[str, Any]) -> dict[str, str]:
    worst_clip = min(per_clip.values(), key=lambda c: c["summary"]["f1"])
    summary = worst_clip["summary"]
    if summary["fn"] > summary["fp"]:
        factor = "recall"
        hypothesis = "Recover missed rallies before pruning; inspect falseNegatives with no overlapping detection first."
    elif summary["fp"] > summary["fn"]:
        factor = "precision"
        hypothesis = "Prune false positives; inspect no_overlapping_gt and possible_merge detections first."
    else:
        factor = "balance"
        hypothesis = "Tune boundary/duration handling; FP and FN pressure are balanced."
    return {"clipId": worst_clip["videoId"], "factor": factor, "hypothesis": hypothesis}


def main() -> None:
    args = parse_args()
    run_dir = BASE / "eval/results" / args.run_id
    per_video_dir = run_dir / "per-video"
    labels_dir = BASE / "eval/datasets" / args.dataset / "labels"

    if not per_video_dir.exists():
        raise FileNotFoundError(f"No per-video results found: {per_video_dir}")

    per_clip: dict[str, Any] = {}
    for result_path in sorted(per_video_dir.glob("*.json")):
        video_id = result_path.stem
        label_path = labels_dir / f"{video_id}.json"
        if not label_path.exists():
            continue
        run = load_json(result_path)
        gt = load_json(label_path)["rallies"]
        detected = run.get("detectedRallies", [])
        per_clip[video_id] = analyze_clip(video_id, detected, gt, args.iou_threshold)

    next_hypothesis = choose_next_hypothesis(per_clip) if per_clip else {}
    payload = {
        "runId": args.run_id,
        "dataset": args.dataset,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "iouThreshold": args.iou_threshold,
        "perClip": per_clip,
        "nextHypothesis": next_hypothesis,
    }

    out_path = run_dir / "error-analysis.json"
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2)

    print(f"Run: {args.run_id}")
    for clip in per_clip.values():
        s = clip["summary"]
        print(
            f"  {clip['videoId']:<40} F1={s['f1']:.3f} P={s['precision']:.3f} "
            f"R={s['recall']:.3f} TP={s['tp']} FP={s['fp']} FN={s['fn']}"
        )
        print("    FN:")
        for row in clip["falseNegatives"][:8]:
            print(
                f"      GT#{row['gtIdx'] + 1:02d} [{row['gt']['startSec']:.1f},{row['gt']['endSec']:.1f}] "
                f"bestIoU={row['bestIoU']:.2f} {row['hint']}"
            )
        print("    FP:")
        for row in clip["falsePositives"][:8]:
            print(
                f"      D#{row['detIdx'] + 1:02d} [{row['det']['startSec']:.1f},{row['det']['endSec']:.1f}] "
                f"bestIoU={row['bestIoU']:.2f} {row['hint']}"
            )

    if next_hypothesis:
        print("\nNext hypothesis")
        print(f"  clip: {next_hypothesis['clipId']}")
        print(f"  factor: {next_hypothesis['factor']}")
        print(f"  {next_hypothesis['hypothesis']}")
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()
