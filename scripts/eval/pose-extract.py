#!/usr/bin/env python3
"""
pose-extract.py — Run YOLO11n-pose on clip frames to extract per-frame
person detections. Outputs a compact TSV + JSON for each clip.

Usage:
  /usr/local/bin/python3.11 scripts/eval/pose-extract.py [--clip <clipId>] [--stride <n>]

Reads:
  eval/datasets/fixed-camera-v1/frames/<clipId>/frame_*.jpg

Writes:
  eval/datasets/fixed-camera-v1/pose/<clipId>.tsv
  (columns: frameNum timeSec nPersons
            p0_cx p0_cy p0_area p0_conf p0_wrist_l_x p0_wrist_l_y p0_wrist_r_x p0_wrist_r_y
            p1_cx ...  (up to 4 persons, NaN-padded))

Defaults:
  clip1: --stride 6  (30fps → 5fps)
  clip2: --stride 1  (3fps)
  fukui: --stride 1  (3fps)

Court ROI filter: only persons whose bbox center falls within ROI are kept.
"""

import sys
import os
import re
import json
import argparse
import numpy as np
from pathlib import Path

BASE = Path(__file__).parent.parent.parent
FRAMES_DIR = BASE / "eval/datasets/fixed-camera-v1/frames"
POSE_DIR = BASE / "eval/datasets/fixed-camera-v1/pose"

# Clip configuration: id → (fps, default_stride)
CLIP_CONFIGS = {
    "yt-maitou-suzumura-muko-clip1":  {"fps": 30, "stride": 6},
    "yt-maitou-suzumura-muko-clip2":  {"fps": 3,  "stride": 1},
    "yt-maitou-suzumura-fukui-clip1": {"fps": 3,  "stride": 1},
}

# Court ROI (normalized 0-1): exclude scoreboard overlay at top, edges
ROI = {"x_min": 0.02, "x_max": 0.98, "y_min": 0.08, "y_max": 0.97}

# YOLO keypoint indices (COCO 17-point)
KP_LEFT_WRIST  = 9
KP_RIGHT_WRIST = 10
KP_LEFT_ANKLE  = 15
KP_RIGHT_ANKLE = 16
KP_LEFT_HIP    = 11
KP_RIGHT_HIP   = 12

MAX_PERSONS = 4


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--clip", default=None, help="Clip ID to process (default: all)")
    p.add_argument("--stride", type=int, default=None, help="Frame stride override")
    p.add_argument("--conf", type=float, default=0.25, help="YOLO confidence threshold")
    return p.parse_args()


def extract_clip(model, clip_id: str, stride_override, conf_thresh: float):
    cfg = CLIP_CONFIGS[clip_id]
    fps = cfg["fps"]
    stride = stride_override if stride_override is not None else cfg["stride"]

    frames_dir = FRAMES_DIR / clip_id
    if not frames_dir.exists():
        print(f"  SKIP: frames dir not found: {frames_dir}", file=sys.stderr)
        return

    files = sorted([f for f in frames_dir.iterdir() if f.suffix == ".jpg"])
    if not files:
        print(f"  SKIP: no jpg frames in {frames_dir}", file=sys.stderr)
        return

    # Select frames: indices [stride, 2*stride, 3*stride, ...]
    selected = [files[i] for i in range(stride, len(files) - stride, stride)]
    out_tsv = POSE_DIR / f"{clip_id}.tsv"
    POSE_DIR.mkdir(parents=True, exist_ok=True)

    # Header
    per_person_cols = []
    for pi in range(MAX_PERSONS):
        per_person_cols += [
            f"p{pi}_cx", f"p{pi}_cy", f"p{pi}_area", f"p{pi}_conf",
            f"p{pi}_wl_x", f"p{pi}_wl_y", f"p{pi}_wr_x", f"p{pi}_wr_y",
            f"p{pi}_al_x", f"p{pi}_al_y", f"p{pi}_ar_x", f"p{pi}_ar_y",
            f"p{pi}_hl_x", f"p{pi}_hl_y", f"p{pi}_hr_x", f"p{pi}_hr_y",
        ]
    header = ["frameNum", "timeSec", "nPersons"] + per_person_cols
    rows = ["\t".join(header)]

    print(f"  {clip_id}: fps={fps} stride={stride} → {len(selected)} frames to process")

    for j, fpath in enumerate(selected):
        # Extract frame index from filename (frame_000123.jpg → 123)
        m = re.search(r"(\d+)", fpath.name)
        frame_num = int(m.group(1)) if m else (j * stride + stride)
        time_sec = frame_num / fps

        results = model(str(fpath), conf=conf_thresh, verbose=False)
        result = results[0]

        img_h, img_w = result.orig_shape

        persons = []
        if result.keypoints is not None and len(result.boxes) > 0:
            boxes = result.boxes.xyxy.cpu().numpy()   # (N, 4) absolute
            confs = result.boxes.conf.cpu().numpy()   # (N,)
            kps   = result.keypoints.xy.cpu().numpy() # (N, 17, 2) absolute

            for bi in range(len(boxes)):
                x1, y1, x2, y2 = boxes[bi]
                cx = ((x1 + x2) / 2) / img_w
                cy = ((y1 + y2) / 2) / img_h

                # ROI filter: only keep persons whose center is within court region
                if not (ROI["x_min"] <= cx <= ROI["x_max"] and
                        ROI["y_min"] <= cy <= ROI["y_max"]):
                    continue

                area = ((x2 - x1) * (y2 - y1)) / (img_w * img_h)
                conf = float(confs[bi])

                def kp_norm(idx):
                    x, y = kps[bi, idx]
                    return float(x / img_w), float(y / img_h)

                wl = kp_norm(KP_LEFT_WRIST)
                wr = kp_norm(KP_RIGHT_WRIST)
                al = kp_norm(KP_LEFT_ANKLE)
                ar = kp_norm(KP_RIGHT_ANKLE)
                hl = kp_norm(KP_LEFT_HIP)
                hr = kp_norm(KP_RIGHT_HIP)

                persons.append([cx, cy, area, conf,
                                 wl[0], wl[1], wr[0], wr[1],
                                 al[0], al[1], ar[0], ar[1],
                                 hl[0], hl[1], hr[0], hr[1]])

        n = len(persons)
        row = [str(frame_num), f"{time_sec:.4f}", str(n)]
        for pi in range(MAX_PERSONS):
            if pi < n:
                row += [f"{v:.4f}" for v in persons[pi]]
            else:
                row += ["nan"] * 16  # 16 values per person (cx,cy,area,conf,wl,wr,al,ar,hl,hr)

        rows.append("\t".join(row))

        if j % 100 == 0:
            print(f"    {j+1}/{len(selected)}\r", end="", flush=True)

    with open(out_tsv, "w") as f:
        f.write("\n".join(rows) + "\n")

    print(f"\n  → {out_tsv} ({len(rows)-1} rows)")


def main():
    args = parse_args()
    from ultralytics import YOLO

    print("Loading YOLO11n-pose model...")
    model = YOLO("yolo11n-pose.pt")

    clips = [args.clip] if args.clip else list(CLIP_CONFIGS.keys())
    for clip_id in clips:
        if clip_id not in CLIP_CONFIGS:
            print(f"Unknown clip: {clip_id}", file=sys.stderr)
            continue
        print(f"\n── {clip_id} ──")
        extract_clip(model, clip_id, args.stride, args.conf)

    print("\nDone. Run pose-gate.py next.")


if __name__ == "__main__":
    main()
