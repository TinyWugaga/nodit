import { describe, expect, it } from 'vitest'
import {
  assigneeLoad,
  buildLanes,
  canDrop,
  compareTasks,
  dependencyHints,
  milestoneProgress,
  statusIndex,
  taskItems,
  UNSET,
  type TaskItem,
} from '../src/tasks/board'
import type { CardNode } from '../src/types'

/** Without an explicit `saved`, the card is fully saved: disk values equal what the board shows. */
function task(code: string, over: Partial<TaskItem> = {}): TaskItem {
  const t = { docKey: code, code, title: code, status: 'todo', priority: 'medium', assignee: '', milestone: null, depends: [], writable: true, ...over } as TaskItem
  return { ...t, saved: over.saved ?? { status: t.status, assignee: t.assignee } }
}

const all = () => true

describe('Tasks board', () => {
  it('orders a column by priority, then ID numerically', () => {
    const items = [task('T-010'), task('T-2', { priority: 'low' }), task('T-9'), task('T-100', { priority: 'high' })]
    expect(items.sort(compareTasks).map((i) => i.code)).toEqual(['T-100', 'T-9', 'T-010', 'T-2'])
  })

  it('groups into one lane per value with unset last; search hides cards but not lane totals', () => {
    const items = [
      task('T-1', { assignee: 'Tiny', status: 'doing' }),
      task('T-2', { assignee: '' }),
      task('T-3', { assignee: 'Ann', status: 'done' }),
      task('T-4', { assignee: 'Tiny' }),
    ]
    const lanes = buildLanes(items, 'assignee', (i) => i.code !== 'T-4')
    expect(lanes.map((l) => l.key)).toEqual(['Ann', 'Tiny', UNSET])
    const tiny = lanes[1]
    expect([tiny.total, tiny.shown]).toEqual([2, 1])
    expect(tiny.columns.doing.map((i) => i.code)).toEqual(['T-1'])
    expect(tiny.columns.todo).toEqual([])

    expect(buildLanes(items, 'none', all).map((l) => l.key)).toEqual(['all'])
    expect(buildLanes([task('T-1', { priority: 'low' }), task('T-2', { priority: 'high' })], 'priority', all).map((l) => l.key)).toEqual(['high', 'low'])
  })

  it('drag changes status only: same lane, another column, writable cards', () => {
    const t = task('T-1', { assignee: 'Tiny', milestone: 'MS-01' })
    expect(canDrop(t, 'doing', 'all', 'none')).toBe(true)
    expect(canDrop(t, 'todo', 'all', 'none')).toBe(false)
    expect(canDrop(t, 'doing', 'Tiny', 'assignee')).toBe(true)
    expect(canDrop(t, 'doing', 'Ann', 'assignee')).toBe(false)
    expect(canDrop(t, 'doing', 'MS-02', 'milestone')).toBe(false)
    expect(canDrop(t, 'doing', 'high', 'priority')).toBe(false)
    expect(canDrop({ ...t, writable: false }, 'doing', 'all', 'none')).toBe(false)
  })

  it('milestone progress counts tasks over every task and says so when there are none', () => {
    const items = [task('T-1', { milestone: 'MS-01', status: 'done' }), task('T-2', { milestone: 'MS-01' }), task('T-3', { milestone: 'MS-09' })]
    const progress = milestoneProgress(items, [
      { code: 'MS-02', title: 'empty' },
      { code: 'MS-01', title: 'one' },
    ])
    expect(progress).toEqual([
      { code: 'MS-01', title: 'one', done: 1, total: 2 },
      { code: 'MS-02', title: 'empty', done: 0, total: 0 },
    ])
  })

  it('assignee load keeps doing and blocked apart and drops idle people', () => {
    const items = [
      task('T-1', { assignee: 'Tiny', status: 'doing' }),
      task('T-2', { assignee: 'Tiny', status: 'blocked' }),
      task('T-3', { assignee: 'Ann', status: 'done' }),
      task('T-4', { status: 'blocked' }),
    ]
    expect(assigneeLoad(items)).toEqual([
      { assignee: 'Tiny', doing: 1, blocked: 1 },
      { assignee: UNSET, doing: 0, blocked: 1 },
    ])
  })

  it('statistics ignore drafts: a pending or failed move changes no number until it is saved', () => {
    const draft = { status: 'error', values: {}, diskChanged: false } as const
    const items = [
      task('T-1', { milestone: 'MS-01', assignee: 'Tiny', status: 'done', saved: { status: 'doing', assignee: 'Tiny' }, draft }),
      task('T-2', { milestone: 'MS-01', assignee: 'Ann', status: 'blocked', saved: { status: 'todo', assignee: 'Tiny' }, draft }),
    ]
    expect(milestoneProgress(items, [{ code: 'MS-01', title: 'm' }])).toEqual([{ code: 'MS-01', title: 'm', done: 0, total: 2 }])
    expect(assigneeLoad(items)).toEqual([{ assignee: 'Tiny', doing: 1, blocked: 0 }])
    // the cards themselves still sit where the draft puts them
    const lane = buildLanes(items, 'none', all)[0]
    expect([lane.columns.done.map((i) => i.code), lane.columns.blocked.map((i) => i.code)]).toEqual([['T-1'], ['T-2']])
  })

  it('separates unfinished dependencies from ones that cannot be resolved', () => {
    const index = new Map([
      ['T-1', ['done']],
      ['T-2', ['doing']],
      ['T-3', ['done', 'todo']],
    ])
    expect(dependencyHints(task('T-9', { depends: ['T-1', 'T-2', 'T-3', 'T-404'] }), index)).toEqual({
      unfinished: ['T-2'],
      unresolved: ['T-3', 'T-404'],
    })
  })

  it('reads draft values for fields and disk values for links', () => {
    const node = (id: string, data: Record<string, unknown>) => ({ id, type: 'card', position: { x: 0, y: 0 }, data }) as unknown as CardNode
    const nodes = [
      node('k1', { kind: 'task', code: 'T-1', title: 'draft title', status: 'doing', priority: 'high', assignee: ' Tiny ', writable: true }),
      node('k2', { kind: 'milestone', code: 'MS-01', title: 'm', status: 'active' }),
    ]
    const docs = [{ docKey: 'k1', card: { type: 'task', status: 'todo', assignee: 'Ann', links: { milestone: 'MS-01', depends: ['T-2'] } } }] as never
    expect(taskItems(nodes, docs)).toMatchObject([
      { code: 'T-1', title: 'draft title', status: 'doing', assignee: 'Tiny', milestone: 'MS-01', depends: ['T-2'], saved: { status: 'todo', assignee: 'Ann' } },
    ])
    expect(statusIndex(nodes).get('MS-01')).toEqual(['active'])
  })
})
