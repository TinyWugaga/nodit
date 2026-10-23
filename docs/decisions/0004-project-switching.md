# 0004 — 在 UI 內切換本地專案

- 狀態：Accepted
- 日期：2026-10-22（Proposed 同日；依實作結果補上「實作細節」後改為 Accepted）
- 延伸：0003 的本地 CLI server 架構

## 背景

一個 Nodit server 只服務啟動時指定的目錄。要開別的專案，只能另起 server 並指定不同 port。使用者希望能在 UI 裡直接選擇本地 repo。

評估過的做法（查閱日期 2026-10-22）：

- **桌面應用（Electron、Tauri）**：可用原生資料夾對話框，但需要打包、簽章、更新。只為了選 repo，不值得導入。如果日後要「下載後直接點開」、要管理背景程序，再重新評估。
- **瀏覽器直接讀寫（File System Access API）**：`showDirectoryPicker` 只有桌面 Chrome／Edge 86+ 支援，Firefox、Safari 不支援（[MDN browser-compat-data](https://github.com/mdn/browser-compat-data/blob/main/api/Window.json)）。Chrome 122 起有持續授權（[Chrome 官方說明](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)），但檔案監聽用的 `FileSystemObserver` 仍是實驗性、非標準 API（[MDN](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemObserver)）。這條路也等於放棄 server 端的監聽、寫入鎖與最小 diff 寫入。
- **本地 server 提供切換**：符合現有架構，因為 `ProjectService`、`Writer`、`EventHub` 都在 server 端建立。這裡的「本地」指的是 server 所在的電腦。

## 決策

保留本地 server，先做「單一專案切換」：一個 server 同一時間只開一個專案，UI 可以切到另一個專案。暫時不做多專案並存，不引入桌面應用，也不改成瀏覽器直接讀寫。

### 範圍

- 輸入路徑開啟專案。
- 最近開過的專案清單，存在 `~/.nodit/recent.json`。這是跨專案的使用者狀態，不放進任何專案的 `.nodit/`。
- 簡單的目錄瀏覽，只能在可瀏覽的根目錄底下逐層進入。

### 切換流程

順序是先準備好新的、再拆掉舊的。新專案開啟失敗時，舊專案必須保持可用。

1. 驗證新路徑：必須存在、是目錄，而且在可瀏覽的根目錄內。解析 symlink 後再檢查一次，不能越界。
2. 取得新專案的寫入鎖，完成 `ProjectService` 初始化。這一步失敗就回報錯誤，舊專案不受影響。
3. 暫停舊專案的新寫入，等目前進行中的寫入完成。
4. 換掉整組服務：`ProjectService`、`Writer`、`EventHub`、owner 與 token。
5. 釋放舊專案的寫入鎖與檔案監聽。

### 必要條件

- **跨頁籤隔離**：A 頁籤切換專案後，B 頁籤原本的表單絕對不能寫進新專案。
  - token 跟著寫入鎖產生，切換後舊 token 會失效，這是第一層防護。
  - 寫入請求要另外帶 `sessionId`，server 比對不符就拒絕，不能只靠 token。
  - 發起切換的頁籤要從切換回應取得新 token；其他頁籤收到 SSE 通知後，要重新載入或明確提示專案已切換。
- **切換失敗可復原**：上面第 2 步之前任何一步失敗，都必須維持舊專案的狀態。
- **目錄瀏覽 API 的安全性**：
  - 目前非 GET 的 API 才驗 token（`server/server.ts` 的 `handle`）。目錄瀏覽與切換的 API 不分 method，一律要驗 token。
  - 可瀏覽的根目錄預設為使用者家目錄（`os.homedir()`），不能預設暴露整台電腦的目錄結構。repo 通常不會都放在同一個上層資料夾，所以不用啟動目錄的上一層。
  - 沿用 loopback、Host、Origin 檢查。

## 實作細節（2026-10-22）

- **可替換的參照**：`server/server.ts` 把 `ProjectService`、`Owner`、`Writer`、`EventHub`、init 計畫收成一個 `ProjectContext`，`current` 指向目前的那一組。每個請求開頭取一次 `current`，整個請求只用這一組，不會中途混用兩個專案。`RunningServer.owner`／`project` 改成 getter，永遠回傳目前的專案。
- **暫停與等待**：非 GET 的請求進入時計數（`inflight`），結束時遞減。切換時先設 `closing`，之後的寫入回 503（`code: switching`），再等計數歸零才替換。切換請求本身不計數，同時只允許一個切換（其餘回 409 `switch-busy`）。
- **sessionId**：寫入請求帶 `X-Nodit-Session`，缺少或不符回 412（`code: session-mismatch`），切換 API 也一樣。client 送出的是「目前畫面這份 snapshot」的 sessionId，由 `ProjectSync` 套用 snapshot 時綁定，不跟著 SSE 的 hello 自動換。
- **其他頁籤怎麼知道切換了**：
  - 舊的 `EventHub` 關閉前廣播 `project-switched`，內容是新專案的 `{ projectId, sessionId, name }`。
  - snapshot 新增 `root`（realpath）。tab 綁定第一次載入的 root；之後只要 server 回的 root 不同，就停止同步、不套用，並顯示「專案已切換」對話框，只能重新載入。用 root 而不是 projectId 判斷，因為 init 會把 projectId 從預設值換成設定檔裡的值。
  - 同一個 root 但 sessionId 不同（server 重啟）維持原本行為：重新抓取並顯示，寫入仍會因 token 不符被拒。
  - 發起切換的頁籤在請求期間暫存收到的切換通知；拿到回應後用回應裡的 token 與 snapshot 重置畫面（清掉草稿與未存的座標），若通知指向的不是自己切到的 session，代表別的頁籤又切了一次，照樣顯示提示。
  - `DraftManager.clear()` 會讓清除前送出的請求回應全部作廢，避免舊專案的回應落到新專案同一個 docKey 的草稿上。
- **開發模式的 token**：Vite plugin 先打 `/api/health` 取得目前開著的 `root`，核對 `owner.json` 的 ownerId 與 sessionId 都和 health 一致才注入 token；health 沒有回應時才退回 `NODIT_PROJECT`。為此 health 回應多了 `root`。health 只綁 loopback 且有 Host／Origin 檢查，跨來源網頁讀不到回應。
- **需要 token 的 GET**：`/api/fs/list`、`/api/projects/recent`。
- **目錄瀏覽**：只列子資料夾，不列以 `.` 開頭的項目，最多 500 筆。symlink 項目解析後仍在根目錄內才列出。輸入路徑先做字面檢查（接受 browse root 本身或其 realpath 底下），解析 symlink 後再檢查一次。支援 `~` 開頭，其餘必須是絕對路徑。
- **CLI**：`nodit [dir] --browse-root <path>` 可以改可瀏覽的根目錄，預設 `os.homedir()`。`~/.nodit/recent.json` 只有 CLI 會傳入；直接呼叫 `start()`（例如測試）不讀也不寫最近清單。最近清單寫入失敗只記 log，不影響開啟專案。CLI 改走 API 時也會帶 `X-Nodit-Session`。

## 後果

- 使用者不必再為每個專案開一個 server 和 port。
- server 從「啟動時固定一個專案」變成可以替換專案。`server.ts` 裡直接取用 `project`、`writer`、`owner` 的閉包，要改成透過一個可替換的參照存取。
- 想同時看兩個專案，仍然要開兩個 server。
