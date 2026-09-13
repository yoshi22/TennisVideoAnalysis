#!/usr/bin/env python3.11
"""
eval_pe.py — Phase B0: evaluate a fine-tuned RF-DETR ball detector with a
center-distance (positioning-error) metric, which is the right gauge for a
~5px ball (IoU-mAP@0.5 is unreasonably strict for tiny objects).

For each val image: run predict(), take the highest-confidence detection, and
measure the pixel distance between predicted and GT ball centers (in original
image coordinates). Also renders overlays (pred=red, GT=green) for eyeballing.

Usage (from repo root):
  .venv-rfdetr/bin/python scripts/eval/rfdetr/eval_pe.py \
      --dataset-dir eval/datasets/fixed-camera-v2/rfdetr-coco/smoke \
      --checkpoint eval/results/rfdetr-ball-smoke-of/checkpoint.pth \
      --resolution 320 --threshold 0.2 --overlay-n 8
"""

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path

import cv2
import numpy as np

BASE = Path(__file__).resolve().parents[3]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--dataset-dir", required=True)
    p.add_argument("--split", default="valid")
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--resolution", type=int, default=320)
    p.add_argument("--num-classes", type=int, default=2)
    p.add_argument("--threshold", type=float, default=0.2)
    p.add_argument("--overlay-n", type=int, default=8)
    p.add_argument("--output-dir", default=None, help="Defaults to <checkpoint dir>/pe-eval")
    return p.parse_args()


def gt_centers(split_dir: Path) -> dict[str, tuple[float, float]]:
    coco = json.load(open(split_dir / "_annotations.coco.json"))
    id2name = {im["id"]: im["file_name"] for im in coco["images"]}
    out: dict[str, tuple[float, float]] = {}
    for a in coco["annotations"]:
        x, y, w, h = a["bbox"]
        out[id2name[a["image_id"]]] = (x + w / 2, y + h / 2)
    return out


def main() -> None:
    args = parse_args()
    dataset_dir = Path(args.dataset_dir) if Path(args.dataset_dir).is_absolute() else BASE / args.dataset_dir
    ckpt = Path(args.checkpoint) if Path(args.checkpoint).is_absolute() else BASE / args.checkpoint
    split_dir = dataset_dir / args.split
    out_dir = Path(args.output_dir) if args.output_dir else ckpt.parent / "pe-eval"
    out_dir.mkdir(parents=True, exist_ok=True)

    centers = gt_centers(split_dir)
    print(f"Loading RF-DETR from {ckpt.relative_to(BASE)} (res={args.resolution})")

    from rfdetr import RFDETRNano

    model = RFDETRNano(pretrain_weights=str(ckpt), resolution=args.resolution, num_classes=args.num_classes)

    dists: list[float] = []
    detected = 0
    drawn = 0
    rows = []
    for fname, (gx, gy) in sorted(centers.items()):
        img_path = split_dir / fname
        img = cv2.imread(str(img_path))
        if img is None:
            continue
        dets = model.predict(str(img_path), threshold=args.threshold)
        conf = getattr(dets, "confidence", None)
        xyxy = getattr(dets, "xyxy", None)
        if xyxy is not None and len(xyxy) > 0:
            best = int(np.argmax(conf)) if conf is not None else 0
            x1, y1, x2, y2 = xyxy[best]
            px, py = (x1 + x2) / 2, (y1 + y2) / 2
            d = float(np.hypot(px - gx, py - gy))
            dists.append(d)
            detected += 1
            row = {"file": fname, "gt": [round(gx, 1), round(gy, 1)], "pred": [round(float(px), 1), round(float(py), 1)], "dist_px": round(d, 1), "conf": round(float(conf[best]), 3) if conf is not None else None}
        else:
            row = {"file": fname, "gt": [round(gx, 1), round(gy, 1)], "pred": None, "dist_px": None, "conf": None}
        rows.append(row)

        if drawn < args.overlay_n:
            cv2.circle(img, (int(gx), int(gy)), 16, (0, 200, 0), 2)  # GT green
            if row["pred"] is not None:
                cv2.circle(img, (int(px), int(py)), 12, (0, 0, 255), 2)  # pred red
                cv2.putText(img, f"d={row['dist_px']}px c={row['conf']}", (int(px) + 18, int(py)), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            cv2.imwrite(str(out_dir / f"pe_{fname}"), img)
            drawn += 1

    n = len(centers)
    det_rate = detected / n if n else 0
    print(f"\n=== PE eval on {args.split} ({n} images, threshold={args.threshold}) ===")
    print(f"detection rate (>=1 box): {detected}/{n} = {det_rate:.0%}")
    if dists:
        for thr in (5, 10, 20, 40):
            within = sum(1 for d in dists if d <= thr)
            print(f"  center within {thr:>2}px: {within}/{len(dists)} = {within/len(dists):.0%}")
        print(f"  median dist: {statistics.median(dists):.1f}px   mean: {statistics.mean(dists):.1f}px   min: {min(dists):.1f}px")
    with open(out_dir / "pe_results.json", "w") as f:
        json.dump({"n": n, "detected": detected, "detection_rate": det_rate, "rows": rows}, f, indent=2)
    try:
        shown = out_dir.resolve().relative_to(BASE)
    except ValueError:
        shown = out_dir
    print(f"overlays + pe_results.json -> {shown}")


if __name__ == "__main__":
    main()
