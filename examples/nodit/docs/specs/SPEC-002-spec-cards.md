---
id: SPEC-002
type: spec
title: Spec 卡片與 ADR 版本追蹤
status: draft
date: 2026-10-30
implements: [ADR-009]
adr_rev:
  ADR-009: dc00e92a22e45a01be1821040a6b74c98a17f62f
---

## Scope

涵蓋：`spec` kind 的格式與連線、`adr_rev` 內容指紋與 ADR 狀態判定、`nodit rev` 指令、相關診斷、畫布與 Inspector 的顯示，以及 `TEMPLATE_VERSION` 7 的 AI 規則與 `nodit-spec` skill。

不涵蓋：Spec 的視覺階層（依 ADR-002 另外處理）、Tasks 頁顯示 Spec、從驗收條件一鍵產生 Task。

## Design

- **kind**：`core/domain.ts` 新增 `spec`。
  - ID 為 `SPEC-`、pad 3，預設路徑 `docs/specs`。
  - status 為 `draft` / `approved` / `implemented` / `outdated`。
  - managed sections 為 Scope、Design、Acceptance Criteria。
  - 舊的 `nodit.config.json` 沒有 `paths.spec` 時，退回預設路徑。
- **連線**：
  - `LINK_SCHEMA` 讓 Spec 可以 implements ADR、supersedes Spec；Task 與 Milestone 可以 implements Spec。
  - `inferLinkKind` / `shouldReverse` 補上 Spec 的推斷規則。
  - supersede 依 `SUPERSEDED_STATUS` 判斷舊卡片該是什麼狀態：ADR 是 `superseded`，Spec 是 `outdated`。
- **指紋**：`core/parse.ts` 的 `bodyBlobHash` 對 frontmatter 之後的位元組算 git blob hash；沒有 frontmatter 時算整份檔案。只改 ADR 的 status 不會讓 Spec 過期。
- **linking pass**：`core/spec.ts` 的 `linkSpecs(docs)` 在 `crossValidate` 最後執行，為每份 Spec 產生 `specAdrs: { id, state, docKey? }[]`：
  - 狀態為 `current` / `stale` / `unrecorded` / `missing` / `invalid`。
  - Spec 是 `approved` 或 `implemented`，而 implements 的 ADR 不是 `accepted` 時，發出 `spec-adr-not-accepted` warning；ADR 無效時跳過。
  - ProjectService 把 diagnostics 與 `specAdrs` 一起比對，只改 ADR 時也會推送更新。
- **驗證**：`adr_rev` 格式或值錯誤時發出 `spec-rev-invalid`（error）；key 不在 implements 裡時發出 `spec-rev-unknown`（warning）。
- **CLI**：`nodit rev <ID>` 印出目前內容指紋；找不到、或同一個 ID 的檔案無法解析時，以非零狀態結束、不輸出指紋。
- **前端**：
  - 卡片顯示驗收條件計數與最嚴重的 ADR 狀態。
  - Inspector 列出每個 ADR 的狀態。相關 Task 都完成時提示驗收進度；Task 實作的 ADR 已有 Spec 時，提示可參考的 Spec。

## Acceptance Criteria

- [x] `nodit new spec "<標題>" --implements ADR-001` 建立 `docs/specs/SPEC-###-<slug>.md`，編號在寫入鎖內配發
- [x] 從 Spec 拉線到 ADR 推斷為 implements，從 Task 拉線到 Spec 也推斷為 implements
- [x] ADR 正文被修改後，Spec 即時顯示「ADR 已修改」；只改 ADR 的 frontmatter 不會
- [x] 沒有 `adr_rev` 的 ADR 顯示「未記錄 ADR 版本」
- [x] `approved` 的 Spec 實作 `proposed` 的 ADR 時出現 warning
- [x] 新 Spec supersedes 舊 Spec，而舊 Spec 不是 `outdated` 時出現 warning
- [x] 既有專案執行 `nodit init` 後升級到 `TEMPLATE_VERSION` 7，並取得 `nodit-spec` skill
