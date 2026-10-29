import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline/promises'
import { CONFIG_INVALID, loadConfig, type NoditConfig } from '../core/config'
import { ImportError, runImport, type ImportConflict, type ImportReport } from '../core/import'
import { applyInit, initPaths, planInit, publicPlan, scopedRead, type InitResult } from '../core/init'
import { CARD_KINDS, LINK_KINDS, type CardKind, type LinkKind } from '../core/domain'
import { scanDocs } from '../core/scan'
import { revOf } from '../core/spec'
import { acquireOwner, LockBusyError, readToken, type OwnerInfo } from '../core/owner'
import type { ClientDoc } from '../core/protocol'
import { ValidationError, Writer, type LinkChange, type NewCard } from '../core/writer'
import { start } from './server'

const HELP = `nodit [dir] [--port 4319] [--browse-root <path>]   開啟專案（預設為目前目錄）；UI 內只能切換到 browse root 底下的專案（預設為家目錄）
nodit init [dir] [--no-ai] [--yes] [--dry-run]   初始化：設定檔、資料夾與 AI 指令檔
nodit new <adr|milestone|task|spec> "<title>" [options]
    --dir <path>             專案目錄（預設 .）
    --status <status>        初始狀態
    --implements <ID>        可重複
    --milestone <MS-ID>      task 所屬的 milestone
    --depends <ID>           可重複
    --supersedes <ID>        可重複（新 ADR／Spec 取代舊的同類卡片）
    --relates <ID>           可重複
    --json                   以 JSON 輸出結果
nodit rev <ID> [--dir <path>]       輸出卡片 body（frontmatter 之後）的指紋，用於 Spec 的 adr_rev
nodit import <file.json> [dir]       匯入舊版 localStorage 匯出（nodit:project）；中斷後用同一個檔案重跑即可續跑
nodit --version | -v                 顯示版本
nodit --help | -h                    顯示這份說明`

