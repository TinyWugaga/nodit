---
id: SPEC-001
type: spec
title: 卡片節點與關係推斷
status: approved
date: 2026-10-05
implements: [ADR-001]
adr_rev:
  ADR-001: e105a1925dc2a0826b00732963a813b01aa6de94
---

## Scope

涵蓋：ADR、Milestone、Task 三種卡片的自訂節點，以及拉線時依兩端類型推斷關係。

不涵蓋：自動排版、連線樣式的使用者自訂。

## Design

- 單一 `CardNode` 元件負責外框、選取狀態與 handle，內容依 `data.kind` 切換到各類型的 body 元件。
- 關係推斷寫成純函式 `inferLinkKind(from, to)`：Task → ADR 為 `implements`、Task → Milestone 為 `milestone`、同類型為 `depends`，其餘為 `relates`。
- 反向拉線（例如從 ADR 拉到 Task）時交換兩端，關係一律存在來源端的 frontmatter。
- 節點元件用 `memo` 包起來，只在自己的 `data` 改變時 re-render，對應 ADR-001 提到的大量節點效能風險。

## Acceptance Criteria

- [x] 三種卡片共用外框，依類型顯示不同內容
- [x] 200 張卡片同時拖曳時維持 60 fps
- [ ] 拉線時依兩端類型自動選出關係
- [ ] 反向拉線時關係寫在正確的來源端
