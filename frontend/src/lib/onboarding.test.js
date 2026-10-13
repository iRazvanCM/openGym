import { describe, expect, it } from 'vitest'
import {
  applyOnboarding, bmiBand, bmiOf, checkAnswers, healthyRange, paceBand, planFor, recommendGoal, recommendedPace,
  suggestGoalWeight,
} from './onboarding.js'
import { cutOf } from './cut.js'

const R = { sex: 'm', age: 32, heightCm: 174, weightKg: 106, activity: 'high' }

describe('where the weight stands', () => {
  it('works out the BMI and its WHO band', () => {
    expect(bmiOf(106, 174)).toBe(35)
    expect(bmiBand(35)).toBe('obese2')
    expect(bmiBand(34.9)).toBe('obese1')
    expect(bmiBand(40)).toBe('obese3')
    expect(bmiBand(29.9)).toBe('over')
    expect(bmiBand(25)).toBe('over')
    expect(bmiBand(24.9)).toBe('healthy')
    expect(bmiBand(18.5)).toBe('healthy')
    expect(bmiBand(18.4)).toBe('under')
    expect(bmiOf(null, 174)).toBeNull()
    expect(bmiBand(null)).toBeNull()
  })

  it('gives the healthy weights for a height', () => {
    expect(healthyRange(174)).toEqual({ min: 56, max: 75.4 })
    expect(healthyRange(0)).toBeNull()
  })

  it('points to losing from a BMI of 25, gaining under 18.5, keeping it in between', () => {
    expect(recommendGoal(35)).toBe('lose')
    expect(recommendGoal(25)).toBe('lose')
    expect(recommendGoal(22)).toBe('maintain')
    expect(recommendGoal(18.4)).toBe('gain')
    expect(recommendGoal(null)).toBe('maintain')
  })
})

describe('the pace and the goal weight offered first', () => {
  it('offers the fastest loss within 1% of the body weight, and the slow gain', () => {
    expect(recommendedPace('lose', 106)).toBe(1)
    expect(recommendedPace('lose', 80)).toBe(0.75)
    expect(recommendedPace('lose', 70)).toBe(0.5)
    expect(recommendedPace('lose', 40)).toBe(0.25)
    expect(recommendedPace('gain', 60)).toBe(0.25)
    expect(paceBand(1)).toEqual({ min: 0.8, max: 1.2 })
    expect(paceBand(0.25)).toEqual({ min: 0.2, max: 0.3 })
  })

  it('keeps a goal already set when it points the right way', () => {
    expect(suggestGoalWeight('lose', 106, 174, 85)).toBe(85)
    expect(suggestGoalWeight('gain', 60, 174, 85)).toBe(85)
    expect(suggestGoalWeight('lose', 80, 174, 85)).toBe(75)   // 85 is not a loss from 80
  })

  it('starts a loss at the top of the healthy range, or 15% off when that is far', () => {
    expect(suggestGoalWeight('lose', 106, 174)).toBe(90)
    expect(suggestGoalWeight('lose', 80, 174)).toBe(75)
    expect(suggestGoalWeight('lose', 70, 174)).toBe(65)   // already healthy: 5 kg
  })

  it('starts a gain at the bottom of the healthy range when under it', () => {
    expect(suggestGoalWeight('gain', 50, 174)).toBe(56)
    expect(suggestGoalWeight('gain', 70, 174)).toBe(75)
    expect(suggestGoalWeight('maintain', 70.26, 174)).toBe(70.3)
  })
})

describe('the plan the answers work out to', () => {
  it('loses a kilo a week from 106 kg on about 2,100 kcal', () => {
    const p = planFor({ ...R, goal: 'lose', goalKg: 85, paceKg: 1 })
    expect(p.maintenance).toBe(3190)
    expect(p.kcal).toBe(2090)
    expect(p.floor).toBe(1990)
    expect(p.protein).toBe(170)
    expect(p.fat).toBe(60)
    expect(p.carbs).toBe(218)
    expect(p.rate).toBe(1)
    expect(p.weeks).toBe(21)
  })

  it('holds the floor, and says the slower pace it gives', () => {
    const p = planFor({ sex: 'f', age: 50, heightCm: 158, weightKg: 62, activity: 'low', goal: 'lose', goalKg: 55, paceKg: 1 })
    expect(p.kcal).toBe(1200)
    expect(p.kcal).toBe(p.floor)
    expect(p.rate).toBeCloseTo(0.22, 2)
  })

  it('eats at maintenance to keep the weight, protein off the weight at a BMI of 30 at most', () => {
    const p = planFor({ ...R, goal: 'maintain' })
    expect(p.kcal).toBe(p.maintenance)
    expect(p.rate).toBe(0)
    expect(p.weeks).toBeNull()
    expect(p.protein).toBe(145)   // 1.6 × 90.8 kg, not × 106
  })

  it('gains a quarter of a kilo a week on 275 kcal over maintenance', () => {
    const p = planFor({ sex: 'f', age: 25, heightCm: 165, weightKg: 50, activity: 'moderate', goal: 'gain', goalKg: 55, paceKg: 0.25 })
    expect(p.maintenance).toBe(1870)
    expect(p.kcal).toBe(2150)
    expect(p.rate).toBeCloseTo(0.25, 1)
    expect(p.protein).toBe(90)
    expect(p.fat).toBe(60)
    expect(p.weeks).toBe(20)
  })

  it('needs the four answers the equation needs', () => {
    expect(planFor({ ...R, age: null, goal: 'lose' })).toBeNull()
    expect(planFor({ ...R, goal: 'nope' })).toBeNull()
  })
})

