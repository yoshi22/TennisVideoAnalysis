#!/usr/bin/env python3
"""
rally-classify.py — G-3 pose-based rally classifier.

Trains on semantic pose features (player positions, velocities, keypoint motion)
with leave-one-clip-out cross-validation, applies temporal smoothing, and
outputs rally windows compatible with score-stage1.ts.

Usage:
  /usr/local/bin/python3.11 scripts/eval/rally-classify.py \
      [--run-id iter-pose1] [--classifier lr|gb] [--threshold 0.5] \
      [--window-half 5] [--gap-tol 3] [--min-dur 4]

Reads:
  eval/datasets/fixed-camera-v1/pose/<clipId>.tsv
  eval/datasets/fixed-camera-v1/labels/<clipId>.json

Writes:
  eval/results/<run-id>/manifest.json
  eval/results/<run-id>/per-video/<clipId>.json
"""

import sys
import os
import json
import argparse
import numpy as np
import pandas as pd
from datetime import datetime, timezone
from pathlib import Path
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import GradientBoostingClassifier, HistGradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report, roc_auc_score

BASE = Path(__file__).parent.parent.parent
POSE_DIR  = BASE / "eval/datasets/fixed-camera-v1/pose"
LABEL_DIR = BASE / "eval/datasets/fixed-camera-v1/labels"

# Post-processing params (mirror rallySegment.ts / train-rally-ml.py)
GAP_TOL_SEC    = 3.0
PAD_START_SEC  = 3.0
PAD_END_SEC    = 4.0
MIN_DUR_SEC    = 4.0
MAX_DUR_SEC    = 30.0
MERGE_EPS_SEC  = 0.25

CLIPS = [
    {"id": "yt-maitou-suzumura-muko-clip1",  "fps": 30, "stride": 6},
    {"id": "yt-maitou-suzumura-muko-clip2",  "fps": 3,  "stride": 1},
    {"id": "yt-maitou-suzumura-fukui-clip1", "fps": 3,  "stride": 1},
]

MAX_PERSONS = 4
KP_LEFT_WRIST  = 9
KP_RIGHT_WRIST = 10
KP_LEFT_ANKLE  = 15
KP_RIGHT_ANKLE = 16


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--run-id", default="iter-pose1")
    p.add_argument("--classifier", choices=["lr", "gb", "hgb"], default="hgb",
                   help="lr=LogisticRegression, gb=GradientBoosting, hgb=HistGradientBoosting")
    p.add_argument("--threshold", type=float, default=0.5)
    p.add_argument("--window-half", type=int, default=5,
                   help="Frames each side for rolling window features (default: 5)")
    p.add_argument("--gap-tol", type=float, default=GAP_TOL_SEC)
    p.add_argument("--min-dur", type=float, default=MIN_DUR_SEC)
    p.add_argument("--max-dur", type=float, default=MAX_DUR_SEC)
    return p.parse_args()


def load_pose(clip_id: str) -> pd.DataFrame:
    path = POSE_DIR / f"{clip_id}.tsv"
    if not path.exists():
        raise FileNotFoundError(f"Pose TSV not found: {path}\nRun pose-extract.py first.")
    return pd.read_csv(path, sep="\t")


def load_gt(clip_id: str) -> list:
    with open(LABEL_DIR / f"{clip_id}.json") as f:
        return json.load(f)["rallies"]


def assign_labels(times: np.ndarray, rallies: list) -> np.ndarray:
    y = np.zeros(len(times), dtype=int)
    for r in rallies:
        y[(times >= r["startSec"]) & (times <= r["endSec"])] = 1
    return y


def _col(df, name):
    if name in df.columns:
        return df[name].values.astype(np.float32)
    return np.full(len(df), np.nan, dtype=np.float32)


