import { describe, expect, it } from 'vitest'
import { addDays } from './cut.js'
import { dayDensity, densityReport } from './density.js'

const item = (id, amount, kcalPer100, unit = 'g', p = 10) => ({ id, meal: 'l', name: id, src: 'custom', unit, amount, per100: { kcal: kcalPer100, p, c: 0, f: 0 }, kcal: Math.round(kcalPer100 * amount / 100), p: p * amount / 100, c: 0, f: 0 })

describe('energy density', () => {
  it('is the calories of the weighed foods over their grams, drinks left out', () => {
    const e = { d: '2026-11-02', food: [item('stew', 600, 100), item('bread', 100, 250), item('milk', 500, 50, 'ml')] }
    expect(dayDensity(e)).toEqual({ kcal: 850, grams: 700, density: 850 / 700 })
    expect(dayDensity({ food: [item('nuts', 50, 600)] })).toBeNull()   // too little weighed to tell
  })

  it('sets the full days against the hungry ones', () => {
    const today = '2026-11-30'
    const dailyLog = []
    for (let i = 0; i < 20; i++) {
      const d = addDays(today, -i - 1), hungry = i % 2 === 0
      dailyLog.push({ d, t: 1, hunger: hungry ? 4 : 2, sleep: hungry ? 6.5 : 7.8,
        food: hungry ? [item('pastry', 500, 380, 'g', 6)] : [item('soup', 900, 60, 'g', 5), item('chicken', 400, 110, 'g', 23), item('rice', 200, 130, 'g', 3)] })
    }
    const r = densityReport({ dailyLog }, today)
    expect(r.ready).toBe(true)
    expect(r.hungry.density).toBeCloseTo(3.8, 1)
    expect(r.full.density).toBeLessThan(1)
    expect(r.full.grams).toBe(1500)
    expect(r.full.sleep).toBe(7.8)
    expect(r.week.n).toBe(6)
  })
})
