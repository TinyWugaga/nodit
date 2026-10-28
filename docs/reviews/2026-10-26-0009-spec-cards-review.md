# 0009 Spec 卡片評估

評估日期：2026-10-26。範圍：0009、0003、0007，以及本地 domain、parser、review、ProjectService 與 Markdown renderer。這是專案 ADR 的一般審查文件；0009 沒有 Nodit frontmatter ID，因此不虛構 `target: ADR-009`。

## Summary

建議採納 Spec 獨立成卡片的方向，但 0009 暫留 Proposed，先處理下列 P1。多張 Task 共用設計、Spec 可供 review、允許小改動跳過 Spec，都符合目前以 Markdown 為真相的定位。不自動推導 status、不追蹤 Task 對 Spec 的 hash，以及共用 checklist parser，都是合理的初版取捨。

核心風險不是多一種 CardKind，而是關係語意與派生狀態尚未形成完整契約。以下是建議，尚未代替使用者做方向性決定。

## Findings

- [x] **P1（ADR 接受前）統一 Milestone 與 Spec 的關係。** 0009:44 說需要時用 `relates`，但 :53、:57 又允許並預設推斷 `milestone implements spec`；不同實作者會做出不同的拉線行為。推薦保留表格中的 `implements`，將 :44 改成「不建立包含關係；Milestone 可 implements Spec 表達本階段承接其實作，並不代表完整交付」。同時明訂 Spec 的完成提示只計直接 `task implements spec`，不計 `relates`，也不沿 Milestone 間接推導；跨 Milestone 的完成判斷才不會因不同查詢方式而改變。 已處理：「Spec 與 Milestone 的分工」改為不建立包含關係、Milestone implements Spec 表示承接實作；完成判斷只計直接 task implements spec。

- [x] **P1（ADR 接受前）補齊 Spec→Spec 與 relates 的規則。** 0009:57 只描述跨 kind 推斷；目前 `core/domain.ts` 的 `inferLinkKind` 會把所有非 ADR 同 kind 連線推為 `depends`，因此加入 Spec 後，Spec→Spec 會產生其 LINK_SCHEMA 不允許的關係。推薦 Spec→Spec 預設 `relates`，`supersedes` 由人明確選擇；並將既有 ADR／Milestone／Task 的 `relates.target` 一併加入 Spec，否則「全部 kind 可關聯」只在 Spec 作來源時成立。驗收至少覆蓋四種 kind 的方向組合，以及推斷結果必須符合 LINK_SCHEMA。 已處理：「連線」新增 spec↔spec 推斷為 relates、supersedes 由人選擇，adr／milestone／task 的 relates 加入 spec，驗收列舉 16 種拉線。

- [x] **P1（ADR 接受前）補上 adr_rev 的資料流與更新責任。** 0009:62–64 定義 hash，尚未說明如何解析／驗證 map、如何送到前端，以及 ADR 改動時如何更新 Spec 的派生狀態。目前 `core/parse.ts` 不讀 `adr_rev`，`toClientDoc` 會移除 blob；`server/project.ts` 有 review 專用的關聯重算路徑，不能只新增 CardKind 就沿用。推薦 server 產生逐 ADR 狀態，外部掃描、UI 寫入、刪除與重建都重算；補齊有效 hash 格式、無關 key、無 ADR 連線、多 ADR 混合狀態與不合法目標的處理。Inspector 列逐 ADR 結果，卡片分辨 stale／unrecorded／missing，不能都顯示「ADR 已修改」。驗收應包含只改 ADR、不改 Spec 時立即更新，且讀取派生狀態不改寫 Spec 檔案。 已處理：「過期判定」補上格式驗證、逐 ADR 狀態與彙總文字、比照 linkReviews 的資料流與重算時機，以及三條驗收。

- [x] **P1（ADR 接受前）調整 task-skips-spec，避免把關聯存在誤當成範圍涵蓋。** 0009:74 的條件無法知道 Spec 是否涵蓋 Task。例如 ADR-001 底下有「登入」Spec，另一張「登出」Task 仍可能合法地直接 implements ADR-001，卻收到 warning；反過來，Task 只要連到任意不相關 Spec，就能避開提醒。推薦初版取消這項全域診斷，改在 Inspector 顯示「此 ADR 有可參考的 Spec」，讓人依範圍決定。若保留 warning，至少按同一 ADR 檢查相關 Spec、排除已完成 Task，並承認仍無法消除範圍誤報；新增 scope 模型只為支撐 warning 不划算。 已處理：取消 task-skips-spec，改為 Task Inspector 提示「有可參考的 Spec」，取消理由寫進「替代方案」。

- [x] **P2（實作前）定義 Spec 修訂與重新確認流程。** 0009:26、:58、:62 分別描述人工 outdated、取代與 hash，但未交代 ADR 修改後如何回到 current，以及 approved／implemented Spec 改 Design 後應如何處理。推薦在 AI 指引明訂：重新讀 ADR、檢查差異並調整或確認設計後，才可更新相應 adr_rev；不得僅為清除 stale 刷新 hash。同一份 Spec 的範圍延續時原地修訂，另立替代設計且需要保留舊實作關係時才新增 Spec 並 supersedes。技術設計實質變更時建議人工退回 draft；純文字修正不必退回。Nodit 不自動改 status。 已處理：新增「修訂與重新確認」，含不得只為清除 stale 刷新 adr_rev、原地修訂與 supersedes 的分界、Design 實質變更建議退回 draft。

- [x] **P2（實作前）讓完成提示反映驗收資訊。** 0009:37–38 雖不自動改檔，但在 criteria 尚未完成時仍建議改 implemented，提示強度高於證據。推薦 Task 全 done 時顯示「相關 Task 已完成；驗收條件 3/5」，只有 criteria 全勾時再加「可考慮標記 implemented」；criteria 缺少或沒有 checklist 時顯示「尚無驗收紀錄」。這仍是非阻擋提示，不需要 workflow engine。 已處理：「status 只提示」改為依 Acceptance Criteria 分三種提示，只有全勾時才建議 implemented。

- [x] **P2（實作前）補列 TypeScript 不會抓到的擴充點。** 0009:89 偏重 Record<CardKind, …>，但 `src/architecture/render.ts` 的 CARD_RE／CARD_START 寫死 ADR、MS、T，新增 enum 不會讓 SPEC 代號自動變成連結。將 Markdown 代號解析、規則模板中的路徑與指令範例、新舊 config 載入、跨文件診斷的清除重算列入驗收；`server/project.ts` 的 CROSS_CODES 也需納入新診斷，避免已解決 warning 殘留。無須為此新增抽象框架，但不能把編譯通過當成擴充完整。 已處理：「影響」新增 TypeScript 抓不到的擴充點清單，含 CARD_RE／CARD_START、CROSS_CODES、模板與舊 config。

## 審查限制

本次為文件與原始碼靜態審查，未執行測試，也未聲稱新功能可運作。依 judgment 核對了每項 finding 的文件或程式碼依據；由同一對話自行重讀，並非獨立驗收，仍可能有共同推理盲點。原 ADR 與實作均未修改。
