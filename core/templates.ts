import type { NoditConfig } from './config'
import { STATUSES } from './domain'

export const TEMPLATE_VERSION = 3

export const BLOCK_START = (v: number) => `<!-- nodit:start v${v} -->`
export const BLOCK_END = '<!-- nodit:end -->'
export const BLOCK_START_RE = /<!-- nodit:start v(\d+) -->/g

const CLI_NOTE = [
  '新建卡片時，先確認 `nodit` 指令可用（`command -v nodit`；專案把 Nodit 裝成 devDependency 時改用 `npx --no nodit`），可用就執行 `nodit new`，它會在寫入鎖內配發不重複的編號：',
  '',
  '```sh',
  'nodit new adr "<標題>" [--supersedes ADR-002]',
  'nodit new milestone "<標題>" [--implements ADR-001]',
  'nodit new task "<標題>" [--milestone MS-01] [--implements ADR-001] [--depends T-002]',
  '```',
  '',
  '不要用不帶 `--no` 的 `npx`：本地找不到時，npx 會從 npm 下載套件來執行，下載到的不一定是這個專案用的版本或套件。`nodit` 不可用時才手寫檔案，編號取該資料夾現有最大值 + 1。',
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
    '',
    '### Architecture 文件',
    '',
    `\`${p.architecture}\` 由 Nodit 的 Architecture 頁渲染，頁面本身唯讀。新增或移除元件、調整資料夾結構、接受影響整體架構的 ADR 之後，同步更新這份文件：`,
    '',
    '- 段落：`## 概觀`、`## 主要元件`、`## 專案結構`、`## 相關決策`。其他自訂段落會原樣顯示。',
    '- 圖用 `mermaid` 程式碼區塊。',
    '- `## 專案結構` 放一個 `nodit-tree` 程式碼區塊，它會顯示在 Structure 分頁：每行寫「路徑、兩個以上空白、說明」，縮排兩格表示子層，資料夾以 `/` 結尾。',
    '- 文中的 `ADR-001`、`MS-01`、`T-001` 這類代號會連到卡片，只寫已存在的代號。寫在 code span 或程式碼區塊裡的代號不會變成連結。',
    '- 文件描述現況；還沒定案的方向寫成 ADR。',
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
    '建立卡片時使用 `/nodit-adr`、`/nodit-milestone`、`/nodit-task`；撰寫或更新架構文件時使用 `/nodit-architecture`。',
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

export const SKILL_KINDS = ['adr', 'milestone', 'task', 'architecture'] as const

export type SkillKind = (typeof SKILL_KINDS)[number]

export function skillPath(kind: SkillKind) {
  return `.claude/skills/nodit-${kind}/SKILL.md`
}

export function renderSkill(kind: SkillKind, config: NoditConfig) {
  if (kind === 'architecture') return renderArchitectureSkill(config)
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
    `3. 提到決策、里程碑、工作時寫卡片代號（\`ADR-001\`、\`MS-01\`、\`T-001\`），Nodit 會把它們連到卡片。只寫 \`${p.adr}/\`、\`${p.milestone}/\`、\`${p.task}/\` 裡已存在的代號；寫在 code span 或程式碼區塊裡的代號不會變成連結。`,
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
