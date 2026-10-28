<!-- nodit:start v6 -->
## Nodit：決策與工作卡片格式

這個專案用 Nodit 把 ADR、Milestone、Task 畫成關聯圖。在 `docs/decisions/`、`docs/milestones/`、`docs/tasks/` 新增或修改檔案時，遵守下列格式；不符合的檔案會在 Nodit 裡標成無效，而且不能透過 UI 編輯。

### 檔案

- ADR：`docs/decisions/ADR-###-<slug>.md`
- Milestone：`docs/milestones/MS-##-<slug>.md`
- Task：`docs/tasks/T-###-<slug>.md`
- `id` 一旦建立就不要修改；改標題不必改檔名。

新建卡片時，先確認 `nodit` 指令可用（`command -v nodit`；專案把 Nodit 裝成 devDependency 時改用 `npx --no nodit`），可用就執行 `nodit new`，它會在寫入鎖內配發不重複的編號：

```sh
nodit new adr "<標題>" [--supersedes ADR-002]
nodit new milestone "<標題>" [--implements ADR-001]
nodit new task "<標題>" [--milestone MS-01] [--implements ADR-001] [--depends T-002]
```

不要用不帶 `--no` 的 `npx`：本地找不到時，npx 會從 npm 下載套件來執行，下載到的不一定是這個專案用的版本或套件。`nodit` 不可用時才手寫檔案，編號取該資料夾現有最大值 + 1。

### frontmatter

必填 `id`、`type`、`title`、`status`。

| type | status | 其他欄位 |
| --- | --- | --- |
| `adr` | `proposed` / `accepted` / `deprecated` / `superseded` | `date: YYYY-MM-DD` |
| `milestone` | `planned` / `active` / `done` | `due: YYYY-MM-DD` |
| `task` | `todo` / `doing` / `blocked` / `done` | `priority: low / medium / high`、`assignee` |

### 關聯（寫在來源端的 frontmatter）

- Task 或 Milestone 實作某個決策：`implements: [ADR-001]`
- Task 屬於某個 Milestone：`milestone: MS-01`（單一值）
- 依賴：`depends: [T-002]`（Task 對 Task、Milestone 對 Milestone）
- 新 ADR 取代舊 ADR：新 ADR 寫 `supersedes: [ADR-002]`，並把舊 ADR 的 `status` 改成 `superseded`（只改那一行）
- 其他關係：`relates: [ID]`

### 正文段落

- ADR：`## Context`、`## Decision`、`## Consequences`
- Milestone：`## Goal`
- Task：`## Description`

每個段落標題在同一份檔案只出現一次。其他自訂段落與 frontmatter 欄位會原樣保留。

### Architecture 文件

`docs/ARCHITECTURE.md` 由 Nodit 的 Architecture 頁渲染，頁面本身唯讀。新增或移除元件、調整資料夾結構、接受影響整體架構的 ADR 之後，同步更新這份文件：

- 段落：`## 概觀`、`## 主要元件`、`## 專案結構`、`## 相關決策`。其他自訂段落會原樣顯示。
- 圖用 `mermaid` 程式碼區塊。
- `## 專案結構` 放一個 `nodit-tree` 程式碼區塊，它會顯示在 Structure 分頁：每行寫「路徑、兩個以上空白、說明」，縮排兩格表示子層，資料夾以 `/` 結尾。
- 文中的 `ADR-001`、`MS-01`、`T-001` 這類代號會連到卡片，只寫已存在的代號。寫在 code span 或程式碼區塊裡的代號不會變成連結。
- 文件描述現況；還沒定案的方向寫成 ADR。

### Review（AI 評估）

被要求評估 ADR、Milestone 或 Task 時，把結果寫成 `docs/reviews/` 裡的一份新檔案，Nodit 會把它掛到目標卡片上。

