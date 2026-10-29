# 0010 — 從卡片觸發 AI review

- 狀態：Accepted
- 日期：2026-10-29（修訂見文末）
- 延伸：0007 的 review 附屬文件、0003 的寫入協定
- 實作規格：[SPEC-003 job 規格](../specs/0003-review-job.md)

> **結論**
>
> - **做**：Inspector 的 Reviews 區塊加上「請 AI 評估」按鈕，由 server 在本機執行 `claude` CLI。agent 只能讀，review 檔由 server 驗證後寫入。
> - **不做**：不在 ADR 建立時自動觸發；v1 不支援 codex；不直接呼叫 Anthropic／OpenAI API。
> - **前提**：每次執行都由使用者觸發。按鈕在 CSP 與外部連結確認都落地前不得上線。

## 背景

- 0007 之後，請 AI 評估卡片要離開 Nodit：開終端機、輸入 `/nodit-review ADR-009` 或對 Codex 貼一段指令，等它寫完再回 Nodit 看。卡片就在畫面上，卻要切到另一個工具才能啟動評估。
- 使用情境（2026-10-29 使用者確認）：每建立一份新 ADR 就會請 AI 評估一次，主要使用 Claude。
- 0007 已經把 review 的關聯、badge、過期判定都放在 Nodit 端，AI 只負責新增一個檔案。所以「從卡片觸發」只缺「啟動 AI」這一段，不需要改 review 的資料模型。
- 啟動 AI 等於從瀏覽器的一次點擊，在本機起一個能讀程式碼的 agent。權限邊界是這份決策的核心。repo 裡有兩種不可信的內容：
  - 卡片與程式碼可能被寫入針對 agent 的指令（prompt injection）。
  - repo 自帶的 agent 設定（`.claude/settings.json` 的 hooks、`.mcp.json` 的 server）可能直接執行指令。

  按鈕觸發的 agent 不能有寫檔、執行指令或連網的能力，也不能載入 repo 自帶的設定。

## 決策

### 使用者看到的行為

- Inspector 的 Reviews 區塊加上「請 AI 評估」按鈕。PATH 上找不到 `claude` 時，按鈕改為「複製評估指令」，把 `/nodit-review <ID>` 複製到剪貼簿；codex 使用者也走這條路。
- ADR 卡片沒有任何 review 時（不論 status，格式錯誤的不算），按鈕改用主要按鈕樣式，旁邊加一行「這份 ADR 還沒有評估」。這個提示只改變外觀，評估仍然要使用者按下才會執行。有任何一份 review 之後，按鈕回到一般樣式。
- 按鈕旁標示「使用本機 claude 帳號」，job 結果顯示花費估算值。
- 按鈕產生的 review 在使用者第一次打開之前，Inspector 標示「尚未審閱，commit 前先讀過」。

### 由 server 執行本機 agent CLI

- server 以參數陣列 spawn CLI，不經過 shell。env 繼承 Nodit 啟動時的環境，所以登入沿用使用者本機 CLI 的帳號，Nodit 不保存、也不讀取任何 API key。

### agent 唯讀，檔案由 server 寫

這是跟手動 `/nodit-review` 最大的差異：手動流程由 agent 自己算指紋、自己 exclusive create；按鈕流程把這兩件事收回 server，agent 只讀不寫。

| 步驟 | 誰做 |
| --- | --- |
| 解析 target、驗證 ID 存在且唯一 | server |
| 計算 `target_rev`（0007 的整檔 SHA-1 git blob） | server，在 spawn 之前 |
| 讀卡片與相關程式碼、寫評估內容 | agent，唯讀 |
| 驗證輸出、組 frontmatter、exclusive create 寫檔 | server，經 Writer queue |

這個分工提供以下保證，具體旗標與驗證規則見 SPEC-003：

- agent 只有讀檔工具，不能寫檔、執行指令或連網，讀取範圍限制在專案內，`.env` 類檔案不可讀。
- repo 自帶的 settings、hooks、MCP server 都不載入。
- 不得使用 `bypassPermissions`，也不提供設定讓使用者放寬上述任何一項。
- agent 的輸出只決定評估內容與 `verdict`。review 的其他 metadata 由 server 產生；agent 預先勾選的 finding 一律改回未處理。輸出不合格時 job 失敗，不寫任何檔案。
- `target_rev` 在 spawn 前計算。agent 讀到的可能是執行期間的任一版本，所以不宣稱它評估過最新版。

### 前置條件：review 渲染不外洩

- agent 的網路被擋住，不代表 review 正文不會連網。被注入的 agent 可以把讀到的內容放進圖片網址或連結，使用者打開 review 或點擊連結時送出。
- 兩項修補都是前置條件，按鈕在兩者完成前不得上線：
  - app 送出 CSP，禁止載入外部圖片（已於 2026-10-29 落地）。
  - 點擊外部連結前顯示完整網址，使用者確認後才開啟。
