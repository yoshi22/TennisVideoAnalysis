#!/usr/bin/env python3.11
"""Train TrackNetV4 on CourtLens ball-GT JSONL labels."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Sequence

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader

if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parent))
    from dataset import TrackNetV4BallDataset, discover_clip_ids  # type: ignore
    from model import TrackNetV4, count_parameters  # type: ignore
else:
    from .dataset import TrackNetV4BallDataset, discover_clip_ids
    from .model import TrackNetV4, count_parameters

BASE = Path(__file__).resolve().parents[3]


class MaskedHeatmapLoss(nn.Module):
    def __init__(self, pos_weight: float = 50.0, focal_gamma: float = 0.0):
        super().__init__()
        self.pos_weight = float(pos_weight)
        self.focal_gamma = float(focal_gamma)

    def forward(self, logits: torch.Tensor, target: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        loss = F.binary_cross_entropy_with_logits(logits, target, reduction="none")
        if self.pos_weight != 1.0:
            loss = loss * (1.0 + (self.pos_weight - 1.0) * target)
        if self.focal_gamma > 0.0:
            prob = torch.sigmoid(logits)
            pt = prob * target + (1.0 - prob) * (1.0 - target)
            loss = loss * (1.0 - pt).pow(self.focal_gamma)

        mask = mask.to(dtype=loss.dtype)
        if mask.shape != loss.shape:
            mask = mask.expand_as(loss)
        denom = mask.sum().clamp_min(1.0)
        return (loss * mask).sum() / denom


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train/self-test a TrackNetV4 heatmap model.")
    parser.add_argument("--dataset", default="fixed-camera-v2")
    parser.add_argument("--clip-id", action="append", default=[], help="Clip id to train on; repeat or comma-separate.")
    parser.add_argument("--clip-ids", default="", help="Comma-separated clip ids to train on.")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--output-dir", default="eval/results/tracknet-v4")
    parser.add_argument("--device", default="mps", choices=("auto", "mps", "cuda", "cpu"))
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument("--sigma", type=float, default=3.0)
    parser.add_argument("--input-height", type=int, default=288)
    parser.add_argument("--input-width", type=int, default=512)
    parser.add_argument("--pos-weight", type=float, default=50.0)
    parser.add_argument("--focal-gamma", type=float, default=0.0)
    parser.add_argument("--max-samples", type=int, default=None, help="Optional smoke-training cap.")
    parser.add_argument("--self-test", action="store_true", help="Run one random forward/backward pass and exit.")
    return parser.parse_args()


def parse_clip_ids(args: argparse.Namespace) -> list[str] | None:
    raw_values: list[str] = []
    raw_values.extend(args.clip_id)
    if args.clip_ids:
        raw_values.append(args.clip_ids)

    clip_ids: list[str] = []
    for value in raw_values:
        clip_ids.extend(part.strip() for part in value.split(",") if part.strip())
    return clip_ids or None


def resolve_device(requested: str) -> tuple[torch.device, str]:
    if requested == "auto":
        if torch.backends.mps.is_available():
            return torch.device("mps"), "auto selected mps"
        if torch.cuda.is_available():
            return torch.device("cuda"), "auto selected cuda"
        return torch.device("cpu"), "auto selected cpu"
    if requested == "mps" and not torch.backends.mps.is_available():
        return torch.device("cpu"), "mps unavailable; using cpu"
    if requested == "cuda" and not torch.cuda.is_available():
        return torch.device("cpu"), "cuda unavailable; using cpu"
    return torch.device(requested), f"using {requested}"


def is_mps_error(exc: BaseException) -> bool:
    message = str(exc).lower()
    return "mps" in message or "metal" in message or "not currently implemented" in message


def first_error_line(exc: BaseException) -> str:
    lines = str(exc).splitlines()
    return lines[0] if lines else repr(exc)


def run_one_pass(device: torch.device, args: argparse.Namespace) -> dict[str, Any]:
    model = TrackNetV4().to(device)
    model.train()
    criterion = MaskedHeatmapLoss(pos_weight=args.pos_weight, focal_gamma=args.focal_gamma)

    shape = (1, 9, args.input_height, args.input_width)
    x = torch.rand(shape, device=device)
    target = torch.rand((1, 3, args.input_height, args.input_width), device=device)
    mask = torch.ones((1, 3, 1, 1), device=device)

    logits = model(x)
    loss = criterion(logits, target, mask)
    loss.backward()

    return {
        "device": device.type,
        "input_shape": tuple(x.shape),
        "output_shape": tuple(logits.shape),
        "param_count": count_parameters(model),
        "loss": float(loss.detach().cpu()),
    }


def run_self_test(args: argparse.Namespace) -> None:
    device, device_note = resolve_device(args.device)
    try:
        result = run_one_pass(device, args)
    except RuntimeError as exc:
        if device.type != "mps" or not is_mps_error(exc):
            raise
        print(f"MPS self-test failed ({first_error_line(exc)}); retrying on cpu")
        device = torch.device("cpu")
        device_note = "mps failed; using cpu"
        result = run_one_pass(device, args)

    print(
        "SELF_TEST ok "
        f"device={result['device']} ({device_note}) "
        f"input={result['input_shape']} "
        f"output={result['output_shape']} "
        f"params={result['param_count']:,} "
        f"loss={result['loss']:.6f}"
    )


def resolve_output_dir(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        path = BASE / path
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_latest_checkpoint(
    output_dir: Path,
    model: TrackNetV4,
    args: argparse.Namespace,
    epoch: int,
    loss: float,
    clip_ids: Sequence[str],
) -> Path:
    path = output_dir / "latest.pt"
    tmp_path = output_dir / "latest.tmp"
    state_dict = {key: value.detach().cpu() for key, value in model.state_dict().items()}
    torch.save(
        {
            "model": state_dict,
            "epoch": int(epoch),
            "loss": float(loss),
            "dataset": args.dataset,
            "clip_ids": list(clip_ids),
            "config": {
                "input_height": args.input_height,
                "input_width": args.input_width,
                "sigma": args.sigma,
                "pos_weight": args.pos_weight,
                "focal_gamma": args.focal_gamma,
            },
        },
        tmp_path,
    )
    os.replace(tmp_path, path)
    return path


def train(args: argparse.Namespace) -> None:
    clip_ids = parse_clip_ids(args)
    if clip_ids is None:
        clip_ids = discover_clip_ids(args.dataset)
    if not clip_ids:
        raise SystemExit(f"No clips found in eval/datasets/{args.dataset}/ball-gt; pass --clip-id once GT exists.")

    dataset = TrackNetV4BallDataset(
        args.dataset,
        clip_ids=clip_ids,
        input_size=(args.input_height, args.input_width),
        output_size=(args.input_height, args.input_width),
        sigma=args.sigma,
        max_samples=args.max_samples,
    )
    device, device_note = resolve_device(args.device)
    loader = DataLoader(
        dataset,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.num_workers,
        pin_memory=device.type == "cuda",
    )

    model = TrackNetV4().to(device)
    criterion = MaskedHeatmapLoss(pos_weight=args.pos_weight, focal_gamma=args.focal_gamma)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)
    output_dir = resolve_output_dir(args.output_dir)

    print(f"device={device.type} ({device_note}) params={count_parameters(model):,}")
    print(f"samples={len(dataset)} clips={','.join(clip_ids)} output={output_dir.relative_to(BASE)}")

    latest_loss = 0.0
    for epoch in range(1, args.epochs + 1):
        model.train()
        running_loss = 0.0
        seen = 0
        for batch in loader:
            inputs = batch["input"].to(device)
            target = batch["target"].to(device)
            mask = batch["mask"].to(device)

            optimizer.zero_grad(set_to_none=True)
            logits = model(inputs)
            loss = criterion(logits, target, mask)
            loss.backward()
            optimizer.step()

            batch_size = inputs.size(0)
            running_loss += float(loss.detach().cpu()) * batch_size
            seen += batch_size

        latest_loss = running_loss / max(seen, 1)
        checkpoint = save_latest_checkpoint(output_dir, model, args, epoch, latest_loss, clip_ids)
        print(f"epoch={epoch}/{args.epochs} loss={latest_loss:.6f} checkpoint={checkpoint.relative_to(BASE)}")

    summary_path = output_dir / "train_summary.json"
    with open(summary_path, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "dataset": args.dataset,
                "clip_ids": clip_ids,
                "epochs": args.epochs,
                "samples": len(dataset),
                "latest_loss": latest_loss,
                "checkpoint": str((output_dir / "latest.pt").relative_to(BASE)),
                "param_count": count_parameters(model),
            },
            handle,
            indent=2,
        )
    print(f"summary={summary_path.relative_to(BASE)}")


def main() -> None:
    args = parse_args()
    if args.self_test:
        run_self_test(args)
        return
    train(args)


if __name__ == "__main__":
    main()
