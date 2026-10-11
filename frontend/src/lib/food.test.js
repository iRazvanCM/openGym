import { describe, expect, it } from 'vitest'
import {
  MEALS, addFoodItem, basicCats, basicFoods, cleanPer100, copyMeal, dayNutrition, foodFor, foodLang, foodTotals, matches,
  mealAt, mealTotals, myFoodByCode, normalizeFood, normalizeFoodItem, normalizeFoodList, portion, recentFoods,
  removeFoodItem, saveMyFood, searchLocal, updateFoodItem,
} from './food.js'
import { BASIC_FOODS, FOOD_CATS } from './food-basics.js'

const CHICKEN = { kcal: 120, p: 22.5, c: 0, f: 2.6 }

describe('labels and portions', () => {
  it('cleans a label and works out calories from the macros when it has none', () => {
    expect(cleanPer100({ kcal: '389', p: 16.9, c: 66.3, f: 6.9, fib: 10.6 })).toEqual({ kcal: 389, p: 16.9, c: 66.3, f: 6.9, fib: 10.6 })
    expect(cleanPer100({ p: 10, c: 20, f: 5 })).toEqual({ kcal: 165, p: 10, c: 20, f: 5 })
    expect(cleanPer100({ kcal: -5, p: 120 })).toBeNull()        // nothing usable left
    expect(cleanPer100({ kcal: 2000, p: 10 })).toEqual({ kcal: 40, p: 10, c: 0, f: 0 })   // impossible kcal dropped
    expect(cleanPer100(null)).toBeNull()
  })

  it('scales a portion from the numbers per 100', () => {
    expect(portion(CHICKEN, 250)).toEqual({ kcal: 300, p: 56.3, c: 0, f: 6.5 })
    expect(portion(CHICKEN, 0)).toEqual({ kcal: 0, p: 0, c: 0, f: 0 })
  })

  it('opens the meal of the time of day', () => {
    const at = h => new Date(2026, 10, 2, h, 15)
    expect([7, 12, 19, 23].map(h => mealAt(at(h)))).toEqual(['b', 'l', 'd', 's'])
  })
})

describe('diary items', () => {
  it('keeps a weighed item with its portion worked out from the label', () => {
    const it = normalizeFoodItem({ id: 'a', meal: 'l', name: ' Piept de pui ', src: 'basic', ref: 'basic:chicken-breast-raw', amount: 180, per100: CHICKEN, sv: 0 })
    expect(it).toMatchObject({ id: 'a', meal: 'l', name: 'Piept de pui', amount: 180, unit: 'g', kcal: 216, p: 40.5, c: 0, f: 4.7, src: 'basic' })
    expect(it.sv).toBeUndefined()
    expect(normalizeFoodItem({ id: 'b', amount: 100, per100: CHICKEN, sv: 2, unit: 'ml' })).toMatchObject({ sv: 2, unit: 'ml', meal: 's', src: 'custom' })
  })

  it('keeps a quick add as the numbers typed, and drops what is not an item', () => {
    expect(normalizeFoodItem({ id: 'q', meal: 'd', name: 'Restaurant', kcal: 850, p: 40 })).toMatchObject({ src: 'quick', kcal: 850, p: 40, c: 0, f: 0 })
    expect(normalizeFoodItem({ id: 'q', p: 30, c: 10 })).toMatchObject({ kcal: 160 })
    expect(normalizeFoodItem({ id: 'q' })).toBeNull()
    expect(normalizeFoodItem({ kcal: 100 })).toBeNull()   // no id
    expect(normalizeFoodList([{ id: 'x', kcal: 1 }, { id: 'x', kcal: 2 }, null, { id: 'y', kcal: 3 }]).map(i => i.kcal)).toEqual([1, 3])
  })

  it('adds, edits and removes items on a day, making the day when it is missing', () => {
    const S = { dailyLog: [{ d: '2026-11-02', t: 1, steps: 9000 }] }
    const a = addFoodItem(S, '2026-11-03', { meal: 'b', name: 'Ovăz', per100: { kcal: 379, p: 13.2, c: 67.7, f: 6.5 }, amount: 80 }, 50)
    addFoodItem(S, '2026-11-03', { meal: 'b', name: 'Lapte', per100: { kcal: 46, p: 3.4, c: 4.9, f: 1.5 }, amount: 250, unit: 'ml' }, 60)
    expect(S.dailyLog.map(e => e.d)).toEqual(['2026-11-02', '2026-11-03'])
    expect(dayNutrition(S, '2026-11-03')).toEqual({ kcal: 418, protein: 19.1, carbs: 66.5, fat: 9, n: 2, src: 'food' })
    updateFoodItem(S, '2026-11-03', a.id, { amount: 40 }, 70)
    expect(dayNutrition(S, '2026-11-03').kcal).toBe(267)
    expect(S.dailyLog[1].t).toBe(70)
    expect(removeFoodItem(S, '2026-11-03', a.id, 80)).toBe(true)
    expect(removeFoodItem(S, '2026-11-03', 'nope', 90)).toBe(false)
    expect(dayNutrition(S, '2026-11-03').n).toBe(1)
  })

  it('reads the typed calories of a day without a diary', () => {
    const S = { dailyLog: [{ d: '2026-11-02', kcal: 1950, protein: 170 }] }
    expect(dayNutrition(S, '2026-11-02')).toMatchObject({ kcal: 1950, protein: 170, carbs: null, src: 'log' })
    expect(dayNutrition(S, '2026-11-03')).toMatchObject({ kcal: null, src: null })
  })

  it('totals by meal', () => {
    const items = [
      normalizeFoodItem({ id: '1', meal: 'b', kcal: 300, p: 20 }),
      normalizeFoodItem({ id: '2', meal: 'b', kcal: 200, p: 5 }),
      normalizeFoodItem({ id: '3', meal: 'd', kcal: 700, p: 50 }),
    ]
    const m = mealTotals(items)
    expect(Object.keys(m)).toEqual(MEALS)
    expect(m.b).toMatchObject({ kcal: 500, p: 25, n: 2 })
    expect(m.l.n).toBe(0)
    expect(foodTotals(items).kcal).toBe(1200)
  })

  it('copies a meal to another day as new items', () => {
    const S = { dailyLog: [] }
    addFoodItem(S, '2026-11-02', { meal: 'b', name: 'Ouă', per100: { kcal: 143, p: 12.6, c: 0.7, f: 9.5 }, amount: 150, sv: 3 })
    addFoodItem(S, '2026-11-02', { meal: 'l', name: 'Orez', per100: { kcal: 365, p: 7.1, c: 80, f: 0.7 }, amount: 100 })
    expect(copyMeal(S, '2026-11-02', '2026-11-03', 'b', 1000)).toBe(1)
    const [copy] = S.dailyLog.find(e => e.d === '2026-11-03').food
    expect(copy).toMatchObject({ name: 'Ouă', amount: 150, sv: 3, meal: 'b' })
    expect(copy.id).not.toBe(S.dailyLog[0].food[0].id)
  })
})

