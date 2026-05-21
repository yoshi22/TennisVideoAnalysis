#!/usr/bin/env python3
"""
scoreless-window-rerank-v2.py - scoreless multimodal window reranker.

This extends scoreless-window-rerank.py with optional local-only perception
features:
  - visual activity rows from scoreless-rally-refine.py
  - lightweight motion-attention rows from motion-tracks/*.jsonl
  - pose TSV activity features from pose/*.tsv

Labels are used only for training/evaluation. Scoreboard/OCR/score-state inputs
are never read.

Usage:
  /usr/local/bin/python3.11 scripts/eval/scoreless-window-rerank-v2.py \
      --dataset fixed-camera-v2 --run-id iter-rerank-v2-seed \
      --base-run-id iter-v2-scoreless-refine-seed
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier

BASE = Path(__file__).parent.parent.parent
DATASET = "fixed-camera-v2"
DATASET_DIR = BASE / "eval/datasets" / DATASET
LABEL_DIR = DATASET_DIR / "labels"
MOTION_DIR = DATASET_DIR / "motion-tracks"
POSE_DIR = DATASET_DIR / "pose"
RESULTS_DIR = BASE / "eval/results"
REFINE_SCRIPT = BASE / "scripts/eval/scoreless-rally-refine.py"
RERANK_SCRIPT = BASE / "scripts/eval/scoreless-window-rerank.py"


@dataclass(frozen=True)
class Candidate:
    clip_id: str
    start_sec: float
    end_sec: float
    source: str
    config_id: str
    features: list[float]
    max_iou: float
    label: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default=DATASET)
    parser.add_argument("--run-id", default="iter-scoreless-rerank-v2")
    parser.add_argument("--base-run-id", default="iter-v2-scoreless-refine-seed")
    parser.add_argument("--sample-fps", type=float, default=3.0)
    parser.add_argument("--iou-threshold", type=float, default=0.5)
    parser.add_argument("--nms-iou", type=float, default=0.35)
    parser.add_argument("--max-windows-per-clip", type=int, default=36)
    parser.add_argument("--selection-mode", choices=("replace", "augment"), default="augment")
    parser.add_argument("--augment-max-base-iou", type=float, default=0.15)
    parser.add_argument("--min-duration-sec", type=float, default=3.0)
    parser.add_argument("--max-duration-sec", type=float, default=30.0)
    return parser.parse_args()


def set_dataset(dataset: str) -> None:
    global DATASET, DATASET_DIR, LABEL_DIR, MOTION_DIR, POSE_DIR
    DATASET = dataset
    DATASET_DIR = BASE / "eval/datasets" / DATASET
    LABEL_DIR = DATASET_DIR / "labels"
    MOTION_DIR = DATASET_DIR / "motion-tracks"
    POSE_DIR = DATASET_DIR / "pose"


def load_module(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_json(path: Path) -> Any:
    with open(path) as f:
        return json.load(f)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)


def clip_ids() -> list[str]:
    return sorted(path.stem for path in LABEL_DIR.glob("*.json"))


def load_gt(clip_id: str) -> list[dict[str, float]]:
    return load_json(LABEL_DIR / f"{clip_id}.json")["rallies"]


def load_base_windows(run_id: str, clip_id: str) -> list[dict[str, float]]:
    path = RESULTS_DIR / run_id / "per-video" / f"{clip_id}.json"
    if not path.exists():
        return []
    return load_json(path).get("detectedRallies", [])


def iou(a: dict[str, float], b: dict[str, float]) -> float:
    inter = max(0.0, min(a["endSec"], b["endSec"]) - max(a["startSec"], b["startSec"]))
    if inter <= 0:
        return 0.0
    union = (a["endSec"] - a["startSec"]) + (b["endSec"] - b["startSec"]) - inter
    return inter / union if union > 0 else 0.0


def stats(values: list[float]) -> list[float]:
    if not values:
        return [0.0, 0.0, 0.0, 0.0]
    arr = np.array(values, dtype=np.float64)
    return [float(arr.mean()), float(arr.max()), float(np.percentile(arr, 90)), float(arr.std())]


def load_motion_rows(clip_id: str) -> list[dict[str, float]]:
    path = MOTION_DIR / f"{clip_id}.jsonl"
    if not path.exists():
        return []
    rows = []
    with open(path) as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def load_pose_rows(clip_id: str) -> list[dict[str, float]]:
    path = POSE_DIR / f"{clip_id}.tsv"
    if not path.exists():
        return []
    rows = []
    with open(path) as f:
        reader = csv.DictReader(f, delimiter="\t")
        prev: dict[str, float] | None = None
        for row in reader:
            parsed: dict[str, float] = {}
            for key, value in row.items():
                try:
                    parsed[key] = float(value)
                except (TypeError, ValueError):
                    parsed[key] = float("nan")
            if prev is not None:
                dt = max(0.001, parsed["timeSec"] - prev["timeSec"])
                velocities = []
                for idx in range(4):
                    for axis in ("cx", "cy", "wl_x", "wl_y", "wr_x", "wr_y"):
                        key = f"p{idx}_{axis}"
                        if key in parsed and key in prev and not np.isnan(parsed[key]) and not np.isnan(prev[key]):
                            velocities.append(abs(parsed[key] - prev[key]) / dt)
                parsed["poseVelocityMean"] = float(np.mean(velocities)) if velocities else 0.0
                parsed["poseVelocityP90"] = float(np.percentile(velocities, 90)) if velocities else 0.0
            else:
                parsed["poseVelocityMean"] = 0.0
                parsed["poseVelocityP90"] = 0.0
            rows.append(parsed)
            prev = parsed
    return rows


def rows_in(rows: list[dict[str, float]], start_sec: float, end_sec: float) -> list[dict[str, float]]:
    return [row for row in rows if start_sec <= float(row.get("timeSec", -1.0)) <= end_sec]


def motion_features(rows: list[dict[str, float]], start_sec: float, end_sec: float) -> list[float]:
    wr = rows_in(rows, start_sec, end_sec)
    confidence = [float(row.get("confidence", 0.0)) for row in wr]
    blob = [float(row.get("blobScore", 0.0)) for row in wr]
    continuity = [float(row.get("continuityScore", 0.0)) for row in wr]
    candidates = [float(row.get("candidateCount", 0.0)) for row in wr]
    duration = max(0.001, end_sec - start_sec)
    active = sum(1 for value in confidence if value >= 0.34)
    return [
        1.0 if rows else 0.0,
        len(wr) / duration,
        active / duration,
        active / max(1, len(wr)),
        *stats(confidence),
        *stats(blob),
        *stats(continuity),
        *stats(candidates),
    ]


def pose_features(rows: list[dict[str, float]], start_sec: float, end_sec: float) -> list[float]:
    wr = rows_in(rows, start_sec, end_sec)
    n_persons = [float(row.get("nPersons", 0.0)) for row in wr]
    velocities = [float(row.get("poseVelocityMean", 0.0)) for row in wr]
    velocities_p90 = [float(row.get("poseVelocityP90", 0.0)) for row in wr]
    p0_y = [float(row.get("p0_cy", 0.0)) for row in wr if not np.isnan(float(row.get("p0_cy", float("nan"))))]
    p1_y = [float(row.get("p1_cy", 0.0)) for row in wr if not np.isnan(float(row.get("p1_cy", float("nan"))))]
    spread_y = [abs(a - b) for a, b in zip(p0_y, p1_y)]
    duration = max(0.001, end_sec - start_sec)
    return [
        1.0 if rows else 0.0,
        len(wr) / duration,
        *stats(n_persons),
        *stats(velocities),
        *stats(velocities_p90),
        *stats(spread_y),
    ]


def make_classifier() -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(
        max_iter=250,
        max_depth=5,
        learning_rate=0.04,
        l2_regularization=0.05,
        class_weight="balanced",
        random_state=42,
    )


def select_windows(
    candidates: list[Candidate],
    probs: np.ndarray,
    threshold: float,
    nms_iou: float,
    max_windows: int,
) -> list[dict[str, float]]:
    scored = [
        (candidate, float(prob))
        for candidate, prob in zip(candidates, probs)
        if float(prob) >= threshold
    ]
    scored.sort(key=lambda item: item[1], reverse=True)
    selected: list[dict[str, float]] = []
    for candidate, prob in scored:
        window = {
            "startSec": candidate.start_sec,
            "endSec": candidate.end_sec,
            "confidence": round(prob, 4),
        }
        if all(iou(window, existing) < nms_iou for existing in selected):
            selected.append(window)
        if len(selected) >= max_windows:
            break
    return sorted(selected, key=lambda w: (w["startSec"], w["endSec"]))


def augment_base_windows(
    base_windows: list[dict[str, float]],
    candidates: list[Candidate],
    probs: np.ndarray,
    threshold: float,
    nms_iou: float,
    max_base_iou: float,
    max_windows: int,
) -> list[dict[str, float]]:
    result = [
        {
            "startSec": float(window["startSec"]),
            "endSec": float(window["endSec"]),
            "confidence": float(window.get("confidence", 1.0)),
        }
        for window in base_windows
    ]
    scored = [
        (candidate, float(prob))
        for candidate, prob in zip(candidates, probs)
        if candidate.source != "base" and float(prob) >= threshold
    ]
    scored.sort(key=lambda item: item[1], reverse=True)
    for candidate, prob in scored:
        window = {
            "startSec": candidate.start_sec,
            "endSec": candidate.end_sec,
            "confidence": round(prob, 4),
        }
        if max([iou(window, base) for base in base_windows] or [0.0]) > max_base_iou:
            continue
        if all(iou(window, existing) < nms_iou for existing in result):
            result.append(window)
        if len(result) >= max_windows:
            break
    return sorted(result, key=lambda w: (w["startSec"], w["endSec"]))


def event_f1(windows: list[dict[str, float]], gt: list[dict[str, float]], threshold: float) -> float:
    used: set[int] = set()
    tp = 0
    for rally in gt:
        best_score = threshold
        best_i = -1
        for i, window in enumerate(windows):
            if i in used:
                continue
            score = iou(rally, window)
            if score > best_score:
                best_score = score
                best_i = i
        if best_i >= 0:
            tp += 1
            used.add(best_i)
    fp = len(windows) - tp
    fn = len(gt) - tp
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    return 2 * precision * recall / (precision + recall) if precision + recall else 0.0


def optimize_threshold(
    train_by_clip: dict[str, list[Candidate]],
    train_probs_by_clip: dict[str, np.ndarray],
    gt_by_clip: dict[str, list[dict[str, float]]],
    args: argparse.Namespace,
) -> dict[str, float]:
    best = {"threshold": 0.5, "nmsIou": args.nms_iou, "f1": -1.0}
    for threshold in np.linspace(0.15, 0.85, 15):
        for nms_iou in (0.25, 0.35, 0.5, 0.65):
            scores = []
            for clip_id, candidates in train_by_clip.items():
                if args.selection_mode == "augment":
                    windows = augment_base_windows(
                        load_base_windows(args.base_run_id, clip_id),
                        candidates,
                        train_probs_by_clip[clip_id],
                        float(threshold),
                        nms_iou,
                        args.augment_max_base_iou,
                        args.max_windows_per_clip,
                    )
                else:
                    windows = select_windows(
                        candidates,
                        train_probs_by_clip[clip_id],
                        float(threshold),
                        nms_iou,
                        args.max_windows_per_clip,
                    )
                scores.append(event_f1(windows, gt_by_clip[clip_id], args.iou_threshold))
            mean_f1 = float(np.mean(scores)) if scores else 0.0
            if mean_f1 > best["f1"]:
                best = {"threshold": float(threshold), "nmsIou": float(nms_iou), "f1": mean_f1}
    return best


def main() -> None:
    args = parse_args()
    set_dataset(args.dataset)
    refine = load_module("scoreless_rally_refine", REFINE_SCRIPT)
    refine.set_dataset(args.dataset)
    base_rerank = load_module("scoreless_window_rerank", RERANK_SCRIPT)
    base_rerank.DATASET = args.dataset
    base_rerank.DATASET_DIR = DATASET_DIR
    base_rerank.LABEL_DIR = LABEL_DIR

    activity_args = argparse.Namespace(
        sample_fps=args.sample_fps,
        active_blob_threshold=11,
        bridge_blob_threshold=7,
        bridge_min_dual_zone_px=320,
    )

    all_candidates: dict[str, list[Candidate]] = {}
    gt_by_clip: dict[str, list[dict[str, float]]] = {}
    feature_summary: dict[str, Any] = {}
    for clip_id in clip_ids():
        gt = load_gt(clip_id)
        rows, activity_summary = refine.compute_activity_rows(clip_id, activity_args)
        motion_rows = load_motion_rows(clip_id)
        pose_rows = load_pose_rows(clip_id)
        base_candidates = base_rerank.generate_candidates_for_clip(
            clip_id,
            rows,
            gt,
            args.base_run_id,
            args,
        )
        enhanced: list[Candidate] = []
        for candidate in base_candidates:
            extra = [
                *motion_features(motion_rows, candidate.start_sec, candidate.end_sec),
                *pose_features(pose_rows, candidate.start_sec, candidate.end_sec),
            ]
            enhanced.append(
                Candidate(
                    clip_id=candidate.clip_id,
                    start_sec=candidate.start_sec,
                    end_sec=candidate.end_sec,
                    source=candidate.source,
                    config_id=candidate.config_id,
                    features=[*candidate.features, *extra],
                    max_iou=candidate.max_iou,
                    label=candidate.label,
                )
            )
        all_candidates[clip_id] = enhanced
        gt_by_clip[clip_id] = gt
        feature_summary[clip_id] = {
            **activity_summary,
            "candidateCount": len(enhanced),
            "positiveCandidates": sum(candidate.label for candidate in enhanced),
            "motionRows": len(motion_rows),
            "poseRows": len(pose_rows),
            "featureLength": len(enhanced[0].features) if enhanced else 0,
        }
        print(
            f"{clip_id}: candidates={len(enhanced)} positives={feature_summary[clip_id]['positiveCandidates']} "
            f"motionRows={len(motion_rows)} poseRows={len(pose_rows)}"
        )

    run_dir = RESULTS_DIR / args.run_id
    per_video_dir = run_dir / "per-video"
    per_video_dir.mkdir(parents=True, exist_ok=True)

    fold_summary: dict[str, Any] = {}
    for test_clip in all_candidates:
        train_clips = [clip_id for clip_id in all_candidates if clip_id != test_clip]
        X_train = np.array(
            [candidate.features for clip_id in train_clips for candidate in all_candidates[clip_id]],
            dtype=np.float64,
        )
        y_train = np.array(
            [candidate.label for clip_id in train_clips for candidate in all_candidates[clip_id]],
            dtype=np.int32,
        )
        X_test = np.array([candidate.features for candidate in all_candidates[test_clip]], dtype=np.float64)

        if len(set(y_train.tolist())) < 2:
            probs_test = np.ones(len(all_candidates[test_clip]), dtype=np.float64) * 0.5
            train_probs_by_clip = {
                clip_id: np.ones(len(all_candidates[clip_id]), dtype=np.float64) * 0.5
                for clip_id in train_clips
            }
        else:
            clf = make_classifier()
            clf.fit(X_train, y_train)
            probs_test = clf.predict_proba(X_test)[:, 1]
            train_probs_by_clip = {
                clip_id: clf.predict_proba(
                    np.array([candidate.features for candidate in all_candidates[clip_id]], dtype=np.float64)
                )[:, 1]
                for clip_id in train_clips
            }

        train_by_clip = {clip_id: all_candidates[clip_id] for clip_id in train_clips}
        best = optimize_threshold(train_by_clip, train_probs_by_clip, gt_by_clip, args)
        if args.selection_mode == "augment":
            selected = augment_base_windows(
                load_base_windows(args.base_run_id, test_clip),
                all_candidates[test_clip],
                probs_test,
                best["threshold"],
                best["nmsIou"],
                args.augment_max_base_iou,
                args.max_windows_per_clip,
            )
        else:
            selected = select_windows(
                all_candidates[test_clip],
                probs_test,
                best["threshold"],
                best["nmsIou"],
                args.max_windows_per_clip,
            )

        write_json(
            per_video_dir / f"{test_clip}.json",
            {
                "videoId": test_clip,
                "videoDurationSec": 600,
                "scanFps": args.sample_fps,
                "detectedRallies": selected,
            },
        )
        fold_summary[test_clip] = {
            "trainClips": train_clips,
            "trainPositiveCandidates": int(y_train.sum()),
            "trainCandidates": int(len(y_train)),
            "selectedWindows": len(selected),
            "selectionMode": args.selection_mode,
            "threshold": best["threshold"],
            "nmsIou": best["nmsIou"],
            "trainMeanF1": best["f1"],
            "testCandidateProbP90": float(np.percentile(probs_test, 90)) if len(probs_test) else 0.0,
        }
        print(
            f"fold {test_clip}: selected={len(selected)} "
            f"thr={best['threshold']:.2f} nms={best['nmsIou']:.2f} trainF1={best['f1']:.3f}"
        )

    created_at = datetime.now(timezone.utc).isoformat()
    write_json(
        run_dir / "manifest.json",
        {
            "runId": args.run_id,
            "dataset": args.dataset,
            "createdAt": created_at,
            "config": {
                "model": "scoreless visual+motion+pose window reranker v2",
                "scoreInputs": "none",
                "baseRunId": args.base_run_id,
                "sampleFps": args.sample_fps,
                "classifier": "HistGradientBoostingClassifier",
                "selectionMode": args.selection_mode,
                "augmentMaxBaseIou": args.augment_max_base_iou,
                "maxWindowsPerClip": args.max_windows_per_clip,
                "iouThreshold": args.iou_threshold,
            },
            "featureSummary": feature_summary,
            "foldSummary": fold_summary,
        },
    )
    print(f"Wrote {run_dir / 'manifest.json'}")
    print(
        "Score with:\n"
        f"  npm run eval:score -- --run-id {args.run_id} "
        f"--dataset {args.dataset} --baseline-run-id {args.base_run_id}"
    )


if __name__ == "__main__":
    main()
