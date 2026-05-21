#!/usr/bin/env python3
"""
screen-fixed-camera-candidates.py - create local previews for v2 candidate selection.

The script reads eval/datasets/<dataset>/candidates.json, downloads candidate
videos locally, and builds contact sheets / low-fps preview clips to support
manual fixed-camera interval selection. Generated media is ignored by git.

Usage:
  /usr/local/bin/python3.11 scripts/eval/screen-fixed-camera-candidates.py \
      --dataset fixed-camera-v2 --candidate-id aIAx_p6LlFo --dry-run
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any

BASE = Path(__file__).parent.parent.parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="fixed-camera-v2")
    parser.add_argument("--candidate-id", action="append")
    parser.add_argument("--status", default="selected_for_labeling")
    parser.add_argument("--max-height", type=int, default=720)
    parser.add_argument("--sheet-interval-sec", type=float, default=30.0)
    parser.add_argument("--preview-fps", type=float, default=1.0)
    parser.add_argument("--preview-duration-sec", type=float, default=900.0)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def load_json(path: Path) -> Any:
    with open(path) as f:
        return json.load(f)


def source_key(url: str) -> str:
    return f"source-{hashlib.sha1(url.encode('utf-8')).hexdigest()[:10]}"


def run(cmd: list[str], dry_run: bool) -> None:
    print("  " + " ".join(cmd))
    if not dry_run:
        subprocess.run(cmd, check=True)


def candidates(args: argparse.Namespace) -> list[dict[str, Any]]:
    path = BASE / "eval/datasets" / args.dataset / "candidates.json"
    payload = load_json(path)
    wanted = set(args.candidate_id or [])
    rows = []
    for item in payload.get("candidateVideos", []):
        if wanted and item["id"] not in wanted:
            continue
        if not wanted and args.status and item.get("status") != args.status:
            continue
        rows.append(item)
    return rows


def download_video(candidate: dict[str, Any], video_dir: Path, args: argparse.Namespace) -> Path:
    video_dir.mkdir(parents=True, exist_ok=True)
    out_base = video_dir / source_key(candidate["url"])
    out_path = out_base.with_suffix(".mp4")
    if out_path.exists() and not args.overwrite:
        return out_path
    template = str(out_base) + ".%(ext)s"
    run(
        [
            "yt-dlp",
            "-f",
            f"best[height<={args.max_height}][ext=mp4]/best[height<={args.max_height}]",
            "--merge-output-format",
            "mp4",
            "-o",
            template,
            candidate["url"],
        ],
        args.dry_run,
    )
    return out_path


def create_contact_sheet(candidate: dict[str, Any], video_path: Path, out_dir: Path, args: argparse.Namespace) -> None:
    sheet_path = out_dir / f"{candidate['id']}-contact.jpg"
    if sheet_path.exists() and not args.overwrite:
        return
    run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(video_path),
            "-vf",
            f"fps=1/{args.sheet_interval_sec:g},scale=240:-1,tile=5x",
            "-frames:v",
            "1",
            str(sheet_path),
        ],
        args.dry_run,
    )


def create_preview(candidate: dict[str, Any], video_path: Path, out_dir: Path, args: argparse.Namespace) -> None:
    preview_path = out_dir / f"{candidate['id']}-preview.mp4"
    if preview_path.exists() and not args.overwrite:
        return
    run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(video_path),
            "-t",
            f"{args.preview_duration_sec:g}",
            "-vf",
            f"fps={args.preview_fps:g},scale=960:-1",
            "-an",
            str(preview_path),
        ],
        args.dry_run,
    )


def main() -> None:
    args = parse_args()
    dataset_dir = BASE / "eval/datasets" / args.dataset
    video_dir = dataset_dir / "videos"
    out_dir = dataset_dir / "screening"
    out_dir.mkdir(parents=True, exist_ok=True)

    selected = candidates(args)
    if not selected:
        raise SystemExit("No matching candidates.")

    print(f"Dataset: {args.dataset}")
    for candidate in selected:
        print(f"\n-- {candidate['id']} {candidate['title']}")
        video_path = download_video(candidate, video_dir, args)
        create_contact_sheet(candidate, video_path, out_dir, args)
        create_preview(candidate, video_path, out_dir, args)
        print(f"  output: {out_dir}")


if __name__ == "__main__":
    main()
