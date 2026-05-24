#!/usr/bin/env python3
"""
modal_train.py — Modal Labs remote GPU training for CourtLens rally-state models.

Prerequisites:
  pip install modal          # in a clean venv (not this repo's env — see note below)
  modal token new            # one-time browser auth

Note on local install: Modal requires packaging>=24 which conflicts with this repo's
Python env on macOS. Use a separate venv:
  python3.11 -m venv ~/.venvs/modal-venv
  source ~/.venvs/modal-venv/bin/activate
  pip install modal
  modal token new
  python3.11 scripts/eval/modal_train.py upload   # run from repo root

Interface:
  train:    modal run scripts/eval/modal_train.py --run-id <id> [--model gru] [--fps 5] [--epochs 200]
  upload:   python scripts/eval/modal_train.py upload [--dataset fixed-camera-v2]
  download: python scripts/eval/modal_train.py download --run-id <id> [--also-pp]
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent.parent

# ---------------------------------------------------------------------------
# Check modal is importable before defining the app
# ---------------------------------------------------------------------------
try:
    import modal  # noqa: F401
except ImportError:
    print(
        "ERROR: 'modal' is not installed in this Python environment.\n"
        "Install it in a separate venv to avoid dependency conflicts:\n\n"
        "  python3.11 -m venv ~/.venvs/modal-venv\n"
        "  source ~/.venvs/modal-venv/bin/activate\n"
        "  pip install modal\n"
        "  modal token new\n\n"
        "Then run this script from within that venv.",
        file=sys.stderr,
    )
    sys.exit(1)

import modal

# ---------------------------------------------------------------------------
# Modal app definition
# ---------------------------------------------------------------------------

VOLUME_NAME = "courtlens-v2-data"
APP_NAME = "courtlens-rally-state"
REMOTE_BASE = Path("/data")
REMOTE_DATASETS = REMOTE_BASE / "eval" / "datasets"
REMOTE_RESULTS = REMOTE_BASE / "eval" / "results"
REMOTE_SCRIPTS = REMOTE_BASE / "scripts" / "eval" / "rally_state"

app = modal.App(APP_NAME)

volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install(
        "torch>=2.2",
        "numpy>=1.26",
        "soundfile>=0.12",
        "opencv-python-headless>=4.9",
        "scipy>=1.12",
        "librosa>=0.10",
    )
)


@app.function(
    image=image,
    gpu="T4",
    timeout=60 * 60 * 3,  # 3h
    volumes={str(REMOTE_BASE): volume},
)
def train_remote(
    dataset: str,
    run_id: str,
    fps: float,
    model: str,
    epochs: int,
    lr: float,
    hysteresis_lo: float,
    hysteresis_hi: float,
    gap_tol: float,
    start_pad: float,
    end_pad: float,
    min_dur: float,
) -> dict:
    """Run LOCO CV training + best-effort post-processing on Modal GPU."""
    import subprocess, sys

    def run(cmd: list[str], desc: str) -> None:
        print(f"\n>>> {desc}", flush=True)
        result = subprocess.run(cmd, cwd=str(REMOTE_BASE))
        if result.returncode != 0:
            raise RuntimeError(f"Command failed (exit {result.returncode}): {desc}")

    train_cmd = [
        sys.executable,
        str(REMOTE_SCRIPTS / "train.py"),
        "--dataset", dataset,
        "--run-id", run_id,
        "--fps", str(fps),
        "--model", model,
        "--epochs", str(epochs),
        "--lr", str(lr),
        "--device", "auto",
    ]
    run(train_cmd, f"Training {model} fps={fps} epochs={epochs} run-id={run_id}")

    # Post-processing with provided hysteresis/padding params
    pp_run_id = f"{run_id}-pp"
    pp_cmd = [
        sys.executable,
        str(REMOTE_SCRIPTS / "tune_postprocess.py"),
        "--source-run-id", run_id,
        "--run-id", pp_run_id,
        "--dataset", dataset,
        "--hysteresis-lo", str(hysteresis_lo),
        "--hysteresis-hi", str(hysteresis_hi),
        "--gap-tol", str(gap_tol),
        "--start-pad", str(start_pad),
        "--end-pad", str(end_pad),
        "--min-dur", str(min_dur),
    ]
    run(pp_cmd, f"Post-processing → {pp_run_id}")

    volume.commit()
    return {"run_id": run_id, "pp_run_id": pp_run_id}


# ---------------------------------------------------------------------------
# Modal entrypoint (train)
# ---------------------------------------------------------------------------
# Invoke training with:
#   modal run scripts/eval/modal_train.py --run-id rally-state-gru-v3 [options]
#
# Upload/download use plain Python (no modal runtime needed):
#   python scripts/eval/modal_train.py upload [--dataset fixed-camera-v2]
#   python scripts/eval/modal_train.py download --run-id <id> [--also-pp]

@app.local_entrypoint()
def main(
    run_id: str,
    dataset: str = "fixed-camera-v2",
    model: str = "gru",
    fps: float = 5.0,
    epochs: int = 200,
    lr: float = 0.001,
    hysteresis_lo: float = 0.35,
    hysteresis_hi: float = 0.50,
    gap_tol: float = 3.0,
    start_pad: float = 1.0,
    end_pad: float = 2.0,
    min_dur: float = 3.0,
) -> None:
    """Train a rally-state model on Modal GPU. Called via `modal run`."""
    print(f"\n=== Launching remote training: {run_id} ===")
    print(f"    model={model}  fps={fps}  epochs={epochs}  dataset={dataset}")
    result = train_remote.remote(
        dataset=dataset,
        run_id=run_id,
        fps=fps,
        model=model,
        epochs=epochs,
        lr=lr,
        hysteresis_lo=hysteresis_lo,
        hysteresis_hi=hysteresis_hi,
        gap_tol=gap_tol,
        start_pad=start_pad,
        end_pad=end_pad,
        min_dur=min_dur,
    )
    pp_id = result["pp_run_id"]
    print(f"\n[ok] Training complete. run_id={result['run_id']}  pp_run_id={pp_id}")
    print(f"Download results with:")
    print(f"  python scripts/eval/modal_train.py download --run-id {result['run_id']} --also-pp")
    print(f"Score locally with:")
    print(f"  npm run eval:score -- --run-id {pp_id} --dataset {dataset} --baseline-run-id iter-v2-expanded-blob1")


# ---------------------------------------------------------------------------
# Upload / Download (plain Python CLI, no modal runtime needed)
# ---------------------------------------------------------------------------

def _upload(dataset: str) -> None:
    dataset_local = BASE / "eval" / "datasets" / dataset
    scripts_local = BASE / "scripts" / "eval" / "rally_state"
    print(f"\n=== Uploading dataset: {dataset} ===")
    subprocess.run(
        ["modal", "volume", "put", VOLUME_NAME, str(dataset_local), f"/data/eval/datasets/{dataset}"],
        check=True,
    )
    print(f"\n=== Uploading rally_state scripts ===")
    subprocess.run(
        ["modal", "volume", "put", VOLUME_NAME, str(scripts_local), "/data/scripts/eval/rally_state"],
        check=True,
    )
    print("\n[ok] Upload complete.")
    print("Train with:")
    print(f"  modal run scripts/eval/modal_train.py --run-id <run-id> --dataset {dataset}")


def _download(run_id: str, also_pp: bool) -> None:
    run_ids = [run_id]
    if also_pp:
        run_ids.append(f"{run_id}-pp")
    for rid in run_ids:
        local_dir = BASE / "eval" / "results" / rid
        local_dir.mkdir(parents=True, exist_ok=True)
        print(f"Downloading Modal Volume:/data/eval/results/{rid} → {local_dir}")
        subprocess.run(
            ["modal", "volume", "get", VOLUME_NAME, f"/data/eval/results/{rid}", str(local_dir)],
            check=True,
        )
        print(f"[ok] Downloaded: eval/results/{rid}/")
    pp_id = f"{run_id}-pp"
    print(f"\nScore locally with:")
    print(f"  npm run eval:score -- --run-id {pp_id} --dataset fixed-camera-v2 --baseline-run-id iter-v2-expanded-blob1")


if __name__ == "__main__":
    import argparse as _argparse

    _p = _argparse.ArgumentParser(description="Upload/download for CourtLens Modal training.")
    _sub = _p.add_subparsers(dest="cmd", required=True)

    _up = _sub.add_parser("upload", help="Sync local dataset + scripts to Modal Volume")
    _up.add_argument("--dataset", default="fixed-camera-v2")

    _dl = _sub.add_parser("download", help="Sync results from Modal Volume to local")
    _dl.add_argument("--run-id", required=True)
    _dl.add_argument("--also-pp", action="store_true", help="Also download <run-id>-pp")

    _args = _p.parse_args()
    if _args.cmd == "upload":
        _upload(_args.dataset)
    elif _args.cmd == "download":
        _download(_args.run_id, _args.also_pp)
