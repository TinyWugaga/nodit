# 0009 — Spec 卡片：ADR 與實作之間的技術規格

- 狀態：Proposed
- 日期：2026-10-26（同日修訂：處理 `docs/reviews/2026-10-26-0009-spec-cards-review.md` 的 7 項 findings；2026-10-29 修訂：處理 `docs/reviews/2026-10-26-0009-spec-cards-review-2.md` 的 2 項 findings；同日再修訂：處理 `docs/reviews/2026-10-29-0009-spec-cards-review-3.md` 的 3 項 findings；同日再修訂：補 `spec-adr-not-accepted` 依 ADR status 區分訊息、`supersede-status` 的收集迴圈、Task 提示的連線種類）
- 延伸：0003 的資料來源與寫入協定、0007 的過期判定

## 背景

- ADR 回答「為什麼、決定了什麼」，Task 回答「做哪一件事」。兩者中間缺「具體怎麼做」：介面、資料結構、邊界條件、驗收條件。現在這些資訊不是塞進 Task 的 `Description`，就是留在 AI 對話裡，對話結束就消失。
- AI 實作時最需要的正是這一層。ADR 太抽象，Task 太零碎，AI 只能每次重新推導設計，同一個 ADR 底下的幾張 Task 也可能各自推導出不一致的設計。
- 0007 決定 review 不做成 `CardKind`，理由是 review 會大量累積、會蓋掉結構圖。Spec 的情況不同：一個 ADR 通常只對應一到兩份 Spec，而且 Spec 本身就是結構的一部分，Task 要連過去。所以 Spec 應該上畫布、參與連線。

## 決策

### 新增 `spec` kind

| 項目 | 值 |
| --- | --- |
| ID | `SPEC-001`（prefix `SPEC-`，pad 3） |
| 預設路徑 | `paths.spec`：`docs/specs` |
| status | `draft` / `approved` / `implemented` / `outdated` |
| 欄位 | `title`、`status`、`date`，以及下方的 `adr_rev` |
| managed sections | `Scope`、`Design`、`Acceptance Criteria` |

- `Scope` 寫這份 Spec 涵蓋與不涵蓋的範圍。`Design` 寫介面、資料結構、流程與邊界條件。`Acceptance Criteria` 用 `- [ ]` checklist，每一項都要能被驗證。
- `outdated` 由人或 AI 設定，表示 Spec 已不反映實作或 ADR。它跟下方「過期判定」是兩件事：過期判定是 Nodit 算出來的，`outdated` 是人做出的判斷。

### Spec 與 Milestone 的分工

- Milestone 管時程與交付範圍：這一階段要交付什麼、何時交付。
- Spec 管技術設計：某個決策具體怎麼實作。
- 兩者不建立包含關係。一個 Milestone 可以涵蓋多份 Spec 的實作，一份 Spec 也可以跨多個 Milestone 才做完。Milestone 可以 `implements` Spec，意思是「這一階段承接這份 Spec 的實作」，不代表這個 Milestone 會完整交付整份 Spec。
- Spec 的完成判斷（見下方「status 只提示」）只計直接 `task implements spec` 的 Task。不計 `relates`，也不經由 Milestone 間接推導，例如不把「Milestone implements Spec、Task 屬於該 Milestone」的 Task 算進去。這樣不論從哪個方向查詢，完成判斷都一致。

### 連線

| 卡片 | 關係 | target |
| --- | --- | --- |
| spec | `implements` | `adr`（可多個） |
| spec | `supersedes` | `spec` |
| spec | `relates` | 全部 kind |
| milestone | `implements` | `adr`、`spec`（原本只有 `adr`） |
| task | `implements` | `adr`、`spec`（原本只有 `adr`） |
| adr、milestone、task | `relates` | 全部 kind，加入 `spec`（原本是 adr、milestone、task） |

