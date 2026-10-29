import type { NoditConfig } from './config'
import { REVIEW_STATUSES, REVIEW_VERDICTS, STATUSES } from './domain'

export const TEMPLATE_VERSION = 7

export const BLOCK_START = (v: number) => `<!-- nodit:start v${v} -->`
export const BLOCK_END = '<!-- nodit:end -->'
export const BLOCK_START_RE = /<!-- nodit:start v(\d+) -->/g

const CLI_NOTE = [
  '新建卡片時，先確認 `nodit` 指令可用（`command -v nodit`；專案把 Nodit 裝成 devDependency 時改用 `npx --no nodit`），可用就執行 `nodit new`，它會在寫入鎖內配發不重複的編號：',
  '',
  '```sh',
  'nodit new adr "<標題>" [--supersedes ADR-002]',
  'nodit new milestone "<標題>" [--implements ADR-001]',
  'nodit new spec "<標題>" --implements ADR-001',
  'nodit new task "<標題>" [--milestone MS-01] [--implements SPEC-001] [--depends T-002]',
  '```',
  '',
  '不要用不帶 `--no` 的 `npx`：本地找不到時，npx 會從 npm 下載套件來執行，下載到的不一定是這個專案用的版本或套件。`nodit` 不可用時才手寫檔案，編號取該資料夾現有最大值 + 1。',
]

const BLOB_COMMAND = `(printf 'blob %s\\0' "$(wc -c < FILE | tr -d ' ')"; cat FILE) | shasum -a 1 | cut -d' ' -f1`

function reviewRules(config: NoditConfig): string[] {
  const p = config.paths
  return [
    `- 檔名：\`${p.review}/<YYYY-MM-DD>-<第一個目標ID>-<reviewer>-<6位hex>.md\`，後綴用 \`openssl rand -hex 3\` 產生。`,
    '- 不得覆寫既有 review。用 exclusive create 寫檔：shell 先 `set -C` 再 `cat > "$FILE" <<\'EOF\'`，或用 `open(path, "x")`；檔案已存在就換後綴重來。',
    '- 讀目標檔的當下就計算它的指紋，寫進 `target_rev`（把 `FILE` 換成目標檔路徑）：',
    '',
    '  ```sh',
    `  ${BLOB_COMMAND}`,
    '  ```',
    '',
    '  不要在 review 寫完後對最新檔案重算：那會把你沒讀過的修改標成已評估。只有確定 repo 用 SHA-1 時，才能改用 `git hash-object --no-filters FILE`。',
    '- `status` 一律寫 `open`；之後的處理狀態由人在 Nodit 裡改。評估時不要修改既有的 review。',
    '',
    '| 欄位 | 值 |',
    '| --- | --- |',
    '| `type` | `review` |',
    '| `target` | 目標卡片 ID 陣列，例如 `[ADR-001]` |',
    '| `reviewer` | 撰寫者，例如 `codex`、`claude` |',
    '| `date` | `YYYY-MM-DD` |',
    `| \`verdict\` | ${REVIEW_VERDICTS.map((s) => `\`${s}\``).join(' / ')} |`,
    `| \`status\` | ${REVIEW_STATUSES.map((s) => `\`${s}\``).join(' / ')} |`,
    '| `target_rev` | 選填；`卡片 ID: 指紋` 對照表 |',
    '',
    '正文寫 `## Summary`（結論）與 `## Findings`：',
    '',
    '- 要求修改、補充或做決定的事項，一律寫成 `## Findings` 底下的 `- [ ]` 項目，不論它是否阻擋其他工作。Nodit 只計算、追蹤 `## Findings` 裡的項目，處理 review 的人也只會逐條處理這些項目。',
    '- 優先序與期限寫在項目開頭，例如 `- [ ] **P1**（期限：ADR 接受前）…`。優先序只決定先後，不決定要不要列成 finding。',
    '- 需要分組時，在 `## Findings` 底下用 `###` 小標，例如「阻擋 P0」「不阻擋 P0」，不要另開 `##` 段落。',
    '- 其他段落只放背景、已解決項目的核對、不需要修改的建議，不能放未列入 Findings 的修改要求。',
  ]
}

