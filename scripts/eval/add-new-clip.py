#!/usr/bin/env python3
"""
add-new-clip.py — Automate new labeled clip addition to a fixed-camera dataset.

Workflow:
  1. Creates a stub label JSON in eval/datasets/<dataset>/labels/<clip-id>.json
  2. Runs prepare-fixed-camera-assets.py to download + extract frames
  3. Runs eval:run1 (blob detector) to get initial window predictions
  4. Runs eval:prefill to create <clip-id>_DRAFT.json from blob results
  5. Prints manual correction instructions

After running this script:
  - Open eval/datasets/<dataset>/labels/<clip-id>_DRAFT.json
  - Watch the video and correct rally startSec/endSec boundaries
  - Rename _DRAFT.json to <clip-id>.json (removes _DRAFT suffix)
  - Run: python3.11 scripts/eval/validate-rally-labels.py --dataset <dataset>

Usage:
  python3.11 scripts/eval/add-new-clip.py \
    --url "https://www.youtube.com/watch?v=XXXXXXXXXXX" \
    --clip-id yt-XXXXXXXXXXX-clip1 \
    --offset 0 \
    --duration 900 \
    [--dataset fixed-camera-v2]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent.parent
SCRIPTS_DIR = BASE / "scripts" / "eval"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Add a new labeled clip to the eval dataset.")
    p.add_argument("--url", required=True, help="YouTube URL (e.g. https://www.youtube.com/watch?v=...)")
    p.add_argument("--clip-id", required=True, help="Unique clip identifier, e.g. yt-XXXXXXXXXXX-clip1")
    p.add_argument("--offset", type=float, default=0.0, help="Clip start offset within source video (seconds)")
    p.add_argument("--duration", type=float, required=True, help="Clip duration (seconds)")
    p.add_argument("--dataset", default="fixed-camera-v2")
    p.add_argument("--note", default="", help="Optional note about this clip")
    p.add_argument("--skip-assets", action="store_true", help="Skip video download + frame extraction (assets already present)")
    p.add_argument("--skip-prefill", action="store_true", help="Skip blob detector + prefill step")
    return p.parse_args()


def create_stub_label(labels_dir: Path, clip_id: str, url: str, offset: float, duration: float, note: str) -> Path:
    label_path = labels_dir / f"{clip_id}.json"
    if label_path.exists():
        print(f"[skip] Label already exists: {label_path.relative_to(BASE)}")
        return label_path

    stub = {
        "schemaVersion": 1,
        "videoId": clip_id,
        "sourceUrl": url,
        "sourceSha256": "",
        "fps": 30,
        "clipOffsetSec": offset,
        "clipDurationSec": duration,
        "note": note or f"Fixed-camera clip. Stub created by add-new-clip.py. Edit rallies manually.",
        "rallies": [],
    }
    label_path.write_text(json.dumps(stub, indent=2, ensure_ascii=False))
    print(f"[ok] Created stub label: {label_path.relative_to(BASE)}")
    return label_path


def run(cmd: list[str], desc: str) -> int:
    print(f"\n>>> {desc}")
    print(f"    {' '.join(cmd)}")
    result = subprocess.run(cmd)
    if result.returncode != 0:
        print(f"[WARN] Command exited with code {result.returncode}: {desc}", file=sys.stderr)
    return result.returncode


def main() -> None:
    args = parse_args()
    dataset_dir = BASE / "eval" / "datasets" / args.dataset
    labels_dir = dataset_dir / "labels"
    labels_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n=== Adding clip: {args.clip_id} to dataset: {args.dataset} ===")

    # 1. Create stub label JSON
    create_stub_label(labels_dir, args.clip_id, args.url, args.offset, args.duration, args.note)

    # 2. Download + extract frames
    if not args.skip_assets:
        rc = run(
            [
                "python3.11",
                str(SCRIPTS_DIR / "prepare-fixed-camera-assets.py"),
                "--dataset", args.dataset,
                "--clip-id", args.clip_id,
            ],
            "Downloading video + extracting frames",
        )
        if rc != 0:
            print("[WARN] prepare-fixed-camera-assets.py failed. Check yt-dlp is installed and URL is valid.", file=sys.stderr)
    else:
        print("[skip] --skip-assets: skipping video download")

    # 3. Blob detector run
    if not args.skip_prefill:
        draft_run_id = f"draft-{args.clip_id}"
        rc = run(
            [
                "npm", "run", "eval:run1", "--",
                "--run-id", draft_run_id,
                "--dataset", args.dataset,
                "--clip-id", args.clip_id,
            ],
            f"Running blob detector (run-id: {draft_run_id})",
        )
        if rc != 0:
            print("[WARN] eval:run1 failed — continuing without blob prefill", file=sys.stderr)
        else:
            # 4. Prefill _DRAFT.json
            run(
                [
                    "npm", "run", "eval:prefill", "--",
                    "--run-id", draft_run_id,
                    "--clip-id", args.clip_id,
                ],
                f"Creating _DRAFT label from blob results",
            )
    else:
        print("[skip] --skip-prefill: skipping blob detector + prefill")

    # 5. Print instructions
    draft_path = labels_dir / f"{args.clip_id}_DRAFT.json"
    final_path = labels_dir / f"{args.clip_id}.json"

    print(f"""
=== Next steps ===

1. Watch the video clip:
   eval/datasets/{args.dataset}/clips/{args.clip_id}.mp4

2. Open the draft label and correct rally boundaries:
   {draft_path.relative_to(BASE) if draft_path.exists() else final_path.relative_to(BASE)}

   Each rally entry:
     {{"startSec": <float>, "endSec": <float>, "server": null, "winner": null, "endReason": null}}

   Accuracy target: ±3s on boundaries. Aim for ≥15 rallies if the clip allows.

3. Rename the draft to finalize:
   mv {draft_path.relative_to(BASE)} {final_path.relative_to(BASE)}

4. Validate:
   python3.11 scripts/eval/validate-rally-labels.py --dataset {args.dataset}

5. (Optional) Extract pose for this clip:
   python3.11 scripts/eval/pose-extract.py --dataset {args.dataset} --clip {args.clip_id}

After labeling enough clips (target: 25-30), train on Modal:
   python3.11 scripts/eval/modal_train.py upload
   python3.11 scripts/eval/modal_train.py train --run-id rally-state-gru-v3 --model gru --fps 5 --epochs 200
   python3.11 scripts/eval/modal_train.py download --run-id rally-state-gru-v3
""")


if __name__ == "__main__":
    main()
