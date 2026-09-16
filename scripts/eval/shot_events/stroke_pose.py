#!/usr/bin/env python3.11
"""Classify contact events with YOLO pose keypoints."""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # scripts/eval, for _common
from _common import display_path, resolve_path

BASE = Path(__file__).resolve().parents[3]
DATASETS_DIR = BASE / "eval" / "datasets"
RESULTS_DIR = BASE / "eval" / "results" / "shot-events"
MODEL_PATH = BASE / "yolo11n-pose.pt"

KP_LEFT_SHOULDER = 5
KP_RIGHT_SHOULDER = 6
KP_LEFT_ELBOW = 7
KP_RIGHT_ELBOW = 8
KP_LEFT_WRIST = 9
KP_RIGHT_WRIST = 10
KP_LEFT_HIP = 11
KP_RIGHT_HIP = 12
KP_LEFT_KNEE = 13
KP_RIGHT_KNEE = 14
KP_LEFT_ANKLE = 15
KP_RIGHT_ANKLE = 16

SKELETON = [
    (KP_LEFT_SHOULDER, KP_RIGHT_SHOULDER),
    (KP_LEFT_SHOULDER, KP_LEFT_ELBOW),
    (KP_LEFT_ELBOW, KP_LEFT_WRIST),
    (KP_RIGHT_SHOULDER, KP_RIGHT_ELBOW),
    (KP_RIGHT_ELBOW, KP_RIGHT_WRIST),
    (KP_LEFT_SHOULDER, KP_LEFT_HIP),
    (KP_RIGHT_SHOULDER, KP_RIGHT_HIP),
    (KP_LEFT_HIP, KP_RIGHT_HIP),
    (KP_LEFT_HIP, KP_LEFT_KNEE),
    (KP_LEFT_KNEE, KP_LEFT_ANKLE),
    (KP_RIGHT_HIP, KP_RIGHT_KNEE),
    (KP_RIGHT_KNEE, KP_RIGHT_ANKLE),
]


@dataclass(frozen=True)
class PersonPose:
    box_xyxy: np.ndarray
    box_conf: float
    keypoints: np.ndarray
    keypoint_conf: np.ndarray

    @property
    def center(self) -> tuple[float, float]:
        x1, y1, x2, y2 = self.box_xyxy
        return float((x1 + x2) / 2.0), float((y1 + y2) / 2.0)

    @property
    def area(self) -> float:
        x1, y1, x2, y2 = self.box_xyxy
        return float(max(0.0, x2 - x1) * max(0.0, y2 - y1))


@dataclass(frozen=True)
class PlayerSelection:
    person: PersonPose | None
    confidence: float
    score_px: float | None
    rejected: bool = False
    caveat: str | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fuse contact events with YOLO pose for stroke labels.")
    parser.add_argument("--dataset", default="fixed-camera-v2")
    parser.add_argument("--clip-id", default="yt-maitou-suzumura-muko-clip1")
    parser.add_argument("--events", default=None, help="Defaults to eval/results/shot-events/<clip>.json")
    parser.add_argument("--output-dir", default="eval/results/shot-events")
    parser.add_argument("--model", default=str(MODEL_PATH))
    parser.add_argument("--handedness", choices=("right", "left"), default="right")
    parser.add_argument("--conf", type=float, default=0.25)
    parser.add_argument("--imgsz", type=int, default=960, help="YOLO pose inference size; larger helps far players.")
    parser.add_argument("--kp-conf", type=float, default=0.2)
    parser.add_argument("--overlay-n", type=int, default=6)
    parser.add_argument("--ambiguity-px", type=float, default=35.0)
    parser.add_argument("--max-player-ball-px", type=float, default=220.0)
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def valid_kp(person: PersonPose, idx: int, kp_conf: float) -> bool:
    x, y = person.keypoints[idx]
    return bool(person.keypoint_conf[idx] >= kp_conf and math.isfinite(float(x)) and math.isfinite(float(y)) and (x > 0 or y > 0))


def kp(person: PersonPose, idx: int, kp_conf: float) -> np.ndarray | None:
    return person.keypoints[idx].astype(float) if valid_kp(person, idx, kp_conf) else None


