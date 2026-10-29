---
id: SPEC-001
type: spec
title: AI review 附屬文件與過期判定
status: implemented
date: 2026-10-30
implements: [ADR-007]
adr_rev:
  ADR-007: 12cdacbc576cff3958c808c03f2ab0725f7662d7
---

## Scope

涵蓋：`docs/reviews/` 的解析與驗證、review 與卡片的連結、`target_rev` 過期判定、卡片 badge、Inspector 的 review 列表、review viewer 與狀態切換，以及寫 review、處理 review 的 AI 規則。

不涵蓋：逐 target 狀態、finding 一鍵轉 Task、Tasks 頁 badge、用 raw 編輯器修改 review（ADR-007 列為 v1 範圍外）。

## Design

- **解析**：`core/review.ts` 的 `parseReview(relPath, buf)` 驗證 `type: review`、`target`、`reviewer`、`date`、`verdict`、`status` 與 `target_rev`，格式錯誤時回傳帶 error 診斷的 `ClientReview`，不丟例外。身分用路徑（`docKeyOf`），review 沒有 ID。
- **連結**：`linkReviews(reviews, docs)` 用 `core/targets.ts` 的 `cardResolver` 解析每個 target：
  - 找不到卡片：`missing`，並發出 `review-target-dangling`。
  - 同一個 ID 沒有唯一且有效的檔案：`invalid`。
  - 沒填 `target_rev`：`unrecorded`。
  - 指紋與目前檔案的 SHA-1 git blob hash 相同：`current`，不同：`stale`。
- **變更通知**：ProjectService 把連結後的 reviews 依 path 排序後做 JSON 比對，衍生狀態有差異才遞增 rev，所以只改卡片也會讓 review 的 target 狀態即時更新。
- **前端**：
  - `src/reviews.ts` 的 `countFindings` 用 `marked` lexer 計算 `## Findings` 到下一個 `##` 之間的 checklist（含巢狀，不計 code fence）。
  - `summarizeForCard` 只彙總無錯誤且 `open` 的 reviews，`stale` 只看這張卡片自己的 target。
  - viewer 的狀態按鈕套用到整份 review；有多個 target 時 footer 列出「同時套用到 …」的卡片。
- **寫入**：狀態切換走既有 Writer queue，只改 frontmatter 的 `status` 一行。
- **AI 規則**：AGENTS.md／CLAUDE.md 與 `nodit-review`、`nodit-review-resolve` skill，要求 exclusive create、讀目標檔的當下計算 `target_rev`、修改要求一律寫進 `## Findings`。

## Acceptance Criteria

- [x] `docs/reviews/` 的 review 掛到 `target` 列出的每張卡片，不出現在畫布上
- [x] 目標卡片在評估後被修改時，review 顯示「評估後已修改」
- [x] 沒填 `target_rev` 的 review 顯示「未記錄版本」，不視為仍有效
- [x] 卡片 badge 只計算無錯誤且 `open` 的 reviews，stale 只看這張卡片的 target
- [x] 格式錯誤的 review 在 Inspector 標示「格式錯誤」，不參與 verdict 排序與計數
- [x] `## Findings` 計數包含 `###` 小標底下的項目，不計 code fence 內的 checklist
- [x] 只修改卡片、review 檔沒變時，target 狀態也會即時更新
- [x] 有多個 target 的 review 改狀態時，viewer 列出會一起受影響的卡片
