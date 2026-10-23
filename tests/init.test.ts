import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../core/config'
import { applyInit, initPaths, planInit, scopedRead, type InitPlan } from '../core/init'
import { acquireOwner, type Owner } from '../core/owner'
import { sha1 } from '../core/parse'
import { BLOCK_END, renderAgentsBlock, TEMPLATE_VERSION } from '../core/templates'
import { ValidationError, Writer } from '../core/writer'

let root: string
let owner: Owner
let writer: Writer

const read = (rel: string) => readFile(path.join(root, rel), 'utf8')
const exists = (rel: string) => stat(path.join(root, rel)).then(() => true, () => false)

async function plan(ai = true) {
  const { config, exists: has } = await loadConfig(root)
  return planInit(scopedRead(root, initPaths(config)), config, has, ai)
}

function applicable(p: InitPlan) {
  return p.items.filter((i) => i.action !== 'skip' && i.action !== 'conflict').map((i) => i.itemId)
}

async function run(ai = true) {
  const p = await plan(ai)
  return { plan: p, results: await applyInit(writer, p, applicable(p)) }
}

const action = (p: InitPlan, id: string) => p.items.find((i) => i.itemId === id)?.action

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nodit-init-'))
  owner = await acquireOwner(root, 'cli')
  writer = new Writer(root, (await loadConfig(root)).config, owner)
})

afterEach(async () => {
  await owner.release()
  await rm(root, { recursive: true, force: true })
})