def mean_points(points: list[np.ndarray | None]) -> np.ndarray | None:
    valid = [point for point in points if point is not None]
    if not valid:
        return None
    return np.mean(np.stack(valid), axis=0)


def torso_center(person: PersonPose, kp_conf: float) -> np.ndarray:
    center = mean_points(
        [
            kp(person, KP_LEFT_SHOULDER, kp_conf),
            kp(person, KP_RIGHT_SHOULDER, kp_conf),
            kp(person, KP_LEFT_HIP, kp_conf),
            kp(person, KP_RIGHT_HIP, kp_conf),
        ]
    )
    if center is not None:
        return center
    return np.asarray(person.center, dtype=float)


def body_side_center(person: PersonPose, side: str, kp_conf: float) -> np.ndarray | None:
    if side == "right":
        return mean_points([kp(person, KP_RIGHT_SHOULDER, kp_conf), kp(person, KP_RIGHT_HIP, kp_conf)])
    return mean_points([kp(person, KP_LEFT_SHOULDER, kp_conf), kp(person, KP_LEFT_HIP, kp_conf)])


def distance(a: np.ndarray | tuple[float, float], b: np.ndarray | tuple[float, float]) -> float:
    ax, ay = float(a[0]), float(a[1])
    bx, by = float(b[0]), float(b[1])
    return math.hypot(ax - bx, ay - by)


def person_ball_score(person: PersonPose, ball_xy: np.ndarray, kp_conf: float) -> float:
    wrists = [kp(person, KP_LEFT_WRIST, kp_conf), kp(person, KP_RIGHT_WRIST, kp_conf)]
    wrist_distances = [distance(wrist, ball_xy) for wrist in wrists if wrist is not None]
    if wrist_distances:
        return min(wrist_distances)
    return distance(torso_center(person, kp_conf), ball_xy) + 125.0


def select_striking_player(
    persons: list[PersonPose],
    ball_xy: tuple[float, float],
    kp_conf: float,
    ambiguity_px: float,
) -> PlayerSelection:
    if not persons:
        return PlayerSelection(None, 0.0, None, caveat="No pose person detected on contact frame.")
    ball = np.asarray(ball_xy, dtype=float)
    scored = [(person_ball_score(person, ball, kp_conf), person) for person in persons]
    scored.sort(key=lambda item: item[0])
    best_score = scored[0][0]
    ambiguous = [item for item in scored if item[0] - best_score <= ambiguity_px]
    if len(ambiguous) > 1:
        _, best = max(ambiguous, key=lambda item: item[1].center[1])
    else:
        best = scored[0][1]
    confidence = max(0.0, min(1.0, 1.0 - best_score / 420.0))
    return PlayerSelection(best, confidence, best_score)


def reject_selection_if_needed(selection: PlayerSelection, max_player_ball_px: float) -> PlayerSelection:
    if selection.person is None or selection.score_px is None:
        return selection
    if selection.score_px <= max_player_ball_px:
        return selection
    return PlayerSelection(
        selection.person,
        0.0,
        selection.score_px,
        rejected=True,
        caveat=f"Nearest detected player wrist/body is {selection.score_px:.1f}px from the ball.",
    )


def angle_deg(a: np.ndarray | None, b: np.ndarray | None, c: np.ndarray | None) -> float | None:
    if a is None or b is None or c is None:
        return None
    ba = a - b
    bc = c - b
    norm = float(np.linalg.norm(ba) * np.linalg.norm(bc))
    if norm <= 1e-6:
        return None
    cosine = float(np.clip(np.dot(ba, bc) / norm, -1.0, 1.0))
    return math.degrees(math.acos(cosine))


def line_angle_deg(a: np.ndarray | None, b: np.ndarray | None) -> float | None:
    if a is None or b is None:
        return None
    dx, dy = b - a
    if abs(float(dx)) < 1e-6 and abs(float(dy)) < 1e-6:
        return None
    return math.degrees(math.atan2(float(dy), float(dx)))


def angle_separation_deg(a: float | None, b: float | None) -> float | None:
    if a is None or b is None:
        return None
    diff = abs((a - b + 180.0) % 360.0 - 180.0)
    return diff if diff <= 90.0 else 180.0 - diff