- 舊卡片的 Milestone、Task 直接 implements ADR 仍然合法，不需要 migration。小改動可以跳過 Spec，從 ADR 直接開 Task。
- 畫布拉線的推斷（`inferLinkKind`／`shouldReverse`）：

  | 拉線 | 推斷 | 寫在 |
  | --- | --- | --- |
  | task／milestone ↔ spec | `implements` | task／milestone |
  | spec ↔ adr | `implements` | spec |
  | spec ↔ spec | `relates` | 拉線起點 |

  - 目前 `inferLinkKind` 把同 kind 的非 ADR 連線一律推為 `depends`，Spec 沒有 `depends`，所以要把 spec 加入例外，跟 ADR 一樣推為 `relates`。`supersedes` 不推斷，由人在 Inspector 明確選擇。
  - 驗收：四種 kind（adr、milestone、task、spec）兩兩配對、含同 kind 與兩個方向，共 16 種拉線，推斷結果都必須是 `LINK_SCHEMA` 允許的關係。用測試逐一列舉，不靠人工檢查。
- 新 Spec 取代舊 Spec 的規則與 ADR 相同：新 Spec 寫 `supersedes`，舊 Spec 的 `status` 改成 `outdated`。`supersede-status` 診斷目前寫死只看 ADR 與 `superseded`（`core/scan.ts`），兩處都要改：收集 `supersededBy` 的迴圈只收 ADR 的 `supersedes`，要改成收 adr 與 spec；判斷時依 kind 查「被取代時應有的 status」：adr → `superseded`，spec → `outdated`。只改後者時 spec 的 `supersedes` 不會被收集，診斷永遠不觸發。

### 過期判定：ADR body 指紋

**指紋只算 body**

- 0007 的 `target_rev` 對整個檔案計算 SHA-1 git blob，包含 frontmatter。review 評估的是整份檔案，這樣是對的；Spec 依據的是 ADR 的決策內容，整檔計算會產生系統性誤報：
  - ADR 從 `proposed` 改成 `accepted`，在 proposed 期間寫的 draft Spec 會全部變 stale。
  - 畫布上 ADR↔ADR 拉線會把 `relates` 寫進起點 ADR 的 frontmatter；Inspector 連結、改 `date` 也一樣。
  - 搭配下方「不得只為清除 stale 刷新 hash」，每次誤報都要 AI 重讀 ADR 確認，誤報越多，直接刷新的誘因越大。
- 因此 `adr_rev` 改用 body 指紋：對 frontmatter 結束分隔線之後的原始 bytes 計算 SHA-1 git blob（同 `gitBlobHash` 演算法，輸入換成 body）。檔案沒有 frontmatter 時以整個檔案為 body。結果一樣是 40 字元小寫 hex，格式驗證不變。
- ADR 的 status 變化不靠指紋表達：Spec 是 `approved` 或 `implemented`、而 ADR 不是 `accepted` 時，由下方 `spec-adr-not-accepted` 診斷提醒。draft Spec 不提醒，因為它本來就還在等待確認。
- 新增 `nodit rev <ID>` 指令，輸出該卡片的 body 指紋。ID 無法唯一且有效地解析時（見下方 invalid、missing）以非零狀態結束並說明原因，不輸出指紋。`nodit-spec` skill 一律用這個指令取值，不讓 AI 手寫 shell 切 frontmatter。
- review 的 `target_rev` 維持 0007 的整檔計算，不受影響。兩套指紋並存的代價，換來的是 stale 只在 ADR 內容真正改動時出現。這個決定要在接受前定案：`adr_rev` 會寫進每份 Spec，事後換演算法會讓既有紀錄全部變 stale。

**格式**

- Spec 的 frontmatter 加入 `adr_rev: { ADR-xxx: <40 字元小寫 hex> }`，記錄寫 Spec 時讀到的 ADR body 指紋。計算時機照 0007 的 `target_rev`：讀 ADR 時計算，不在寫完 Spec 後重算。
- 只比對 `implements` 指到的 ADR。`relates` 不比對，因為 `relates` 不代表 Spec 依據那份 ADR。
- 驗證規則照 `core/review.ts` 對 `target_rev` 的處理：
  - `adr_rev` 不是 map，或值不是 40 字元小寫 hex：error，與 `review-rev-invalid` 同級。
  - key 不在 `implements` 內：warning，忽略該 key。
  - 沒有 `implements` 任何 ADR：不做過期判定，也不顯示狀態。

**逐 ADR 狀態**

