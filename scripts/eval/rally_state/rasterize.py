#!/usr/bin/env python3
"""Rasterize rally interval labels into dense frame labels."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

BASE = Path(__file__).resolve().parent.parent.parent.parent
DATASETS_DIR = BASE / "eval" / "datasets"
TMP_DIR = Path("/tmp")


def format_fps(fps: float) -> str:
    return str(int(fps)) if float(fps).is_integer() else str(fps).replace(".", "p")


def cache_path(dataset: str, fps: float) -> Path:
    return TMP_DIR / f"rally_state_labels_{dataset}_{format_fps(fps)}fps.npz"


def load_json(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def clip_duration(label: dict[str, Any]) -> float:
    value = label.get("clipDurationSec")
    if value is not None:
        duration = float(value)
        if duration > 0:
            return duration
    rallies = label.get("rallies") or []
    if not rallies:
        return 0.0
    return max(float(r.get("endSec", 0.0)) for r in rallies) + 5.0


def label_path_for_clip(dataset: str, clip_id: str) -> Path:
    return DATASETS_DIR / dataset / "labels" / f"{clip_id}.json"


def clip_ids_from_labels(dataset: str) -> list[str]:
    label_dir = DATASETS_DIR / dataset / "labels"
    if not label_dir.exists():
        raise FileNotFoundError(f"Label directory not found: {label_dir}")
    return [path.stem for path in sorted(label_dir.glob("*.json"))]


def rasterize_label(label: dict[str, Any], fps: float) -> np.ndarray:
    duration_sec = clip_duration(label)
    n_frames = max(0, int(np.ceil(duration_sec * fps)))
    times = np.arange(n_frames, dtype=np.float32) / float(fps)
    y = np.zeros(n_frames, dtype=np.float32)
    for rally in label.get("rallies") or []:
        start = float(rally["startSec"])
        end = float(rally["endSec"])
        y[(times >= start) & (times <= end)] = 1.0
    return y


def rasterize_dataset(dataset: str, fps: float) -> dict[str, np.ndarray]:
    labels: dict[str, np.ndarray] = {}
    for label_file in sorted((DATASETS_DIR / dataset / "labels").glob("*.json")):
        label = load_json(label_file)
        clip_id = str(label.get("videoId") or label_file.stem)
        labels[clip_id] = rasterize_label(label, fps)
    return labels


def write_cache(dataset: str, fps: float, labels: dict[str, np.ndarray], path: Path | None = None) -> Path:
    out_path = path or cache_path(dataset, fps)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    clip_ids = np.array(list(labels.keys()), dtype=object)
    payload: dict[str, np.ndarray] = {
        "__clip_ids": clip_ids,
        "__fps": np.array([float(fps)], dtype=np.float32),
    }
    for clip_id, values in labels.items():
        payload[clip_id] = values.astype(np.float32)
    np.savez_compressed(out_path, **payload)
    return out_path


def load_cache(dataset: str, fps: float) -> dict[str, np.ndarray] | None:
    path = cache_path(dataset, fps)
    if not path.exists():
        return None
    with np.load(path, allow_pickle=True) as data:
        saved_fps = float(data["__fps"][0]) if "__fps" in data else fps
        if abs(saved_fps - float(fps)) > 1e-6:
            return None
        clip_ids = [str(x) for x in data["__clip_ids"].tolist()]
        return {clip_id: data[clip_id].astype(np.float32) for clip_id in clip_ids}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Rasterize rally interval labels at a fixed FPS.")
    parser.add_argument("--dataset", default="fixed-camera-v2")
    parser.add_argument("--fps", type=float, default=3.0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    labels = rasterize_dataset(args.dataset, args.fps)
    out_path = write_cache(args.dataset, args.fps, labels)
    print(f"Wrote {len(labels)} clips to {out_path}")
    for clip_id, values in labels.items():
        positives = int(values.sum())
        print(f"{clip_id}: {len(values)} frames, positives={positives}")


if __name__ == "__main__":
    main()
