#!/usr/bin/env python3
"""
prepare-fixed-camera-assets.py - Recreate local video/clip/frame assets for fixed-camera-v1.

This helper is intentionally eval-only. It reads label JSON sourceUrl and
clipOffsetSec, downloads unique source videos with yt-dlp, clips each labeled
600s segment, and extracts TrackNet-oriented 30fps JPEGs into frames30/.

Usage:
  /usr/local/bin/python3.11 scripts/eval/prepare-fixed-camera-assets.py \
      [--clip-id yt-maitou-suzumura-muko-clip2] [--fps 30]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any

BASE = Path(__file__).parent.parent.parent
DATASET_DIR = BASE / "eval/datasets/fixed-camera-v1"
LABEL_DIR = DATASET_DIR / "labels"
VIDEO_DIR = DATASET_DIR / "videos"
CLIP_DIR = DATASET_DIR / "clips"
FRAMES30_DIR = DATASET_DIR / "frames30"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--clip-id", action="append", help="Limit to one or more clip ids")
    parser.add_argument("--fps", type=float, default=30.0)
    parser.add_argument("--max-height", type=int, default=720)
    parser.add_argument("--duration-sec", type=float, default=600.0)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def load_labels(clip_ids: list[str] | None) -> list[dict[str, Any]]:
    labels: list[dict[str, Any]] = []
    wanted = set(clip_ids or [])
    for path in sorted(LABEL_DIR.glob("*.json")):
        with open(path) as f:
            label = json.load(f)
        if wanted and label["videoId"] not in wanted:
            continue
        labels.append(label)
    return labels


def source_key(url: str) -> str:
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    return f"source-{digest}"


def run(cmd: list[str]) -> None:
    print("  " + " ".join(cmd))
    subprocess.run(cmd, check=True)


def download_source(url: str, overwrite: bool, max_height: int) -> Path:
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    out_base = VIDEO_DIR / source_key(url)
    out_path = out_base.with_suffix(".mp4")
    if out_path.exists() and not overwrite:
        return out_path

    template = str(out_base) + ".%(ext)s"
    run(
        [
            "yt-dlp",
            "-f",
            f"best[height<={max_height}][ext=mp4]/best[height<={max_height}]",
            "--merge-output-format",
            "mp4",
            "-o",
            template,
            url,
        ]
    )
    if not out_path.exists():
        matches = sorted(VIDEO_DIR.glob(f"{out_base.name}.*"))
        if not matches:
            raise FileNotFoundError(f"yt-dlp did not produce {out_path}")
        return matches[0]
    return out_path


def clip_source(source_path: Path, clip_id: str, offset_sec: float, duration_sec: float, overwrite: bool) -> Path:
    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    out_path = CLIP_DIR / f"{clip_id}.mp4"
    if out_path.exists() and not overwrite:
        return out_path
    run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            f"{offset_sec:.3f}",
            "-t",
            f"{duration_sec:.3f}",
            "-i",
            str(source_path),
            "-c",
            "copy",
            str(out_path),
        ]
    )
    return out_path


def extract_frames(clip_path: Path, clip_id: str, fps: float, overwrite: bool) -> Path:
    out_dir = FRAMES30_DIR / clip_id
    if out_dir.exists() and any(out_dir.glob("*.jpg")) and not overwrite:
        return out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(clip_path),
            "-vf",
            f"scale=1280:-1,fps={fps:g}",
            "-q:v",
            "5",
            str(out_dir / "frame_%06d.jpg"),
        ]
    )
    return out_dir


def main() -> None:
    args = parse_args()
    labels = load_labels(args.clip_id)
    if not labels:
        raise SystemExit("No matching labels found.")

    source_offsets: dict[tuple[str, float], list[str]] = {}
    for label in labels:
        source_offsets.setdefault((label["sourceUrl"], float(label["clipOffsetSec"])), []).append(label["videoId"])
    for (url, offset), clip_ids in source_offsets.items():
        if len(clip_ids) > 1:
            print(
                "WARNING: multiple labels share the same sourceUrl+clipOffsetSec: "
                f"offset={offset} clips={clip_ids}. Verify label metadata before trusting regenerated frames."
            )

    source_cache: dict[str, Path] = {}
    for label in labels:
        clip_id = label["videoId"]
        url = label["sourceUrl"]
        offset = float(label["clipOffsetSec"])
        print(f"\n-- {clip_id} offset={offset:.1f}s")
        source_path = source_cache.get(url)
        if source_path is None:
            source_path = download_source(url, args.overwrite, args.max_height)
            source_cache[url] = source_path
        clip_path = clip_source(source_path, clip_id, offset, args.duration_sec, args.overwrite)
        frames_dir = extract_frames(clip_path, clip_id, args.fps, args.overwrite)
        n_frames = len(list(frames_dir.glob("*.jpg")))
        print(f"  frames30: {frames_dir} ({n_frames} jpg)")


if __name__ == "__main__":
    main()
