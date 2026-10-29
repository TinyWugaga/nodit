# Nodit

把專案 `docs/` 裡的 ADR、Spec、Milestone、Task 畫成可編輯的關聯圖。markdown 檔是唯一的資料來源：在 UI 上的修改會以最小 diff 寫回檔案，人或 AI 直接改檔案時，圖也會即時更新。

- **Graph Canvas**：卡片、連線、拖曳排版、Inspector 編輯、診斷面板。
- **Architecture**：渲染 `docs/ARCHITECTURE.md`，支援 mermaid，文中的 `ADR-001`、`MS-01`、`T-001` 會自動連到卡片。
- **init**：產生設定檔與資料夾，並在 AGENTS.md、CLAUDE.md 加入格式規則，另外建立 Claude Code skills，讓 AI 照 Nodit 的格式寫卡片，並補完、維護 `docs/ARCHITECTURE.md`（`/nodit-architecture`）。
- **AI review**：請 Codex 或 Claude 評估卡片時，結果寫成 `docs/reviews/` 裡的 review 檔（`/nodit-review`）；之後直接說「處理 review」，AI 會依未勾選的 findings 修改卡片或開 Task，並勾選已處理的項目（`/nodit-review-resolve`）。Nodit 會把它掛到目標卡片上：卡片顯示未處理數量，Inspector 列出 reviews，可以閱讀全文、標記整份已處理；目標卡片在 review 後被修改時會標示過期。

## 需求

- Node.js 22.22 以上（檔案監聽用的 chokidar 6 要求這個版本）。

## 安裝

npm 套件名稱是 `@tinywugaga/nodit`，安裝後的指令是 `nodit`。

```bash
npm install -g @tinywugaga/nodit
```

也可以裝成專案的 devDependency，讓整個團隊用同一個版本：

```bash
npm install -D @tinywugaga/nodit
npx --no nodit
```

> 用 npx 時一律加 `--no`：它只執行專案裡已安裝的版本。不加的話，本地找不到時 npx 會從 npm 下載套件來執行。

### 從原始碼安裝

開發 Nodit 本身，或套件還沒發佈時：

```bash
npm install
npm run build
npm link
```

`npm run build` 會產生 `dist/`（UI）與 `dist-server/`（CLI 與 server），`npm link` 會建立全域的 `nodit` 指令。

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
| `nodit new <adr\|milestone\|task\|spec> "<標題>" [選項]` | 新建卡片並配發不重複的編號 |
| `nodit rev <ID> [--dir <path>]` | 輸出卡片 body（frontmatter 之後）的指紋，寫進 Spec 的 `adr_rev` |
| `nodit import <file.json> [dir]` | 匯入舊版 localStorage 匯出的 JSON |
| `nodit --version`、`nodit -v` | 顯示版本 |

不認得的參數、多餘的參數、不存在的目錄都會直接報錯，不會啟動 server。

`nodit new` 的選項：

- `--dir <path>`：專案目錄。
- `--status <status>`：初始狀態。
- `--implements <ID>`、`--depends <ID>`、`--supersedes <ID>`、`--relates <ID>`：建立關聯，可以重複指定。
- `--milestone <MS-ID>`：Task 所屬的 milestone。
- `--json`：以 JSON 輸出結果。

`nodit` server 運作中時，`new`、`init` 和 `import` 會經由它的 API 寫入；沒有 server 時，CLI 會自己取得寫入鎖再寫入。

### 匯入舊版資料

舊版 Nodit 把資料存在瀏覽器 localStorage 的 `nodit:project`。在舊版頁面用 Header 的封存按鈕下載 JSON 後，用下列任一種方式匯入：

- CLI：`nodit import nodit-legacy-localstorage.json`。
- UI：按 Header 匯出按鈕旁的上傳按鈕，選擇同一個檔案。

規則：

- 首次匯入只能在已經 init、而且還沒有任何卡片的專案進行。
- 寫入卡片前，會先把「舊 UUID → 新 ID」對照表和每份預定輸出存到 `.nodit/import-<sha1>.json`。
- 舊卡片代號合法而且不重複時會沿用原代號，否則改配下一個編號。關聯依新格式的方向寫回來源端；不合規則的關聯會改存為 `relates`。座標會併入 `.nodit/layout.json`。
- 中斷後用同一個檔案重跑即可續跑。已經寫好的卡片會直接沿用，不會重新配發 ID。
- 如果中斷後有人修改、刪除已匯入的卡片，或預定 ID 被別的卡片佔用，續跑會列出衝突並停止，不覆寫任何檔案。這時要先把檔案改回對照表裡的預定內容，或改成手動完成剩下的部分。