/** Spec workflow and revision rules; shared by the rules block and the spec skill. */
function specRules(config: NoditConfig): string[] {
  const p = config.paths
  return [
    '- Spec 寫在 ADR 與 Task 之間：ADR 決定「為什麼、決定了什麼」，Spec 寫「具體怎麼做」，Task 是其中一件工作。小改動可以跳過 Spec，從 ADR 直接開 Task。',
    '- ADR 是 `accepted` 之後再把 Spec 從 `draft` 推進到 `approved`。Spec 是 `approved` 或 `implemented`、它 implements 的 ADR 卻不是 `accepted` 時，Nodit 會發出 warning。',
    '- `## Scope` 寫涵蓋與不涵蓋的範圍；`## Design` 寫介面、資料結構、流程與邊界條件；`## Acceptance Criteria` 用 `- [ ]` checklist，每一項都要能被驗證。',
    `- \`adr_rev\` 記錄寫 Spec 時讀到的 ADR 內容指紋：讀 ADR 的當下執行 \`nodit rev ADR-001\`（devDependency 時用 \`npx --no nodit rev ADR-001\`），把輸出寫成 \`adr_rev: { ADR-001: <輸出> }\`。不要自己用 shell 切 frontmatter 計算；指令不可用時省略這個 ADR 的 \`adr_rev\`，Nodit 會顯示「未記錄 ADR 版本」。`,
    '- 不要在寫完 Spec 後才對最新的 ADR 重算：那會把你沒讀過的修改標成已確認。',
    '- Nodit 顯示「ADR 已修改」時：重讀 ADR、檢查差異，必要時調整 Spec，或確認設計不受影響，之後才更新那個 ADR 的 `adr_rev`。不得只為了清除提示就刷新指紋。',
    '- 範圍延續時在原檔修訂。另立替代設計、而且要保留舊 Spec 與既有 Task 的關係時，才新開一份 Spec 寫 `supersedes: [SPEC-001]`，並把舊 Spec 的 `status` 改成 `outdated`。',
    '- `approved` 或 `implemented` 的 Spec 改了 `## Design` 的技術設計時，在回覆裡建議由人把 `status` 退回 `draft` 重新確認；純文字修正不必。不要自己改 `status`。',
    `- 需要開工作時，依 \`## Acceptance Criteria\` 用 \`nodit new task "<標題>" --implements SPEC-001\` 建 Task（存放在 \`${p.task}/\`）。驗收條件達成後，把對應的 \`- [ ]\` 改成 \`- [x]\`。`,
  ]
}

/** How to work through an existing review's findings; shared by the rules block and the resolve skill. */
function resolveRules(config: NoditConfig): string[] {
  const p = config.paths
  return [
    `範圍：指定了 review 檔就處理那一份。只說「處理 review」時，處理 \`${p.review}/\` 裡 \`status: open\`、格式正確、還有未勾選 finding 的 review；指定卡片 ID 時只處理 \`target\` 含那張卡片的。\`addressed\`、\`dismissed\` 的 review 不處理；格式錯誤的 review 不處理，在回覆裡列出路徑。`,
    '',
    `1. 讀整份 review：frontmatter 與完整正文，不只 Summary 與 Findings。再讀 \`target\` 列出的每張卡片（\`${p.adr}/\`、\`${p.spec}/\`、\`${p.milestone}/\`、\`${p.task}/\`）與相關程式碼。`,
    '2. 檢查 `## Findings` 以外的段落。發現疑似修改要求時（其他段落裡的 checklist，或要求修改、補充、決定的句子）：不要當成 finding 處理，也不要略過，更不要替評估者搬進 Findings。在回覆裡另外列成「Findings 以外的修改要求」，附上段落名稱與原文，請人決定要不要納入。',
    '3. 逐條處理 `## Findings` 裡還沒勾選的 `- [ ]` 項目，包括 `###` 小標底下的項目：',
    '   - 同意的：修改目標卡片。只動相關的欄位或段落，不要重排整份檔案，不要改 `id`。',
    '   - 需要另外開工作的：用 `nodit new task "<標題>" --implements <目標ID>` 建 Task，不要硬塞進現有卡片。專案把 Nodit 裝成 devDependency 時改用 `npx --no nodit`；兩者都不可用時，照 Task 格式手寫，編號取現有最大值 + 1。',
    '   - 不同意的：不要改卡片，在回覆裡說明理由。',
    '4. 已處理的項目，在 review 正文把 `- [ ]` 改成 `- [x]`，並在同一行後面補一句做了什麼。不同意的項目保持未勾選。',
    '5. 不要修改 review 的 frontmatter，特別是 `status` 和 `target_rev`：`status` 由人在 Nodit 裡改，`target_rev` 要保留原本評估時的版本。修改過的卡片在 Nodit 會顯示「評估後已修改」，這是預期結果。',
    '6. 完成後列出：每份 review 的每條 finding 怎麼處理（已修改／已開 Task／不同意）、Findings 以外的修改要求、改了哪些檔案、還有哪些需要人決定。',
  ]
}