def dominant_indices(handedness: str) -> tuple[int, int, int, int]:
    if handedness == "left":
        return KP_LEFT_SHOULDER, KP_LEFT_ELBOW, KP_LEFT_WRIST, KP_LEFT_HIP
    return KP_RIGHT_SHOULDER, KP_RIGHT_ELBOW, KP_RIGHT_WRIST, KP_RIGHT_HIP


def classify_stroke(
    person: PersonPose,
    ball_xy: tuple[float, float],
    handedness: str,
    kp_conf: float,
) -> tuple[str, float, dict[str, Any]]:
    ball = np.asarray(ball_xy, dtype=float)
    torso = torso_center(person, kp_conf)
    dominant_side = body_side_center(person, handedness, kp_conf)
    dom_shoulder, _, dom_wrist, _ = dominant_indices(handedness)
    dominant_wrist = kp(person, dom_wrist, kp_conf)
    if dominant_side is None:
        dominant_side = dominant_wrist

    if dominant_side is None:
        side_sign = 1.0 if handedness == "right" else -1.0
    else:
        side_sign = math.copysign(1.0, float(dominant_side[0] - torso[0]) or (1.0 if handedness == "right" else -1.0))
    ball_sign = math.copysign(1.0, float(ball[0] - torso[0]) or side_sign)

    stroke = "forehand" if ball_sign == side_sign else "backhand"
    shoulder_left = kp(person, KP_LEFT_SHOULDER, kp_conf)
    shoulder_right = kp(person, KP_RIGHT_SHOULDER, kp_conf)
    shoulder_width = distance(shoulder_left, shoulder_right) if shoulder_left is not None and shoulder_right is not None else max(80.0, math.sqrt(person.area) * 0.25)
    margin = abs(float(ball[0] - torso[0])) / max(shoulder_width, 1.0)
    wrist_distance = distance(dominant_wrist, ball) if dominant_wrist is not None else None
    wrist_term = 0.0 if wrist_distance is None else max(0.0, min(1.0, 1.0 - wrist_distance / 260.0))
    confidence = max(0.15, min(0.98, 0.25 + 0.45 * min(1.0, margin) + 0.30 * wrist_term))
    debug = {
        "torsoMidlineX": round(float(torso[0]), 2),
        "ballSide": "image_right" if ball_sign > 0 else "image_left",
        "dominantSide": "image_right" if side_sign > 0 else "image_left",
        "dominantWristToBallPx": round(wrist_distance, 1) if wrist_distance is not None else None,
        "dominantShoulderVisible": valid_kp(person, dom_shoulder, kp_conf),
    }
    return stroke, confidence, debug


def rounded(value: float | None, digits: int = 1) -> float | None:
    return round(float(value), digits) if value is not None and math.isfinite(float(value)) else None


def form_metrics(person: PersonPose, ball_xy: tuple[float, float], handedness: str, kp_conf: float) -> dict[str, Any]:
    ls = kp(person, KP_LEFT_SHOULDER, kp_conf)
    rs = kp(person, KP_RIGHT_SHOULDER, kp_conf)
    le = kp(person, KP_LEFT_ELBOW, kp_conf)
    re = kp(person, KP_RIGHT_ELBOW, kp_conf)
    lw = kp(person, KP_LEFT_WRIST, kp_conf)
    rw = kp(person, KP_RIGHT_WRIST, kp_conf)
    lh = kp(person, KP_LEFT_HIP, kp_conf)
    rh = kp(person, KP_RIGHT_HIP, kp_conf)
    lk = kp(person, KP_LEFT_KNEE, kp_conf)
    rk = kp(person, KP_RIGHT_KNEE, kp_conf)
    la = kp(person, KP_LEFT_ANKLE, kp_conf)
    ra = kp(person, KP_RIGHT_ANKLE, kp_conf)
    dom_shoulder, dom_elbow, dom_wrist, _ = dominant_indices(handedness)

    left_knee = angle_deg(lh, lk, la)
    right_knee = angle_deg(rh, rk, ra)
    knee_angles = [value for value in (left_knee, right_knee) if value is not None]
    min_knee = min(knee_angles) if knee_angles else None
    shoulder_angle = line_angle_deg(ls, rs)
    hip_angle = line_angle_deg(lh, rh)
    hip_center = mean_points([lh, rh])
    shoulder_center = mean_points([ls, rs])
    torso_height = distance(shoulder_center, hip_center) if shoulder_center is not None and hip_center is not None else None
    ball = np.asarray(ball_xy, dtype=float)
    contact_height = None
    if hip_center is not None and torso_height is not None and torso_height > 1e-6:
        contact_height = (float(hip_center[1]) - float(ball[1])) / torso_height

    dom_wrist_point = kp(person, dom_wrist, kp_conf)
    return {
        "left_knee_angle_deg": rounded(left_knee),
        "right_knee_angle_deg": rounded(right_knee),
        "knee_flexion_deg": rounded(180.0 - min_knee if min_knee is not None else None),
        "hip_shoulder_separation_deg": rounded(angle_separation_deg(shoulder_angle, hip_angle)),
        "striking_arm_elbow_angle_deg": rounded(
            angle_deg(kp(person, dom_shoulder, kp_conf), kp(person, dom_elbow, kp_conf), dom_wrist_point)
        ),
        "contact_height_relative_to_hip": rounded(contact_height, 2),
        "dominant_wrist_to_ball_px": rounded(distance(dom_wrist_point, ball) if dom_wrist_point is not None else None),
        "pose_confidence": rounded(person.box_conf, 3),
        "bbox_xyxy": [round(float(value), 1) for value in person.box_xyxy.tolist()],
    }


