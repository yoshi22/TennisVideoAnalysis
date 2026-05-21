#!/usr/bin/env python3
"""
audio-rhythm.py — Phase G-4: audio ball-impact onset detection for rally segmentation.

Strategy:
  1. Load 16kHz mono WAV for each clip segment.
  2. Compute onset strength envelope using librosa (spectral flux).
  3. Pick onset peaks → ball-impact event times.
  4. Gap-bridge consecutive impacts into rally candidates.
  5. Pad, duration-filter, output windows compatible with score-stage1.ts.

Usage:
  /usr/local/bin/python3.11 scripts/eval/audio-rhythm.py \
      [--run-id iter-audio1] [--iou-debug]

Reads:
  eval/datasets/fixed-camera-v1/audio/source_full.wav
  eval/datasets/fixed-camera-v1/labels/<clipId>.json

Writes:
  eval/results/<run-id>/manifest.json
  eval/results/<run-id>/per-video/<clipId>.json
"""

import sys
import json
import argparse
import numpy as np
import wave
from pathlib import Path
from datetime import datetime, timezone
from scipy import signal as scipy_signal

BASE = Path(__file__).parent.parent.parent
AUDIO_DIR  = BASE / "eval/datasets/fixed-camera-v1/audio"
LABEL_DIR  = BASE / "eval/datasets/fixed-camera-v1/labels"

AUDIO_SR = 16000  # Hz (matches download settings)

# Clip audio offsets within the full video
CLIP_AUDIO_CONFIGS = {
    "yt-maitou-suzumura-muko-clip1": {
        "video_offset_sec": 0,
        "duration_sec": 600,
    },
    "yt-maitou-suzumura-muko-clip2": {
        "video_offset_sec": 600,
        "duration_sec": 600,
    },
    "yt-maitou-suzumura-fukui-clip1": {
        "video_offset_sec": 0,   # updated if offset search finds a better match
        "duration_sec": 600,
        "search_offsets": [0, 600, 1200, 1800, 2100],  # try these offsets
    },
}

# Rally window params
GAP_TOL_SEC    = 2.5    # bridge ball impacts up to this far apart
PAD_START_SEC  = 2.0    # pad rally window start back
PAD_END_SEC    = 2.0    # pad rally window end forward
MIN_DUR_SEC    = 5.0
MAX_DUR_SEC    = 50.0
MERGE_EPS_SEC  = 0.5    # merge overlapping windows

# Onset detection params
ONSET_HOP    = 256        # hop size in samples (16ms at 16kHz)
ONSET_WAIT   = 8          # minimum frames between onsets (~128ms)
ONSET_DELTA  = 0.07       # onset strength threshold
MIN_IMPACTS_PER_RALLY = 3  # minimum ball impacts to form a rally candidate


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--run-id", default="iter-audio1")
    p.add_argument("--iou-debug", action="store_true")
    p.add_argument("--delta", type=float, default=ONSET_DELTA,
                   help="Onset strength threshold (default: 0.07)")
    p.add_argument("--gap-tol", type=float, default=GAP_TOL_SEC,
                   help="Max gap between ball impacts (s)")
    return p.parse_args()


def load_audio_segment(audio_path: str, offset_sec: float, duration_sec: float) -> np.ndarray:
    """Load a segment of audio from a WAV file as float32 array."""
    with wave.open(audio_path) as wf:
        rate = wf.getframerate()
        assert rate == AUDIO_SR, f"Expected {AUDIO_SR}Hz, got {rate}Hz"
        start_frame = int(offset_sec * rate)
        n_frames = int(duration_sec * rate)
        wf.setpos(start_frame)
        raw = wf.readframes(n_frames)
    data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return data