/** Shared format rules. Rendered separately into each agent file; never imported across files. */
export function renderRules(config: NoditConfig): string[] {
  const p = config.paths
  return [
    '## Nodit：決策與工作卡片格式',
    '',
    `這個專案用 Nodit 把 ADR、Spec、Milestone、Task 畫成關聯圖。在 \`${p.adr}/\`、\`${p.spec}/\`、\`${p.milestone}/\`、\`${p.task}/\` 新增或修改檔案時，遵守下列格式；不符合的檔案會在 Nodit 裡標成無效，而且不能透過 UI 編輯。`,
    '',
    '### 檔案',
    '',
    `- ADR：\`${p.adr}/ADR-###-<slug>.md\``,
    `- Spec：\`${p.spec}/SPEC-###-<slug>.md\``,
    `- Milestone：\`${p.milestone}/MS-##-<slug>.md\``,
    `- Task：\`${p.task}/T-###-<slug>.md\``,
    '- `id` 一旦建立就不要修改；改標題不必改檔名。',
    '',
    ...CLI_NOTE,
    '',
    '### frontmatter',
    '',
    '必填 `id`、`type`、`title`、`status`。',
    '',
    '| type | status | 其他欄位 |',
    '| --- | --- | --- |',
    `| \`adr\` | ${STATUSES.adr.map((s) => `\`${s}\``).join(' / ')} | \`date: YYYY-MM-DD\` |`,
    `| \`milestone\` | ${STATUSES.milestone.map((s) => `\`${s}\``).join(' / ')} | \`due: YYYY-MM-DD\` |`,
    `| \`task\` | ${STATUSES.task.map((s) => `\`${s}\``).join(' / ')} | \`priority: low / medium / high\`、\`assignee\` |`,
    `| \`spec\` | ${STATUSES.spec.map((s) => `\`${s}\``).join(' / ')} | \`date: YYYY-MM-DD\`、\`adr_rev\`（見下方 Spec） |`,
    '',
    '### 關聯（寫在來源端的 frontmatter）',
    '',
    '- Task 或 Milestone 實作某個決策或 Spec：`implements: [ADR-001]`、`implements: [SPEC-001]`',
    '- Spec 實作某個決策：`implements: [ADR-001]`（可多個）',
    '- Task 屬於某個 Milestone：`milestone: MS-01`（單一值）',
    '- 依賴：`depends: [T-002]`（Task 對 Task、Milestone 對 Milestone）',
    '- 新 ADR 取代舊 ADR：新 ADR 寫 `supersedes: [ADR-002]`，並把舊 ADR 的 `status` 改成 `superseded`（只改那一行）',
    '- 新 Spec 取代舊 Spec：新 Spec 寫 `supersedes: [SPEC-001]`，並把舊 Spec 的 `status` 改成 `outdated`（只改那一行）',
    '- 其他關係：`relates: [ID]`',
    '',
    '### 正文段落',
    '',
    '- ADR：`## Context`、`## Decision`、`## Consequences`',
    '- Milestone：`## Goal`',
    '- Task：`## Description`',
    '- Spec：`## Scope`、`## Design`、`## Acceptance Criteria`',
    '',
    '每個段落標題在同一份檔案只出現一次。其他自訂段落與 frontmatter 欄位會原樣保留。',
    '',
    '### Spec（技術規格）',
    '',
    ...specRules(config),
    '',
    '### Architecture 文件',
    '',
    `\`${p.architecture}\` 由 Nodit 的 Architecture 頁渲染，頁面本身唯讀。新增或移除元件、調整資料夾結構、接受影響整體架構的 ADR 之後，同步更新這份文件：`,
    '',
    '- 段落：`## 概觀`、`## 主要元件`、`## 專案結構`、`## 相關決策`。其他自訂段落會原樣顯示。',
    '- 圖用 `mermaid` 程式碼區塊。',
    '- `## 專案結構` 放一個 `nodit-tree` 程式碼區塊，它會顯示在 Structure 分頁：每行寫「路徑、兩個以上空白、說明」，縮排兩格表示子層，資料夾以 `/` 結尾。',
    '- 文中的 `ADR-001`、`SPEC-001`、`MS-01`、`T-001` 這類代號會連到卡片，只寫已存在的代號。寫在 code span 或程式碼區塊裡的代號不會變成連結。',
    '- 文件描述現況；還沒定案的方向寫成 ADR。',
    '',
    '### Review（AI 評估）',
    '',
    `被要求評估 ADR、Spec、Milestone 或 Task 時，把結果寫成 \`${config.paths.review}/\` 裡的一份新檔案，Nodit 會把它掛到目標卡片上。`,
    '',
    ...reviewRules(config),
    '',
    '### 處理 review',
    '',
    '被要求處理 review 時：',
    '',
    ...resolveRules(config),
  ]
}

