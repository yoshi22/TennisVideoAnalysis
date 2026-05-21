#!/usr/bin/env python3
"""
pose-gate.py — G-2 analysis gate: check if pose-derived semantic features
can separate rally vs inter-point WITHOUT training a classifier.

Computes per-frame activity metrics from pose TSVs, then reports:
  - Per-clip mean(rally activity) vs mean(inter-point activity) — sign must match
  - Per-clip ROC-AUC for the best single feature (must be > 0.75 in all clips)
  - Verdict: PASS (viable → proceed to rally-classify.py) or FAIL (escalate)

Usage:
  /usr/local/bin/python3.11 scripts/eval/pose-gate.py

Reads:
  eval/datasets/fixed-camera-v1/pose/<clipId>.tsv
  eval/datasets/fixed-camera-v1/labels/<clipId>.json
"""

import sys
import json
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.metrics import roc_auc_score

BASE = Path(__file__).parent.parent.parent
POSE_DIR  = BASE / "eval/datasets/fixed-camera-v1/pose"
LABEL_DIR = BASE / "eval/datasets/fixed-camera-v1/labels"

CLIPS = [
    "yt-maitou-suzumura-muko-clip1",
    "yt-maitou-suzumura-muko-clip2",
    "yt-maitou-suzumura-fukui-clip1",
]

CLIP_FPS = {
    "yt-maitou-suzumura-muko-clip1":  30,
    "yt-maitou-suzumura-muko-clip2":  3,
    "yt-maitou-suzumura-fukui-clip1": 3,
}


def load_pose(clip_id: str) -> pd.DataFrame:
    path = POSE_DIR / f"{clip_id}.tsv"
    if not path.exists():
        raise FileNotFoundError(f"Pose TSV not found: {path}\nRun pose-extract.py first.")
    df = pd.read_csv(path, sep="\t")
    return df


def load_gt(clip_id: str) -> list[dict]:
    path = LABEL_DIR / f"{clip_id}.json"
    with open(path) as f:
        return json.load(f)["rallies"]


def assign_gt_labels(times: np.ndarray, rallies: list[dict]) -> np.ndarray:
    labels = np.zeros(len(times), dtype=int)
    for r in rallies:
        mask = (times >= r["startSec"]) & (times <= r["endSec"])
        labels[mask] = 1
    return labels


