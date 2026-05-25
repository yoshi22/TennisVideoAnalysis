#!/usr/bin/env python3.11
"""
ingest-user-submission.py - ingest closed-beta user submission bundles.

The input bundle directory is expected to contain downloaded Supabase Storage
objects arranged as:

  {participantId}/{submissionId}/video.mp4
  {participantId}/{submissionId}/manifest.json

Usage:
  python3.11 scripts/eval/ingest-user-submission.py \
    --bundle-dir /path/to/downloads \
    --dataset closed-beta-soft-v1 \
    [--dry-run]
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import shutil
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent.parent
MIN_RALLY_SEC = 1.5
MAX_RALLY_SEC = 45.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest closed-beta user submission bundles.")
    parser.add_argument("--bundle-dir", type=Path, required=True, help="Downloaded bundle base directory.")
    parser.add_argument("--dataset", required=True, help="Destination eval dataset name.")
    parser.add_argument("--dry-run", action="store_true", help="Validate and log actions without writing files.")
    return parser.parse_args()


def log(level: str, message: str) -> None:
    print(f"[{level}] {message}", file=sys.stderr)


def is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def is_non_empty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def load_json(path: Path) -> object:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def utc_timestamp() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def today_utc() -> str:
    return datetime.datetime.now(datetime.timezone.utc).date().isoformat()


def short_participant_id(participant_id: str) -> str:
    return f"{participant_id[:8]}..."


def validate_manifest(manifest: object) -> list[str]:
    errors: list[str] = []
    if not isinstance(manifest, dict):
        return ["manifest root must be an object"]

    if manifest.get("schemaVersion") != 1:
        errors.append("schemaVersion must be 1")

    for field in ("submissionId", "participantId", "appVersion", "createdAt", "sport", "sessionType", "matchFormat"):
        if not is_non_empty_string(manifest.get(field)):
            errors.append(f"{field} is required")

    video = manifest.get("video")
    if not isinstance(video, dict):
        errors.append("video is required")
    else:
        if not is_non_empty_string(video.get("filename")):
            errors.append("video.filename is required")
        elif video.get("filename") != "video.mp4":
            errors.append("video.filename must be video.mp4")
        if not is_number(video.get("fps")) or float(video["fps"]) <= 0:
            errors.append("video.fps must be positive")
        duration_sec = video.get("durationSec")
        if duration_sec is not None and (not is_number(duration_sec) or float(duration_sec) <= 0):
            errors.append("video.durationSec must be positive when present")

    rallies = manifest.get("rallies")
    if not isinstance(rallies, list):
        errors.append("rallies must be an array")

    points = manifest.get("points")
    if not isinstance(points, list):
        errors.append("points must be an array")

    consent = manifest.get("consent")
    if not isinstance(consent, dict):
        errors.append("consent is required")
    else:
        if consent.get("version") != 1:
            errors.append("consent.version must be 1")
        if not is_non_empty_string(consent.get("acceptedAt")):
            errors.append("consent.acceptedAt is required")

    return errors


def validate_rallies(raw_rallies: list[object], clip_duration_sec: object, bundle_label: str) -> list[dict[str, object]]:
    rallies: list[dict[str, object]] = []
    prev_end: float | None = None
    max_end_sec = float(clip_duration_sec) + 0.5 if is_number(clip_duration_sec) else None

    for idx, raw in enumerate(raw_rallies, start=1):
        prefix = f"{bundle_label} rally #{idx}"
        if not isinstance(raw, dict):
            log("WARN", f"{prefix}: skipped; rally must be an object")
            continue

        start = raw.get("startSec")
        end = raw.get("endSec")
        if not is_number(start) or not is_number(end):
            log("WARN", f"{prefix}: skipped; startSec/endSec must be numeric")
            continue

        start_sec = float(start)
        end_sec = float(end)
        duration_sec = end_sec - start_sec
        if start_sec < 0:
            log("WARN", f"{prefix}: skipped; startSec must be >= 0")
            continue
        if end_sec <= start_sec:
            log("WARN", f"{prefix}: skipped; endSec must be greater than startSec")
            continue
        if duration_sec < MIN_RALLY_SEC:
            log("WARN", f"{prefix}: skipped; duration below {MIN_RALLY_SEC}s")
            continue
        if max_end_sec is not None and end_sec > max_end_sec:
            log("WARN", f"{prefix}: skipped; endSec exceeds clip duration")
            continue
        if prev_end is not None and start_sec - prev_end < 0:
            log("WARN", f"{prefix}: skipped; overlaps or is out of order")
            continue
        if duration_sec > MAX_RALLY_SEC:
            log("WARN", f"{prefix}: duration {duration_sec:.1f}s exceeds {MAX_RALLY_SEC:.1f}s; keeping soft-tennis rally")

        rallies.append(
            {
                "startSec": start_sec,
                "endSec": end_sec,
                "server": None,
                "winner": None,
                "endReason": None,
            }
        )
        prev_end = end_sec

    return rallies


def dataset_candidates_path(dataset: str) -> Path:
    return BASE / "eval" / "datasets" / dataset / "candidates.json"


def empty_candidates(dataset: str) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "dataset": dataset,
        "createdAt": today_utc(),
        "purpose": "Soft-tennis closed-beta user submissions. Training data only -- not used for held-out test evaluation.",
        "candidateVideos": [],
    }


def load_candidates(dataset: str) -> dict[str, object]:
    candidates_path = dataset_candidates_path(dataset)
    if not candidates_path.exists():
        return empty_candidates(dataset)

    candidates = load_json(candidates_path)
    if not isinstance(candidates, dict):
        raise ValueError(f"{candidates_path} must contain a JSON object")
    if candidates.get("schemaVersion") != 1:
        raise ValueError(f"{candidates_path} schemaVersion must be 1")
    if candidates.get("dataset") != dataset:
        raise ValueError(f"{candidates_path} dataset must be {dataset}")
    if not isinstance(candidates.get("candidateVideos"), list):
        raise ValueError(f"{candidates_path} candidateVideos must be an array")
    return candidates


def existing_clip_ids(candidates: dict[str, object]) -> set[str]:
    clip_ids: set[str] = set()
    for candidate in candidates.get("candidateVideos", []):
        if not isinstance(candidate, dict):
            continue
        for clip in candidate.get("selectedClips", []):
            if isinstance(clip, dict) and is_non_empty_string(clip.get("clipId")):
                clip_ids.add(clip["clipId"])
    return clip_ids


def build_label(
    manifest: dict[str, object],
    clip_id: str,
    source_sha256: str,
    rallies: list[dict[str, object]],
) -> dict[str, object]:
    video = manifest["video"]
    participant_id = manifest["participantId"]
    return {
        "schemaVersion": 1,
        "videoId": clip_id,
        "sourceUrl": "user-submitted",
        "sourceSha256": source_sha256,
        "fps": video["fps"],
        "clipOffsetSec": 0,
        "clipDurationSec": video.get("durationSec"),
        "note": (
            f"user-submitted soft tennis. sport={manifest['sport']} sessionType={manifest['sessionType']}. "
            f"Participant={short_participant_id(participant_id)} appVersion={manifest['appVersion']}. "
            "DRAFT \u2014 human verification required before entering test set."
        ),
        "rallies": rallies,
    }


def build_tactical(manifest: dict[str, object], clip_id: str) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "clipId": clip_id,
        "sport": manifest["sport"],
        "sessionType": manifest["sessionType"],
        "points": manifest["points"],
    }


def build_candidate(manifest: dict[str, object], clip_id: str, ingested_at: str) -> dict[str, object]:
    submission_id = manifest["submissionId"]
    participant_id = manifest["participantId"]
    duration_sec = manifest["video"].get("durationSec")
    return {
        "id": submission_id,
        "title": f"user-submitted {manifest['sport']} {manifest['sessionType']} ({short_participant_id(participant_id)})",
        "url": "user-submitted",
        "status": "ingested",
        "ingestedAt": ingested_at,
        "selectedClips": [
            {
                "clipId": clip_id,
                "sourceVideoId": submission_id,
                "offsetSec": 0,
                "durationSec": duration_sec,
                "status": "needs_manual_labeling",
                "labelingPriority": 2,
                "notes": f"user-submitted. sport={manifest['sport']} sessionType={manifest['sessionType']}.",
            }
        ],
    }


def write_if_missing(path: Path, data: dict[str, object], dry_run: bool, bundle_label: str) -> None:
    if path.exists():
        log("INFO", f"{bundle_label}: exists, not overwriting {path.relative_to(BASE)}")
        return
    if dry_run:
        log("DRY", f"{bundle_label}: would write {path.relative_to(BASE)}")
        return
    write_json(path, data)
    log("INFO", f"{bundle_label}: wrote {path.relative_to(BASE)}")


def process_bundle(
    manifest_path: Path,
    dataset: str,
    candidates: dict[str, object],
    clip_ids: set[str],
    dry_run: bool,
) -> str:
    bundle_dir = manifest_path.parent
    bundle_label = str(bundle_dir.relative_to(manifest_path.parents[2]))

    try:
        manifest = load_json(manifest_path)
    except (OSError, json.JSONDecodeError) as exc:
        log("ERROR", f"{bundle_label}: cannot read manifest.json: {exc}")
        return "error"

    errors = validate_manifest(manifest)
    if errors:
        log("ERROR", f"{bundle_label}: invalid manifest: {'; '.join(errors)}")
        return "error"

    participant_id = manifest["participantId"]
    submission_id = manifest["submissionId"]
    if bundle_dir.parent.name != participant_id:
        log("WARN", f"{bundle_label}: participantId differs from directory name")
    if bundle_dir.name != submission_id:
        log("WARN", f"{bundle_label}: submissionId differs from directory name")

    video_filename = manifest["video"]["filename"]
    video_path = bundle_dir / video_filename
    if not video_path.exists():
        log("ERROR", f"{bundle_label}: missing video file {video_filename}")
        return "error"

    clip_id = f"user-{submission_id[:12]}"
    if clip_id in clip_ids:
        log("INFO", f"{bundle_label}: skipped; clipId already in candidates.json: {clip_id}")
        return "skipped"

    try:
        computed_sha256 = sha256_file(video_path)
    except OSError as exc:
        log("ERROR", f"{bundle_label}: cannot hash video: {exc}")
        return "error"
    manifest["video"]["sha256"] = computed_sha256

    dataset_dir = BASE / "eval" / "datasets" / dataset
    videos_dir = dataset_dir / "videos"
    labels_dir = dataset_dir / "labels"
    tactical_dir = dataset_dir / "tactical"
    out_video_path = videos_dir / f"{clip_id}.mp4"
    label_path = labels_dir / f"{clip_id}_DRAFT.json"
    tactical_path = tactical_dir / f"{clip_id}.json"

    rallies = validate_rallies(manifest["rallies"], manifest["video"].get("durationSec"), bundle_label)
    label = build_label(manifest, clip_id, computed_sha256, rallies)
    tactical = build_tactical(manifest, clip_id)
    candidate = build_candidate(manifest, clip_id, utc_timestamp())

    if dry_run:
        log("DRY", f"{bundle_label}: would ingest {clip_id} sha256={computed_sha256}")
        log("DRY", f"{bundle_label}: would copy {video_path} -> {out_video_path.relative_to(BASE)}")
        log("DRY", f"{bundle_label}: would append candidateVideos entry")
        clip_ids.add(clip_id)
        return "ingested"

    for path in (videos_dir, labels_dir, tactical_dir):
        path.mkdir(parents=True, exist_ok=True)

    try:
        if out_video_path.exists():
            log("INFO", f"{bundle_label}: exists, not overwriting {out_video_path.relative_to(BASE)}")
        else:
            shutil.copy2(video_path, out_video_path)
            log("INFO", f"{bundle_label}: copied video to {out_video_path.relative_to(BASE)}")
        write_if_missing(label_path, label, dry_run, bundle_label)
        write_if_missing(tactical_path, tactical, dry_run, bundle_label)
    except OSError as exc:
        log("ERROR", f"{bundle_label}: failed while writing files: {exc}")
        return "error"

    candidates["candidateVideos"].append(candidate)
    clip_ids.add(clip_id)
    try:
        write_json(dataset_candidates_path(dataset), candidates)
    except OSError as exc:
        log("ERROR", f"{bundle_label}: failed to update candidates.json: {exc}")
        return "error"

    log("INFO", f"{bundle_label}: ingested {clip_id}")
    return "ingested"


def discover_manifests(bundle_dir: Path) -> list[Path]:
    return sorted(bundle_dir.glob("*/*/manifest.json"))


def main() -> None:
    args = parse_args()
    if not args.bundle_dir.exists() or not args.bundle_dir.is_dir():
        raise SystemExit(f"--bundle-dir must be an existing directory: {args.bundle_dir}")

    try:
        candidates = load_candidates(args.dataset)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise SystemExit(f"Cannot load candidates.json: {exc}") from exc

    clip_ids = existing_clip_ids(candidates)
    manifests = discover_manifests(args.bundle_dir)
    if not manifests:
        log("WARN", f"no manifest.json files found under {args.bundle_dir}")

    counts = {"ingested": 0, "skipped": 0, "errors": 0}
    for manifest_path in manifests:
        result = process_bundle(manifest_path, args.dataset, candidates, clip_ids, args.dry_run)
        if result == "ingested":
            counts["ingested"] += 1
        elif result == "skipped":
            counts["skipped"] += 1
        else:
            counts["errors"] += 1

    print(f"ingested: {counts['ingested']}  skipped: {counts['skipped']}  errors: {counts['errors']}")


if __name__ == "__main__":
    main()
