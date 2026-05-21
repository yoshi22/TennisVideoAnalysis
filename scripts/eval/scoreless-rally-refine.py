#!/usr/bin/env python3
"""
scoreless-rally-refine.py - score-independent fixed-camera rally refinement.

This experiment takes an existing scoreless run, recomputes only visual activity
from frames, and refines the base windows without reading scoreboard regions,
score events, or score-state artifacts.

Usage:
  /usr/local/bin/python3.11 scripts/eval/scoreless-rally-refine.py \
      --run-id iter-scoreless-refine1 --base-run-id iter-fc6-3clip
"""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np

BASE = Path(__file__).parent.parent.parent
DATASET = "fixed-camera-v1"
DATASET_DIR = BASE / "eval/datasets" / DATASET
FRAMES_DIR = DATASET_DIR / "frames"
RESULTS_DIR = BASE / "eval/results"

TARGET_SIZE = (320, 180)
DIFF_THRESHOLD = 25
LARGE_REGION_MIN_AREA = 200
DILATE_RADIUS = 5
MIN_BLOB_AREA = 3
MAX_BLOB_AREA = 80
MIN_ASPECT = 0.4
MAX_ASPECT = 2.5
MIN_CIRCULARITY = 0.35


@dataclass(frozen=True)
class ActivityRow:
    time_sec: float
    blob_count: int
    raw_motion_px: int
    clean_motion_px: int
    min_half_motion_px: int
    active: bool


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default="iter-scoreless-refine1")
    parser.add_argument("--dataset", default=DATASET)
    parser.add_argument("--base-run-id", default="iter-fc6-3clip")
    parser.add_argument("--sample-fps", type=float, default=3.0)
    parser.add_argument("--active-blob-threshold", type=int, default=11)
    parser.add_argument("--bridge-blob-threshold", type=int, default=7)
    parser.add_argument("--bridge-min-dual-zone-px", type=int, default=320)
    parser.add_argument("--refined-start-pad-sec", type=float, default=2.5)
    parser.add_argument("--refined-end-pad-sec", type=float, default=3.0)
    parser.add_argument("--max-trim-sec", type=float, default=2.0)
    parser.add_argument("--split-min-window-sec", type=float, default=18.0)
    parser.add_argument("--split-quiet-sec", type=float, default=6.0)
    parser.add_argument("--active-gap-sec", type=float, default=3.0)
    parser.add_argument("--min-duration-sec", type=float, default=4.0)
    parser.add_argument("--max-duration-sec", type=float, default=30.0)
    parser.add_argument("--min-active-coverage", type=float, default=0.0)
    parser.add_argument("--merge-eps-sec", type=float, default=0.25)
    parser.add_argument("--prune-inactive-windows", action="store_true")
    parser.add_argument("--allow-refined-base", action="store_true")
    return parser.parse_args()


def set_dataset(dataset: str) -> None:
    global DATASET, DATASET_DIR, FRAMES_DIR
    DATASET = dataset
    DATASET_DIR = BASE / "eval/datasets" / DATASET
    FRAMES_DIR = DATASET_DIR / "frames"


def frame_number(path: Path) -> int:
    match = re.search(r"(\d+)", path.name)
    return int(match.group(1)) if match else 0


def load_json(path: Path) -> Any:
    with open(path) as f:
        return json.load(f)


def write_json(path: Path, payload: Any) -> None:
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)


def clip_frame_paths(clip_id: str) -> list[Path]:
    frames_dir = FRAMES_DIR / clip_id
    paths = sorted(frames_dir.glob("*.jpg"), key=frame_number)
    if not paths:
        raise FileNotFoundError(f"No frames found for {clip_id}: {frames_dir}")
    return paths


def infer_source_fps(paths: list[Path]) -> float:
    # Existing fixed-camera-v1 has one 30fps clip and two 3fps clips.
    return 30.0 if len(paths) > 5000 else 3.0


def sampled_paths(paths: list[Path], source_fps: float, sample_fps: float) -> list[Path]:
    stride = max(1, round(source_fps / sample_fps))
    return paths[::stride]


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


def min_half_motion(mask: np.ndarray) -> int:
    mid = mask.shape[0] // 2
    top = int(mask[:mid, :].sum())
    bottom = int(mask[mid:, :].sum())
    return min(top, bottom)