def compute_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute semantic activity features per frame from pose TSV.
    Returns a DataFrame with one row per frame and feature columns.
    """
    feats = pd.DataFrame()
    feats["timeSec"] = df["timeSec"]
    feats["nPersons"] = df["nPersons"]

    MAX_P = 4
    # Person center x/y arrays (NaN if absent)
    cx = np.column_stack([df.get(f"p{i}_cx", np.full(len(df), np.nan)) for i in range(MAX_P)])
    cy = np.column_stack([df.get(f"p{i}_cy", np.full(len(df), np.nan)) for i in range(MAX_P)])
    conf = np.column_stack([df.get(f"p{i}_conf", np.full(len(df), np.nan)) for i in range(MAX_P)])

    # Wrist positions
    wl_x = np.column_stack([df.get(f"p{i}_wl_x", np.full(len(df), np.nan)) for i in range(MAX_P)])
    wl_y = np.column_stack([df.get(f"p{i}_wl_y", np.full(len(df), np.nan)) for i in range(MAX_P)])
    wr_x = np.column_stack([df.get(f"p{i}_wr_x", np.full(len(df), np.nan)) for i in range(MAX_P)])
    wr_y = np.column_stack([df.get(f"p{i}_wr_y", np.full(len(df), np.nan)) for i in range(MAX_P)])

    # Ankle positions
    al_x = np.column_stack([df.get(f"p{i}_al_x", np.full(len(df), np.nan)) for i in range(MAX_P)])
    al_y = np.column_stack([df.get(f"p{i}_al_y", np.full(len(df), np.nan)) for i in range(MAX_P)])
    ar_x = np.column_stack([df.get(f"p{i}_ar_x", np.full(len(df), np.nan)) for i in range(MAX_P)])
    ar_y = np.column_stack([df.get(f"p{i}_ar_y", np.full(len(df), np.nan)) for i in range(MAX_P)])

    n = len(df)

    # Confidence-weighted person count
    feats["nPersons_conf"] = np.nansum(conf, axis=1)

    # Mean y-position of players (rally: wide spread; inter: clustered near baselines or net)
    feats["cy_mean"] = np.nanmean(cy, axis=1)
    feats["cy_std"]  = np.nanstd(cy, axis=1)
    feats["cx_std"]  = np.nanstd(cx, axis=1)

    # Wrist height (wrists higher = more active swinging; lower = idle)
    wrists_y = np.concatenate([wl_y, wr_y], axis=1)
    feats["wrist_y_mean"] = np.nanmean(wrists_y, axis=1)
    feats["wrist_y_std"]  = np.nanstd(wrists_y, axis=1)

    # Wrist spread (x-spread indicates swing width)
    wrists_x = np.concatenate([wl_x, wr_x], axis=1)
    feats["wrist_x_std"] = np.nanstd(wrists_x, axis=1)

    # Ankle spread (wide stance = rally; narrow = walking)
    ankles_x = np.concatenate([al_x, ar_x], axis=1)
    feats["ankle_x_std"] = np.nanstd(ankles_x, axis=1)

    # Frame-to-frame velocity features (units/second, normalized by dt for cross-clip consistency)
    times_arr = df["timeSec"].values

    def frame_velocity(arr):
        """RMS velocity (units/sec) of non-nan columns, shifted by 1."""
        vel = np.full(n, np.nan)
        for j in range(1, n):
            dt = float(times_arr[j] - times_arr[j-1])
            if dt <= 0:
                continue
            dx = arr[j] - arr[j-1]
            valid = ~np.isnan(dx)
            if valid.any():
                vel[j] = np.sqrt(np.nanmean(dx[valid]**2)) / dt
        return vel

    feats["cx_vel"]     = frame_velocity(cx)
    feats["cy_vel"]     = frame_velocity(cy)
    feats["wrist_vel"]  = frame_velocity(np.concatenate([wl_x, wl_y, wr_x, wr_y], axis=1))
    feats["ankle_vel"]  = frame_velocity(np.concatenate([al_x, al_y, ar_x, ar_y], axis=1))

    # Inter-player distance (relevant if exactly 2 players detected)
    ip_dist = np.full(n, np.nan)
    for i in range(n):
        valid_cx = cx[i][~np.isnan(cx[i])]
        valid_cy = cy[i][~np.isnan(cy[i])]
        if len(valid_cx) >= 2:
            ip_dist[i] = np.sqrt((valid_cx[0]-valid_cx[1])**2 + (valid_cy[0]-valid_cy[1])**2)
    feats["ip_dist"] = ip_dist

    # Hip keypoints (present only with new-format TSV; NaN if absent)
    hl_x = np.column_stack([df.get(f"p{i}_hl_x", np.full(n, np.nan)) for i in range(MAX_P)])
    hl_y = np.column_stack([df.get(f"p{i}_hl_y", np.full(n, np.nan)) for i in range(MAX_P)])
    hr_y = np.column_stack([df.get(f"p{i}_hr_y", np.full(n, np.nan)) for i in range(MAX_P)])

    # Wrist-above-hip: hip_y - wrist_y > 0 when wrist is above hip (swing) (image coords: y↓)
    wrist_ys_all = np.concatenate([wl_y, wr_y], axis=1)   # (n, 2*MAX_P)
    hip_ys_all   = np.concatenate([hl_y, hr_y], axis=1)   # (n, 2*MAX_P)
    # Pair each wrist with corresponding hip (left wrist ↔ left hip, right ↔ right hip)
    wrist_above_hip = np.full(n, np.nan)
    for i in range(n):
        vals = []
        for p in range(MAX_P):
            wl_yi = wl_y[i, p] if not np.isnan(wl_y[i, p]) else np.nan
            wr_yi = wr_y[i, p] if not np.isnan(wr_y[i, p]) else np.nan
            hl_yi = hl_y[i, p] if not np.isnan(hl_y[i, p]) else np.nan
            hr_yi = hr_y[i, p] if not np.isnan(hr_y[i, p]) else np.nan
            if not (np.isnan(wl_yi) or np.isnan(hl_yi)):
                vals.append(hl_yi - wl_yi)
            if not (np.isnan(wr_yi) or np.isnan(hr_yi)):
                vals.append(hr_yi - wr_yi)
        if vals:
            wrist_above_hip[i] = np.mean(vals)
    feats["wrist_above_hip"] = wrist_above_hip

    # Rolling window smoothing (±3 frames) for all features
    feat_cols = [c for c in feats.columns if c != "timeSec"]
    for col in feat_cols:
        feats[f"{col}_roll"] = feats[col].rolling(7, center=True, min_periods=1).mean()

    return feats


def check_clip(clip_id: str, verbose: bool = True) -> dict:
    df_pose = load_pose(clip_id)
    rallies = load_gt(clip_id)

    feats = compute_features(df_pose)
    times = feats["timeSec"].values
    y = assign_gt_labels(times, rallies)

    rally_frac = y.mean()
    if verbose:
        print(f"\n  frames={len(y)}  rally={y.sum()} ({100*rally_frac:.1f}%)")

    # Evaluate each feature with ROC-AUC
    feat_cols = [c for c in feats.columns if c not in ("timeSec",) and
                 not feats[c].isna().all()]
    results = []
    for col in feat_cols:
        vals = feats[col].fillna(feats[col].median()).values
        try:
            auc = roc_auc_score(y, vals)
        except Exception:
            continue
        # Flip so AUC >= 0.5 (direction-agnostic separability)
        direction = "pos" if auc >= 0.5 else "neg"
        auc_adj = max(auc, 1 - auc)
        mean_rally = float(np.nanmean(vals[y==1]))
        mean_inter = float(np.nanmean(vals[y==0]))
        results.append({
            "feature": col,
            "auc": auc,
            "auc_adj": auc_adj,
            "direction": direction,
            "mean_rally": mean_rally,
            "mean_inter": mean_inter,
            "sign_correct": mean_rally > mean_inter,
        })

    results.sort(key=lambda r: -r["auc_adj"])

    if verbose:
        print(f"  Top features (rally > inter = correct direction):")
        for r in results[:8]:
            marker = "✓" if r["sign_correct"] else "✗"
            print(f"    {marker} {r['feature']:35s}  AUC={r['auc_adj']:.3f}  "
                  f"rally={r['mean_rally']:.4f}  inter={r['mean_inter']:.4f}")

    best = results[0] if results else None
    return {
        "clip_id": clip_id,
        "n_frames": int(len(y)),
        "rally_frac": float(rally_frac),
        "best_feature": best["feature"] if best else None,
        "best_auc_adj": best["auc_adj"] if best else 0.0,
        "best_sign_correct": best["sign_correct"] if best else False,
        "top5": results[:5],
    }


def main():
    print("═" * 60)
    print("Phase G-2 Analysis Gate — pose feature separability check")
    print("═" * 60)

    AUC_THRESHOLD = 0.75
    all_results = []
    for clip_id in CLIPS:
        print(f"\n── {clip_id}")
        try:
            r = check_clip(clip_id, verbose=True)
            all_results.append(r)
        except FileNotFoundError as e:
            print(f"  ERROR: {e}", file=sys.stderr)
            sys.exit(1)

    print("\n" + "═" * 60)
    print("Gate Summary")
    print("═" * 60)
    all_pass = True
    for r in all_results:
        auc = r["best_auc_adj"]
        sign = r["best_sign_correct"]
        feat = r["best_feature"]
        status = "PASS" if (auc >= AUC_THRESHOLD and sign) else "FAIL"
        if status == "FAIL":
            all_pass = False
        print(f"  {r['clip_id']}")
        print(f"    best_feature={feat}  AUC={auc:.3f}  sign_correct={sign}  → {status}")

    print()
    if all_pass:
        print("✅ GATE PASS — pose features separate rally/inter-point in all 3 clips.")
        print("   Proceed to rally-classify.py (G-3).")
    else:
        print("❌ GATE FAIL — pose features do not reliably separate in all clips.")
        print("   Try: adjust court ROI, increase fps, use keypoint-velocity features.")
        print("   Escalate if no improvement after tuning.")
    print("═" * 60)


if __name__ == "__main__":
    main()