- 檔名：`docs/reviews/<YYYY-MM-DD>-<第一個目標ID>-<reviewer>-<6位hex>.md`，後綴用 `openssl rand -hex 3` 產生。
- 不得覆寫既有 review。用 exclusive create 寫檔：shell 先 `set -C` 再 `cat > "$FILE" <<'EOF'`，或用 `open(path, "x")`；檔案已存在就換後綴重來。
- 讀目標檔的當下就計算它的指紋，寫進 `target_rev`（把 `FILE` 換成目標檔路徑）：

  ```sh
  (printf 'blob %s\0' "$(wc -c < FILE | tr -d ' ')"; cat FILE) | shasum -a 1 | cut -d' ' -f1
  ```

  不要在 review 寫完後對最新檔案重算：那會把你沒讀過的修改標成已評估。只有確定 repo 用 SHA-1 時，才能改用 `git hash-object --no-filters FILE`。
- `status` 一律寫 `open`；之後的處理狀態由人在 Nodit 裡改。評估時不要修改既有的 review。

| 欄位 | 值 |
| --- | --- |
| `type` | `review` |
| `target` | 目標卡片 ID 陣列，例如 `[ADR-001]` |
| `reviewer` | 撰寫者，例如 `codex`、`claude` |
| `date` | `YYYY-MM-DD` |
| `verdict` | `approve` / `changes` / `reject` |
| `status` | `open` / `addressed` / `dismissed` |
| `target_rev` | 選填；`卡片 ID: 指紋` 對照表 |

正文寫 `## Summary`（結論）與 `## Findings`：

- 要求修改、補充或做決定的事項，一律寫成 `## Findings` 底下的 `- [ ]` 項目，不論它是否阻擋其他工作。Nodit 只計算、追蹤 `## Findings` 裡的項目，處理 review 的人也只會逐條處理這些項目。
- 優先序與期限寫在項目開頭，例如 `- [ ] **P1**（期限：ADR 接受前）…`。優先序只決定先後，不決定要不要列成 finding。
- 需要分組時，在 `## Findings` 底下用 `###` 小標，例如「阻擋 P0」「不阻擋 P0」，不要另開 `##` 段落。
- 其他段落只放背景、已解決項目的核對、不需要修改的建議，不能放未列入 Findings 的修改要求。

### 處理 review

被要求處理 review 時：

範圍：指定了 review 檔就處理那一份。只說「處理 review」時，處理 `docs/reviews/` 裡 `status: open`、格式正確、還有未勾選 finding 的 review；指定卡片 ID 時只處理 `target` 含那張卡片的。`addressed`、`dismissed` 的 review 不處理；格式錯誤的 review 不處理，在回覆裡列出路徑。

1. 讀整份 review：frontmatter 與完整正文，不只 Summary 與 Findings。再讀 `target` 列出的每張卡片（`docs/decisions/`、`docs/milestones/`、`docs/tasks/`）與相關程式碼。
2. 檢查 `## Findings` 以外的段落。發現疑似修改要求時（其他段落裡的 checklist，或要求修改、補充、決定的句子）：不要當成 finding 處理，也不要略過，更不要替評估者搬進 Findings。在回覆裡另外列成「Findings 以外的修改要求」，附上段落名稱與原文，請人決定要不要納入。
3. 逐條處理 `## Findings` 裡還沒勾選的 `- [ ]` 項目，包括 `###` 小標底下的項目：
   - 同意的：修改目標卡片。只動相關的欄位或段落，不要重排整份檔案，不要改 `id`。
   - 需要另外開工作的：用 `nodit new task "<標題>" --implements <目標ID>` 建 Task，不要硬塞進現有卡片。專案把 Nodit 裝成 devDependency 時改用 `npx --no nodit`；兩者都不可用時，照 Task 格式手寫，編號取現有最大值 + 1。
   - 不同意的：不要改卡片，在回覆裡說明理由。
4. 已處理的項目，在 review 正文把 `- [ ]` 改成 `- [x]`，並在同一行後面補一句做了什麼。不同意的項目保持未勾選。
5. 不要修改 review 的 frontmatter，特別是 `status` 和 `target_rev`：`status` 由人在 Nodit 裡改，`target_rev` 要保留原本評估時的版本。修改過的卡片在 Nodit 會顯示「評估後已修改」，這是預期結果。
6. 完成後列出：每份 review 的每條 finding 怎麼處理（已修改／已開 Task／不同意）、Findings 以外的修改要求、改了哪些檔案、還有哪些需要人決定。
<!-- nodit:end -->
