import { describe, expect, it } from 'vitest'
import { normalizeFoodItem } from './food.js'
import {
  MAX_ACTIVE_PLANS, activePlans, offPlanEntries, offPlanItem, savePlan, suggestPlans, triggerCounts,
} from './offplan.js'

const day = '2026-11-20'
const entry = (d, ...items) => ({ d, t: 1, food: items.map((it, i) => normalizeFoodItem({ ...it, id: d + i })) })

describe('off plan', () => {
  it('is a quick add with its trigger, in the meal of the hour', () => {
    const it = normalizeFoodItem({ ...offPlanItem({ kcal: 600, trig: 'bored', at: new Date(2026, 10, 20, 22, 30) }), id: 'x' })
    expect(it).toMatchObject({ meal: 's', src: 'quick', kcal: 600, off: true, trig: 'bored' })
    expect(offPlanItem({ kcal: 400, trig: 'nope', meal: 'l' }).trig).toBeUndefined()
  })

  it('counts each trigger over the last two weeks', () => {
    const S = { dailyLog: [
      entry('2026-11-01', offPlanItem({ kcal: 400, trig: 'hunger' })),
      entry('2026-11-10', offPlanItem({ kcal: 600, trig: 'hunger' }), { name: 'Oats', kcal: 300, src: 'quick' }),
      entry('2026-11-18', offPlanItem({ kcal: 800, trig: 'hunger' }), offPlanItem({ kcal: 200, trig: 'bored' })),
    ] }
    expect(offPlanEntries(S, '2026-11-01', day)).toHaveLength(4)
    expect(triggerCounts(S, day)).toEqual({ hunger: 2, bored: 1 })
    expect(suggestPlans(S, day)).toEqual([expect.objectContaining({ trig: 'hunger', n: 2, if: expect.stringContaining('21:00') })])
  })
})

describe('if–then plans', () => {
  it('keeps three active at most, switching the oldest off', () => {
    let list = []
    for (let i = 0; i < 4; i++) list = savePlan(list, { id: 'p' + i, trig: 'hunger', if: 'if ' + i, then: 'then ' + i }, 100 + i)
    expect(activePlans({ plans: list }).map(p => p.id)).toEqual(['p1', 'p2', 'p3'])
    expect(activePlans({ plans: list })).toHaveLength(MAX_ACTIVE_PLANS)
    expect(savePlan(list, { if: '', then: 'x' })).toHaveLength(4)
  })

  it('stops proposing a plan once one covers the trigger', () => {
    const S = { dailyLog: [entry('2026-11-18', offPlanItem({ kcal: 300, trig: 'bored' }), offPlanItem({ kcal: 300, trig: 'bored' }))] }
    expect(suggestPlans(S, day).map(p => p.trig)).toEqual(['bored'])
    S.plans = savePlan([], { trig: 'bored', if: 'bored', then: 'walk' })
    expect(suggestPlans(S, day)).toEqual([])
  })
})
