#!/usr/bin/env python3
"""
trajectory-rally.py — Convert ball-tracker trajectory JSONL into rally windows.

Reads real ball-tracker output (from track-ball.py) and applies the same
window-merge + refine logic as rallySegment.ts to produce rally detections.

Reads:  eval/datasets/<dataset>/ball-tracks/<model>/<clipId>.jsonl
        eval/datasets/<dataset>/labels/<clipId>.json  (for duration)
Writes: eval/results/<run-id>/per-video/<clipId>.json  (VideoRunResult format)
        eval/results/<run-id>/manifest.json

Scoreless: NO score / OCR / scoreboard / score-state inputs.

Usage:
  /usr/local/bin/python3.11 scripts/eval/trajectory-rally.py \\
      --run-id iter-tracknet-v1-rally1 \\
      --model tracknet-v1 \\
      [--dataset fixed-camera-v2] \\
      [--clip-id yt-maitou-suzumura-muko-clip1] \\
      [--min-confidence 0.35] \\
      [--gap-tol 4.0]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BASE = Path(__file__).parent.parent.parent
DATASETS_DIR = BASE / "eval" / "datasets"
RESULTS_DIR = BASE / "eval" / "results"


# ── Window helpers ────────────────────────────────────────────────────────

def _w(start: float, end: float, conf: float = 0.7) -> dict[str, float]:
    return {"startSec": round(start, 3), "endSec": round(end, 3), "confidence": round(conf, 4)}


# ── Port of rallySegment.ts mergeDetectionsIntoWindows + refineWindowsWithDetections ─────

def _group_into_raw(
    times: list[float], gap_tol: float
) -> list[tuple[float, float, int]]:
    """Cluster sorted detection times into (windowStart, windowEnd, count)."""
    if not times:
        return []
    groups: list[tuple[float, float, int]] = []
    start = end = times[0]
    count = 1
    for t in times[1:]:
        if t - end <= gap_tol:
            end = t
            count += 1
        else:
            groups.append((start, end, count))
            start = end = t
            count = 1
    groups.append((start, end, count))
    return groups


def _merge_overlapping(
    windows: list[dict], max_dur: float, epsilon: float = 0.25
) -> list[dict]:
    """Merge adjacent windows that overlap or are within epsilon, respecting max_dur cap."""
    if len(windows) <= 1:
        return list(windows)
    merged: list[dict] = []
    for w in windows:
        prev = merged[-1] if merged else None
        if prev and w["startSec"] <= prev["endSec"] + epsilon:
            candidate_end = max(prev["endSec"], w["endSec"])
            if candidate_end - prev["startSec"] <= max_dur:
                prev["endSec"] = candidate_end
                prev["confidence"] = max(prev["confidence"], w["confidence"])
            else:
                merged.append(dict(w))
        else:
            merged.append(dict(w))
    return merged


def _group_times(times: list[float], gap: float) -> list[list[float]]:
    """Group sorted times into sublists where consecutive gap <= gap."""
    if not times:
        return []
    groups: list[list[float]] = [[times[0]]]
    for t in times[1:]:
        if t - groups[-1][-1] <= gap:
            groups[-1].append(t)
        else:
            groups.append([t])
    return groups


def _refine_window(
    src: dict, group: list[float], opts: dict
) -> dict | None:
    """Trim a padded window toward the actual active group, bounded by max_trim."""
    start = max(src["startSec"], group[0] - opts["refine_start"])
    end = min(src["endSec"], group[-1] + opts["refine_end"])
    # Clamp: can't trim more than max_trim from either boundary
    if src["startSec"] - start > opts["max_trim"]:
        start = src["startSec"] + opts["max_trim"]
    if src["endSec"] - end > opts["max_trim"]:
        end = src["endSec"] - opts["max_trim"]
    dur = end - start
    if dur < opts["min_dur"] or dur > opts["max_dur"]:
        return None
    act_conf = min(1.0, len(group) / max(1.0, dur))
    return _w(start, end, max(src["confidence"], act_conf))


def _refine_windows(
    windows: list[dict], detections: list[float], opts: dict
) -> list[dict]:
    """
    For each padded window, find active detections inside it.
    Optionally split on a long quiet gap (>= split_quiet) if the window is large.
    Trim boundaries toward the actual activity.
    """
    if not windows:
        return []
    refined: list[dict] = []
    for w in windows:
        active = [t for t in detections if w["startSec"] <= t <= w["endSec"]]
        if not active:
            refined.append(dict(w))
            continue
        groups = _group_times(active, opts["visual_activity_gap"])
        # Check whether to split this window
        should_split = (
            w["endSec"] - w["startSec"] >= opts["split_min"]
            and len(groups) >= 2
            and any(
                groups[i][0] - groups[i - 1][-1] >= opts["split_quiet"]
                for i in range(1, len(groups))
            )
        )
        for grp in (groups if should_split else [active]):
            r = _refine_window(w, grp, opts)
            if r:
                refined.append(r)
    return _merge_overlapping(refined, opts["max_dur"], 0.25)


def merge_detections_into_windows(times: list[float], opts: dict) -> list[dict]:
    """
    Core rally-segmentation logic (port of rallySegment.ts mergeDetectionsIntoWindows).
    Takes ball_present timestamps, returns padded + refined rally windows.
    """
    times = sorted({t for t in times if math.isfinite(t)})
    if not times:
        return []

    raw = _group_into_raw(times, opts["gap_tol"])
    windows: list[dict] = []
    for start, end, count in raw:
        dur = end - start
        if dur < opts["min_dur"]:
            continue
        padded_start = max(0.0, start - opts["start_pad"])
        padded_end = min(padded_start + opts["max_dur"], end + opts["end_pad"])
        conf = min(1.0, count / max(1.0, dur))
        windows.append(_w(padded_start, padded_end, conf))

    merged = _merge_overlapping(windows, opts["max_dur"])
    return _refine_windows(merged, times, opts)


# ── Trajectory loading and feature extraction ─────────────────────────────

def load_trajectory(path: Path) -> list[dict]:
    rows: list[dict] = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return rows


def extract_ball_present_times(
    rows: list[dict],
    min_conf: float,
    use_speed_boost: bool,
    min_speed: float,
) -> list[float]:
    """
    Returns a sorted list of timeSec values where the ball is considered present.

    Primary signal: visible=1 AND confidence >= min_conf.
    Speed boost (optional): for consecutive visible frames where the inter-frame
    normalized displacement >= min_speed, include the intermediate frames as
    bridge detections. This catches rally-pace ball movement even when momentarily
    just below the confidence threshold.
    """
    ball_present: set[float] = set()

    # Primary: high-confidence visible frames
    primary = [r for r in rows if r.get("visible", 0) == 1 and r.get("confidence", 0.0) >= min_conf]
    for r in primary:
        ball_present.add(r["timeSec"])

    # Speed boost: large inter-frame displacement between visible frames
    if use_speed_boost:
        # half-threshold visible frames as candidates
        candidates = [
            r for r in rows
            if r.get("visible", 0) == 1
            and r.get("confidence", 0.0) >= min_conf * 0.6
            and r.get("x") is not None
            and r.get("y") is not None
        ]
        for i in range(1, len(candidates)):
            prev = candidates[i - 1]
            curr = candidates[i]
            dt = curr["timeSec"] - prev["timeSec"]
            if dt <= 0 or dt > 1.0:  # skip if frames too far apart
                continue
            dx = (curr.get("x") or 0.0) - (prev.get("x") or 0.0)
            dy = (curr.get("y") or 0.0) - (prev.get("y") or 0.0)
            speed = math.sqrt(dx * dx + dy * dy) / dt  # normalized displacement / sec
            if speed >= min_speed:
                ball_present.add(curr["timeSec"])
                ball_present.add(prev["timeSec"])

    return sorted(ball_present)


# ── Per-clip processing ───────────────────────────────────────────────────

def infer_duration(rows: list[dict], label_path: Path) -> float:
    """Estimate clip duration from trajectory end time and label rallies."""
    dur = rows[-1]["timeSec"] if rows else 0.0
    if label_path.exists():
        with open(label_path) as f:
            gt = json.load(f)
        for r in gt.get("rallies", []):
            dur = max(dur, float(r.get("endSec", 0.0)) + 10.0)
    return dur


def infer_scan_fps(rows: list[dict]) -> float:
    """Estimate effective fps from first two row timestamps."""
    if len(rows) >= 2:
        dt = rows[1]["timeSec"] - rows[0]["timeSec"]
        if dt > 0:
            return round(1.0 / dt, 2)
    return 15.0


def process_clip(
    clip_id: str,
    track_dir: Path,
    label_dir: Path,
    opts: dict,
) -> dict[str, Any]:
    t0 = time.time()
    track_path = track_dir / f"{clip_id}.jsonl"
    label_path = label_dir / f"{clip_id}.json"

    if not track_path.exists():
        raise FileNotFoundError(f"Ball-tracks JSONL missing for {clip_id}: {track_path}")

    rows = load_trajectory(track_path)
    if not rows:
        raise ValueError(f"Empty trajectory JSONL for {clip_id}")

    duration_sec = infer_duration(rows, label_path)
    scan_fps = infer_scan_fps(rows)

    ball_present_times = extract_ball_present_times(
        rows,
        min_conf=opts["min_conf"],
        use_speed_boost=opts["use_speed_boost"],
        min_speed=opts["min_speed"],
    )

    windows = merge_detections_into_windows(ball_present_times, opts)

    visible_count = sum(1 for r in rows if r.get("visible", 0) == 1)
    visible_frac = visible_count / len(rows) if rows else 0.0

    runtime_ms = int((time.time() - t0) * 1000)
    print(
        f"  {clip_id}: rows={len(rows)} visible_frac={visible_frac:.3f} "
        f"ball_present={len(ball_present_times)} windows={len(windows)} "
        f"({runtime_ms}ms)"
    )
    for w in windows:
        print(f"    [{w['startSec']:.1f}s – {w['endSec']:.1f}s]  conf={w['confidence']:.3f}")

    return {
        "videoId": clip_id,
        "videoDurationSec": round(duration_sec, 2),
        "scanFps": scan_fps,
        "detectedRallies": windows,
        "runtimeMs": runtime_ms,
        "_meta": {
            "rowCount": len(rows),
            "visibleFrac": round(visible_frac, 4),
            "ballPresentCount": len(ball_present_times),
        },
    }


# ── CLI ──────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Convert ball-tracker JSONL into rally windows")
    p.add_argument("--run-id", required=True, help="Output run id (e.g. iter-tracknet-v1-rally1)")
    p.add_argument("--dataset", default="fixed-camera-v2")
    p.add_argument("--model", default="tracknet-v1", help="Ball model name (subdir under ball-tracks/)")
    p.add_argument("--clip-id", action="append", help="Process only these clip ids")
    # Detection thresholds
    p.add_argument("--min-confidence", type=float, default=0.35,
                   help="Min tracker confidence to count as visible (default 0.35)")
    p.add_argument("--gap-tol", type=float, default=4.0,
                   help="Gap tolerance (s) for merging detections (default 4.0)")
    p.add_argument("--start-pad", type=float, default=3.0, help="Start padding (s)")
    p.add_argument("--end-pad", type=float, default=4.0, help="End padding (s)")
    p.add_argument("--min-dur", type=float, default=4.0, help="Min rally duration (s)")
    p.add_argument("--max-dur", type=float, default=30.0, help="Max rally duration (s)")
    p.add_argument("--refine-start", type=float, default=2.5, help="Refined start pad (s)")
    p.add_argument("--refine-end", type=float, default=3.0, help="Refined end pad (s)")
    p.add_argument("--max-trim", type=float, default=2.0, help="Max boundary trim (s)")
    p.add_argument("--split-min", type=float, default=18.0, help="Min window for split (s)")
    p.add_argument("--split-quiet", type=float, default=6.0, help="Quiet gap to split (s)")
    p.add_argument("--visual-activity-gap", type=float, default=3.0,
                   help="Max gap within active group (s)")
    # Speed boost
    p.add_argument("--speed-boost", dest="use_speed_boost", action="store_true", default=True)
    p.add_argument("--no-speed-boost", dest="use_speed_boost", action="store_false")
    p.add_argument("--min-speed", type=float, default=0.02,
                   help="Min normalized displacement/sec to count as ball-in-motion (default 0.02)")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    dataset_dir = DATASETS_DIR / args.dataset
    track_dir = dataset_dir / "ball-tracks" / args.model
    label_dir = dataset_dir / "labels"
    run_dir = RESULTS_DIR / args.run_id
    per_video_dir = run_dir / "per-video"
    per_video_dir.mkdir(parents=True, exist_ok=True)

    # Collect clip ids from labels (or restrict to --clip-id)
    wanted = set(args.clip_id or [])
    clip_ids: list[str] = []
    for lp in sorted(label_dir.glob("*.json")):
        cid = lp.stem
        if wanted and cid not in wanted:
            continue
        clip_ids.append(cid)

    if not clip_ids:
        print(f"No clips found in {label_dir}")
        return

    opts = {
        "min_conf": args.min_confidence,
        "gap_tol": args.gap_tol,
        "start_pad": args.start_pad,
        "end_pad": args.end_pad,
        "min_dur": args.min_dur,
        "max_dur": args.max_dur,
        "refine_start": args.refine_start,
        "refine_end": args.refine_end,
        "max_trim": args.max_trim,
        "split_min": args.split_min,
        "split_quiet": args.split_quiet,
        "visual_activity_gap": args.visual_activity_gap,
        "use_speed_boost": args.use_speed_boost,
        "min_speed": args.min_speed,
    }

    print(f"Run: {args.run_id}")
    print(f"Dataset: {args.dataset}  Model: {args.model}")
    print(f"Clips: {clip_ids}")
    print(f"Options: {opts}\n")

    errors: list[str] = []
    processed: list[str] = []

    for clip_id in clip_ids:
        print(f"\n── {clip_id}")
        try:
            result = process_clip(clip_id, track_dir, label_dir, opts)
            out_path = per_video_dir / f"{clip_id}.json"
            with open(out_path, "w") as f:
                json.dump(result, f, indent=2)
            processed.append(clip_id)
        except FileNotFoundError as e:
            print(f"  SKIP: {e}")
            errors.append(f"{clip_id}: {e}")
        except Exception as e:
            print(f"  ERROR: {e}")
            errors.append(f"{clip_id}: {e}")

    manifest = {
        "runId": args.run_id,
        "dataset": args.dataset,
        "model": args.model,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "config": {
            "minConfidence": args.min_confidence,
            "gapTol": args.gap_tol,
            "startPad": args.start_pad,
            "endPad": args.end_pad,
            "minDur": args.min_dur,
            "maxDur": args.max_dur,
            "refineStart": args.refine_start,
            "refineEnd": args.refine_end,
            "maxTrim": args.max_trim,
            "splitMin": args.split_min,
            "splitQuiet": args.split_quiet,
            "visualActivityGap": args.visual_activity_gap,
            "useSpeedBoost": args.use_speed_boost,
            "minSpeed": args.min_speed,
        },
        "clipsProcessed": processed,
        "errors": errors,
    }
    with open(run_dir / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\nWrote manifest to {run_dir / 'manifest.json'}")
    if errors:
        print(f"Errors ({len(errors)}): {errors}")


if __name__ == "__main__":
    main()
