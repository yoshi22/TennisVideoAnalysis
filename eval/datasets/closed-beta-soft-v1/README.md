# closed-beta-soft-v1

Purpose: collect consented soft-tennis closed-beta user submissions for
training data. This dataset is train-only and must not be used for held-out
test evaluation, even after a label file has been human-verified and its
`_DRAFT` suffix has been removed.

## Source

Submissions are uploaded by the client app to Supabase Storage under:

```text
beta-submissions/{participantId}/{submissionId}/video.mp4
beta-submissions/{participantId}/{submissionId}/manifest.json
```

Only submissions with `consent.version == 1` are ingested. Participant IDs are
anonymous and should remain redacted in notes and candidate titles.

## Ingestion Workflow

Download one or more submission bundles locally with this shape:

```text
downloads/
  {participantId}/
    {submissionId}/
      video.mp4
      manifest.json
```

Then run:

```bash
python3.11 scripts/eval/ingest-user-submission.py \
  --bundle-dir /path/to/downloads \
  --dataset closed-beta-soft-v1
```

Use `--dry-run` to validate manifests, hash videos, and preview writes without
copying media or updating `candidates.json`.

The ingester creates:

- `videos/<clipId>.mp4` from the submitted video
- `labels/<clipId>_DRAFT.json` with scoreless rally windows
- `tactical/<clipId>.json` with full tactical point labels
- a `candidateVideos` entry in `candidates.json`

`_DRAFT` labels require human boundary verification before they are useful for
training. Removing `_DRAFT` does not make the clip eligible for held-out eval.

## Git Policy

Raw video files, generated clips, and extracted frames are intentionally ignored
by git. Label JSON files under `labels/` and tactical JSON files under
`tactical/` are commit targets.

Ignored local asset locations include:

- `videos/`
- `clips/`
- `frames/`

## Tactical Labels

`tactical/` stores train-only labels for point outcome, shot type, rally count,
and shot/target locations. These labels are separate from the scoreless rally
leaderboard and must not be mixed into held-out evaluation.

## Validation

Validate scoreless labels after manual edits:

```bash
python3.11 scripts/eval/validate-rally-labels.py --dataset closed-beta-soft-v1
```

Soft-tennis rallies can exceed the default 45 second rally warning threshold.
Long rallies in this dataset should be reviewed, but they are not automatically
excluded.