def load_shot_events(clip_id: str, path_value: str | None) -> dict[str, Any]:
    path = resolve_path(path_value, Path(path_value)) if path_value else RESULTS_DIR / f"{clip_id}.json"
    if not path.exists():
        raise SystemExit(f"B2 shot-events JSON not found: {display_path(path)}")
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def contact_events(events_payload: dict[str, Any]) -> list[dict[str, Any]]:
    contacts: list[dict[str, Any]] = []
    for rally in events_payload.get("rallies", []):
        contacts.extend(rally.get("contacts", []))
    if contacts:
        return sorted(contacts, key=lambda event: (event.get("rally", 0), event.get("timeSec", 0.0)))
    return sorted(
        [event for event in events_payload.get("shots", []) if event.get("type") == "contact"],
        key=lambda event: (event.get("rally", 0), event.get("timeSec", 0.0)),
    )


def load_pose_model(model_path: str):
    os.environ.setdefault("YOLO_CONFIG_DIR", str(BASE / ".ultralytics"))
    from ultralytics import YOLO

    return YOLO(model_path)


def run_pose(model: Any, frame_path: Path, conf: float, imgsz: int) -> list[PersonPose]:
    results = model(str(frame_path), conf=conf, imgsz=imgsz, verbose=False)
    if not results:
        return []
    result = results[0]
    if result.keypoints is None or result.boxes is None or len(result.boxes) == 0:
        return []

    boxes = result.boxes.xyxy.cpu().numpy()
    box_conf = result.boxes.conf.cpu().numpy()
    keypoints = result.keypoints.xy.cpu().numpy()
    if getattr(result.keypoints, "conf", None) is not None:
        keypoint_conf = result.keypoints.conf.cpu().numpy()
    else:
        keypoint_conf = np.where(np.linalg.norm(keypoints, axis=2) > 0, 1.0, 0.0)

    return [
        PersonPose(
            box_xyxy=boxes[i].astype(float),
            box_conf=float(box_conf[i]),
            keypoints=keypoints[i].astype(float),
            keypoint_conf=keypoint_conf[i].astype(float),
        )
        for i in range(len(boxes))
    ]


def frame_path(dataset: str, clip_id: str, frame_idx: int) -> Path:
    return DATASETS_DIR / dataset / "frames" / clip_id / f"frame_{frame_idx:06d}.jpg"