class CliError extends Error {
  constructor(
    message: string,
    public code = 1,
  ) {
    super(message)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Anything unrecognized is an error: a typo must never start a server and take a folder's writer lock. */
function parseServeArgs(argv: string[]) {
  const args = { dir: '.', port: 4319, devOrigins: [] as string[], browseRoot: undefined as string | undefined }
  let hasDir = false
  const value = (flag: string, v: string | undefined) => {
    if (v === undefined || v.startsWith('-')) throw new CliError(`${flag} 需要一個值\n\n${HELP}`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--port') {
      const v = value(a, argv[++i])
      if (!/^\d+$/.test(v) || Number(v) > 65535) throw new CliError(`--port 必須是 0–65535 的整數：${v}`)
      args.port = Number(v)
    } else if (a === '--browse-root') args.browseRoot = path.resolve(value(a, argv[++i]))
    else if (a === '--dev-origin') args.devOrigins.push(value(a, argv[++i]))
    else if (a.startsWith('-')) throw new CliError(`不認得的參數：${a}\n\n${HELP}`)
    else if (hasDir) throw new CliError(`多餘的參數：${a}\n\n${HELP}`)
    else {
      args.dir = a
      hasDir = true
    }
  }
  return args
}

async function packageVersion() {
  // server/cli.ts in development, dist-server/cli.mjs when installed: both sit next to package.json's folder
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json')
  return (JSON.parse(await readFile(file, 'utf8')) as { version: string }).version
}

async function serve(argv: string[]) {
  const args = parseServeArgs(argv)
  const dir = await stat(path.resolve(args.dir)).catch(() => null)
  if (!dir?.isDirectory()) throw new CliError(`找不到目錄：${args.dir}（子指令只有 init、new、rev、import）\n\n${HELP}`)
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
  const running = await start({
    root: args.dir,
    port: args.port,
    devOrigins: args.devOrigins,
    distDir: existsSync(dist) ? dist : undefined,
    browseRoot: args.browseRoot,
    recentFile: path.join(homedir(), '.nodit', 'recent.json'),
  })
  console.log(`Nodit ▸ ${path.resolve(args.dir)}`)
  console.log(`       http://127.0.0.1:${running.port}`)
  if (!running.project.configExists) console.log('       尚未初始化（找不到 nodit.config.json）')
  const shutdown = () => {
    running.close().finally(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

function parseNewArgs(argv: string[]) {
  const [type, title, ...rest] = argv
  if (!CARD_KINDS.includes(type as CardKind)) throw new CliError(`第一個參數必須是 ${CARD_KINDS.join(' / ')}\n\n${HELP}`)
  if (!title?.trim()) throw new CliError(`缺少標題\n\n${HELP}`)
  const input: NewCard = { type: type as CardKind, title: title.trim(), fields: {}, links: [] }
  let dir = '.'
  let asJson = false
  const relFlag: Record<string, LinkKind> = {
    '--implements': 'implements',
    '--milestone': 'part-of',
    '--depends': 'depends',
    '--supersedes': 'supersedes',
    '--relates': 'relates',
  }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--dir') dir = rest[++i]
    else if (a === '--json') asJson = true
    else if (a === '--status') input.fields!.status = rest[++i]
    else if (relFlag[a] && LINK_KINDS.includes(relFlag[a])) input.links!.push({ rel: relFlag[a], to: rest[++i] } satisfies LinkChange)
    else throw new CliError(`不認得的參數：${a}\n\n${HELP}`)
  }
  return { input, root: path.resolve(dir), asJson }
}

type ServerApi = (method: string, url: string, body?: unknown) => Promise<{ status: number; body: any }>

/** Talk to the lock-holding server, after confirming it is really the owner. Never takes over the lock. */
async function serverApi(root: string, owner: OwnerInfo): Promise<ServerApi> {
  const base = `http://127.0.0.1:${owner.port}`
  let health: { sessionId?: string; ownerId?: string }
  try {
    health = await (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).json()
  } catch {
    throw new CliError(`專案被 Nodit server（pid ${owner.pid}）鎖定，但它沒有回應；不會接管寫入鎖`, 3)
  }
  if (health.sessionId !== owner.sessionId || health.ownerId !== owner.ownerId) {
    throw new CliError('port 上回應的不是持有寫入鎖的那個 Nodit server；不會接管寫入鎖', 3)
  }
  const token = await readToken(root, owner)
  if (!token) throw new CliError('讀不到目前 server 的寫入權杖', 3)
  return async (method, url, body) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: base, 'X-Nodit-Token': token, 'X-Nodit-Session': owner.sessionId },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }
}

/** Run `offline` under our own lock, or `online` through the running server. Waits for other CLIs. */
async function withProject<T>(
  root: string,
  offline: (writer: Writer, config: NoditConfig, configExists: boolean) => Promise<T>,
  online: (api: ServerApi) => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + 8000
  for (;;) {
    try {
      const owner = await acquireOwner(root, 'cli')
      try {
        const loaded = await loadConfig(root)
        const problems = loaded.diagnostics.filter((d) => d.code === CONFIG_INVALID)
        return await offline(new Writer(root, loaded.config, owner, () => problems), loaded.config, loaded.exists)
      } finally {
        await owner.release()
      }
    } catch (err) {
      if (!(err instanceof LockBusyError)) throw err
      const o = err.owner
      if (o?.mode === 'server' && o.port) return online(await serverApi(root, o))
      if (Date.now() > deadline) throw new CliError(err.message, 2)
      await sleep(150 + Math.random() * 150)
    }
  }
}

function createCard(root: string, input: NewCard): Promise<ClientDoc> {
  return withProject(
    root,
    (writer) => writer.createCard(input),
    async (api) => {
      const r = await api('POST', '/api/cards', input)
      if (r.status === 422) throw new ValidationError(r.body.diagnostics)
      if (r.status !== 201) throw new CliError(`server 回應 ${r.status}：${r.body.error ?? ''}`)
      return r.body.doc
    },
  )
}

type PublicPlan = ReturnType<typeof publicPlan>

const ACTION_LABEL: Record<string, string> = { create: '新建', append: '附加', upgrade: '更新', skip: '略過', conflict: '衝突' }

function printPlan(plan: PublicPlan) {
  for (const item of plan.items) {
    const tag = ACTION_LABEL[item.action].padEnd(2, '　')
    console.log(`  ${tag}  ${item.path}${item.reason ? `  — ${item.reason}` : ''}`)
  }
}

async function cmdInit(argv: string[]) {
  let dir = '.'
  let ai = true
  let yes = false
  let dry = false
  for (const a of argv) {
    if (a === '--no-ai') ai = false
    else if (a === '--yes' || a === '-y') yes = true
    else if (a === '--dry-run') dry = true
    else if (!a.startsWith('-')) dir = a
    else throw new CliError(`不認得的參數：${a}`)
  }
  const root = path.resolve(dir)

  const decide = async (plan: PublicPlan) => {
    console.log(`Nodit init ▸ ${root}${ai ? '' : '（不含 AI 指令檔）'}`)
    printPlan(plan)
    const ids = plan.items.filter((i) => i.action !== 'skip' && i.action !== 'conflict').map((i) => i.itemId)
    if (dry) return null
    if (!yes) {
      if (!process.stdin.isTTY) throw new CliError('非互動環境請加 --yes 確認套用，或用 --dry-run 只檢視計畫')
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      const answer = await rl.question(`套用 ${ids.length} 個項目？[y/N] `)
      rl.close()
      if (!/^y(es)?$/i.test(answer.trim())) return null
    }
    return ids
  }

  const report = (results: InitResult[]) => {
    for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.path}${r.error ? `  — ${r.error}` : ''}`)
    if (results.some((r) => !r.ok)) process.exitCode = 1
    if (ai) console.log('已開著的 AI 工作階段需要重開，才會載入新的指令檔。')
  }

  if (dry) {
    const { config, exists } = await loadConfig(root)
    await decide(publicPlan(await planInit(scopedRead(root, initPaths(config)), config, exists, ai)))
    return
  }

  await withProject(
    root,
    async (writer, config, configExists) => {
      const plan = await planInit(scopedRead(root, initPaths(config)), config, configExists, ai)
      const ids = await decide(publicPlan(plan))
      if (ids) report(await applyInit(writer, plan, ids))
    },
    async (api) => {
      const r = await api('GET', `/api/init/plan?ai=${ai}`)
      const ids = await decide(r.body)
      if (!ids) return
      const applied = await api('POST', '/api/init/apply', { planId: r.body.planId, itemIds: ids })
      if (applied.status === 422 && Array.isArray(applied.body.diagnostics)) throw new ValidationError(applied.body.diagnostics)
      if (applied.status !== 200) throw new CliError(`server 回應 ${applied.status}：${applied.body.error ?? ''}`)
      report(applied.body.results)
    },
  )
}

async function cmdNew(argv: string[]) {
  const { input, root, asJson } = parseNewArgs(argv)
  try {
    const doc = await createCard(root, input)
    if (asJson) console.log(JSON.stringify({ id: doc.card?.id, path: doc.path }))
    else console.log(`Created ${doc.card?.id}  ${doc.path}`)
  } catch (err) {
    if (err instanceof ValidationError) throw new CliError(err.diagnostics.map((d) => `✗ ${d.message}`).join('\n'))
    throw err
  }
}

async function cmdRev(argv: string[]) {
  let id: string | undefined
  let dir = '.'
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') {
      dir = argv[++i]
      if (dir === undefined) throw new CliError(`--dir 需要一個值\n\n${HELP}`)
    } else if (a.startsWith('-') || id) throw new CliError(`不認得的參數：${a}\n\n${HELP}`)
    else id = a
  }
  if (!id) throw new CliError(`用法：nodit rev <ID> [--dir <path>]\n\n${HELP}`)
  const root = path.resolve(dir)
  const { config, diagnostics } = await loadConfig(root)
  const invalid = diagnostics.find((d) => d.code === CONFIG_INVALID)
  if (invalid) throw new CliError(invalid.message)
  const result = revOf(await scanDocs(root, config), id)
  if (!result.ok) throw new CliError(result.message)
  console.log(result.rev)
}

function importFailure(message: string, conflicts: ImportConflict[] = []) {
  return new CliError([message, ...conflicts.map((c) => `  ✗ ${c.id ? c.id + '  ' : ''}${c.path}  — ${c.reason}`)].join('\n'))
}

async function cmdImport(argv: string[]) {
  const [file, dir = '.', ...extra] = argv
  if (!file || file.startsWith('-') || extra.length) throw new CliError(`用法：nodit import <file.json> [dir]\n\n${HELP}`)
  const root = path.resolve(dir)
  const text = await readFile(path.resolve(file), 'utf8')
  let report: ImportReport
  try {
    report = await withProject(
      root,
      (writer, config, configExists) => runImport(root, writer, config, configExists, text),
      async (api) => {
        const r = await api('POST', '/api/import', { text })
        if (r.status === 200) return r.body.report
        if (r.status === 422 && Array.isArray(r.body.diagnostics)) throw new ValidationError(r.body.diagnostics)
        throw importFailure(r.body.error ?? `server 回應 ${r.status}`, r.body.conflicts)
      },
    )
  } catch (err) {
    if (err instanceof ImportError) throw importFailure(err.message, err.conflicts)
    throw err
  }
  if (report.status === 'already-complete') {
    console.log(`這份檔案已經匯入完成（${report.total} 張卡片）：${report.jobPath}`)
    return
  }
  console.log(`${report.resumed ? '續跑完成' : '匯入完成'}：新寫入 ${report.created.length}、沿用既有 ${report.adopted.length}，共 ${report.total} 張卡片`)
  console.log(`對照表：${report.jobPath}`)
  for (const w of report.warnings) console.log(`  ! ${w}`)
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') return console.log(HELP)
  if (cmd === '--version' || cmd === '-v') return console.log(await packageVersion())
  if (cmd === 'new') return cmdNew(rest)
  if (cmd === 'init') return cmdInit(rest)
  if (cmd === 'rev') return cmdRev(rest)
  if (cmd === 'import') return cmdImport(rest)
  return serve(process.argv.slice(2))
}

main().catch((err) => {
  if (err instanceof LockBusyError) {
    console.error(err.message)
    process.exit(2)
  }
  if (err instanceof CliError) {
    console.error(err.message)
    process.exit(err.code)
  }
  if (err instanceof ValidationError) {
    console.error(err.diagnostics.map((d) => `✗ ${d.message}`).join('\n'))
    process.exit(1)
  }
  console.error(err)
  process.exit(1)
})
