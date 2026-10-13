import { describe, expect, it } from 'vitest'
import { holidayWindow, markPrecut, precutItems, precutShown } from './precut.js'
import { addDays } from './cut.js'

const today = '2026-10-20'
const by = (items, id) => items.find(i => i.id === id)

describe('the holidays', () => {
  it('are the next 23 December to 1 January, or the ones under way', () => {
    expect(holidayWindow('2026-10-20')).toEqual({ from: '2026-12-23', to: '2027-01-01' })
    expect(holidayWindow('2026-12-28')).toEqual({ from: '2026-12-23', to: '2027-01-01' })
    expect(holidayWindow('2027-01-01')).toEqual({ from: '2026-12-23', to: '2027-01-01' })
    expect(holidayWindow('2027-01-02')).toEqual({ from: '2027-12-23', to: '2028-01-01' })
  })
})

describe('the checklist before the cut', () => {
  it('starts with nothing done on an empty profile', () => {
    const items = precutItems({}, { today, mobile: true, ios: true })
    expect(items.map(i => i.id)).toEqual(['start', 'holidays', 'health', 'reminders', 'test', 'export', 'import', 'weigh', 'lifts', 'waist'])
    expect(items.every(i => !i.done)).toBe(true)
    expect(by(items, 'health').state).toBe('off')
  })

  it('reads every check it can off the data', () => {
    const days = n => Array.from({ length: n }, (_, i) => addDays(today, -i))
    const S = {
      cut: { start: '2026-11-02', breaks: [{ from: '2026-12-23', to: '2027-01-01' }], remind: { weigh: '07:30', log: '21:00' } },
      bodyweight: days(6).map((d, i) => ({ d, w: 106 - i * 0.1, t: 1 })),
      workouts: days(3).map(d => ({ id: d, d, start: new Date(d + 'T10:00').getTime(), end: new Date(d + 'T11:00').getTime(), entries: [] })),
      measurements: [{ d: addDays(today, -3), waist: 112, t: 1 }],
      dailyLog: [{ d: addDays(today, -1), t: 1, steps: 9000, hk: ['steps'] }],
      exported: { at: Date.now(), full: Date.now() },
      precut: markPrecut(markPrecut(null, 'test', 5), 'importTest', 6),
    }
    const items = precutItems(S, { today, mobile: true, ios: true, health: { on: true } })
    expect(items.filter(i => !i.done).map(i => i.id)).toEqual([])
    expect(by(items, 'weigh').n).toBe(6)
    expect(precutShown(S, items, today)).toBe(false)
  })

  it('says Apple Health is on but has given nothing yet', () => {
    expect(by(precutItems({}, { today, ios: true, health: { on: true } }), 'health').state).toBe('empty')
  })

  it('leaves out the holidays for a cut that starts after them, and the phone checks on the web', () => {
    const items = precutItems({ cut: { start: '2027-01-10' } }, { today })
    expect(items.map(i => i.id)).not.toContain('holidays')
    expect(items.map(i => i.id)).not.toContain('reminders')
  })

  it('shows before the cut and for its first two weeks, unless put away', () => {
    const items = [{ id: 'x', done: false }]
    expect(precutShown({}, items, today)).toBe(true)
    expect(precutShown({ cut: { start: addDays(today, -13) } }, items, today)).toBe(true)
    expect(precutShown({ cut: { start: addDays(today, -14) } }, items, today)).toBe(false)
    expect(precutShown({ precut: { hidden: 1 } }, items, today)).toBe(false)
  })

  it('is a cut\'s: never shown to keep a weight or to gain', () => {
    const items = [{ id: 'x', done: false }]
    expect(precutShown({ cut: { start: today, mode: 'maintain' } }, items, today)).toBe(false)
    expect(precutShown({ cut: { start: today, mode: 'gain' } }, items, today)).toBe(false)
    expect(precutShown({ cut: { start: today, mode: 'cut' } }, items, today)).toBe(true)
  })
})
