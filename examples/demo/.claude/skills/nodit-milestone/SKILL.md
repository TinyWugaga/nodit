---
name: nodit-milestone
description: 在這個專案規劃或更新里程碑（Milestone）時使用。依 Nodit 格式寫入 Milestone 檔案並連結相關 ADR。
# nodit-managed v6
---

# 新增或修改 Milestone（Nodit 格式）

1. 先確認 `nodit` 指令可用（`command -v nodit`；專案把 Nodit 裝成 devDependency 時改用 `npx --no nodit`）。可用就執行 `nodit new milestone "<標題>"`，它會印出新卡片的 ID 與路徑。
   - 不要用不帶 `--no` 的 `npx`，它可能從 npm 下載別的套件。指令不可用時，列出 `docs/milestones/` 取最大編號 + 1，照下面的格式手寫。
   - 這個里程碑實作某些決策時加 `--implements ADR-00X`。
2. 打開新檔案，填寫段落：`## Goal`。每個標題只出現一次。
3. 不要修改 `id`；frontmatter 裡不認得的欄位保持原樣。
4. 修改既有卡片時，只改需要改的欄位或段落，不要重排整份檔案。

## 格式

```markdown
---
id: MS-03
type: milestone
title: 多專案支援
status: planned
due: 2026-12-01
implements: [ADR-005]
---

## Goal

…

```
