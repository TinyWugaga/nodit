---
name: nodit-review-resolve
description: 被要求處理、回應、修正或消化這個專案的 review（docs/reviews/ 裡未處理的 findings）時使用。依 findings 修改目標卡片或開 Task，在 review 正文勾選已處理的項目，不改 review 的 frontmatter。
# nodit-managed v7
---

# 處理 review 的 findings（Nodit 格式）

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

## 範例

處理後的 Findings：

```markdown
## Findings

- [x] 補上效能門檻。— 在 ADR-001 的 Consequences 加上 500 節點以上改用分層顯示。
- [x] 說明 re-render 的控制方式。— 開了 T-012 追蹤，不在 ADR 內展開。
- [ ] 改用 Canvas 2D 渲染。
```

第三項不同意，保持未勾選，並在回覆裡說明理由。
