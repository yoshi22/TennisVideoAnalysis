# Eval smoke harness

## What it checks

`scripts/eval/_smoke_test.py` is a repeatable safety net for the Python eval scripts after the shared `_common.py` migration.

- Verifies the `_common.py` public contract: helper functions, court constants, and repo-root `BASE`.
- AST-checks every eval Python file for valid `from _common import ...` names.
- Ensures subdirectory scripts that import `_common` include the `scripts/eval` bootstrap path.
- Conservatively catches orphaned `re`, `json`, and `Any` references after helper dedup.
- Import-smokes every eval Python file in a separate subprocess so import-time regressions do not hide behind shared `sys.modules` state.
- Runs the functional self-tests for `shot_events/pipeline.py --self-test` and `shot_events/stroke_pose.py --self-test`.

## How to run

```sh
npm run eval:smoke
```

The harness exits nonzero if any hard check fails.

## Coverage caveat

Scripts that require locally missing optional dependencies such as `modal` or `mediapipe` are still AST-checked, but their runtime import-smoke is reported as an explicit SKIP rather than a failure. Heavy eval scripts are import-smoked only; the functional coverage is currently limited to the `shot_events/pipeline.py` and `shot_events/stroke_pose.py` self-tests.
