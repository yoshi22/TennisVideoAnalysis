#!/usr/bin/env python3.11
"""
build_coco.py — Phase B0: turn TrackNet-teacher ball GT into a COCO dataset for
RF-DETR fine-tuning.

Reads per-clip ball GT (points, normalized) produced by
`scripts/eval/autolabel/bootstrap_ball_gt.py`, converts each point to a small
fixed-size box, and writes a Roboflow/COCO-style dataset:

    <out>/train/_annotations.coco.json  + frame images (symlinked)
    <out>/valid/_annotations.coco.json  + frame images (symlinked)

RF-DETR consumes this directory layout directly. Category id 1 = "ball"
(id 0 reserved as the COCO supercategory placeholder Roboflow exports use).

Usage:
  python3.11 scripts/eval/rfdetr/build_coco.py \
      --dataset fixed-camera-v2 --clip-id yt-maitou-suzumura-muko-clip1 \
      --box-size 22 --val-frac 0.2 --out eval/datasets/fixed-camera-v2/rfdetr-coco/v0
"""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

import cv2

BASE = Path(__file__).resolve().parents[3]
DATASETS_DIR = BASE / "eval/datasets"
FRAME_RE = re.compile(r"(\d+)")

CATEGORIES = [
    {"id": 0, "name": "objects", "supercategory": "none"},
    {"id": 1, "name": "ball", "supercategory": "objects"},
]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--dataset", default="fixed-camera-v2")
    p.add_argument("--clip-id", action="append", required=True, help="Repeatable")
    p.add_argument("--box-size", type=int, default=22, help="Ball box side length in source px")
    p.add_argument("--val-frac", type=float, default=0.2)
    p.add_argument("--limit", type=int, default=None, help="Cap total labeled frames (smoke tests)")
    p.add_argument("--out", required=True, help="Output dataset dir (repo-relative or absolute)")
    p.add_argument("--reviewed-only", action="store_true", help="Use only reviewed=true GT rows")
    return p.parse_args()


def frame_path(dataset: str, clip_id: str, frame_idx: int) -> Path:
    return DATASETS_DIR / dataset / "frames" / clip_id / f"frame_{frame_idx:06d}.jpg"


def load_gt(dataset: str, clip_id: str, reviewed_only: bool) -> list[dict]:
    gt_path = DATASETS_DIR / dataset / "ball-gt" / f"{clip_id}.jsonl"
    if not gt_path.exists():
        raise SystemExit(f"GT not found: {gt_path} (run bootstrap_ball_gt.py first)")
    rows = [json.loads(l) for l in open(gt_path)]
    rows = [r for r in rows if r.get("visible")]
    if reviewed_only:
        rows = [r for r in rows if r.get("reviewed")]
    return rows


def build_split(rows: list[dict], val_frac: float) -> tuple[list, list]:
    # deterministic split: every Nth sample to val (no RNG — reproducible)
    if val_frac <= 0:
        return rows, []
    step = max(2, round(1 / val_frac))
    train, val = [], []
    for i, r in enumerate(rows):
        (val if i % step == 0 else train).append(r)
    return train, val


def write_split(
    split_name: str, items: list[tuple[str, dict]], out_dir: Path, dataset: str, box: int, wh: tuple[int, int]
) -> dict:
    split_dir = out_dir / split_name
    split_dir.mkdir(parents=True, exist_ok=True)
    W, H = wh
    images, annotations = [], []
    img_id, ann_id = 1, 1
    for clip_id, r in items:
        fi = r["frameIdx"]
        src = frame_path(dataset, clip_id, fi)
        if not src.exists():
            continue
        fname = f"{clip_id}_{fi:06d}.jpg"
        link = split_dir / fname
        if not link.exists():
            os.symlink(src.resolve(), link)
        images.append({"id": img_id, "file_name": fname, "width": W, "height": H})
        cx, cy = r["x"] * W, r["y"] * H
        x, y = max(0.0, cx - box / 2), max(0.0, cy - box / 2)
        bw, bh = min(box, W - x), min(box, H - y)
        annotations.append(
            {
                "id": ann_id,
                "image_id": img_id,
                "category_id": 1,
                "bbox": [round(x, 1), round(y, 1), round(bw, 1), round(bh, 1)],
                "area": round(bw * bh, 1),
                "iscrowd": 0,
            }
        )
        img_id += 1
        ann_id += 1
    coco = {"images": images, "annotations": annotations, "categories": CATEGORIES}
    with open(split_dir / "_annotations.coco.json", "w") as f:
        json.dump(coco, f)
    return {"images": len(images), "annotations": len(annotations)}


def main() -> None:
    args = parse_args()
    out_dir = Path(args.out) if os.path.isabs(args.out) else BASE / args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    # collect rows across clips, tagged with clip_id
    items: list[tuple[str, dict]] = []
    wh = None
    for clip_id in args.clip_id:
        rows = load_gt(args.dataset, clip_id, args.reviewed_only)
        if wh is None:
            # read one frame to get W,H
            first = next((frame_path(args.dataset, clip_id, r["frameIdx"]) for r in rows), None)
            img = cv2.imread(str(first)) if first else None
            if img is None:
                raise SystemExit(f"Cannot read a frame for {clip_id}")
            wh = (img.shape[1], img.shape[0])
        items.extend((clip_id, r) for r in rows)

    if args.limit is not None:
        # evenly subsample to the cap so we cover the whole clip, not just the start
        step = max(1, len(items) // args.limit)
        items = items[::step][: args.limit]

    train_rows, val_rows = build_split(items, args.val_frac)
    tr = write_split("train", train_rows, out_dir, args.dataset, args.box_size, wh)
    va = write_split("valid", val_rows, out_dir, args.dataset, args.box_size, wh)

    print(f"Dataset -> {out_dir.relative_to(BASE)}  (source {wh[0]}x{wh[1]}, box={args.box_size}px)")
    print(f"  train: {tr['images']} imgs / {tr['annotations']} anns")
    print(f"  valid: {va['images']} imgs / {va['annotations']} anns")
    print("  categories: ball (id=1)")


if __name__ == "__main__":
    main()
