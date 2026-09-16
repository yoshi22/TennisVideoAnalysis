#!/usr/bin/env python3.11
"""Build coarse per-rally shot/bounce events from cleaned ball trajectories."""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # scripts/eval, for _common
from _common import (
    COURT_LENGTH_M,
    DOUBLES_WIDTH_M,
    SINGLES_WIDTH_M,
    display_path,
    load_json,
    resolve_path,
)

BASE = Path(__file__).resolve().parents[3]
DATASETS_DIR = BASE / "eval" / "datasets"

SOURCE_WIDTH = 1280
SOURCE_HEIGHT = 720
SERVICE_LINE_FROM_NET_M = 6.40


@dataclass(frozen=True)
class TrackPoint:
    frame_idx: int
    time_sec: float
    x_norm: float
    y_norm: float
    source: str
    rally: int

    @property
    def image_xy(self) -> tuple[float, float]:
        return self.x_norm * SOURCE_WIDTH, self.y_norm * SOURCE_HEIGHT


@dataclass(frozen=True)
class CourtCalibration:
    homography: np.ndarray
    court: str
    width_m: float
    length_m: float = COURT_LENGTH_M

    def image_to_court(self, xy: tuple[float, float]) -> tuple[float, float]:
        point = np.array([[[float(xy[0]), float(xy[1])]]], dtype=np.float32)
        mapped = cv2.perspectiveTransform(point, self.homography)[0, 0]
        return float(mapped[0]), float(mapped[1])


@dataclass(frozen=True)
class SpeedSample:
    rally: int
    start_frame_idx: int
    end_frame_idx: int
    time_sec: float
    speed_kmh: float
    distance_m: float


@dataclass(frozen=True)
class SpeedResult:
    samples: list[SpeedSample]
    raw_speeds_kmh: list[float]
    rejected_speed: int
    rejected_jump: int


