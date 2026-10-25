# Changelog

`@tinywugaga/nodit` 的版本變更紀錄。格式依 [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)，版號規則見 [decision 0008](docs/decisions/0008-versioning-and-changelog.md)：0.x 期間，破壞性變更與新功能都升 minor，修正升 patch；破壞性項目以 **BREAKING** 開頭。

## [Unreleased]

### Added

- AI review：Codex 或 Claude 評估卡片後，結果寫成 `docs/reviews/` 裡的 review 檔，Nodit 會把它掛到目標卡片上。卡片顯示未處理 review 的數量，Inspector 的 Reviews 區塊列出所有 review，viewer 顯示全文並可把整份 review 標記為已處理、略過或重新開啟。
- review 的 `target_rev` 記錄 AI 讀到的卡片內容。卡片在 review 之後被修改時標示「評估後已修改」，沒記錄版本時標示「未記錄版本」。
- Inspector 可以展開到畫布中央；點遮罩或按 Esc 收回側欄。
- 左側欄可以收合成只有 icon 的窄欄，收合時仍可點卡片跳轉。收合狀態會記住。

### Changed

- AI 模板升到 `TEMPLATE_VERSION` 4：AGENTS.md／CLAUDE.md 加入 review 格式規則，並新增 `nodit-review` Claude skill。已 init 的專案重跑 `nodit init` 即可取得。
- `nodit.config.json` 新增選填的 `paths.review`，預設 `docs/reviews`。既有設定檔不需要修改。

### Fixed

- Markdown 裡的 checklist（`- [ ]`、`- [x]`）會顯示勾選狀態。原本 checkbox 會被過濾掉，看不出哪些項目已完成。

## [0.2.0] - 2026-10-23

### Added

- `nodit-architecture` Claude skill，以及 AGENTS.md／CLAUDE.md 的 Architecture 文件規則，教 AI 補完與維護 `docs/ARCHITECTURE.md`（段落、mermaid、`nodit-tree`、卡片代號連結）。

### Changed

- AI 模板升到 `TEMPLATE_VERSION` 3。已 init 的專案重跑 `nodit init` 會升級受管區塊並新增 architecture skill；手動改過的受管內容會列為衝突，不會被覆寫。

## [0.1.1] - 2026-10-23

### Changed

- README 的「發佈」一節改成 tag 觸發的 CI 流程。套件功能與 0.1.0 相同；這是第一個由 CI 以 trusted publishing 發佈、附 provenance 的版本。

## [0.1.0] - 2026-10-23

第一個發佈到 npm 的版本。

### Added

- Graph Canvas：把 `docs/` 裡的 ADR、Milestone、Task 畫成卡片與關聯，可拖曳排版、在 Inspector 編輯，修改以最小 diff 寫回 markdown。檔案被人或 AI 修改時即時更新，並在診斷面板列出格式問題。
- Architecture 頁：渲染 `docs/ARCHITECTURE.md`，支援 mermaid，文中的卡片代號會連到卡片；Structure 分頁顯示可收合的資料夾樹。
- Tasks view：依 status 分欄的看板，可依 milestone、assignee、priority 分組。
- 在 UI 內切換專案：輸入路徑、最近專案、目錄瀏覽。
- 說明手冊面板（`?`）。
- `nodit init`：產生設定檔與資料夾，在 AGENTS.md／CLAUDE.md 加入格式規則，並建立 Claude Code skills（`TEMPLATE_VERSION` 2）。
- `nodit new`：在寫入鎖內配發不重複的卡片編號。
- 匯入舊版 localStorage JSON，可中斷後繼續。
- 寫入鎖：同一個專案只允許一個 Nodit server 寫入。

[Unreleased]: https://github.com/TinyWugaga/nodit/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/TinyWugaga/nodit/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/TinyWugaga/nodit/compare/92c26fd...v0.1.1
[0.1.0]: https://github.com/TinyWugaga/nodit/tree/92c26fd
