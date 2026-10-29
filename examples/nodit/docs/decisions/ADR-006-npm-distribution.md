---
id: ADR-006
type: adr
title: 以 npm 套件發佈 Nodit
status: accepted
date: 2026-10-23
relates: [ADR-003]
---

## Context

- 狀態：Accepted（2026-10-23 發佈 `@tinywugaga/nodit@0.1.0`；Proposed 同日）
- 日期：2026-10-23
- 取代：0003「影響」中「`nodit` 沒有發布到 npm，要用 `npm link` 安裝」與「禁止使用 `npx nodit`」的部分

- 開啟隊友已導入 Nodit 的 repo 時，要另外 clone Nodit 原始碼、build、`npm link`。init 寫入的 AI skills 又依賴 `nodit` 指令，安裝門檻直接擋住 AI 協作。
- 0003 寫的「npm 上有不相干的同名套件」不正確：2026-10-23 查 `npm view nodit` 與 `npm view @tinywugaga/nodit` 都是 404。名稱沒人註冊反而是風險，任何人都能發佈 `nodit`，跑了 `npx nodit` 的人或 AI 就會執行它。
- `bin/nodit.mjs` 原本在執行時用 tsx 載入 `server/cli.ts`，tsx 卻是 devDependency，直接發佈會無法執行。

## Decision

- **套件名稱**：`@tinywugaga/nodit`，指令名稱維持 `nodit`。用 scope 避開名稱相似規則與搶註；`publishConfig.access` 設為 `public`。
  - scope 對應發佈者的 npm 帳號 `tinywugaga`（2026-10-23 由帳號持有人確認）。
  - 原始碼在 https://github.com/TinyWugaga/nodit （公開），`repository`、`homepage`、`bugs` 都指向這個 repo。
- **server 預先打包**：`npm run build:server` 用 esbuild 把 `server/cli.ts` 與 `core/` 打包成 `dist-server/cli.mjs`（ESM、`--packages=external`）。`bin/nodit.mjs` 只 import 這個檔案，執行期不需要 tsx。
  - 打包後的 `cli.mjs` 用 `../dist` 找 UI，和原始碼位置的相對關係相同。
  - 開發與測試照舊用 tsx 直接跑 `server/cli.ts`。
- **套件內容**：`files` 只放 `bin/`、`dist/`、`dist-server/`。`dependencies` 只留執行期需要的 `chokidar`、`proper-lockfile`、`yaml`；React、xyflow、mermaid 等已經打包進 `dist/`，移到 devDependencies。`prepack` 會跑 `npm run build`，確保發佈的是最新產物。
- **授權**：MIT（2026-10-23 決定），`LICENSE` 放在 repo 根目錄，npm 會自動把它打包進套件。
- **npx 規則**：AI 模板改成「專案把 Nodit 裝成 devDependency 時用 `npx --no nodit`；不要用不帶 `--no` 的 npx」。`--no` 在本地找不到套件時會中止，不會下載（npm 12.0.0 實測：`npx --no cowsay` 回報 `npx canceled due to missing packages and no YES option`）。`TEMPLATE_VERSION` 升為 2，已 init 的專案會在 init 面板看到 Update。

### 首次發佈（2026-10-23）

- `0.1.0` 由帳號持有人在 `main` 的 `92c26fd` 手動執行 `npm publish --access public --tag latest`，2FA 以網頁驗證完成。
- npm 12.0.0 無法 publish：它的 tarball 漏打包 `sigstore`，`libnpmpublish` 載入時回報 `Cannot find module 'sigstore'`。npm 12.2.1 已修正，發佈前要確認 npm 版本不是 12.0.0。
- npm 要求帳號開 2FA，或使用可略過 2FA 的 granular access token，才能 publish；沒有時回 403。
- 上傳成功後 registry 回 202，需要幾分鐘處理才查得到；處理期間 `npm search` 會顯示 `0.0.0-stage` 暫存佔位版本。

### 自動發佈（2026-10-23）

推送 `v<semver>` tag 時，`.github/workflows/publish.yml` 會發佈對應的版本。

- **驗證方式**：npm trusted publishing（GitHub OIDC），不使用長期 token。依 [npm 官方文件](https://docs.npmjs.com/trusted-publishers)（2026-10-23 查閱）：
  - 需要 npm ≥ 11.5.1、Node ≥ 22.14.0、job 權限 `id-token: write`，而且只支援 GitHub-hosted runner。
  - repo 與套件都公開時會自動產生 provenance。
  - npmjs.com 上的 trusted publisher 設定預設只允許 `npm stage publish`，要另外允許 `npm publish`。
- **版本號來源是 `package.json`**：tag 必須等於 `version`，CI 不從 tag 反推版本，避免 repo 裡的版本號和 npm 上的不一致。升版用 PR 改 `package.json`，merge 後在 `main` 上打 tag。
- **發佈前檢查**（`scripts/release-tag.ts`）：
  - tag 必須是合法的 semver，而且不能帶 `+build`，因為 npm 會丟掉 build metadata，兩個 tag 可能發成同一個版本。
  - tag 指向的 commit 必須在 `main` 上。
  - 正式版必須比目前的 `latest` 新，避免打錯 tag 讓 `latest` 倒退。
- **dist-tag**：正式版用 `latest`；預發佈版用第一個識別字，例如 `beta`、`rc`，識別字以數字開頭時用 `next`。
- **npm 版本**：CI 固定安裝 npm 12.2.1，避開 12.0.0 缺少 `sigstore` 的問題。

#### 首次 CI 發佈（2026-10-23）

`0.1.1` 是第一個由 tag workflow 發佈的版本，驗證了上面整條流程：

- tag `v0.1.1` 指向 `main` 的 `4e490ac`。[run 39930158029](https://github.com/TinyWugaga/nodit/actions/runs/39930158029) 的每個步驟都通過，tag 檢查輸出 `@tinywugaga/nodit@0.1.1 → dist-tag latest`。
- registry 上 `0.1.1` 的發佈者是 `GitHub Actions`（trusted publisher），整個過程沒有用到 npm token。
- 附有 SLSA v1 provenance，已寫入 [Sigstore transparency log](https://search.sigstore.dev/?logIndex=3415907431)。內容記錄的來源：
  - repo：`TinyWugaga/nodit`
  - ref：`refs/tags/v0.1.1`
  - commit：`4e490ac`
  - workflow：`.github/workflows/publish.yml`
  - builder：GitHub-hosted runner
- 從 registry 安裝後，`npm audit signatures` 顯示簽章與 attestation 都驗證通過。

### 尚未處理

- ~~changelog 流程未定。~~ 已由 [0008](0008-versioning-and-changelog.md) 定案（2026-10-25）。
- 建議在 npm 套件設定的 Publishing access 改成「Require two-factor authentication and disallow tokens」，讓 token 無法發佈，只留 CI 的 OIDC 與經過 2FA 的手動發佈。

## Consequences

- 安裝變成一行 `npm install -g @tinywugaga/nodit`，或裝成 devDependency 讓團隊鎖定同一版本。
- 之後要照 semver 管版本；改 AI 模板內容時要升 `TEMPLATE_VERSION`。