@dataclass(frozen=True)
class EventCandidate:
    event_type: str
    point: TrackPoint
    score: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build per-rally shot events from cleaned ball trajectories.")
    parser.add_argument("--dataset", default="fixed-camera-v2")
    parser.add_argument("--clip-id", default="yt-gr4ves-ntp4-clip1")
    parser.add_argument("--track-model", default="tracknet-v1")
    parser.add_argument("--output-dir", default="eval/results/shot-events")
    parser.add_argument("--smooth-window", type=int, default=1)
    parser.add_argument("--event-window-sec", type=float, default=0.12)
    parser.add_argument("--min-bounce-vy-px-s", type=float, default=15.0)
    parser.add_argument("--bounce-prominence-px", type=float, default=1.5)
    parser.add_argument("--min-bounce-gap-sec", type=float, default=0.30)
    parser.add_argument("--min-contact-vy-px-s", type=float, default=20.0)
    parser.add_argument("--contact-prominence-px", type=float, default=5.0)
    parser.add_argument("--contact-turn-min-deg", type=float, default=28.0)
    parser.add_argument("--contact-baseline-band-m", type=float, default=3.0)
    parser.add_argument("--contact-min-distance-from-net-m", type=float, default=2.5)
    parser.add_argument("--contact-bounce-exclusion-sec", type=float, default=0.16)
    parser.add_argument("--min-event-gap-sec", type=float, default=0.35)
    parser.add_argument("--min-contact-gap-sec", type=float, default=0.55)
    parser.add_argument("--max-speed-kmh", type=float, default=200.0)
    parser.add_argument("--max-jump-px-per-frame", type=float, default=35.0)
    parser.add_argument(
        "--speed-smooth-window",
        type=int,
        default=2,
        help="Radius for smoothing image positions before speed calc (reduces jitter). 0 = off.",
    )
    parser.add_argument(
        "--speed-window-frames",
        type=int,
        default=3,
        help="Compute speed over this many frames instead of frame-to-frame (noise-robust).",
    )
    parser.add_argument(
        "--speed-court-margin-m",
        type=float,
        default=4.0,
        help="Reject speed samples whose court position falls beyond the court by this margin (off-court noise / high-ball projection).",
    )
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def load_clean_trajectory(dataset: str, track_model: str, clip_id: str) -> list[TrackPoint]:
    path = DATASETS_DIR / dataset / "ball-tracks" / track_model / "clean" / f"{clip_id}.jsonl"
    if not path.exists():
        raise SystemExit(
            f"Cleaned trajectory not found: {display_path(path)}\n"
            "Run scripts/eval/autolabel/trajectory_process.py first."
        )

    points: list[TrackPoint] = []
    with open(path, encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            point = TrackPoint(
                frame_idx=int(row["frameIdx"]),
                time_sec=float(row["timeSec"]),
                x_norm=float(row["x"]),
                y_norm=float(row["y"]),
                source=str(row.get("source", "det")),
                rally=int(row.get("rally", 0)),
            )
            if not (0.0 <= point.x_norm <= 1.0 and 0.0 <= point.y_norm <= 1.0):
                raise ValueError(f"Normalized x/y out of range at {path}:{line_no}")
            points.append(point)
    return sorted(points, key=lambda p: (p.rally, p.frame_idx))


def load_court_calibration(dataset: str, clip_id: str) -> CourtCalibration:
    path = DATASETS_DIR / dataset / "court" / f"{clip_id}.json"
    if not path.exists():
        raise SystemExit(
            f"Court calibration not found: {display_path(path)}\n"
            "Create it with image_corners, court_corners_m, and court fields."
        )
    return court_calibration_from_json(load_json(path), path)


def court_calibration_from_json(payload: dict[str, Any], path: Path | None = None) -> CourtCalibration:
    image_pts = np.asarray(payload["image_corners"], dtype=np.float32)
    court_pts = np.asarray(payload["court_corners_m"], dtype=np.float32)
    if image_pts.shape != (4, 2) or court_pts.shape != (4, 2):
        location = f" in {path}" if path else ""
        raise ValueError(f"image_corners and court_corners_m must each be 4x2 arrays{location}")

    homography, _ = cv2.findHomography(image_pts, court_pts)
    if homography is None:
        raise ValueError(f"Could not compute court homography from {path or 'payload'}")

    court = str(payload.get("court", "singles")).lower()
    if court not in {"singles", "doubles"}:
        raise ValueError("court must be 'singles' or 'doubles'")
    width_m = SINGLES_WIDTH_M if court == "singles" else DOUBLES_WIDTH_M
    return CourtCalibration(homography=homography, court=court, width_m=width_m)


def group_by_rally(points: Iterable[TrackPoint]) -> dict[int, list[TrackPoint]]:
    groups: dict[int, list[TrackPoint]] = defaultdict(list)
    for point in points:
        groups[point.rally].append(point)
    return {key: sorted(value, key=lambda p: p.frame_idx) for key, value in sorted(groups.items())}


def smooth(values: list[float], radius: int) -> list[float]:
    if radius <= 0:
        return values[:]
    smoothed: list[float] = []
    for i in range(len(values)):
        lo = max(0, i - radius)
        hi = min(len(values), i + radius + 1)
        smoothed.append(float(sum(values[lo:hi]) / (hi - lo)))
    return smoothed


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * pct / 100.0
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def speed_stats(values: list[float], raw_values: list[float] | None = None) -> dict[str, float | None]:
    raw = raw_values if raw_values is not None else values
    return {
        "peak": percentile(values, 95.0),
        "p95": percentile(values, 95.0),
        "median": statistics.median(values) if values else None,
        "raw_max": max(raw) if raw else None,
    }


def rounded(value: float | None, digits: int = 1) -> float | None:
    return round(float(value), digits) if value is not None and math.isfinite(float(value)) else None


def event_radius(points: list[TrackPoint], window_sec: float) -> int:
    if len(points) < 3:
        return 1
    gaps = [
        points[i].time_sec - points[i - 1].time_sec
        for i in range(1, len(points))
        if points[i].time_sec > points[i - 1].time_sec
    ]
    if not gaps:
        return 2
    median_gap = statistics.median(gaps)
    return max(2, min(8, int(round(window_sec / max(median_gap, 1e-6)))))


def local_prominence(values: list[float], index: int, radius: int, mode: str) -> float:
    lo = max(0, index - radius)
    hi = min(len(values), index + radius + 1)
    before = values[lo:index]
    after = values[index + 1:hi]
    if not before or not after:
        return 0.0
    if mode == "max":
        return min(values[index] - min(before), values[index] - min(after))
    return min(max(before) - values[index], max(after) - values[index])


def is_local_extreme(values: list[float], index: int, radius: int, mode: str) -> bool:
    lo = max(0, index - radius)
    hi = min(len(values), index + radius + 1)
    before = values[lo:index]
    after = values[index + 1:hi]
    if not before or not after:
        return False
    if mode == "max":
        return values[index] >= max(before) and values[index] > max(after)
    return values[index] <= min(before) and values[index] < min(after)


def velocity_around(values: list[float], times: list[float], index: int, radius: int) -> tuple[float, float] | None:
    prev = max(0, index - radius)
    nxt = min(len(values) - 1, index + radius)
    dt_prev = times[index] - times[prev]
    dt_next = times[nxt] - times[index]
    if dt_prev <= 0 or dt_next <= 0:
        return None
    return (values[index] - values[prev]) / dt_prev, (values[nxt] - values[index]) / dt_next


def turn_angle_deg(xs: list[float], ys: list[float], index: int, radius: int) -> float | None:
    prev = max(0, index - radius)
    nxt = min(len(xs) - 1, index + radius)
    v1 = np.asarray([xs[index] - xs[prev], ys[index] - ys[prev]], dtype=float)
    v2 = np.asarray([xs[nxt] - xs[index], ys[nxt] - ys[index]], dtype=float)
    norm = float(np.linalg.norm(v1) * np.linalg.norm(v2))
    if norm <= 1e-6:
        return None
    cosine = float(np.clip(np.dot(v1, v2) / norm, -1.0, 1.0))
    return math.degrees(math.acos(cosine))


def suppress_nearby_events(candidates: list[EventCandidate], min_gap_sec: float) -> list[EventCandidate]:
    kept: list[EventCandidate] = []
    for candidate in sorted(candidates, key=lambda item: item.score, reverse=True):
        if any(
            existing.event_type == candidate.event_type
            and existing.point.rally == candidate.point.rally
            and abs(existing.point.time_sec - candidate.point.time_sec) < min_gap_sec
            for existing in kept
        ):
            continue
        kept.append(candidate)
    return sorted(kept, key=lambda item: (item.point.rally, item.point.time_sec, item.event_type))


def detect_bounces_for_rally(points: list[TrackPoint], args: argparse.Namespace) -> list[EventCandidate]:
    if len(points) < 5:
        return []
    y = smooth([point.image_xy[1] for point in points], args.smooth_window)
    t = [point.time_sec for point in points]
    radius = event_radius(points, args.event_window_sec)
    candidates: list[EventCandidate] = []

    for i in range(radius, len(points) - radius):
        if not is_local_extreme(y, i, radius, "max"):
            continue
        velocity = velocity_around(y, t, i, radius)
        if velocity is None:
            continue
        vy_prev, vy_next = velocity
        prominence = local_prominence(y, i, radius, "max")
        if (
            prominence >= args.bounce_prominence_px
            and vy_prev >= args.min_bounce_vy_px_s
            and vy_next <= -args.min_bounce_vy_px_s
        ):
            candidates.append(EventCandidate("bounce", points[i], abs(vy_prev) + abs(vy_next) + prominence * 12.0))
    return suppress_nearby_events(candidates, args.min_bounce_gap_sec)


def detect_contacts_for_rally(
    points: list[TrackPoint],
    calibration: CourtCalibration,
    args: argparse.Namespace,
    bounces: list[EventCandidate],
) -> list[EventCandidate]:
    if len(points) < 5:
        return []
    x = smooth([point.image_xy[0] for point in points], args.smooth_window)
    y = smooth([point.image_xy[1] for point in points], args.smooth_window)
    t = [point.time_sec for point in points]
    court_points = [calibration.image_to_court(point.image_xy) for point in points]
    court_y = smooth([point[1] for point in court_points], args.smooth_window)
    net_y = calibration.length_m / 2.0
    radius = event_radius(points, args.event_window_sec)
    bounce_times = [candidate.point.time_sec for candidate in bounces]
    candidates: list[EventCandidate] = []

    def far_from_net_score(index: int) -> float:
        return max(0.0, abs(court_y[index] - net_y) - args.contact_min_distance_from_net_m)

    def near_baseline(index: int) -> bool:
        y_m = court_y[index]
        return y_m <= args.contact_baseline_band_m or y_m >= calibration.length_m - args.contact_baseline_band_m

    def too_close_to_bounce(index: int) -> bool:
        if not bounce_times:
            return False
        if far_from_net_score(index) >= args.contact_baseline_band_m:
            return False
        return any(abs(points[index].time_sec - bounce_time) <= args.contact_bounce_exclusion_sec for bounce_time in bounce_times)

    def add_candidate(index: int, score: float) -> None:
        if too_close_to_bounce(index):
            return
        candidates.append(EventCandidate("contact", points[index], score))

    for i in range(radius, len(points) - radius):
        vy = velocity_around(y, t, i, radius)
        if vy is None:
            continue
        vy_prev, vy_next = vy
        turn = turn_angle_deg(x, y, i, radius) or 0.0
        baseline_boost = 180.0 if near_baseline(i) else 0.0
        net_boost = far_from_net_score(i) * 45.0

        for mode in ("min", "max"):
            if not is_local_extreme(y, i, radius, mode):
                continue
            prominence = local_prominence(y, i, radius, mode)
            if prominence < args.contact_prominence_px:
                continue
            vertical_turn = (
                mode == "min"
                and vy_prev <= -args.min_contact_vy_px_s
                and vy_next >= args.min_contact_vy_px_s
            ) or (
                mode == "max"
                and vy_prev >= args.min_contact_vy_px_s
                and vy_next <= -args.min_contact_vy_px_s
            )
            if not vertical_turn and turn < args.contact_turn_min_deg:
                continue
            add_candidate(i, prominence * 12.0 + turn * 4.0 + baseline_boost + net_boost)

        if turn >= args.contact_turn_min_deg and (near_baseline(i) or far_from_net_score(i) > 0.0):
            add_candidate(i, turn * 5.0 + baseline_boost + net_boost)

    signed = [value - net_y for value in court_y]
    crossing_indices: list[int] = []
    for i in range(1, len(points)):
        if signed[i - 1] == 0.0 or signed[i] == 0.0 or signed[i - 1] * signed[i] < 0:
            if crossing_indices and points[i].time_sec - points[crossing_indices[-1]].time_sec < args.min_event_gap_sec:
                continue
            crossing_indices.append(i)

    bounds = [0, *crossing_indices, len(points) - 1]
    for start, end in zip(bounds, bounds[1:]):
        if end - start < max(2, radius):
            continue
        if points[end].time_sec - points[start].time_sec < args.min_contact_gap_sec * 0.45:
            continue
        lo = min(start + 1, end)
        hi = max(start + 1, end)
        segment_indices = range(lo, hi)
        if not segment_indices:
            continue
        best = max(segment_indices, key=lambda idx: abs(court_y[idx] - net_y))
        score_from_net = far_from_net_score(best)
        if score_from_net <= 0.0:
            continue
        add_candidate(best, 240.0 + score_from_net * 60.0)

    return suppress_nearby_events(candidates, args.min_contact_gap_sec)


def compute_speed_for_rally(
    points: list[TrackPoint],
    calibration: CourtCalibration,
    args: argparse.Namespace,
) -> SpeedResult:
    """Robust ball speed.

    Frame-to-frame differencing amplifies detection jitter, and in perspective a
    few-pixel wobble in the far court maps to metres → phantom 200+ km/h samples.
    We therefore (1) smooth image positions, (2) measure displacement over a
    multi-frame window instead of adjacent frames, and (3) drop samples whose
    court position lands well outside the court (off-court noise / high-ball
    ground-plane projection error).
    """
    samples: list[SpeedSample] = []
    raw_speeds_kmh: list[float] = []
    rejected_speed = 0
    rejected_jump = 0

    if len(points) < 2:
        return SpeedResult(samples=[], raw_speeds_kmh=[], rejected_speed=0, rejected_jump=0)

    radius = max(0, args.speed_smooth_window)
    xs = smooth([p.image_xy[0] for p in points], radius)
    ys = smooth([p.image_xy[1] for p in points], radius)
    court = [calibration.image_to_court((xs[i], ys[i])) for i in range(len(points))]
    margin = args.speed_court_margin_m

    def in_bounds(index: int) -> bool:
        cx, cy = court[index]
        return -margin <= cx <= calibration.width_m + margin and -margin <= cy <= calibration.length_m + margin

    step = max(1, args.speed_window_frames)
    for i in range(len(points) - step):
        a = points[i]
        b = points[i + step]
        dt = b.time_sec - a.time_sec
        frame_gap = b.frame_idx - a.frame_idx
        if dt <= 0 or frame_gap <= 0:
            continue

        jump_px_per_frame = math.hypot(xs[i + step] - xs[i], ys[i + step] - ys[i]) / frame_gap
        if jump_px_per_frame > args.max_jump_px_per_frame:
            rejected_jump += 1
            continue

        if not (in_bounds(i) and in_bounds(i + step)):
            rejected_speed += 1
            continue

        distance_m = math.hypot(court[i + step][0] - court[i][0], court[i + step][1] - court[i][1])
        speed_kmh = (distance_m / dt) * 3.6
        if not math.isfinite(speed_kmh):
            rejected_speed += 1
            continue
        raw_speeds_kmh.append(speed_kmh)
        if speed_kmh > args.max_speed_kmh:
            rejected_speed += 1
            continue

        samples.append(
            SpeedSample(
                rally=a.rally,
                start_frame_idx=a.frame_idx,
                end_frame_idx=b.frame_idx,
                time_sec=(a.time_sec + b.time_sec) / 2.0,
                speed_kmh=speed_kmh,
                distance_m=distance_m,
            )
        )

    return SpeedResult(samples=samples, raw_speeds_kmh=raw_speeds_kmh, rejected_speed=rejected_speed, rejected_jump=rejected_jump)


def local_event_speed(event: EventCandidate, speeds: list[SpeedSample], radius_sec: float = 0.25) -> float | None:
    """Robust per-shot speed near a contact/bounce.

    Uses the 75th percentile of nearby windowed samples rather than the max, so a
    single jittery frame (worst exactly at contact, where the ball is fastest and
    the ground-plane projection error is largest) can't define the reported speed.
    """
    if not speeds:
        return None
    nearby = [speed.speed_kmh for speed in speeds if abs(speed.time_sec - event.point.time_sec) <= radius_sec]
    if nearby:
        return percentile(nearby, 75.0)
    nearest = min(speeds, key=lambda speed: abs(speed.time_sec - event.point.time_sec))
    return nearest.speed_kmh


def zone_for_court_xy(x: float, y: float, calibration: CourtCalibration) -> dict[str, str | bool]:
    in_bounds = -0.25 <= x <= calibration.width_m + 0.25 and -0.25 <= y <= calibration.length_m + 0.25
    side = "ad" if x < calibration.width_m / 2.0 else "deuce"
    half = "near" if y < calibration.length_m / 2.0 else "far"
    distance_from_net = abs(y - calibration.length_m / 2.0)
    depth = "short" if distance_from_net <= SERVICE_LINE_FROM_NET_M else "deep"
    return {"side": side, "depth": depth, "half": half, "label": f"{half}_{side}_{depth}", "in_bounds": in_bounds}


def event_to_json(candidate: EventCandidate, calibration: CourtCalibration, speeds: list[SpeedSample]) -> dict[str, Any]:
    image_xy = candidate.point.image_xy
    court_xy = calibration.image_to_court(image_xy)
    speed = local_event_speed(candidate, speeds)
    return {
        "type": candidate.event_type,
        "rally": candidate.point.rally,
        "frameIdx": candidate.point.frame_idx,
        "timeSec": round(candidate.point.time_sec, 3),
        "image_xy": [round(image_xy[0], 2), round(image_xy[1], 2)],
        "court_xy_m": [round(court_xy[0], 3), round(court_xy[1], 3)],
        "zone": zone_for_court_xy(court_xy[0], court_xy[1], calibration),
        "speed_kmh": round(speed, 1) if speed is not None else None,
        "source": candidate.point.source,
    }


def speed_sample_to_json(sample: SpeedSample) -> dict[str, Any]:
    return {
        "rally": sample.rally,
        "startFrameIdx": sample.start_frame_idx,
        "endFrameIdx": sample.end_frame_idx,
        "timeSec": round(sample.time_sec, 3),
        "distanceM": round(sample.distance_m, 3),
        "speedKmh": round(sample.speed_kmh, 1),
    }


def build_rally_outputs(
    points: list[TrackPoint],
    calibration: CourtCalibration,
    args: argparse.Namespace,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[SpeedSample], list[float]]:
    rally_outputs: list[dict[str, Any]] = []
    flat_events: list[dict[str, Any]] = []
    all_speeds: list[SpeedSample] = []
    all_raw_speeds: list[float] = []

    for rally, rally_points in group_by_rally(points).items():
        speed_result = compute_speed_for_rally(rally_points, calibration, args)
        bounces = detect_bounces_for_rally(rally_points, args)
        contacts = detect_contacts_for_rally(rally_points, calibration, args, bounces)
        bounce_events = [event_to_json(event, calibration, speed_result.samples) for event in bounces]
        contact_events = [event_to_json(event, calibration, speed_result.samples) for event in contacts]
        speeds = [sample.speed_kmh for sample in speed_result.samples]
        stats = speed_stats(speeds, speed_result.raw_speeds_kmh)
        all_speeds.extend(speed_result.samples)
        all_raw_speeds.extend(speed_result.raw_speeds_kmh)
        flat_events.extend([*bounce_events, *contact_events])

        rally_outputs.append(
            {
                "rally": rally,
                "n_points": len(rally_points),
                "bounces": bounce_events,
                "contacts": contact_events,
                "peak_kmh": rounded(stats["peak"]),
                "p95_kmh": rounded(stats["p95"]),
                "median_kmh": rounded(stats["median"]),
                "raw_max_kmh": rounded(stats["raw_max"]),
                "court_bounce_positions": [event["court_xy_m"] for event in bounce_events],
                "speed_segments": [speed_sample_to_json(sample) for sample in speed_result.samples],
                "rejected_speed_segments": {
                    "over_max_speed": speed_result.rejected_speed,
                    "over_max_jump": speed_result.rejected_jump,
                },
            }
        )

    flat_events.sort(key=lambda event: (event["rally"], event["timeSec"], event["type"]))
    return rally_outputs, flat_events, all_speeds, all_raw_speeds


def color_for_fraction(t: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, t))
    return (int(255 * (1.0 - t)), 0, int(255 * t))


