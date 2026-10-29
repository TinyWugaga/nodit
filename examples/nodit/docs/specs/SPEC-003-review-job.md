---
id: SPEC-003
type: spec
title: 從卡片觸發 AI review：job 規格
status: approved
date: 2026-10-29
implements: [ADR-010]
adr_rev:
  ADR-010: 216816d46db71fd7c20bec915bee2f08103cd7b8
---

## Scope

0010 決定了「做什麼、為什麼、保證什麼」，這份 Spec 寫「具體怎麼做」。兩者衝突時以 0010 為準，並回頭修正這份 Spec。

- 涵蓋：agent 的 CLI 旗標、agent 輸出的驗證與合併、review 寫檔、review 渲染的 CSP 與外部連結確認、review 規則的拆分、job 模型與生命週期。
- 不涵蓋：0010「影響」列出的 v1 範圍外項目；手動 `/nodit-review` 流程（沿用 0007）。

## Design

### agent 旗標

```
claude -p <prompt> --restricted --strict-mcp-config --tools Read,Grep,Glob
  --disallowedTools 'Read(./.env*)' --permission-mode dontAsk
  --no-session-persistence --output-format json
```

| 旗標 | 作用 |
| --- | --- |
| `--restricted` | 不載入 user、project、local settings 檔，所以 repo 的 hooks、`env` 區塊、`apiKeyHelper`、allow 規則都不生效；檔案工具限制在工作目錄內，透過 symlink 指向外部也算外部；移除 Bash、WebFetch 等會執行程式的工具 |
| `--strict-mcp-config` | 只連線 `--mcp-config` 指定的 MCP server。這裡不指定，所以 `.mcp.json` 的 server 都不啟動 |
| `--tools Read,Grep,Glob` | 可用工具只有這三個，Agent、Skill、WebSearch 等其他內建工具都不存在 |
| `--disallowedTools 'Read(./.env*)'` | 擋住任何深度的 `.env` 類檔案，例如 `.env`、`sub/.env`、`sub/.env.local`，Read 與指定路徑的 Grep 都會被拒（0010 附錄 A 第三輪） |
| `--permission-mode dontAsk` | 任何需要核准的呼叫直接拒絕，不會卡住等待確認 |

- 參數順序：prompt 必須緊接在 `-p` 之後。`--disallowedTools` 是 variadic 參數，prompt 若接在它後面會被當成規則吃掉，CLI 回報「沒有提供輸入」。
- server 用 `child_process.spawn` 加參數陣列執行，不經過 shell。cwd 是專案根目錄，env 繼承 Nodit 啟動時的環境。

### `target_rev`

- server 在 spawn 前算出指紋，job 結束後再算一次；兩次不同時仍寫入 spawn 前的值。結果是這份 review 一出現就顯示「評估後已修改」，這是保守的正確結果：agent 讀到的可能是任一版本，不能宣稱它評估過最新版。

### 取得輸出

- exit code 非 0 時 job 失敗（官方文件明載執行失敗時 exit 非 0，失敗訊息印在 stdout）。
- exit 0 時，stdout 必須解析成 JSON，而且 `result` 是字串；任一條件不符就 job 失敗。`is_error` 存在且為 true 時同樣算失敗。`is_error` 沒有官方文件，只當額外檢查，不當唯一依據。
- 解析失敗的錯誤訊息附上 `claude --version` 與 stdout、stderr 各自的最後幾行，方便判斷是不是 CLI 改了格式。job 失敗時一律把 stderr 的最後幾行帶給前端，不能只顯示「失敗」。
- `permission_denials` 是陣列且非空時，記在 job 結果裡並顯示在前端，代表 agent 嘗試越權，可能是 prompt injection 的跡象。欄位不存在時略過。
- `total_cost_usd` 存在時帶進 job 結果，讓使用者看到單次花費。官方文件註明這是 client 端估算。

### agent 輸出與合併

- agent 的最後一則訊息是一份 markdown，frontmatter 只有 `verdict`，正文是 `## Summary` 與 `## Findings`。
- frontmatter 合併：
  - agent 輸出的 frontmatter 只採用 `verdict`，而且必須是 `approve`／`changes`／`reject` 其中之一，否則 job 失敗。
  - 其餘欄位一律由 server 產生：`type: review`、`target`、`reviewer: claude`、`date`、`status: open`、`target_rev`。agent frontmatter 裡的其他欄位直接丟棄，丟棄的欄位名記在 job 結果裡。