function block(lines: string[]) {
  return [BLOCK_START(TEMPLATE_VERSION), ...lines, BLOCK_END].join('\n')
}

export function renderAgentsBlock(config: NoditConfig) {
  return block(renderRules(config))
}

export function renderClaudeBlock(config: NoditConfig) {
  return block([
    ...renderRules(config),
    '',
    '### Claude Code skills',
    '',
    '建立卡片時使用 `/nodit-adr`、`/nodit-spec`、`/nodit-milestone`、`/nodit-task`；撰寫或更新架構文件時使用 `/nodit-architecture`；評估卡片時使用 `/nodit-review`；處理 review 的 findings 時使用 `/nodit-review-resolve`。',
  ])
}

const SKILL_SPEC = {
  adr: {
    name: 'nodit-adr',
    title: '架構決策紀錄（ADR）',
    description: '在這個專案新增、修改或取代架構決策紀錄（ADR）時使用。依 Nodit 格式寫入 ADR 檔案，並處理 supersedes。',
    command: 'nodit new adr "<標題>"',
    extra: ['取代舊決策時加 `--supersedes ADR-00X`，完成後把舊 ADR 的 `status` 改成 `superseded`（只改那一行）。'],
    sections: ['Context', 'Decision', 'Consequences'],
    sample: ['id: ADR-007', 'type: adr', 'title: 以 SSE 推播檔案變更', 'status: proposed', 'date: 2026-10-21', 'supersedes: [ADR-002]'],
  },
  milestone: {
    name: 'nodit-milestone',
    title: ' Milestone',
    description: '在這個專案規劃或更新里程碑（Milestone）時使用。依 Nodit 格式寫入 Milestone 檔案並連結相關 ADR。',
    command: 'nodit new milestone "<標題>"',
    extra: ['這個里程碑實作某些決策時加 `--implements ADR-00X`。'],
    sections: ['Goal'],
    sample: ['id: MS-03', 'type: milestone', 'title: 多專案支援', 'status: planned', 'due: 2026-12-01', 'implements: [ADR-005]'],
  },
  task: {
    name: 'nodit-task',
    title: ' Task',
    description: '在這個專案新增或更新工作項目（Task）時使用。依 Nodit 格式寫入 Task 檔案，連結所屬 Milestone、實作的 ADR 與依賴。',
    command: 'nodit new task "<標題>"',
    extra: [
      '用 `--milestone MS-0X` 指定所屬里程碑，`--implements ADR-00X` 指定實作的決策，`--depends T-00X` 指定前置工作。',
      '依某份 Spec 的驗收條件開的 Task，改用 `--implements SPEC-00X`；ADR 已有 `approved` 的 Spec 時，先確認這張 Task 是否在它的範圍內。',
    ],
    sections: ['Description'],
    sample: ['id: T-012', 'type: task', 'title: 加入 SSE 重連', 'status: todo', 'priority: medium', 'milestone: MS-01', 'implements: [ADR-007]'],
  },
} as const

