#!/usr/bin/env python3
"""
train-rally-ml.py — 1D sliding-window ML classifier for rally detection.

Trains on per-frame features from debug-density.ts with GT labels via
leave-one-clip-out cross-validation. Writes eval results compatible with
score-stage1.ts.

Usage:
  /usr/local/bin/python3.11 scripts/eval/train-rally-ml.py [--run-id <id>] [--threshold <float>]

Reads:
  /tmp/density-clip1.tsv  (30fps clip1, stride=10 → 3fps-equivalent)
  /tmp/density-clip2.tsv
  /tmp/density-fukui.tsv
  eval/datasets/fixed-camera-v1/labels/*.json

Writes:
  eval/results/<run-id>/manifest.json
  eval/results/<run-id>/per-video/<videoId>.json
"""

import json
import os
import sys
import argparse
import numpy as np
import pandas as pd
from datetime import datetime, timezone
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report

# ── Post-processing params (mirror rallySegment.ts defaults) ──────────────────
GAP_TOL_SEC = 3.0
PAD_START_SEC = 3.0
PAD_END_SEC = 4.0
MIN_DUR_SEC = 4.0
MAX_DUR_SEC = 30.0
MERGE_EPSILON_SEC = 0.25

# ── Feature extraction params ─────────────────────────────────────────────────
WINDOW_HALF = 5  # ±5 frames → 11-frame window ≈ 3.7s at 3fps
FEATURE_COLS = [
    "rawMotionPx", "motionPx", "blobCount",
    "rawTopHalf", "rawBotHalf", "rawLeftHalf", "rawRightHalf",
]

# ── Clip definitions ──────────────────────────────────────────────────────────
CLIPS = [
    {
        "id": "yt-maitou-suzumura-muko-clip1",
        "tsv": "/tmp/density-clip1.tsv",
        "label": "eval/datasets/fixed-camera-v1/labels/yt-maitou-suzumura-muko-clip1.json",
    },
    {
        "id": "yt-maitou-suzumura-muko-clip2",
        "tsv": "/tmp/density-clip2.tsv",
        "label": "eval/datasets/fixed-camera-v1/labels/yt-maitou-suzumura-muko-clip2.json",
    },
    {
        "id": "yt-maitou-suzumura-fukui-clip1",
        "tsv": "/tmp/density-fukui.tsv",
        "label": "eval/datasets/fixed-camera-v1/labels/yt-maitou-suzumura-fukui-clip1.json",
    },
]


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--run-id", default="iter-ml1")
    p.add_argument("--threshold", type=float, default=0.5,
                   help="Probability threshold for rally classification (default: 0.5)")
    p.add_argument("--window-half", type=int, default=WINDOW_HALF,
                   help="Frames on each side of sliding window (default: 5)")
    return p.parse_args()


def load_clip_data(clip):
    tsv = clip["tsv"]
    if not os.path.exists(tsv):
        print(f"ERROR: {tsv} not found. Run debug-density.ts first.", file=sys.stderr)
        sys.exit(1)
    df = pd.read_csv(tsv, sep="\t")

    with open(clip["label"]) as f:
        gt = json.load(f)
    times = df["timeSec"].values
    labels = np.zeros(len(times), dtype=int)
    for rally in gt["rallies"]:
        mask = (times >= rally["startSec"]) & (times <= rally["endSec"])
        labels[mask] = 1

    return df, times, labels


def make_window_features(df, feature_cols, W):
    """
    For each frame i, concatenate raw values + sliding window stats (mean/max/std)
    over frames [i-W .. i+W]. Result shape: (n_frames, n_features * 4).
    """
    raw = df[feature_cols].values.astype(np.float32)
    n = len(raw)
    n_feat = len(feature_cols)
    result = np.empty((n, n_feat * 4), dtype=np.float32)

    for i in range(n):
        lo, hi = max(0, i - W), min(n - 1, i + W)
        window = raw[lo : hi + 1]
        result[i, :n_feat] = raw[i]
        result[i, n_feat : n_feat * 2] = window.mean(axis=0)
        result[i, n_feat * 2 : n_feat * 3] = window.max(axis=0)
        result[i, n_feat * 3 :] = window.std(axis=0)

    return result