describe('init', () => {
  it('creates everything on a fresh project and is idempotent', async () => {
    const first = await run()
    expect(first.results.every((r) => r.ok)).toBe(true)
    for (const f of ['nodit.config.json', 'AGENTS.md', 'CLAUDE.md', '.claude/skills/nodit-adr/SKILL.md', 'docs/ARCHITECTURE.md', '.gitignore']) {
      expect(await exists(f)).toBe(true)
    }
    expect(await exists('docs/decisions')).toBe(true)
    const config = JSON.parse(await read('nodit.config.json'))
    expect(Object.keys(config.managed).sort()).toEqual([
      '.claude/skills/nodit-adr/SKILL.md',
      '.claude/skills/nodit-milestone/SKILL.md',
      '.claude/skills/nodit-task/SKILL.md',
      'AGENTS.md#nodit',
      'CLAUDE.md#nodit',
    ])

    const again = await plan()
    expect(again.items.every((i) => i.action === 'skip')).toBe(true)
    const before = await read('AGENTS.md')
    await applyInit(writer, again, applicable(again))
    expect(await read('AGENTS.md')).toBe(before)
    expect((await read('AGENTS.md')).split(BLOCK_END).length - 1).toBe(1)
  })

  it('appends to an existing AGENTS.md without touching the user content', async () => {
    await writeFile(path.join(root, 'AGENTS.md'), '# Team rules\n\nUse pnpm.\n')
    const { plan: p } = await run()
    expect(action(p, 'AGENTS.md#nodit')).toBe('append')
    const text = await read('AGENTS.md')
    expect(text.startsWith(`# Team rules\n\nUse pnpm.\n\n<!-- nodit:start v${TEMPLATE_VERSION} -->`)).toBe(true)
    expect(text).not.toContain('@AGENTS.md')
    expect(await read('CLAUDE.md')).not.toContain('@AGENTS.md')
  })

  it('reports a conflict when the target changes after the preview', async () => {
    await writeFile(path.join(root, 'AGENTS.md'), '# Team rules\n')
    const p = await plan()
    await writeFile(path.join(root, 'AGENTS.md'), '# Team rules\n\nedited after preview\n')
    const results = await applyInit(writer, p, applicable(p))
    expect(results.find((r) => r.path === 'AGENTS.md')).toMatchObject({ ok: false })
    expect(await read('AGENTS.md')).toBe('# Team rules\n\nedited after preview\n')
  })

  it('keeps a hand-edited managed block and flags it as a conflict', async () => {
    await run()
    const text = await read('AGENTS.md')
    await writeFile(path.join(root, 'AGENTS.md'), text.replace('## Nodit：決策與工作卡片格式', '## Nodit 規則（我改過）'))
    const p = await plan()
    expect(action(p, 'AGENTS.md#nodit')).toBe('conflict')
    expect(p.items.find((i) => i.itemId === 'AGENTS.md#nodit')?.reason).toContain('手動修改')
    await expect(applyInit(writer, p, ['AGENTS.md#nodit'])).rejects.toBeInstanceOf(ValidationError)
  })

  it('upgrades a block that still matches the recorded baseline', async () => {
    await run()
    const { config } = await loadConfig(root)
    const old = '<!-- nodit:start v0 -->\nold rules\n<!-- nodit:end -->'
    await writeFile(path.join(root, 'AGENTS.md'), `# Team\n\n${old}\n\nfooter\n`)
    const cfg = JSON.parse(await read('nodit.config.json'))
    cfg.managed['AGENTS.md#nodit'] = { template: 0, hash: sha1(old) }
    await writeFile(path.join(root, 'nodit.config.json'), JSON.stringify(cfg, null, 2) + '\n')
    const p = await plan()
    expect(action(p, 'AGENTS.md#nodit')).toBe('upgrade')
    await applyInit(writer, p, applicable(p))
    expect(await read('AGENTS.md')).toBe(`# Team\n\n${renderAgentsBlock(config)}\n\nfooter\n`)
    expect(JSON.parse(await read('nodit.config.json')).managed['AGENTS.md#nodit'].template).toBe(TEMPLATE_VERSION)
  })

  it('recovers when content was written but the baseline was not', async () => {
    await run()
    const cfg = JSON.parse(await read('nodit.config.json'))
    cfg.managed = {}
    await writeFile(path.join(root, 'nodit.config.json'), JSON.stringify(cfg, null, 2) + '\n')
    const p = await plan()
    expect(action(p, 'AGENTS.md#nodit')).toBe('skip')
    await applyInit(writer, p, applicable(p))
    expect(Object.keys(JSON.parse(await read('nodit.config.json')).managed)).toHaveLength(5)
  })

  it('does not overwrite a file that appeared between preview and apply', async () => {
    const p = await plan()
    await writeFile(path.join(root, 'CLAUDE.md'), '# mine\n')
    const results = await applyInit(writer, p, applicable(p))
    expect(results.find((r) => r.path === 'CLAUDE.md')).toMatchObject({ ok: false })
    expect(await read('CLAUDE.md')).toBe('# mine\n')
  })

  it('rejects item ids that are not in the plan', async () => {
    const p = await plan()
    await expect(applyInit(writer, p, ['../../etc/passwd'])).rejects.toBeInstanceOf(ValidationError)
  })

  it('writes no AI files when AI integration is skipped', async () => {
    const { plan: p } = await run(false)
    expect(p.items.some((i) => i.group === 'ai')).toBe(false)
    expect(await exists('AGENTS.md')).toBe(false)
    expect(await exists('.claude')).toBe(false)
    expect(await exists('nodit.config.json')).toBe(true)
  })

  it('treats malformed markers and foreign skill files as conflicts', async () => {
    await writeFile(path.join(root, 'AGENTS.md'), '<!-- nodit:start v1 -->\nno end marker\n')
    await mkdir(path.join(root, '.claude/skills/nodit-adr'), { recursive: true })
    await writeFile(path.join(root, '.claude/skills/nodit-adr/SKILL.md'), '---\nname: nodit-adr\n---\nmine\n')
    const p = await plan()
    expect(action(p, 'AGENTS.md#nodit')).toBe('conflict')
    expect(action(p, '.claude/skills/nodit-adr/SKILL.md')).toBe('conflict')
  })
})
