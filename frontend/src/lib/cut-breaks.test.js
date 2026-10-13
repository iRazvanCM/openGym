import { describe, expect, it } from 'vitest'
import {
  BREAK_RISE_KG, WATER_DAYS, addDays, addDietDays, cutOf, cutReport, dietDays, expenditure, outOfEstimate, summarize,
  waterWeekOf,
} from './cut.js'

const at = iso => new Date(iso + 'T07:30:00').getTime()
const START = '2026-11-02'
const BREAK = { from: '2026-12-23', to: '2027-01-01' }

// R's cut as the scale would show it: a kilo a week of real loss, a break at maintenance where the
// extra carbs put about 1.2 kg of water on in three days, and the week back where it comes off.
// Intake 2,000 kcal on cut days (maintenance about 3,100), 3,100 on break days.
function cut({ days = 100, breaks = [BREAK], perDay = -1 / 7, noise = 0 } = {}) {
  const bodyweight = [], dailyLog = []
  let fat = 106
  let seed = 11
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5 }
  for (let i = 0; i < days; i++) {
    const d = addDays(START, i)
    const brk = breaks.find(b => d >= b.from && d <= b.to)
    const after = breaks.find(b => d > b.to && d <= addDays(b.to, WATER_DAYS))
    if (!brk) fat += perDay
    let water = 0
    if (brk) water = 1.2 * Math.min(1, (Math.round((new Date(d) - new Date(brk.from)) / 864e5) + 1) / 3)
    if (after) water = 1.2 * Math.max(0, 1 - Math.round((new Date(d) - new Date(after.to)) / 864e5) / 5)
    const w = fat + water + noise * rnd()
    bodyweight.push({ d, w: Math.round(w * 10) / 10, t: at(d) })
    dailyLog.push({ d, t: at(d) + 1, kcal: brk ? 3100 : 2000, protein: 175 })
  }
  return { unit: 'kg', targetW: 85, cut: { start: START, breaks }, bodyweight, dailyLog, workouts: [], measurements: [] }
}

describe('break days', () => {
  const c = cutOf({ cut: { breaks: [BREAK] } })

  it('are left out of the days of dieting, and skipped by the dates ahead', () => {
    expect(dietDays(c, '2026-12-20', '2026-12-23')).toBe(3)
    expect(dietDays(c, '2026-12-20', '2027-01-05')).toBe(16 - 10)
    expect(dietDays(c, '2026-12-25', '2026-12-30')).toBe(0)
    expect(addDietDays(c, '2026-12-20', 5)).toBe('2027-01-04')
    expect(addDietDays(c, '2026-11-02', 7)).toBe('2026-11-09')
  })

  it('and the week after a break stay out of the maintenance estimate', () => {
    expect(outOfEstimate(c, '2026-12-22')).toBe(false)
    expect(outOfEstimate(c, '2026-12-23')).toBe(true)
    expect(outOfEstimate(c, addDays(BREAK.to, WATER_DAYS))).toBe(true)
    expect(outOfEstimate(c, addDays(BREAK.to, WATER_DAYS + 1))).toBe(false)
    expect(waterWeekOf(c, '2027-01-02')).toEqual(BREAK)
    expect(waterWeekOf(c, '2027-01-01')).toBeNull()
  })
})

describe('the plan through a break', () => {
  it('stands still: no "behind plan" from the break or its water, and the right target over it', () => {
    const S = cut()
    const pre = cutReport(S, '2026-12-22')
    const mid = cutReport(S, '2026-12-28')
    expect(mid.phase).toBe('break')
    // the line moves for the 22nd, the last day of dieting, and then stands still
    expect(mid.planW).toBeCloseTo(pre.planW - pre.rateMid / 7, 5)
    expect(cutReport(S, '2027-01-01').planW).toBeCloseTo(mid.planW, 5)
    expect(mid.planHeld).toBe(true)
    expect(mid.vsPlan).toBeCloseTo(pre.vsPlan, 1)                   // nor did "behind plan"
    expect(mid.breakResult.target).toBe(BREAK_RISE_KG)
    expect(mid.breakResult.delta).toBeGreaterThan(0)                // the water shows on the trend…
    const last = cutReport(S, BREAK.to).breakResult
    expect(last.delta).toBeGreaterThan(BREAK_RISE_KG)               // …and by the end is over the target
    expect(last.over).toBe(true)
  })

  it('calls the week back the water week: no pace advice, no calories added, the real change shown', () => {
    const S = cut()
    S.workouts = []   // even a slipping lift would not ask for more food in it
    const r = cutReport(S, '2027-01-03')
    expect(r.phase).toBe('water')
    expect(r.action).toBeNull()
    expect(r.breakResult.back).toBe(true)
    expect(r.breakResult.until).toBe(addDays(BREAK.to, WATER_DAYS))
    expect(r.advice.map(a => a.code)).toContain('water')
    const after = cutReport(S, addDays(BREAK.to, WATER_DAYS + 3))
    expect(after.phase).not.toBe('water')
    expect(after.planHeld).toBe(false)
  })

  it('moves the dates ahead by the break days still to come', () => {
    const S = cut({ days: 30 })
    const r = cutReport(S, addDays(START, 29))
    const none = cutReport({ ...S, cut: { start: START, breaks: [] } }, addDays(START, 29))
    // the same pace, ten days later
    expect(Math.round((new Date(r.planEta) - new Date(none.planEta)) / 864e5)).toBe(10)
  })
})

describe('maintenance through a break', () => {
  it('holds the value from the day before the break, through it and its water week', () => {
    const S = cut()
    const pre = expenditure(S, '2026-12-22')
    expect(pre.ready).toBe(true)
    expect(Math.abs(pre.tdee - 3100)).toBeLessThan(120)
    for (const d of ['2026-12-26', '2027-01-01', '2027-01-05']) {
      const x = expenditure(S, d)
      expect(x.tdee).toBe(pre.tdee)
      expect(x.held).toBe(true)
      expect(x.asOf).toBe('2026-12-22')
    }
  })

  it('reads the cut on both sides of the break as one stretch afterwards, unbent by it', () => {
    const S = cut({ days: 80 })
    const x = expenditure(S, addDays(START, 79))
    expect(x.ready).toBe(true)
    expect(x.held).toBe(false)
    expect(Math.abs(x.tdee - 3100)).toBeLessThan(120)
    // counted with the break in, the water and the maintenance days would bend it far off
    const naive = expenditure({ ...S, cut: { start: START, breaks: [] } }, addDays(START, 79))
    expect(Math.abs(naive.tdee - 3100)).toBeGreaterThan(Math.abs(x.tdee - 3100))
  })
})

describe('a day logged in part', () => {
  it('counts for nothing in the averages and the estimate', () => {
    const S = cut({ days: 40, breaks: [] })
    const day = S.dailyLog[30].d
    S.dailyLog[30].kcal = 600
    expect(summarize(S, day, day, undefined, addDays(day, 1)).kcal.avg).toBe(600)
    S.dailyLog[30].partial = true
    expect(summarize(S, day, day, undefined, addDays(day, 1)).kcal.n).toBe(0)
    const x = expenditure(S, addDays(START, 39))
    expect(x.intake).toBe(2000)
  })
})