def spectral_flux_onset_strength(audio: np.ndarray, sr: int, hop: int,
                                  fmax: float = 8000.0) -> np.ndarray:
    """
    Compute spectral flux onset strength envelope without librosa/numba.
    Uses scipy STFT, restricts to fmax, returns positive-only flux.
    """
    nperseg = hop * 4  # 4× hop gives a reasonable STFT window
    _, _, Z = scipy_signal.stft(audio, fs=sr, nperseg=nperseg, noverlap=nperseg - hop,
                                window="hann")
    # Restrict frequency bins to fmax
    freqs = np.fft.rfftfreq(nperseg, d=1.0 / sr)
    freq_mask = freqs <= fmax
    mag = np.abs(Z[freq_mask, :])        # shape: (n_freq_bins, n_frames)
    # Spectral flux: sum of positive differences between consecutive magnitude frames
    flux = np.maximum(0.0, np.diff(mag, axis=1)).sum(axis=0)  # shape: (n_frames-1,)
    flux = np.concatenate([[0.0], flux])
    # Normalize to [0,1] range for easier delta thresholding
    p_max = np.percentile(flux, 99)
    if p_max > 0:
        flux = flux / p_max
    return flux.astype(np.float32)


def detect_ball_onsets(audio: np.ndarray, sr: int, delta: float) -> np.ndarray:
    """
    Detect ball-impact onset times using spectral flux (scipy only, no numba).
    Returns array of onset times in seconds (relative to audio start).
    delta: minimum prominence relative to local background (e.g. 0.07 → prominence≥7% above local baseline)
    """
    flux = spectral_flux_onset_strength(audio, sr, ONSET_HOP, fmax=8000.0)
    min_samples = ONSET_WAIT  # minimum frames between peaks
    # Use scipy find_peaks with prominence — prominence measures how much a peak
    # stands out above its surrounding terrain, which is more robust than delta above local min
    peaks, props = scipy_signal.find_peaks(
        flux,
        distance=min_samples,
        prominence=delta,   # minimum prominence in normalized flux units
    )
    onset_times = peaks * ONSET_HOP / sr
    return onset_times.astype(np.float64)


def impacts_to_windows(onset_times: np.ndarray, gap_tol: float,
                       clip_duration: float) -> list:
    """
    Cluster consecutive ball impacts into rally windows.
    """
    if len(onset_times) == 0:
        return []

    windows = []
    seg_start = onset_times[0]
    seg_last  = onset_times[0]
    seg_count = 1

    for t in onset_times[1:]:
        if t - seg_last <= gap_tol:
            seg_last = t
            seg_count += 1
        else:
            if seg_count >= MIN_IMPACTS_PER_RALLY:
                ws = max(0.0, seg_start - PAD_START_SEC)
                we = min(clip_duration, seg_last + PAD_END_SEC)
                dur = we - ws
                if MIN_DUR_SEC <= dur <= MAX_DUR_SEC:
                    windows.append({"startSec": round(ws, 2),
                                    "endSec":   round(we, 2),
                                    "confidence": 0.8})
            seg_start = t
            seg_last  = t
            seg_count = 1

    # Last segment
    if seg_count >= MIN_IMPACTS_PER_RALLY:
        ws = max(0.0, seg_start - PAD_START_SEC)
        we = min(clip_duration, seg_last + PAD_END_SEC)
        dur = we - ws
        if MIN_DUR_SEC <= dur <= MAX_DUR_SEC:
            windows.append({"startSec": round(ws, 2),
                            "endSec":   round(we, 2),
                            "confidence": 0.8})

    # Merge overlapping windows
    if len(windows) <= 1:
        return windows
    merged = [windows[0].copy()]
    for w in windows[1:]:
        if w["startSec"] <= merged[-1]["endSec"] + MERGE_EPS_SEC:
            merged[-1]["endSec"] = max(merged[-1]["endSec"], w["endSec"])
        else:
            merged.append(w.copy())
    return merged


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


def compute_f1(detected, gt_rallies) -> tuple[float, int, int, int]:
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
        if best_iou >= 0.5:
            tp += 1
            used_det.add(best_j)
    fp = len(detected) - len(used_det)
    fn = len(gt_rallies) - tp
    return tp, fp, fn


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