def classify_contact(
    contact: dict[str, Any],
    selection: PlayerSelection,
    handedness: str,
    kp_conf: float,
) -> dict[str, Any]:
    ball_xy = tuple(float(v) for v in contact["image_xy"])
    base = {
        "rally": int(contact.get("rally", 0)),
        "frameIdx": int(contact["frameIdx"]),
        "timeSec": float(contact["timeSec"]),
        "ball_image_xy": [round(ball_xy[0], 2), round(ball_xy[1], 2)],
        "court_xy_m": contact.get("court_xy_m"),
        "zone": contact.get("zone"),
        "b2_speed_kmh": contact.get("speed_kmh"),
    }
    person = selection.person
    if person is None:
        return {
            **base,
            "stroke_type": "unknown",
            "confidence": 0.0,
            "striking_player": None,
            "form": {},
            "caveat": selection.caveat or "No pose person detected on contact frame.",
        }

    player_payload = {
        "selection_confidence": round(selection.confidence, 3),
        "ball_distance_px": rounded(selection.score_px),
        "bbox_xyxy": [round(float(value), 1) for value in person.box_xyxy.tolist()],
        "center_xy": [round(person.center[0], 1), round(person.center[1], 1)],
    }
    if selection.rejected:
        return {
            **base,
            "stroke_type": "unknown",
            "confidence": 0.0,
            "striking_player": player_payload,
            "form": form_metrics(person, ball_xy, handedness, kp_conf),
            "caveat": selection.caveat,
        }

    stroke_type, stroke_confidence, debug = classify_stroke(person, ball_xy, handedness, kp_conf)
    return {
        **base,
        "stroke_type": stroke_type,
        "confidence": round(min(1.0, stroke_confidence * (0.5 + 0.5 * selection.confidence)), 3),
        "striking_player": player_payload,
        "form": form_metrics(person, ball_xy, handedness, kp_conf),
        "debug": debug,
    }


def draw_pose_overlay(
    image: np.ndarray,
    person: PersonPose | None,
    ball_xy: tuple[float, float],
    stroke: dict[str, Any],
    out_path: Path,
    kp_conf: float,
) -> bool:
    canvas = image.copy()
    ball = (int(round(ball_xy[0])), int(round(ball_xy[1])))
    cv2.circle(canvas, ball, 14, (0, 255, 255), 3, cv2.LINE_AA)
    cv2.drawMarker(canvas, ball, (0, 0, 255), cv2.MARKER_CROSS, 22, 2, cv2.LINE_AA)

    if person is not None:
        for a, b in SKELETON:
            pa = kp(person, a, kp_conf)
            pb = kp(person, b, kp_conf)
            if pa is None or pb is None:
                continue
            cv2.line(
                canvas,
                (int(round(pa[0])), int(round(pa[1]))),
                (int(round(pb[0])), int(round(pb[1]))),
                (255, 210, 40),
                2,
                cv2.LINE_AA,
            )
        for idx in range(person.keypoints.shape[0]):
            point = kp(person, idx, kp_conf)
            if point is not None:
                cv2.circle(canvas, (int(round(point[0])), int(round(point[1]))), 4, (40, 240, 60), -1, cv2.LINE_AA)
        x1, y1, x2, y2 = person.box_xyxy
        cv2.rectangle(canvas, (int(x1), int(y1)), (int(x2), int(y2)), (255, 210, 40), 2)

    label = stroke["stroke_type"].upper()
    conf = float(stroke.get("confidence", 0.0))
    cv2.rectangle(canvas, (18, 18), (360, 78), (0, 0, 0), -1)
    cv2.putText(canvas, f"{label} {conf:.2f}", (30, 60), cv2.FONT_HERSHEY_SIMPLEX, 1.15, (255, 255, 255), 2, cv2.LINE_AA)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    return bool(cv2.imwrite(str(out_path), canvas))


