#!/usr/bin/env python3.11
"""
viz_trajectory.py — render the ball as a MOTION TRAIL over a time window, from
existing TrackNet detections. The point: a ~5px ball is ambiguous in a single
still, but its TRAJECTORY (a smooth time-ordered arc) is visible and verifiable,
and isolated false positives don't lie on the arc.

Draws, on one background frame, all visible detections in [start,end] as dots
colored by time (blue=early -> red=late) with lines connecting temporally
adjacent detections whose jump is plausible (<= max-jump px). A continuous
colored arc = the ball; scattered off-arc dots = noise.

Usage:
  python3.11 scripts/eval/autolabel/viz_trajectory.py \
      --dataset fixed-camera-v2 --clip-id yt-maitou-suzumura-muko-clip1 \
      --model tracknet-v1 --start-sec 11 --end-sec 27 --min-conf 0.3
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2

BASE = Path(__file__).resolve().parents[3]
DATASETS_DIR = BASE / "eval/datasets"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--dataset", default="fixed-camera-v2")
    p.add_argument("--clip-id", required=True)
    p.add_argument("--model", default="tracknet-v1")
    p.add_argument("--start-sec", type=float, required=True)
    p.add_argument("--end-sec", type=float, required=True)
    p.add_argument("--fps", type=float, default=30.0)
    p.add_argument("--min-conf", type=float, default=0.3)
    p.add_argument("--max-jump", type=float, default=180.0, help="Max px between linked adjacent dets")
    return p.parse_args()


def color_for(t: float):
    # blue (early) -> red (late), BGR
    return (int(255 * (1 - t)), 0, int(255 * t))


def main() -> None:
    args = parse_args()
    jl = DATASETS_DIR / args.dataset / "ball-tracks" / args.model / f"{args.clip_id}.jsonl"
    frames_dir = DATASETS_DIR / args.dataset / "frames" / args.clip_id
    rows = [json.loads(l) for l in open(jl)]

    lo, hi = args.start_sec, args.end_sec
    pts = [r for r in rows if r.get("visible") and r["confidence"] >= args.min_conf and lo <= r["timeSec"] <= hi]
    pts.sort(key=lambda r: r["frameIdx"])
    if not pts:
        raise SystemExit("No detections in window/threshold")

    mid_frame = pts[len(pts) // 2]["frameIdx"]
    bg = cv2.imread(str(frames_dir / f"frame_{mid_frame:06d}.jpg"))
    if bg is None:
        raise SystemExit(f"bg frame missing: {mid_frame}")
    h, w = bg.shape[:2]
    overlay = bg.copy()

    n = len(pts)
    linked = 0
    prev = None
    for i, r in enumerate(pts):
        t = i / max(1, n - 1)
        x, y = int(r["x"] * w), int(r["y"] * h)
        col = color_for(t)
        cv2.circle(overlay, (x, y), 4, col, -1)
        if prev is not None:
            (px, py) = prev
            if abs(x - px) + abs(y - py) <= args.max_jump:
                cv2.line(overlay, (px, py), (x, y), col, 2)
                linked += 1
        prev = (x, y)

    out = cv2.addWeighted(overlay, 0.85, bg, 0.15, 0)
    cv2.putText(out, f"{args.clip_id} {lo:.0f}-{hi:.0f}s  dets={n} linked={linked} (blue=early red=late)",
                (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
    out_dir = DATASETS_DIR / args.dataset / "ball-tracks" / args.model / "trails"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{args.clip_id}_{int(lo)}-{int(hi)}s.jpg"
    cv2.imwrite(str(out_path), out)
    print(f"window {lo:.0f}-{hi:.0f}s: {n} dets, {linked} links -> {out_path.relative_to(BASE)}")


if __name__ == "__main__":
    main()
