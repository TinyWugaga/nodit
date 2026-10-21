# Nodit

把專案 `docs/` 裡的 ADR、Milestone、Task 畫成可編輯的關聯圖。markdown 檔是唯一的資料來源：在 UI 上的修改會以最小 diff 寫回檔案，人或 AI 直接改檔案時，圖也會即時更新。

- **Graph Canvas**：卡片、連線、拖曳排版、Inspector 編輯、診斷面板。
- **Architecture**：渲染 `docs/ARCHITECTURE.md`，支援 mermaid，文中的 `ADR-001`、`MS-01`、`T-001` 會自動連到卡片。
- **init**：產生設定檔與資料夾，並在 AGENTS.md、CLAUDE.md 加入格式規則，另外建立 Claude Code skills，讓 AI 照 Nodit 的格式寫卡片。

## 需求

- Node.js 22.22 以上（檔案監聽用的 chokidar 6 要求這個版本）。

## 安裝

Nodit 沒有發布到 npm，從原始碼安裝：

```bash
npm install
npm run build
npm link
```

`npm run build` 會產生 `dist/`，`nodit` server 就是用它提供 UI。`npm link` 會建立全域的 `nodit` 指令。

> 不要用 `npx nodit`：npm 上不是這個專案，npx 可能會下載到不相干的同名套件。

## 快速開始

```bash
cd your-project
nodit init
nodit
```

打開 http://127.0.0.1:4319 。

`nodit init` 會列出計畫，經你確認後才寫入。它只會新增檔案或附加內容，不會覆寫你的內容。也可以直接在 UI 裡初始化：Sidebar 底部的火箭按鈕，或尚未初始化時頂部橫幅上的「開始 init」。

## 指令

| 指令 | 說明 |
| --- | --- |
| `nodit [dir] [--port 4319]` | 開啟專案，預設是目前目錄 |
| `nodit init [dir] [--no-ai] [--yes] [--dry-run]` | 初始化：`nodit.config.json`、卡片資料夾、`docs/ARCHITECTURE.md`、`.gitignore`，以及 AI 指令檔與 skills（`--no-ai` 時略過） |
| `nodit new <adr\|milestone\|task> "<標題>" [選項]` | 新建卡片並配發不重複的編號 |

`nodit new` 的選項：

- `--dir <path>`：專案目錄。
- `--status <status>`：初始狀態。
- `--implements <ID>`、`--depends <ID>`、`--supersedes <ADR-ID>`、`--relates <ID>`：建立關聯，可以重複指定。
- `--milestone <MS-ID>`：Task 所屬的 milestone。
- `--json`：以 JSON 輸出結果。

`nodit` server 運作中時，`new` 和 `init` 會經由它的 API 寫入；沒有 server 時，CLI 會自己取得寫入鎖再寫入。

## 檔案格式

| 類型 | 預設路徑 | status |
| --- | --- | --- |
| ADR | `docs/decisions/ADR-001-<slug>.md` | proposed / accepted / deprecated / superseded |
| Milestone | `docs/milestones/MS-01-<slug>.md` | planned / active / done |
| Task | `docs/tasks/T-001-<slug>.md` | todo / doing / blocked / done |

```markdown
---
id: T-012
type: task
title: 加入 SSE 重連
status: todo
priority: medium
milestone: MS-01
implements: [ADR-007]
depends: [T-011]
---

## Description

…
```

- 關聯寫在來源端的 frontmatter：`implements`、`milestone`、`depends`、`supersedes`、`relates`。
- 受管段落：ADR 是 `## Context`、`## Decision`、`## Consequences`；Milestone 是 `## Goal`；Task 是 `## Description`。
- 其他自訂欄位與段落都會原樣保留。
- 路徑可以在 `nodit.config.json` 的 `paths` 調整。
- 卡片座標存在 `.nodit/layout.json`，可以進版控。

完整規則在 `nodit init` 寫入的 AGENTS.md 區塊裡。設計決策見 [docs/decisions/0003-local-project-source.md](docs/decisions/0003-local-project-source.md)。

## 安全

- server 只綁 127.0.0.1，會驗證 Host 與 Origin。
- 寫入需要每次啟動時產生的 token，由 server 注入頁面。
- 所有寫入都限制在設定的路徑內，會擋下 `..` 與 symlink 逃逸。
- Architecture 頁的 markdown 和 mermaid 輸出都經過 DOMPurify 清洗。

## 已知限制

- 外部編輯器不參與 Nodit 的寫入鎖。和 UI 同時存同一份檔案時，revision 檢查只能擋下多數情況。
- server 重啟後要重新整理頁面才能寫入；還沒送出的草稿會遺失。
- 修改標題不會改檔名。
- 舊版存在 localStorage 的資料不會自動匯入。

## 開發

```bash
npm run dev:server
```

```bash
npm run dev
```

兩個指令分別在兩個 terminal 執行：`dev:server` 以 `examples/demo` 啟動 CLI server（port 4319），`dev` 啟動 Vite（port 5173），由 Vite 轉送 `/api`。

要改開其他專案，兩邊都要指向同一個路徑（Vite 會從那裡讀取寫入 token）：

```bash
npx tsx server/cli.ts ../my-project --port 4319 --dev-origin http://localhost:5173
```

```bash
NODIT_PROJECT=../my-project npm run dev
```

| 指令 | 用途 |
| --- | --- |
| `npm test` | vitest：解析與寫入保真度、寫入鎖與併發、init、server 安全邊界、XSS |
| `npm run typecheck` | TypeScript 型別檢查 |
| `npm run build` | 型別檢查 + 產生 `dist/` |

```
core/      domain、解析、最小 diff 編輯、寫入佇列、寫入鎖、init、模板
server/    CLI、HTTP + SSE server、專案 snapshot
src/       React UI（React Flow、Zustand）
tests/     vitest
examples/  demo 專案
docs/      本專案自己的決策紀錄
```
