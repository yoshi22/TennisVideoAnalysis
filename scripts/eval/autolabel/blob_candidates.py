#!/usr/bin/env python3.11
"""
blob_candidates.py — reusable ball-candidate generator for the auto-labeling harness.

This is a box-emitting port of the blob pipeline already used for rally detection.
The motion-mask + large-region removal + connected-component filters mirror
`src/services/ball/core/blobDetect.ts` (and the counting version in
`scripts/eval/score-blob-anchor.py`), but instead of only *counting* ball-sized
blobs we return their bounding boxes in full-resolution image coordinates so they
can seed RF-DETR training labels ("candidate → verify" pipeline, Phase 0.5).

Detection runs on a 320x180 downscale (matching the existing rally tuning); boxes
are scaled back to the source frame size on output. This is intentionally the
*candidate* stage — recall over precision. A downstream verifier (Claude / Astra /
consensus) prunes false positives and refines boxes.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import cv2
import numpy as np

# --- constants mirror blobDetect.ts / score-blob-anchor.py -------------------
TARGET_W, TARGET_H = 320, 180
DIFF_THRESHOLD = 25
LARGE_REGION_MIN_AREA = 200
DILATE_RADIUS = 5
MIN_BLOB_AREA = 3
MAX_BLOB_AREA = 80
MIN_ASPECT = 0.4
MAX_ASPECT = 2.5
MIN_CIRCULARITY = 0.35  # 4πA / P²


@dataclass(frozen=True)
class BallCandidate:
    """A ball candidate box in *source* (full-resolution) pixel coordinates."""

    x: float  # left
    y: float  # top
    w: float
    h: float
    score: float  # circularity-derived [0,1]

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2

    def as_dict(self) -> dict[str, float]:
        return {
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "w": round(self.w, 1),
            "h": round(self.h, 1),
            "score": round(self.score, 3),
        }


def read_gray_small(path) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise FileNotFoundError(path)
    return cv2.resize(img, (TARGET_W, TARGET_H), interpolation=cv2.INTER_NEAREST)


def motion_mask(prev: np.ndarray, curr: np.ndarray, nxt: np.ndarray) -> np.ndarray:
    """3-frame temporal diff: a pixel is motion if it changed vs both neighbours."""
    return (
        (np.abs(curr.astype(np.int16) - prev.astype(np.int16)) > DIFF_THRESHOLD)
        & (np.abs(nxt.astype(np.int16) - curr.astype(np.int16)) > DIFF_THRESHOLD)
    ).astype(np.uint8)


def remove_large_regions(mask: np.ndarray) -> np.ndarray:
    """Strip player silhouettes: drop (dilated) connected components above area."""
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 4)
    large = np.zeros(mask.shape, dtype=np.uint8)
    for label in range(1, n_labels):
        if int(stats[label, cv2.CC_STAT_AREA]) > LARGE_REGION_MIN_AREA:
            large[labels == label] = 1
    if np.any(large):
        k = np.ones((DILATE_RADIUS * 2 + 1, DILATE_RADIUS * 2 + 1), dtype=np.uint8)
        large = cv2.dilate(large, k, iterations=1)
    cleaned = mask.copy()
    cleaned[large > 0] = 0
    return cleaned


def detect_blob_boxes(mask: np.ndarray, scale_x: float, scale_y: float) -> list[BallCandidate]:
    """Emit one BallCandidate per ball-sized/shaped connected component."""
    n_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, 4)
    out: list[BallCandidate] = []
    for label in range(1, n_labels):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < MIN_BLOB_AREA or area > MAX_BLOB_AREA:
            continue
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])
        aspect = max(w, h) / max(1, min(w, h))
        if aspect < MIN_ASPECT or aspect > MAX_ASPECT:
            continue
        component = (labels == label).astype(np.uint8)
        eroded = cv2.erode(component, np.ones((3, 3), dtype=np.uint8), iterations=1)
        perimeter = int(component.sum() - eroded.sum())
        circularity = (4.0 * math.pi * area) / (perimeter * perimeter) if perimeter > 0 else 0.0
        if circularity < MIN_CIRCULARITY:
            continue
        left = int(stats[label, cv2.CC_STAT_LEFT])
        top = int(stats[label, cv2.CC_STAT_TOP])
        out.append(
            BallCandidate(
                x=left * scale_x,
                y=top * scale_y,
                w=w * scale_x,
                h=h * scale_y,
                score=min(1.0, circularity),
            )
        )
    return out


def candidates_for_triplet(
    prev_path, curr_path, next_path, source_w: int, source_h: int
) -> list[BallCandidate]:
    """Full pipeline for one center frame given its neighbours."""
    prev = read_gray_small(prev_path)
    curr = read_gray_small(curr_path)
    nxt = read_gray_small(next_path)
    mask = remove_large_regions(motion_mask(prev, curr, nxt))
    scale_x = source_w / TARGET_W
    scale_y = source_h / TARGET_H
    return detect_blob_boxes(mask, scale_x, scale_y)