def compute_activity_rows(clip_id: str, args: argparse.Namespace) -> tuple[list[ActivityRow], dict[str, Any]]:
    all_paths = clip_frame_paths(clip_id)
    source_fps = infer_source_fps(all_paths)
    paths = sampled_paths(all_paths, source_fps, args.sample_fps)
    if len(paths) < 3:
        return [], {"sourceFps": source_fps, "sampledFrames": len(paths)}

    rows: list[ActivityRow] = []
    prev = read_gray_320(paths[0])
    curr = read_gray_320(paths[1])
    for i in range(1, len(paths) - 1):
        next_gray = read_gray_320(paths[i + 1])
        raw = (
            (np.abs(curr.astype(np.int16) - prev.astype(np.int16)) > DIFF_THRESHOLD)
            & (np.abs(next_gray.astype(np.int16) - curr.astype(np.int16)) > DIFF_THRESHOLD)
        ).astype(np.uint8)
        cleaned = remove_large_regions(raw)
        blob_count = count_blobs(cleaned)
        min_half = min_half_motion(raw)
        active = blob_count >= args.active_blob_threshold or (
            blob_count >= args.bridge_blob_threshold and min_half >= args.bridge_min_dual_zone_px
        )
        rows.append(
            ActivityRow(
                time_sec=frame_number(paths[i]) / source_fps,
                blob_count=blob_count,
                raw_motion_px=int(raw.sum()),
                clean_motion_px=int(cleaned.sum()),
                min_half_motion_px=min_half,
                active=active,
            )
        )
        prev, curr = curr, next_gray

    summary = {
        "sourceFps": source_fps,
        "sampleFps": args.sample_fps,
        "sourceFrames": len(all_paths),
        "sampledFrames": len(paths),
        "activityRows": len(rows),
        "activeRows": sum(1 for row in rows if row.active),
    }
    return rows, summary


def rows_in_window(rows: list[ActivityRow], start_sec: float, end_sec: float) -> list[ActivityRow]:
    return [row for row in rows if start_sec <= row.time_sec <= end_sec]


def active_groups(rows: list[ActivityRow], active_gap_sec: float) -> list[list[ActivityRow]]:
    active_rows = [row for row in rows if row.active]
    if not active_rows:
        return []

    groups: list[list[ActivityRow]] = [[active_rows[0]]]
    for row in active_rows[1:]:
        if row.time_sec - groups[-1][-1].time_sec <= active_gap_sec:
            groups[-1].append(row)
        else:
            groups.append([row])
    return groups


def should_split_window(
    window: dict[str, float],
    groups: list[list[ActivityRow]],
    args: argparse.Namespace,
) -> bool:
    duration = float(window["endSec"] - window["startSec"])
    if duration < args.split_min_window_sec or len(groups) < 2:
        return False
    for prev_group, next_group in zip(groups, groups[1:]):
        quiet_gap = next_group[0].time_sec - prev_group[-1].time_sec
        if quiet_gap >= args.split_quiet_sec:
            return True
    return False


def candidate_from_group(
    base_window: dict[str, float],
    group: list[ActivityRow],
    args: argparse.Namespace,
) -> dict[str, float] | None:
    original_start = float(base_window["startSec"])
    original_end = float(base_window["endSec"])
    start = max(original_start, group[0].time_sec - args.refined_start_pad_sec)
    end = min(original_end, group[-1].time_sec + args.refined_end_pad_sec)
    if start - original_start > args.max_trim_sec:
        start = original_start + args.max_trim_sec
    if original_end - end > args.max_trim_sec:
        end = original_end - args.max_trim_sec
    duration = end - start
    if duration < args.min_duration_sec or duration > args.max_duration_sec:
        return None
    confidence = min(1.0, max(0.05, len(group) / max(1.0, duration * args.sample_fps)))
    return {
        "startSec": round(float(start), 2),
        "endSec": round(float(end), 2),
        "confidence": round(float(confidence), 3),
    }


def refine_window(
    window: dict[str, float],
    rows: list[ActivityRow],
    args: argparse.Namespace,
) -> list[dict[str, float]]:
    original_start = float(window["startSec"])
    original_end = float(window["endSec"])
    window_rows = rows_in_window(rows, original_start, original_end)
    if not window_rows:
        return [window.copy()]

    groups = active_groups(window_rows, args.active_gap_sec)
    active_count = sum(1 for row in window_rows if row.active)
    active_coverage = active_count / max(1, len(window_rows))
    if not groups:
        return [] if args.prune_inactive_windows else [window.copy()]
    if active_coverage < args.min_active_coverage:
        return []

    selected_groups = groups if should_split_window(window, groups, args) else [
        [row for group in groups for row in group]
    ]
    refined: list[dict[str, float]] = []
    for group in selected_groups:
        candidate = candidate_from_group(window, group, args)
        if candidate is not None:
            refined.append(candidate)
    return refined


def merge_touching(windows: list[dict[str, float]], args: argparse.Namespace) -> list[dict[str, float]]:
    if not windows:
        return []
    ordered = sorted(windows, key=lambda w: (w["startSec"], w["endSec"]))
    merged = [ordered[0].copy()]
    for window in ordered[1:]:
        prev = merged[-1]
        if window["startSec"] <= prev["endSec"] + args.merge_eps_sec:
            candidate_end = max(prev["endSec"], window["endSec"])
            if candidate_end - prev["startSec"] <= args.max_duration_sec:
                prev["endSec"] = round(float(candidate_end), 2)
                prev["confidence"] = max(prev.get("confidence", 0.0), window.get("confidence", 0.0))
            else:
                merged.append(window.copy())
        else:
            merged.append(window.copy())
    return merged