def compute_features(df: pd.DataFrame, W: int, times: np.ndarray | None = None) -> np.ndarray:
    """
    Build per-frame semantic feature matrix from pose TSV.
    Returns shape (n_frames, n_features).
    """
    n = len(df)
    MAX_P = MAX_PERSONS

    cx   = np.column_stack([_col(df, f"p{i}_cx")   for i in range(MAX_P)])
    cy   = np.column_stack([_col(df, f"p{i}_cy")   for i in range(MAX_P)])
    conf = np.column_stack([_col(df, f"p{i}_conf") for i in range(MAX_P)])
    wl_x = np.column_stack([_col(df, f"p{i}_wl_x") for i in range(MAX_P)])
    wl_y = np.column_stack([_col(df, f"p{i}_wl_y") for i in range(MAX_P)])
    wr_x = np.column_stack([_col(df, f"p{i}_wr_x") for i in range(MAX_P)])
    wr_y = np.column_stack([_col(df, f"p{i}_wr_y") for i in range(MAX_P)])
    al_x = np.column_stack([_col(df, f"p{i}_al_x") for i in range(MAX_P)])
    al_y = np.column_stack([_col(df, f"p{i}_al_y") for i in range(MAX_P)])
    ar_x = np.column_stack([_col(df, f"p{i}_ar_x") for i in range(MAX_P)])
    ar_y = np.column_stack([_col(df, f"p{i}_ar_y") for i in range(MAX_P)])

    def nanmean_axis1(arr):
        return np.nanmean(arr, axis=1)
    def nanstd_axis1(arr):
        return np.nanstd(arr, axis=1)
    def nansum_axis1(arr):
        return np.nansum(arr, axis=1)

    times_arr = df["timeSec"].values if times is None else times

    def frame_vel(arr):
        vel = np.full(n, np.nan, dtype=np.float32)
        for j in range(1, n):
            dt = float(times_arr[j] - times_arr[j-1])
            if dt <= 0:
                continue
            dx = arr[j] - arr[j-1]
            valid = ~np.isnan(dx)
            if valid.any():
                vel[j] = float(np.sqrt(np.nanmean(dx[valid]**2))) / dt
        return vel

    ip_dist = np.full(n, np.nan, dtype=np.float32)
    for i in range(n):
        vc = cx[i][~np.isnan(cx[i])]
        vcy = cy[i][~np.isnan(cy[i])]
        if len(vc) >= 2:
            ip_dist[i] = float(np.sqrt((vc[0]-vc[1])**2 + (vcy[0]-vcy[1])**2))

    wrists_y = np.concatenate([wl_y, wr_y], axis=1)
    wrists_x = np.concatenate([wl_x, wr_x], axis=1)
    ankles_x = np.concatenate([al_x, ar_x], axis=1)
    ankles_y = np.concatenate([al_y, ar_y], axis=1)

    # Hip columns (present only with new-format TSV; NaN/0 if absent)
    hl_y = np.column_stack([_col(df, f"p{i}_hl_y") for i in range(MAX_P)])
    hr_y = np.column_stack([_col(df, f"p{i}_hr_y") for i in range(MAX_P)])

    # Wrist-above-hip: hip_y - wrist_y > 0 when wrist is above hip (swing)
    wrist_above_hip = np.full(n, np.nan, dtype=np.float32)
    for i in range(n):
        vals = []
        for p in range(MAX_P):
            if not (np.isnan(wl_y[i, p]) or np.isnan(hl_y[i, p])):
                vals.append(float(hl_y[i, p] - wl_y[i, p]))
            if not (np.isnan(wr_y[i, p]) or np.isnan(hr_y[i, p])):
                vals.append(float(hr_y[i, p] - wr_y[i, p]))
        if vals:
            wrist_above_hip[i] = float(np.mean(vals))

    base_feats = {
        "nPersons":        _col(df, "nPersons"),
        "nPersons_conf":   nansum_axis1(conf),
        "cy_mean":         nanmean_axis1(cy),
        "cy_std":          nanstd_axis1(cy),
        "cx_std":          nanstd_axis1(cx),
        "wrist_y_mean":    nanmean_axis1(wrists_y),
        "wrist_y_std":     nanstd_axis1(wrists_y),
        "wrist_x_std":     nanstd_axis1(wrists_x),
        "ankle_x_std":     nanstd_axis1(ankles_x),
        "cx_vel":          frame_vel(cx),
        "cy_vel":          frame_vel(cy),
        "wrist_vel":       frame_vel(np.concatenate([wl_x, wl_y, wr_x, wr_y], axis=1)),
        "ankle_vel":       frame_vel(np.concatenate([al_x, al_y, ar_x, ar_y], axis=1)),
        "ip_dist":         ip_dist,
        "wrist_above_hip": wrist_above_hip,
    }

    # Stack base features into matrix, replace NaN with 0 (zero = not detected)
    base = np.column_stack(list(base_feats.values())).astype(np.float32)
    np.nan_to_num(base, copy=False, nan=0.0)

    # Add rolling window stats (mean, max, std) over ±W frames
    k = base.shape[1]
    result = np.empty((n, k * 4), dtype=np.float32)
    result[:, :k] = base
    for i in range(n):
        lo, hi = max(0, i - W), min(n - 1, i + W)
        window = base[lo : hi + 1]
        result[i, k     : k*2] = window.mean(axis=0)
        result[i, k*2   : k*3] = window.max(axis=0)
        result[i, k*3   :     ] = window.std(axis=0)

    return result


def detections_to_windows(times, gap_tol, min_dur, max_dur):
    """Gap-bridge → pad → duration-filter → overlap-merge (mirrors rallySegment.ts)."""
    if len(times) == 0:
        return []
    windows = []
    gs = times[0]
    gl = times[0]
    for t in times[1:]:
        if t - gl <= gap_tol:
            gl = t
        else:
            dur = gl - gs
            if min_dur <= dur <= max_dur:
                ps = max(0.0, gs - PAD_START_SEC)
                pe = min(ps + max_dur, gl + PAD_END_SEC)
                windows.append({"startSec": float(ps), "endSec": float(pe), "confidence": 1.0})
            gs = gl = t
    dur = gl - gs
    if min_dur <= dur <= max_dur:
        ps = max(0.0, gs - PAD_START_SEC)
        pe = min(ps + max_dur, gl + PAD_END_SEC)
        windows.append({"startSec": float(ps), "endSec": float(pe), "confidence": 1.0})
    if len(windows) <= 1:
        return windows
    merged = [windows[0].copy()]
    for w in windows[1:]:
        if w["startSec"] <= merged[-1]["endSec"] + MERGE_EPS_SEC:
            merged[-1]["endSec"] = max(merged[-1]["endSec"], w["endSec"])
        else:
            merged.append(w.copy())
    return merged


