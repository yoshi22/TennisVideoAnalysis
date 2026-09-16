#!/usr/bin/env python3.11
"""
generate.py — Phase 0.5 auto-labeling: emit ball candidates for a clip/window.

Stage 1 ("candidate generation") of the "candidate → verify" labeling pipeline.
Reuses the blob pipeline in blob_candidates.py. Output is per-frame ball-candidate
boxes (JSONL) plus optional debug overlays so candidate quality (does the blob
stage actually catch the ball?) can be inspected before spending any VLM budget.

Verification (Claude / Astra / consensus) and COCO export are separate stages.

Usage:
  python3.11 scripts/eval/autolabel/generate.py \
      --dataset fixed-camera-v2 --clip-id yt-maitou-suzumura-muko-clip1 \
      --start-sec 11 --end-sec 27 --overlay --overlay-stride 6
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # scripts/eval, for _common
from _common import frame_number

from blob_candidates import candidates_for_triplet

BASE = Path(__file__).resolve().parents[3]
DATASETS_DIR = BASE / "eval/datasets"


def sorted_frames(clip_dir: Path) -> list[Path]:
    return sorted(clip_dir.glob("*.jpg"), key=frame_number)


def resolve_fps(n_frames: int, override: float | None) -> float:
    if override:
        return override
    # Matches tracknet-gate.py heuristic: a high frame count means 30fps extraction.
    return 30.0 if n_frames > 5000 else 3.0


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--dataset", default="fixed-camera-v2")
    p.add_argument("--clip-id", required=True)
    p.add_argument("--fps", type=float, default=None, help="Override extraction fps")
    p.add_argument("--start-sec", type=float, default=None)
    p.add_argument("--end-sec", type=float, default=None)
    p.add_argument("--start-frame", type=int, default=None)
    p.add_argument("--end-frame", type=int, default=None)
    p.add_argument("--stride", type=int, default=1, help="Center-frame step (1 = every frame)")
    p.add_argument("--neighbor-gap", type=int, default=1, help="Frame gap to prev/next for motion diff")
    p.add_argument("--overlay", action="store_true", help="Write debug overlay JPGs")
    p.add_argument("--overlay-stride", type=int, default=3, help="Write 1 overlay per N processed frames")
    p.add_argument("--limit", type=int, default=None, help="Max center frames to process")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    clip_dir = DATASETS_DIR / args.dataset / "frames" / args.clip_id
    frames = sorted_frames(clip_dir)
    if len(frames) < 3:
        raise SystemExit(f"Not enough frames in {clip_dir} ({len(frames)})")

    fps = resolve_fps(len(frames), args.fps)
    by_index = {frame_number(f): f for f in frames}
    indices = sorted(by_index)
    lo, hi = indices[0], indices[-1]

    def to_frame(sec: float) -> int:
        return int(round(sec * fps))

    start = args.start_frame if args.start_frame is not None else (
        to_frame(args.start_sec) if args.start_sec is not None else lo
    )
    end = args.end_frame if args.end_frame is not None else (
        to_frame(args.end_sec) if args.end_sec is not None else hi
    )
    gap = args.neighbor_gap
    start = max(start, lo + gap)
    end = min(end, hi - gap)

    first = cv2.imread(str(frames[0]))
    source_h, source_w = first.shape[:2]

    out_dir = DATASETS_DIR / args.dataset / "labels-box" / args.clip_id
    out_dir.mkdir(parents=True, exist_ok=True)
    overlay_dir = out_dir / "overlays"
    if args.overlay:
        overlay_dir.mkdir(parents=True, exist_ok=True)

    jsonl_path = out_dir / "candidates.jsonl"
    processed = 0
    frames_with_cand = 0
    total_cand = 0

    print(f"Clip {args.clip_id}  fps={fps}  source={source_w}x{source_h}")
    print(f"Range frames [{start}, {end}]  stride={args.stride}  gap={gap}")

    with open(jsonl_path, "w", encoding="utf-8") as out:
        center = start
        while center <= end:
            if args.limit is not None and processed >= args.limit:
                break
            prev_p = by_index.get(center - gap)
            curr_p = by_index.get(center)
            next_p = by_index.get(center + gap)
            if prev_p and curr_p and next_p:
                cands = candidates_for_triplet(prev_p, curr_p, next_p, source_w, source_h)
                out.write(
                    json.dumps(
                        {
                            "frameIdx": center,
                            "timeSec": round(center / fps, 3),
                            "candidates": [c.as_dict() for c in cands],
                        },
                        separators=(",", ":"),
                    )
                    + "\n"
                )
                total_cand += len(cands)
                if cands:
                    frames_with_cand += 1
                if args.overlay and processed % args.overlay_stride == 0:
                    img = cv2.imread(str(curr_p))
                    for c in cands:
                        p1 = (int(c.x), int(c.y))
                        p2 = (int(c.x + c.w), int(c.y + c.h))
                        # pad tiny boxes so they're visible in the overlay
                        cv2.rectangle(img, (p1[0] - 6, p1[1] - 6), (p2[0] + 6, p2[1] + 6), (0, 0, 255), 2)
                    cv2.imwrite(str(overlay_dir / f"frame_{center:06d}.jpg"), img)
                processed += 1
            center += args.stride

    avg = total_cand / processed if processed else 0.0
    print(f"Processed {processed} frames")
    print(f"  frames with >=1 candidate: {frames_with_cand} ({100*frames_with_cand/max(1,processed):.0f}%)")
    print(f"  total candidates: {total_cand}  (avg {avg:.1f}/frame)")
    print(f"  candidates -> {jsonl_path.relative_to(BASE)}")
    if args.overlay:
        print(f"  overlays -> {overlay_dir.relative_to(BASE)}")


if __name__ == "__main__":
    main()
