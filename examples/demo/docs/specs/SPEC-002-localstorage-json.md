---
id: SPEC-002
type: spec
title: localStorage 持久化與 JSON 匯出匯入
status: implemented
date: 2026-10-06
implements: [ADR-002]
adr_rev:
  ADR-002: 578e0309811f2d59b9bb5bf4d81464a66cd05672
---

## Scope

涵蓋：整份專案寫入 localStorage、重新整理後還原、JSON 匯出與匯入。

不涵蓋：多分頁同步、雲端備份。

## Design

- 以 Zustand `persist` middleware 存放 `nodes`、`edges` 與 `version`，key 為 `nodit:project`。
- 寫入以 300ms debounce，避免拖曳時每個 frame 都序列化。
- 匯出產生 `{ version, nodes, edges }` 的 JSON 檔；匯入先驗證 `version` 與欄位型別，失敗時不覆寫現有資料並顯示錯誤。
- 寫入丟出 `QuotaExceededError` 時保留記憶體中的資料，提示使用者先匯出。

## Acceptance Criteria

- [x] 重新整理後卡片與連線完整還原
- [x] 匯出的 JSON 可以在另一個瀏覽器匯入
- [x] 匯入格式錯誤的檔案時不覆寫現有資料
- [x] 超過容量上限時顯示提示，不遺失記憶體中的資料
