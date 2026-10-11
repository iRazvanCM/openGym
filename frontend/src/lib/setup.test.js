import { describe, expect, it } from 'vitest'
import { activityFactor, ageOn, bmr, profileOf, suggestPlan, weeksTo } from './setup.js'

describe('the setup', () => {
  it('works out resting energy with Mifflin–St Jeor', () => {
    // 10 × 106 + 6.25 × 174 − 5 × 32 + 5
    expect(bmr({ sex: 'm', age: 32, heightCm: 174, weightKg: 106 })).toBeCloseTo(1992.5)
    expect(bmr({ sex: 'f', age: 30, heightCm: 165, weightKg: 70 })).toBeCloseTo(700 + 1031.25 - 150 - 161)
    expect(bmr({ sex: 'm', age: null, heightCm: 174, weightKg: 106 })).toBeNull()
  })

  it('lands near the plan made by hand: ~3,200 maintenance, ~2,000 kcal, 170 g protein, 60 g fat', () => {
    const p = suggestPlan({ sex: 'm', age: 32, heightCm: 174, weightKg: 106, goalKg: 85, activity: 'high', rateKgWk: 1 })
    expect(p.maintenance).toBe(3190)
    expect(p.kcal).toBe(2090)
    expect(p.protein).toBe(170)
    expect(p.fat).toBe(60)
    expect(p.carbs).toBe(Math.round((2090 - 680 - 540) / 4))
    expect(p.rate).toBe(1)
  })

  it('never goes under the floor, and says what pace the floor gives', () => {
    const p = suggestPlan({ sex: 'f', age: 50, heightCm: 158, weightKg: 62, goalKg: 55, activity: 'low', rateKgWk: 1 })
    expect(p.kcal).toBe(p.floor)
    expect(p.floor).toBeGreaterThanOrEqual(1200)
    expect(p.rate).toBeLessThan(1)
    expect(suggestPlan({ sex: 'm', heightCm: 180, weightKg: 90 })).toBeNull()
  })

  it('reads the profile, with high activity until set and nonsense left out', () => {
    expect(profileOf({ profile: { sex: 'm', born: 1994, heightCm: '174', activity: 'nope' } })).toEqual({ sex: 'm', born: 1994, heightCm: 174, activity: 'high' })
    expect(profileOf({})).toEqual({ sex: null, born: null, heightCm: null, activity: 'high' })
    expect(profileOf({ profile: { heightCm: 20, born: 3000 } })).toMatchObject({ heightCm: null, born: null })
    expect(ageOn(1994, '2026-11-01')).toBe(32)
    expect(activityFactor('light')).toBe(1.375)
    expect(weeksTo(106, 85, 1)).toBe(21)
    expect(weeksTo(80, 85, 1)).toBeNull()
  })
})
