#!/usr/bin/env python3.11
"""Dataset adapter from CourtLens ball-GT JSONL to TrackNetV4 tensors."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

import cv2
import numpy as np
import torch
from torch.utils.data import Dataset

BASE = Path(__file__).resolve().parents[3]
DATASETS_DIR = BASE / "eval" / "datasets"


@dataclass(frozen=True)
class BallLabel:
    clip_id: str
    frame_idx: int
    time_sec: float
    x: float | None
    y: float | None
    visible: bool


def _resolve_dataset_dir(dataset: str | Path) -> Path:
    path = Path(dataset)
    if path.is_absolute():
        return path
    return DATASETS_DIR / path


def _split_clip_ids(values: Sequence[str] | None) -> list[str] | None:
    if not values:
        return None
    clip_ids: list[str] = []
    for value in values:
        clip_ids.extend(part.strip() for part in value.split(",") if part.strip())
    return clip_ids or None


def discover_clip_ids(dataset: str | Path) -> list[str]:
    gt_dir = _resolve_dataset_dir(dataset) / "ball-gt"
    if not gt_dir.exists():
        return []
    return sorted(path.stem for path in gt_dir.glob("*.jsonl"))


def load_ball_labels(dataset: str | Path, clip_ids: Sequence[str] | None = None) -> dict[str, dict[int, BallLabel]]:
    dataset_dir = _resolve_dataset_dir(dataset)
    gt_dir = dataset_dir / "ball-gt"
    selected_clip_ids = _split_clip_ids(clip_ids) or discover_clip_ids(dataset_dir)
    if not selected_clip_ids:
        raise FileNotFoundError(f"No ball GT jsonl files found under {gt_dir}")

    labels_by_clip: dict[str, dict[int, BallLabel]] = {}
    for clip_id in selected_clip_ids:
        path = gt_dir / f"{clip_id}.jsonl"
        if not path.exists():
            raise FileNotFoundError(f"Ball GT not found: {path}")

        labels: dict[int, BallLabel] = {}
        with open(path, encoding="utf-8") as handle:
            for line_no, line in enumerate(handle, start=1):
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                frame_idx = int(row["frameIdx"])
                visible = bool(int(row.get("visible", 0)))
                x_raw = row.get("x")
                y_raw = row.get("y")
                if visible and (x_raw is None or y_raw is None):
                    raise ValueError(f"Visible label without x/y at {path}:{line_no}")

                labels[frame_idx] = BallLabel(
                    clip_id=clip_id,
                    frame_idx=frame_idx,
                    time_sec=float(row.get("timeSec", 0.0)),
                    x=float(x_raw) if x_raw is not None else None,
                    y=float(y_raw) if y_raw is not None else None,
                    visible=visible,
                )
        labels_by_clip[clip_id] = labels

    return labels_by_clip


def gaussian_heatmap(height: int, width: int, x_norm: float, y_norm: float, sigma: float) -> np.ndarray:
    x_px = float(np.clip(x_norm, 0.0, 1.0)) * width
    y_px = float(np.clip(y_norm, 0.0, 1.0)) * height
    x_px = min(max(x_px, 0.0), float(width - 1))
    y_px = min(max(y_px, 0.0), float(height - 1))

    yy, xx = np.ogrid[:height, :width]
    heatmap = np.exp(-((xx - x_px) ** 2 + (yy - y_px) ** 2) / (2.0 * sigma * sigma))
    return heatmap.astype(np.float32)


class TrackNetV4BallDataset(Dataset[dict[str, Any]]):
    """Loads 3-frame TrackNetV4 samples from eval/datasets/<dataset>."""

    temporal_offsets = (-1, 0, 1)

    def __init__(
        self,
        dataset: str | Path,
        clip_ids: Sequence[str] | None = None,
        input_size: tuple[int, int] = (288, 512),
        output_size: tuple[int, int] | None = None,
        sigma: float = 3.0,
        max_samples: int | None = None,
    ):
        self.dataset_dir = _resolve_dataset_dir(dataset)
        self.frames_dir = self.dataset_dir / "frames"
        self.input_height, self.input_width = input_size
        self.output_height, self.output_width = output_size or input_size
        self.sigma = float(sigma)

        self.labels_by_clip = load_ball_labels(self.dataset_dir, clip_ids)
        self.samples = sorted(
            (label for labels in self.labels_by_clip.values() for label in labels.values()),
            key=lambda label: (label.clip_id, label.frame_idx),
        )
        if max_samples is not None:
            self.samples = self.samples[:max_samples]
        if not self.samples:
            raise ValueError("No labeled ball samples found")

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int) -> dict[str, Any]:
        sample = self.samples[index]
        fallback = self._read_frame(sample.clip_id, sample.frame_idx)
        if fallback is None:
            fallback = self._nearest_frame(sample.clip_id, sample.frame_idx)
        if fallback is None:
            frame_dir = self.frames_dir / sample.clip_id
            raise FileNotFoundError(f"No readable frames near frame {sample.frame_idx} in {frame_dir}")

        frame_tensors = []
        frame_indices = []
        for offset in self.temporal_offsets:
            frame_idx = sample.frame_idx + offset
            image = self._read_frame(sample.clip_id, frame_idx)
            if image is None:
                image = fallback
            frame_tensors.append(np.transpose(image, (2, 0, 1)))
            frame_indices.append(frame_idx)

        target, mask = self._target_for_window(sample.clip_id, sample.frame_idx)
        inputs = np.concatenate(frame_tensors, axis=0).astype(np.float32)

        return {
            "input": torch.from_numpy(inputs),
            "target": torch.from_numpy(target),
            "mask": torch.from_numpy(mask),
            "meta": {
                "clipId": sample.clip_id,
                "frameIdx": sample.frame_idx,
                "timeSec": sample.time_sec,
                "inputFrameIdxs": frame_indices,
            },
        }

    def _frame_path(self, clip_id: str, frame_idx: int) -> Path:
        return self.frames_dir / clip_id / f"frame_{frame_idx:06d}.jpg"

    def _read_frame(self, clip_id: str, frame_idx: int) -> np.ndarray | None:
        if frame_idx < 0:
            return None

        image = cv2.imread(str(self._frame_path(clip_id, frame_idx)), cv2.IMREAD_COLOR)
        if image is None:
            return None
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        image = cv2.resize(image, (self.input_width, self.input_height), interpolation=cv2.INTER_AREA)
        return image.astype(np.float32) / 255.0

    def _nearest_frame(self, clip_id: str, center_idx: int, radius: int = 5) -> np.ndarray | None:
        for distance in range(1, radius + 1):
            for frame_idx in (center_idx - distance, center_idx + distance):
                image = self._read_frame(clip_id, frame_idx)
                if image is not None:
                    return image
        return None

    def _target_for_window(self, clip_id: str, center_idx: int) -> tuple[np.ndarray, np.ndarray]:
        target = np.zeros((3, self.output_height, self.output_width), dtype=np.float32)
        mask = np.zeros((3, 1, 1), dtype=np.float32)
        labels = self.labels_by_clip[clip_id]

        for channel, offset in enumerate(self.temporal_offsets):
            label = labels.get(center_idx + offset)
            if label is None:
                continue
            mask[channel, :, :] = 1.0
            if label.visible and label.x is not None and label.y is not None:
                target[channel] = gaussian_heatmap(
                    self.output_height,
                    self.output_width,
                    label.x,
                    label.y,
                    sigma=self.sigma,
                )

        return target, mask
