# クリップ拡張ツールの堅牢化

**日付**: 2026-05-24  
**前回**: `20260524_clip_expansion_modal_labs.md`  
**目的**: `add-new-clip.py` / `modal_train.py` の実バグを Codex で修正し、ドライランで動作を確認

---

## 発見・修正したバグ

### Bug 1: run-stage1.ts が `--clip-id` を無視していた

`parseArgs()` は `--dataset/--fps/--run-id/--detector` のみ読んでおり、add-new-clip.py が渡す
`--clip-id` は黙殺されていた。結果として blob 検出器がデータセット全クリップで実行され、
30 clip 規模で非現実的なレイテンシになる。

**修正**: `parseArgs()` に `--clip-id` を追加し、`main()` で `filteredFiles` フィルタを実装。
指定時はそのクリップのみ処理（未指定は従来どおり全件）。

### Bug 2: prefill-label.ts がメタデータを candidates.json から上書きしていた

`prefill-label.ts` は `clipOffsetSec`, `clipDurationSec`, `sourceUrl` を candidates.json から
取得していた。新規クリップは candidates.json に存在しないため offset=0 / url='' に
フォールバックし、add-new-clip.py が作成した stub ラベルの正しい値が失われていた。

**修正**: 既存の非 draft ラベル (`labels/<clip-id>.json`) を優先読み込みし、
`stubLabel != null` の場合はそのメタデータを使用。candidates.json は fallback に降格。

### Bug 3a: modal_train.py の entrypoint が `modal run` 非互換

`@app.local_entrypoint()` に `def main()` 引数なしで内部 `sys.argv` parse → Modal が
CLI フラグを関数引数にマップする仕様と非互換で `modal run` から動かない。

**修正**: `main` を型付き引数付きで再設計:
```python
@app.local_entrypoint()
def main(run_id: str, dataset: str = "fixed-camera-v2", model: str = "gru", fps: float = 5.0, ...):
    ...
```
`upload`/`download` は modal ランタイム不要なため plain Python CLI（`if __name__ == "__main__"` + argparse）に分離。

### Bug 3b: Modal イメージに librosa が欠落

`extract_features.py` は librosa(energy-onset) を使用し、未インストール時は spectral-flux に
フォールバック（event F1 0.149 → 0.099 と劣化）。Modal Linux では librosa+numba が問題なく入る。

**修正**: `pip_install()` に `"librosa>=0.10"` を追加。

---

## 検証結果

### type-check / lint
```
npm run type-check && npm run lint → 0 errors
```

### end-to-end ドライラン（既存クリップ `yt-aiax-p6llfo-clip1`、--skip-assets）

```
Dataset: fixed-camera-v2 (1 videos)   ← --clip-id フィルタが機能（全8件ではなく1件）
Processing yt-aiax-p6llfo-clip1... 20 rallies in 33839ms
Wrote 20 rally windows to: .../yt-aiax-p6llfo-clip1_DRAFT.json
```

_DRAFT.json のメタデータ確認:
```
sourceUrl: https://www.youtube.com/watch?v=aIAx_p6LlFo  ← 既存ラベルから正しく保持
clipOffsetSec: 90   ← 既存ラベルから正しく保持
clipDurationSec: 630
rallies count: 20
```

テスト生成物は削除済み。

### modal_train.py 構文チェック
```
python3.11 -c "import ast; ast.parse(open('scripts/eval/modal_train.py').read())" → OK
```

modal 未導入時の親切エラー（別 venv 案内）も維持。

---

## 修正後のコマンドリファレンス

### 新規クリップ追加

```bash
python3.11 scripts/eval/add-new-clip.py \
  --url "https://www.youtube.com/watch?v=XXXXXXXXX" \
  --clip-id yt-XXXXXXXXX-clip1 \
  --offset 0 \
  --duration 900
# → _DRAFT.json を動画と照合して修正 → リネーム → validate
```

### Modal 訓練（25-30 clip 到達後）

```bash
# upload: plain Python
source ~/.venvs/modal-venv/bin/activate
python scripts/eval/modal_train.py upload

# train: modal run
modal run scripts/eval/modal_train.py --run-id rally-state-gru-v3 --model gru --fps 5 --epochs 200

# download: plain Python
python scripts/eval/modal_train.py download --run-id rally-state-gru-v3 --also-pp

# score locally
npm run eval:score -- --run-id rally-state-gru-v3-pp --dataset fixed-camera-v2 --baseline-run-id iter-v2-expanded-blob1
```

---

## 変更ファイル

```
scripts/eval/run-stage1.ts      — --clip-id フィルタ追加
scripts/eval/prefill-label.ts   — stub ラベル優先メタデータ取得
scripts/eval/modal_train.py     — modal run 互換 entrypoint 再設計 + librosa 追加
```
