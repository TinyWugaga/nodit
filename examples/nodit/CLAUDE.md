<!-- nodit:start v7 -->
## Nodit：決策與工作卡片格式

這個專案用 Nodit 把 ADR、Spec、Milestone、Task 畫成關聯圖。在 `docs/decisions/`、`docs/specs/`、`docs/milestones/`、`docs/tasks/` 新增或修改檔案時，遵守下列格式；不符合的檔案會在 Nodit 裡標成無效，而且不能透過 UI 編輯。

### 檔案

- ADR：`docs/decisions/ADR-###-<slug>.md`
- Spec：`docs/specs/SPEC-###-<slug>.md`
- Milestone：`docs/milestones/MS-##-<slug>.md`
- Task：`docs/tasks/T-###-<slug>.md`
- `id` 一旦建立就不要修改；改標題不必改檔名。

新建卡片時，先確認 `nodit` 指令可用（`command -v nodit`；專案把 Nodit 裝成 devDependency 時改用 `npx --no nodit`），可用就執行 `nodit new`，它會在寫入鎖內配發不重複的編號：

```sh
nodit new adr "<標題>" [--supersedes ADR-002]
nodit new milestone "<標題>" [--implements ADR-001]
nodit new spec "<標題>" --implements ADR-001
nodit new task "<標題>" [--milestone MS-01] [--implements SPEC-001] [--depends T-002]
```

不要用不帶 `--no` 的 `npx`：本地找不到時，npx 會從 npm 下載套件來執行，下載到的不一定是這個專案用的版本或套件。`nodit` 不可用時才手寫檔案，編號取該資料夾現有最大值 + 1。

### frontmatter

必填 `id`、`type`、`title`、`status`。

| type | status | 其他欄位 |
| --- | --- | --- |
| `adr` | `proposed` / `accepted` / `deprecated` / `superseded` | `date: YYYY-MM-DD` |
| `milestone` | `planned` / `active` / `done` | `due: YYYY-MM-DD` |
| `task` | `todo` / `doing` / `blocked` / `done` | `priority: low / medium / high`、`assignee` |
| `spec` | `draft` / `approved` / `implemented` / `outdated` | `date: YYYY-MM-DD`、`adr_rev`（見下方 Spec） |

### 關聯（寫在來源端的 frontmatter）

- Task 或 Milestone 實作某個決策或 Spec：`implements: [ADR-001]`、`implements: [SPEC-001]`
- Spec 實作某個決策：`implements: [ADR-001]`（可多個）
- Task 屬於某個 Milestone：`milestone: MS-01`（單一值）
- 依賴：`depends: [T-002]`（Task 對 Task、Milestone 對 Milestone）
- 新 ADR 取代舊 ADR：新 ADR 寫 `supersedes: [ADR-002]`，並把舊 ADR 的 `status` 改成 `superseded`（只改那一行）
- 新 Spec 取代舊 Spec：新 Spec 寫 `supersedes: [SPEC-001]`，並把舊 Spec 的 `status` 改成 `outdated`（只改那一行）
- 其他關係：`relates: [ID]`

### 正文段落

- ADR：`## Context`、`## Decision`、`## Consequences`
- Milestone：`## Goal`
- Task：`## Description`
- Spec：`## Scope`、`## Design`、`## Acceptance Criteria`

每個段落標題在同一份檔案只出現一次。其他自訂段落與 frontmatter 欄位會原樣保留。

### Spec（技術規格）