def process_clip(args: argparse.Namespace) -> dict[str, Any]:
    events_payload = load_shot_events(args.clip_id, args.events)
    contacts = contact_events(events_payload)
    out_dir = resolve_path(args.output_dir, Path(args.output_dir))
    overlay_dir = out_dir / "strokes"
    model = load_pose_model(args.model)

    strokes: list[dict[str, Any]] = []
    overlays: list[str] = []
    for index, contact in enumerate(contacts):
        frame_idx = int(contact["frameIdx"])
        path = frame_path(args.dataset, args.clip_id, frame_idx)
        image = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if image is None:
            stroke = {
                "rally": int(contact.get("rally", 0)),
                "frameIdx": frame_idx,
                "timeSec": float(contact["timeSec"]),
                "ball_image_xy": contact["image_xy"],
                "stroke_type": "unknown",
                "confidence": 0.0,
                "form": {},
                "caveat": f"Contact frame missing: {display_path(path)}",
            }
            strokes.append(stroke)
            continue

        persons = run_pose(model, path, args.conf, args.imgsz)
        selection = select_striking_player(
            persons,
            tuple(float(v) for v in contact["image_xy"]),
            args.kp_conf,
            args.ambiguity_px,
        )
        selection = reject_selection_if_needed(selection, args.max_player_ball_px)
        stroke = classify_contact(contact, selection, args.handedness, args.kp_conf)
        strokes.append(stroke)

        if len(overlays) < args.overlay_n:
            out_path = overlay_dir / f"{args.clip_id}_rally{int(contact.get('rally', 0)):02d}_frame_{frame_idx:06d}.jpg"
            if draw_pose_overlay(image, selection.person, tuple(float(v) for v in contact["image_xy"]), stroke, out_path, args.kp_conf):
                overlays.append(display_path(out_path))

    counts: dict[str, int] = defaultdict(int)
    for stroke in strokes:
        counts[str(stroke["stroke_type"])] += 1

    payload = {
        "schemaVersion": 1,
        "dataset": args.dataset,
        "clipId": args.clip_id,
        "sourceShotEvents": display_path(
            resolve_path(args.events, Path(args.events)) if args.events else RESULTS_DIR / f"{args.clip_id}.json"
        ),
        "handedness": args.handedness,
        "caveats": [
            "Stroke type and form metrics are heuristic from single-frame COCO pose keypoints.",
            "Far-player pose can be small or occluded; review overlays before product use.",
            "Forehand/backhand assumes the provided handedness and uses ball side relative to the player's anatomical torso side.",
            "Contacts whose nearest detected player is too far from the ball are emitted as unknown.",
        ],
        "summary": {"contacts": len(strokes), "counts": dict(sorted(counts.items())), "overlays": overlays},
        "contacts": strokes,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{args.clip_id}_strokes.json"
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
    return payload


def synthetic_person() -> PersonPose:
    kps = np.zeros((17, 2), dtype=float)
    conf = np.zeros(17, dtype=float)
    values = {
        KP_LEFT_SHOULDER: (80, 100),
        KP_RIGHT_SHOULDER: (120, 100),
        KP_LEFT_ELBOW: (75, 145),
        KP_RIGHT_ELBOW: (155, 135),
        KP_LEFT_WRIST: (70, 190),
        KP_RIGHT_WRIST: (185, 150),
        KP_LEFT_HIP: (85, 190),
        KP_RIGHT_HIP: (115, 190),
        KP_LEFT_KNEE: (82, 270),
        KP_RIGHT_KNEE: (120, 265),
        KP_LEFT_ANKLE: (78, 350),
        KP_RIGHT_ANKLE: (135, 340),
    }
    for idx, xy in values.items():
        kps[idx] = xy
        conf[idx] = 0.95
    return PersonPose(np.asarray([55, 70, 205, 360], dtype=float), 0.9, kps, conf)


def run_self_test() -> None:
    person = synthetic_person()
    forehand, fh_conf, _ = classify_stroke(person, (170, 150), "right", 0.2)
    backhand, bh_conf, _ = classify_stroke(person, (55, 155), "right", 0.2)
    metrics = form_metrics(person, (170, 150), "right", 0.2)
    assert forehand == "forehand"
    assert backhand == "backhand"
    assert fh_conf > 0 and bh_conf > 0
    assert metrics["striking_arm_elbow_angle_deg"] is not None
    assert metrics["knee_flexion_deg"] is not None
    print(
        "SELF_TEST ok "
        f"fh={forehand}:{fh_conf:.2f} bh={backhand}:{bh_conf:.2f} "
        f"elbow={metrics['striking_arm_elbow_angle_deg']} knee_flexion={metrics['knee_flexion_deg']}"
    )


def main() -> None:
    args = parse_args()
    if args.self_test:
        run_self_test()
        return
    payload = process_clip(args)
    summary = payload["summary"]
    print(
        f"stroke_pose {display_path(resolve_path(args.output_dir, Path(args.output_dir)) / f'{args.clip_id}_strokes.json')}"
    )
    print(f"contacts={summary['contacts']} counts={summary['counts']}")
    print(
        f"overlays={len(summary['overlays'])} dir={display_path(resolve_path(args.output_dir, Path(args.output_dir)) / 'strokes')}"
    )


if __name__ == "__main__":
    main()
