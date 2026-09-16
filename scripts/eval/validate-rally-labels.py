#!/usr/bin/env python3
"""
validate-rally-labels.py - validate fixed-camera rally label JSON files.

This is intentionally strict enough to catch annotation mistakes before a clip
enters the scoreless leaderboard. It does not inspect model outputs.

Usage:
  /usr/local/bin/python3.11 scripts/eval/validate-rally-labels.py \
      --dataset fixed-camera-v2
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from _common import load_json

BASE = Path(__file__).parent.parent.parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="fixed-camera-v2")
    parser.add_argument("--clip-id", action="append")
    parser.add_argument("--default-duration-sec", type=float, default=600.0)
    parser.add_argument("--min-rally-sec", type=float, default=1.5)
    parser.add_argument("--max-rally-sec", type=float, default=45.0)
    parser.add_argument("--min-gap-sec", type=float, default=0.0)
    return parser.parse_args()


def allow_long_rally_warnings(dataset: str) -> bool:
    return dataset.startswith("closed-beta-soft")


def label_paths(dataset: str, selected: list[str] | None) -> list[Path]:
    labels_dir = BASE / "eval/datasets" / dataset / "labels"
    wanted = set(selected or [])
    paths = []
    for path in sorted(labels_dir.glob("*.json")):
        if path.name == ".gitkeep":
            continue
        clip_id = path.stem.removesuffix("_DRAFT")
        if wanted and path.stem not in wanted and clip_id not in wanted:
            continue
        paths.append(path)
    return paths


def require(condition: bool, errors: list[str], message: str) -> None:
    if not condition:
        errors.append(message)


def validate_label(path: Path, args: argparse.Namespace) -> tuple[list[str], list[str], dict[str, Any]]:
    errors: list[str] = []
    warnings: list[str] = []
    label = load_json(path)
    expected_video_id = path.stem.removesuffix("_DRAFT")

    require(label.get("schemaVersion") == 1, errors, "schemaVersion must be 1")
    require(label.get("videoId") == expected_video_id, errors, "videoId must match filename")
    require(isinstance(label.get("sourceUrl"), str) and bool(label["sourceUrl"]), errors, "sourceUrl is required")
    require(isinstance(label.get("fps"), (int, float)) and label["fps"] > 0, errors, "fps must be positive")
    require(
        isinstance(label.get("clipOffsetSec"), (int, float)) and label["clipOffsetSec"] >= 0,
        errors,
        "clipOffsetSec must be non-negative",
    )

    duration_value = label.get("clipDurationSec", args.default_duration_sec)
    duration_sec: float | None
    if duration_value is None:
        duration_sec = None
        warnings.append("clipDurationSec is null; clip duration bound check skipped")
    else:
        duration_sec = float(duration_value)
        require(duration_sec > 0, errors, "clipDurationSec/default duration must be positive")
    rallies = label.get("rallies")
    require(isinstance(rallies, list), errors, "rallies must be an array")
    if not isinstance(rallies, list):
        rallies = []

    prev_end: float | None = None
    durations: list[float] = []
    for idx, rally in enumerate(rallies, start=1):
        prefix = f"rally #{idx}"
        start = rally.get("startSec")
        end = rally.get("endSec")
        require(isinstance(start, (int, float)), errors, f"{prefix}: startSec must be numeric")
        require(isinstance(end, (int, float)), errors, f"{prefix}: endSec must be numeric")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            continue

        start_f = float(start)
        end_f = float(end)
        duration = end_f - start_f
        durations.append(duration)
        require(start_f >= 0, errors, f"{prefix}: startSec must be >= 0")
        require(end_f > start_f, errors, f"{prefix}: endSec must be greater than startSec")
        if duration_sec is not None:
            require(end_f <= duration_sec + 0.5, errors, f"{prefix}: endSec exceeds clip duration")
        require(duration >= args.min_rally_sec, errors, f"{prefix}: duration below {args.min_rally_sec}s")
        if duration > args.max_rally_sec:
            if allow_long_rally_warnings(args.dataset):
                warnings.append(f"{prefix}: duration above {args.max_rally_sec}s")
            else:
                errors.append(f"{prefix}: duration above {args.max_rally_sec}s")

        if prev_end is not None:
            gap = start_f - prev_end
            require(gap >= args.min_gap_sec, errors, f"{prefix}: overlaps or is out of order")
            if 0 <= gap < 1.0:
                warnings.append(f"{prefix}: gap from previous rally is only {gap:.2f}s")
        prev_end = end_f

        for optional in ("server", "winner", "endReason"):
            if optional in rally and rally[optional] == "":
                warnings.append(f"{prefix}: {optional} is empty string; use null or omit")

    if len(rallies) < 5:
        warnings.append("fewer than 5 rallies; clip may be too sparse for evaluation")

    summary = {
        "videoId": label.get("videoId", path.stem),
        "rallyCount": len(rallies),
        "durationSec": duration_sec if duration_sec is not None else 0.0,
        "meanRallySec": round(sum(durations) / len(durations), 3) if durations else 0.0,
        "totalRallySec": round(sum(durations), 3),
    }
    return errors, warnings, summary


def main() -> None:
    args = parse_args()
    paths = label_paths(args.dataset, args.clip_id)
    if not paths:
        print(f"Dataset: {args.dataset}")
        print("  No labels found.")
        return

    failed = False
    print(f"Dataset: {args.dataset}")
    for path in paths:
        errors, warnings, summary = validate_label(path, args)
        status = "FAIL" if errors else "PASS"
        failed = failed or bool(errors)
        print(
            f"  {summary['videoId']:<40} {status} "
            f"rallies={summary['rallyCount']} rallySec={summary['totalRallySec']:.1f}"
        )
        for warning in warnings:
            print(f"    WARN: {warning}")
        for error in errors:
            print(f"    ERROR: {error}")

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