describe('checking the answers', () => {
  it('names the first one missing or out of range', () => {
    const ok = { sex: 'm', age: 32, heightCm: 174, weight: 106 }
    expect(checkAnswers(ok)).toEqual({ ok: true, field: null })
    expect(checkAnswers({ ...ok, sex: null }).field).toBe('sex')
    expect(checkAnswers({ ...ok, age: 16 }).field).toBe('age')
    expect(checkAnswers({ ...ok, age: null }).field).toBe('age')
    expect(checkAnswers({ ...ok, heightCm: 300 }).field).toBe('heightCm')
    expect(checkAnswers({ ...ok, weight: 20 }).field).toBe('weight')
    expect(checkAnswers({ ...ok, weight: 500 }, 'lb').ok).toBe(true)
    expect(checkAnswers({ ...ok, weight: 700 }, 'lb').field).toBe('weight')
  })
})

describe('writing the answers into the state', () => {
  const today = '2026-10-14'
  const base = () => ({
    unit: 'kg', bodyweight: [{ d: '2026-10-10', w: 107, t: 1 }], targetW: null,
    cut: { kcal: 2000, remind: { weigh: '07:30', log: '21:00' }, checkInDay: 0, keyLifts: ['0043'], breaks: [{ from: '2026-12-23', to: '2027-01-01' }] },
  })
  const answers = { sex: 'm', age: 32, heightCm: 174, weight: 106, activity: 'high' }

  it('a cut: the profile, today\'s weight, the goal and the plan, keeping what it did not ask', () => {
    const s = base()
    const plan = applyOnboarding(s, { ...answers, goal: 'lose', goalWeight: 85, paceKg: 1 }, { today, now: 5 })
    expect(plan.kcal).toBe(2090)
    expect(s.profile).toEqual({ sex: 'm', born: 1994, heightCm: 174, activity: 'high' })
    expect(s.bodyweight.at(-1)).toEqual({ d: today, w: 106, t: 5 })
    expect(s.targetW).toBe(85)
    const c = cutOf(s)
    expect(c).toMatchObject({ mode: 'cut', start: today, kcal: 2090, protein: 170, fat: 60, minKcal: 1990, maintenance: 3190, rateMin: 0.8, rateMax: 1.2, rateMode: 'kg', checkInDay: 0 })
    expect(c.remind).toEqual({ weigh: '07:30', log: '21:00' })
    expect(c.keyLifts).toEqual(['0043'])
    expect(c.breaks).toHaveLength(1)
    expect(s.onboarded).toBe(5)
  })

  it('a cut may start on a day still to come', () => {
    const s = base()
    applyOnboarding(s, { ...answers, goal: 'lose', goalWeight: 85, paceKg: 1, start: '2026-11-02' }, { today })
    expect(cutOf(s).start).toBe('2026-11-02')
    applyOnboarding(s, { ...answers, goal: 'lose', goalWeight: 85, paceKg: 1, start: 'soon' }, { today })
    expect(cutOf(s).start).toBe(today)
  })

  it('maintenance: held at today\'s weight from today, no diet breaks', () => {
    const s = base()
    applyOnboarding(s, { ...answers, goal: 'maintain' }, { today })
    const c = cutOf(s)
    expect(c).toMatchObject({ mode: 'maintain', endW: 106, endedAt: today, start: today, kcal: 3190, maintenance: 3190 })
    expect(c.breaks).toEqual([])
    expect(s.targetW).toBe(106)
  })

  it('a gain: its own mode and a slow band', () => {
    const s = base()
    const plan = applyOnboarding(s, { ...answers, weight: 60, goal: 'gain', goalWeight: 66, paceKg: 0.25 }, { today })
    const c = cutOf(s)
    expect(c.mode).toBe('gain')
    expect(c.kcal).toBe(plan.kcal)
    expect(c.kcal).toBeGreaterThan(c.maintenance)
    expect(c).toMatchObject({ rateMin: 0.2, rateMax: 0.3, start: today, endW: null })
    expect(s.targetW).toBe(66)
  })

  it('does not log the last weigh-in again as today\'s when it was left as it was', () => {
    const s = base()
    applyOnboarding(s, { ...answers, weight: 107, goal: 'lose', goalWeight: 85, paceKg: 1 }, { today })
    expect(s.bodyweight).toEqual([{ d: '2026-10-10', w: 107, t: 1 }])
    expect(s.targetW).toBe(85)
  })

  it('takes over a weigh-in already logged today, and works in pounds', () => {
    const s = { ...base(), unit: 'lb', bodyweight: [{ d: today, w: 240, t: 1 }] }
    const plan = applyOnboarding(s, { ...answers, weight: 233.7, goal: 'lose', goalWeight: 187.4, paceKg: 1 }, { today, now: 9 })
    expect(s.bodyweight).toEqual([{ d: today, w: 233.7, t: 9 }])
    expect(plan.kcal).toBe(2090)   // the same person as 106 kg
    expect(s.targetW).toBe(187.4)
  })

  it('keeps the habits typed, and leaves the rest of the plan\'s', () => {
    const s = base()
    applyOnboarding(s, { ...answers, goal: 'lose', goalWeight: 85, paceKg: 1, steps: 8000, cardio: 20 }, { today })
    expect(cutOf(s)).toMatchObject({ steps: 8000, cardio: 20, sleep: 8, gymDays: 6 })
  })

  it('writes nothing when the answers do not add up', () => {
    const s = base()
    expect(applyOnboarding(s, { ...answers, age: null, goal: 'lose' }, { today })).toBeNull()
    expect(s.onboarded).toBeUndefined()
    expect(s.profile).toBeUndefined()
  })
})
