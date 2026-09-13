#!/bin/bash
# Frame-mode GT expansion loop (robust against the video-mode OOM that killed the
# mp4-direct pipeline). Per clip: extract 30fps frames -> move mp4 aside so
# track-ball uses the stable frame path -> TrackNet inference -> trajectory -> GT.
# Resumable: skips clips whose GT already has >100 rows.
set -u
cd /Users/muroiyousuke/Projects/TennisVideoAnalysis || exit 1
PY=/usr/local/bin/python3.11
WEIGHTS=/private/tmp/tennis-eval-models/tracknet_weights.pth
DS=eval/datasets/fixed-camera-v2
BAK=/tmp/clipbak; mkdir -p "$BAK"

CLIPS="yt-29hnqxtyuzm-clip1 yt-61l1sw26dtg-clip1 yt-aiax-p6llfo-clip1 yt-gr4ves-ntp4-clip1 yt-lm5yzwr8lsw-clip1 yt-na9s4gjzel0-clip1 yt-qtrjfrca3z0-clip1"

for CLIP in $CLIPS; do
  GT="$DS/ball-gt/$CLIP.jsonl"
  if [ -f "$GT" ] && [ "$(wc -l < "$GT")" -gt 100 ]; then
    echo "=== SKIP $CLIP (GT exists: $(wc -l < "$GT") rows) ==="; continue
  fi
  MP4="$DS/clips/$CLIP.mp4"
  if [ ! -f "$MP4" ] && [ ! -f "$BAK/$CLIP.mp4" ]; then echo "=== $CLIP: no mp4, skip ==="; continue; fi
  FD="$DS/frames/$CLIP"

  echo "=== $CLIP: [1/4] extract 30fps frames ==="
  mkdir -p "$FD"
  # only extract if not already ~30fps (heuristic: <5000 files means old 3fps or empty)
  if [ "$(ls "$FD" 2>/dev/null | wc -l)" -lt 5000 ]; then
    rm -f "$FD"/*.jpg
    ffmpeg -y -loglevel error -i "$MP4" -vf fps=30 -q:v 3 "$FD/frame_%06d.jpg" || { echo "ffmpeg failed $CLIP"; continue; }
  fi
  echo "    frames: $(ls "$FD" | wc -l)"

  echo "=== $CLIP: [2/4] track-ball (frame mode) ==="
  mv "$MP4" "$BAK/" 2>/dev/null   # force frame path (mp4 out of resolve order)
  PYTHONUNBUFFERED=1 $PY -u scripts/eval/track-ball.py --dataset fixed-camera-v2 \
    --clip-id "$CLIP" --stride 2 --weights "$WEIGHTS" --device mps --overwrite
  RC=$?
  mv "$BAK/$CLIP.mp4" "$DS/clips/" 2>/dev/null   # restore mp4
  if [ $RC -ne 0 ]; then echo "track-ball failed $CLIP rc=$RC"; continue; fi

  echo "=== $CLIP: [3/4] trajectory_process ==="
  $PY scripts/eval/autolabel/trajectory_process.py --clip-id "$CLIP" || echo "traj failed $CLIP"

  echo "=== $CLIP: [4/4] build GT ==="
  $PY scripts/eval/autolabel/build_ball_gt_from_track.py --dataset fixed-camera-v2 --clip-id "$CLIP" || echo "gt failed $CLIP"

  echo "=== $CLIP DONE: GT $(wc -l < "$GT" 2>/dev/null || echo 0) rows ==="
done
echo "=== ALL CLIPS DONE ==="
