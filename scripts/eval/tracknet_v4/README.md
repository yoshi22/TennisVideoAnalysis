# TrackNetV4 Training Scaffold

This directory contains a minimal PyTorch TrackNetV4-style training scaffold for
CourtLens ball ground truth.

- `model.py`: TrackNetV2-style encoder/decoder heatmap CNN with motion-aware
  fusion over three consecutive RGB frames.
- `dataset.py`: reads `eval/datasets/<dataset>/ball-gt/<clipId>.jsonl` and
  `eval/datasets/<dataset>/frames/<clipId>/frame_%06d.jpg`.
- `train.py`: self-test and training CLI.

Inputs are 3 RGB frames `(N-1, N, N+1)` resized to `288x512` and concatenated as
9 channels. Targets are Gaussian heatmaps at the model output resolution. Sparse
neighbor labels are masked out so missing JSONL rows are ignored by the loss.

## Self-Test

```bash
/usr/local/bin/python3.11 scripts/eval/tracknet_v4/train.py --self-test --device mps
```

The command builds the model and runs one random forward/backward pass. It falls
back to CPU when MPS is unavailable or cannot run an op.

## Training

Once reviewed ball GT exists:

```bash
/usr/local/bin/python3.11 scripts/eval/tracknet_v4/train.py \
  --dataset fixed-camera-v2 \
  --clip-id yt-example-clip1 \
  --epochs 30 \
  --batch-size 2 \
  --lr 1e-4 \
  --output-dir eval/results/tracknet-v4-fixed-camera-v2 \
  --device mps
```

Use repeated `--clip-id` values or a comma-separated `--clip-ids` list for
multiple clips. The trainer overwrites `latest.pt` each epoch and writes a small
`train_summary.json`.

Weights must be trained in this repo from reviewed GT. The reference
implementation does not provide usable pretrained weights for our harness, and
our trained checkpoints are our own artifacts.

Reference architecture notes:
https://github.com/AIKnowU/tracknet-v4-pytorch
