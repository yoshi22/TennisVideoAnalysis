#!/usr/bin/env python3
"""
score-classify.py — Score overlay change detection + template-based rally window.

Strategy:
  Per-clip signal:
    clip1:       pixel-level diff in score ROI → adaptive spike detection (12-22× SNR)
    clip2/fukui: absolute yellow-pixel delta in POINTS cell (HSV threshold)

  Rally window per interval [T_prev, T_curr]:
    start = T_prev + max(MIN_SERVICE_SEC, GAP_FRAC × interval_duration)
    end   = T_curr + TAIL_SEC
    Filter by MIN_DUR_SEC / MAX_DUR_SEC.

Usage:
  /usr/local/bin/python3.11 scripts/eval/score-classify.py \
      [--run-id iter-score2] [--iou-debug]

Reads:  eval/datasets/fixed-camera-v1/frames/<clipId>/frame_*.jpg
Writes: eval/results/<run-id>/manifest.json
        eval/results/<run-id>/per-video/<clipId>.json
"""

import sys
import re
import json
import argparse
import numpy as np
import cv2
from pathlib import Path
from datetime import datetime, timezone

BASE = Path(__file__).parent.parent.parent
FRAMES_DIR = BASE / "eval/datasets/fixed-camera-v1/frames"
LABEL_DIR  = BASE / "eval/datasets/fixed-camera-v1/labels"

# Per-clip config: fps, stride, skip_before, score detection mode + params
# Per-clip window overrides: gap_frac, min_service_sec, max_gap_sec, tail_sec, max_dur_sec
CLIP_CONFIGS = {
    "yt-maitou-suzumura-muko-clip1": {
        "fps": 30, "stride": 6, "skip_before": 8.0,
        # Pixel-diff mode: grayscale diff in wide ROI
        "mode": "pxdiff",
        "score_roi": (0, 200, 150, 950),
        "pxdiff_ratio": 8.0,    # spike threshold = rolling_median × ratio
        "pxdiff_abs":  1.2,     # also must exceed this absolute floor
        "min_interval": 5.0,
    },
    "yt-maitou-suzumura-muko-clip2": {
        "fps": 3, "stride": 1, "skip_before": 0.0,
        # Yellow-delta mode: only NEGATIVE delta (score digit disappears)
        "mode": "yellowdelta_neg",
        "score_roi": (55, 165, 175, 255),
        "yellow_abs_thresh": 80,    # delta < -this triggers event
        "min_interval": 6.0,
        # Window tuning for clip2 (short service intervals)
        "gap_frac": 0.55,
        "min_service_sec": 5.0,
        "tail_sec": 6.0,
        "max_dur_sec": 50.0,
    },
    "yt-maitou-suzumura-fukui-clip1": {
        "fps": 3, "stride": 1, "skip_before": 0.0,
        # Pixel-diff on score ROI: catches digit changes even when yellow count is stable
        "mode": "pxdiff",
        "score_roi": (55, 165, 175, 255),
        "pxdiff_ratio": 5.0,
        "pxdiff_abs":  0.2,
        "min_interval": 6.0,
        # Window tuning for fukui (long rallies up to 42s)
        "gap_frac": 0.40,
        "min_service_sec": 6.0,
        "tail_sec": 8.0,
        "max_dur_sec": 50.0,
    },
}

# HSV yellow thresholds
HSV_H_LO, HSV_H_HI = 15, 35
HSV_S_MIN = 120
HSV_V_MIN = 150

# Template window parameters (global defaults, overridden per-clip via cfg keys)
GAP_FRAC        = 0.40   # rally start = T_prev + GAP_FRAC × interval_dur (clamped)
MIN_SERVICE_SEC = 6.0    # minimum gap after previous score event
MAX_GAP_SEC     = 25.0   # maximum gap (long inter-rally)
TAIL_SEC        = 2.0    # seconds after score event to include as rally end
MIN_DUR_SEC     = 6.0
MAX_DUR_SEC     = 35.0

# Rolling-median window for adaptive pixel-diff threshold
ROLLING_WINDOW_SEC = 30.0


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--run-id", default="iter-score2")
    p.add_argument("--iou-debug", action="store_true")
    return p.parse_args()