def detections_to_windows(detection_times):
    """
    Convert sorted array of detection timestamps to rally windows using the
    same logic as mergeDetectionsIntoWindows (rallySegment.ts):
    gap-bridge → pad → duration-filter → overlap-merge.
    """
    if len(detection_times) == 0:
        return []

    windows = []
    group_start = detection_times[0]
    group_last = detection_times[0]

    for t in detection_times[1:]:
        if t - group_last <= GAP_TOL_SEC:
            group_last = t
        else:
            dur = group_last - group_start
            if MIN_DUR_SEC <= dur <= MAX_DUR_SEC:
                padded_start = max(0.0, group_start - PAD_START_SEC)
                padded_end = min(padded_start + MAX_DUR_SEC, group_last + PAD_END_SEC)
                windows.append({"startSec": float(padded_start), "endSec": float(padded_end), "confidence": 1.0})
            group_start = t
            group_last = t

    # Last group
    dur = group_last - group_start
    if MIN_DUR_SEC <= dur <= MAX_DUR_SEC:
        padded_start = max(0.0, group_start - PAD_START_SEC)
        padded_end = min(padded_start + MAX_DUR_SEC, group_last + PAD_END_SEC)
        windows.append({"startSec": float(padded_start), "endSec": float(padded_end), "confidence": 1.0})

    # Merge overlapping / near-touching windows (epsilon from rallySegment.ts)
    if len(windows) <= 1:
        return windows
    merged = [windows[0].copy()]
    for w in windows[1:]:
        if w["startSec"] <= merged[-1]["endSec"] + MERGE_EPSILON_SEC:
            merged[-1]["endSec"] = max(merged[-1]["endSec"], w["endSec"])
        else:
            merged.append(w.copy())

    return merged


def main():
    args = parse_args()
    run_id = args.run_id
    threshold = args.threshold
    W = args.window_half

    print(f"Run: {run_id}  threshold={threshold}  window_half={W}")

    # ── Load data ─────────────────────────────────────────────────────────────
    all_data = []
    for clip in CLIPS:
        df, times, labels = load_clip_data(clip)
        X = make_window_features(df, FEATURE_COLS, W)
        pos_pct = 100 * labels.mean()
        print(f"  {clip['id']}: {len(df)} frames, {labels.sum()} rally ({pos_pct:.1f}%), X={X.shape}")
        all_data.append({"clip": clip, "df": df, "times": times, "labels": labels, "X": X})

    # ── Leave-one-clip-out CV ─────────────────────────────────────────────────
    print(f"\n── Leave-one-clip-out CV ─────────────────────────────")
    all_pred_proba = {}

    for test_idx in range(len(all_data)):
        test_d = all_data[test_idx]
        train_ids = [i for i in range(len(all_data)) if i != test_idx]

        X_train = np.vstack([all_data[i]["X"] for i in train_ids])
        y_train = np.concatenate([all_data[i]["labels"] for i in train_ids])
        X_test = test_d["X"]
        y_test = test_d["labels"]

        scaler = StandardScaler()
        X_train_s = scaler.fit_transform(X_train)
        X_test_s = scaler.transform(X_test)

        clf = HistGradientBoostingClassifier(
            max_iter=300,
            max_depth=5,
            learning_rate=0.05,
            class_weight="balanced",
            random_state=42,
        )
        clf.fit(X_train_s, y_train)

        pred_proba = clf.predict_proba(X_test_s)[:, 1]
        pred = (pred_proba >= threshold).astype(int)

        clip_id = test_d["clip"]["id"]
        all_pred_proba[clip_id] = (test_d["times"], pred_proba)

        print(f"\nTest: {clip_id}")
        print(f"  Train: {len(y_train)} frames (pos={y_train.sum()}, {100*y_train.mean():.1f}%)")
        print(f"  Test:  {len(y_test)} frames (pos={y_test.sum()}, {100*y_test.mean():.1f}%)")
        print(f"  Pred pos: {pred.sum()} ({100*pred.mean():.1f}%) @ threshold={threshold}")
        print(classification_report(y_test, pred, target_names=["inter", "rally"], digits=3))

    # ── Write eval results ────────────────────────────────────────────────────
    run_dir = os.path.join("eval", "results", run_id)
    per_video_dir = os.path.join(run_dir, "per-video")
    os.makedirs(per_video_dir, exist_ok=True)

    print("\n── Rally windows ─────────────────────────────────────")
    for clip_id, (times, pred_proba) in all_pred_proba.items():
        detection_times = times[pred_proba >= threshold]
        windows = detections_to_windows(detection_times)

        result = {
            "videoId": clip_id,
            "videoDurationSec": 600,
            "scanFps": 3,
            "detectedRallies": windows,
        }
        out_path = os.path.join(per_video_dir, f"{clip_id}.json")
        with open(out_path, "w") as f:
            json.dump(result, f, indent=2)
        print(f"  {clip_id}: {len(windows)} windows → {out_path}")

    manifest = {
        "runId": run_id,
        "dataset": "fixed-camera-v1",
        "fps": 3,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "config": {
            "model": "HistGradientBoosting",
            "window_half": W,
            "threshold": threshold,
            "gap_tol_sec": GAP_TOL_SEC,
            "min_dur_sec": MIN_DUR_SEC,
            "max_dur_sec": MAX_DUR_SEC,
        },
    }
    with open(os.path.join(run_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\nDone. Score with:")
    print(f"  npm run eval:score -- --run-id {run_id} --dataset fixed-camera-v1 --baseline-run-id iter-fc6-3clip")


if __name__ == "__main__":
    main()
