#!/usr/bin/env python3.11
"""
bootstrap_ball_gt.py — Phase B0.2: seed per-frame ball ground-truth from
zero-shot TrackNet predictions, ready for human spot-correction.

Rationale (see docs/development-logs/20260912_*.md): zero-shot TrackNet V1 already
localizes the ball on our fixed-camera 720p footage with high confidence during
rallies. We convert its high-confidence predictions into an editable GT file so a
human only has to *correct* (not create) labels — the cheap labeling loop.

Only frames INSIDE labeled rally windows are kept by default (that's where the
ball is in play and GT matters), which also slashes correction workload.

Reads:  eval/datasets/<ds>/ball-tracks/<model>/<clip>.jsonl  (predictions)
        eval/datasets/<ds>/labels/<clip>.json                (rally windows)
Writes: eval/datasets/<ds>/ball-gt/<clip>.jsonl
        rows: {frameIdx, timeSec, x, y, visible, confidence, source, reviewed}

NOTE: rows are seeded reviewed=false. Training should prefer reviewed=true rows;
uncorrected prelabels risk self-distillation (model relearns its own errors), so
correct a representative subset before trusting the fine-tune.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[3]
DATASETS_DIR = BASE / "eval/datasets"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--dataset", default="fixed-camera-v2")
    p.add_argument("--clip-id", required=True)
    p.add_argument("--model", default="tracknet-v1")
    p.add_argument("--min-conf", type=float, default=0.5, help="Keep predictions >= this confidence")
    p.add_argument("--rally-only", action="store_true", default=True, help="Keep only frames inside rally windows")
    p.add_argument("--all-frames", dest="rally_only", action="store_false", help="Keep all frames, not just rallies")
    p.add_argument("--pad-sec", type=float, default=1.0, help="Pad rally windows by this many seconds each side")
    return p.parse_args()


def load_rallies(dataset: str, clip_id: str) -> list[dict]:
    path = DATASETS_DIR / dataset / "labels" / f"{clip_id}.json"
    if not path.exists():
        # try DRAFT
        alt = DATASETS_DIR / dataset / "labels" / f"{clip_id}_DRAFT.json"
        path = alt if alt.exists() else path
    if not path.exists():
        return []
    return json.load(open(path)).get("rallies", [])


def in_any_rally(t: float, rallies: list[dict], pad: float) -> bool:
    return any(r["startSec"] - pad <= t <= r["endSec"] + pad for r in rallies)


def main() -> None:
    args = parse_args()
    pred_path = DATASETS_DIR / args.dataset / "ball-tracks" / args.model / f"{args.clip_id}.jsonl"
    if not pred_path.exists():
        raise SystemExit(f"Predictions not found: {pred_path}\nRun track-ball.py first (needs TrackNet weights).")

    rallies = load_rallies(args.dataset, args.clip_id)
    if args.rally_only and not rallies:
        raise SystemExit(f"--rally-only but no rally labels for {args.clip_id}; pass --all-frames to override.")

    rows = [json.loads(l) for l in open(pred_path)]
    out_dir = DATASETS_DIR / args.dataset / "ball-gt"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{args.clip_id}.jsonl"

    kept = 0
    total_vis = 0
    with open(out_path, "w", encoding="utf-8") as out:
        for r in rows:
            if not r.get("visible"):
                continue
            total_vis += 1
            if r["confidence"] < args.min_conf:
                continue
            if args.rally_only and not in_any_rally(r["timeSec"], rallies, args.pad_sec):
                continue
            out.write(
                json.dumps(
                    {
                        "frameIdx": r["frameIdx"],
                        "timeSec": r["timeSec"],
                        "x": r["x"],
                        "y": r["y"],
                        "visible": 1,
                        "confidence": round(r["confidence"], 3),
                        "source": f"prelabel-{args.model}",
                        "reviewed": False,
                    },
                    separators=(",", ":"),
                )
                + "\n"
            )
            kept += 1

    print(f"Clip {args.clip_id}: {len(rows)} pred rows, {total_vis} visible")
    print(f"  rallies={len(rallies)}  min-conf={args.min_conf}  rally-only={args.rally_only}")
    print(f"  seeded GT rows: {kept} -> {out_path.relative_to(BASE)}")
    print("  (rows are reviewed=false; correct a subset before trusting the fine-tune)")


if __name__ == "__main__":
    main()