def refine_clip(
    clip_id: str,
    base_result: dict[str, Any],
    args: argparse.Namespace,
) -> tuple[dict[str, Any], dict[str, Any]]:
    rows, activity_summary = compute_activity_rows(clip_id, args)
    base_windows = base_result.get("detectedRallies", [])
    refined_windows: list[dict[str, float]] = []
    changed = {"kept": 0, "splitOrTrimmed": 0, "pruned": 0, "outputWindows": 0}

    for window in base_windows:
        refined = refine_window(window, rows, args)
        if not refined:
            changed["pruned"] += 1
            continue
        if len(refined) == 1:
            same_start = abs(refined[0]["startSec"] - float(window["startSec"])) < 0.02
            same_end = abs(refined[0]["endSec"] - float(window["endSec"])) < 0.02
            if same_start and same_end:
                changed["kept"] += 1
            else:
                changed["splitOrTrimmed"] += 1
        else:
            changed["splitOrTrimmed"] += 1
        refined_windows.extend(refined)

    refined_windows = merge_touching(refined_windows, args)
    changed["outputWindows"] = len(refined_windows)

    result = {
        "videoId": clip_id,
        "videoDurationSec": base_result.get("videoDurationSec", 600),
        "scanFps": args.sample_fps,
        "detectedRallies": refined_windows,
    }
    diagnostics = {
        "activity": activity_summary,
        "baseWindows": len(base_windows),
        "refinement": changed,
    }
    return result, diagnostics


def main() -> None:
    args = parse_args()
    set_dataset(args.dataset)
    base_dir = RESULTS_DIR / args.base_run_id
    base_per_video = base_dir / "per-video"
    if not base_per_video.exists():
        raise FileNotFoundError(f"Base per-video results missing: {base_per_video}")
    base_manifest_path = base_dir / "manifest.json"
    if base_manifest_path.exists() and not args.allow_refined_base:
        base_manifest = load_json(base_manifest_path)
        base_model = base_manifest.get("config", {}).get("model")
        if base_model == "scoreless visual activity post-refinement":
            raise ValueError(
                f"{args.base_run_id} is already a scoreless refinement. "
                "Use the original detector run as --base-run-id, or pass "
                "--allow-refined-base to intentionally refine twice."
            )

    run_dir = RESULTS_DIR / args.run_id
    per_video_dir = run_dir / "per-video"
    if run_dir.exists():
        shutil.rmtree(run_dir)
    per_video_dir.mkdir(parents=True, exist_ok=True)

    diagnostics: dict[str, Any] = {}
    print(f"Run: {args.run_id}")
    print(f"Base scoreless run: {args.base_run_id}")
    for src in sorted(base_per_video.glob("*.json")):
        clip_id = src.stem
        base_result = load_json(src)
        result, clip_diag = refine_clip(clip_id, base_result, args)
        diagnostics[clip_id] = clip_diag
        write_json(per_video_dir / f"{clip_id}.json", result)
        print(
            f"  {clip_id}: base={clip_diag['baseWindows']} "
            f"out={clip_diag['refinement']['outputWindows']} "
            f"trim/split={clip_diag['refinement']['splitOrTrimmed']} "
            f"pruned={clip_diag['refinement']['pruned']}"
        )

    config = {
        "model": "scoreless visual activity post-refinement",
        "scoreInputs": "none",
        "baseRunId": args.base_run_id,
        "sampleFps": args.sample_fps,
        "activeBlobThreshold": args.active_blob_threshold,
        "bridgeBlobThreshold": args.bridge_blob_threshold,
        "bridgeMinDualZonePx": args.bridge_min_dual_zone_px,
        "refinedStartPadSec": args.refined_start_pad_sec,
        "refinedEndPadSec": args.refined_end_pad_sec,
        "maxTrimSec": args.max_trim_sec,
        "splitMinWindowSec": args.split_min_window_sec,
        "splitQuietSec": args.split_quiet_sec,
        "activeGapSec": args.active_gap_sec,
        "minDurationSec": args.min_duration_sec,
        "maxDurationSec": args.max_duration_sec,
        "minActiveCoverage": args.min_active_coverage,
        "mergeEpsSec": args.merge_eps_sec,
        "pruneInactiveWindows": args.prune_inactive_windows,
        "allowRefinedBase": args.allow_refined_base,
    }
    created_at = datetime.now(timezone.utc).isoformat()
    write_json(
        run_dir / "manifest.json",
        {
            "runId": args.run_id,
            "dataset": DATASET,
            "createdAt": created_at,
            "config": config,
            "diagnostics": diagnostics,
        },
    )
    print(f"Wrote {run_dir / 'manifest.json'}")
    print(
        "Score with:\n"
        f"  npm run eval:score -- --run-id {args.run_id} "
        f"--dataset {DATASET} --baseline-run-id {args.base_run_id}"
    )


if __name__ == "__main__":
    main()
