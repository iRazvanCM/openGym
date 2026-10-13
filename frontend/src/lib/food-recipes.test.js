import { describe, expect, it } from 'vitest'
import {
  addMealToDay, dayFood, mealsOf, normalizeFood, proteinCloser, recipeNumbers, saveMeal, saveMyFood,
} from './food.js'

const P = (kcal, p, c, f) => ({ kcal, p, c, f })

describe('recipes', () => {
  const ingredients = [
    { name: 'Chicken breast', amount: 500, per100: P(110, 23, 0, 1.5) },
    { name: 'Rice', amount: 250, per100: P(350, 7, 77, 1) },
    { name: 'Olive oil', amount: 20, per100: P(884, 0, 0, 100) },
  ]

  it('puts the whole pot into what came out of it, per 100 g', () => {
    const r = recipeNumbers(ingredients, 1400)   // the rice drank water
    expect(r.raw).toBe(770)
    expect(r.weight).toBe(1400)
    expect(r.total.kcal).toBe(550 + 875 + 177)
    expect(r.per100.kcal).toBeCloseTo(1602 / 14, 0)
    expect(r.per100.p).toBeCloseTo((115 + 17.5) / 14, 1)
    // without a cooked weight, the raw weight stands in
    expect(recipeNumbers(ingredients).weight).toBe(770)
    expect(recipeNumbers([])).toBeNull()
  })

  it('is kept as a food of one\'s own with its ingredients and pot weight', () => {
    const r = recipeNumbers(ingredients, 1400)
    const S = {}
    const f = saveMyFood(S, { name: 'Chicken and rice', src: 'recipe', per100: r.per100, ingredients, cooked: 1400 })
    expect(f).toMatchObject({ src: 'recipe', cooked: 1400 })
    expect(f.ingredients).toHaveLength(3)
    expect(normalizeFood({ ...f, ingredients: [{ junk: 1 }] }).ingredients).toEqual([])
  })
})

describe('saved meals', () => {
  it('keeps a meal by name and adds it to any day as new items', () => {
    const S = { dailyLog: [] }
    const items = [
      { id: 'a', meal: 'b', name: 'Oats', src: 'basic', amount: 80, per100: P(380, 13, 60, 7) },
      { id: 'b', meal: 'b', name: 'Skyr', src: 'custom', amount: 250, per100: P(63, 11, 4, 0.2) },
    ]
    const m = saveMeal(S, { name: 'My breakfast', items })
    expect(mealsOf(S)).toHaveLength(1)
    saveMeal(S, { name: 'my breakfast', items: items.slice(0, 1) })
    expect(mealsOf(S)).toHaveLength(1)
    expect(mealsOf(S)[0].items).toHaveLength(1)
    expect(addMealToDay(S, '2026-11-05', m, 'l')).toBe(2)
    const day = dayFood(S, '2026-11-05')
    expect(day.map(x => x.meal)).toEqual(['l', 'l'])
    expect(new Set(day.map(x => x.id)).size).toBe(2)
    expect(day[1].p).toBeCloseTo(27.5, 1)
  })
})

describe('closing the protein', () => {
  it('offers the person\'s own lean foods first, in portions that fit the calories left', () => {
    const today = '2026-11-05'
    const S = { foods: [], dailyLog: [{ d: '2026-11-04', t: 1, food: [
      { id: 'x', meal: 'd', name: 'Turkey breast', src: 'custom', ref: 'my-turkey', amount: 200, per100: P(105, 24, 0, 1), kcal: 210, p: 48, c: 0, f: 2 },
      { id: 'y', meal: 'd', name: 'Chips', src: 'custom', ref: 'my-chips', amount: 100, per100: P(540, 6, 50, 34), kcal: 540, p: 6, c: 50, f: 34 },
    ] }] }
    const out = proteinCloser(S, { need: 30, kcalLeft: 400, today })
    expect(out[0].food.name).toBe('Turkey breast')
    expect(out[0].grams).toBe(125)
    expect(out.every(x => x.food.name !== 'Chips')).toBe(true)
    expect(out.length).toBe(3)
    expect(proteinCloser(S, { need: 2, today })).toEqual([])
    expect(proteinCloser(S, { need: 30, kcalLeft: 0, today }).every(x => x.kcal <= 100)).toBe(true)
  })
})

describe('the pan\'s oil', () => {
  it('is asked about for food weighed raw, and said to be in a built-in fried one', async () => {
    const { basicFoods, oilAsk, oilItem, OIL_REF, normalizeFoodItem } = await import('./food.js')
    const B = basicFoods('en')
    const f = id => B.find(x => x.id === 'basic:' + id)
    expect(oilAsk(f('chicken-breast-raw'))).toBe('ask')
    expect(oilAsk(f('chicken-breast-pan'))).toBe('included')
    expect(oilAsk(f('chicken-schnitzel-fried'))).toBe('included')
    expect(oilAsk(f('chicken-breast-boiled'))).toBeNull()
    expect(oilAsk({ name: 'Piept de pui crud', ref: 'my-1' })).toBe('ask')
    const oil = normalizeFoodItem({ ...oilItem('d', 14, 'en'), id: 'o' })
    expect(oil).toMatchObject({ meal: 'd', ref: OIL_REF, amount: 14, kcal: 124, f: 14 })
  })
})