- 每個 implements 的 ADR 各自得到一個狀態，依下列順序判定，前一條成立就不看後面：
  - invalid：目標無法唯一且有效地解析。包括同一 ID 有多個檔案（`id-duplicate`），以及 ADR 檔目前解析失敗（即使 `retainCard` 保留了上一次有效的 card）。不從候選檔任取一份，也不拿保留的舊 card 做判斷；原因由既有診斷說明。
  - missing：ADR 不存在。
  - unrecorded：`adr_rev` 沒有這個 ADR。
  - current：`adr_rev` 與 ADR 目前的 body 指紋相同。
  - stale：不同。
- 卡片彙總顯示最需要處理的一個，順序是 invalid > missing > stale > unrecorded，各用不同文字：「ADR 無法判定」「ADR 不存在」「ADR 已修改」「未記錄 ADR 版本」。全部 current 時不顯示。Inspector 逐 ADR 列出狀態。
- 狀態每次都依目前的檔案重新計算，不保留或還原先前的派生狀態。

**資料流**

- `core/parse.ts` 解析並驗證 `adr_rev`，放進 `CardRecord`。
- 逐 ADR 狀態是跨文件的衍生資料，在 server 計算，模式照 `linkReviews`：新增一個以全部 `ParsedDoc` 為輸入的 linking pass，結果附在 Spec 的 `ClientDoc` 上送到前端。`ParsedDoc` 在 `blob` 之外新增 body 指紋，兩者都留在 server，`toClientDoc` 照舊不送出。`nodit rev` 與 linking pass 共用同一個 body 指紋函式。
- 重算時機與 `linkReviews` 相同：完整掃描、外部修改、UI 寫入、刪除與重新建立。ProjectService 以 JSON 比對結果，有差異才遞增 rev。
- 驗收：
  - 只改 ADR body、不改 Spec 時，Spec 的狀態立即更新。
  - 只改 ADR frontmatter（`status`、`date`、`relates`）時，Spec 維持 current。
  - `nodit rev` 的輸出與 linking pass 對同一檔案算出的指紋相同。
  - 刪除 ADR 後變成 missing。以相同 ID 重新建立後依新 body 指紋重新計算：內容與 `adr_rev` 相同時是 current，不同時是 stale，`adr_rev` 沒有紀錄時維持 unrecorded。
  - ADR 的 ID 重複，或 ADR 檔解析失敗時是 invalid；修復後依上列規則重新判定。
  - 讀取與計算衍生狀態不會改寫 Spec 檔案。
- 「ID → 唯一有效目標或 invalid」的解析抽成共用函式，這個 linking pass 與 `nodit rev` 都用它。

**前置工作：review 目標解析加入 invalid**

- 現有的 `linkReviews` 有同樣的問題：同 ID 只取掃描到的第一筆（`core/review.ts`），也沒有排除解析失敗、只剩保留 card 的目標。
- 修正它會改變 0007 的既有行為：`ReviewTargetState` 加入 `invalid`、review viewer 加對應文字，並在 0007 補註。這是既有 bug，與 Spec 沒有依賴。
- 因此拆成獨立 Task，先於 Spec 落地：先抽出上述共用解析函式並讓 review 改用，Spec 的 linking pass 再直接沿用。不在同一個變更裡同時改 review 既有行為與新增 kind。

**範圍外**

- Spec 被修改後，連到它的 Task 不做過期判定。Task 數量多、修改頻繁，全部標過期會變成雜訊。等實際使用後再評估要不要加。

### 修訂與重新確認

- **ADR 改過、Spec 變成 stale**：AI 重新讀 ADR，檢查差異，必要時調整 Spec 的內容，或確認設計不受影響，之後才更新那個 ADR 的 `adr_rev`。不得只為了清除 stale 就刷新 hash；這樣做等於讓過期判定失效。
- **Spec 原地修訂或新開一份**：
  - 範圍延續時，在原檔修訂。
  - 另立替代設計，而且需要保留舊 Spec 與既有 Task 的關係時，才新開一份 Spec 並寫 `supersedes`。
- **approved／implemented 的 Spec 改了 `Design`**：技術設計有實質變更時，建議由人把 status 退回 `draft`，重新確認。純文字修正不必退回。
- Nodit 不自動改 status。以上規則寫進 AI 指引（AGENTS.md／CLAUDE.md 與 `nodit-spec` skill）。

### Acceptance Criteria 完成度