describe('my foods', () => {
  it('keeps one food per barcode, newest first, and finds it by barcode', () => {
    const S = { foods: [] }
    saveMyFood(S, { name: 'Skyr', brand: 'Arla', code: '5701-234', per100: { kcal: 63, p: 11, c: 4, f: 0.2 }, src: 'off', serving: { label: '1 cup', amount: 150 }, pack: 450 })
    saveMyFood(S, { name: 'Pâine de casă', per100: { kcal: 250, p: 9, c: 48, f: 2 } })
    const again = saveMyFood(S, { name: 'Skyr natural', code: '5701234', per100: { kcal: 64, p: 11, c: 4, f: 0.2 }, src: 'off' })
    expect(S.foods.map(f => f.name)).toEqual(['Skyr natural', 'Pâine de casă'])
    expect(again.id).toBe(S.foods[0].id)
    expect(myFoodByCode(S, '5701234').name).toBe('Skyr natural')
    expect(myFoodByCode(S, '000')).toBeNull()
    expect(normalizeFood({ name: 'x', per100: {} })).toBeNull()
    expect(normalizeFood({ name: 'Iaurt', per100: { kcal: 60 }, serving: { amount: 150 }, pack: 0 })).toMatchObject({ serving: { label: '', amount: 150 } })
  })

  it('finds the food behind a diary item, with its serving', () => {
    const S = { foods: [normalizeFood({ id: 'm1', name: 'Shake', per100: { kcal: 380, p: 75, c: 8, f: 6 }, serving: { label: '1 scoop', amount: 30 } })] }
    expect(foodFor(S, { ref: 'basic:egg' }, 'ro')).toMatchObject({ name: 'Ou întreg', serving: { label: '1 ou', amount: 50 } })
    expect(foodFor(S, { ref: 'm1' }).serving.amount).toBe(30)
    expect(foodFor(S, { ref: 'gone', name: 'Old', per100: CHICKEN }).per100).toEqual(CHICKEN)
    expect(foodFor(S, { ref: '', src: 'quick', kcal: 500 })).toBeNull()
  })
})