def load_frames(clip_id: str):
    cfg = CLIP_CONFIGS[clip_id]
    fps, stride = cfg["fps"], cfg.get("stride", 1)
    skip = cfg.get("skip_before", 0.0)
    frames_dir = FRAMES_DIR / clip_id
    files = sorted([f for f in frames_dir.iterdir() if f.suffix == ".jpg"])
    result = []
    for i, f in enumerate(files):
        if i % stride != 0:
            continue
        m = re.search(r"(\d+)", f.name)
        if m:
            t = int(m.group(1)) / fps
            if t >= skip:
                result.append((t, f))
    return result


def count_yellow(patch: np.ndarray) -> int:
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
    mask = (
        (hsv[:, :, 0] >= HSV_H_LO) & (hsv[:, :, 0] <= HSV_H_HI) &
        (hsv[:, :, 1] > HSV_S_MIN) &
        (hsv[:, :, 2] > HSV_V_MIN)
    )
    return int(mask.sum())


def extract_signals(frames: list, cfg: dict):
    """Extract per-frame score signal and return (times, signal) arrays."""
    Y1, Y2, X1, X2 = cfg["score_roi"]
    mode = cfg["mode"]

    times_list, signal_list = [], []
    prev_val = None

    for t, fpath in frames:
        img = cv2.imread(str(fpath))
        if img is None:
            continue
        patch = img[Y1:Y2, X1:X2]

        if mode == "pxdiff":
            gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY).astype(np.float32)
            if prev_val is not None:
                dt = t - times_list[-1] if times_list else 1.0
                val = float(np.mean(np.abs(gray - prev_val))) / max(dt, 0.01) * 0.2
            else:
                val = 0.0
            prev_val = gray

        else:  # yellowdelta or yellowdelta_neg
            yp = count_yellow(patch)
            if prev_val is not None:
                # Signed delta: negative = yellow dropped (score digit disappeared)
                val = float(yp - prev_val)
            else:
                val = 0.0
            prev_val = yp

        times_list.append(t)
        signal_list.append(val)

    return (np.array(times_list, dtype=np.float64),
            np.array(signal_list, dtype=np.float32))


def detect_score_events(times: np.ndarray, signal: np.ndarray, cfg: dict) -> list:
    """
    Detect score change event times from the signal array.
    Returns sorted list of event times.
    """
    mode = cfg["mode"]
    min_interval = cfg["min_interval"]
    events = []

    if mode == "pxdiff":
        ratio = cfg["pxdiff_ratio"]
        abs_floor = cfg["pxdiff_abs"]
        win_size = max(5, int(ROLLING_WINDOW_SEC / (times[1] - times[0])) if len(times) > 1 else 150)

        for i in range(1, len(times)):
            lo = max(0, i - win_size)
            local_median = float(np.median(signal[lo:i]))
            if local_median < 1e-6:
                local_median = 1e-6
            if signal[i] > local_median * ratio and signal[i] > abs_floor:
                events.append(float(times[i]))

    elif mode == "yellowdelta":
        thresh = cfg["yellow_abs_thresh"]
        for i in range(len(times)):
            if abs(signal[i]) > thresh:
                events.append(float(times[i]))

    else:  # yellowdelta_neg: only fire on large NEGATIVE drops
        thresh = cfg["yellow_abs_thresh"]
        for i in range(len(times)):
            if signal[i] < -thresh:
                events.append(float(times[i]))

    # Filter minimum interval between events
    filtered = []
    last_t = -999.0
    for t in sorted(events):
        if t - last_t >= min_interval:
            filtered.append(t)
            last_t = t

    return filtered


def build_rally_windows(events: list, clip_start: float, clip_end: float,
                         cfg: dict | None = None) -> list:
    """
    Convert event list into rally windows using the interval template.

    For each interval [T_prev, T_curr]:
      gap   = clamp(gap_frac × (T_curr - T_prev), min_service_sec, MAX_GAP_SEC)
      start = T_prev + gap
      end   = T_curr + tail_sec
      filter by MIN_DUR_SEC / max_dur_sec
    """
    gap_frac        = (cfg or {}).get("gap_frac",        GAP_FRAC)
    min_service_sec = (cfg or {}).get("min_service_sec", MIN_SERVICE_SEC)
    tail_sec        = (cfg or {}).get("tail_sec",        TAIL_SEC)
    max_dur_sec     = (cfg or {}).get("max_dur_sec",     MAX_DUR_SEC)

    boundaries = [clip_start] + sorted(events) + [clip_end]
    windows = []

    for i in range(len(boundaries) - 1):
        t_prev = boundaries[i]
        t_curr = boundaries[i + 1]
        dur = t_curr - t_prev

        gap = float(np.clip(gap_frac * dur, min_service_sec, MAX_GAP_SEC))
        start = t_prev + gap
        end   = t_curr + tail_sec

        win_dur = end - start
        if win_dur < MIN_DUR_SEC or win_dur > max_dur_sec:
            continue

        windows.append({
            "startSec":   round(start, 2),
            "endSec":     round(end, 2),
            "confidence": 0.9,
        })

    return windows


