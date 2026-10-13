import { describe, expect, it } from 'vitest'
import { addDays, cutOf, cutReport } from './cut.js'
import { finishCut, maintainKcal, maintainZone, startMiniCut } from './maintain.js'
import { proposeKcal } from './checkin.js'

const at = iso => new Date(iso + 'T07:30:00').getTime()

describe('the zones after the cut', () => {
  it('are green to +1.4 kg, yellow to +2.3, red above (in pounds for an lb profile)', () => {
    expect(maintainZone(86.4, 85).zone).toBe('green')
    expect(maintainZone(87, 85).zone).toBe('yellow')
    expect(maintainZone(87.4, 85).zone).toBe('red')
    expect(maintainZone(190, 187, 2.20462262).zone).toBe('green')
    expect(maintainZone(null, 85)).toBeNull()
  })
})

describe('ending the cut', () => {
  const S = { cut: { start: '2026-11-02', kcal: 1900, maintenance: 3000 } }

  it('goes straight to maintenance, or a third of the way', () => {
    const c = finishCut(S, { trendW: 85.04, tdee: 3015, today: '2027-03-20' })
    expect(c).toMatchObject({ mode: 'maintain', endW: 85.04, endedAt: '2027-03-20', kcal: 3020, cutKcal: 1900 })
    expect(finishCut(S, { trendW: 85, tdee: 3000, today: '2027-03-20', gradual: true }).kcal).toBe(2270)
  })

  it('a mini-cut goes back to the cut\'s calories from today', () => {
    const m = startMiniCut({ cut: finishCut(S, { trendW: 85, tdee: 3000, today: '2027-03-20' }) }, { today: '2027-06-01' })
    expect(m).toMatchObject({ mode: 'cut', start: '2027-06-01', kcal: 1900 })
  })

  it('steps towards maintenance 300 at a time, and holds in the yellow zone', () => {
    const c = cutOf({ cut: { kcal: 2300, maintenance: 3000 } })
    expect(maintainKcal(c, { tdee: 3000, zone: 'green' })).toMatchObject({ kind: 'kcal', kcal: 2600 })
    expect(maintainKcal(c, { tdee: 2320, zone: 'green' }).kind).toBe('keep')
    expect(maintainKcal(c, { tdee: 3000, zone: 'yellow' })).toMatchObject({ kind: 'keep', kcal: 2300 })
    expect(maintainKcal(c, { tdee: 3000, zone: 'red' }).kind).toBe('minicut')
  })
})

describe('the report in maintenance', () => {
  it('judges the zone, not the pace, and the check-in follows it', () => {
    const start = '2027-03-01'
    const bodyweight = [], dailyLog = []
    for (let i = 0; i < 28; i++) {
      const d = addDays(start, i)
      bodyweight.push({ d, w: 85 + i * 0.07, t: at(d) })   // creeping up 0.5 kg a week
      dailyLog.push({ d, t: at(d), kcal: 3000 })
    }
    const S = { unit: 'kg', bodyweight, dailyLog, cut: { start: '2026-11-02', mode: 'maintain', endW: 85, endedAt: start, kcal: 3000 } }
    const r = cutReport(S, addDays(start, 27))
    expect(r.phase).toBe('maintain')
    expect(r.zone.zone).toBe('yellow')
    expect(r.action).toBeNull()
    expect(r.advice.map(a => a.code)).toContain('zone-yellow')
    expect(proposeKcal(S, addDays(start, 27))).toMatchObject({ kind: 'keep', maintain: true })
  })
})