describe('finding food', () => {
  it('matches the start of words, whatever the accents and case', () => {
    expect(matches('Brânză de vaci slabă', 'branza vac')).toBe(true)
    expect(matches('Piept de pui, crud', 'PUI')).toBe(true)
    expect(matches('Mușchiuleț de porc', 'muschi')).toBe(true)
    expect(matches('Pulpă de pui', 'ui')).toBe(false)
  })

  it('searches my foods first, then the built-in ones in either language', () => {
    const S = { foods: [normalizeFood({ name: 'Pui shaorma de casă', per100: { kcal: 200, p: 20, c: 5, f: 11 } })] }
    const ro = searchLocal(S, 'pui', 'ro')
    expect(ro.mine).toHaveLength(1)
    expect(ro.basics.map(f => f.name)).toContain('Piept de pui, crud')
    expect(searchLocal(S, 'chicken', 'ro').basics.length).toBeGreaterThan(0)   // English name of a Romanian list
    expect(searchLocal(S, '', 'en').basics).toHaveLength(BASIC_FOODS.length)
  })

  it('names food in Romanian for a Romanian phone', () => {
    expect(foodLang('en', ['ro-RO', 'en-US'])).toBe('ro')
    expect(foodLang('de', ['de-DE'])).toBe('en')
    expect(foodLang('ro', [])).toBe('ro')
    expect(basicFoods('ro').find(f => f.ref === 'basic:polenta').name).toBe('Mămăligă (moale, aprox.)')
  })

  it('lists the foods eaten lately once each, with how much was had last time', () => {
    const S = { dailyLog: [] }
    addFoodItem(S, '2026-11-01', { meal: 'b', name: 'Ovăz', ref: 'basic:oats', src: 'basic', per100: { kcal: 379, p: 13.2, c: 67.7, f: 6.5 }, amount: 60 }, 1)
    addFoodItem(S, '2026-11-02', { meal: 'b', name: 'Ovăz', ref: 'basic:oats', src: 'basic', per100: { kcal: 379, p: 13.2, c: 67.7, f: 6.5 }, amount: 80 }, 2)
    addFoodItem(S, '2026-11-02', { meal: 'l', name: 'Skyr', code: '5701234', src: 'off', per100: { kcal: 63, p: 11, c: 4, f: 0.2 }, amount: 150 }, 3)
    addFoodItem(S, '2026-11-02', { meal: 'd', name: 'Pizza', kcal: 900 }, 4)   // a quick add is no food to pick again
    addFoodItem(S, '2026-08-01', { meal: 'd', name: 'Ancient', per100: CHICKEN, amount: 100 }, 0)
    const rows = recentFoods(S, '2026-11-02')
    expect(rows.map(r => r.name)).toEqual(['Skyr', 'Ovăz'])
    expect(rows[1]).toMatchObject({ lastAmount: 80, lastMeal: 'b', times: 2 })
  })
})

describe('the built-in foods', () => {
  // The calories are the reference figures, worked out with each food's own energy factors; 4/4/9
  // on the macros runs high where carbs include a lot of fibre and acids (vegetables, citrus — a
  // few kcal on foods that have few) and low on drinks whose calories are mostly alcohol (7 kcal
  // a gram, no macro of its own).
  it('have sane labels: the calories within reach of what the macros make', () => {
    const ALCOHOL = new Set(['basic:beer', 'basic:red-wine', 'basic:white-wine', 'basic:vodka', 'basic:whisky', 'basic:tuica'])
    for (const f of BASIC_FOODS) {
      const { kcal, p, c, f: fat } = f.per100
      const fromMacros = 4 * p + 4 * c + 9 * fat
      expect(f.id.startsWith('basic:'), f.id).toBe(true)
      expect(kcal, f.id).toBeGreaterThan(0)
      if (ALCOHOL.has(f.id)) { expect(fromMacros, f.id).toBeLessThan(kcal); continue }
      expect(fromMacros, f.id).toBeLessThan(kcal * 1.35 + 16)
      expect(fromMacros, f.id).toBeGreaterThan(kcal * 0.85 - 5)
    }
    expect(new Set(BASIC_FOODS.map(f => f.id)).size).toBe(BASIC_FOODS.length)
  })

  it('sit on a shelf each, and come raw and cooked every way a kitchen cooks them', () => {
    const cats = new Set(FOOD_CATS.map(c => c.id))
    for (const f of BASIC_FOODS) expect(cats.has(f.cat), f.id).toBe(true)
    for (const c of cats) expect(BASIC_FOODS.some(f => f.cat === c), c).toBe(true)
    const chicken = BASIC_FOODS.filter(f => f.id.startsWith('basic:chicken-breast')).map(f => f.ro)
    for (const how of ['crud', 'fiert', 'grătar', 'cuptor', 'air fryer', 'tigaie']) expect(chicken.some(n => n.includes(how)), how).toBe(true)
    // the method is findable in one word, and the shelf narrows the list
    expect(searchLocal({}, 'airfryer', 'ro').basics.length).toBeGreaterThan(5)
    expect(searchLocal({}, 'pui tigaie', 'ro').basics[0].name).toBe('Piept de pui, la tigaie')
    expect(searchLocal({}, '', 'ro', 'drinks').basics.every(f => f.unit === 'ml')).toBe(true)
    expect(basicCats('ro')[0]).toEqual({ id: 'meat', name: 'Carne' })
  })
})
