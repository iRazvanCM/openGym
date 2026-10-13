import { describe, expect, it } from 'vitest'
import { addDays, cutReport } from './cut.js'
import {
  CHECKIN_GRACE_DAYS, MAX_STEP, addCheckIn, checkInDayOf, checkInFor, currentFocus, normalizeCheckIn, proposeKcal,
  suggestFocus, weekBrief, weekDays, withPartial,
} from './checkin.js'

const START = '2026-11-02'   // a Monday
const at = iso => new Date(iso + 'T07:30:00').getTime()

// Weeks of a cut at `kcal` a day, the scale going down `perWeek` kg a week, no noise.
function cut({ days = 35, perWeek = 1, kcal = 2000, plan = {} } = {}) {
  const bodyweight = [], dailyLog = []
  for (let i = 0; i < days; i++) {
    const d = addDays(START, i)
    bodyweight.push({ d, w: Math.round((106 - perWeek * i / 7) * 100) / 100, t: at(d) })
    dailyLog.push({ d, t: at(d) + 1, kcal, protein: 175, steps: 10000, sleep: 7.5 })
  }
  return { unit: 'kg', targetW: 85, cut: { start: START, ...plan }, bodyweight, dailyLog, workouts: [], measurements: [] }
}
const lastDay = S => S.dailyLog[S.dailyLog.length - 1].d

describe('when the check-in is', () => {
  it('falls on the start\'s weekday from the second week, and waits three days', () => {
    const S = cut()
    expect(checkInDayOf(cut().cut)).toBe(1)
    expect(checkInFor(S, addDays(START, 6))).toBeNull()
    expect(checkInFor(S, '2026-11-09')).toMatchObject({ d: '2026-11-09', from: '2026-11-02', to: '2026-11-08', due: true })
    expect(checkInFor(S, addDays('2026-11-09', CHECKIN_GRACE_DAYS)).due).toBe(true)
    expect(checkInFor(S, addDays('2026-11-09', CHECKIN_GRACE_DAYS + 1)).due).toBe(false)
    S.checkIns = addCheckIn([], { d: '2026-11-09' })
    expect(checkInFor(S, '2026-11-10')).toMatchObject({ done: true, due: false })
  })

  it('takes the weekday chosen', () => {
    const S = cut({ plan: { checkInDay: 0 } })   // Sunday
    expect(checkInFor(S, '2026-11-16')).toMatchObject({ d: '2026-11-15', due: true })
  })
})

describe('half-logged days', () => {
  it('flags a day with too little for a whole day, or a single meal', () => {
    const S = cut({ days: 14 })
    S.dailyLog[8] = { d: S.dailyLog[8].d, t: 1, kcal: 900 }
    S.dailyLog[9] = { d: S.dailyLog[9].d, t: 1, food: [{ id: 'a', meal: 'b', name: 'Oats', src: 'quick', kcal: 1500, p: 50, c: 200, f: 20 }] }
    S.dailyLog.splice(10, 1)
    const days = weekDays(S, addDays(START, 7), addDays(START, 13))
    expect(days.map(x => x.kind)).toEqual(['ok', 'suspect', 'suspect', 'none', 'ok', 'ok', 'ok'])
    const marked = withPartial(S, { [S.dailyLog[8].d]: true })
    expect(marked.dailyLog[8].partial).toBe(true)
    expect(S.dailyLog[8].partial).toBeUndefined()
  })
})

describe('next week\'s calories', () => {
  it('keeps them when the pace is the one aimed for', () => {
    const S = cut({ perWeek: 1 })
    const p = proposeKcal(S, lastDay(S))
    expect(p.kind).toBe('keep')
    expect(Math.abs(p.tdee - 3100)).toBeLessThan(80)
  })

  it('moves at most 150 a week towards the pace aimed for, either way', () => {
    const slow = cut({ perWeek: 0.4 })
    const p = proposeKcal(slow, lastDay(slow))
    expect(p).toMatchObject({ kind: 'kcal', from: 2000, kcal: 2000 - MAX_STEP })
    expect(p.want).toBeLessThan(1950)
    const fast = cut({ perWeek: 1.9 })
    expect(proposeKcal(fast, lastDay(fast))).toMatchObject({ kind: 'kcal', kcal: 2000 + MAX_STEP })
  })

  it('asks for steps once the floor is reached', () => {
    const S = cut({ perWeek: 0.3, kcal: 1800, plan: { kcal: 1800 } })
    expect(proposeKcal(S, lastDay(S))).toMatchObject({ kind: 'steps', steps: 12000 })
  })

  it('aims for a share of body weight when the pace is set that way', () => {
    const S = cut({ perWeek: 1, plan: { rateMode: 'pct', ratePctMin: 0.5, ratePctMax: 0.7 } })
    // 0.6% of ~101 kg is ~0.61 kg a week: losing a kilo, it asks for more food
    expect(proposeKcal(S, lastDay(S))).toMatchObject({ kind: 'kcal', kcal: 2000 + MAX_STEP })
  })

  it('counts a half-logged day out of the estimate it proposes from', () => {
    const S = cut({ perWeek: 1 })
    S.dailyLog.slice(-7).forEach((e, i) => { if (i < 3) e.kcal = 700 })   // three dinners never logged
    const raw = proposeKcal(S, lastDay(S))
    const marks = Object.fromEntries(S.dailyLog.slice(-7, -4).map(e => [e.d, true]))
    const fixed = proposeKcal(withPartial(S, marks), lastDay(S))
    expect(fixed.tdee).toBeGreaterThan(raw.tdee)
    expect(fixed.kind).toBe('keep')
  })

  it('changes nothing over a break or its water week', () => {
    const S = cut({ days: 40, plan: { breaks: [{ from: addDays(START, 30), to: addDays(START, 36) }] } })
    expect(proposeKcal(S, addDays(START, 33)).kind).toBe('break')
    expect(proposeKcal(S, addDays(START, 39)).kind).toBe('hold')
  })
})

describe('the week and the focus', () => {
  it('sums the week with where the weight went, and picks what slipped', () => {
    const S = cut({ perWeek: 1 })
    const today = lastDay(S)
    const ci = checkInFor(S, '2026-11-30') || { from: addDays(today, -7), to: addDays(today, -1) }
    const brief = weekBrief(S, ci, cutReport(S, today))
    expect(brief.change).toBeCloseTo(-1, 1)
    expect(brief.logged).toBe(7)
    expect(suggestFocus(brief, cutReport(S, today).cut)).toBe('prep')
    expect(suggestFocus({ ...brief, weighIns: 3 }, cutReport(S, today).cut)).toBe('weigh')
  })

  it('keeps one record a day, and shows the focus for its week', () => {
    let list = addCheckIn([], { d: '2026-11-09', focus: { id: 'weigh', text: 'Weigh in every morning' }, kcalFrom: 2000, kcalTo: 1900, decision: 'accept' })
    list = addCheckIn(list, { d: '2026-11-09', focus: { id: 'log', text: 'Log every meal' }, decision: 'skip' })
    expect(list).toHaveLength(1)
    expect(list[0].decision).toBe('skip')
    expect(currentFocus({ checkIns: list }, '2026-11-12')).toMatchObject({ id: 'log', since: '2026-11-09' })
    expect(currentFocus({ checkIns: list }, '2026-11-17')).toBeNull()
    expect(normalizeCheckIn({ d: 'bad' })).toBeNull()
  })
})
