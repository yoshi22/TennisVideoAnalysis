#!/usr/bin/env python3
"""Train and evaluate a lightweight rally-state temporal model with LOCO CV."""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # scripts/eval, for _common
from _common import load_json

if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parent))
    import extract_features  # type: ignore
    import rasterize  # type: ignore
    from model import RallyStateModel  # type: ignore
else:
    from . import extract_features, rasterize
    from .model import RallyStateModel

BASE = Path(__file__).resolve().parent.parent.parent.parent
DATASETS_DIR = BASE / "eval" / "datasets"
RESULTS_DIR = BASE / "eval" / "results"

FEATURE_NAMES = [
    "bg_diff_frac_lo",
    "bg_diff_frac_hi",
    "bg_diff_upper_frac",
    "bg_diff_lower_frac",
    "frame_diff_frac",
    "frame_diff_upper_frac",
    "frame_diff_lower_frac",
    "pose_dx",
    "pose_dy",
    "audio_onset",
]


@dataclass
class ClipSequence:
    clip_id: str
    x: np.ndarray
    y: np.ndarray
    duration_sec: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train rally-state model with leave-one-clip-out CV.")
    parser.add_argument("--dataset", default="fixed-camera-v2")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--fps", type=float, default=3.0)
    parser.add_argument("--model", choices=("tcn", "gru"), default="tcn")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--lr", type=float, default=0.001)
    parser.add_argument("--hysteresis-lo", type=float, default=0.35)
    parser.add_argument("--hysteresis-hi", type=float, default=0.55)
    parser.add_argument("--min-dur", type=float, default=4.0)
    parser.add_argument("--gap-tol", type=float, default=3.0)
    parser.add_argument("--device", default="auto", choices=("auto", "mps", "cuda", "cpu"))
    parser.add_argument("--overwrite-features", action="store_true")
    return parser.parse_args()


def clip_duration_sec(dataset: str, clip_id: str) -> float:
    return rasterize.clip_duration(load_json(DATASETS_DIR / dataset / "labels" / f"{clip_id}.json"))


def resolve_device(value: str) -> torch.device:
    if value == "auto":
        if torch.backends.mps.is_available():
            return torch.device("mps")
        if torch.cuda.is_available():
            return torch.device("cuda")
        return torch.device("cpu")
    return torch.device(value)


def is_mps_fallback_error(exc: BaseException) -> bool:
    message = str(exc).lower()
    return "mps" in message or "metal" in message or "not currently implemented" in message


def first_error_line(exc: BaseException) -> str:
    return str(exc).splitlines()[0] if str(exc).splitlines() else repr(exc)


def ensure_labels(dataset: str, fps: float) -> dict[str, np.ndarray]:
    labels = rasterize.load_cache(dataset, fps)
    if labels is not None:
        return labels
    labels = rasterize.rasterize_dataset(dataset, fps)
    out_path = rasterize.write_cache(dataset, fps, labels)
    print(f"Wrote label cache: {out_path}")
    return labels


def ensure_feature_cache(dataset: str, clip_id: str, fps: float, overwrite: bool = False) -> dict[str, np.ndarray]:
    if overwrite or extract_features.load_feature_cache(dataset, clip_id, fps) is None:
        extract_features.extract_clip_features(dataset, clip_id, fps, overwrite=overwrite)
    cached = extract_features.load_feature_cache(dataset, clip_id, fps)
    if cached is None:
        raise RuntimeError(f"Feature cache missing or invalid for {clip_id}")
    return cached


def align_features_and_labels(
    clip_id: str,
    features: np.ndarray,
    labels: np.ndarray,
    duration_sec: float,
) -> ClipSequence:
    x = features.astype(np.float32)
    y = labels.astype(np.float32)
    if len(x) < len(y):
        pad_len = len(y) - len(x)
        pad = np.repeat(x[-1:, :], pad_len, axis=0) if len(x) else np.zeros((pad_len, len(FEATURE_NAMES)), dtype=np.float32)
        x = np.concatenate([x, pad], axis=0)
    elif len(x) > len(y):
        x = x[: len(y)]
    return ClipSequence(clip_id=clip_id, x=x, y=y, duration_sec=duration_sec)


