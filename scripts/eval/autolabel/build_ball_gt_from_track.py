#!/usr/bin/env python3.11
"""Build TrackNetV4 ball GT JSONL from cleaned ball trajectories."""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # scripts/eval, for _common
from _common import resolve_path

BASE = Path(__file__).resolve().parents[3]
DATASETS_DIR = BASE / "eval" / "datasets"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert cleaned trajectory JSONL to ball-GT JSONL.")
    parser.add_argument("--dataset", default="fixed-camera-v2")
    parser.add_argument("--clip-id", required=True)
    parser.add_argument("--track-model", default="tracknet-v1")
    parser.add_argument(
        "--input",
        default=None,
        help="Optional cleaned trajectory jsonl path; defaults to ball-tracks/<track-model>/clean/<clip-id>.jsonl",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Optional GT output jsonl path; defaults to ball-gt/<clip-id>.jsonl",
    )
    parser.add_argument("--source-filter", choices=("det", "all"), default="det")
    return parser.parse_args()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with open(path, encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON at {path}:{line_no}: {exc}") from exc
            rows.append(row)
    return rows


def validate_row(row: dict[str, Any], path: Path, line_no: int) -> None:
    for key in ("frameIdx", "timeSec", "x", "y", "source", "rally"):
        if key not in row:
            raise ValueError(f"Missing {key!r} at {path}:{line_no}")
    source = row["source"]
    if source not in {"det", "interp"}:
        raise ValueError(f"Unsupported source {source!r} at {path}:{line_no}")
    x = float(row["x"])
    y = float(row["y"])
    if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
        raise ValueError(f"x/y must be normalized [0,1] at {path}:{line_no}: x={x}, y={y}")


def selected(row: dict[str, Any], source_filter: str) -> bool:
    return source_filter == "all" or row["source"] == "det"


def build_gt_rows(rows: list[dict[str, Any]], source_filter: str, input_path: Path) -> list[dict[str, Any]]:
    gt_by_frame: dict[int, dict[str, Any]] = {}
    for line_no, row in enumerate(rows, start=1):
        validate_row(row, input_path, line_no)
        if not selected(row, source_filter):
            continue

        frame_idx = int(row["frameIdx"])
        gt_by_frame[frame_idx] = {
            "frameIdx": frame_idx,
            "timeSec": float(row["timeSec"]),
            "x": float(row["x"]),
            "y": float(row["y"]),
            "visible": 1,
            "source": str(row["source"]),
            "rally": int(row["rally"]),
            "reviewed": False,
        }

    return [gt_by_frame[frame_idx] for frame_idx in sorted(gt_by_frame)]


def summarize(rows: list[dict[str, Any]]) -> tuple[dict[str, int], dict[int, dict[str, int]]]:
    totals = {"det": 0, "interp": 0}
    per_rally: dict[int, dict[str, int]] = defaultdict(lambda: {"det": 0, "interp": 0})
    for row in rows:
        source = str(row["source"])
        rally = int(row["rally"])
        totals[source] += 1
        per_rally[rally][source] += 1
    return totals, dict(sorted(per_rally.items()))


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, separators=(",", ":")) + "\n")


def main() -> None:
    args = parse_args()
    dataset_dir = DATASETS_DIR / args.dataset
    input_path = resolve_path(
        args.input,
        dataset_dir / "ball-tracks" / args.track_model / "clean" / f"{args.clip_id}.jsonl",
    )
    output_path = resolve_path(args.output, dataset_dir / "ball-gt" / f"{args.clip_id}.jsonl")

    if not input_path.exists():
        raise SystemExit(f"Cleaned trajectory not found: {input_path}")

    input_rows = read_jsonl(input_path)
    gt_rows = build_gt_rows(input_rows, args.source_filter, input_path)
    write_jsonl(output_path, gt_rows)

    totals, per_rally = summarize(gt_rows)
    rel_output = output_path.relative_to(BASE) if output_path.is_relative_to(BASE) else output_path
    print(f"Wrote {len(gt_rows)} GT rows -> {rel_output}")
    print(f"source_filter={args.source_filter} det={totals['det']} interp={totals['interp']}")
    for rally, counts in per_rally.items():
        total = counts["det"] + counts["interp"]
        print(f"rally={rally} total={total} det={counts['det']} interp={counts['interp']}")


if __name__ == "__main__":
    main()
