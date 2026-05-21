#!/usr/bin/env python3
"""
prepare-fixed-camera-assets.py - Recreate local video/clip/frame assets for fixed-camera datasets.

This helper is intentionally eval-only. It reads label JSON sourceUrl and
clipOffsetSec, downloads unique source videos with yt-dlp, clips each labeled
segment, and extracts scoreless scan frames plus TrackNet-oriented 30fps JPEGs.

Usage:
  /usr/local/bin/python3.11 scripts/eval/prepare-fixed-camera-assets.py \
      --dataset fixed-camera-v2 [--clip-id yt-maitou-suzumura-muko-clip2]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

BASE = Path(__file__).parent.parent.parent
DATASET = "fixed-camera-v1"
DATASET_DIR = BASE / "eval/datasets" / DATASET
LABEL_DIR = DATASET_DIR / "labels"
CANDIDATES_PATH = DATASET_DIR / "candidates.json"
VIDEO_DIR = DATASET_DIR / "videos"
CLIP_DIR = DATASET_DIR / "clips"
FRAMES_DIR = DATASET_DIR / "frames"
FRAMES30_DIR = DATASET_DIR / "frames30"


@dataclass(frozen=True)
class AssetSpec:
    clip_id: str
    source_url: str
    offset_sec: float
    duration_sec: float
    source: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default=DATASET)
    parser.add_argument("--clip-id", action="append", help="Limit to one or more clip ids")
    parser.add_argument("--scan-fps", type=float, default=3.0)
    parser.add_argument("--track-fps", type=float, default=None)
    parser.add_argument("--fps", type=float, default=30.0, help="Backward-compatible alias for --track-fps")
    parser.add_argument("--max-height", type=int, default=720)
    parser.add_argument("--duration-sec", type=float, default=600.0)
    parser.add_argument("--include-candidate-clips", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def set_dataset(dataset: str) -> None:
    global DATASET, DATASET_DIR, LABEL_DIR, CANDIDATES_PATH, VIDEO_DIR, CLIP_DIR, FRAMES_DIR, FRAMES30_DIR
    DATASET = dataset
    DATASET_DIR = BASE / "eval/datasets" / DATASET
    LABEL_DIR = DATASET_DIR / "labels"
    CANDIDATES_PATH = DATASET_DIR / "candidates.json"
    VIDEO_DIR = DATASET_DIR / "videos"
    CLIP_DIR = DATASET_DIR / "clips"
    FRAMES_DIR = DATASET_DIR / "frames"
    FRAMES30_DIR = DATASET_DIR / "frames30"


def load_json(path: Path) -> Any:
    with open(path) as f:
        return json.load(f)


def load_label_specs(clip_ids: list[str] | None, default_duration_sec: float) -> list[AssetSpec]:
    specs: list[AssetSpec] = []
    wanted = set(clip_ids or [])
    for path in sorted(LABEL_DIR.glob("*.json")):
        label = load_json(path)
        if wanted and label["videoId"] not in wanted:
            continue
        specs.append(
            AssetSpec(
                clip_id=label["videoId"],
                source_url=label["sourceUrl"],
                offset_sec=float(label["clipOffsetSec"]),
                duration_sec=float(label.get("clipDurationSec", default_duration_sec)),
                source=f"label:{path.name}",
            )
        )
    return specs


def load_candidate_specs(clip_ids: list[str] | None, default_duration_sec: float) -> list[AssetSpec]:
    if not CANDIDATES_PATH.exists():
        return []

    wanted = set(clip_ids or [])
    candidates = load_json(CANDIDATES_PATH).get("candidateVideos", [])
    specs: list[AssetSpec] = []
    for candidate in candidates:
        for clip in candidate.get("selectedClips", []):
            clip_id = clip.get("clipId")
            if not clip_id or (wanted and clip_id not in wanted):
                continue
            if "offsetSec" not in clip:
                continue
            specs.append(
                AssetSpec(
                    clip_id=clip_id,
                    source_url=clip.get("sourceUrl", candidate["url"]),
                    offset_sec=float(clip["offsetSec"]),
                    duration_sec=float(clip.get("durationSec", default_duration_sec)),
                    source=f"candidate:{candidate['id']}",
                )
            )
    return specs


def load_asset_specs(args: argparse.Namespace) -> list[AssetSpec]:
    specs = load_label_specs(args.clip_id, args.duration_sec)
    if args.include_candidate_clips:
        specs.extend(load_candidate_specs(args.clip_id, args.duration_sec))
    return specs


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


def clip_source(source_path: Path, spec: AssetSpec, overwrite: bool) -> Path:
    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    out_path = CLIP_DIR / f"{spec.clip_id}.mp4"
    if out_path.exists() and not overwrite:
        return out_path
    run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            f"{spec.offset_sec:.3f}",
            "-t",
            f"{spec.duration_sec:.3f}",
            "-i",
            str(source_path),
            "-c",
            "copy",
            str(out_path),
        ]
    )
    return out_path


def extract_frames(
    clip_path: Path,
    clip_id: str,
    out_parent: Path,
    fps: float,
    overwrite: bool,
    scale_width: int,
) -> Path:
    out_dir = out_parent / clip_id
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
            f"scale={scale_width}:-1,fps={fps:g}",
            "-q:v",
            "5",
            str(out_dir / "frame_%06d.jpg"),
        ]
    )
    return out_dir


def main() -> None:
    args = parse_args()
    set_dataset(args.dataset)
    track_fps = args.track_fps if args.track_fps is not None else args.fps
    specs = load_asset_specs(args)
    if not specs:
        raise SystemExit("No matching labels or selected candidate clips found.")

    source_offsets: dict[tuple[str, float], list[str]] = {}
    for spec in specs:
        source_offsets.setdefault((spec.source_url, spec.offset_sec), []).append(spec.clip_id)
    for (url, offset), clip_ids in source_offsets.items():
        if len(clip_ids) > 1:
            print(
                "WARNING: multiple labels share the same sourceUrl+clipOffsetSec: "
                f"offset={offset} clips={clip_ids}. Verify label metadata before trusting regenerated frames."
            )

    source_cache: dict[str, Path] = {}
    for spec in specs:
        print(f"\n-- {spec.clip_id} offset={spec.offset_sec:.1f}s duration={spec.duration_sec:.1f}s ({spec.source})")
        source_path = source_cache.get(spec.source_url)
        if source_path is None:
            source_path = download_source(spec.source_url, args.overwrite, args.max_height)
            source_cache[spec.source_url] = source_path
        clip_path = clip_source(source_path, spec, args.overwrite)
        scan_dir = extract_frames(clip_path, spec.clip_id, FRAMES_DIR, args.scan_fps, args.overwrite, 960)
        track_dir = extract_frames(clip_path, spec.clip_id, FRAMES30_DIR, track_fps, args.overwrite, 1280)
        n_scan = len(list(scan_dir.glob("*.jpg")))
        n_track = len(list(track_dir.glob("*.jpg")))
        print(f"  frames: {scan_dir} ({n_scan} jpg @ {args.scan_fps:g}fps)")
        print(f"  frames30: {track_dir} ({n_track} jpg @ {track_fps:g}fps)")


if __name__ == "__main__":
    main()