- 這兩條外洩路徑手動 review 也有，所以拆成獨立 Task 先落地，範圍是所有渲染 markdown 的地方。

### prompt 與 skill 共用同一份寫作規則

- review 規則分成「寫作規則」（評估要寫什麼）與「手動流程的寫檔規則」（檔案怎麼產生）。寫作規則由 skill 模板與按鈕 prompt 共用，寫檔規則只留在手動流程。按鈕 prompt 另外要求 agent 只輸出評估內容、不嘗試寫檔。

### Job 模型

- job 只存在 server 記憶體，不跨重啟保留；可以取消，狀態透過 SSE 推到前端，重新整理頁面後仍看得到進行中的評估。
- 同一張卡片同時只能有一個 job，全域最多 2 個，超過直接拒絕、不排隊；每個 job 逾時 10 分鐘。
- 專案切換或 server 關閉時，進行中的 job 被取消且不寫檔；正在寫檔的 job 等寫完才釋放資源。

## 替代方案

| 方案 | 不採用的理由 | 重新考慮的條件 |
| --- | --- | --- |
| ADR 建立時自動觸發評估 | 依據是「檔案出現」而不是使用者的操作。`git pull` 拉進別人的 ADR、或 AI 用 `nodit new adr` 建卡，都會在使用者沒看到的情況下執行 agent、消耗額度；權限設計以每次執行都由使用者觸發為前提 | — |
| 直接呼叫 Anthropic／OpenAI API | 要自己管 key，還要在 server 重做讀卡片與相關程式碼的流程，換來的只有少一個外部程式依賴 | — |
| 用 codex 執行 | `--sandbox read-only` 擋住寫入與網路，但能讀整顆硬碟；agent 輸出會被寫進 repo，可讀範圍沒有限制時 review 正文本身就是外洩管道 | codex 能把讀取範圍限制在專案內、並且不載入 repo 自帶設定 |
| agent 自己寫檔（沿用手動流程） | agent 需要寫入權限，被注入時能改任何檔案；也無法保證指紋與 metadata 正確 | — |
| 以路徑規則限制權限（本文件第一版旗標） | 擋得住讀取範圍，但 repo 自帶的 hooks 與 MCP server 照樣執行，Bash 讀取類指令也能繞過 `.env` 的 deny 規則 | — |
| `--bare` 隔離 repo 設定 | 不讀 OAuth 憑證與 keychain，需要 `ANTHROPIC_API_KEY`，違反「不管理 API key」；`--restricted` 已涵蓋它想避開的 repo 設定 | — |
| 超過併發上限時排隊 | 排隊會讓使用者不知道 job 何時開始 | — |

## 驗證摘要

詳細紀錄見文末附錄。

- **權限邊界成立**（附錄 A）：在暫存專案放入 `.env`、指向外部的 symlink、會執行指令的 hook 與 MCP server，SPEC-003 的旗標組合全部擋下；第一版的路徑規則擋不住 hooks、MCP 與 `grep -r`。只在 macOS、claude 2.1.302 驗證過。
- **唯讀不會讓評估變淺**（附錄 B）：兩張卡片各跑按鈕版與手動版，finding 數相同、各有對方沒找到的項目，按鈕版成本約為 1/4–1/2。樣本小，沒測到需要 git 歷史或跑測試的卡片。
- **仍存在的風險**：不符合 `.env*` pattern 的機密檔仍可讀，內容可能進入 review 正文並被 commit。CSP 與連結確認因此是必要條件；「尚未審閱」標示提醒使用者 commit 前先讀。

## 影響

- 新增 server 端的 job registry、兩個 API、一個 SSE 事件，前端在 Inspector 加按鈕與 job 狀態。卡片 badge 不顯示 job 狀態，v1 只在 Inspector 顯示。
- Writer 新增 `createReview`。server 的 `close()` 改成先 `drain`，再取消 job；專案切換流程同樣加上取消 job 的步驟。
- 前置 Task：
  - app 加上 CSP（已於 2026-10-29 落地）。
  - 外部連結開啟前確認完整網址。
  - 兩者都修補手動 review 既有的外洩路徑，按鈕在兩者完成前不得上線。
