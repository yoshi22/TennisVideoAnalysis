#!/usr/bin/env python3
"""Run a trained rally-state checkpoint on one clip and emit VideoRunResult JSON."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import torch

if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parent))
    import extract_features  # type: ignore
    from model import RallyStateModel  # type: ignore
    from train import (  # type: ignore
        FEATURE_NAMES,
        clip_duration_sec,
        first_error_line,
        is_mps_fallback_error,
        postprocess_predictions,
        resolve_device,
        write_manifest,
        write_video_result,
    )
else:
    from . import extract_features
    from .model import RallyStateModel
    from .train import (
        FEATURE_NAMES,
        clip_duration_sec,
        first_error_line,
        is_mps_fallback_error,
        postprocess_predictions,
        resolve_device,
        write_manifest,
        write_video_result,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Predict rally intervals for one clip from trained weights.")
    parser.add_argument("--dataset", default="fixed-camera-v2")
    parser.add_argument("--clip-id", required=True)
    parser.add_argument("--weights", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--hysteresis-lo", type=float, default=0.35)
    parser.add_argument("--hysteresis-hi", type=float, default=0.55)
    parser.add_argument("--min-dur", type=float, default=4.0)
    parser.add_argument("--gap-tol", type=float, default=3.0)
    parser.add_argument("--device", default="auto", choices=("auto", "mps", "cuda", "cpu"))
    return parser.parse_args()


def load_features(dataset: str, clip_id: str, fps: float) -> tuple[np.ndarray, float]:
    cached = extract_features.load_feature_cache(dataset, clip_id, fps)
    if cached is None:
        extract_features.extract_clip_features(dataset, clip_id, fps)
        cached = extract_features.load_feature_cache(dataset, clip_id, fps)
    if cached is None:
        raise RuntimeError(f"Feature cache missing or invalid for {clip_id}")
    duration = float(cached["duration_sec"][0]) if "duration_sec" in cached else clip_duration_sec(dataset, clip_id)
    return cached["features"].astype(np.float32), duration


def run_prediction(args: argparse.Namespace, checkpoint: dict, device: torch.device) -> tuple[list[dict[str, float]], int, float]:
    model_type = str(checkpoint.get("model_type", "tcn"))
    input_dim = int(checkpoint.get("input_dim", len(FEATURE_NAMES)))
    fps = float(checkpoint.get("fps", 3.0))
    features, duration_sec = load_features(args.dataset, args.clip_id, fps)
    if features.shape[1] != input_dim:
        raise RuntimeError(f"Feature dim mismatch: checkpoint expects {input_dim}, cache has {features.shape[1]}")
    mean = np.asarray(checkpoint["mean"], dtype=np.float32)
    std = np.asarray(checkpoint["std"], dtype=np.float32)
    std[std < 1e-6] = 1.0

    model = RallyStateModel(input_dim=input_dim, model_type=model_type)
    model.load_state_dict(checkpoint["state_dict"])
    model.to(device)
    model.eval()

    x = torch.from_numpy((features - mean) / std).to(device=device, dtype=torch.float32)
    import time

    started = time.perf_counter()
    with torch.no_grad():
        logits = model(x)
        probs = torch.sigmoid(logits).detach().cpu().numpy().astype(np.float32)
    runtime_ms = int(round((time.perf_counter() - started) * 1000.0))
    intervals = postprocess_predictions(
        probs,
        fps=fps,
        duration_sec=duration_sec,
        hysteresis_lo=args.hysteresis_lo,
        hysteresis_hi=args.hysteresis_hi,
        min_dur=args.min_dur,
        gap_tol=args.gap_tol,
    )
    return intervals, runtime_ms, fps


def main() -> None:
    args = parse_args()
    checkpoint = torch.load(args.weights, map_location="cpu")
    device = resolve_device(args.device)

    try:
        intervals, runtime_ms, fps = run_prediction(args, checkpoint, device)
    except (RuntimeError, NotImplementedError) as exc:
        if device.type != "mps" or not is_mps_fallback_error(exc):
            raise
        print(f"WARNING: MPS inference failed ({first_error_line(exc)}); falling back to CPU.")
        intervals, runtime_ms, fps = run_prediction(args, checkpoint, torch.device("cpu"))

    duration_sec = clip_duration_sec(args.dataset, args.clip_id)
    out_path = write_video_result(args.run_id, args.clip_id, duration_sec, fps, intervals, runtime_ms)
    manifest_path = write_manifest(
        args.run_id,
        args.dataset,
        {
            "weights": args.weights,
            "model": str(checkpoint.get("model_type", "tcn")),
            "fps": fps,
            "hysteresisLo": args.hysteresis_lo,
            "hysteresisHi": args.hysteresis_hi,
            "minDur": args.min_dur,
            "gapTol": args.gap_tol,
        },
        [args.clip_id],
        [],
    )
    print(f"Wrote {out_path}")
    print(f"Wrote manifest to {manifest_path}")


if __name__ == "__main__":
    main()