export const SKILL_KINDS = ['adr', 'spec', 'milestone', 'task', 'architecture', 'review', 'review-resolve'] as const

export type SkillKind = (typeof SKILL_KINDS)[number]

export function skillPath(kind: SkillKind) {
  return `.claude/skills/nodit-${kind}/SKILL.md`
}

export function renderSkill(kind: SkillKind, config: NoditConfig) {
  if (kind === 'architecture') return renderArchitectureSkill(config)
  if (kind === 'spec') return renderSpecSkill(config)
  if (kind === 'review') return renderReviewSkill(config)
  if (kind === 'review-resolve') return renderResolveSkill(config)
  const s = SKILL_SPEC[kind]
  const dir = config.paths[kind]
  return [
    '---',
    `name: ${s.name}`,
    `description: ${s.description}`,
    `# nodit-managed v${TEMPLATE_VERSION}`,
    '---',
    '',
    `# 新增或修改${s.title}（Nodit 格式）`,
    '',
    `1. 先確認 \`nodit\` 指令可用（\`command -v nodit\`；專案把 Nodit 裝成 devDependency 時改用 \`npx --no nodit\`）。可用就執行 \`${s.command}\`，它會印出新卡片的 ID 與路徑。`,
    `   - 不要用不帶 \`--no\` 的 \`npx\`，它可能從 npm 下載別的套件。指令不可用時，列出 \`${dir}/\` 取最大編號 + 1，照下面的格式手寫。`,
    ...s.extra.map((x) => `   - ${x}`),
    `2. 打開新檔案，填寫段落：${s.sections.map((x) => `\`## ${x}\``).join('、')}。每個標題只出現一次。`,
    '3. 不要修改 `id`；frontmatter 裡不認得的欄位保持原樣。',
    '4. 修改既有卡片時，只改需要改的欄位或段落，不要重排整份檔案。',
    '',
    '## 格式',
    '',
    '```markdown',
    '---',
    ...s.sample,
    '---',
    '',
    ...s.sections.flatMap((x) => [`## ${x}`, '', '…', '']),
    '```',
    '',
  ].join('\n')
}

function renderSpecSkill(config: NoditConfig) {
  const p = config.paths
  return [
    '---',
    'name: nodit-spec',
    `description: 在這個專案為 ADR 撰寫、修訂或取代技術規格（Spec，${p.spec}/）時使用，也用於 Nodit 顯示「ADR 已修改」需要重新確認 Spec 時。依 Nodit 格式寫入 Spec，記錄 adr_rev，並依驗收條件開 Task。`,
    `# nodit-managed v${TEMPLATE_VERSION}`,
    '---',
    '',
    '# 撰寫或修訂 Spec（Nodit 格式）',
    '',
    `1. 讀 Spec 要實作的 ADR（\`${p.adr}/\`）與相關程式碼。讀每份 ADR 的同時執行 \`nodit rev <ADR-ID>\` 記下輸出（devDependency 時用 \`npx --no nodit rev\`）。指令以非零狀態結束時，照它的訊息處理，不要自己計算。`,
    '2. 新建時執行 `nodit new spec "<標題>" --implements ADR-00X`，它會印出新 Spec 的 ID 與路徑。指令不可用時，列出 `' + p.spec + '/` 取最大編號 + 1，照下面的格式手寫，並省略 `adr_rev`。',
    '3. 填寫 `## Scope`、`## Design`、`## Acceptance Criteria`，把第 1 步記下的指紋寫進 `adr_rev`。',
    '4. 不要修改 `id`；frontmatter 裡不認得的欄位保持原樣。修改既有 Spec 時只動相關段落。',
    '',
    '## 規則',
    '',
    ...specRules(config),
    '',
    '## 格式',
    '',
    '```markdown',
    '---',
    'id: SPEC-003',
    'type: spec',
    'title: SSE 重連與事件補送',
    'status: draft',
    'date: 2026-10-29',
    'implements: [ADR-007]',
    'adr_rev:',
    '  ADR-007: 3f2a9c0e5b1d4a7f8e6c2b9d0a1f3e5c7b9d1f2a',
    '---',
    '',
    '## Scope',
    '',
    '…',
    '',
    '## Design',
    '',
    '…',
    '',
    '## Acceptance Criteria',
    '',
    '- [ ] …',
    '```',
    '',
  ].join('\n')
}

