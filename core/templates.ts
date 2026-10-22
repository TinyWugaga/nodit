import type { NoditConfig } from './config'
import { STATUSES } from './domain'

export const TEMPLATE_VERSION = 1

export const BLOCK_START = (v: number) => `<!-- nodit:start v${v} -->`
export const BLOCK_END = '<!-- nodit:end -->'
export const BLOCK_START_RE = /<!-- nodit:start v(\d+) -->/g

const CLI_NOTE = [
  '新建卡片時，先確認 `nodit` 指令可用（`command -v nodit`），可用就執行 `nodit new`，它會在寫入鎖內配發不重複的編號：',
  '',
  '```sh',
  'nodit new adr "<標題>" [--supersedes ADR-002]',
  'nodit new milestone "<標題>" [--implements ADR-001]',
  'nodit new task "<標題>" [--milestone MS-01] [--implements ADR-001] [--depends T-002]',
  '```',
  '',
  '不要用 `npx nodit`：Nodit 沒有發布到 npm，npx 可能下載到不相干的同名套件。`nodit` 不可用時才手寫檔案，編號取該資料夾現有最大值 + 1。',
]

/** Shared format rules. Rendered separately into each agent file; never imported across files. */
export function renderRules(config: NoditConfig): string[] {
  const p = config.paths
  return [
    '## Nodit：決策與工作卡片格式',
    '',
    `這個專案用 Nodit 把 ADR、Milestone、Task 畫成關聯圖。在 \`${p.adr}/\`、\`${p.milestone}/\`、\`${p.task}/\` 新增或修改檔案時，遵守下列格式；不符合的檔案會在 Nodit 裡標成無效，而且不能透過 UI 編輯。`,
    '',
    '### 檔案',
    '',
    `- ADR：\`${p.adr}/ADR-###-<slug>.md\``,
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
    '',
    '### 關聯（寫在來源端的 frontmatter）',
    '',
    '- Task 或 Milestone 實作某個決策：`implements: [ADR-001]`',
    '- Task 屬於某個 Milestone：`milestone: MS-01`（單一值）',
    '- 依賴：`depends: [T-002]`（Task 對 Task、Milestone 對 Milestone）',
    '- 新 ADR 取代舊 ADR：新 ADR 寫 `supersedes: [ADR-002]`，並把舊 ADR 的 `status` 改成 `superseded`（只改那一行）',
    '- 其他關係：`relates: [ID]`',
    '',
    '### 正文段落',
    '',
    '- ADR：`## Context`、`## Decision`、`## Consequences`',
    '- Milestone：`## Goal`',
    '- Task：`## Description`',
    '',
    '每個段落標題在同一份檔案只出現一次。其他自訂段落與 frontmatter 欄位會原樣保留。',
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
    '建立卡片時使用 `/nodit-adr`、`/nodit-milestone`、`/nodit-task`。',
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
    extra: ['用 `--milestone MS-0X` 指定所屬里程碑，`--implements ADR-00X` 指定實作的決策，`--depends T-00X` 指定前置工作。'],
    sections: ['Description'],
    sample: ['id: T-012', 'type: task', 'title: 加入 SSE 重連', 'status: todo', 'priority: medium', 'milestone: MS-01', 'implements: [ADR-007]'],
  },
} as const

export type SkillKind = keyof typeof SKILL_SPEC

export function skillPath(kind: SkillKind) {
  return `.claude/skills/${SKILL_SPEC[kind].name}/SKILL.md`
}

export function renderSkill(kind: SkillKind, config: NoditConfig) {
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
    `1. 先確認 \`nodit\` 指令可用（\`command -v nodit\`）。可用就執行 \`${s.command}\`，它會印出新卡片的 ID 與路徑。`,
    `   - 不要用 \`npx nodit\`。指令不可用時，列出 \`${dir}/\` 取最大編號 + 1，照下面的格式手寫。`,
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
