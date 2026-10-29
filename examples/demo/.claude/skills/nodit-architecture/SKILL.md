---
name: nodit-architecture
description: 在這個專案撰寫、補完或更新架構文件（docs/ARCHITECTURE.md）時使用，包括 nodit init 之後填寫骨架，以及新增元件、調整資料夾結構、接受 ADR 之後同步文件。依 Nodit Architecture 頁的格式寫 mermaid、nodit-tree 與卡片代號。
# nodit-managed v7
---

# 撰寫或更新架構文件（Nodit 格式）

`docs/ARCHITECTURE.md` 是 Nodit Architecture 頁的唯一來源；頁面本身唯讀，內容只能改這份檔案。

1. 先讀程式碼的進入點、主要資料夾與設定檔，再讀 `docs/decisions/` 裡 `accepted` 的 ADR。元件職責以程式碼為準，不要只憑檔名推測。
2. 依下面的段落補完或更新。init 產生的骨架佔位內容（例如 `UI --> API --> Storage`、`src/  …`）要換成實際內容，不要留著。
3. 提到決策、規格、里程碑、工作時寫卡片代號（`ADR-001`、`SPEC-001`、`MS-01`、`T-001`），Nodit 會把它們連到卡片。只寫 `docs/decisions/`、`docs/specs/`、`docs/milestones/`、`docs/tasks/` 裡已存在的代號；寫在 code span 或程式碼區塊裡的代號不會變成連結。
4. 修改既有文件時只動相關段落，保留使用者自訂的段落與內容，不要重排整份檔案。
5. 文件描述現況。還沒定案的方向用 `/nodit-adr` 寫成 ADR，不要寫進架構文件當成事實。

## 段落

- `## 概觀`：一兩段說明系統做什麼、資料怎麼流動，附上關鍵決策的 ADR 代號。
- `## 主要元件`：一張 `mermaid` 的 `flowchart` 畫出元件與依賴方向；需要時加一張「元件｜職責｜相關卡片」表格，重要流程可以再用 `sequenceDiagram`。
- `## 專案結構`：一個 `nodit-tree` 程式碼區塊，顯示在 Architecture 頁的 Structure 分頁。
- `## 相關決策`：列出影響整體架構的 ADR 代號，各附一句說明。

## nodit-tree 格式

- 每行寫「路徑、兩個以上空白（或 tab）、說明」。說明可以省略，也可以寫卡片代號。
- 縮排兩格表示子層，資料夾以 `/` 結尾。
- 只列主要資料夾與關鍵檔案，讓人知道東西該去哪裡找；不要列出整棵檔案樹。

````markdown
## 專案結構

```nodit-tree
src/                 瀏覽器 UI
  components/        共用元件
  main.tsx           進入點
server/              本地 API，決策見 ADR-003
docs/                ADR、Milestone、Task 卡片與本文件
```
````