function renderResolveSkill(config: NoditConfig) {
  const p = config.paths
  return [
    '---',
    'name: nodit-review-resolve',
    `description: 被要求處理、回應、修正或消化這個專案的 review（${p.review}/ 裡未處理的 findings）時使用。依 findings 修改目標卡片或開 Task，在 review 正文勾選已處理的項目，不改 review 的 frontmatter。`,
    `# nodit-managed v${TEMPLATE_VERSION}`,
    '---',
    '',
    '# 處理 review 的 findings（Nodit 格式）',
    '',
    ...resolveRules(config),
    '',
    '## 範例',
    '',
    '處理後的 Findings：',
    '',
    '```markdown',
    '## Findings',
    '',
    '- [x] 補上效能門檻。— 在 ADR-001 的 Consequences 加上 500 節點以上改用分層顯示。',
    '- [x] 說明 re-render 的控制方式。— 開了 T-012 追蹤，不在 ADR 內展開。',
    '- [ ] 改用 Canvas 2D 渲染。',
    '```',
    '',
    '第三項不同意，保持未勾選，並在回覆裡說明理由。',
    '',
  ].join('\n')
}

function renderReviewSkill(config: NoditConfig) {
  const p = config.paths
  return [
    '---',
    'name: nodit-review',
    `description: 被要求評估、審查或 review 這個專案的 ADR、Spec、Milestone 或 Task 時使用。把評估結果寫成 ${p.review}/ 裡的新檔案，Nodit 會把它掛到目標卡片上。`,
    `# nodit-managed v${TEMPLATE_VERSION}`,
    '---',
    '',
    '# 評估卡片（Nodit review 格式）',
    '',
    `1. 讀目標卡片（\`${p.adr}/\`、\`${p.spec}/\`、\`${p.milestone}/\`、\`${p.task}/\`）與相關程式碼。讀每個目標檔的同時，用下方「格式」裡的指令算出它的指紋並記下來。`,
    '2. 評估完成後，依格式建立一份新檔案。評估時不要修改目標卡片本身，也不要修改既有的 review；要處理既有 review 的 findings 時改用 `/nodit-review-resolve`。',
    '3. 每個要求修改、補充或做決定的事項，都寫成 `## Findings` 底下的一個 `- [ ]` 項目，具體說明問題與建議；優先序與期限寫在項目開頭。其他段落不放修改要求。',
    '4. `verdict`：可以直接接受寫 `approve`；需要修改寫 `changes`；方向有根本問題寫 `reject`。',
    '',
    '## 格式',
    '',
    ...reviewRules(config),
    '',
    '```markdown',
    '---',
    'type: review',
    'target: [ADR-001]',
    'reviewer: claude',
    'date: 2026-10-25',
    'verdict: changes',
    'status: open',
    'target_rev:',
    '  ADR-001: 3f2a9c0e5b1d4a7f8e6c2b9d0a1f3e5c7b9d1f2a',
    '---',
    '',
    '## Summary',
    '',
    '…',
    '',
    '## Findings',
    '',
    '### 阻擋 P0',
    '',
    '- [ ] **P0** …',
    '',
    '### 不阻擋 P0',
    '',
    '- [ ] **P1**（期限：ADR 接受前）…',
    '```',
    '',
  ].join('\n')
}