- 卡片與 Inspector 顯示 `Acceptance Criteria` 的完成計數，例如 `3/5`。section 不存在或沒有 checklist 時不顯示計數。
- 在前端計算。`ClientDoc.sections` 已帶 managed section 全文，直接用 marked lexer 解析 `Acceptance Criteria` 的內容。計數規則與 0007 的 Findings 相同：含巢狀項目，不計 code fence 內的 checklist。`src/reviews.ts` 的 `countTasks` 抽出共用，不另寫一份。
- 勾選由人或 AI 改檔完成，Nodit 只顯示，不提供在卡片上點擊勾選。

### status 只提示，不自動改檔

- Spec 的 `status` 不從 Task 推導，維持「markdown 是唯一真相、人做判斷」。
- Spec 是 `approved`，而且直接 implements 它的 Task 至少一張且全部 `done` 時，Inspector 顯示提示。提示內容依驗收紀錄而定：

  | Acceptance Criteria | 提示 |
  | --- | --- |
  | 全部勾選 | 「相關 Task 已完成；驗收條件 5/5。可考慮標記 implemented」 |
  | 還有未勾 | 「相關 Task 已完成；驗收條件 3/5」 |
  | section 不存在或沒有 checklist | 「相關 Task 已完成；尚無驗收紀錄」 |

- 只有 criteria 全勾時才建議改 `implemented`，提示的強度不超過證據。
- 這只是 UI 提示，不寫入檔案，也不列入診斷面板。

### 流程靠引導，不在 UI 硬擋

Nodit 是文件編輯器，不是 workflow engine。「ADR 確認後才寫 Spec」「Spec 確認後才開 Task」這類順序不在 UI 擋下，改用以下方式引導：

- **`nodit-spec` Claude skill**：引導 AI 讀 ADR、用 `nodit rev` 取得 `adr_rev`、寫 Spec，並在需要時依 `Acceptance Criteria` 開 Task（`nodit new task --implements SPEC-xxx`）。修訂時遵守上方「修訂與重新確認」。
- **診斷 `spec-adr-not-accepted`（warning）**：Spec 的 `status` 是 `approved` 或 `implemented`，但它 implements 的 ADR 不是 `accepted`。訊息依 ADR 的 status 區分，因為兩種情況要做的事不同：
  - `proposed`：「ADR-xxx 尚未確認」。處理方式是等 ADR 確認，或把 Spec 退回 `draft`。
  - `deprecated`／`superseded`：「ADR-xxx 已廢止或被取代，考慮把 Spec 標為 outdated」。處理方式是把 Spec 標為 `outdated`，或改 implements 取代它的 ADR。
  - ADR 是 invalid 時不判斷，避免依據保留的舊 card 誤報或漏報。
  - 這是跨文件診斷，要加入 `server/project.ts` 的 `CROSS_CODES`，ADR 狀態或 Spec 狀態改變後 warning 才會清除。
- **Task 的 Inspector 提示**：Task implements 的 ADR 底下有 `approved` 的 Spec，而 Task 沒有 `implements` 該 ADR 底下的任何 Spec 時，顯示「ADR-xxx 有可參考的 Spec：SPEC-yyy」。只計 `implements`，`relates` 不算，與「完成判斷只計直接 implements」一致。這是給人參考的資訊，不是診斷，因為 Nodit 無法判斷 Spec 的範圍是否涵蓋這張 Task。
- Spec 本身的 `adr_rev` 過期不另開診斷，由過期狀態顯示。

### Review

Spec 可以當 review target。`review-target-invalid` 的 ID 檢查已經用 `kindOfId`，`ID_RULES` 加入 spec 後自動涵蓋 `SPEC-`。`/nodit-review`、`/nodit-review-resolve` 的流程不用改，只需要在規則裡把 Spec 列進可評估的卡片。

## 替代方案