def rally_color(rally: int) -> tuple[int, int, int]:
    palette = [
        (230, 80, 60),
        (40, 160, 220),
        (80, 180, 90),
        (200, 120, 40),
        (180, 80, 190),
        (80, 120, 230),
        (80, 180, 180),
        (160, 160, 40),
    ]
    return palette[(rally - 1) % len(palette)]


def load_background_frame(dataset: str, clip_id: str, preferred_frame_idx: int) -> np.ndarray:
    frames_dir = DATASETS_DIR / dataset / "frames" / clip_id
    candidates = [
        frames_dir / f"frame_{preferred_frame_idx:06d}.jpg",
        *sorted(frames_dir.glob("frame_*.jpg"))[:1],
    ]
    for path in candidates:
        image = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if image is not None:
            return image

    clip_path = DATASETS_DIR / dataset / "clips" / f"{clip_id}.mp4"
    cap = cv2.VideoCapture(str(clip_path))
    try:
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_POS_FRAMES, preferred_frame_idx)
            ok, image = cap.read()
            if ok and image is not None:
                return image
    finally:
        cap.release()

    return np.zeros((SOURCE_HEIGHT, SOURCE_WIDTH, 3), dtype=np.uint8)


def draw_rally_overlay(
    dataset: str,
    clip_id: str,
    rally: int,
    rally_points: list[TrackPoint],
    bounces: list[dict[str, Any]],
    contacts: list[dict[str, Any]],
    out_path: Path,
    max_jump_px_per_frame: float,
) -> None:
    preferred = rally_points[len(rally_points) // 2].frame_idx if rally_points else 0
    image = load_background_frame(dataset, clip_id, preferred)
    overlay = image.copy()
    n = len(rally_points)
    linked = 0

    for i, point in enumerate(rally_points):
        x, y = point.image_xy
        color = color_for_fraction(i / max(1, n - 1))
        center = (int(round(x)), int(round(y)))
        cv2.circle(overlay, center, 3, color, -1, cv2.LINE_AA)
        if i > 0:
            prev = rally_points[i - 1]
            frame_gap = max(1, point.frame_idx - prev.frame_idx)
            jump = math.hypot(point.image_xy[0] - prev.image_xy[0], point.image_xy[1] - prev.image_xy[1])
            if jump <= max_jump_px_per_frame * frame_gap:
                prev_center = (int(round(prev.image_xy[0])), int(round(prev.image_xy[1])))
                cv2.line(overlay, prev_center, center, color, 2, cv2.LINE_AA)
                linked += 1

    rendered = cv2.addWeighted(overlay, 0.86, image, 0.14, 0)
    for event in bounces:
        x, y = event["image_xy"]
        cv2.circle(rendered, (int(round(x)), int(round(y))), 12, (0, 220, 0), 2, cv2.LINE_AA)
    for event in contacts:
        x, y = event["image_xy"]
        cv2.drawMarker(rendered, (int(round(x)), int(round(y))), (0, 140, 255), cv2.MARKER_TILTED_CROSS, 18, 2, cv2.LINE_AA)

    start = rally_points[0].time_sec if rally_points else 0.0
    end = rally_points[-1].time_sec if rally_points else 0.0
    cv2.putText(
        rendered,
        f"{clip_id} rally {rally:02d} {start:.1f}-{end:.1f}s pts={n} links={linked} bounce={len(bounces)} contact={len(contacts)}",
        (20, 38),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.72,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(out_path), rendered):
        raise OSError(f"Failed to write overlay: {out_path}")


def court_to_canvas(x: float, y: float, scale: float, margin: int) -> tuple[int, int]:
    return margin + int(round(x * scale)), margin + int(round(y * scale))


def draw_court_map(calibration: CourtCalibration, rally_outputs: list[dict[str, Any]], out_path: Path) -> None:
    scale = 42.0
    margin = 42
    canvas_w = int(round(calibration.width_m * scale)) + margin * 2
    canvas_h = int(round(calibration.length_m * scale)) + margin * 2
    image = np.full((canvas_h, canvas_w, 3), 245, dtype=np.uint8)

    def line(a: tuple[float, float], b: tuple[float, float], color: tuple[int, int, int] = (40, 40, 40), thickness: int = 2) -> None:
        cv2.line(image, court_to_canvas(a[0], a[1], scale, margin), court_to_canvas(b[0], b[1], scale, margin), color, thickness, cv2.LINE_AA)

    w = calibration.width_m
    l = calibration.length_m
    net_y = l / 2.0
    service_near = net_y - SERVICE_LINE_FROM_NET_M
    service_far = net_y + SERVICE_LINE_FROM_NET_M
    line((0, 0), (w, 0))
    line((w, 0), (w, l))
    line((w, l), (0, l))
    line((0, l), (0, 0))
    line((0, net_y), (w, net_y), (30, 30, 30), 3)
    line((0, service_near), (w, service_near))
    line((0, service_far), (w, service_far))
    line((w / 2.0, service_near), (w / 2.0, service_far))

    for rally in rally_outputs:
        color = rally_color(int(rally["rally"]))
        for x, y in rally["court_bounce_positions"]:
            px, py = court_to_canvas(float(x), float(y), scale, margin)
            cv2.circle(image, (px, py), 7, color, -1, cv2.LINE_AA)
            cv2.putText(image, str(rally["rally"]), (px + 7, py - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.38, color, 1, cv2.LINE_AA)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(out_path), image):
        raise OSError(f"Failed to write court map: {out_path}")


def write_outputs(
    dataset: str,
    clip_id: str,
    track_model: str,
    calibration: CourtCalibration,
    points: list[TrackPoint],
    rally_outputs: list[dict[str, Any]],
    flat_events: list[dict[str, Any]],
    all_speeds: list[SpeedSample],
    all_raw_speeds: list[float],
    args: argparse.Namespace,
) -> Path:
    output_dir = resolve_path(args.output_dir, Path(args.output_dir))
    output_dir.mkdir(parents=True, exist_ok=True)
    points_by_rally = group_by_rally(points)
    rally_by_id = {rally["rally"]: rally for rally in rally_outputs}

    for rally, rally_points in points_by_rally.items():
        rally_payload = rally_by_id[rally]
        overlay_path = output_dir / f"{clip_id}_rally{rally:02d}.jpg"
        draw_rally_overlay(
            dataset,
            clip_id,
            rally,
            rally_points,
            rally_payload["bounces"],
            rally_payload["contacts"],
            overlay_path,
            args.max_jump_px_per_frame,
        )
        rally_payload["overlay"] = display_path(overlay_path)

    court_map_path = output_dir / f"{clip_id}_court.jpg"
    draw_court_map(calibration, rally_outputs, court_map_path)

    speed_values = [sample.speed_kmh for sample in all_speeds]
    stats = speed_stats(speed_values, all_raw_speeds)
    payload = {
        "schemaVersion": 2,
        "dataset": dataset,
        "clipId": clip_id,
        "trajectory": {
            "model": track_model,
            "path": display_path(DATASETS_DIR / dataset / "ball-tracks" / track_model / "clean" / f"{clip_id}.jsonl"),
            "points": len(points),
        },
        "court": {"type": calibration.court, "widthM": calibration.width_m, "lengthM": calibration.length_m},
        "caveats": [
            "Bounce/contact events are heuristic from ball trajectory and court homography; review per-rally overlays before product use.",
            "Speed is estimated from a smoothed trajectory over a multi-frame window (75th-percentile near each shot) to suppress jitter; treat it as an approximate/relative indicator, not a radar reading.",
            "Absolute speed is biased high for airborne balls: the ground-plane homography projects a ball above the court further than it truly moves, worst in the near court. Accurate absolute speed needs precise per-clip calibration and, ultimately, ball-height (3D) estimation.",
        ],
        "filters": {
            "smoothWindow": args.smooth_window,
            "eventWindowSec": args.event_window_sec,
            "minBounceVyPxS": args.min_bounce_vy_px_s,
            "bounceProminencePx": args.bounce_prominence_px,
            "minBounceGapSec": args.min_bounce_gap_sec,
            "minContactVyPxS": args.min_contact_vy_px_s,
            "contactProminencePx": args.contact_prominence_px,
            "contactTurnMinDeg": args.contact_turn_min_deg,
            "contactMinDistanceFromNetM": args.contact_min_distance_from_net_m,
            "contactBounceExclusionSec": args.contact_bounce_exclusion_sec,
            "minContactGapSec": args.min_contact_gap_sec,
            "maxSpeedKmh": args.max_speed_kmh,
            "maxJumpPxPerFrame": args.max_jump_px_per_frame,
        },
        "summary": {
            "rallies": len(rally_outputs),
            "events": len(flat_events),
            "bounces": sum(len(rally["bounces"]) for rally in rally_outputs),
            "contacts": sum(len(rally["contacts"]) for rally in rally_outputs),
            "speedSamples": len(all_speeds),
            "peakSpeedKmh": rounded(stats["peak"]),
            "p95SpeedKmh": rounded(stats["p95"]),
            "medianSpeedKmh": rounded(stats["median"]),
            "rawMaxSpeedKmh": rounded(stats["raw_max"]),
            "courtMap": display_path(court_map_path),
        },
        "rallies": rally_outputs,
        "shots": flat_events,
    }

    out_path = output_dir / f"{clip_id}.json"
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
    return out_path


def synthetic_trajectory() -> tuple[list[TrackPoint], CourtCalibration]:
    calibration = court_calibration_from_json(
        {
            "court": "singles",
            "image_corners": [[0, 0], [SOURCE_WIDTH, 0], [SOURCE_WIDTH, SOURCE_HEIGHT], [0, SOURCE_HEIGHT]],
            "court_corners_m": [[0, 0], [SINGLES_WIDTH_M, 0], [SINGLES_WIDTH_M, COURT_LENGTH_M], [0, COURT_LENGTH_M]],
        }
    )
    y_values = [0.38, 0.43, 0.50, 0.58, 0.66, 0.61, 0.54, 0.49, 0.45, 0.42]
    points = [
        TrackPoint(
            frame_idx=i,
            time_sec=i / 30.0,
            x_norm=0.30 + 0.035 * i,
            y_norm=y,
            source="det",
            rally=1,
        )
        for i, y in enumerate(y_values)
    ]
    return points, calibration


def run_self_test() -> None:
    points, calibration = synthetic_trajectory()
    args = argparse.Namespace(
        smooth_window=1,
        event_window_sec=0.12,
        min_bounce_vy_px_s=20.0,
        bounce_prominence_px=0.5,
        min_bounce_gap_sec=0.1,
        min_contact_vy_px_s=20.0,
        contact_prominence_px=0.5,
        contact_turn_min_deg=20.0,
        contact_baseline_band_m=3.0,
        contact_min_distance_from_net_m=1.0,
        contact_bounce_exclusion_sec=0.05,
        min_event_gap_sec=0.1,
        min_contact_gap_sec=0.1,
        max_speed_kmh=250.0,
        max_jump_px_per_frame=80.0,
        speed_smooth_window=1,
        speed_window_frames=1,
        speed_court_margin_m=6.0,
    )
    rallies, events, speeds, raw_speeds = build_rally_outputs(points, calibration, args)
    assert rallies and rallies[0]["bounces"], "expected at least one synthetic bounce"
    assert speeds, "expected synthetic speed samples"
    assert max(sample.speed_kmh for sample in speeds) <= args.max_speed_kmh
    mapped = calibration.image_to_court(points[0].image_xy)
    assert 0.0 <= mapped[0] <= SINGLES_WIDTH_M and 0.0 <= mapped[1] <= COURT_LENGTH_M
    print(
        "SELF_TEST ok "
        f"rallies={len(rallies)} bounces={sum(len(r['bounces']) for r in rallies)} "
        f"events={len(events)} speed_samples={len(speeds)} "
        f"p95_kmh={percentile([s.speed_kmh for s in speeds], 95.0):.1f} raw_max_kmh={max(raw_speeds):.1f}"
    )


def main() -> None:
    args = parse_args()
    if args.self_test:
        run_self_test()
        return

    points = load_clean_trajectory(args.dataset, args.track_model, args.clip_id)
    calibration = load_court_calibration(args.dataset, args.clip_id)
    rally_outputs, flat_events, all_speeds, all_raw_speeds = build_rally_outputs(points, calibration, args)
    out_path = write_outputs(
        args.dataset,
        args.clip_id,
        args.track_model,
        calibration,
        points,
        rally_outputs,
        flat_events,
        all_speeds,
        all_raw_speeds,
        args,
    )
    speed_values = [sample.speed_kmh for sample in all_speeds]
    stats = speed_stats(speed_values, all_raw_speeds)
    print(f"shot_events {display_path(out_path)}")
    print(
        f"rallies={len(rally_outputs)} "
        f"bounces={sum(len(r['bounces']) for r in rally_outputs)} "
        f"contacts={sum(len(r['contacts']) for r in rally_outputs)}"
    )
    if speed_values:
        print(
            f"speed_samples={len(speed_values)} "
            f"p95_kmh={stats['p95']:.1f} median_kmh={stats['median']:.1f} raw_max_kmh={stats['raw_max']:.1f}"
        )
    for rally in rally_outputs:
        print(
            f"rally={rally['rally']:02d} points={rally['n_points']} "
            f"bounces={len(rally['bounces'])} contacts={len(rally['contacts'])} "
            f"p95_kmh={rally['p95_kmh']} median_kmh={rally['median_kmh']}"
        )
    print(f"court_map {display_path(out_path.parent / f'{args.clip_id}_court.jpg')}")


if __name__ == "__main__":
    main()