function renderArchitectureSkill(config: NoditConfig) {
  const p = config.paths
  return [
    '---',
    'name: nodit-architecture',
    `description: 在這個專案撰寫、補完或更新架構文件（${p.architecture}）時使用，包括 nodit init 之後填寫骨架，以及新增元件、調整資料夾結構、接受 ADR 之後同步文件。依 Nodit Architecture 頁的格式寫 mermaid、nodit-tree 與卡片代號。`,
    `# nodit-managed v${TEMPLATE_VERSION}`,
    '---',
    '',
    '# 撰寫或更新架構文件（Nodit 格式）',
    '',
    `\`${p.architecture}\` 是 Nodit Architecture 頁的唯一來源；頁面本身唯讀，內容只能改這份檔案。`,
    '',
    `1. 先讀程式碼的進入點、主要資料夾與設定檔，再讀 \`${p.adr}/\` 裡 \`accepted\` 的 ADR。元件職責以程式碼為準，不要只憑檔名推測。`,
    '2. 依下面的段落補完或更新。init 產生的骨架佔位內容（例如 `UI --> API --> Storage`、`src/  …`）要換成實際內容，不要留著。',
    `3. 提到決策、規格、里程碑、工作時寫卡片代號（\`ADR-001\`、\`SPEC-001\`、\`MS-01\`、\`T-001\`），Nodit 會把它們連到卡片。只寫 \`${p.adr}/\`、\`${p.spec}/\`、\`${p.milestone}/\`、\`${p.task}/\` 裡已存在的代號；寫在 code span 或程式碼區塊裡的代號不會變成連結。`,
    '4. 修改既有文件時只動相關段落，保留使用者自訂的段落與內容，不要重排整份檔案。',
    '5. 文件描述現況。還沒定案的方向用 `/nodit-adr` 寫成 ADR，不要寫進架構文件當成事實。',
    '',
    '## 段落',
    '',
    '- `## 概觀`：一兩段說明系統做什麼、資料怎麼流動，附上關鍵決策的 ADR 代號。',
    '- `## 主要元件`：一張 `mermaid` 的 `flowchart` 畫出元件與依賴方向；需要時加一張「元件｜職責｜相關卡片」表格，重要流程可以再用 `sequenceDiagram`。',
    '- `## 專案結構`：一個 `nodit-tree` 程式碼區塊，顯示在 Architecture 頁的 Structure 分頁。',
    '- `## 相關決策`：列出影響整體架構的 ADR 代號，各附一句說明。',
    '',
    '## nodit-tree 格式',
    '',
    '- 每行寫「路徑、兩個以上空白（或 tab）、說明」。說明可以省略，也可以寫卡片代號。',
    '- 縮排兩格表示子層，資料夾以 `/` 結尾。',
    '- 只列主要資料夾與關鍵檔案，讓人知道東西該去哪裡找；不要列出整棵檔案樹。',
    '',
    '````markdown',
    '## 專案結構',
    '',
    '```nodit-tree',
    'src/                 瀏覽器 UI',
    '  components/        共用元件',
    '  main.tsx           進入點',
    'server/              本地 API，決策見 ADR-003',
    'docs/                ADR、Milestone、Task 卡片與本文件',
    '```',
    '````',
    '',
  ].join('\n')
}

export function renderArchitecture() {
  return [
    '# Architecture',
    '',
    '這份文件描述系統的整體架構。Nodit 的 Architecture 頁會渲染它，並把文中的 ADR-001、MS-01、T-001 這類代號連到對應卡片。',
    '',
    '## 概觀',
    '',
    '',
    '## 主要元件',
    '',
    '```mermaid',
    'flowchart LR',
    '  UI --> API --> Storage',
    '```',
    '',
    '## 專案結構',
    '',
    '說明主要資料夾與檔案的用途，讓人知道東西該去哪裡找。下面的 nodit-tree 區塊會顯示在 Architecture 頁的 Structure 分頁：每行寫「路徑、兩個以上空白、說明」，縮排兩格表示子層，資料夾以 / 結尾。',
    '',
    '```nodit-tree',
    'src/            …',
    'docs/           ADR、Milestone、Task 卡片與本文件',
    '```',
    '',
    '## 相關決策',
    '',
    '',
  ].join('\n')
}

export const GITIGNORE_LINES = ['.nodit/writer.lock', '.nodit/owner.json', '.nodit/token']
