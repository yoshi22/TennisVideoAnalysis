#!/usr/bin/env python3.11
"""
train.py — Phase B0: fine-tune RF-DETR on the TrackNet-teacher ball dataset.

Runs inside the isolated .venv-rfdetr (torch 2.2.2 + transformers 4.x + rfdetr
1.5.2). The main eval env (TrackNet teacher) is left untouched.

Consumes the COCO dataset produced by scripts/eval/rfdetr/build_coco.py
(train/valid[/test] with _annotations.coco.json). If a `test` split is missing,
it is mirrored from `valid` so rfdetr's run_test validation passes.

Usage (from repo root):
  .venv-rfdetr/bin/python scripts/eval/rfdetr/train.py \
      --dataset-dir eval/datasets/fixed-camera-v2/rfdetr-coco/v0 \
      --model nano --epochs 10 --batch-size 4 --grad-accum 4 \
      --output-dir eval/results/rfdetr-ball-v0
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path

BASE = Path(__file__).resolve().parents[3]

MODEL_CLASSES = {"nano": "RFDETRNano", "small": "RFDETRSmall", "medium": "RFDETRMedium", "base": "RFDETRBase"}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--dataset-dir", required=True)
    p.add_argument("--model", default="nano", choices=list(MODEL_CLASSES))
    p.add_argument("--epochs", type=int, default=10)
    p.add_argument("--batch-size", type=int, default=4)
    p.add_argument("--grad-accum", type=int, default=4)
    p.add_argument("--lr", type=float, default=1e-4)
    p.add_argument("--output-dir", default="eval/results/rfdetr-ball-v0")
    p.add_argument("--no-test", action="store_true", help="Skip test split evaluation")
    p.add_argument("--num-workers", type=int, default=2)
    p.add_argument("--resolution", type=int, default=None, help="Override model resolution (must be /56)")
    p.add_argument(
        "--low-mem",
        action="store_true",
        help="Minimal-footprint smoke: disable EMA/multi-scale/expanded-scales, workers=0",
    )
    return p.parse_args()


def ensure_test_split(dataset_dir: Path) -> None:
    """rfdetr's run_test expects a test/ split; mirror valid/ if absent."""
    test_dir = dataset_dir / "test"
    valid_dir = dataset_dir / "valid"
    if test_dir.exists() or not valid_dir.exists():
        return
    test_dir.mkdir(parents=True)
    for item in valid_dir.iterdir():
        if item.name == "_annotations.coco.json":
            shutil.copy(item, test_dir / item.name)
        elif item.suffix == ".jpg":
            link = test_dir / item.name
            if not link.exists():
                os.symlink(item.resolve(), link)
    print(f"  created test/ split mirrored from valid/ ({test_dir.relative_to(BASE)})")


def main() -> None:
    args = parse_args()
    dataset_dir = Path(args.dataset_dir) if os.path.isabs(args.dataset_dir) else BASE / args.dataset_dir
    output_dir = Path(args.output_dir) if os.path.isabs(args.output_dir) else BASE / args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    if not args.no_test:
        ensure_test_split(dataset_dir)

    import rfdetr

    model_cls = getattr(rfdetr, MODEL_CLASSES[args.model])
    print(f"Model: {MODEL_CLASSES[args.model]}  dataset: {dataset_dir.relative_to(BASE)}")
    print(f"epochs={args.epochs} batch={args.batch_size} grad_accum={args.grad_accum} lr={args.lr} low_mem={args.low_mem}")

    model_kwargs = {}
    if args.resolution is not None:
        model_kwargs["resolution"] = args.resolution
    model = model_cls(**model_kwargs)

    train_kwargs = dict(
        dataset_dir=str(dataset_dir),
        epochs=args.epochs,
        batch_size=args.batch_size,
        grad_accum_steps=args.grad_accum,
        lr=args.lr,
        output_dir=str(output_dir),
        run_test=not args.no_test,
        tensorboard=False,
        progress_bar=True,
        num_workers=args.num_workers,
    )
    if args.low_mem:
        train_kwargs.update(
            num_workers=0,
            use_ema=False,
            multi_scale=False,
            expanded_scales=False,
            # keep only the rolling latest checkpoint (364MB each) — a per-epoch
            # numbered save fills the disk fast on this box.
            checkpoint_interval=10_000,
        )
    model.train(**train_kwargs)

    # summarize
    summary = {"model": MODEL_CLASSES[args.model], "epochs": args.epochs, "dataset": str(dataset_dir.relative_to(BASE))}
    ckpts = sorted(output_dir.glob("*.pth"))
    summary["checkpoints"] = [c.name for c in ckpts]
    with open(output_dir / "train_summary.json", "w") as f:
        json.dump(summary, f, indent=2)
    print(f"Done. checkpoints: {[c.name for c in ckpts]}")
    print(f"Output -> {output_dir.relative_to(BASE)}")


if __name__ == "__main__":
    main()