- **把 Spec 寫成 Milestone 或 Task 的一個 section**：不用新增 kind，改動最小。但 Spec 會被綁在單一 Milestone 或 Task 上，多張 Task 共用同一份設計時就得重複貼；也沒辦法對 ADR 做過期判定。不採用。
- **把 Spec 做成像 review 的附屬文件**：避開 `CardKind` 的改動面。但 Task 要能 implements Spec，附屬文件不參與連線，做不到。不採用。
- **把 Spec 設為必經流程**（Task 一定要連 Spec）：一致性最好，但小改動也要先寫 Spec，流程太重，使用者會開始寫空的 Spec 來應付。不採用。
- **`adr_rev` 沿用 0007 的整檔 blob**：只有一套指紋演算法，AI 用既有 shell 指令就能算，不依賴 nodit CLI。但 ADR 只改 status、date 或 relates 也會讓 Spec 變 stale，而且 proposed → accepted 正好落在推薦流程上。誤報會讓「不得只為清除 stale 刷新 hash」的規則難以遵守。不採用。
- **`task-skips-spec` 診斷**（ADR 已有 approved Spec、Task 卻沒連 Spec 時發 warning）：草案原本採用，評估後取消。關聯存在不代表範圍涵蓋：ADR-001 底下有「登入」Spec，「登出」Task 直接 implements ADR-001 是合理的，卻會收到 warning；反過來，Task 只要連到任一不相關的 Spec 就能避開提醒。要消除誤報得新增 scope 模型，只為了支撐一個 warning 不划算。改用上方的 Task Inspector 提示。

## 影響

- `CardKind` 目前在 19 個檔案中被引用（core 8、server 1、src 10）。依 `Record<CardKind, …>` 查表的地方，加入 `spec` 後 TypeScript 會指出缺少的 key。但很多 per-kind 分支用 `kind === 'adr'` 的 if 鏈或寫死的陣列，根本沒引用 `CardKind`，引用數會低估工作量。
- **先讓擴充點變成編譯錯誤**：
  - `src/types.ts` 的 `CardData` union 加入 `SpecData`。
  - per-kind 的 if 鏈改成 `switch` 加 `never` exhaustive check，至少包括：`src/store.ts` 的 card → node 轉換（目前最後一段無條件回傳 `kind: 'task'`，Spec 會被畫成沒有 Description 的 Task）、`src/presentation.ts` 的 `matchesQuery`、`src/components/Inspector.tsx` 的欄位區塊、`src/nodes/CardNodeView.tsx` 的 per-kind 區塊。
  - 寫死的 kind 清單改由 `CARD_KINDS` 衍生：`Inspector.tsx` 的 spawn 按鈕、`src/components/Toolbar.tsx` 的 `KINDS`（`ADD_KEYS` 補上 spec 的快捷鍵）、`src/components/Sidebar.tsx` 的 `SECTIONS`。
  - kind 前綴的正則改由 `ID_RULES` 產生：`core/parse.ts` 的 `inferIdFromFilename` 與 H1 標題剝除（否則 `SPEC-001-login.md` 推不出 ID，`# SPEC-001 — Login` 的 title 會保留前綴），以及 `src/architecture/render.ts` 的 `CARD_RE`、`CARD_START`（否則 Architecture 文件裡的 `SPEC-001` 不會變成連結）。
  - 另外要人工處理 UI 的 kind 顏色與 icon（`KindIcon`、`presentation.ts`），並確認 Tasks view 的 milestone 分組沒有假設只有三種 kind。
- **改完仍無法型別化的擴充點**，編譯通過不代表擴充完整，以下逐項列入驗收：
  - `server/project.ts` 的 `CROSS_CODES` 加入 `spec-adr-not-accepted`，否則問題解決後 warning 會殘留。
  - `inferLinkKind` 的同 kind 分支（見「連線」）。
  - `supersede-status` 的 ADR 寫死判斷（見「連線」）。
  - 規則模板（`core/templates.ts`）裡的路徑、ID 格式表與 `nodit new` 指令範例。
  - 沒有 `paths.spec` 的舊 config 載入後使用預設值。
- `nodit.config.json` 的 `paths` 新增 `spec`。`schemaVersion` 不變。
- `nodit init` 建立 `docs/specs/`。`TEMPLATE_VERSION` 升為 7：AGENTS.md／CLAUDE.md 加入 Spec 格式規則、「ADR 確認後再寫 Spec」的引導與修訂規則，新增 `nodit-spec` skill，`nodit-task` skill 補上 `--implements SPEC-xxx` 的用法。
- `nodit new spec` 子指令：沿用既有的編號鎖。新增 `nodit rev <ID>` 子指令（見「過期判定」）。
- 畫布的視覺階層要重新檢視：四種卡片的顏色與尺寸需要能一眼分辨 ADR 與 Spec，這部分依 0002 的視覺系統另外處理。
