---
name: nodit-adr
description: 在這個專案新增、修改或取代架構決策紀錄（ADR）時使用。依 Nodit 格式寫入 ADR 檔案，並處理 supersedes。
# nodit-managed v7
---

# 新增或修改架構決策紀錄（ADR）（Nodit 格式）

1. 先確認 `nodit` 指令可用（`command -v nodit`；專案把 Nodit 裝成 devDependency 時改用 `npx --no nodit`）。可用就執行 `nodit new adr "<標題>"`，它會印出新卡片的 ID 與路徑。
   - 不要用不帶 `--no` 的 `npx`，它可能從 npm 下載別的套件。指令不可用時，列出 `docs/decisions/` 取最大編號 + 1，照下面的格式手寫。
   - 取代舊決策時加 `--supersedes ADR-00X`，完成後把舊 ADR 的 `status` 改成 `superseded`（只改那一行）。
2. 打開新檔案，填寫段落：`## Context`、`## Decision`、`## Consequences`。每個標題只出現一次。
3. 不要修改 `id`；frontmatter 裡不認得的欄位保持原樣。
4. 修改既有卡片時，只改需要改的欄位或段落，不要重排整份檔案。

## 格式

```markdown
---
id: ADR-007
type: adr
title: 以 SSE 推播檔案變更
status: proposed
date: 2026-10-21
supersedes: [ADR-002]
---

## Context

…

## Decision

…

## Consequences

…

```
