#!/usr/bin/env python3
"""
label-audit-report.py - generate an HTML label audit timeline.

This report is for reviewing an already-created label set. It can optionally
overlay one or more run outputs, but initial labels must be created without
using detector output to avoid circular ground truth.

Usage:
  /usr/local/bin/python3.11 scripts/eval/label-audit-report.py \
      --dataset fixed-camera-v2 --run-id iter-v2-scoreless-refine-seed
"""

from __future__ import annotations

import argparse
import html
from pathlib import Path
from typing import Any

from _common import load_json

BASE = Path(__file__).parent.parent.parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="fixed-camera-v2")
    parser.add_argument("--run-id", action="append")
    parser.add_argument("--clip-id", action="append")
    parser.add_argument("--output", default=None)
    parser.add_argument("--duration-sec", type=float, default=600.0)
    return parser.parse_args()


def label_paths(dataset: str, selected: list[str] | None) -> list[Path]:
    labels_dir = BASE / "eval/datasets" / dataset / "labels"
    wanted = set(selected or [])
    paths = []
    for path in sorted(labels_dir.glob("*.json")):
        if wanted and path.stem not in wanted:
            continue
        paths.append(path)
    return paths


def load_run_windows(run_id: str, clip_id: str) -> list[dict[str, float]]:
    path = BASE / "eval/results" / run_id / "per-video" / f"{clip_id}.json"
    if not path.exists():
        return []
    return load_json(path).get("detectedRallies", [])


def interval_divs(intervals: list[dict[str, float]], duration: float, css_class: str) -> str:
    divs = []
    for interval in intervals:
        start = max(0.0, float(interval["startSec"]))
        end = min(duration, float(interval["endSec"]))
        left = 100.0 * start / duration
        width = max(0.15, 100.0 * (end - start) / duration)
        title = f"{start:.1f}-{end:.1f}s"
        divs.append(
            f'<span class="{css_class}" style="left:{left:.4f}%;width:{width:.4f}%;" '
            f'title="{html.escape(title)}"></span>'
        )
    return "\n".join(divs)


def render_clip(label: dict[str, Any], run_ids: list[str]) -> str:
    clip_id = label["videoId"]
    duration = float(label.get("clipDurationSec", 600.0))
    rows = [
        f"<h2>{html.escape(clip_id)}</h2>",
        f"<p>GT rallies: {len(label.get('rallies', []))} / duration: {duration:.1f}s</p>",
        '<div class="track"><b>GT</b>',
        interval_divs(label.get("rallies", []), duration, "gt"),
        "</div>",
    ]
    for run_id in run_ids:
        windows = load_run_windows(run_id, clip_id)
        rows.extend(
            [
                f'<div class="track"><b>{html.escape(run_id)}</b>',
                interval_divs(windows, duration, "det"),
                "</div>",
            ]
        )
    return "\n".join(rows)


def main() -> None:
    args = parse_args()
    run_ids = args.run_id or []
    out_path = Path(args.output) if args.output else BASE / "eval/results" / "label-audit" / f"{args.dataset}.html"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    clips = [load_json(path) for path in label_paths(args.dataset, args.clip_id)]
    if not clips:
        raise SystemExit(f"No labels found for dataset={args.dataset}")

    body = "\n".join(render_clip(label, run_ids) for label in clips)
    doc = f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>{html.escape(args.dataset)} label audit</title>
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 24px; color: #17202a; }}
h1 {{ margin-bottom: 4px; }}
h2 {{ margin-top: 28px; font-size: 18px; }}
.track {{ position: relative; height: 34px; margin: 8px 0; border: 1px solid #cad1d8; background: #f7f9fb; }}
.track b {{ position: absolute; left: 8px; top: 8px; z-index: 2; font-size: 12px; color: #334; }}
.gt, .det {{ position: absolute; top: 0; height: 100%; opacity: 0.72; }}
.gt {{ background: #2e86de; }}
.det {{ background: #e74c3c; top: 11px; height: 12px; }}
</style>
</head>
<body>
<h1>{html.escape(args.dataset)} label audit</h1>
<p>Detector overlays are for audit only. Do not derive initial labels from model output.</p>
{body}
</body>
</html>
"""
    out_path.write_text(doc)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
