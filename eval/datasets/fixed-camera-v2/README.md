# fixed-camera-v2

Purpose: expand fixed-camera, scoreless rally detection validation beyond the
three `fixed-camera-v1` seed clips. This dataset must remain usable without
scoreboard, OCR, or score-state inputs at inference time.

## Seed status

The initial v2 seed copies the three independent `fixed-camera-v1` labels so
the evaluation scripts can be smoke-tested against a new dataset name:

- `yt-maitou-suzumura-fukui-clip1`
- `yt-maitou-suzumura-muko-clip1`
- `yt-maitou-suzumura-muko-clip2`

Local frames may be symlinked from `fixed-camera-v1/frames` for these seed
clips. Raw videos, frames, tracks, and generated results are intentionally
ignored by git.

## Expansion protocol

1. Add candidate video metadata to `candidates.json` before downloading media.
2. Extract 8-12 minute fixed-camera singles clips that contain normal rally,
   walking, changeover, serve preparation, and dead-ball periods.
3. Create labels from manual visual boundary review. Do not derive labels from
   algorithm output.
4. Keep labels independent from score displays. Scoreboards may be used only as
   an optional audit clue when they are present; they must not become inference
   inputs or the only boundary source for new general-user clips.
5. Validate new methods with leave-one-clip-out or holdout scoring. Do not
   accept a model if aggregate F1 improves by trading off a large held-out clip
   regression.

## Method direction

Current local validation rejected the TrackNet V1 confidence gate on this
fixed-camera sample. The next model direction should prioritize motion-aware
temporal ball evidence:

- TrackNetV4-style frame-difference motion attention.
- Occlusion-aware temporal tracking as a later candidate if open weights and
  runtime are practical.

These model features should be evaluated as perception features only. They
must not consume score, OCR, scoreboard ROI, or score-state artifacts.
