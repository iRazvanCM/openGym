import { describe, expect, it } from 'vitest'
import {
  CUT_DEFAULTS, addDays, cardioMinutesOn, cutOf, cutReport, dailyLogCSV, daysBetween, expenditure,
  consistency, kcalForRate, logHasValues, normalizeDailyLogState, normalizeLogEntry, strengthCheck, streaks,
  summarize, trendOn, weeklyRows, weightTrend,
} from './cut.js'

// Deterministic noise, so a failing case fails the same way every run.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const gauss = r => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
const at = iso => new Date(iso + 'T07:30:00').getTime()

// A cut as the scale and the log would record it: `perDay` of real loss (kg a day), the first
// week's water on top, daily noise, the same intake every day.
function cutState({ start = '2026-11-02', days = 42, perDay = -0.15, noise = 0, water = 1.5, intake = 2000, from = 106, seed = 7, skip = () => false, ...rest } = {}) {
  const r = rng(seed)
  const bodyweight = [], dailyLog = []
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i)
    if (skip(i)) continue
    const w = from + perDay * i - water * (1 - Math.exp(-i / 3)) + noise * gauss(r)
    bodyweight.push({ d, w: Math.round(w * 10) / 10, t: at(d) })
    dailyLog.push({ d, t: at(d) + 1, kcal: intake, protein: 175, steps: 10000, cardio: 45, sleep: 7.5, alcohol: false })
  }
  return { unit: 'kg', targetW: 85, cut: { start }, bodyweight, dailyLog, workouts: [], measurements: [], ...rest }
}
const lastDay = S => S.bodyweight[S.bodyweight.length - 1].d

describe('cut settings', () => {
  it('falls back to the plan defaults for anything missing or out of range', () => {
    const c = cutOf({ cut: { start: '2026-02-30', kcal: 50, protein: '180', rateMin: 1.5, rateMax: 1.0, breaks: [{ from: '2026-12-31', to: '2026-12-24' }, { from: '2026-12-24', to: '2027-01-01' }, null] } })
    expect(c.start).toBeNull()
    expect(c.kcal).toBe(CUT_DEFAULTS.kcal)
    expect(c.protein).toBe(180)
    expect([c.rateMin, c.rateMax]).toEqual([CUT_DEFAULTS.rateMin, CUT_DEFAULTS.rateMax])
    expect(c.breaks).toEqual([{ from: '2026-12-24', to: '2027-01-01' }])
    expect(cutOf({}).minKcal).toBe(1800)
  })
})

describe('daily log entries', () => {
  it('keeps numbers in range, empties zeroes and junk, and trims the note', () => {
    const e = normalizeLogEntry({ d: '2026-11-03', kcal: '1950', protein: 0, steps: 12000.4, sleep: 7.46, cardio: -5, energy: 4.2, hunger: 9, alcohol: 'no', gym: true, note: '  legs ' })
    expect(e).toMatchObject({ d: '2026-11-03', kcal: 1950, protein: null, steps: 12000, sleep: 7.5, cardio: null, energy: 4, hunger: null, alcohol: null, gym: true, note: 'legs' })
    expect(normalizeLogEntry({ d: '2026-13-01', kcal: 2000 })).toBeNull()
    expect(logHasValues(normalizeLogEntry({ d: '2026-11-03' }))).toBe(false)
  })

  it('folds two rows of one day: the later wins field by field, a field it left empty keeps the earlier', () => {
    const s = normalizeDailyLogState({ dailyLog: [
      { d: '2026-11-04', t: 5, kcal: 2100, note: 'later' },
      { d: '2026-11-03', t: 1, steps: 9000 },
      { d: '2026-11-04', t: 2, kcal: 1900, protein: 160 },
      { d: '2026-11-05', t: 3 },
    ] })
    expect(s.dailyLog.map(e => e.d)).toEqual(['2026-11-03', '2026-11-04'])
    expect(s.dailyLog[1]).toMatchObject({ kcal: 2100, protein: 160, note: 'later', t: 5 })
  })
})