- Inspector 對按鈕產生、尚未打開過的 review 標示「尚未審閱」。打開過的狀態只記在前端（per-viewer），不寫進 review 檔。
- `core/templates.ts` 依「寫作規則」與「寫檔規則」重新拆分。產生的 skill 與 AGENTS.md 內容不變的話，`TEMPLATE_VERSION` 不需要升級。
- 手動 `/nodit-review` 流程不變，仍由 agent 自己寫檔。兩種流程產出的 review 格式相同，Nodit 不區分來源。
- 按鈕會消耗使用者 CLI 帳號的額度。
- 不在 v1 範圍：
  - 用 codex 執行按鈕評估（理由見「替代方案」）。
  - 多 target 的 review。
  - 指定 model 或 effort；沿用 CLI 自己的預設。
  - 從按鈕觸發「處理 review」（`nodit-review-resolve`）。處理 review 必須修改卡片，需要寫入權限，違反本決策「按鈕觸發的 agent 唯讀」的前提，要另外寫決策。
  - job 歷史、agent 完整 log 與跨重啟的 pid 紀錄。

## 修訂紀錄

- 2026-10-29：處理 `docs/reviews/2026-10-29-0010-review-from-card-review.md` 的 P0、P1。
- 2026-10-29：處理 `docs/reviews/2026-10-29-0010-review-from-card-review-2.md` 的 P1。
- 2026-10-29：結構重整，決策內容不變。開頭加結論；旗標、輸出驗證、寫檔、CSP 落地細節與 job 生命週期移到 SPEC-003；被否決的方案集中到「替代方案」；spike 與品質對照移到附錄。兩份 review 引用的行號以重整前的版本為準。

## 附錄 A：驗證結果（2026-10-29 spike）

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
| C：SPEC-003 的「agent 旗標」 | 未執行 | 拒絕，錯誤訊息標明 `--restricted` | 拒絕 | 工具不存在；可用工具只有 Read、Grep、Glob |

路徑形式：Read 工具只接受絕對路徑，spike 中所有讀取都是以絕對路徑送出；C 組的 `../outside/secret.txt` 也被 `--restricted` 拒絕。

A 組另外測過：project skill 在 `dontAsk` 下被拒絕；Agent tool 可以開 subagent，但 subagent 沿用同樣的權限，它的 Bash 被拒絕。兩者都沒有成為逃逸路徑。C 組的 `--tools` 直接移除了這兩個工具。C 組沿用本機 OAuth 登入正常，耗時 12 秒。

**第三輪：`.env` 規則的錨點**

在 C 組旗標下加入 `sub/.env` 與 `sub/.env.local`，比較三種 deny pattern：`Read(./.env*)`、`Read(.env*)`、`Read(**/.env*)`。三者都拒絕 `.env`、`sub/.env`、`sub/.env.local` 的 Read，也拒絕以 `sub/.env` 為路徑的 Grep；以 `sub` 為路徑的 Grep 沒有搜到內容（ripgrep 預設略過 dotfile）。對照組拿掉 deny 規則後，兩個子目錄檔案都讀得到，證明是 deny 規則擋下的。結論：維持 `Read(./.env*)`，它涵蓋所有深度。

官方文件的對照（查閱日期 2026-10-29）：

