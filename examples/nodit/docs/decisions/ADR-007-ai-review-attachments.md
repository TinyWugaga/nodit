---
id: ADR-007
type: adr
title: AI review 以附屬文件掛在卡片上
status: accepted
date: 2026-10-25
---

## Context

- 狀態：Accepted
- 日期：2026-10-25

- 使用者會請 Codex 或 Claude 評估 ADR、Milestone、Task，產出一份 review md。Nodit 原本不認得這類檔案，review 與卡片之間沒有關聯。
- 一張 ADR 改過幾輪就會累積多份 review。如果把 review 畫成節點，結構圖會被雜訊蓋掉。`CardKind` 也用在十幾處 schema 與 UI，新增第四種卡片的改動面很大。

## Decision

- **附屬文件，不是 `CardKind`**：review 放在 `paths.review`（預設 `docs/reviews/`），不上畫布、不參與連線。卡片顯示 badge，Inspector 列出 reviews，viewer 閱讀全文並改狀態。
- **關聯寫在 review 端**：`target: [ID…]`。AI 只新增檔案，不修改被評估的卡片。
- **沒有 ID**：身分用路徑（`docKeyOf`）。檔名 `<日期>-<第一個目標>-<reviewer>-<6位hex>.md`；隨機後綴降低碰撞，不覆寫的保證來自 exclusive create（`set -C` 或 `open(path, 'x')`），不需要 `nodit new` 的編號鎖。
- **過期判定用 SHA-1 git blob hash**：`target_rev` 記錄 AI 讀到的目標內容指紋，Nodit 對目前檔案算同一個值比對。target 狀態分為 current／stale／unrecorded／missing；沒填 `target_rev` 顯示「未記錄版本」，不視為仍有效。
  - 演算法固定為 SHA-1，不隨 repo 的 object format 改變。git 2.55 的 `hash-object` 沒有 `--object-format` 參數，在 SHA-256 repo 內會算出不同值，所以 AI 指令提供不依賴 git 的 shell 指令，只有確定是 SHA-1 repo 時才用 `git hash-object --no-filters`。
  - `target_rev` 必須在讀目標檔時計算。review 寫完後再對最新檔案重算，會把沒審過的修改標成 current。
- **status 套用整份 review**：`open`／`addressed`／`dismissed`，不做逐 target 狀態。viewer 的狀態按鈕是「標記為已處理」「略過整份」「重新開啟整份 review」；review 有多個 target 時，footer 會寫出「同時套用到 …」，列出會一起受影響的卡片。addressed／dismissed 的 review 仍顯示 stale，不自動 reopen。
- **卡片 badge 只看自己**：只彙總無錯誤且 open 的 reviews，stale 只看這張卡片的 target。格式錯誤的 review 在 Inspector 顯示「格式錯誤」，不參與 verdict 排序與計數。
- **Findings 在前端解析**：`marked` 是 devDependency，server bundle 用 `--packages=external`，執行期沒有 marked。server 傳完整正文，前端用 marked lexer 計算 `## Findings` 下的 checklist（含巢狀，不計 code fence 內容）。
- **衍生狀態要觸發變更通知**：卡片修改、刪除、重新建立都會改變 target 狀態，即使 review 檔本身沒變。ProjectService 以連結後的 reviews 整體做 JSON 比對（固定依 path 排序），有差異才遞增 rev。


### 處理 review（2026-10-25 補充）

讓使用者直接說「處理 review」，不用每次重貼流程。規則寫進 AGENTS.md／CLAUDE.md，另外新增 `nodit-review-resolve` Claude skill（`TEMPLATE_VERSION` 5）。

- **範圍**：指定 review 檔就處理那一份。沒指定時，只處理 `status: open`、格式正確、還有未勾選 finding 的 review；指定卡片 ID 時再縮小到 `target` 含那張卡片的 review。
- **分工**：AI 依 finding 修改目標卡片，需要另外做的事用 `nodit new task --implements` 開 Task，不同意的項目只在回覆裡說明。
- **review 檔**：AI 只能勾選正文的 checklist，並在同一行註明做了什麼，不改 frontmatter。`status` 是人對整份 review 的判斷；`target_rev` 記錄評估時讀到的內容，改掉的話就看不出卡片在評估後被修改過。
- 卡片被修改後，review 會顯示「評估後已修改」，這是預期結果。要評估修改後的版本，就另外寫一份新的 review。
- 下方「影響」說的「finding 轉 Task 不在 v1 範圍」，指的是 UI 上的一鍵轉換；透過 AI 開 Task 由這一節涵蓋。


### Findings 是唯一的修改要求來源（2026-10-25 補充）

實際使用時遇到：一份 review 把五項修改要求放在「不阻擋 P0 的文件與模型修正」段落，沒有寫成 finding。處理 review 的規則只讀 Summary 與 Findings，這五項就被漏掉了。兩端都要修正（`TEMPLATE_VERSION` 6）：

- **寫 review**：要求修改、補充或做決定的事項，一律寫成 `## Findings` 底下的 `- [ ]` 項目。是否阻擋其他工作屬於優先序，標在項目開頭（例如 `**P1**（期限：ADR 接受前）`），不決定要不要列成 finding。需要分組時，在 Findings 底下用 `###`；Findings 計數會一路算到下一個 `##` 為止，所以分組不影響計數。其他段落只放背景、已解決項目的核對、不需要修改的建議。
- **處理 review**：讀整份正文，不只 Summary 與 Findings。Findings 以外的疑似修改要求，在回覆裡列成「Findings 以外的修改要求」並附上原文，由人決定要不要納入。AI 不自行處理，也不替評估者把它們搬進 Findings，因為 review 正文的內容屬於評估者。
- 在 viewer 提示「Findings 以外的 checklist」暫時不做：程式只抓得到 checklist，抓不到一般條列或段落裡的要求，主要防線仍是上面兩條規則。

## Consequences

- `TEMPLATE_VERSION` 升為 4：AGENTS.md／CLAUDE.md 加入 Review 規則（Codex 只讀 AGENTS.md，規則必須自給自足），另外新增 `nodit-review` Claude skill。
- 寫入走既有 Writer queue，能擋下 Nodit 內部的並行寫入，以及寫入開始前已發生的外部修改。外部編輯器若剛好在讀取與 rename 之間存檔，仍可能被覆寫；v1 接受這個限制。
- review 不能用 raw 編輯器修改，v1 用外部編輯器改檔。逐 target 狀態、finding 轉 Task、Tasks 頁 badge 都不在 v1 範圍。