def make_classifier(name: str):
    if name == "lr":
        return LogisticRegression(C=1.0, class_weight="balanced", max_iter=1000, random_state=42)
    if name == "gb":
        return GradientBoostingClassifier(n_estimators=200, max_depth=4, learning_rate=0.05,
                                          subsample=0.8, random_state=42)
    return HistGradientBoostingClassifier(max_iter=300, max_depth=5, learning_rate=0.05,
                                          class_weight="balanced", random_state=42)


def main():
    args = parse_args()
    run_id = args.run_id
    W = args.window_half

    print(f"Run: {run_id}  classifier={args.classifier}  threshold={args.threshold}  W={W}")
    print(f"     gap_tol={args.gap_tol}  min_dur={args.min_dur}  max_dur={args.max_dur}")

    # Load all clip data
    all_data = []
    for cfg in CLIPS:
        df = load_pose(cfg["id"])
        rallies = load_gt(cfg["id"])
        times = df["timeSec"].values
        y = assign_labels(times, rallies)
        X = compute_features(df, W, times)
        pos_pct = 100 * y.mean()
        print(f"  {cfg['id']}: {len(df)} frames, rally={y.sum()} ({pos_pct:.1f}%), X={X.shape}")
        all_data.append({"id": cfg["id"], "times": times, "y": y, "X": X})

    print(f"\n── Leave-one-clip-out CV ──────────────────────────────────")
    all_pred = {}

    for test_idx in range(len(all_data)):
        test_d = all_data[test_idx]
        train_ids = [i for i in range(len(all_data)) if i != test_idx]

        X_train = np.vstack([all_data[i]["X"] for i in train_ids])
        y_train = np.concatenate([all_data[i]["y"] for i in train_ids])
        X_test  = test_d["X"]
        y_test  = test_d["y"]

        # Only scale for LR (tree-based models are scale-invariant)
        scaler = StandardScaler() if args.classifier == "lr" else None
        if scaler:
            X_train_s = scaler.fit_transform(X_train)
            X_test_s  = scaler.transform(X_test)
        else:
            X_train_s = X_train
            X_test_s  = X_test

        clf = make_classifier(args.classifier)
        clf.fit(X_train_s, y_train)

        proba = clf.predict_proba(X_test_s)[:, 1]
        pred  = (proba >= args.threshold).astype(int)

        auc = roc_auc_score(y_test, proba)
        print(f"\nTest: {test_d['id']}")
        print(f"  Train: {len(y_train)} frames (pos={y_train.sum()}, {100*y_train.mean():.1f}%)")
        print(f"  Test:  {len(y_test)} frames (pos={y_test.sum()}, {100*y_test.mean():.1f}%)")
        print(f"  AUC={auc:.3f}  Pred pos: {pred.sum()} @ threshold={args.threshold}")
        print(classification_report(y_test, pred, target_names=["inter", "rally"], digits=3))

        all_pred[test_d["id"]] = (test_d["times"], proba)

    # Write eval results
    run_dir = BASE / "eval/results" / run_id
    per_video_dir = run_dir / "per-video"
    per_video_dir.mkdir(parents=True, exist_ok=True)

    print("\n── Rally windows ──────────────────────────────────────────")
    for clip_id, (times, proba) in all_pred.items():
        det_times = times[proba >= args.threshold]
        windows = detections_to_windows(det_times, args.gap_tol, args.min_dur, args.max_dur)

        result = {
            "videoId": clip_id,
            "videoDurationSec": 600,
            "scanFps": 5,
            "detectedRallies": windows,
        }
        out = per_video_dir / f"{clip_id}.json"
        with open(out, "w") as f:
            json.dump(result, f, indent=2)
        print(f"  {clip_id}: {len(windows)} windows → {out}")

    manifest = {
        "runId": run_id,
        "dataset": "fixed-camera-v1",
        "fps": 5,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "config": {
            "model": f"pose+{args.classifier}",
            "window_half": W,
            "threshold": args.threshold,
            "gap_tol_sec": args.gap_tol,
            "min_dur_sec": args.min_dur,
            "max_dur_sec": args.max_dur,
        },
    }
    with open(run_dir / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\nDone. Score with:")
    print(f"  npm run eval:score -- --run-id {run_id} --dataset fixed-camera-v1 --baseline-run-id iter-fc6-3clip")


if __name__ == "__main__":
    main()
