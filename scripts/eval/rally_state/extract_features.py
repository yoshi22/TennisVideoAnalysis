#!/usr/bin/env python3
"""Extract lightweight visual, pose, and audio features for rally-state models."""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np

if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parent))
    import rasterize  # type: ignore
else:
    from . import rasterize

BASE = Path(__file__).resolve().parent.parent.parent.parent
DATASETS_DIR = BASE / "eval" / "datasets"
TMP_DIR = Path("/tmp")
FRAME_NUMBER_RE = re.compile(r"(\d+)")
RESIZE_WIDTH = 320
DIFF_LO = 25
DIFF_HI = 50


def feature_cache_path(clip_id: str, fps: float = 3.0) -> Path:
    return TMP_DIR / f"rally_state_features_{clip_id}_{fps:.1f}fps.npz"


def load_json(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def frame_number(path: Path) -> int:
    match = FRAME_NUMBER_RE.search(path.name)
    return int(match.group(1)) if match else 0


def sorted_jpgs(path: Path) -> tuple[Path, ...]:
    return tuple(sorted(path.glob("*.jpg"), key=frame_number))


def label_for_clip(dataset: str, clip_id: str) -> dict[str, Any]:
    return load_json(DATASETS_DIR / dataset / "labels" / f"{clip_id}.json")


def clip_duration_sec(dataset: str, clip_id: str) -> float:
    return rasterize.clip_duration(label_for_clip(dataset, clip_id))


def resize_gray(frame_bgr: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    out_h = max(1, int(round(h * (RESIZE_WIDTH / float(w)))))
    return cv2.resize(gray, (RESIZE_WIDTH, out_h), interpolation=cv2.INTER_AREA)


def read_gray_jpg(path: Path) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise FileNotFoundError(path)
    return resize_gray(img)


def video_stats(path: Path) -> tuple[float, int]:
    cap = cv2.VideoCapture(str(path))
    try:
        if not cap.isOpened():
            raise FileNotFoundError(f"Could not open video: {path}")
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        if fps <= 0:
            fps = 30.0
        count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        return fps, max(0, count)
    finally:
        cap.release()


def read_video_sampled(path: Path, times: np.ndarray) -> np.ndarray:
    source_fps, frame_count = video_stats(path)
    target_indices = np.rint(times * source_fps).astype(np.int64)
    if frame_count > 0:
        target_indices = np.clip(target_indices, 0, frame_count - 1)

    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise FileNotFoundError(f"Could not open video: {path}")

    frames: list[np.ndarray] = []
    target_pos = 0
    source_idx = 0
    last_gray: np.ndarray | None = None
    try:
        while target_pos < len(target_indices):
            target_idx = int(target_indices[target_pos])
            while source_idx < target_idx:
                ok = cap.grab()
                if not ok:
                    break
                source_idx += 1
            ok, frame = cap.read()
            if not ok:
                if last_gray is None:
                    raise RuntimeError(f"No frames decoded from {path}")
                frames.append(last_gray.copy())
                target_pos += 1
                continue
            gray = resize_gray(frame)
            last_gray = gray
            source_idx += 1
            frames.append(gray)
            target_pos += 1
            while target_pos < len(target_indices) and int(target_indices[target_pos]) == target_idx:
                frames.append(gray.copy())
                target_pos += 1
    finally:
        cap.release()

    if len(frames) < len(times) and frames:
        frames.extend([frames[-1].copy() for _ in range(len(times) - len(frames))])
    return np.stack(frames, axis=0).astype(np.uint8)


def infer_frame_dir_fps(paths: tuple[Path, ...], duration_sec: float, default: float) -> float:
    if len(paths) > 5000:
        return 30.0
    if duration_sec > 0:
        fps = len(paths) / duration_sec
        if fps > 0:
            return fps
    return default


def read_frame_dir_sampled(path: Path, times: np.ndarray, duration_sec: float, default_fps: float) -> np.ndarray:
    paths = sorted_jpgs(path)
    if not paths:
        raise FileNotFoundError(f"No JPEG frames found in {path}")
    source_fps = infer_frame_dir_fps(paths, duration_sec, default_fps)
    indices = np.rint(times * source_fps).astype(np.int64)
    indices = np.clip(indices, 0, len(paths) - 1)
    frames = [read_gray_jpg(paths[int(idx)]) for idx in indices]
    return np.stack(frames, axis=0).astype(np.uint8)


def resolve_clip_source(dataset: str, clip_id: str) -> tuple[str, Path]:
    dataset_dir = DATASETS_DIR / dataset
    video_path = dataset_dir / "clips" / f"{clip_id}.mp4"
    if video_path.exists():
        return "video", video_path
    frame_dir = dataset_dir / "frames" / clip_id
    if frame_dir.exists():
        return "frames", frame_dir
    v1_video = DATASETS_DIR / "fixed-camera-v1" / "clips" / f"{clip_id}.mp4"
    if v1_video.exists():
        return "video", v1_video
    v1_frame_dir = DATASETS_DIR / "fixed-camera-v1" / "frames30" / clip_id
    if v1_frame_dir.exists():
        return "frames", v1_frame_dir
    raise FileNotFoundError(f"No MP4 or frame directory found for {clip_id}")


def fallback_frame_dir(dataset: str, clip_id: str) -> Path | None:
    candidates = [
        DATASETS_DIR / dataset / "frames" / clip_id,
        DATASETS_DIR / "fixed-camera-v1" / "frames30" / clip_id,
    ]
    for path in candidates:
        if path.exists() and sorted_jpgs(path):
            return path
    return None


def load_sampled_frames(dataset: str, clip_id: str, fps: float) -> tuple[np.ndarray, np.ndarray, float]:
    duration_sec = clip_duration_sec(dataset, clip_id)
    n_frames = max(0, int(math.ceil(duration_sec * fps)))
    times = np.arange(n_frames, dtype=np.float32) / float(fps)
    mode, path = resolve_clip_source(dataset, clip_id)
    if mode == "video":
        try:
            frames = read_video_sampled(path, times)
        except Exception as exc:
            frame_dir = fallback_frame_dir(dataset, clip_id)
            if frame_dir is None:
                raise
            print(f"{clip_id}: video read failed ({exc}); falling back to {frame_dir}")
            frames = read_frame_dir_sampled(frame_dir, times, duration_sec, fps)
    else:
        frames = read_frame_dir_sampled(path, times, duration_sec, fps)
    return frames, times, duration_sec


def active_fraction(mask: np.ndarray) -> float:
    return float(mask.mean()) if mask.size else 0.0


def visual_features(frames: np.ndarray) -> np.ndarray:
    n = len(frames)
    features = np.zeros((n, 7), dtype=np.float32)
    if n == 0:
        return features

    background = np.median(frames.astype(np.float32), axis=0)
    half = frames.shape[1] // 2

    for i, frame in enumerate(frames.astype(np.float32)):
        diff = np.abs(frame - background)
        lo_mask = diff > DIFF_LO
        hi_mask = diff > DIFF_HI
        features[i, 0] = active_fraction(lo_mask)
        features[i, 1] = active_fraction(hi_mask)
        features[i, 2] = active_fraction(lo_mask[:half])
        features[i, 3] = active_fraction(lo_mask[half:])

    for i in range(1, n - 1):
        prev_diff = np.abs(frames[i].astype(np.float32) - frames[i - 1].astype(np.float32))
        next_diff = np.abs(frames[i + 1].astype(np.float32) - frames[i].astype(np.float32))
        diff = np.maximum(prev_diff, next_diff)
        mask = diff > DIFF_LO
        features[i, 4] = active_fraction(mask)
        features[i, 5] = active_fraction(mask[:half])
        features[i, 6] = active_fraction(mask[half:])

    return features


def find_pose_path(dataset: str, clip_id: str) -> Path | None:
    for d in [dataset, "fixed-camera-v1"]:
        path = DATASETS_DIR / d / "pose" / f"{clip_id}.tsv"
        if path.exists():
            return path
    return None


def pose_velocity_features(dataset: str, clip_id: str, times: np.ndarray) -> np.ndarray:
    out = np.zeros((len(times), 2), dtype=np.float32)
    pose_path = find_pose_path(dataset, clip_id)
    if pose_path is None or len(times) == 0:
        return out

    pose_times: list[float] = []
    centroids: list[tuple[float, float]] = []
    with open(pose_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            try:
                t = float(row["timeSec"])
                cx = float(row.get("p0_cx", "nan"))
                cy = float(row.get("p0_cy", "nan"))
            except (KeyError, TypeError, ValueError):
                continue
            if np.isfinite(cx) and np.isfinite(cy):
                pose_times.append(t)
                centroids.append((cx, cy))

    if not pose_times:
        return out

    pose_t = np.asarray(pose_times, dtype=np.float32)
    pose_xy = np.asarray(centroids, dtype=np.float32)
    nearest = np.searchsorted(pose_t, times, side="left")
    nearest = np.clip(nearest, 0, len(pose_t) - 1)
    prev = np.maximum(nearest - 1, 0)
    choose_prev = np.abs(times - pose_t[prev]) < np.abs(times - pose_t[nearest])
    nearest[choose_prev] = prev[choose_prev]
    sampled = pose_xy[nearest]
    velocity = np.zeros_like(sampled)
    velocity[1:] = np.abs(sampled[1:] - sampled[:-1])
    return velocity.astype(np.float32)


def _label_float(label: dict[str, Any], key: str) -> float | None:
    value = label.get(key)
    if value in (None, ""):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _find_audio_source(dataset: str, clip_id: str, label: dict[str, Any]) -> tuple[Path, float, float | None]:
    duration_sec = _label_float(label, "clipDurationSec")

    dataset_clip = DATASETS_DIR / dataset / "clips" / f"{clip_id}.mp4"
    if dataset_clip.exists():
        return dataset_clip, 0.0, duration_sec

    v1_clip = DATASETS_DIR / "fixed-camera-v1" / "clips" / f"{clip_id}.mp4"
    if v1_clip.exists():
        return v1_clip, 0.0, duration_sec

    offset = _label_float(label, "clipOffsetSec") or 0.0
    for videos_dir in [
        DATASETS_DIR / "fixed-camera-v1" / "videos",
        DATASETS_DIR / dataset / "videos",
    ]:
        videos = sorted(videos_dir.glob("*.mp4"))
        if videos:
            return videos[0], offset, duration_sec

    raise FileNotFoundError(f"no MP4 audio source found for {dataset}/{clip_id}")


def _spectral_flux_onset(data: np.ndarray, sr: int, hop_length: int = 512, n_fft: int = 2048) -> tuple[np.ndarray, np.ndarray]:
    """Spectral-flux onset: sum of positive magnitude increases across frequency bins.
    More discriminative than energy onset for ball-strike sounds (broadband transients)
    vs crowd noise (slowly-varying narrowband).  Pure numpy — no numba required.
    """
    mono = data.astype(np.float32, copy=False)
    if mono.size < n_fft:
        return np.zeros(0, dtype=np.float32), np.zeros(0, dtype=np.float32)
    window = np.hanning(n_fft).astype(np.float32)
    n_frames = (len(mono) - n_fft) // hop_length + 1
    flux: list[float] = []
    mag_prev: np.ndarray | None = None
    for i in range(n_frames):
        frame = mono[i * hop_length : i * hop_length + n_fft]
        mag = np.abs(np.fft.rfft(frame * window)).astype(np.float32)
        flux.append(0.0 if mag_prev is None else float(np.sum(np.maximum(mag - mag_prev, 0.0))))
        mag_prev = mag
    onset = np.array(flux, dtype=np.float32)
    onset_times = (np.arange(len(onset), dtype=np.float32) * hop_length) / float(sr)
    return onset, onset_times


def audio_onset_features(dataset: str, clip_id: str, fps: float, times: np.ndarray, duration_sec: float) -> np.ndarray:
    out = np.zeros((len(times), 1), dtype=np.float32)
    if len(times) == 0:
        return out

    try:
        import soundfile as sf
    except Exception as exc:  # pragma: no cover - optional dependency fallback
        print(f"{clip_id}: soundfile unavailable ({exc}); audio feature set to zero.")
        return out

    try:
        import librosa
    except Exception as exc:  # pragma: no cover - optional dependency fallback
        print(f"{clip_id}: librosa unavailable ({exc}); using spectral-flux fallback.")
        librosa = None

    label = label_for_clip(dataset, clip_id)
    try:
        src_path, offset_sec, audio_duration_sec = _find_audio_source(dataset, clip_id, label)
        wav_cache_path = TMP_DIR / f"rally_state_audio_{clip_id}.wav"
        cmd = ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i", str(src_path)]
        if offset_sec > 0:
            cmd.extend(["-ss", str(offset_sec)])
        if audio_duration_sec is not None:
            cmd.extend(["-t", str(audio_duration_sec)])
        cmd.extend(["-ac", "1", "-ar", "16000", "-vn", "-f", "wav", str(wav_cache_path)])
        subprocess.run(cmd, check=True)

        data, sr = sf.read(wav_cache_path, dtype="float32", always_2d=False)
        if data.ndim > 1:
            data = data.mean(axis=1)
        if data.size == 0:
            return out

        if librosa is not None:
            try:
                onset = librosa.onset.onset_strength(y=data, sr=sr)
                onset_times = librosa.frames_to_time(np.arange(len(onset)), sr=sr)
            except Exception as exc:
                print(f"{clip_id}: librosa onset failed ({exc}); using spectral-flux fallback.")
                onset, onset_times = _spectral_flux_onset(data, sr)
        else:
            onset, onset_times = _spectral_flux_onset(data, sr)

        if len(onset) == 0 or len(onset_times) == 0:
            return out
        values = np.interp(times, onset_times, onset, left=0.0, right=0.0).astype(np.float32)
        max_val = float(values.max())
        if max_val > 0:
            values /= max_val
        out[:, 0] = values
    except FileNotFoundError as exc:
        print(f"{clip_id}: warning: {exc}; audio feature set to zero.")
    except Exception as exc:
        print(f"{clip_id}: audio feature failed ({exc}); audio feature set to zero.")
    return out


def extract_clip_features(dataset: str, clip_id: str, fps: float, overwrite: bool = False) -> Path:
    out_path = feature_cache_path(clip_id, fps)
    if out_path.exists() and not overwrite:
        try:
            with np.load(out_path) as cached:
                cached_fps = float(cached["fps"][0])
                cached_dataset = str(cached["dataset"][0])
            if abs(cached_fps - float(fps)) < 1e-6 and cached_dataset == dataset:
                return out_path
        except Exception:
            pass

    print(f"{clip_id}: extracting features")
    frames, times, duration_sec = load_sampled_frames(dataset, clip_id, fps)
    bg_and_motion = visual_features(frames)
    pose = pose_velocity_features(dataset, clip_id, times)
    audio = audio_onset_features(dataset, clip_id, fps, times, duration_sec)
    features = np.concatenate([bg_and_motion, pose, audio], axis=1).astype(np.float32)

    np.savez_compressed(
        out_path,
        clip_id=np.array([clip_id], dtype=object),
        dataset=np.array([dataset], dtype=object),
        fps=np.array([float(fps)], dtype=np.float32),
        duration_sec=np.array([float(duration_sec)], dtype=np.float32),
        times=times.astype(np.float32),
        features=features,
    )
    print(f"{clip_id}: wrote {features.shape} to {out_path}")
    return out_path


def load_feature_cache(dataset: str, clip_id: str, fps: float) -> dict[str, np.ndarray] | None:
    path = feature_cache_path(clip_id, fps)
    if not path.exists():
        return None
    try:
        with np.load(path, allow_pickle=True) as data:
            cached_fps = float(data["fps"][0])
            cached_dataset = str(data["dataset"][0])
            if abs(cached_fps - float(fps)) > 1e-6 or cached_dataset != dataset:
                return None
            return {
                "features": data["features"].astype(np.float32),
                "times": data["times"].astype(np.float32),
                "duration_sec": data["duration_sec"].astype(np.float32),
            }
    except Exception:
        return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract per-frame rally-state features.")
    parser.add_argument("--dataset", default="fixed-camera-v2")
    parser.add_argument("--fps", type=float, default=3.0)
    parser.add_argument("--clips", nargs="+", help="Clip ids to process; default all labels")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    clips = args.clips or rasterize.clip_ids_from_labels(args.dataset)
    for clip_id in clips:
        extract_clip_features(args.dataset, clip_id, args.fps, overwrite=args.overwrite)


if __name__ == "__main__":
    main()
