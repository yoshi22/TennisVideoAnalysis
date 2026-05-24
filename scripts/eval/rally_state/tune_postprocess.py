#!/usr/bin/env python3
"""Re-evaluate saved LOCO checkpoints with new post-processing parameters.

Skips retraining entirely — loads saved fold weights from /tmp and re-runs
prediction + tuned post-processing.  Iterate in seconds instead of minutes.

Usage:
  python3.11 scripts/eval/rally_state/tune_postprocess.py \\
    --source-run-id rally-state-tcn-v1-full \\
    --run-id rally-state-tcn-v1-pp2 \\
    --dataset fixed-camera-v2 \\
    --hysteresis-lo 0.35 --hysteresis-hi 0.50 \\
    --gap-tol 0 --start-pad 0.5 --end-pad 1.0 --min-dur 2.0

  # then score:
  npm run eval:score -- --run-id rally-state-tcn-v1-pp2 \\
    --dataset fixed-camera-v2 --baseline-run-id iter-v2-expanded-blob1
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch

if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parent))
    import extract_features  # type: ignore
    import rasterize  # type: ignore
    from model import RallyStateModel  # type: ignore
    from train import (  # type: ignore
        binary_metrics,
        intervals_to_labels,
        postprocess_predictions,
        write_manifest,
        write_video_result,
    )
else:
    from . import extract_features, rasterize
    from .model import RallyStateModel
    from .train import (
        binary_metrics,
        intervals_to_labels,
        postprocess_predictions,
        write_manifest,
        write_video_result,
    )

BASE = Path(__file__).resolve().parent.parent.parent.parent
DATASETS_DIR = BASE / "eval" / "datasets"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Re-run post-processing without retraining.")
    p.add_argument("--source-run-id", required=True, help="Run ID whose /tmp checkpoints to reuse")
    p.add_argument("--run-id", required=True, help="New run ID for output")
    p.add_argument("--dataset", default="fixed-camera-v2")
    p.add_argument("--hysteresis-lo", type=float, default=0.35)
    p.add_argument("--hysteresis-hi", type=float, default=0.50)
    p.add_argument("--min-dur", type=float, default=2.0)
    p.add_argument("--gap-tol", type=float, default=0.0)
    p.add_argument("--start-pad", type=float, default=0.5)
    p.add_argument("--end-pad", type=float, default=1.0)
    p.add_argument(
        "--smooth-frames",
        type=int,
        default=0,
        help="Apply sliding-window mean over N frames before hysteresis (0=disabled). "
        "Reduces intra-rally noise so inter-rally gaps become detectable.",
    )
    return p.parse_args()


def find_checkpoints(source_run_id: str) -> list[Path]:
    pattern = f"rally_state_{source_run_id}_fold*.pt"
    return sorted(Path("/tmp").glob(pattern))


def smooth_probs(probs: np.ndarray, n: int) -> np.ndarray:
    if n <= 1:
        return probs
    kernel = np.ones(n, dtype=np.float32) / n
    # same-mode convolution to preserve length
    smoothed = np.convolve(probs, kernel, mode="same")
    # fix edge effects: first and last n//2 frames use partial averages
    for i in range(min(n // 2, len(probs))):
        smoothed[i] = probs[: i + n // 2 + 1].mean()
        j = len(probs) - 1 - i
        smoothed[j] = probs[max(0, j - n // 2) :].mean()
    return smoothed.astype(np.float32)


def run_inference(ckpt: dict, features: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    model = RallyStateModel(input_dim=int(ckpt["input_dim"]), model_type=ckpt["model_type"])
    model.load_state_dict(ckpt["state_dict"])
    model.eval()
    x = torch.from_numpy((features - mean) / std).float()
    with torch.no_grad():
        logits = model(x)
        probs = torch.sigmoid(logits).numpy().astype(np.float32)
    return probs


def load_ground_truth_labels(dataset: str, clip_id: str, fps: float, n_frames: int) -> np.ndarray:
    label_path = DATASETS_DIR / dataset / "labels" / f"{clip_id}.json"
    with open(label_path, encoding="utf-8") as f:
        label_data = json.load(f)
    y = rasterize.rasterize_label(label_data, fps)
    if len(y) < n_frames:
        y = np.concatenate([y, np.zeros(n_frames - len(y), dtype=np.float32)])
    elif len(y) > n_frames:
        y = y[:n_frames]
    return y


def main() -> None:
    args = parse_args()

    checkpoints = find_checkpoints(args.source_run_id)
    if not checkpoints:
        print(f"No checkpoints in /tmp for run '{args.source_run_id}'.")
        print("Run train.py first to generate checkpoints.")
        sys.exit(1)

    print(f"Source: {args.source_run_id} ({len(checkpoints)} folds found)")
    print(f"Output: {args.run_id}")
    print(
        f"Post-processing: lo={args.hysteresis_lo}, hi={args.hysteresis_hi}, "
        f"min_dur={args.min_dur}s, gap_tol={args.gap_tol}s, "
        f"start_pad={args.start_pad}s, end_pad={args.end_pad}s"
    )
    print()

    processed: list[str] = []
    errors: list[str] = []
    per_clip_metrics: dict[str, dict] = {}
    all_true: list[np.ndarray] = []
    all_pred: list[np.ndarray] = []

    for ckpt_path in checkpoints:
        fold_idx = int(ckpt_path.stem.rsplit("fold", 1)[-1])
        ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
        clip_id: str = ckpt["heldout_clip"]
        fps: float = float(ckpt["fps"])
        mean: np.ndarray = ckpt["mean"].astype(np.float32)
        std: np.ndarray = ckpt["std"].astype(np.float32)

        try:
            cached = extract_features.load_feature_cache(args.dataset, clip_id, fps)
            if cached is None:
                raise RuntimeError(
                    f"Feature cache missing. Run train.py --overwrite-features first."
                )
            features = cached["features"].astype(np.float32)
            duration_sec = float(cached["duration_sec"][0]) if "duration_sec" in cached else 0.0

            t0 = time.perf_counter()
            probs = run_inference(ckpt, features, mean, std)
            runtime_ms = int(round((time.perf_counter() - t0) * 1000))

            smoothed = smooth_probs(probs, args.smooth_frames)
            intervals = postprocess_predictions(
                smoothed,
                fps=fps,
                duration_sec=duration_sec,
                hysteresis_lo=args.hysteresis_lo,
                hysteresis_hi=args.hysteresis_hi,
                min_dur=args.min_dur,
                gap_tol=args.gap_tol,
                start_pad=args.start_pad,
                end_pad=args.end_pad,
            )

            write_video_result(args.run_id, clip_id, duration_sec, fps, intervals, runtime_ms)

            n_frames = len(probs)
            true_y = load_ground_truth_labels(args.dataset, clip_id, fps, n_frames)
            pred_y = intervals_to_labels(intervals, n_frames, fps)
            metrics = binary_metrics(true_y, pred_y)
            per_clip_metrics[clip_id] = metrics
            all_true.append(true_y)
            all_pred.append(pred_y)
            processed.append(clip_id)

            prob_min = float(smoothed.min())
            prob_max = float(smoothed.max())
            prob_mean = float(smoothed.mean())
            print(
                f"  fold {fold_idx:02d} {clip_id}: "
                f"windows={len(intervals)}, "
                f"F1={metrics['f1']:.3f}, P={metrics['precision']:.3f}, R={metrics['recall']:.3f}  "
                f"[p min={prob_min:.3f} mean={prob_mean:.3f} max={prob_max:.3f}]"
            )

        except Exception as exc:
            msg = f"{clip_id}: {exc}"
            print(f"  ERROR {msg}")
            errors.append(msg)

    config = {
        "sourceRunId": args.source_run_id,
        "hysteresisLo": args.hysteresis_lo,
        "hysteresisHi": args.hysteresis_hi,
        "minDur": args.min_dur,
        "gapTol": args.gap_tol,
        "startPad": args.start_pad,
        "endPad": args.end_pad,
        "smoothFrames": args.smooth_frames,
    }
    manifest_path = write_manifest(args.run_id, args.dataset, config, processed, errors)

    if all_true:
        agg = binary_metrics(np.concatenate(all_true), np.concatenate(all_pred))
        print(
            f"\nFrame-level LOCO aggregate: "
            f"F1={agg['f1']:.3f}  P={agg['precision']:.3f}  R={agg['recall']:.3f}"
        )
    print(f"Wrote manifest to {manifest_path}")

    print(f"\nScore:")
    print(
        f"  npm run eval:score -- --run-id {args.run_id} "
        f"--dataset {args.dataset} --baseline-run-id iter-v2-expanded-blob1"
    )


if __name__ == "__main__":
    main()
