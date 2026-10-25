# 0008 — 更版原則與 CHANGELOG

- 狀態：Accepted
- 日期：2026-10-25
- 補完：0006「尚未處理」中的「changelog 流程未定」

## 背景

- 0006 定了發佈管道（tag 觸發 CI、版本號以 `package.json` 為準），但沒有定義「改了什麼該升哪一位」，也沒有變更紀錄。0.1.1、0.2.0 的升版理由只寫在 release PR 裡。
- 使用者的 repo 依賴的不只是 CLI。init 寫進他們 repo 的 AI 模板、卡片與 review 的檔案格式、`nodit.config.json`，升級時都可能需要他們採取動作（重跑 `nodit init`、改檔案）。這些都要在版號與變更紀錄上看得出來。

## 決策

### 公開介面

判斷升版位數時，下列項目視為公開介面：

| 介面 | 例子 |
| --- | --- |
| 磁碟上的檔案格式 | 卡片 frontmatter、ID 規則、受管段落、關聯欄位；review 格式；`.nodit/layout.json` |
| `nodit.config.json` | `schemaVersion`（`SCHEMA_VERSION`）、`paths` 等欄位 |
| CLI | `nodit` 的子指令、參數、輸出格式與 exit code（AI 模板會呼叫 `nodit new`） |
| AI 模板 | init 寫入的 AGENTS.md／CLAUDE.md 區塊與 skills（`TEMPLATE_VERSION`） |
| 執行環境 | `engines.node` |

UI 與 server 之間的 HTTP API 不算公開介面：兩者在同一個套件裡發佈，版本一定一致。

### 0.x 期間的升版規則

依 [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html)（2026-10-25 查閱），0.y.z 屬於初始開發階段，第 4 條寫明 "Anything MAY change at any time"。Nodit 在 0.x 期間採用下列規則，讓 `^0.y.z` 的使用者升級時不會碰到破壞性變更：

| 變更 | 升哪一位 | 例子 |
| --- | --- | --- |
| 破壞性變更：既有合法的檔案變成無效、語意改變、CLI 參數移除或改義、提高 `SCHEMA_VERSION`、提高 `engines.node` | minor（0.**y**.0） | 改關聯欄位名稱 |
| 新功能，或使用者需要採取動作的變更：新增 UI 功能、CLI 指令或參數、選填的格式欄位、提高 `TEMPLATE_VERSION` | minor（0.**y**.0） | 0.2.0 新增 `nodit-architecture` skill |
| 修正、文件、效能、內部重構 | patch（0.y.**z**） | 0.1.1 只改 README |

- 破壞性變更與新功能都升 minor。兩者靠 CHANGELOG 區分：破壞性項目以 `**BREAKING**` 開頭，並寫出升級步驟。
- 提高 `TEMPLATE_VERSION` 至少升 minor：使用者要重跑 `nodit init` 才拿得到新模板，CHANGELOG 要寫明。
- 提高 `SCHEMA_VERSION` 一律視為破壞性：舊版 Nodit 讀到較新的 `schemaVersion` 會拒絕整個設定檔（`core/config.ts`）。
- 同一個版本同時有破壞性和非破壞性變更時，照最高等級升版。

### 1.0.0 之後

改用標準 SemVer：破壞性變更升 major、新功能升 minor、修正升 patch。

發 1.0.0 的條件：卡片、review、`nodit.config.json` 的格式與 CLI 宣告穩定，之後的破壞性變更要提供遷移方式。這對應 SemVer FAQ「users depend on a stable API」的建議。發 1.0.0 前另開決策記錄。

### 預發佈版

- 要讓人先試用的破壞性變更，可以先發 `-beta.N`、`-rc.N`。0006 的 dist-tag 規則會讓它們不影響 `latest`。
- 預發佈版在 CHANGELOG 有自己的版本區塊；正式版的區塊要彙整完整內容，不能只寫「同 rc.2」。

### CHANGELOG

- 根目錄的 `CHANGELOG.md`，格式依 [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)（2026-10-25 查閱）：
  - 最上方保留 `## [Unreleased]`。
  - 版本區塊寫成 `## [x.y.z] - YYYY-MM-DD`，日期是 tag 推送、發佈到 npm 的那一天。
  - 分類只用 Added、Changed、Deprecated、Removed、Fixed、Security，標題維持英文，內容用繁體中文。
  - 檔尾放各版本的比較連結。
- **改變使用者可觀察行為的 PR，要在同一個 PR 裡更新 `[Unreleased]`**：UI、CLI、檔案格式、AI 模板、設定、執行需求的變更都算。只動測試、CI、內部重構、本 repo 的決策記錄時不用寫。
- 寫給使用者看：描述行為和要做的事，不寫實作細節，也不寫 commit hash。需要使用者動作的項目要寫明動作，例如「重跑 `nodit init`」。
- 0.1.0 是手動發佈的，沒有 tag，比較連結改指向發佈時的 commit `92c26fd`。

### 發佈流程（補充 0006）

release PR 除了升 `package.json` 的版號，還要：

1. 依本文件的規則，從 `[Unreleased]` 的內容決定升哪一位。
2. 把 `[Unreleased]` 的項目移到新的版本區塊，填上預計推 tag 的日期。
3. 更新檔尾的比較連結：`[Unreleased]` 改成比較新 tag 到 `HEAD`，再新增新版本的連結。

merge 後打 tag 的步驟照 0006。

## 影響

- 版號本身就能看出升級要不要注意。破壞性變更與需要重跑 init 的變更，在 CHANGELOG 裡可以搜尋到。
- 每個功能 PR 多一步寫 CHANGELOG。目前沒有自動檢查。之後若常漏寫，可以讓 `scripts/release-tag.ts` 檢查 CHANGELOG 有沒有對應版本的區塊。