- Spec 寫在 ADR 與 Task 之間：ADR 決定「為什麼、決定了什麼」，Spec 寫「具體怎麼做」，Task 是其中一件工作。小改動可以跳過 Spec，從 ADR 直接開 Task。
- ADR 是 `accepted` 之後再把 Spec 從 `draft` 推進到 `approved`。Spec 是 `approved` 或 `implemented`、它 implements 的 ADR 卻不是 `accepted` 時，Nodit 會發出 warning。
- `## Scope` 寫涵蓋與不涵蓋的範圍；`## Design` 寫介面、資料結構、流程與邊界條件；`## Acceptance Criteria` 用 `- [ ]` checklist，每一項都要能被驗證。
- `adr_rev` 記錄寫 Spec 時讀到的 ADR 內容指紋：讀 ADR 的當下執行 `nodit rev ADR-001`（devDependency 時用 `npx --no nodit rev ADR-001`），把輸出寫成 `adr_rev: { ADR-001: <輸出> }`。不要自己用 shell 切 frontmatter 計算；指令不可用時省略這個 ADR 的 `adr_rev`，Nodit 會顯示「未記錄 ADR 版本」。
- 不要在寫完 Spec 後才對最新的 ADR 重算：那會把你沒讀過的修改標成已確認。
- Nodit 顯示「ADR 已修改」時：重讀 ADR、檢查差異，必要時調整 Spec，或確認設計不受影響，之後才更新那個 ADR 的 `adr_rev`。不得只為了清除提示就刷新指紋。
- 範圍延續時在原檔修訂。另立替代設計、而且要保留舊 Spec 與既有 Task 的關係時，才新開一份 Spec 寫 `supersedes: [SPEC-001]`，並把舊 Spec 的 `status` 改成 `outdated`。
- `approved` 或 `implemented` 的 Spec 改了 `## Design` 的技術設計時，在回覆裡建議由人把 `status` 退回 `draft` 重新確認；純文字修正不必。不要自己改 `status`。
- 需要開工作時，依 `## Acceptance Criteria` 用 `nodit new task "<標題>" --implements SPEC-001` 建 Task（存放在 `docs/tasks/`）。驗收條件達成後，把對應的 `- [ ]` 改成 `- [x]`。

### Architecture 文件

`docs/ARCHITECTURE.md` 由 Nodit 的 Architecture 頁渲染，頁面本身唯讀。新增或移除元件、調整資料夾結構、接受影響整體架構的 ADR 之後，同步更新這份文件：

- 段落：`## 概觀`、`## 主要元件`、`## 專案結構`、`## 相關決策`。其他自訂段落會原樣顯示。
- 圖用 `mermaid` 程式碼區塊。
- `## 專案結構` 放一個 `nodit-tree` 程式碼區塊，它會顯示在 Structure 分頁：每行寫「路徑、兩個以上空白、說明」，縮排兩格表示子層，資料夾以 `/` 結尾。
- 文中的 `ADR-001`、`SPEC-001`、`MS-01`、`T-001` 這類代號會連到卡片，只寫已存在的代號。寫在 code span 或程式碼區塊裡的代號不會變成連結。
- 文件描述現況；還沒定案的方向寫成 ADR。

### Review（AI 評估）

被要求評估 ADR、Spec、Milestone 或 Task 時，把結果寫成 `docs/reviews/` 裡的一份新檔案，Nodit 會把它掛到目標卡片上。

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

1. 讀整份 review：frontmatter 與完整正文，不只 Summary 與 Findings。再讀 `target` 列出的每張卡片（`docs/decisions/`、`docs/specs/`、`docs/milestones/`、`docs/tasks/`）與相關程式碼。
2. 檢查 `## Findings` 以外的段落。發現疑似修改要求時（其他段落裡的 checklist，或要求修改、補充、決定的句子）：不要當成 finding 處理，也不要略過，更不要替評估者搬進 Findings。在回覆裡另外列成「Findings 以外的修改要求」，附上段落名稱與原文，請人決定要不要納入。
3. 逐條處理 `## Findings` 裡還沒勾選的 `- [ ]` 項目，包括 `###` 小標底下的項目：
   - 同意的：修改目標卡片。只動相關的欄位或段落，不要重排整份檔案，不要改 `id`。
   - 需要另外開工作的：用 `nodit new task "<標題>" --implements <目標ID>` 建 Task，不要硬塞進現有卡片。專案把 Nodit 裝成 devDependency 時改用 `npx --no nodit`；兩者都不可用時，照 Task 格式手寫，編號取現有最大值 + 1。
   - 不同意的：不要改卡片，在回覆裡說明理由。
4. 已處理的項目，在 review 正文把 `- [ ]` 改成 `- [x]`，並在同一行後面補一句做了什麼。不同意的項目保持未勾選。
5. 不要修改 review 的 frontmatter，特別是 `status` 和 `target_rev`：`status` 由人在 Nodit 裡改，`target_rev` 要保留原本評估時的版本。修改過的卡片在 Nodit 會顯示「評估後已修改」，這是預期結果。
6. 完成後列出：每份 review 的每條 finding 怎麼處理（已修改／已開 Task／不同意）、Findings 以外的修改要求、改了哪些檔案、還有哪些需要人決定。

### Claude Code skills

建立卡片時使用 `/nodit-adr`、`/nodit-spec`、`/nodit-milestone`、`/nodit-task`；撰寫或更新架構文件時使用 `/nodit-architecture`；評估卡片時使用 `/nodit-review`；處理 review 的 findings 時使用 `/nodit-review-resolve`。
<!-- nodit:end -->