describe('trend weight', () => {
  it('fills the days between weigh-ins and never runs past the last one', () => {
    const tr = weightTrend([{ d: '2026-11-01', w: 100 }, { d: '2026-11-05', w: 99.2 }, { d: 'bad', w: 1 }, { d: '2026-11-03', w: 0 }])
    expect(tr.map(p => p.d)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'])
    expect(tr.filter(p => p.w != null).length).toBe(2)
    expect(trendOn(tr, '2026-12-01').d).toBe('2026-11-05')
    expect(trendOn(tr, '2026-10-01')).toBeNull()
  })

  it('tracks a steady loss without the lag of a moving average', () => {
    const S = cutState({ days: 56, noise: 0.5, water: 0 })
    const tr = weightTrend(S.bodyweight)
    const end = tr[tr.length - 1]
    const truth = 106 - 0.15 * 55
    expect(Math.abs(end.L - truth)).toBeLessThan(0.45)
    expect(Math.abs(-end.T * 7 - 1.05)).toBeLessThan(0.25)
  })
})

describe('maintenance from energy balance', () => {
  it('waits for two weeks of trend after the first week, then finds intake plus what came off', () => {
    const early = cutState({ days: 18 })
    expect(expenditure(early, lastDay(early)).ready).toBe(false)
    const S = cutState({ days: 42 })
    const x = expenditure(S, lastDay(S))
    expect(x.ready).toBe(true)
    // 2,000 kcal eaten while losing 0.15 kg a day: 2,000 + 0.15 × 7,700 ≈ 3,155
    expect(Math.abs(x.tdee - 3155)).toBeLessThan(90)
  })

  it('suggests the calories for a rate but never below the floor', () => {
    expect(kcalForRate({ unit: 'kg' }, 3155, 1.0)).toBe(2060)
    expect(kcalForRate({ unit: 'kg', cut: { minKcal: 2200 } }, 3155, 1.0)).toBe(2200)
  })
})

describe('where the cut stands', () => {
  it('calls the first week water and does not judge the rate yet', () => {
    const S = cutState({ days: 4 })
    expect(cutReport(S, lastDay(S)).phase).toBe('early')
  })

  it('is on track at about a kilo a week, with the numbers to the goal', () => {
    const S = cutState({ days: 35, perDay: -1 / 7, noise: 0.3 })
    const r = cutReport(S, lastDay(S))
    expect(r.phase).toBe('ok')
    expect(r.action).toBeNull()
    expect(r.startW).toBeGreaterThan(105)
    expect(r.lost).toBeGreaterThan(4)
    expect(r.toGo).toBeGreaterThan(14)
    expect(r.pctDone).toBeGreaterThan(0.15)
    expect(daysBetween(lastDay(S), r.eta)).toBeGreaterThan(70)
    expect(r.week).toBe(5)
  })

  it('a second slow week is a stall: 100 kcal less, or more steps once at the floor', () => {
    const S = cutState({ days: 35, perDay: -0.3 / 7, water: 0 })
    const r = cutReport(S, lastDay(S))
    expect(r.phase).toBe('stall')
    expect(r.action).toEqual({ kind: 'kcal', value: 1900 })
    const floor = cutReport({ ...S, cut: { start: S.cut.start, kcal: 1850 } }, lastDay(S))
    expect(floor.action).toEqual({ kind: 'steps', value: 12000 })
  })

  it('asks for a change once, then gives it two weeks before asking again', () => {
    const S = cutState({ days: 35, perDay: -0.3 / 7, water: 0 })
    S.cut = { start: S.cut.start, kcal: 1900, changedAt: addDays(lastDay(S), -5) }
    const r = cutReport(S, lastDay(S))
    expect(r.phase).toBe('stall')
    expect(r.action).toBeNull()
    expect(r.advice.find(a => a.code === 'settling')).toMatchObject({ until: addDays(lastDay(S), 9) })
    S.cut.changedAt = addDays(lastDay(S), -14)
    expect(cutReport(S, lastDay(S)).action).toEqual({ kind: 'kcal', value: 1800 })
  })

  it('promises the pace the floor gives when the range would need less than the floor', () => {
    const S = cutState({ days: 42, perDay: -0.3 / 7, water: 0, intake: 2000 })
    const tdee = cutReport(S, lastDay(S)).advice.find(a => a.code === 'tdee')
    expect(tdee.kcal).toBe(1800)
    expect(tdee.rate).toBeCloseTo((tdee.tdee - 1800) * 7 / 7700, 5)
  })

  it('sees a stall that starts mid-cut as soon as two weeks of weigh-ins are flat, and one flat week as slow', () => {
    // a kilo a week for three weeks, then the scale stops
    const stall = cutState({ days: 36, perDay: 0, water: 0, noise: 0.3 })
    stall.bodyweight.forEach((b, i) => { b.w = Math.round((106 - Math.min(i, 21) / 7 + (i % 3 - 1) * 0.3) * 10) / 10 })
    const r = cutReport(stall, lastDay(stall))
    expect(r.phase).toBe('stall')
    expect(r.action).toEqual({ kind: 'kcal', value: 1900 })
    const week = cutState({ days: 36, perDay: 0, water: 0 })
    week.bodyweight.forEach((b, i) => { b.w = Math.round((106 - Math.min(i, 28) / 7 + (i % 3 - 1) * 0.3) * 10) / 10 })
    expect(cutReport(week, lastDay(week)).phase).toBe('slow')
  })

  it('flags a fast loss, a gain, a diet break and weigh-ins that stopped', () => {
    const fast = cutState({ days: 35, perDay: -2 / 7 })
    expect(cutReport(fast, lastDay(fast)).phase).toBe('fast')
    const gain = cutState({ days: 35, perDay: 0.05, water: 0 })
    expect(cutReport(gain, lastDay(gain)).phase).toBe('gain')
    const brk = cutState({ days: 35 })
    brk.cut.breaks = [{ from: addDays(lastDay(brk), -2), to: addDays(lastDay(brk), 5) }]
    const r = cutReport(brk, lastDay(brk))
    expect(r.phase).toBe('break')
    expect(r.advice.find(a => a.code === 'break')).toBeTruthy()
    const stale = cutState({ days: 20 })
    expect(cutReport(stale, addDays(lastDay(stale), 10)).phase).toBe('stale')
  })

  it('judges an lb profile in pounds', () => {
    const S = cutState({ days: 35, perDay: -2.2 / 7, from: 233, water: 3 })
    S.unit = 'lb'
    S.targetW = 187
    const r = cutReport(S, lastDay(S))
    expect(r.phase).toBe('ok')
    expect(r.rateMax).toBeCloseTo(1.2 * 2.2046, 2)
  })

  it('points at what slipped this week', () => {
    const S = cutState({ days: 28 })
    for (const e of S.dailyLog.slice(-7)) { e.protein = 120; e.sleep = 6; e.steps = 5000 }
    S.dailyLog[S.dailyLog.length - 1].alcohol = true
    const codes = cutReport(S, lastDay(S)).advice.map(a => a.code)
    expect(codes).toEqual(expect.arrayContaining(['protein-low', 'sleep-low', 'steps-low', 'alcohol', 'tdee']))
  })
})

describe('summaries and streaks', () => {
  const day = '2026-11-10'
  const workout = (d, sets) => ({ id: 'w' + d, d, start: at(d), end: at(d) + 3600000, entries: [{ id: '0025', sets }] })

  it('takes cardio from the workouts when the log has none, and counts gym days either way', () => {
    const S = {
      unit: 'kg', bodyweight: [], measurements: [],
      workouts: [workout(day, [{ min: 30, speed: 6, done: true }, { min: 15, speed: 6, done: true }])],
      dailyLog: [{ d: addDays(day, 1), t: 1, gym: true, kcal: 2050, protein: 170 }],
    }
    expect(cardioMinutesOn(S, day)).toBe(45)
    const s = summarize(S, day, addDays(day, 1))
    expect(s.cardio.total).toBe(45)
    expect(s.gym).toBe(2)
    expect(s.kcal.hit).toBe(1)
    expect(s.protein.hit).toBe(1)
  })

  it('counts streaks through yesterday while today is still empty', () => {
    const S = { dailyLog: [0, 1, 2, 3].map(i => ({ d: addDays(day, -i - 1), t: 1, alcohol: i === 2, kcal: 2000 })), bodyweight: [] }
    const s = streaks(S, day)
    expect(s.log).toBe(4)
    expect(s.alcoholFree).toBe(2)
  })

  it('rolls the weeks up, newest first, with the change of the weekly average', () => {
    const S = cutState({ start: '2026-11-02', days: 21 })
    const rows = weeklyRows(S, '2026-11-02', '2026-11-22', 1)
    expect(rows.map(r => r.key)).toEqual(['2026-11-16', '2026-11-09', '2026-11-02'])
    expect(rows[0].change).toBeLessThan(0)
    expect(rows[2].change).toBeNull()
    expect(rows[0].kcal.avg).toBe(2000)
  })
})

describe('strength check', () => {
  const sets = w => [{ w, r: 5, done: true }, { w, r: 5, done: true }]
  const wk = (d, w) => ({ id: 'w' + d, d, start: at(d), end: at(d) + 3600000, entries: [{ id: '0025', sets: sets(w) }] })

  it('waits three weeks, then compares the last two weeks with the start', () => {
    const start = '2026-11-02'
    const S = { unit: 'kg', cut: { start }, workouts: [wk(addDays(start, -3), 100), wk(addDays(start, 2), 100), wk(addDays(start, 25), 98), wk(addDays(start, 29), 99)] }
    expect(strengthCheck(S, addDays(start, 10))).toMatchObject({ ready: false, reason: 'early' })
    const r = strengthCheck(S, addDays(start, 30))
    expect(r.ready).toBe(true)
    expect(r.status).toBe('hold')
    const drop = { ...S, workouts: [...S.workouts.slice(0, 2), wk(addDays(start, 27), 88)] }
    expect(strengthCheck(drop, addDays(start, 30)).status).toBe('drop')
  })
})

describe('CSV export', () => {
  it('writes one row a day with the weight, trend, log and a quoted note', () => {
    const S = cutState({ days: 3 })
    S.dailyLog[1].note = 'pizza, "cheat"'
    const csv = dailyLogCSV(S).trim().split('\n')
    expect(csv[0]).toBe('date,weight_kg,trend_kg,kcal,protein_g,carbs_g,fat_g,food_items,steps,cardio_min,sleep_h,alcohol,gym,energy_1_5,hunger_1_5,waist_cm,note')
    expect(csv).toHaveLength(4)
    expect(csv[2]).toContain('"pizza, ""cheat"""')
    expect(csv[1].split(',')[3]).toBe('2000')
    expect(csv[1].split(',')[11]).toBe('no')
  })

  it('takes a day with a food diary from the diary, with its carbs and fat', () => {
    const S = cutState({ days: 2 })
    S.dailyLog[0].food = [FOOD('a', 'b', 200, 22.5, 0, 2.6), FOOD('b', 'l', 300, 7.1, 80, 0.7)]
    const row = dailyLogCSV(S).trim().split('\n')[1].split(',')
    expect(row.slice(3, 8)).toEqual(['1291', '66', '240', '7', '2'])
  })
})

// A diary item: `amount` g of a food with these numbers per 100 g.
const FOOD = (id, meal, amount, p, c, f, kcal = 4 * p + 4 * c + 9 * f) => ({ id, meal, name: id, amount, per100: { kcal, p, c, f } })

describe('the food diary in the log', () => {
  const S0 = () => cutState({ days: 21, noise: 0 })

  it('keeps a day\'s food, its done mark and what Apple Health filled in', () => {
    const e = normalizeLogEntry({ d: '2026-11-03', steps: 9000, sleep: 7, food: [FOOD('x', 'b', 100, 10, 10, 10), { junk: 1 }], done: true, hk: ['steps', 'sleep', 'kcal', 'cardio'] })
    expect(e.food).toHaveLength(1)
    expect(e.food[0]).toMatchObject({ kcal: 170, p: 10 })
    expect(e.done).toBe(true)
    expect(e.hk).toEqual(['steps', 'sleep'])   // not kcal (Health never fills it), not an empty cardio
    expect(logHasValues(normalizeLogEntry({ d: '2026-11-03', food: [FOOD('x', 'b', 50, 1, 1, 1)] }))).toBe(true)
    expect(normalizeLogEntry({ d: '2026-11-03', done: true }).done).toBeUndefined()   // nothing to complete
  })

  it('folds two halves of a day\'s diary into one, the later version of an item both have', () => {
    const s = normalizeDailyLogState({ dailyLog: [
      { d: '2026-11-04', t: 2, food: [FOOD('a', 'b', 100, 10, 0, 0), FOOD('b', 'l', 100, 20, 0, 0)], steps: 8000, hk: ['steps'] },
      { d: '2026-11-04', t: 5, food: [FOOD('b', 'l', 200, 20, 0, 0), FOOD('c', 'd', 100, 5, 0, 0)], steps: 9000 },
    ] })
    expect(s.dailyLog).toHaveLength(1)
    const e = s.dailyLog[0]
    expect(e.food.map(it => it.id)).toEqual(['a', 'b', 'c'])
    expect(e.food.find(it => it.id === 'b').amount).toBe(200)
    expect(e.steps).toBe(9000)
    expect(e.hk).toBeUndefined()   // the steps kept were typed, not Health's
  })

  it('counts the diary\'s calories and protein instead of the typed ones', () => {
    const S = S0()
    const d = S.dailyLog[20].d
    S.dailyLog[19].food = [FOOD('a', 'b', 500, 30, 0, 0), FOOD('b', 'l', 400, 0, 50, 10)]   // 600 + 1160 kcal, 150 g protein
    const sum = summarize(S, S.dailyLog[19].d, S.dailyLog[19].d, undefined, d)
    expect(sum.kcal.avg).toBe(1760)
    expect(sum.protein.avg).toBe(150)
    expect(sum.carbs.avg).toBe(200)
    expect(sum.fat.avg).toBe(40)
    expect(sum.foodDays).toBe(1)
    expect(sum.protein.hit).toBe(0)
  })

  it('leaves today\'s diary out of the averages until the day is marked complete', () => {
    const S = S0()
    const today = S.dailyLog[20].d
    S.dailyLog[20].food = [FOOD('a', 'b', 100, 10, 50, 5)]   // breakfast only
    expect(summarize(S, today, today, undefined, today).kcal.n).toBe(0)
    expect(summarize(S, today, today, undefined, addDays(today, 1)).kcal.n).toBe(1)   // the next day it counts
    S.dailyLog[20].done = true
    expect(summarize(S, today, today, undefined, today).kcal.avg).toBe(285)
    // the typed total of a day without a diary counts as it is
    expect(summarize(S, S.dailyLog[19].d, today, undefined, today).kcal.n).toBe(2)
  })

  it('works out maintenance from the diary\'s calories, without today\'s half-eaten day', () => {
    const S = cutState({ days: 35, noise: 0.3, intake: 2000 })
    const today = lastDay(S)
    const before = expenditure(S, today)
    S.dailyLog.forEach(e => { e.food = [FOOD('m', 'l', 1000, 0, 50, 0)]; e.kcal = 999 })   // 2,000 kcal from food
    S.dailyLog[S.dailyLog.length - 1].food = [FOOD('m', 'b', 100, 0, 50, 0)]               // today: 200 so far
    const after = expenditure(S, today)
    expect(after.ready).toBe(true)
    expect(after.intake).toBe(2000)
    expect(after.logged).toBe(before.logged - 1)
    expect(Math.abs(after.tdee - before.tdee)).toBeLessThanOrEqual(20)
  })

  it('leaves carbs to what calories, protein and fat leave', () => {
    expect(cutOf({}).fat).toBe(60)
    expect(cutOf({}).carbs).toBe(190)
    expect(cutOf({ cut: { kcal: 1900 } }).carbs).toBe(165)
    expect(cutOf({ cut: { kcal: 1000, protein: 200, fat: 80 } }).carbs).toBe(0)
  })
})

describe('forgiving counters', () => {
  const day = '2026-11-20'
  const log = (d, extra = {}) => ({ d, t: 1, kcal: 2000, ...extra })
  const days = n => Array.from({ length: n }, (_, i) => addDays(day, -i))

  it('counts the last seven days, and a missed day costs one, not the run so far', () => {
    const S = { dailyLog: days(20).filter(d => d !== addDays(day, -2)).map(d => log(d, { alcohol: false })), bodyweight: days(7).map(d => ({ d, w: 100, t: 1 })) }
    const c = consistency(S, day)
    expect(c.log).toMatchObject({ n: 6, of: 7, run: 2, best: 17 })
    expect(c.weigh).toMatchObject({ n: 7, of: 7 })
    expect(c.dry.n).toBe(6)
  })

  it('leaves a break day or a sick day out of the count and the run', () => {
    const sick = addDays(day, -3)
    const S = {
      cut: { breaks: [{ from: addDays(day, -1), to: addDays(day, -1) }] },
      dayNotes: { [sick]: { tag: 'sick', _ts: 1 } },
      dailyLog: days(10).filter(d => d !== sick && d !== addDays(day, -1)).map(d => log(d)),
      bodyweight: [],
    }
    const c = consistency(S, day)
    expect(c.log).toMatchObject({ n: 5, of: 5, run: 8, best: 8 })
  })

  it('ends at yesterday while today has nothing yet', () => {
    const S = { dailyLog: days(8).slice(1).map(d => log(d)), bodyweight: [] }
    expect(consistency(S, day)).toMatchObject({ to: addDays(day, -1), log: { n: 7, of: 7, run: 7 } })
  })
})