## 檔案格式

| 類型 | 預設路徑 | status |
| --- | --- | --- |
| ADR | `docs/decisions/ADR-001-<slug>.md` | proposed / accepted / deprecated / superseded |
| Milestone | `docs/milestones/MS-01-<slug>.md` | planned / active / done |
| Task | `docs/tasks/T-001-<slug>.md` | todo / doing / blocked / done |
| Spec | `docs/specs/SPEC-001-<slug>.md` | draft / approved / implemented / outdated |

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
- 受管段落：ADR 是 `## Context`、`## Decision`、`## Consequences`；Milestone 是 `## Goal`；Task 是 `## Description`；Spec 是 `## Scope`、`## Design`、`## Acceptance Criteria`。
- Spec 的 `adr_rev` 記錄撰寫時讀到的 ADR 內容指紋（只算 body，不含 frontmatter）。ADR 內文之後被修改時，Spec 卡片會顯示「ADR 已修改」。設計見 [docs/decisions/0009-spec-cards.md](docs/decisions/0009-spec-cards.md)。
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
- 舊版存在 localStorage 的資料不會自動匯入，要先匯出 JSON 再用 `nodit import` 匯入。
- Nodit 非正常結束（崩潰、`kill -9`、斷電）後，寫入鎖不會自動回收，之後的寫入會回報鎖已過期。復原方式：停止這個專案的所有 Nodit 程序（server、CLI，以及會呼叫 `nodit` 的 AI 工具），確認復原完成前不會再啟動，再手動刪除 `.nodit/writer.lock`、`.nodit/owner.json`、`.nodit/token`。

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
| `npm run build` | 型別檢查 + 產生 `dist/` 與 `dist-server/` |
| `npx tsx scripts/release-tag.ts v<版本號>` | 檢查 tag 是否可以發佈（CI 發佈前也會跑） |

```
core/      domain、解析、最小 diff 編輯、寫入佇列、寫入鎖、init、模板
server/    CLI、HTTP + SSE server、專案 snapshot
src/       React UI（React Flow、Zustand）
tests/     vitest
examples/  demo 專案
docs/      本專案自己的決策紀錄
```

### 發佈

升哪一位版號、什麼變更要寫進 [CHANGELOG](CHANGELOG.md)，依 [decision 0008](docs/decisions/0008-versioning-and-changelog.md)：0.x 期間破壞性變更與新功能升 minor，修正升 patch。改變使用者可觀察行為的 PR，要在同一個 PR 裡更新 CHANGELOG 的 `[Unreleased]`。

推送 `v<版本號>` 格式的 tag，就會觸發 `.github/workflows/publish.yml` 自動發佈到 npm。CI 透過 [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) 以 GitHub OIDC 驗證，GitHub 上不存放 npm token，provenance 也會自動產生。

1. 開一個 PR 升版號（不建立 tag），merge 進 `main`。同一個 PR 要把 CHANGELOG 的 `[Unreleased]` 移到新版本區塊、填上日期，並更新檔尾的比較連結：

   ```bash
   npm version minor --no-git-tag-version
   ```

2. 在 `main` 的最新 commit 上打 tag 並推送：

   ```bash
   git checkout main && git pull
   git tag v0.1.1
   git push origin v0.1.1
   ```

CI 會依序檢查以下條件，任何一項不符合就停止，不會發佈：

- tag 是 `v` 加上合法的 semver，例如 `v1.2.3`、`v1.2.3-beta.1`；不接受 `+build` metadata。
- tag 的版本號等於 `package.json` 的 `version`。
- tag 指向的 commit 在 `main` 上。
- 正式版要比 npm 上目前的 `latest` 新。
- `npm run typecheck` 與 `npm test` 都通過。

正式版以 `latest` 發佈。預發佈版以第一個識別字當 dist-tag，例如 `v1.0.0-beta.1` 發成 `beta`，所以不會影響一般使用者安裝到的版本。

`npm pack` 與 `npm publish` 會先經由 `prepack` 跑 `npm run build`。套件只包含 `bin/`、`dist/`、`dist-server/`；執行期依賴只有 `chokidar`、`proper-lockfile`、`yaml`，UI 用到的套件都已打包進 `dist/`。發佈前可以先看檔案清單：

```bash
npm pack --dry-run
```

## 授權

[MIT](LICENSE)