def load_sequences(dataset: str, fps: float, overwrite_features: bool = False) -> dict[str, ClipSequence]:
    labels = ensure_labels(dataset, fps)
    sequences: dict[str, ClipSequence] = {}
    for clip_id in rasterize.clip_ids_from_labels(dataset):
        if clip_id not in labels:
            raise RuntimeError(f"Missing raster labels for {clip_id}")
        cached = ensure_feature_cache(dataset, clip_id, fps, overwrite=overwrite_features)
        duration = float(cached["duration_sec"][0]) if "duration_sec" in cached else clip_duration_sec(dataset, clip_id)
        sequences[clip_id] = align_features_and_labels(clip_id, cached["features"], labels[clip_id], duration)
    return sequences


def normalize_stats(sequences: dict[str, ClipSequence], train_ids: list[str]) -> tuple[np.ndarray, np.ndarray]:
    x_train = np.concatenate([sequences[clip_id].x for clip_id in train_ids], axis=0)
    mean = x_train.mean(axis=0).astype(np.float32)
    std = x_train.std(axis=0).astype(np.float32)
    std[std < 1e-6] = 1.0
    return mean, std


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


def checkpoint_path(run_id: str, fold_idx: int) -> Path:
    return Path("/tmp") / f"rally_state_{run_id}_fold{fold_idx}.pt"


def save_checkpoint(
    path: Path,
    model: RallyStateModel,
    args: argparse.Namespace,
    fold_idx: int,
    heldout_clip: str,
    mean: np.ndarray,
    std: np.ndarray,
) -> None:
    state_dict = {key: value.detach().cpu() for key, value in model.state_dict().items()}
    torch.save(
        {
            "state_dict": state_dict,
            "input_dim": int(model.input_dim),
            "model_type": model.model_type,
            "fps": float(args.fps),
            "run_id": args.run_id,
            "fold_idx": int(fold_idx),
            "heldout_clip": heldout_clip,
            "mean": mean.astype(np.float32),
            "std": std.astype(np.float32),
            "feature_names": FEATURE_NAMES,
            "config": {
                "epochs": args.epochs,
                "lr": args.lr,
                "hysteresisLo": args.hysteresis_lo,
                "hysteresisHi": args.hysteresis_hi,
                "minDur": args.min_dur,
                "gapTol": args.gap_tol,
            },
        },
        path,
    )


def postprocess_predictions(
    probs: np.ndarray,
    fps: float,
    duration_sec: float,
    hysteresis_lo: float,
    hysteresis_hi: float,
    min_dur: float,
    gap_tol: float,
    start_pad: float = 3.0,
    end_pad: float = 4.0,
) -> list[dict[str, float]]:
    raw: list[tuple[int, int]] = []
    active = False
    hi_count = 0
    lo_count = 0
    start_idx = 0

    for i, value in enumerate(probs):
        if not active:
            if value >= hysteresis_hi:
                hi_count += 1
                if hi_count >= 2:
                    active = True
                    start_idx = i - hi_count + 1
                    lo_count = 0
            else:
                hi_count = 0
        else:
            if value <= hysteresis_lo:
                lo_count += 1
                if lo_count >= 2:
                    end_idx = i - lo_count + 1
                    if end_idx > start_idx:
                        raw.append((start_idx, end_idx))
                    active = False
                    hi_count = 0
                    lo_count = 0
            else:
                lo_count = 0

    if active and len(probs) > start_idx:
        raw.append((start_idx, len(probs)))

    windows: list[dict[str, float]] = []
    for start_i, end_i in raw:
        start_sec = (start_i / fps) - start_pad
        end_sec = (end_i / fps) + end_pad
        if end_sec - start_sec < min_dur:
            continue
        conf_values = probs[start_i:end_i]
        confidence = float(conf_values.mean()) if len(conf_values) else 0.0
        windows.append(
            {
                "startSec": start_sec,
                "endSec": end_sec,
                "confidence": confidence,
            }
        )

    windows.sort(key=lambda item: item["startSec"])
    merged: list[dict[str, float]] = []
    for window in windows:
        if merged and window["startSec"] - merged[-1]["endSec"] < gap_tol:
            merged[-1]["endSec"] = max(merged[-1]["endSec"], window["endSec"])
            merged[-1]["confidence"] = max(merged[-1]["confidence"], window["confidence"])
        else:
            merged.append(dict(window))

    clamped: list[dict[str, float]] = []
    for window in merged:
        start = max(0.0, min(float(duration_sec), window["startSec"]))
        end = max(0.0, min(float(duration_sec), window["endSec"]))
        if end - start < min_dur:
            continue
        clamped.append(
            {
                "startSec": round(start, 3),
                "endSec": round(end, 3),
                "confidence": round(float(window["confidence"]), 4),
            }
        )
    return clamped


