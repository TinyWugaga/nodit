# 0003 — 以本地專案 docs/ 作為資料來源

- 狀態：Accepted
- 日期：2026-10-21（Proposed 同日；依實作結果修訂後改為 Accepted）
- 取代：0001 中「資料以 localStorage 持久化」的部分

## 背景

Nodit 原本把資料存在瀏覽器 localStorage，跟實際專案脫節。要讓 ADR、Milestone、Task 與程式碼放在同一個 repo，可以進版控、讓 AI 讀寫，並且即時反映在 graph 上。

## 決策

- **執行方式**：本地 CLI server（`nodit [dir]`，預設 port 4319）。
  - 只綁 127.0.0.1，驗證 Host 與 Origin。
  - 寫入需要 token。token 每次啟動時產生，由 server 注入它送出的頁面；開發模式由 Vite plugin 讀取並核對 owner 與 session 後注入。
- **資料來源**：`docs/` 下的 markdown 是唯一真相。
  - 卡片座標存在 `.nodit/layout.json`，可以進版控。
  - `.nodit/writer.lock`、`owner.json`、`token` 是本地狀態，不進版控。
- **格式**：frontmatter 必填 `id`、`type`、`title`、`status`。
  - 關聯寫在來源端：`implements`、`milestone`、`depends`、`supersedes`、`relates`。方向沿用 `shouldReverse`：實作者 → ADR、Task → Milestone、新 ADR → 舊 ADR。
  - `relates` 是無向關聯，存在拉線起點那份文件。讀取時兩個方向去重，並記錄 `storedAt`；刪除時移除每一筆實際存放的紀錄。
  - 受管正文段落：ADR 為 Context / Decision / Consequences，Milestone 為 Goal，Task 為 Description。
  - ID 規則：`ADR-\d{3,}`、`MS-\d{2,}`、`T-\d{3,}`。補零位數只是下限。
- **身分**：文件用 docKey（相對路徑的雜湊）識別，卡片用 ID 識別。raw 編輯、診斷與所有寫入 API 都用 docKey，所以壞掉或 ID 重複的文件也能被唯一定位並修復。
- **寫入協定**：
  - 每份文件的 revision 是原始位元組的 sha1。更新、刪除、連線修改都帶 `baseRevision`，不符就回 409，不寫入。
  - 同一時間只有一個 writer。lock 用 `proper-lockfile`，所有入口共用 `core/owner.ts` 的 `LOCK_OPTIONS`。
  - 過期 lock 不交給 `proper-lockfile` 回收（它的 stat → rmdir → mkdir 會讓兩個程序同時取得）。Nodit 先取得 `.nodit/writer.lock.reclaim`（以 `link` 原子建立，記錄 pid、主機、token），持有期間重查仍過期才刪除。這個回收標記只由持有者自己移除，不論逾時或持有者已結束都不自動接管；回收途中崩潰留下的標記會讓寫入回報 busy，訊息指出檔案位置，需人工確認後刪除（2026-10-21 起）。
  - 收到 `onCompromised` 時停止所有寫入，並透過 SSE 通知 UI。
  - CLI 遇到 server 持有 lock 時，先打 health 並核對 owner 與 session，再改走 API；health 沒有回應就失敗，不接管 lock。
  - 更新時先寫同目錄的暫存檔再 rename；新建時用 `wx`。新卡片的 ID 在寫入佇列內配發：重新掃描磁碟，取最大值 + 1。
- **同步協定**：
  - 所有回應都帶 `{ projectId, sessionId, rev }`。`rev` 在 canonical snapshot 更新完成後才遞增。
  - SSE 每次連線先送 `hello`，補上 snapshot 與訂閱之間的空窗。
  - client 以連線世代（connGen）丟棄過期的 snapshot。EventSource 永久關閉時，client 自己以 backoff 重連。
- **草稿**：
  - 每份文件同時最多一個請求在途。失敗時把送出中的 patch 併回草稿，同一欄位以較新的修改為準。
  - 草稿的 base 不會因外部變更而自動 rebase。唯一的例外是 Nodit 自己的非草稿寫入（例如連線修改）成功之後，草稿會跟著換到新的 revision。
  - 下拉選單、日期、按鈕這類一次性的修改會立刻送出；文字輸入有 400ms debounce。
- **layout**：座標衝突時，以磁碟上的新版本為基礎，套上目前的座標後自動重試一次。座標屬於低風險資料，所以這是唯一會自動合併的寫入。
- **編輯保真度**：
  - 沒有變更時不寫檔。
  - 單一欄位修改只替換該 key 的值的文字範圍，該行的註解、引號樣式與其他位元組都不變。
  - 受管段落只有在標題剛好出現一次、而且不在 code fence 裡時才可以替換；標題缺少或重複時，該段落欄位唯讀，只能透過 raw 編輯修正（依修訂版 4，2026-10-21 修正：原本缺少時會附加在檔尾）。
- **legacy 與無效文件**：唯讀顯示，並附上診斷。只能透過 raw 編輯修復；raw 存檔前會完整驗證，包括解析、schema 與 ID 是否重複，失敗就回 422，不寫入。
- **init**：
  - AGENTS.md 與 CLAUDE.md 各自寫入獨立的 `<!-- nodit:start v1 -->` 區塊，不互相 `@` 匯入。
  - 受管內容的覆寫條件：內容和這次渲染的結果相同，或內容的 hash 等於 `managed` 記錄的基準。其他情況一律判為衝突並跳過。
  - 先寫內容，最後才更新 config 的基準，因此中斷後可以重跑接續。
- **Architecture 頁**：
  - `marked` 渲染後用 DOMPurify 清洗。
  - 卡片代號在 token 層轉成連結，不碰 code 與既有連結。
  - mermaid 用 `securityLevel: 'strict'` 與 `htmlLabels: false`，輸出的 SVG 再用 SVG profile 清洗。

## 已知限制

- 外部編輯器不配合鎖定時，revision 檢查擋不住同時寫入，沒有完全原子的 compare-and-swap。
- `proper-lockfile` 偵測不到兩種情況：有人手動刪除 lock，以及不同 process 使用不同的 stale / update 設定。
- 外部 AI 直接手寫的檔案，只能事後靠重複 ID 診斷發現撞號。
- 修改 `title` 不會改檔名。檔案是用 ID 識別的，所以檔名中的 slug 可能和標題不一致。
- server 重啟後 token 會改變，頁面需要重新整理才能寫入。尚未送出的草稿只存在記憶體裡，重新整理就會遺失。

## 影響

- 開發時需要同時跑 CLI server（`npm run dev:server`）與 Vite（`npm run dev`），由 Vite proxy 轉送 `/api`。
- localStorage 的舊資料不會自動遷移，要先從舊版匯出 JSON，再用 `nodit import` 或 UI 匯入（`core/import.ts`）。
  - 首次匯入只接受已 init、沒有卡片的專案。
  - 完整的對照表與預定輸出會先寫進 `.nodit/import-<sha1>.json`，之後才寫卡片。
  - 續跑必須是同一個 projectId 和同一個輸入 fingerprint。內容和計畫相同的檔案視為已完成；其他不符的情況（被修改、被刪除、ID 被佔用）一律回報衝突並停止。
  - 整個 job 在 writer 佇列內以單一 `exclusive` 執行。
  - 舊代號合法而且不重複時沿用，否則改配下一個編號。
- `nodit` 沒有發布到 npm，要用 `npm link` 安裝。AI 指令檔因此要求先確認 `nodit` 指令存在，並禁止使用 `npx nodit`。
