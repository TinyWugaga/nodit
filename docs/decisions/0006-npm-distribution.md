# 0006 — 以 npm 套件發佈 Nodit

- 狀態：Proposed（發佈前準備已完成，尚未實際發佈）
- 日期：2026-10-23
- 取代：0003「影響」中「`nodit` 沒有發布到 npm，要用 `npm link` 安裝」與「禁止使用 `npx nodit`」的部分

## 背景

- 開啟隊友已導入 Nodit 的 repo 時，要另外 clone Nodit 原始碼、build、`npm link`。init 寫入的 AI skills 又依賴 `nodit` 指令，安裝門檻直接擋住 AI 協作。
- 0003 寫的「npm 上有不相干的同名套件」不正確：2026-10-23 查 `npm view nodit` 與 `npm view @tinywugaga/nodit` 都是 404。名稱沒人註冊反而是風險，任何人都能發佈 `nodit`，跑了 `npx nodit` 的人或 AI 就會執行它。
- `bin/nodit.mjs` 原本在執行時用 tsx 載入 `server/cli.ts`，tsx 卻是 devDependency，直接發佈會無法執行。

## 決策

- **套件名稱**：`@tinywugaga/nodit`，指令名稱維持 `nodit`。用 scope 避開名稱相似規則與搶註；`publishConfig.access` 設為 `public`。
  - scope 對應發佈者的 npm 帳號 `tinywugaga`（2026-10-23 由帳號持有人確認）。
  - 原始碼在 https://github.com/TinyWugaga/nodit （公開），`repository`、`homepage`、`bugs` 都指向這個 repo。
- **server 預先打包**：`npm run build:server` 用 esbuild 把 `server/cli.ts` 與 `core/` 打包成 `dist-server/cli.mjs`（ESM、`--packages=external`）。`bin/nodit.mjs` 只 import 這個檔案，執行期不需要 tsx。
  - 打包後的 `cli.mjs` 用 `../dist` 找 UI，和原始碼位置的相對關係相同。
  - 開發與測試照舊用 tsx 直接跑 `server/cli.ts`。
- **套件內容**：`files` 只放 `bin/`、`dist/`、`dist-server/`。`dependencies` 只留執行期需要的 `chokidar`、`proper-lockfile`、`yaml`；React、xyflow、mermaid 等已經打包進 `dist/`，移到 devDependencies。`prepack` 會跑 `npm run build`，確保發佈的是最新產物。
- **授權**：MIT（2026-10-23 決定），`LICENSE` 放在 repo 根目錄，npm 會自動把它打包進套件。
- **npx 規則**：AI 模板改成「專案把 Nodit 裝成 devDependency 時用 `npx --no nodit`；不要用不帶 `--no` 的 npx」。`--no` 在本地找不到套件時會中止，不會下載（npm 12.0.0 實測：`npx --no cowsay` 回報 `npx canceled due to missing packages and no YES option`）。`TEMPLATE_VERSION` 升為 2，已 init 的專案會在 init 面板看到 Update。

## 尚未處理

- 發佈方式（手動或 CI 帶 provenance）、版本與 changelog 流程未定。

## 後果

- 安裝變成一行 `npm install -g @tinywugaga/nodit`，或裝成 devDependency 讓團隊鎖定同一版本。
- 之後要照 semver 管版本；改 AI 模板內容時要升 `TEMPLATE_VERSION`。