def intervals_to_labels(intervals: list[dict[str, float]], n_frames: int, fps: float) -> np.ndarray:
    y = np.zeros(n_frames, dtype=np.float32)
    for interval in intervals:
        start = max(0, int(np.floor(float(interval["startSec"]) * fps)))
        end = min(n_frames, int(np.ceil(float(interval["endSec"]) * fps)))
        if end > start:
            y[start:end] = 1.0
    return y


def binary_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float]:
    true = y_true.astype(bool)
    pred = y_pred.astype(bool)
    tp = float(np.logical_and(true, pred).sum())
    fp = float(np.logical_and(~true, pred).sum())
    fn = float(np.logical_and(true, ~pred).sum())
    precision = tp / (tp + fp) if tp + fp > 0 else 0.0
    recall = tp / (tp + fn) if tp + fn > 0 else 0.0
    f1 = 2.0 * precision * recall / (precision + recall) if precision + recall > 0 else 0.0
    return {"precision": precision, "recall": recall, "f1": f1}


def write_video_result(
    run_id: str,
    clip_id: str,
    duration_sec: float,
    fps: float,
    intervals: list[dict[str, float]],
    runtime_ms: int,
) -> Path:
    out_dir = RESULTS_DIR / run_id / "per-video"
    out_dir.mkdir(parents=True, exist_ok=True)
    result = {
        "videoId": clip_id,
        "videoDurationSec": round(float(duration_sec), 2),
        "scanFps": float(fps),
        "detectedRallies": intervals,
        "runtimeMs": int(runtime_ms),
    }
    out_path = out_dir / f"{clip_id}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
        f.write("\n")
    return out_path


def write_manifest(run_id: str, dataset: str, config: dict[str, Any], processed: list[str], errors: list[str]) -> Path:
    run_dir = RESULTS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "runId": run_id,
        "dataset": dataset,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "config": config,
        "clipsProcessed": processed,
        "errors": errors,
    }
    path = run_dir / "manifest.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    return path


def train_fold_once(
    fold_idx: int,
    heldout_clip: str,
    clip_ids: list[str],
    sequences: dict[str, ClipSequence],
    args: argparse.Namespace,
    device: torch.device,
) -> tuple[list[dict[str, float]], np.ndarray, int]:
    train_ids = [clip_id for clip_id in clip_ids if clip_id != heldout_clip]
    mean, std = normalize_stats(sequences, train_ids)
    input_dim = sequences[heldout_clip].x.shape[1]
    model = RallyStateModel(input_dim=input_dim, model_type=args.model).to(device)

    positives = float(sum(sequences[clip_id].y.sum() for clip_id in train_ids))
    total = float(sum(len(sequences[clip_id].y) for clip_id in train_ids))
    negatives = max(0.0, total - positives)
    pos_weight_value = negatives / positives if positives > 0 else 1.0
    pos_weight = torch.tensor([pos_weight_value], dtype=torch.float32, device=device)
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)

    print(
        f"Fold {fold_idx}: heldout={heldout_clip}, device={device}, "
        f"params={count_parameters(model)}, pos_weight={pos_weight_value:.3f}"
    )

    for epoch in range(1, args.epochs + 1):
        model.train()
        losses: list[float] = []
        for clip_id in train_ids:
            seq = sequences[clip_id]
            x = torch.from_numpy((seq.x - mean) / std).to(device=device, dtype=torch.float32)
            y = torch.from_numpy(seq.y).to(device=device, dtype=torch.float32)
            optimizer.zero_grad(set_to_none=True)
            logits = model(x)
            loss = loss_fn(logits, y)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
            optimizer.step()
            losses.append(float(loss.detach().cpu()))

        if epoch == 1 or epoch == args.epochs or epoch % 10 == 0:
            print(f"  epoch {epoch:03d}/{args.epochs}: loss={np.mean(losses):.4f}")

    save_checkpoint(checkpoint_path(args.run_id, fold_idx), model, args, fold_idx, heldout_clip, mean, std)

    heldout = sequences[heldout_clip]
    x_test = torch.from_numpy((heldout.x - mean) / std).to(device=device, dtype=torch.float32)
    model.eval()
    started = time.perf_counter()
    with torch.no_grad():
        logits = model(x_test)
        probs = torch.sigmoid(logits).detach().cpu().numpy().astype(np.float32)
    runtime_ms = int(round((time.perf_counter() - started) * 1000.0))
    intervals = postprocess_predictions(
        probs,
        fps=args.fps,
        duration_sec=heldout.duration_sec,
        hysteresis_lo=args.hysteresis_lo,
        hysteresis_hi=args.hysteresis_hi,
        min_dur=args.min_dur,
        gap_tol=args.gap_tol,
    )
    return intervals, probs, runtime_ms


