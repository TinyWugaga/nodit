# 0001 — 第一階段技術選型

- 狀態：Accepted（資料存放的部分已由 0003 取代）
- 日期：2026-10-20

## 背景

Nodit 要把 ADR、Milestone、Task 做成卡片，放在 node-graph canvas 上連線呈現。第一階段要先驗證 canvas 的操作手感和視覺，先不做後端。

## 決策

- **Vite + React 19 + TypeScript**。
- **Canvas 用 `@xyflow/react` v12**：節點（`CardNodeView`）和連線（`LinkEdgeView`）都是自訂元件。四邊 handle 搭配 `ConnectionMode.Loose`，任一邊都能拉線。
- **狀態用 Zustand 單一 store + `persist`**：存在 localStorage，key 是 `nodit:project`。寫入前會去掉 `selected`、`measured` 這類 UI 欄位。
- **連線語意依兩端卡片類型自動推斷**（`meta.ts` 的 `inferLinkKind` / `shouldReverse`）：
  - 方向統一成「實作者 → ADR」「Task → Milestone」。
  - Milestone 的進度由指向它的 `part-of` Task 算出來，不另外存。
- **主題**：色票 `#d8e2dc #ffe5d9 #ffcad4 #f4acb7 #9d8189` 寫成 CSS tokens，分淺色和深色兩套。卡片類型的對應：ADR 用 rose、Milestone 用 mauve、Task 用 sage。

## 影響

- 資料只存在單一瀏覽器，不能協作，容量上限約 5MB。可以用 JSON 匯出／匯入做備份。
- 要改用 IndexedDB 或接後端時，只需替換 `persist` 的 storage，或把 store 的 actions 換成 API 呼叫。
