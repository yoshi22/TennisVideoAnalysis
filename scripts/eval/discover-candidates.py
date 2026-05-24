#!/usr/bin/env python3
"""
Discover new fixed-camera tennis YouTube candidates for CourtLens evals.

This script runs yt-dlp search queries, filters results by duration, and appends
new videos to eval/datasets/<dataset>/candidates.json as entries ready for
manual screening.

Usage:
  python3.11 scripts/eval/discover-candidates.py
  python3.11 scripts/eval/discover-candidates.py --write
  python3.11 scripts/eval/discover-candidates.py \
      --query "tennis singles match full court amateur" --limit 25 --write

Screening is a separate step. After discovery, run
screen-fixed-camera-candidates.py to download videos and generate contact-sheet
previews for manual fixed-camera interval selection.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Any

BASE = Path(__file__).resolve().parent.parent.parent

DEFAULT_QUERIES = [
    "テニス シングルス 試合 コート全体",
    "草トーナメント テニス シングルス",
    "社会人 テニス シングルス 試合",
    "ソフトテニス シングルス 試合",
    "ソフトテニス 大会 男子シングルス",
    "tennis singles match full court amateur",
    "USTA singles match full",
    "recreational tennis singles fixed camera",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="fixed-camera-v2")
    parser.add_argument("--query", action="append")
    parser.add_argument("--limit", type=int, default=15)
    parser.add_argument("--min-duration", type=float, default=600.0)
    parser.add_argument("--max-duration", type=float, default=5400.0)
    parser.add_argument("--status", default="needs_screening")
    parser.add_argument("--write", action="store_true")
    return parser.parse_args()


def load_json(path: Path) -> Any:
    with open(path) as f:
        return json.load(f)


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


def clip_source_key(clip_id: str) -> str:
    key = clip_id
    if key.startswith("yt-"):
        key = key[3:]
    head, sep, tail = key.rpartition("-clip")
    if sep and tail.isdigit():
        return head
    return key


def youtube_id_from_url(url: str | None) -> str | None:
    if not url:
        return None
    if "watch?v=" in url:
        video_id = url.split("watch?v=", 1)[1].split("&", 1)[0]
        return video_id or None
    if "youtu.be/" in url:
        video_id = url.split("youtu.be/", 1)[1].split("?", 1)[0]
        return video_id or None
    return None


def collect_known_ids(dataset_dir: Path, payload: dict[str, Any]) -> set[str]:
    known: set[str] = set()
    for candidate in payload.get("candidateVideos", []):
        candidate_id = candidate.get("id")
        if candidate_id:
            known.add(str(candidate_id))
        for clip in candidate.get("selectedClips", []):
            clip_id = clip.get("clipId")
            if clip_id:
                known.add(str(clip_id))
                known.add(clip_source_key(str(clip_id)))
            source_video_id = clip.get("sourceVideoId")
            if source_video_id:
                known.add(str(source_video_id))

    for seed_clip in payload.get("seedClips", []):
        if seed_clip:
            known.add(str(seed_clip))
            known.add(clip_source_key(str(seed_clip)))

    labels_dir = dataset_dir / "labels"
    if labels_dir.exists():
        for label_path in sorted(labels_dir.glob("*.json")):
            if label_path.name.endswith("_DRAFT.json"):
                continue
            known.add(label_path.stem)
            known.add(clip_source_key(label_path.stem))
            try:
                label_payload = load_json(label_path)
            except json.JSONDecodeError as exc:
                print(f"Warning: could not parse label file {label_path}: {exc}", file=sys.stderr)
                continue
            if isinstance(label_payload, dict):
                source_video_id = youtube_id_from_url(label_payload.get("sourceUrl"))
                if source_video_id:
                    known.add(source_video_id)
    return known


def duration_seconds(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def format_duration(seconds: float) -> str:
    total_seconds = int(round(seconds))
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    secs = total_seconds % 60
    return f"{hours}:{minutes:02d}:{secs:02d}"


def truncate(value: str, width: int) -> str:
    if len(value) <= width:
        return value
    if width <= 3:
        return value[:width]
    return value[: width - 3] + "..."


def run_search(query: str, limit: int) -> list[dict[str, Any]]:
    cmd = ["yt-dlp", f"ytsearch{limit}:{query}", "--flat-playlist", "--dump-json"]
    try:
        completed = subprocess.run(cmd, capture_output=True, text=True)
    except FileNotFoundError:
        print("Error: yt-dlp was not found. Install yt-dlp and retry.", file=sys.stderr)
        raise SystemExit(1) from None

    if completed.returncode != 0:
        print(f"Warning: query failed, continuing: {query}", file=sys.stderr)
        stderr = completed.stderr.strip()
        if stderr:
            print(f"  {stderr.splitlines()[-1]}", file=sys.stderr)
        return []

    rows: list[dict[str, Any]] = []
    for line in completed.stdout.splitlines():
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError as exc:
            print(f"Warning: could not parse yt-dlp output line: {exc}", file=sys.stderr)
            continue
        if isinstance(entry, dict):
            rows.append(entry)
    return rows


def build_candidate(entry: dict[str, Any], query: str, status: str, today: str) -> dict[str, Any] | None:
    video_id = entry.get("id")
    if not video_id:
        return None
    seconds = duration_seconds(entry.get("duration"))
    if seconds is None:
        return None
    url = entry.get("webpage_url") or f"https://www.youtube.com/watch?v={video_id}"
    return {
        "id": str(video_id),
        "title": str(entry.get("title") or ""),
        "url": str(url),
        "duration": format_duration(seconds),
        "durationSec": seconds,
        "uploader": entry.get("uploader"),
        "sourceSearch": query,
        "status": status,
        "discoveredAt": today,
        "screening": None,
        "selectedClips": [],
    }


def discover_candidates(args: argparse.Namespace, known_ids: set[str]) -> list[dict[str, Any]]:
    queries = args.query if args.query else DEFAULT_QUERIES
    seen: set[str] = set()
    discovered: list[dict[str, Any]] = []
    today = date.today().isoformat()

    for query in queries:
        entries = run_search(query, args.limit)
        for entry in entries:
            video_id = entry.get("id")
            if not video_id:
                continue
            video_id = str(video_id)
            seconds = duration_seconds(entry.get("duration"))
            if seconds is None or seconds < args.min_duration or seconds > args.max_duration:
                continue
            if video_id in known_ids or video_id in seen:
                continue
            candidate = build_candidate(entry, query, args.status, today)
            if candidate is None:
                continue
            seen.add(video_id)
            discovered.append(candidate)
    return discovered


def print_table(candidates: list[dict[str, Any]]) -> None:
    print(f"{'#':>3}  {'id':12}  {'duration':8}  {'title':60}  query")
    print(f"{'-' * 3}  {'-' * 12}  {'-' * 8}  {'-' * 60}  {'-' * 40}")
    for index, candidate in enumerate(candidates, start=1):
        print(
            f"{index:>3}  "
            f"{truncate(candidate['id'], 12):12}  "
            f"{candidate['duration']:8}  "
            f"{truncate(candidate['title'], 60):60}  "
            f"{truncate(candidate['sourceSearch'], 40)}"
        )


def print_next_step(dataset: str, status: str) -> None:
    print(
        "screen with: "
        f"python3.11 scripts/eval/screen-fixed-camera-candidates.py --dataset {dataset} --status {status}"
    )


def main() -> None:
    args = parse_args()
    dataset_dir = BASE / "eval/datasets" / args.dataset
    candidates_path = dataset_dir / "candidates.json"
    if not candidates_path.exists():
        print(f"Error: candidates.json does not exist: {candidates_path}", file=sys.stderr)
        raise SystemExit(1)

    payload = load_json(candidates_path)
    if not isinstance(payload, dict):
        print(f"Error: expected object in {candidates_path}", file=sys.stderr)
        raise SystemExit(1)

    candidate_videos = payload.setdefault("candidateVideos", [])
    if not isinstance(candidate_videos, list):
        print(f"Error: candidateVideos must be a list in {candidates_path}", file=sys.stderr)
        raise SystemExit(1)

    known_ids = collect_known_ids(dataset_dir, payload)
    discovered = discover_candidates(args, known_ids)

    if not args.write:
        print_table(discovered)
        print(f"\n{len(discovered)} new candidates found (dry-run). Add --write to persist.")
        print_next_step(args.dataset, args.status)
        return

    candidate_videos.extend(discovered)
    write_json(candidates_path, payload)
    print(f"Appended {len(discovered)} new candidates to candidates.json")
    print_next_step(args.dataset, args.status)


if __name__ == "__main__":
    main()
