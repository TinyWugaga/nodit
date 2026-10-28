---
name: nodit-review
description: 被要求評估、審查或 review 這個專案的 ADR、Milestone 或 Task 時使用。把評估結果寫成 docs/reviews/ 裡的新檔案，Nodit 會把它掛到目標卡片上。
# nodit-managed v6
---

# 評估卡片（Nodit review 格式）

1. 讀目標卡片（`docs/decisions/`、`docs/milestones/`、`docs/tasks/`）與相關程式碼。讀每個目標檔的同時，用下方「格式」裡的指令算出它的指紋並記下來。
2. 評估完成後，依格式建立一份新檔案。評估時不要修改目標卡片本身，也不要修改既有的 review；要處理既有 review 的 findings 時改用 `/nodit-review-resolve`。
3. 每個要求修改、補充或做決定的事項，都寫成 `## Findings` 底下的一個 `- [ ]` 項目，具體說明問題與建議；優先序與期限寫在項目開頭。其他段落不放修改要求。
4. `verdict`：可以直接接受寫 `approve`；需要修改寫 `changes`；方向有根本問題寫 `reject`。

## 格式

- 檔名：`docs/reviews/<YYYY-MM-DD>-<第一個目標ID>-<reviewer>-<6位hex>.md`，後綴用 `openssl rand -hex 3` 產生。
- 不得覆寫既有 review。用 exclusive create 寫檔：shell 先 `set -C` 再 `cat > "$FILE" <<'EOF'`，或用 `open(path, "x")`；檔案已存在就換後綴重來。
- 讀目標檔的當下就計算它的指紋，寫進 `target_rev`（把 `FILE` 換成目標檔路徑）：

  ```sh
  (printf 'blob %s\0' "$(wc -c < FILE | tr -d ' ')"; cat FILE) | shasum -a 1 | cut -d' ' -f1
  ```

  不要在 review 寫完後對最新檔案重算：那會把你沒讀過的修改標成已評估。只有確定 repo 用 SHA-1 時，才能改用 `git hash-object --no-filters FILE`。
- `status` 一律寫 `open`；之後的處理狀態由人在 Nodit 裡改。評估時不要修改既有的 review。

| 欄位 | 值 |
| --- | --- |
| `type` | `review` |
| `target` | 目標卡片 ID 陣列，例如 `[ADR-001]` |
| `reviewer` | 撰寫者，例如 `codex`、`claude` |
| `date` | `YYYY-MM-DD` |
| `verdict` | `approve` / `changes` / `reject` |
| `status` | `open` / `addressed` / `dismissed` |
| `target_rev` | 選填；`卡片 ID: 指紋` 對照表 |

正文寫 `## Summary`（結論）與 `## Findings`：

- 要求修改、補充或做決定的事項，一律寫成 `## Findings` 底下的 `- [ ]` 項目，不論它是否阻擋其他工作。Nodit 只計算、追蹤 `## Findings` 裡的項目，處理 review 的人也只會逐條處理這些項目。
- 優先序與期限寫在項目開頭，例如 `- [ ] **P1**（期限：ADR 接受前）…`。優先序只決定先後，不決定要不要列成 finding。
- 需要分組時，在 `## Findings` 底下用 `###` 小標，例如「阻擋 P0」「不阻擋 P0」，不要另開 `##` 段落。
- 其他段落只放背景、已解決項目的核對、不需要修改的建議，不能放未列入 Findings 的修改要求。

```markdown
---
type: review
target: [ADR-001]
reviewer: claude
date: 2026-10-25
verdict: changes
status: open
target_rev:
  ADR-001: 3f2a9c0e5b1d4a7f8e6c2b9d0a1f3e5c7b9d1f2a
---

## Summary

…

## Findings

### 阻擋 P0

- [ ] **P0** …

### 不阻擋 P0

- [ ] **P1**（期限：ADR 接受前）…
```
