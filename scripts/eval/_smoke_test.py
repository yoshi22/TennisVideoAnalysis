#!/usr/bin/env python3.11
"""Smoke-test eval scripts after shared-helper migrations."""

from __future__ import annotations

import ast
import importlib.util
import pathlib
import subprocess
import sys

EVAL_DIR = pathlib.Path(__file__).resolve().parent
REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
SKIP_MISSING_MODULES = {"modal", "mediapipe"}


def eval_scripts() -> list[pathlib.Path]:
    return sorted(
        path
        for path in EVAL_DIR.rglob("*.py")
        if "__pycache__" not in path.parts and path.name != pathlib.Path(__file__).name
    )


def import_common():
    sys.path.insert(0, str(EVAL_DIR))
    import _common  # type: ignore

    functions = {"load_json", "frame_number", "resolve_path", "display_path"}
    constants = {"BASE", "COURT_LENGTH_M", "SINGLES_WIDTH_M", "DOUBLES_WIDTH_M"}
    for name in functions:
        assert hasattr(_common, name), f"_common missing {name}"
        assert callable(getattr(_common, name)), f"_common.{name} is not callable"
    for name in constants:
        assert hasattr(_common, name), f"_common missing {name}"

    assert _common.COURT_LENGTH_M == 23.77
    assert _common.SINGLES_WIDTH_M == 8.23
    assert _common.DOUBLES_WIDTH_M == 10.97
    assert _common.BASE == pathlib.Path(_common.__file__).resolve().parents[2]
    assert _common.BASE == REPO_ROOT
    return _common, functions | constants


