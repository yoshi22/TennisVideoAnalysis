"""Shared helpers for eval scripts (see scripts/eval/*.py)."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

BASE = Path(__file__).resolve().parent.parent.parent  # repo root

# Court geometry (meters) — ITF singles/doubles
COURT_LENGTH_M = 23.77
SINGLES_WIDTH_M = 8.23
DOUBLES_WIDTH_M = 10.97


def load_json(path: Path) -> Any:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def frame_number(path: Path) -> int:
    match = re.search(r"(\d+)", path.name)
    return int(match.group(1)) if match else 0


def resolve_path(value: str | None, default: Path) -> Path:
    if value is None:
        return default
    path = Path(value)
    return path if path.is_absolute() else BASE / path


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(BASE))
    except ValueError:
        return str(path)
