---
name: nodit-task
description: 在這個專案新增或更新工作項目（Task）時使用。依 Nodit 格式寫入 Task 檔案，連結所屬 Milestone、實作的 ADR 與依賴。
# nodit-managed v6
---

# 新增或修改 Task（Nodit 格式）

1. 先確認 `nodit` 指令可用（`command -v nodit`；專案把 Nodit 裝成 devDependency 時改用 `npx --no nodit`）。可用就執行 `nodit new task "<標題>"`，它會印出新卡片的 ID 與路徑。
   - 不要用不帶 `--no` 的 `npx`，它可能從 npm 下載別的套件。指令不可用時，列出 `docs/tasks/` 取最大編號 + 1，照下面的格式手寫。
   - 用 `--milestone MS-0X` 指定所屬里程碑，`--implements ADR-00X` 指定實作的決策，`--depends T-00X` 指定前置工作。
2. 打開新檔案，填寫段落：`## Description`。每個標題只出現一次。
3. 不要修改 `id`；frontmatter 裡不認得的欄位保持原樣。
4. 修改既有卡片時，只改需要改的欄位或段落，不要重排整份檔案。

## 格式

```markdown
---
id: T-012
type: task
title: 加入 SSE 重連
status: todo
priority: medium
milestone: MS-01
implements: [ADR-007]
---

## Description

…

```
