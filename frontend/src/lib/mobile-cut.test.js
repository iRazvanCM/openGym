import { describe, expect, it } from 'vitest'
import { CUT_WINDOW_DAYS, buildCutNotifications } from './mobile.js'

describe('the cut\'s daily reminders', () => {
  const now = new Date(2026, 10, 2, 8, 0)   // 2 Nov 2026, 08:00
  const S = extra => ({ bodyweight: [], dailyLog: [], cut: { remind: { weigh: '07:30', log: '21:00' } }, ...extra })

  it('reminds to weigh in each morning and to log each evening, a week ahead, never in the past', () => {
    const n = buildCutNotifications(S(), now)
    const weigh = n.filter(x => x.id >= 3000 && x.id < 3100), log = n.filter(x => x.id >= 3100)
    expect(weigh).toHaveLength(CUT_WINDOW_DAYS - 1)                // this morning's 07:30 has passed
    expect(log).toHaveLength(CUT_WINDOW_DAYS)
    expect(weigh[0].schedule.at).toEqual(new Date(2026, 10, 3, 7, 30))
    expect(log[0].schedule.at).toEqual(new Date(2026, 10, 2, 21, 0))
  })

  it('skips a day already weighed or logged, and does nothing when off', () => {
    const n = buildCutNotifications(S({ bodyweight: [{ d: '2026-11-03', w: 105 }], dailyLog: [{ d: '2026-11-02', done: true, food: [] }] }), now)
    expect(n.some(x => x.schedule.at.getDate() === 3 && x.id < 3100)).toBe(false)
    expect(n.some(x => x.schedule.at.getDate() === 2 && x.id >= 3100)).toBe(false)
    expect(buildCutNotifications(S({ cut: { remind: null } }), now)).toEqual([])
    expect(buildCutNotifications(S({ cut: { remind: { weigh: null, log: '21:00' } } }), now).every(x => x.id >= 3100)).toBe(true)
  })
})