def train_fold_with_fallback(
    fold_idx: int,
    heldout_clip: str,
    clip_ids: list[str],
    sequences: dict[str, ClipSequence],
    args: argparse.Namespace,
    device: torch.device,
) -> tuple[list[dict[str, float]], np.ndarray, int, torch.device]:
    try:
        intervals, probs, runtime_ms = train_fold_once(fold_idx, heldout_clip, clip_ids, sequences, args, device)
        return intervals, probs, runtime_ms, device
    except (RuntimeError, NotImplementedError) as exc:
        if device.type != "mps" or not is_mps_fallback_error(exc):
            raise
        print(f"WARNING: MPS training failed ({first_error_line(exc)}); falling back to CPU.")
        cpu = torch.device("cpu")
        intervals, probs, runtime_ms = train_fold_once(fold_idx, heldout_clip, clip_ids, sequences, args, cpu)
        return intervals, probs, runtime_ms, cpu


def main() -> None:
    args = parse_args()
    if args.epochs < 1:
        raise SystemExit("--epochs must be >= 1")
    if not (0.0 <= args.hysteresis_lo <= args.hysteresis_hi <= 1.0):
        raise SystemExit("Expected 0 <= --hysteresis-lo <= --hysteresis-hi <= 1")

    sequences = load_sequences(args.dataset, args.fps, overwrite_features=args.overwrite_features)
    clip_ids = list(sequences.keys())
    if len(clip_ids) < 2:
        raise SystemExit("LOCO CV requires at least two clips")

    device = resolve_device(args.device)
    print(f"Run: {args.run_id}")
    print(f"Dataset: {args.dataset}")
    print(f"Clips: {clip_ids}")
    print(f"Initial device: {device}")

    processed: list[str] = []
    errors: list[str] = []
    per_clip_metrics: dict[str, dict[str, float]] = {}
    all_true: list[np.ndarray] = []
    all_pred: list[np.ndarray] = []

    for fold_idx, heldout_clip in enumerate(clip_ids):
        try:
            intervals, _probs, runtime_ms, used_device = train_fold_with_fallback(
                fold_idx, heldout_clip, clip_ids, sequences, args, device
            )
            if device.type == "mps" and used_device.type == "cpu":
                device = used_device
            seq = sequences[heldout_clip]
            write_video_result(args.run_id, heldout_clip, seq.duration_sec, args.fps, intervals, runtime_ms)
            pred_y = intervals_to_labels(intervals, len(seq.y), args.fps)
            metrics = binary_metrics(seq.y, pred_y)
            per_clip_metrics[heldout_clip] = metrics
            all_true.append(seq.y)
            all_pred.append(pred_y)
            processed.append(heldout_clip)
            print(
                f"  {heldout_clip}: windows={len(intervals)}, "
                f"F1={metrics['f1']:.3f}, P={metrics['precision']:.3f}, R={metrics['recall']:.3f}"
            )
        except Exception as exc:
            message = f"{heldout_clip}: {exc}"
            print(f"ERROR: {message}")
            errors.append(message)

    config = {
        "model": args.model,
        "fps": args.fps,
        "epochs": args.epochs,
        "lr": args.lr,
        "hysteresisLo": args.hysteresis_lo,
        "hysteresisHi": args.hysteresis_hi,
        "minDur": args.min_dur,
        "gapTol": args.gap_tol,
        "featureNames": FEATURE_NAMES,
    }
    manifest_path = write_manifest(args.run_id, args.dataset, config, processed, errors)

    if all_true:
        aggregate = binary_metrics(np.concatenate(all_true), np.concatenate(all_pred))
        print("\nFrame-level LOCO metrics:")
        print(
            f"F1={aggregate['f1']:.3f}  "
            f"precision={aggregate['precision']:.3f}  recall={aggregate['recall']:.3f}"
        )
        for clip_id in processed:
            metrics = per_clip_metrics[clip_id]
            print(
                f"{clip_id}: F1={metrics['f1']:.3f}  "
                f"P={metrics['precision']:.3f}  R={metrics['recall']:.3f}"
            )
    print(f"Wrote manifest to {manifest_path}")
    if errors:
        print(f"Errors ({len(errors)}): {errors}")


if __name__ == "__main__":
    main()
