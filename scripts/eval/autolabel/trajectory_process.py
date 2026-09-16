#!/usr/bin/env python3.11
"""
trajectory_process.py — clean noisy TrackNet ball detections into one trajectory
per labeled rally, then render verification trails.

Reads:  eval/datasets/<dataset>/ball-tracks/<model>/<clipId>.jsonl
        eval/datasets/<dataset>/labels/<clipId>.json
        eval/datasets/<dataset>/frames/<clipId>/frame_%06d.jpg
Writes: eval/datasets/<dataset>/ball-tracks/<model>/clean/<clipId>.jsonl
        eval/datasets/<dataset>/ball-tracks/<model>/clean/trails/<clipId>_rallyNN.jpg

Usage:
  /usr/local/bin/python3.11 scripts/eval/autolabel/trajectory_process.py \
      --dataset fixed-camera-v2 --clip-id yt-maitou-suzumura-muko-clip1 \
      --model tracknet-v1 --min-conf 0.3
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # scripts/eval, for _common
from _common import load_json

BASE = Path(__file__).resolve().parents[3]
DATASETS_DIR = BASE / "eval/datasets"


@dataclass(frozen=True)
class Detection:
    frame_idx: int
    time_sec: float
    x: float
    y: float
    confidence: float
    row_index: int

    def px(self, width: int, height: int) -> tuple[float, float]:
        return self.x * width, self.y * height


@dataclass(frozen=True)
class TrackPoint:
    frame_idx: int
    time_sec: float
    x: float
    y: float
    source: str
    rally: int


@dataclass(frozen=True)
class RallySummary:
    rally: int
    raw_visible: int
    kept: int
    interpolated: int
    covered_frames: int
    total_frames: int
    coverage_pct: float


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Clean TrackNet detections into rally trajectories")
    p.add_argument("--dataset", default="fixed-camera-v2")
    p.add_argument("--clip-id", required=True)
    p.add_argument("--model", default="tracknet-v1")
    p.add_argument("--min-conf", type=float, default=0.3, help="Minimum visible detection confidence")
    p.add_argument(
        "--max-jump",
        type=float,
        default=25.0,
        help="Maximum plausible ball velocity in px/source-frame",
    )
    p.add_argument(
        "--max-interp-gap-frames",
        type=int,
        default=16,
        help="Interpolate only across kept detection gaps up to this many source frames",
    )
    p.add_argument(
        "--max-link-gap-frames",
        type=int,
        default=16,
        help="Optional hard cap for linking detections; 0 means no cap",
    )
    p.add_argument("--width", type=int, default=1280, help="Source frame width in pixels")
    p.add_argument("--height", type=int, default=720, help="Source frame height in pixels")
    p.add_argument("--no-trails", action="store_true", help="Skip verification trail image rendering")
    return p.parse_args()


def resolve_labels_path(dataset_dir: Path, clip_id: str) -> Path:
    path = dataset_dir / "labels" / f"{clip_id}.json"
    if path.exists():
        return path
    draft_path = dataset_dir / "labels" / f"{clip_id}_DRAFT.json"
    if draft_path.exists():
        return draft_path
    return path


def load_detections(path: Path) -> list[dict]:
    rows: list[dict] = []
    with open(path, encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as e:
                raise ValueError(f"Bad JSONL at {path}:{line_no}: {e}") from e
    return rows


def is_finite_number(value: object) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(float(value))


def collect_rally_detections(
    rows: Iterable[dict],
    rally: dict,
    min_conf: float,
) -> list[Detection]:
    out: list[Detection] = []
    start_sec = float(rally["startSec"])
    end_sec = float(rally["endSec"])
    seen_frames: dict[int, Detection] = {}
    for row_index, row in enumerate(rows):
        if not row.get("visible"):
            continue
        if float(row.get("confidence", 0.0)) < min_conf:
            continue
        if not (is_finite_number(row.get("x")) and is_finite_number(row.get("y"))):
            continue
        time_sec = float(row["timeSec"])
        if time_sec < start_sec or time_sec > end_sec:
            continue
        det = Detection(
            frame_idx=int(row["frameIdx"]),
            time_sec=time_sec,
            x=float(row["x"]),
            y=float(row["y"]),
            confidence=float(row["confidence"]),
            row_index=row_index,
        )
        prev = seen_frames.get(det.frame_idx)
        if prev is None or det.confidence > prev.confidence:
            seen_frames[det.frame_idx] = det
    out = sorted(seen_frames.values(), key=lambda d: (d.frame_idx, -d.confidence))
    return out


def velocity_px_per_frame(a: Detection, b: Detection, width: int, height: int) -> float:
    frame_gap = b.frame_idx - a.frame_idx
    if frame_gap <= 0:
        return math.inf
    ax, ay = a.px(width, height)
    bx, by = b.px(width, height)
    return math.hypot(bx - ax, by - ay) / frame_gap


def can_link(
    a: Detection,
    b: Detection,
    width: int,
    height: int,
    max_jump: float,
    max_link_gap_frames: int,
) -> bool:
    frame_gap = b.frame_idx - a.frame_idx
    if frame_gap <= 0:
        return False
    if max_link_gap_frames > 0 and frame_gap > max_link_gap_frames:
        return False
    return velocity_px_per_frame(a, b, width, height) <= max_jump


def link_track(
    detections: list[Detection],
    width: int,
    height: int,
    max_jump: float,
    max_link_gap_frames: int,
) -> list[Detection]:
    """Find the highest-scoring plausible ordered path through rally detections."""
    if not detections:
        return []

    n = len(detections)
    scores = [1.0 + 0.1 * detections[i].confidence for i in range(n)]
    prev: list[int | None] = [None] * n
    spans = [0] * n

    for i in range(n):
        for j in range(i):
            if not can_link(detections[j], detections[i], width, height, max_jump, max_link_gap_frames):
                continue
            frame_gap = detections[i].frame_idx - detections[j].frame_idx
            gap_penalty = min(0.25, frame_gap / 600.0)
            candidate_score = scores[j] + 1.0 + 0.1 * detections[i].confidence - gap_penalty
            candidate_span = spans[j] + frame_gap
            if (
                candidate_score > scores[i]
                or (math.isclose(candidate_score, scores[i]) and candidate_span > spans[i])
            ):
                scores[i] = candidate_score
                spans[i] = candidate_span
                prev[i] = j

    best_idx = max(range(n), key=lambda i: (scores[i], spans[i], detections[i].confidence))
    path_indices: list[int] = []
    cursor: int | None = best_idx
    while cursor is not None:
        path_indices.append(cursor)
        cursor = prev[cursor]
    path_indices.reverse()
    return [detections[i] for i in path_indices]


def interpolate_track(
    kept: list[Detection],
    rally_index: int,
    fps: float,
    max_interp_gap_frames: int,
) -> list[TrackPoint]:
    points: list[TrackPoint] = []
    for i, det in enumerate(kept):
        if i > 0:
            prev = kept[i - 1]
            gap = det.frame_idx - prev.frame_idx
            if 1 < gap <= max_interp_gap_frames:
                for frame_idx in range(prev.frame_idx + 1, det.frame_idx):
                    t = (frame_idx - prev.frame_idx) / gap
                    points.append(
                        TrackPoint(
                            frame_idx=frame_idx,
                            time_sec=frame_idx / fps,
                            x=prev.x + (det.x - prev.x) * t,
                            y=prev.y + (det.y - prev.y) * t,
                            source="interp",
                            rally=rally_index,
                        )
                    )
        points.append(
            TrackPoint(
                frame_idx=det.frame_idx,
                time_sec=det.time_sec,
                x=det.x,
                y=det.y,
                source="det",
                rally=rally_index,
            )
        )
    return points


def color_for_fraction(t: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, t))
    return (int(255 * (1.0 - t)), 0, int(255 * t))


def draw_x(img: np.ndarray, x: int, y: int, radius: int, color: tuple[int, int, int]) -> None:
    cv2.line(img, (x - radius, y - radius), (x + radius, y + radius), color, 1, cv2.LINE_AA)
    cv2.line(img, (x - radius, y + radius), (x + radius, y - radius), color, 1, cv2.LINE_AA)


def render_trail(
    clip_id: str,
    rally_index: int,
    rally: dict,
    fps: float,
    frames_dir: Path,
    out_path: Path,
    points: list[TrackPoint],
    dropped: list[Detection],
    width: int,
    height: int,
) -> None:
    mid_frame = int(round(((float(rally["startSec"]) + float(rally["endSec"])) / 2.0) * fps))
    bg_path = frames_dir / f"frame_{mid_frame:06d}.jpg"
    bg = cv2.imread(str(bg_path))
    if bg is None:
        raise FileNotFoundError(f"Background frame missing: {bg_path}")

    h, w = bg.shape[:2]
    overlay = bg.copy()
    start_frame = int(round(float(rally["startSec"]) * fps))
    end_frame = int(round(float(rally["endSec"]) * fps))
    span = max(1, end_frame - start_frame)

    for det in dropped:
        x = int(round(det.x * w))
        y = int(round(det.y * h))
        draw_x(overlay, x, y, 4, (155, 155, 155))

    prev_point: TrackPoint | None = None
    for point in sorted(points, key=lambda p: p.frame_idx):
        t = (point.frame_idx - start_frame) / span
        color = color_for_fraction(t)
        x = int(round(point.x * w))
        y = int(round(point.y * h))
        if prev_point is not None and point.frame_idx - prev_point.frame_idx <= 1:
            px = int(round(prev_point.x * w))
            py = int(round(prev_point.y * h))
            cv2.line(overlay, (px, py), (x, y), color, 2, cv2.LINE_AA)
        radius = 4 if point.source == "det" else 2
        cv2.circle(overlay, (x, y), radius, color, -1, cv2.LINE_AA)
        prev_point = point

    rendered = cv2.addWeighted(overlay, 0.88, bg, 0.12, 0)
    cv2.putText(
        rendered,
        f"{clip_id} rally {rally_index:02d} det={sum(1 for p in points if p.source == 'det')} "
        f"interp={sum(1 for p in points if p.source == 'interp')} drop={len(dropped)}",
        (20, 40),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    if (w, h) != (width, height):
        cv2.putText(
            rendered,
            f"frame {w}x{h}; velocity gate used {width}x{height}",
            (20, 70),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(out_path), rendered):
        raise OSError(f"Failed to write trail image: {out_path}")


def coverage_counts(points: list[TrackPoint], rally: dict, fps: float) -> tuple[int, int]:
    start_frame = int(math.ceil(float(rally["startSec"]) * fps))
    end_frame = int(math.floor(float(rally["endSec"]) * fps))
    total_frames = max(1, end_frame - start_frame + 1)
    covered = {
        p.frame_idx
        for p in points
        if start_frame <= p.frame_idx <= end_frame
    }
    return len(covered), total_frames


def write_clean_jsonl(path: Path, points: list[TrackPoint]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for point in sorted(points, key=lambda p: (p.rally, p.frame_idx, p.source)):
            f.write(
                json.dumps(
                    {
                        "frameIdx": point.frame_idx,
                        "timeSec": round(point.time_sec, 6),
                        "x": round(point.x, 6),
                        "y": round(point.y, 6),
                        "source": point.source,
                        "rally": point.rally,
                    },
                    separators=(",", ":"),
                )
                + "\n"
            )


def print_summary(summaries: list[RallySummary], out_path: Path, trails_dir: Path | None) -> None:
    print("rally raw kept interp coverage%")
    print("----- --- ---- ------ ---------")
    for s in summaries:
        print(f"{s.rally:>5} {s.raw_visible:>3} {s.kept:>4} {s.interpolated:>6} {s.coverage_pct:>8.1f}%")

    raw_total = sum(s.raw_visible for s in summaries)
    kept_total = sum(s.kept for s in summaries)
    interp_total = sum(s.interpolated for s in summaries)
    total_covered_frames = sum(s.covered_frames for s in summaries)
    total_rally_frames = sum(s.total_frames for s in summaries)
    weighted_coverage = 100.0 * total_covered_frames / total_rally_frames if total_rally_frames else 0.0
    print("----- --- ---- ------ ---------")
    print(f"{'all':>5} {raw_total:>3} {kept_total:>4} {interp_total:>6} {weighted_coverage:>8.1f}%")
    print(f"clean_jsonl {out_path.relative_to(BASE)}")
    if trails_dir is None:
        print("trails_dir  skipped")
    else:
        print(f"trails_dir  {trails_dir.relative_to(BASE)}")


def main() -> None:
    args = parse_args()
    dataset_dir = DATASETS_DIR / args.dataset
    track_path = dataset_dir / "ball-tracks" / args.model / f"{args.clip_id}.jsonl"
    labels_path = resolve_labels_path(dataset_dir, args.clip_id)
    frames_dir = dataset_dir / "frames" / args.clip_id
    clean_dir = dataset_dir / "ball-tracks" / args.model / "clean"
    trails_dir = clean_dir / "trails"
    out_path = clean_dir / f"{args.clip_id}.jsonl"

    if not track_path.exists():
        raise SystemExit(f"Detections not found: {track_path}")
    if not labels_path.exists():
        raise SystemExit(f"Labels not found: {labels_path}")
    trails_enabled = not args.no_trails and frames_dir.exists()
    if not args.no_trails and not frames_dir.exists():
        print(f"Frames dir not found; skipping trail rendering: {frames_dir}")

    rows = load_detections(track_path)
    labels = load_json(labels_path)
    fps = float(labels.get("fps", 30.0))
    rallies = labels.get("rallies", [])
    if not rallies:
        raise SystemExit(f"No rallies in labels: {labels_path}")

    all_points: list[TrackPoint] = []
    summaries: list[RallySummary] = []

    for rally_index, rally in enumerate(rallies, 1):
        raw = collect_rally_detections(rows, rally, args.min_conf)
        kept = link_track(raw, args.width, args.height, args.max_jump, args.max_link_gap_frames)
        kept_ids = {d.row_index for d in kept}
        dropped = [d for d in raw if d.row_index not in kept_ids]
        points = interpolate_track(kept, rally_index, fps, args.max_interp_gap_frames)
        all_points.extend(points)

        if trails_enabled:
            trail_path = trails_dir / f"{args.clip_id}_rally{rally_index:02d}.jpg"
            render_trail(
                args.clip_id,
                rally_index,
                rally,
                fps,
                frames_dir,
                trail_path,
                points,
                dropped,
                args.width,
                args.height,
            )

        interp_count = sum(1 for p in points if p.source == "interp")
        covered_frames, total_frames = coverage_counts(points, rally, fps)
        summaries.append(
            RallySummary(
                rally=rally_index,
                raw_visible=len(raw),
                kept=len(kept),
                interpolated=interp_count,
                covered_frames=covered_frames,
                total_frames=total_frames,
                coverage_pct=100.0 * covered_frames / total_frames,
            )
        )

    write_clean_jsonl(out_path, all_points)
    print_summary(summaries, out_path, trails_dir if trails_enabled else None)


if __name__ == "__main__":
    main()
