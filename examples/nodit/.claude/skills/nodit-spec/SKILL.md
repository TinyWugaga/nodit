---
name: nodit-spec
description: 在這個專案為 ADR 撰寫、修訂或取代技術規格（Spec，docs/specs/）時使用，也用於 Nodit 顯示「ADR 已修改」需要重新確認 Spec 時。依 Nodit 格式寫入 Spec，記錄 adr_rev，並依驗收條件開 Task。
# nodit-managed v7
---

# 撰寫或修訂 Spec（Nodit 格式）

1. 讀 Spec 要實作的 ADR（`docs/decisions/`）與相關程式碼。讀每份 ADR 的同時執行 `nodit rev <ADR-ID>` 記下輸出（devDependency 時用 `npx --no nodit rev`）。指令以非零狀態結束時，照它的訊息處理，不要自己計算。
2. 新建時執行 `nodit new spec "<標題>" --implements ADR-00X`，它會印出新 Spec 的 ID 與路徑。指令不可用時，列出 `docs/specs/` 取最大編號 + 1，照下面的格式手寫，並省略 `adr_rev`。
3. 填寫 `## Scope`、`## Design`、`## Acceptance Criteria`，把第 1 步記下的指紋寫進 `adr_rev`。
4. 不要修改 `id`；frontmatter 裡不認得的欄位保持原樣。修改既有 Spec 時只動相關段落。

## 規則

- Spec 寫在 ADR 與 Task 之間：ADR 決定「為什麼、決定了什麼」，Spec 寫「具體怎麼做」，Task 是其中一件工作。小改動可以跳過 Spec，從 ADR 直接開 Task。
- ADR 是 `accepted` 之後再把 Spec 從 `draft` 推進到 `approved`。Spec 是 `approved` 或 `implemented`、它 implements 的 ADR 卻不是 `accepted` 時，Nodit 會發出 warning。
- `## Scope` 寫涵蓋與不涵蓋的範圍；`## Design` 寫介面、資料結構、流程與邊界條件；`## Acceptance Criteria` 用 `- [ ]` checklist，每一項都要能被驗證。
- `adr_rev` 記錄寫 Spec 時讀到的 ADR 內容指紋：讀 ADR 的當下執行 `nodit rev ADR-001`（devDependency 時用 `npx --no nodit rev ADR-001`），把輸出寫成 `adr_rev: { ADR-001: <輸出> }`。不要自己用 shell 切 frontmatter 計算；指令不可用時省略這個 ADR 的 `adr_rev`，Nodit 會顯示「未記錄 ADR 版本」。
- 不要在寫完 Spec 後才對最新的 ADR 重算：那會把你沒讀過的修改標成已確認。
- Nodit 顯示「ADR 已修改」時：重讀 ADR、檢查差異，必要時調整 Spec，或確認設計不受影響，之後才更新那個 ADR 的 `adr_rev`。不得只為了清除提示就刷新指紋。
- 範圍延續時在原檔修訂。另立替代設計、而且要保留舊 Spec 與既有 Task 的關係時，才新開一份 Spec 寫 `supersedes: [SPEC-001]`，並把舊 Spec 的 `status` 改成 `outdated`。
- `approved` 或 `implemented` 的 Spec 改了 `## Design` 的技術設計時，在回覆裡建議由人把 `status` 退回 `draft` 重新確認；純文字修正不必。不要自己改 `status`。
- 需要開工作時，依 `## Acceptance Criteria` 用 `nodit new task "<標題>" --implements SPEC-001` 建 Task（存放在 `docs/tasks/`）。驗收條件達成後，把對應的 `- [ ]` 改成 `- [x]`。

## 格式

```markdown
---
id: SPEC-003
type: spec
title: SSE 重連與事件補送
status: draft
date: 2026-10-29
implements: [ADR-007]
adr_rev:
  ADR-007: 3f2a9c0e5b1d4a7f8e6c2b9d0a1f3e5c7b9d1f2a
---

## Scope

…

## Design

…

## Acceptance Criteria

- [ ] …
```