- 正文檢查：`parseReview` 只驗 frontmatter，server 自己組的 frontmatter 一定會通過，所以正文要另外檢查。
  - 正文必須有 `## Findings` 標題，否則 job 失敗。
  - agent 輸出裡已勾選的 `- [x]`／`- [X]` 一律改回 `- [ ]`。新 review 不可能有已處理的 finding；被注入的 agent 若預先勾選，badge 就會顯示 0 項未處理。改動的數量記在 job 結果裡。
  - 組好的完整內容最後再用 `core/review.ts` 的 `parseReview` 驗證，通過才寫檔。任何一步失敗時 job 失敗、不寫任何檔案，錯誤訊息附上 agent 輸出的開頭。

### 寫檔

- Writer 新增 `createReview(target, text)`，經 Writer queue 執行。
- 檔名沿用 0007 的 `<日期>-<ID>-claude-<6位hex>.md`，用 `wx` 寫入，EEXIST 時換後綴重試。
- 路徑以 `resolveInScope` 限制在 `paths.review`，跟 `updateReviewStatus` 相同。
- `reviewer` 固定是 `claude`，不接受 client 傳入，所以檔名裡沒有任何來自 request 的字串。target ID 先經 server 解析成既有卡片，不直接拼進路徑。

### review 渲染不載入外部資源

- 外洩路徑：review 由瀏覽器渲染（`src/components/ReviewViewer.tsx` 經 `renderMarkdown`），DOMPurify 設定沒有禁 `img`（`src/architecture/render.ts`）。正文裡的 `![](https://外部網址/?d=…)` 在使用者打開 review 時就會送出請求。
- CSP：serveStatic 對 HTML 回應送 `Content-Security-Policy`，至少包含 `img-src 'self' data:`。範圍是整個 app，因為卡片正文與 architecture 頁走同一套 renderer。已落地（2026-10-29），policy 定義在 `server/csp.ts`：
  - **來源盤點**：字型由 fontsource 打包，屬同源；CSS 只用 `data:` SVG；mermaid 在 SVG 內插入 `<style>`，所以 `style-src` 含 `'unsafe-inline'`；沒有外部腳本或 Worker。
  - **dev 模式**：Vite dev 需要 inline script 與 HMR websocket，只套 `img-src`、`media-src` 兩條。
  - **驗收結果**：正式 build 打開含 `http://127.0.0.1:9/leak.png` 的 review，console 回報 `img-src` 違規、請求被擋；Architecture 頁兩張 mermaid 圖正常渲染、沒有其他違規。dev 模式同樣擋下外部圖片，HMR 正常。
- 外部連結：CSP 不管使用者點擊後的導航。`src/components/ReviewViewer.tsx` 對 `http(s)` 連結直接 `window.open`。改成點擊外部連結前顯示完整網址，使用者確認後才開啟。範圍是所有渲染 markdown 的地方（review、卡片正文、Architecture 頁），因為它們共用同一套連結處理。

### review 規則拆分

- 現有的 review 規則分散在兩處：
  - `renderReviewSkill` 的步驟 1–4：步驟 3 是 Findings 規則，步驟 4 是 verdict 的定義。
  - `reviewRules()`：檔名、`set -C`、指紋指令、`status` 寫法，以及完整的 frontmatter 欄位表。
- 抽取前，先把每一條規則標成以下兩類之一：
  - **寫作規則**：評估要寫什麼。包括 Findings 是唯一的修改要求來源、優先序寫在項目開頭、`###` 分組、verdict 的定義，以及「其他段落不放修改要求」。
  - **手動流程的寫檔規則**：檔案怎麼產生。包括檔名、exclusive create、指紋計算、`status` 一律 `open`、frontmatter 欄位表。
- 寫作規則抽成獨立函式，skill 模板與按鈕 prompt 都從這裡產生。寫檔規則只留在手動流程。
- 按鈕 prompt 另外寫明輸出格式（frontmatter 只有 `verdict`），並明講「不要嘗試寫檔，只輸出評估內容」。
- 兩類的區分以規則內容為準，不綁定現在的函式名；實作時函式怎麼拆可以調整。

### Job 模型

- 狀態：`running` → `writing` → `succeeded`，或在任一階段轉為 `failed`／`cancelled`。job 只存在 server 記憶體，不寫檔、不跨重啟保留。
- job registry 掛在 ProjectContext 上，每個 context 一個，跟 `hub`、`writer` 同層。EventHub 建構時注入 registry。
- API：
  - `POST /api/reviews/jobs`，body `{ target }`，回 `202 { jobId }`。走既有的 token 與 session 檢查。
  - `DELETE /api/reviews/jobs/:id` 取消 `running` 的 job。`writing` 階段不可取消，回 409：檔案可能已經寫出，這時標成 `cancelled` 會和磁碟上的結果不一致。
  - job 狀態變化用 SSE 廣播 `review-job` 事件。新連線的 `hello` 除了原本的 envelope，再附上 registry 裡目前所有 job，重新整理頁面後仍看得到進行中的評估。
  - 前端的 SSE 訂閱（`src/data/httpClient.ts`、`src/data/sync.ts`）新增 `review-job` listener，`hello` 處理改為同時讀取 job 清單。
