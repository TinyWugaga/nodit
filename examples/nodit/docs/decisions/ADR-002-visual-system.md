---
id: ADR-002
type: adr
title: 視覺系統對齊參考稿
status: accepted
date: 2026-10-20
---

## Context

- 狀態：Accepted
- 日期：2026-10-20

使用者提供了一份 dark-first 的 dashboard 參考稿（Tailwind 靜態 HTML）。參考稿的色票是 `#22223b #4a4e69 #9a8c98 #c9ada7 #f2e9e4`，與原本指定的不同，經確認後只採用結構與元件，不改色票。

## Decision

- **色票**：維持 `#d8e2dc #ffe5d9 #ffcad4 #f4acb7 #9d8189`。
  - 深色分層（lowest → highest）由 mauve 推導。
  - 深色改為預設主題，淺色保留。
- **卡片類型配色重新對應**：ADR 用 rose、Milestone 用 peach、Task 用 sage。原本 Milestone 用 mauve，但在深色模式下會跟次要文字撞色，所以改掉。
- **字型**：Geist（標題）、Inter（內文）、JetBrains Mono（代號與 label-caps）。
- **規格**：圓角 2 / 4 / 8 / 12px，間距 4 / 8 / 12 / 20 / 32px，與參考稿一致。
- **版面**：
  - 左側 Sidebar 依類型列出卡片，同時套用搜尋過濾。
  - Header 放 breadcrumb、`⌘K` 搜尋，以及匯出／匯入。
  - 左下浮動工具列：select / hand 模式、Add Node 選單、縮放。
  - 右下 Overview 迷你地圖。
  - 右側全高 Inspector drawer。
- **連線**：
  - 用虛線樣式區分關係類型。
  - `implements` 與選取中的連線加 glow。
  - `implements`、`part-of`、`depends` 三種連線帶流動粒子（`animateMotion`），reduced-motion 時隱藏。


### 不採用

參考稿中沒有對應功能的元件不做：Decision Matrix / Timeline 分頁、分享、使用者頭像、討論串。


### 修訂（2026-10-20）：HUD 元件語言

依使用者提供的 sci-fi HUD 參考圖調整：

- **元件語言**：
  - 切角外框（`Frame`，雙層結構：外層 glow、內層 clip-path），避免連線 handle 被切掉。
  - 反白斜切標籤，用在卡片代號、區段標題和類型標籤。
  - 帶端點的引導線（`Rule`）。
  - 狀態點陣（`StatusDots`，依 `STATUS_RANK` 顯示階段）。
  - 10 格分段儀表，以及 Blocked 用的警示斜紋。
- **Inspector 標頭**改成銘牌樣式：三角楔形、48px 編號、反白標題條、斜紋狀態塊。
- **深色背景調亮**：canvas 從 `#201a1d` 調到 `#302a2d`，各層等幅提高。
- **字級整體放大**：內文 13 → 14、mono 12 → 13、label 11 → 12、卡片標題 15 → 17。卡片寬度 300 → 320。

## Consequences

