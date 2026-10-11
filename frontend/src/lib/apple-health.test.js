import { describe, expect, it } from 'vitest'
import { applyHealthDays, healthDays, workoutKind } from './apple-health.js'

const at = (iso, hhmm) => new Date(`${iso}T${hhmm}:00`).getTime()
const H = 3600e3

describe('reading Apple Health samples day by day', () => {
  it('takes each day\'s step count as Apple Health summed it', () => {
    const d = healthDays({ steps: [{ d: '2026-11-02', steps: 10234.6 }, { d: '2026-11-03', steps: 0 }, { d: '2026-10-30', steps: 5000 }] }, { from: '2026-11-01', to: '2026-11-03' })
    expect(d['2026-11-02'].steps).toBe(10235)
    expect(d['2026-11-03']).toBeUndefined()
    expect(d['2026-10-30']).toBeUndefined()
  })

  it('puts a night on the morning it ended, counting overlapping sources once and awake time not at all', () => {
    const sleep = [
      // a Garmin: 23:00–06:30 asleep with a 20-minute wake in the middle
      { start: at('2026-11-01', '23:00'), end: at('2026-11-02', '02:00'), value: 'core', source: 'garmin' },
      { start: at('2026-11-02', '02:00'), end: at('2026-11-02', '02:20'), value: 'awake', source: 'garmin' },
      { start: at('2026-11-02', '02:20'), end: at('2026-11-02', '06:30'), value: 'deep', source: 'garmin' },
      // the iPhone: the same night as asleep, a little longer at the end
      { start: at('2026-11-01', '23:10'), end: at('2026-11-02', '06:50'), value: 'asleep', source: 'iphone' },
      // in bed only: ignored when there are asleep samples
      { start: at('2026-11-01', '22:30'), end: at('2026-11-02', '07:00'), value: 'inBed', source: 'iphone' },
      // an afternoon nap counts for its own day
      { start: at('2026-11-02', '14:00'), end: at('2026-11-02', '14:40'), value: 'asleep', source: 'iphone' },
    ]
    const d = healthDays({ sleep }, { from: '2026-11-01', to: '2026-11-02' })
    expect(d['2026-11-02'].sleep).toBe(8.5)   // 23:00–06:50 (the union) + 40 min nap
    expect(d['2026-11-01']).toBeUndefined()
  })

  it('falls back to time in bed for a phone that only knows that', () => {
    const d = healthDays({ sleep: [{ start: at('2026-11-02', '00:00'), end: at('2026-11-02', '07:00'), value: 'inBed' }] }, { from: '2026-11-02', to: '2026-11-02' })
    expect(d['2026-11-02'].sleep).toBe(7)
  })

  it('takes the first weigh-in of a day', () => {
    const d = healthDays({ weights: [
      { t: at('2026-11-02', '19:00'), kg: 105.6 }, { t: at('2026-11-02', '07:05'), kg: 104.9 }, { t: at('2026-11-03', '07:00'), kg: 5 },
    ] }, { from: '2026-11-01', to: '2026-11-03' })
    expect(d['2026-11-02']).toMatchObject({ weightKg: 104.9, weighedAt: at('2026-11-02', '07:05') })
    expect(d['2026-11-03']).toBeUndefined()
  })

  it('counts cardio minutes, a run two sources recorded once, and strength as training', () => {
    const workouts = [
      { start: at('2026-11-02', '07:00'), end: at('2026-11-02', '07:45'), type: 37 },   // running, the watch
      { start: at('2026-11-02', '07:02'), end: at('2026-11-02', '07:44'), type: 37 },   // the same run, the phone
      { start: at('2026-11-02', '18:00'), end: at('2026-11-02', '18:20'), type: 52 },   // a walk
      { start: at('2026-11-02', '17:00'), end: at('2026-11-02', '18:00'), type: 50 },   // weights
      { start: at('2026-11-03', '08:00'), end: at('2026-11-03', '08:30'), type: 57 },   // yoga: neither
    ]
    const d = healthDays({ workouts }, { from: '2026-11-02', to: '2026-11-03' })
    expect(d['2026-11-02']).toMatchObject({ cardio: 65, trained: true })
    expect(d['2026-11-03']).toBeUndefined()
    expect([workoutKind(13), workoutKind(20), workoutKind(62), workoutKind(3000)]).toEqual(['cardio', 'strength', 'other', 'cardio'])
  })
})

describe('putting Health into the log', () => {
  const base = () => ({ unit: 'kg', bodyweight: [{ d: '2026-11-02', w: 105.2, t: 1 }], dailyLog: [
    { d: '2026-11-02', t: 1, steps: 8000, kcal: 2000 },                      // steps typed by hand
    { d: '2026-11-03', t: 1, steps: 4000, sleep: 6, hk: ['steps', 'sleep'] }, // from Health earlier
  ] })

  it('fills empty fields and marks them as Health\'s, never touching what was typed', () => {
    const S = base()
    const n = applyHealthDays(S, {
      '2026-11-02': { steps: 11000, sleep: 7.5, cardio: 40, trained: true, weightKg: 104.8, weighedAt: 5 },
      '2026-11-03': { steps: 12500 },
      '2026-11-04': { steps: 3000, weightKg: 104.5, weighedAt: 9 },
    }, 100)
    const day = d => S.dailyLog.find(e => e.d === d)
    expect(day('2026-11-02')).toMatchObject({ steps: 8000, sleep: 7.5, cardio: 40, gym: true, kcal: 2000, t: 100 })
    expect(day('2026-11-02').hk).toEqual(['sleep', 'cardio', 'gym'])
    expect(day('2026-11-03')).toMatchObject({ steps: 12500, sleep: 6 })            // Health's own field follows Health
    expect(day('2026-11-04')).toMatchObject({ steps: 3000, hk: ['steps'] })         // a new day
    expect(S.bodyweight.map(b => [b.d, b.w])).toEqual([['2026-11-02', 105.2], ['2026-11-04', 104.5]])   // only the day without one
    expect(n).toBe(4)
  })

  it('changes nothing when Health says the same again', () => {
    const S = base()
    const days = { '2026-11-03': { steps: 4000, sleep: 6 } }
    expect(applyHealthDays(S, days, 100)).toBe(0)
    expect(S.dailyLog[1].t).toBe(1)
  })

  it('converts a weigh-in for an lb profile', () => {
    const S = { unit: 'lb', bodyweight: [], dailyLog: [] }
    applyHealthDays(S, { '2026-11-05': { weightKg: 100, weighedAt: 7 } })
    expect(S.bodyweight).toEqual([{ d: '2026-11-05', w: 220.5, t: 7 }])
  })

  it('gives a hand edit the field from then on', () => {
    const S = base()
    S.dailyLog[1].steps = 9999
    S.dailyLog[1].hk = ['sleep']   // what the daily log form leaves after the steps were typed over
    applyHealthDays(S, { '2026-11-03': { steps: 12500, sleep: 7 } }, 100)
    expect(S.dailyLog[1]).toMatchObject({ steps: 9999, sleep: 7 })
  })
})