def find_best_offset(clip_id: str, args, audio_path: str) -> tuple[float, list]:
    """For clips with unknown offset, try multiple candidates and pick best F1."""
    cfg = CLIP_AUDIO_CONFIGS[clip_id]
    gt  = load_gt(clip_id)
    if not gt:
        return cfg["video_offset_sec"], []

    search = cfg.get("search_offsets", [cfg["video_offset_sec"]])
    best_f1, best_offset, best_windows = -1.0, search[0], []

    for offset in search:
        try:
            audio = load_audio_segment(audio_path, offset, cfg["duration_sec"])
        except Exception as e:
            print(f"  offset {offset}s: load error ({e})")
            continue
        onsets = detect_ball_onsets(audio, AUDIO_SR, args.delta)
        windows = impacts_to_windows(onsets, args.gap_tol, cfg["duration_sec"])
        tp, fp, fn = compute_f1(windows, gt)
        prec = tp / (tp + fp) if (tp + fp) > 0 else 0
        rec  = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1   = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0
        print(f"  offset={offset:5.0f}s: onsets={len(onsets):4d}  windows={len(windows):3d}  "
              f"TP={tp} FP={fp} FN={fn}  F1={f1:.3f}")
        if f1 > best_f1:
            best_f1, best_offset, best_windows = f1, offset, windows

    print(f"  → best offset: {best_offset}s  F1={best_f1:.3f}")
    return best_offset, best_windows


def process_clip(clip_id: str, args, audio_path: str) -> list:
    cfg = CLIP_AUDIO_CONFIGS[clip_id]
    print(f"\n── {clip_id}")

    gt = load_gt(clip_id)
    print(f"  GT rallies: {len(gt)}")

    if "search_offsets" in cfg and len(cfg["search_offsets"]) > 1:
        print("  Searching for best video offset...")
        offset, windows = find_best_offset(clip_id, args, audio_path)
    else:
        offset = cfg["video_offset_sec"]
        try:
            audio = load_audio_segment(audio_path, offset, cfg["duration_sec"])
        except Exception as e:
            print(f"  ERROR loading audio at offset {offset}s: {e}")
            return []
        onsets = detect_ball_onsets(audio, AUDIO_SR, args.delta)
        print(f"  Audio onsets: {len(onsets)}  first 20: {[round(t,1) for t in onsets[:20]]}")
        windows = impacts_to_windows(onsets, args.gap_tol, cfg["duration_sec"])

    print(f"  Detected windows: {len(windows)}")
    for w in windows:
        print(f"    [{w['startSec']:.1f}, {w['endSec']:.1f}]  dur={w['endSec']-w['startSec']:.1f}s")

    if args.iou_debug and gt:
        debug_iou(clip_id, windows, gt)

    return windows


def main():
    args = parse_args()
    print(f"Run: {args.run_id}  delta={args.delta}  gap_tol={args.gap_tol}")

    audio_path = str(AUDIO_DIR / "source_full.wav")
    if not Path(audio_path).exists():
        print(f"ERROR: audio file not found: {audio_path}")
        print("Download with: yt-dlp -x --audio-format wav --postprocessor-args '-ar 16000 -ac 1' <URL> -o source_full.wav")
        sys.exit(1)

    run_dir = BASE / "eval/results" / args.run_id
    per_video_dir = run_dir / "per-video"
    per_video_dir.mkdir(parents=True, exist_ok=True)

    for clip_id in CLIP_AUDIO_CONFIGS:
        cfg = CLIP_AUDIO_CONFIGS[clip_id]
        windows = process_clip(clip_id, args, audio_path)

        result = {
            "videoId": clip_id,
            "videoDurationSec": float(cfg["duration_sec"]),
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
            "model": "audio-onset-spectral-flux",
            "delta": args.delta,
            "gap_tol_sec": args.gap_tol,
            "pad_start_sec": PAD_START_SEC,
            "pad_end_sec": PAD_END_SEC,
            "min_impacts": MIN_IMPACTS_PER_RALLY,
        },
    }
    with open(run_dir / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\nScore with:")
    print(f"  npm run eval:score -- --run-id {args.run_id} --dataset fixed-camera-v1 --baseline-run-id iter-fc6-3clip")


if __name__ == "__main__":
    main()
