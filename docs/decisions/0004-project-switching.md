# 0004 — 在 UI 內切換本地專案

- 狀態：Proposed
- 日期：2026-10-22
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

## 後果

- 使用者不必再為每個專案開一個 server 和 port。
- server 從「啟動時固定一個專案」變成可以替換專案。`server.ts` 裡直接取用 `project`、`writer`、`owner` 的閉包，要改成透過一個可替換的參照存取。
- 想同時看兩個專案，仍然要開兩個 server。