- 限制：
  - 同一張卡片同時只能有一個未結束的 job，重複觸發回 409。
  - 全域同時最多 2 個 job，超過回 429，不排隊。
  - 每個 job 逾時 10 分鐘，逾時視同取消。
- 取消與逾時：
  - 用 `detached: true` spawn，對整個 process group 送 SIGTERM，5 秒後未結束改送 SIGKILL，避免 CLI 的子行程殘留。claude 執行時本身就會帶一個子 node 行程，只殺主行程會留下它。
  - job 是否被取消由 server 自己記錄，不從 exit code 推斷：spike 中 codex 被 SIGTERM 後 exit code 是 0。被標記取消的 job 即使 exit 0 也不寫檔。
- 與專案切換、server 關閉的關係：
  - `running` 階段不計入 `ctx.inflight`。job 可能跑好幾分鐘，計入會卡住切換。
  - `writing` 階段計入 `ctx.inflight`。進入 `writing` 前檢查 `ctx.closing`，已在切換就直接標為 `cancelled`、不寫檔。檢查與 `inflight++` 在同一個同步區段完成，中間不 await。這樣切換流程等 drain 時會等寫入結束，寫入也不會落在已關閉的 context。
  - 登記 job：`POST` 在 await 完 target 解析與 `target_rev` 之後，同步檢查 `ctx.closing`，已在切換就回 503、不 spawn；檢查與登記進 registry 之間不 await。
  - 切換與關閉的順序固定為：
    1. `drain`：設 `closing`，等 `inflight` 歸零。這一步會等到所有進行中的 `POST` 登記完成，也會等 `writing` 的 job 寫完。
    2. 取消 registry 裡所有 `running` 的 job。
    3. 等它們的 process group 結束（最多 SIGKILL 後再等 1 秒）。
    4. 釋放資源：切換時 `closeContext`，關閉時 `hub.close`、`project.stop`、`owner.release`。
  - server 的 `close()` 目前不設 `closing`、也不 `drain`（`server/server.ts` 的 `close`），要改成上面的順序。CLI 收到 SIGINT／SIGTERM 時的 shutdown 會呼叫 `close()`，不需另外處理。Nodit 被 SIGKILL 或當掉時無法清理，detached 的 CLI 會一直跑到自己結束，期間照樣消耗額度；它的輸出沒有人接收，不會寫檔。v1 接受這個限制，不做跨重啟的 pid 紀錄。

## Acceptance Criteria

- [ ] 組參數的函式有測試，固定 prompt 緊接在 `-p` 之後，且旗標與上方「agent 旗標」一致。
- [x] 打開含外部圖片的 review，Network 面板沒有對外請求（CSP，2026-10-29）。
- [ ] 點擊 review、卡片正文、Architecture 頁的外部連結，開啟前顯示完整網址並要求確認。
- [ ] exit 非 0、stdout 不是 JSON、`result` 不是字串、`is_error` 為 true 時 job 失敗，前端看得到 stderr 最後幾行。
- [ ] `verdict` 不在三個允許值內、或正文沒有 `## Findings` 時 job 失敗，不寫任何檔案。
- [ ] agent 輸出的 `- [x]` 寫檔後全部是 `- [ ]`，改動數量出現在 job 結果。
- [ ] agent frontmatter 的其他欄位被丟棄，丟棄的欄位名出現在 job 結果。
- [ ] 目標檔在 job 執行中被修改時，寫入的是 spawn 前的 `target_rev`，review 一出現就顯示「評估後已修改」。
- [ ] 同一張卡片重複觸發回 409；全域第 3 個 job 回 429；`writing` 階段的 `DELETE` 回 409。
- [ ] 取消或逾時後，claude 主行程與子 node 行程都已結束；被取消的 job 即使 exit 0 也不寫檔。
- [ ] 有 `running` job 時切換專案：job 被取消、不寫檔；有 `writing` job 時，切換等寫入完成才 `closeContext`。
- [ ] server `close()` 依「drain → 取消 running job → 等 process group → 釋放資源」的順序執行。
- [ ] 重新整理頁面後，`hello` 帶回進行中的 job，Inspector 仍顯示其狀態。
