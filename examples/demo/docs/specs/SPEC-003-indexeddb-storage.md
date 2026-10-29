---
id: SPEC-003
type: spec
title: IndexedDB 儲存層與遷移
status: draft
date: 2026-10-19
implements: [ADR-004]
adr_rev:
  ADR-004: edd2d0b319b076c964709ffcb9b41c16b407eb81
---

## Scope

涵蓋：以 IndexedDB 取代 localStorage 作為儲存層，以及既有 localStorage 資料的一次性遷移。

不涵蓋：離線同步、多專案切換（ADR-003 提到的 slice 拆分另案處理）。

## Design

- 儲存層抽成 `Storage` 介面：`load(): Promise<Project | null>`、`save(project): Promise<void>`，localStorage 與 IndexedDB 各一個實作。
- IndexedDB 使用單一 object store `projects`，以專案 ID 為 key；schema 版本號隨資料格式遞增，`onupgradeneeded` 負責升級。
- 啟動時若 IndexedDB 沒有資料、localStorage 有，就搬移一次並保留 localStorage 的副本，直到下一次成功寫入 IndexedDB。
- 載入完成前 canvas 顯示 loading 狀態，不接受編輯。

## Acceptance Criteria

- [ ] 既有 localStorage 專案在第一次啟動時自動搬到 IndexedDB
- [ ] 超過 5MB 的專案可以正常存取
- [ ] 載入期間的編輯操作被擋下，不會被載入結果覆蓋
- [ ] 瀏覽器不支援 IndexedDB 時退回 localStorage