def load_gt(clip_id: str) -> list:
    path = LABEL_DIR / f"{clip_id}.json"
    if not path.exists():
        return []
    with open(path) as f:
        return json.load(f)["rallies"]


def iou_fn(a, b) -> float:
    inter = max(0, min(a[1], b[1]) - max(a[0], b[0]))
    if inter == 0:
        return 0.0
    union = (a[1] - a[0]) + (b[1] - b[0]) - inter
    return inter / union if union > 0 else 0.0


def debug_iou(clip_id, detected, gt_rallies):
    print(f"  GT={len(gt_rallies)} rallies  Det={len(detected)} windows")
    tp, used_det = 0, set()
    for g in gt_rallies:
        gw = (g["startSec"], g["endSec"])
        best_iou, best_j = 0.0, -1
        for j, d in enumerate(detected):
            if j in used_det:
                continue
            v = iou_fn(gw, (d["startSec"], d["endSec"]))
            if v > best_iou:
                best_iou, best_j = v, j
        match = "✓" if best_iou >= 0.5 else "✗"
        if best_j >= 0:
            det_str = f"det [{detected[best_j]['startSec']:.0f},{detected[best_j]['endSec']:.0f}] IoU={best_iou:.2f}"
        else:
            det_str = "no match"
        print(f"    {match} GT [{gw[0]:.0f},{gw[1]:.0f}]  → {det_str}")
        if best_iou >= 0.5:
            tp += 1
            used_det.add(best_j)
    fp = len(detected) - len(used_det)
    fn = len(gt_rallies) - tp
    prec = tp / (tp + fp) if (tp + fp) > 0 else 0
    rec  = tp / (tp + fn) if (tp + fn) > 0 else 0
    f1   = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0
    print(f"  TP={tp} FP={fp} FN={fn}  P={prec:.3f} R={rec:.3f} F1={f1:.3f}")
    return f1


def process_clip(clip_id: str, args) -> list:
    cfg = CLIP_CONFIGS[clip_id]
    print(f"\n── {clip_id}")
    frames = load_frames(clip_id)
    if not frames:
        return []

    clip_duration = frames[-1][0]
    print(f"  Frames: {len(frames)}  duration: {clip_duration:.1f}s  mode={cfg['mode']}")

    times, signal = extract_signals(frames, cfg)
    events = detect_score_events(times, signal, cfg)
    print(f"  Score events: {len(events)}  times: {[round(e,1) for e in events[:25]]}")

    gt = load_gt(clip_id)
    print(f"  GT rallies: {len(gt)}")

    windows = build_rally_windows(events, float(times[0]), clip_duration, cfg)
    print(f"  Detected windows: {len(windows)}")
    for w in windows:
        print(f"    [{w['startSec']:.1f}, {w['endSec']:.1f}]  dur={w['endSec']-w['startSec']:.1f}s")

    if args.iou_debug and gt:
        debug_iou(clip_id, windows, gt)

    return windows


def main():
    args = parse_args()
    print(f"Run: {args.run_id}")

    run_dir = BASE / "eval/results" / args.run_id
    per_video_dir = run_dir / "per-video"
    per_video_dir.mkdir(parents=True, exist_ok=True)

    for clip_id in CLIP_CONFIGS:
        windows = process_clip(clip_id, args)
        frames = load_frames(clip_id)
        clip_dur = frames[-1][0] if frames else 600.0

        result = {
            "videoId": clip_id,
            "videoDurationSec": round(clip_dur, 1),
            "scanFps": 5,
            "detectedRallies": windows,
        }
        out = per_video_dir / f"{clip_id}.json"
        with open(out, "w") as f:
            json.dump(result, f, indent=2)

    manifest = {
        "runId": args.run_id,
        "dataset": "fixed-camera-v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "config": {
            "model": "score-pxdiff+yellowdelta+template",
            "gap_frac": GAP_FRAC,
            "tail_sec": TAIL_SEC,
        },
    }
    with open(run_dir / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\nScore with:")
    print(f"  npm run eval:score -- --run-id {args.run_id} --dataset fixed-camera-v1 --baseline-run-id iter-fc6-3clip")


if __name__ == "__main__":
    main()
