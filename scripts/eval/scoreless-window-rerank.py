#!/usr/bin/env python3
"""
scoreless-window-rerank.py - score-independent visual candidate reranker.

Generates high-recall rally window candidates from frame activity only, then
trains a leave-one-clip-out window classifier to prune false positives. Labels
are used only for training/evaluation, never as an inference input.

Usage:
  /usr/local/bin/python3.11 scripts/eval/scoreless-window-rerank.py \
      --run-id iter-scoreless-rerank1 --base-run-id iter-scoreless-refine1
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier

BASE = Path(__file__).parent.parent.parent
DATASET = "fixed-camera-v1"
DATASET_DIR = BASE / "eval/datasets" / DATASET
LABEL_DIR = DATASET_DIR / "labels"
RESULTS_DIR = BASE / "eval/results"
REFINE_SCRIPT = BASE / "scripts/eval/scoreless-rally-refine.py"


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
    parser.add_argument("--run-id", default="iter-scoreless-rerank1")
    parser.add_argument("--dataset", default=DATASET)
    parser.add_argument("--base-run-id", default="iter-scoreless-refine1")
    parser.add_argument("--sample-fps", type=float, default=3.0)
    parser.add_argument("--min-duration-sec", type=float, default=3.0)
    parser.add_argument("--max-duration-sec", type=float, default=30.0)
    parser.add_argument("--iou-threshold", type=float, default=0.5)
    parser.add_argument("--nms-iou", type=float, default=0.35)
    parser.add_argument("--max-windows-per-clip", type=int, default=36)
    parser.add_argument("--selection-mode", choices=("replace", "augment"), default="augment")
    parser.add_argument("--augment-max-base-iou", type=float, default=0.2)
    return parser.parse_args()


def load_refine_module() -> Any:
    spec = importlib.util.spec_from_file_location("scoreless_rally_refine", REFINE_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load {REFINE_SCRIPT}")
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


def group_times(times: list[float], gap_sec: float) -> list[tuple[float, float, int]]:
    if not times:
        return []
    groups: list[tuple[float, float, int]] = []
    start = last = times[0]
    count = 1
    for t in times[1:]:
        if t - last <= gap_sec:
            last = t
            count += 1
        else:
            groups.append((start, last, count))
            start = last = t
            count = 1
    groups.append((start, last, count))
    return groups


def merge_windows(windows: list[dict[str, float]], max_duration_sec: float) -> list[dict[str, float]]:
    if not windows:
        return []
    ordered = sorted(windows, key=lambda w: (w["startSec"], w["endSec"]))
    merged = [ordered[0].copy()]
    for window in ordered[1:]:
        prev = merged[-1]
        if window["startSec"] <= prev["endSec"] + 0.25:
            end = max(prev["endSec"], window["endSec"])
            if end - prev["startSec"] <= max_duration_sec:
                prev["endSec"] = end
                prev["confidence"] = max(prev.get("confidence", 0.0), window.get("confidence", 0.0))
            else:
                merged.append(window.copy())
        else:
            merged.append(window.copy())
    return merged


def candidate_configs() -> list[dict[str, float]]:
    configs: list[dict[str, float]] = []
    for blob in (7, 9, 11, 13):
        for bridge_blob in (5, 7):
            for min_half in (220, 320, 420):
                for gap in (2.0, 3.0, 4.5, 6.0):
                    configs.append(
                        {
                            "blob": float(blob),
                            "bridgeBlob": float(bridge_blob),
                            "minHalf": float(min_half),
                            "gap": gap,
                            "startPad": 2.5,
                            "endPad": 3.0,
                        }
                    )
    return configs


def stats(values: list[float]) -> list[float]:
    if not values:
        return [0.0, 0.0, 0.0, 0.0]
    arr = np.array(values, dtype=np.float64)
    return [float(arr.mean()), float(arr.max()), float(np.percentile(arr, 90)), float(arr.std())]


def rows_in(rows: list[Any], start_sec: float, end_sec: float) -> list[Any]:
    return [row for row in rows if start_sec <= row.time_sec <= end_sec]


def feature_vector(
    rows: list[Any],
    window: dict[str, float],
    source_code: float,
    config: dict[str, float],
) -> list[float]:
    start = float(window["startSec"])
    end = float(window["endSec"])
    duration = max(0.001, end - start)
    wr = rows_in(rows, start, end)
    active = [
        row for row in wr
        if row.blob_count >= config["blob"]
        or (row.blob_count >= config["bridgeBlob"] and row.min_half_motion_px >= config["minHalf"])
    ]
    active_count = len(active)
    gaps = [
        active[i].time_sec - active[i - 1].time_sec
        for i in range(1, len(active))
    ]
    max_gap = max(gaps) if gaps else duration
    blob_stats = stats([float(row.blob_count) for row in wr])
    raw_stats = stats([float(row.raw_motion_px) for row in wr])
    clean_stats = stats([float(row.clean_motion_px) for row in wr])
    half_stats = stats([float(row.min_half_motion_px) for row in wr])
    return [
        duration,
        source_code,
        float(window.get("confidence", 0.0)),
        active_count / duration,
        active_count / max(1, len(wr)),
        max_gap,
        config["blob"],
        config["bridgeBlob"],
        config["minHalf"],
        config["gap"],
        *blob_stats,
        *raw_stats,
        *clean_stats,
        *half_stats,
    ]


def max_iou_with_gt(window: dict[str, float], gt: list[dict[str, float]]) -> float:
    return max([iou(window, rally) for rally in gt] or [0.0])


def make_candidate(
    clip_id: str,
    rows: list[Any],
    gt: list[dict[str, float]],
    window: dict[str, float],
    source: str,
    config_id: str,
    source_code: float,
    config: dict[str, float],
    iou_threshold: float,
) -> Candidate:
    score = max_iou_with_gt(window, gt)
    return Candidate(
        clip_id=clip_id,
        start_sec=round(float(window["startSec"]), 2),
        end_sec=round(float(window["endSec"]), 2),
        source=source,
        config_id=config_id,
        features=feature_vector(rows, window, source_code, config),
        max_iou=score,
        label=int(score >= iou_threshold),
    )


def dedupe_candidates(candidates: list[Candidate]) -> list[Candidate]:
    best_by_key: dict[tuple[str, float, float], Candidate] = {}
    for candidate in candidates:
        key = (candidate.clip_id, candidate.start_sec, candidate.end_sec)
        prev = best_by_key.get(key)
        if prev is None or candidate.max_iou > prev.max_iou:
            best_by_key[key] = candidate
    return sorted(best_by_key.values(), key=lambda c: (c.clip_id, c.start_sec, c.end_sec))


def generate_candidates_for_clip(
    clip_id: str,
    rows: list[Any],
    gt: list[dict[str, float]],
    base_run_id: str,
    args: argparse.Namespace,
) -> list[Candidate]:
    candidates: list[Candidate] = []
    base_config = {
        "blob": 11.0,
        "bridgeBlob": 7.0,
        "minHalf": 320.0,
        "gap": 3.0,
        "startPad": 2.5,
        "endPad": 3.0,
    }
    for window in load_base_windows(base_run_id, clip_id):
        candidates.append(
            make_candidate(
                clip_id, rows, gt, window, "base", "base", 1.0, base_config, args.iou_threshold
            )
        )

    for idx, config in enumerate(candidate_configs()):
        active_times = [
            row.time_sec for row in rows
            if row.blob_count >= config["blob"]
            or (row.blob_count >= config["bridgeBlob"] and row.min_half_motion_px >= config["minHalf"])
        ]
        windows: list[dict[str, float]] = []
        for start, end, count in group_times(active_times, config["gap"]):
            raw_duration = end - start
            padded = {
                "startSec": max(0.0, start - config["startPad"]),
                "endSec": min(start - config["startPad"] + args.max_duration_sec, end + config["endPad"]),
                "confidence": min(1.0, count / max(1.0, raw_duration)),
            }
            duration = padded["endSec"] - padded["startSec"]
            if args.min_duration_sec <= duration <= args.max_duration_sec:
                windows.append(padded)
        for window in merge_windows(windows, args.max_duration_sec):
            candidates.append(
                make_candidate(
                    clip_id,
                    rows,
                    gt,
                    window,
                    "visual",
                    f"cfg{idx}",
                    0.0,
                    config,
                    args.iou_threshold,
                )
            )

    return dedupe_candidates(candidates)


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


def make_classifier() -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(
        max_iter=200,
        max_depth=4,
        learning_rate=0.05,
        class_weight="balanced",
        random_state=42,
    )


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
    global DATASET, DATASET_DIR, LABEL_DIR
    DATASET = args.dataset
    DATASET_DIR = BASE / "eval/datasets" / DATASET
    LABEL_DIR = DATASET_DIR / "labels"

    refine = load_refine_module()
    activity_args = argparse.Namespace(
        sample_fps=args.sample_fps,
        active_blob_threshold=11,
        bridge_blob_threshold=7,
        bridge_min_dual_zone_px=320,
    )

    all_candidates: dict[str, list[Candidate]] = {}
    gt_by_clip: dict[str, list[dict[str, float]]] = {}
    activity_summary: dict[str, Any] = {}
    for clip_id in clip_ids():
        gt = load_gt(clip_id)
        rows, summary = refine.compute_activity_rows(clip_id, activity_args)
        candidates = generate_candidates_for_clip(clip_id, rows, gt, args.base_run_id, args)
        all_candidates[clip_id] = candidates
        gt_by_clip[clip_id] = gt
        activity_summary[clip_id] = summary | {
            "candidateCount": len(candidates),
            "positiveCandidates": sum(c.label for c in candidates),
        }
        print(
            f"{clip_id}: rows={summary['activityRows']} candidates={len(candidates)} "
            f"positive={activity_summary[clip_id]['positiveCandidates']}"
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

    manifest = {
        "runId": args.run_id,
        "dataset": args.dataset,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "config": {
            "model": "scoreless visual window reranker",
            "scoreInputs": "none",
            "baseRunId": args.base_run_id,
            "sampleFps": args.sample_fps,
            "candidateConfigs": len(candidate_configs()),
            "classifier": "HistGradientBoostingClassifier",
            "selectionMode": args.selection_mode,
            "augmentMaxBaseIou": args.augment_max_base_iou,
            "maxWindowsPerClip": args.max_windows_per_clip,
            "iouThreshold": args.iou_threshold,
        },
        "activitySummary": activity_summary,
        "foldSummary": fold_summary,
    }
    write_json(run_dir / "manifest.json", manifest)
    print(f"Wrote {run_dir / 'manifest.json'}")
    print(
        "Score with:\n"
        f"  npm run eval:score -- --run-id {args.run_id} "
        f"--dataset {args.dataset} --baseline-run-id {args.base_run_id}"
    )


if __name__ == "__main__":
    main()