def parse_tree(path: pathlib.Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def imports_common(tree: ast.Module) -> list[ast.ImportFrom]:
    return [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module == "_common"
    ]


def check_common_imports(path: pathlib.Path, tree: ast.Module, public_names: set[str]) -> list[str]:
    errors: list[str] = []
    for node in imports_common(tree):
        for alias in node.names:
            if alias.name not in public_names:
                errors.append(f"{path}: unknown _common symbol '{alias.name}'")
    return errors


def check_subdir_bootstrap(path: pathlib.Path, tree: ast.Module) -> list[str]:
    if not imports_common(tree):
        return []
    relative = path.relative_to(EVAL_DIR)
    if len(relative.parts) <= 1:
        return []
    needle = "sys.path.insert(0, str(Path(__file__).resolve().parents[1]))"
    source = path.read_text(encoding="utf-8")
    return [] if needle in source else [f"{path}: missing _common sys.path bootstrap"]


def imported_names(tree: ast.Module) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                names.add(alias.name.split(".", 1)[0])
        elif isinstance(node, ast.ImportFrom) and node.module == "typing":
            for alias in node.names:
                names.add(alias.asname or alias.name)
    return names


def annotation_names(tree: ast.Module) -> set[str]:
    names: set[str] = set()

    def collect(annotation: ast.AST | None) -> None:
        if annotation is None:
            return
        for node in ast.walk(annotation):
            if isinstance(node, ast.Name):
                names.add(node.id)

    for node in ast.walk(tree):
        if isinstance(node, ast.AnnAssign):
            collect(node.annotation)
        elif isinstance(node, (ast.arg, ast.FunctionDef, ast.AsyncFunctionDef)):
            collect(node.annotation if isinstance(node, ast.arg) else node.returns)
    return names


def referenced_module_names(tree: ast.Module) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            if node.value.id in {"re", "json"}:
                names.add(node.value.id)
    if "Any" in annotation_names(tree):
        names.add("Any")
    return names


def check_orphaned_imports(path: pathlib.Path, tree: ast.Module) -> list[str]:
    imports = imported_names(tree)
    errors: list[str] = []
    for name in sorted(referenced_module_names(tree)):
        if name not in imports:
            errors.append(f"{path}: uses {name} without importing it")
    return errors


def import_smoke(path: pathlib.Path) -> tuple[str, str]:
    code = """
import importlib.util
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
eval_dir = pathlib.Path(sys.argv[2])
sys.path.insert(0, str(path.parent))
sys.path.insert(0, str(eval_dir))
module_name = "_eval_smoke_" + "_".join(path.relative_to(eval_dir).with_suffix("").parts).replace("-", "_")
try:
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not build import spec for {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
except ModuleNotFoundError as exc:
    print(f"SMOKE_SKIP_MODULE:{exc.name}")
    raise SystemExit(20)
except SystemExit as exc:
    print(f"SMOKE_SYSTEM_EXIT:{exc.code}")
    raise
except BaseException as exc:
    print(f"SMOKE_FAIL:{type(exc).__name__}: {exc}")
    raise SystemExit(30)
"""
    result = subprocess.run(
        [sys.executable, "-c", code, str(path), str(EVAL_DIR)],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
    )
    combined = "\n".join(part for part in (result.stdout, result.stderr) if part)
    last_line = next((line for line in reversed(combined.splitlines()) if line.strip()), "")
    if result.returncode == 0:
        return "PASS", ""
    if result.returncode == 20:
        missing = last_line.rsplit(":", 1)[-1]
        if missing in SKIP_MISSING_MODULES:
            return "SKIP", missing
        return "FAIL", last_line
    if "modal" in combined and "not installed" in combined:
        return "SKIP", "modal"
    if "mediapipe" in combined and ("No module named" in combined or "ModuleNotFoundError" in combined):
        return "SKIP", "mediapipe"
    return "FAIL", last_line or f"exit {result.returncode}"


def p95_from_stdout(stdout: str) -> float | None:
    for token in stdout.replace("\n", " ").split():
        if token.startswith("p95_kmh="):
            try:
                return float(token.split("=", 1)[1])
            except ValueError:
                return None
    return None


def run_self_tests() -> tuple[list[str], list[str], list[str]]:
    passed: list[str] = []
    skipped: list[str] = []
    failed: list[str] = []

    pipeline = subprocess.run(
        [sys.executable, str(EVAL_DIR / "shot_events" / "pipeline.py"), "--self-test"],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
    )
    p95 = p95_from_stdout(pipeline.stdout)
    required = ("rallies=1", "bounces=1", "events=1")
    if (
        pipeline.returncode == 0
        and all(item in pipeline.stdout for item in required)
        and p95 is not None
        and abs(p95 - 189.1) <= 1.0
    ):
        passed.append("shot_events/pipeline.py --self-test")
    else:
        failed.append(
            "shot_events/pipeline.py --self-test: "
            + (pipeline.stderr.strip().splitlines()[-1] if pipeline.stderr.strip() else pipeline.stdout.strip())
        )

    stroke = subprocess.run(
        [sys.executable, str(EVAL_DIR / "shot_events" / "stroke_pose.py"), "--self-test"],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
    )
    stroke_output = "\n".join(part for part in (stroke.stdout, stroke.stderr) if part)
    if stroke.returncode == 0:
        passed.append("shot_events/stroke_pose.py --self-test")
    elif "ModuleNotFoundError" in stroke_output or "No module named" in stroke_output:
        missing = "unknown"
        for module in sorted(SKIP_MISSING_MODULES):
            if module in stroke_output:
                missing = module
                break
        skipped.append(f"shot_events/stroke_pose.py --self-test ({missing})")
    else:
        failed.append(
            "shot_events/stroke_pose.py --self-test: "
            + (stroke_output.strip().splitlines()[-1] if stroke_output.strip() else f"exit {stroke.returncode}")
        )

    return passed, skipped, failed


def main() -> int:
    failures: list[str] = []
    common, public_names = import_common()
    scripts = eval_scripts()

    ast_checked = 0
    common_import_files = 0
    for path in scripts:
        tree = parse_tree(path)
        ast_checked += 1
        common_imports = imports_common(tree)
        if common_imports:
            common_import_files += 1
        failures.extend(check_common_imports(path, tree, public_names))
        failures.extend(check_subdir_bootstrap(path, tree))
        failures.extend(check_orphaned_imports(path, tree))

    import_pass: list[str] = []
    import_skips: list[tuple[str, str]] = []
    import_fails: list[tuple[str, str]] = []
    for path in scripts:
        status, detail = import_smoke(path)
        label = str(path.relative_to(EVAL_DIR))
        if status == "PASS":
            import_pass.append(label)
        elif status == "SKIP":
            import_skips.append((label, detail))
        else:
            import_fails.append((label, detail))
            failures.append(f"{path}: import-smoke failed: {detail}")

    self_pass, self_skip, self_fail = run_self_tests()
    failures.extend(self_fail)

    print("eval smoke coverage summary")
    print(f"  repo_root: {REPO_ROOT}")
    print(f"  _common: {common.__file__}")
    print(f"  scripts scanned: {len(scripts)}")
    print(f"  AST cross-checked: {ast_checked} files ({common_import_files} import _common)")
    print(f"  import-smoke PASS: {len(import_pass)}")
    print(f"  import-smoke SKIP: {len(import_skips)}")
    if import_skips:
        deps = ", ".join(f"{path}={dep}" for path, dep in import_skips)
        print(f"    skipped missing deps: {deps}")
    print(f"  import-smoke FAIL: {len(import_fails)}")
    for path, detail in import_fails:
        print(f"    FAIL {path}: {detail}")
    print(f"  self-tests PASS: {len(self_pass)}")
    for item in self_pass:
        print(f"    PASS {item}")
    print(f"  self-tests SKIP: {len(self_skip)}")
    for item in self_skip:
        print(f"    SKIP {item}")
    print(f"  self-tests FAIL: {len(self_fail)}")
    for item in self_fail:
        print(f"    FAIL {item}")

    if failures:
        print("failures:")
        for failure in failures:
            print(f"  {failure}")
        return 1
    print("eval smoke: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