- [Run Claude Code programmatically](https://code.claude.com/docs/en/headless)：`-p` 在未信任的資料夾仍執行專案 hooks、連線 `.mcp.json` server，不顯示信任對話框；`--bare` 不讀 OAuth 與 keychain。
- [Configure permissions](https://code.claude.com/docs/en/permissions)：read-only Bash 指令集在所有模式下都不需核准；Read deny 規則不涵蓋 `grep -r` 這類不指名檔案的讀取；allow 規則對 symlink 要求請求路徑與實際路徑都符合。

**結論**

- claude 的權限設計成立，前提是使用 C 組旗標。第一版的路徑規則寫法擋得住讀取範圍，但擋不住 repo 自帶的 hooks 與 MCP server，Bash 讀取類指令也能繞過 `.env` 的 deny 規則。
- codex 的 `--sandbox read-only` 擋住寫入與網路，但能讀整顆硬碟。agent 的輸出會被 server 寫進 repo，可讀範圍沒有限制時，review 正文本身就是外洩管道。v1 因此不支援 codex。之後確認 codex 能把讀取範圍限制在專案內、並且不載入 repo 自帶設定，再另外補充決策。
- 「沿用 CLI 預設 model」可能直接失敗（spike 中 codex 就是如此）。job 失敗時要把 stderr 的最後幾行帶給前端，不能只顯示「失敗」。

**仍存在的限制**

- `.env*` 拒絕規則用檔名比對。不符合 pattern 的機密檔（例如 `config/prod.secrets`）仍在可讀範圍內。這類內容能進入 review 正文，所以「前置條件」的 CSP 是必要條件，不是加強項。
- review 檔會被 git 追蹤。agent 讀到的機密（包括被 `.gitignore` 排除、但不符合 `.env*` pattern 的檔案）只要進了正文，使用者 commit 或 push 時就會外洩，CSP 與連結確認都管不到這條路。對策：按鈕產生的 review 在使用者第一次打開之前，Inspector 標示「尚未審閱，commit 前先讀過」；打開過的狀態只記在前端（per-viewer），不寫進 review 檔。
- C 組只在 macOS、claude 2.1.302 驗證過。`--restricted` 的行為若在新版改變，上述保證就不成立；組參數的測試只能固定參數，固定不了 CLI 行為。

## 附錄 B：品質對照（2026-10-29）

驗證 A2：唯讀 agent 寫出的 review 是否比手動 `/nodit-review` 淺。

**做法**

- 目標：`examples/nodit` 的 ADR-007（已實作，可對照程式碼）與 ADR-009（Proposed，涉及待改的程式碼）。每張卡片跑按鈕版旗標與手動版各一次，共 4 次，同時執行。
- 環境：從 HEAD 匯出，`git init` 成單一 commit 的乾淨資料夾，把 `examples/nodit` 的卡片、config、skills 放到根目錄，讓卡片和程式碼在同一個專案裡。刪掉所有既有 review 與 git 歷史，避免 agent 照抄 ADR-009 的三輪 review。
- 手動版：`claude -p "/nodit-review <ID>" --permission-mode acceptEdits --allowedTools Bash`，可以寫檔與執行指令，並提供 `node_modules`，模擬使用者核准所有操作的互動流程。
- 按鈕版：SPEC-003「agent 旗標」的組合，prompt 只保留寫作規則與輸出格式。
- 兩者都用 CLI 預設 model（實際是 `claude-opus-5-5`），每次 `--max-budget-usd 5`。

**結果**

| | ADR-007 按鈕 | ADR-007 手動 | ADR-009 按鈕 | ADR-009 手動 |
| --- | --- | --- | --- | --- |
| verdict | changes | changes | changes | changes |
| Findings 數 | 6 | 6 | 6 | 6 |
| 引用 `檔案:行號` 的 finding | 2 | 0 | 4 | 0 |
| 耗時 | 44 秒 | 223 秒 | 86 秒 | 133 秒 |
| `total_cost_usd` | $0.21 | $0.77 | $0.43 | $0.90 |
| 越權嘗試（`permission_denials`） | 0 | — | 0 | — |

- 手動版引用檔案時只寫路徑、不寫行號，所以「引用 `檔案:行號`」一欄是 0。這一欄只反映引用格式，不代表手動版沒有讀程式碼。
- 兩邊的 finding 都抽查過，下面這些描述屬實：
  - 按鈕版指出 9 份 ADR 都在 body 寫了狀態行，會讓 0009 的 body 指紋擋不住 proposed → accepted 的誤報，這是兩份 ADR-009 review 中最重要的一條。
  - 手動版指出 `countFindings` 只計第一個 `## Findings`、legacy ADR 的 status 是推測值、ADR-007 引用了不存在的「影響」段落。
- 兩邊各有對方沒找到的 finding，重疊的只有少數幾條（ADR-007 的版本號敘述與重複的狀態行，ADR-009 的 body byte 邊界）。從這兩個樣本看不出哪一邊系統性地比較淺。
- 只有手動版做得到的事，在這次樣本裡只出現一次：執行 `git hash-object -h` 驗證 ADR-007 對 git 版本的說法。其他 finding 都來自讀檔，唯讀版同樣做得到。
- 手動版 ADR-009 有一條「review 檔不存在」的 finding，是因為 spike 刪掉了既有 review，屬於實驗設定造成的誤報，不計入比較。

**結論**

- A2 在這次樣本中沒有被推翻：按鈕版的 finding 數量相同，引用附行號；成本約為手動版的 1/4–1/2，耗時約為 1/5–2/3。
- 限制：
  - 每張卡片只跑一次，樣本只有 2 張卡片，同一個 model，結論不包含隨機變異。
  - spike 拿掉了 git 歷史，ADR-009 也沒有能跑的相關測試，所以 A2 推翻條件裡「需要 git log、需要跑測試」的方向沒有測到。「只有手動版做得到的事只出現一次」只適用於不需要歷史與測試的卡片。
  - 手動版多了算指紋與寫檔的步驟，兩邊的成本與耗時不是同一份工作量。
  - 原先計畫的「與既有人工 review 的重疊度」不適用：那三輪 review 的 findings 已經併入 ADR-009，正確的新 review 本來就不該再找到它們。
- 使用者盲讀（兩張卡片各自打亂順序、去掉 frontmatter）：兩邊內容大致相同，排版上兩張卡片都偏好按鈕版。按鈕版的 Summary 把已核對項目列成條列，較長的 finding 也用子條列拆開選項與驗收。ADR-007 的手動版提到執行過指令，盲讀無法完全遮蔽這個線索。
- 事前估算是 4 次共約 $8，實際是 $2.31。估算高估了每次的輪數與 cache 寫入量，之後的成本估算以這次的實測為基準。

