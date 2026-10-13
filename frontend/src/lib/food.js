// The food diary: what was eaten, meal by meal, and what it adds up to.
//
// A day's food lives on that day's daily-log entry (lib/cut.js), as `food: [item]`, so a day stays
// one record: it syncs, merges, backs up and exports like the weigh-ins do, with no new list for
// the sync to learn. When a day has food logged, its calories and protein come from the food —
// the totals typed into the daily log are for days without a diary. An item is:
//
//   { id, meal: 'b' | 'l' | 'd' | 's', name, brand, code, src: 'off' | 'basic' | 'custom' | 'quick',
//     ref, amount, unit: 'g' | 'ml', sv?, per100: { kcal, p, c, f, fib? }, kcal, p, c, f, at,
//     off?, trig? }   — `off` an entry logged as off plan, `trig` what set it off (lib/offplan.js)
//
// `per100` is what the label says per 100 g (or 100 ml); the item's own kcal/p/c/f are the portion,
// worked out when it was logged and kept, so a food changed later never rewrites a past day.
// `unit` is only how the amount is shown: a gram and a millilitre count the same (water-like),
// the way every food diary treats them. `sv` is the number of servings when it was logged as
// servings. A quick add has no per100 and no amount: just the numbers typed.
//
// The foods a person keeps — products scanned or found online, and foods of their own — are
// S.foods: [{ id, name, brand, code, unit, per100, serving: { label, amount }, pack, src, at }].
// `ref` on a diary item points back to where it came from: 'basic:…' (lib/food-basics.js),
// 'off:<barcode>' or a food's id in S.foods, so the portion screen can offer that food's serving.
//
// Two devices that change the same day's diary at once keep the day saved last, as for every
// daily-log field (lib/sync-merge.js: one entry per day, the later `t` wins).
import { BASIC_FOODS, BASIC_BY_ID, FOOD_CATS } from './food-basics.js'
import { isoOf } from './format.js'

export const MEALS = ['b', 'l', 'd', 's']
export const MEAL_NAMES = { b: 'Breakfast', l: 'Lunch', d: 'Dinner', s: 'Snacks' }
const MAX_ITEMS_A_DAY = 300
const r1 = n => Math.round(n * 10) / 10
const num = (v, hi) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= hi ? n : null }

/** The meal a time of day usually is — what the add button opens on. */
export function mealAt(date = new Date()) {
  const h = date.getHours()
  return h < 11 ? 'b' : h < 16 ? 'l' : h < 22 ? 'd' : 's'
}

/**
 * A label's numbers per 100 g, cleaned: nothing negative or impossible (no food is over 900 kcal
 * or 100 g of a macro per 100 g), and calories worked out from the macros (4/4/9) when a label
 * gives only those. Null when there is nothing usable.
 */
export function cleanPer100(raw) {
  if (!raw || typeof raw !== 'object') return null
  const p = num(raw.p, 100), c = num(raw.c, 100), f = num(raw.f, 100)
  let kcal = num(raw.kcal, 950)
  if (kcal == null && (p != null || c != null || f != null)) kcal = 4 * (p || 0) + 4 * (c || 0) + 9 * (f || 0)
  if (kcal == null) return null
  const out = { kcal: r1(kcal), p: r1(p || 0), c: r1(c || 0), f: r1(f || 0) }
  const fib = num(raw.fib, 100)
  if (fib != null) out.fib = r1(fib)
  return out
}

/** A portion of `amount` g (or ml) of a food with these per-100 numbers. */
export function portion(per100, amount) {
  const k = (Number(amount) || 0) / 100
  return { kcal: Math.round(per100.kcal * k), p: r1(per100.p * k), c: r1(per100.c * k), f: r1(per100.f * k) }
}

const cleanText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** One diary item in its stable shape, or null for something that is not one. */
export function normalizeFoodItem(raw) {
  if (!raw || typeof raw !== 'object') return null
  const meal = MEALS.includes(raw.meal) ? raw.meal : 's'
  const name = cleanText(raw.name, 120)
  const per100 = cleanPer100(raw.per100)
  const amount = num(raw.amount, 10000)
  const item = {
    id: cleanText(String(raw.id ?? ''), 40) || null,
    meal, name: name || 'Food',
    brand: cleanText(raw.brand, 80), code: cleanText(raw.code, 32),
    src: ['off', 'basic', 'custom', 'quick'].includes(raw.src) ? raw.src : (per100 ? 'custom' : 'quick'),
    ref: cleanText(raw.ref, 80),
    unit: raw.unit === 'ml' ? 'ml' : 'g',
    at: Number(raw.at) > 0 ? Number(raw.at) : 0,
  }
  if (!item.id) return null
  // an off-plan entry (lib/offplan.js), and what set it off
  if (raw.off === true) item.off = true
  if (typeof raw.trig === 'string' && /^[a-z]{2,12}$/.test(raw.trig)) item.trig = raw.trig
  if (per100 && amount != null && amount > 0) {
    item.per100 = per100
    item.amount = r1(amount)
    Object.assign(item, portion(per100, amount))
    // logged as servings ("2 eggs"): how many, for the diary to say so; the amount is what counts
    const sv = num(raw.sv, 100)
    if (sv != null && sv > 0) item.sv = Math.round(sv * 100) / 100
  } else {
    // a quick add, or an item whose label numbers went missing: its own totals stand
    item.src = item.src === 'quick' || !per100 ? 'quick' : item.src
    const kcal = num(raw.kcal, 20000), p = num(raw.p, 2000), c = num(raw.c, 2000), f = num(raw.f, 2000)
    if (kcal == null && p == null && c == null && f == null) return null
    item.kcal = Math.round(kcal ?? 4 * (p || 0) + 4 * (c || 0) + 9 * (f || 0))
    item.p = r1(p || 0); item.c = r1(c || 0); item.f = r1(f || 0)
  }
  return item
}

/** A day's food list, cleaned: bad items dropped, ids unique, at most a few hundred. */
export function normalizeFoodList(list) {
  const seen = new Set()
  const out = []
  for (const raw of Array.isArray(list) ? list : []) {
    const it = normalizeFoodItem(raw)
    if (!it || seen.has(it.id)) continue
    seen.add(it.id)
    out.push(it)
    if (out.length >= MAX_ITEMS_A_DAY) break
  }
  return out
}

const ZERO = () => ({ kcal: 0, p: 0, c: 0, f: 0, n: 0 })
/** What a list of items adds up to: { kcal, p, c, f, n }. */
export function foodTotals(items) {
  const t = ZERO()
  for (const raw of items || []) {
    if (!raw) continue
    // an item as stored carries its portion; one that never went through normalizeFoodItem (an
    // imported file) is worked out from its label
    const it = raw.kcal == null && raw.per100 && raw.amount > 0 ? portion(raw.per100, raw.amount) : raw
    t.kcal += it.kcal || 0; t.p += it.p || 0; t.c += it.c || 0; t.f += it.f || 0; t.n++
  }
  t.p = r1(t.p); t.c = r1(t.c); t.f = r1(t.f)
  return t
}

export function mealTotals(items) {
  const out = Object.fromEntries(MEALS.map(m => [m, ZERO()]))
  for (const m of MEALS) out[m] = foodTotals((items || []).filter(it => it.meal === m))
  return out
}

const entryOf = (S, iso) => (Array.isArray(S?.dailyLog) ? S.dailyLog : []).find(e => e?.d === iso) || null
export const dayFood = (S, iso) => entryOf(S, iso)?.food || []

/**
 * A daily-log entry's calories and macros: the food diary's totals when the day has any food,
 * else the calories and protein typed into the daily log. `src` says which: 'food', 'log' or null.
 */
export function entryNutrition(e) {
  if (e?.food?.length) {
    const t = foodTotals(e.food)
    return { kcal: t.kcal, protein: t.p, carbs: t.c, fat: t.f, n: t.n, src: 'food' }
  }
  if (e && (e.kcal != null || e.protein != null)) return { kcal: e.kcal ?? null, protein: e.protein ?? null, carbs: null, fat: null, n: 0, src: 'log' }
  return { kcal: null, protein: null, carbs: null, fat: null, n: 0, src: null }
}

/** A day's calories and macros (entryNutrition of that day's entry). */
export const dayNutrition = (S, iso) => entryNutrition(entryOf(S, iso))

/* ------------------------------------------------------------------------- editing -- */

const uidOf = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

/** The daily-log entry of a day, made if it is missing. Mutates `state`. */
function dayEntry(state, iso, now) {
  if (!Array.isArray(state.dailyLog)) state.dailyLog = []
  let e = state.dailyLog.find(x => x?.d === iso)
  if (!e) { e = { d: iso, t: now }; state.dailyLog.push(e); state.dailyLog.sort((a, b) => a.d.localeCompare(b.d)) }
  if (!Array.isArray(e.food)) e.food = []
  return e
}

/** Adds an item to a day (state is a draft: the store's update()). Returns the stored item. */
export function addFoodItem(state, iso, raw, now = Date.now()) {
  const it = normalizeFoodItem({ ...raw, id: raw.id || uidOf(), at: raw.at || now })
  if (!it) return null
  const e = dayEntry(state, iso, now)
  e.food.push(it)
  e.t = now
  return it
}

export function updateFoodItem(state, iso, id, patch, now = Date.now()) {
  const e = entryOf(state, iso)
  const i = e?.food?.findIndex(x => x.id === id) ?? -1
  if (i < 0) return null
  const it = normalizeFoodItem({ ...e.food[i], ...patch, id })
  if (!it) return null
  e.food[i] = it
  e.t = now
  return it
}

export function removeFoodItem(state, iso, id, now = Date.now()) {
  const e = entryOf(state, iso)
  if (!e?.food) return false
  const before = e.food.length
  e.food = e.food.filter(x => x.id !== id)
  if (e.food.length === before) return false
  e.t = now
  return true
}

/** Copies one meal of a day into another day, as new items. Returns how many were copied. */
export function copyMeal(state, fromIso, toIso, meal, now = Date.now()) {
  const items = dayFood(state, fromIso).filter(it => it.meal === meal)
  items.forEach((it, i) => addFoodItem(state, toIso, { ...it, id: null, at: now + i }, now))
  return items.length
}

/* ---------------------------------------------------------------------- my foods -- */

/** A food to keep, cleaned; null without a name or usable numbers. */
export function normalizeFood(raw) {
  if (!raw || typeof raw !== 'object') return null
  const per100 = cleanPer100(raw.per100)
  const name = cleanText(raw.name, 120)
  if (!per100 || !name) return null
  const f = {
    id: cleanText(String(raw.id ?? ''), 40) || uidOf(),
    name, brand: cleanText(raw.brand, 80), code: cleanText(raw.code, 32).replace(/\D/g, ''),
    unit: raw.unit === 'ml' ? 'ml' : 'g', per100,
    src: raw.src === 'off' ? 'off' : raw.src === 'recipe' ? 'recipe' : 'custom',
    at: Number(raw.at) > 0 ? Number(raw.at) : Date.now(),
  }
  if (f.src === 'recipe') {
    f.ingredients = normalizeIngredients(raw.ingredients)
    const cooked = num(raw.cooked, 50000)
    if (cooked && cooked > 0) f.cooked = r1(cooked)
  }
  const amount = num(raw.serving?.amount, 5000)
  if (amount && amount > 0) f.serving = { label: cleanText(raw.serving.label, 40) || '', amount: r1(amount) }
  const pack = num(raw.pack, 5000)
  if (pack && pack > 0) f.pack = r1(pack)
  return f
}

/** Keeps a food in S.foods: replaces the one with the same barcode (or name and brand), newest first. */
export function saveMyFood(state, raw) {
  const f = normalizeFood(raw)
  if (!f) return null
  const list = Array.isArray(state.foods) ? state.foods : []
  const same = x => (f.code && x.code === f.code) || (x.id === f.id) ||
    (!f.code && !x.code && x.name.toLowerCase() === f.name.toLowerCase() && (x.brand || '').toLowerCase() === (f.brand || '').toLowerCase())
  const old = list.find(same)
  if (old) f.id = old.id
  state.foods = [f, ...list.filter(x => !same(x))].slice(0, 500)
  return f
}

export const myFoodByCode = (S, code) => (S?.foods || []).find(f => f.code && f.code === String(code).replace(/\D/g, '')) || null

/* ------------------------------------------------------------------------- recipes -- */
// A dish cooked in a pot: its ingredients weighed raw, the pot weighed once cooked, and the dish
// kept as a food of one's own (S.foods, src 'recipe') whose label is the whole pot's numbers per
// 100 g of what came out. Cooking loses water, not calories, so 1 kg of raw ingredients that
// cooks down to 800 g carries all of its calories into those 800 g; a portion is then weighed on
// the plate and logged like any food. Without a cooked weight, the raw total stands in.

/** An ingredient in its stable shape: { name, ref, code, unit, amount, per100 }, or null. */
export function normalizeIngredient(raw) {
  if (!raw || typeof raw !== 'object') return null
  const per100 = cleanPer100(raw.per100)
  const amount = num(raw.amount, 20000)
  if (!per100 || !(amount > 0)) return null
  return { name: cleanText(raw.name, 120) || 'Food', ref: cleanText(raw.ref, 80), code: cleanText(raw.code, 32), unit: raw.unit === 'ml' ? 'ml' : 'g', amount: r1(amount), per100 }
}

export const normalizeIngredients = list => (Array.isArray(list) ? list : []).map(normalizeIngredient).filter(Boolean).slice(0, 60)

/**
 * A recipe's numbers: { raw, weight, total: { kcal, p, c, f }, per100 } — `raw` the ingredients'
 * weight, `weight` the cooked pot's (or the raw weight without one), `per100` the label of 100 g
 * of the cooked dish. Null with no ingredients.
 */
export function recipeNumbers(ingredients, cooked = null) {
  const list = normalizeIngredients(ingredients)
  if (!list.length) return null
  const total = foodTotals(list.map(i => portion(i.per100, i.amount)))
  const raw = list.reduce((n, i) => n + i.amount, 0)
  const weight = Number(cooked) > 0 ? Number(cooked) : raw
  const per100 = cleanPer100({ kcal: total.kcal / weight * 100, p: total.p / weight * 100, c: total.c / weight * 100, f: total.f / weight * 100 })
  return { raw: r1(raw), weight: r1(weight), total: { kcal: Math.round(total.kcal), p: total.p, c: total.c, f: total.f }, per100 }
}

/* --------------------------------------------------------------------- saved meals -- */
// A meal eaten again and again — the usual breakfast, the shake after training — kept by name and
// added to any day in one tap (the diary otherwise only copies from the day before). S.meals:
//   [{ id, name, items: [diary item], at }]

/** A saved meal in its stable shape, or null without a name or items. */
export function normalizeMeal(raw) {
  if (!raw || typeof raw !== 'object') return null
  const name = cleanText(raw.name, 80)
  const items = normalizeFoodList((Array.isArray(raw.items) ? raw.items : []).map((it, i) => ({ ...it, id: it?.id || 'm' + i }))).slice(0, 40)
  if (!name || !items.length) return null
  return { id: cleanText(String(raw.id ?? ''), 40) || uidOf(), name, items, at: Number(raw.at) > 0 ? Number(raw.at) : Date.now() }
}

export const mealsOf = S => (Array.isArray(S?.meals) ? S.meals : []).map(normalizeMeal).filter(Boolean)

/** Keeps a meal in S.meals: replaces the one with its id or name, newest first. Returns it. */
export function saveMeal(state, raw, now = Date.now()) {
  const m = normalizeMeal({ ...raw, at: now })
  if (!m) return null
  const same = x => x.id === m.id || x.name.toLowerCase() === m.name.toLowerCase()
  const old = mealsOf(state).find(same)
  if (old) m.id = old.id
  state.meals = [m, ...mealsOf(state).filter(x => !same(x))].slice(0, 50)
  return m
}

/** Adds a saved meal's items to `meal` of a day, as new items. Returns how many. */
export function addMealToDay(state, iso, saved, meal, now = Date.now()) {
  const m = normalizeMeal(saved)
  if (!m) return 0
  m.items.forEach((it, i) => addFoodItem(state, iso, { ...it, id: null, meal, at: now + i }, now))
  return m.items.length
}

/* ------------------------------------------------------------------- the pan's oil -- */
// Weighed raw, a piece of meat or a potato carries none of the oil it is then fried in — a
// tablespoon is 120 kcal that a diary never sees (Cronometer asks about it for that reason). The
// built-in pan-fried and fried foods already hold the oil a normal pan leaves on them.

/** 'ask' for a food weighed raw (the oil is not in it), 'included' for a built-in fried one, else null. */
export function oilAsk(food) {
  if (!food) return null
  const ref = String(food.ref || food.id || '')
  const name = foldText(food.name)
  if (ref.startsWith('basic:') && /-(pan|fried)\b|-fried$|-pan$/.test(ref)) return 'included'
  if (/-raw$/.test(ref) || /\b(raw|crud|cruda|crude|crudă)\b/.test(name)) return 'ask'
  return null
}

/** The oil added to a meal: sunflower oil (the built-in one), `grams` of it. */
export const OIL_REF = 'basic:sunflower-oil'
export function oilItem(meal, grams, lang = 'en') {
  const b = BASIC_BY_ID.get(OIL_REF)
  return { meal, name: lang === 'ro' ? b.ro : b.en, src: 'basic', ref: OIL_REF, unit: 'g', amount: grams, per100: b.per100 }
}

/* ------------------------------------------------------------- closing the protein -- */

/**
 * What would close the day's protein: up to three foods, each with the grams that bring `need`
 * grams of protein — the person's own lean foods first (eaten lately, or kept), then the built-in
 * ones richest in protein for their calories. A food is only offered when its amount is a normal
 * portion (under 600 g) and its calories fit in what is left (`kcalLeft`, with 100 to spare).
 *   → [{ food, grams, kcal, p }]
 */
export function proteinCloser(S, { need, kcalLeft = Infinity, today, lang = 'en', limit = 3 } = {}) {
  if (!(need >= 5)) return []
  const lean = f => f?.per100 && f.per100.p >= 8 && f.per100.kcal > 0 && (4 * f.per100.p) / f.per100.kcal >= 0.45
  const seen = new Set()
  const pool = []
  const take = (food, mine) => {
    if (!lean(food)) return
    const key = food.code ? 'c' + food.code : food.ref || food.id || foldText(food.name)
    const name = 'n' + foldText(food.name)
    if (seen.has(key) || seen.has(name)) return
    seen.add(key); seen.add(name)
    pool.push({ food, mine })
  }
  for (const r of recentFoods(S, today, { days: 45, limit: 60 })) take(foodFor(S, r, lang) || r, true)
  for (const f of S?.foods || []) take(f, true)
  for (const f of basicFoods(lang)) take(f, false)
  const out = []
  const ranked = pool.sort((a, b) => (b.mine - a.mine) || ((4 * b.food.per100.p) / b.food.per100.kcal - (4 * a.food.per100.p) / a.food.per100.kcal))
  for (const { food } of ranked) {
    const grams = Math.ceil(need / food.per100.p * 100 / 5) * 5
    const tot = portion(food.per100, grams)
    if (grams > 600 || tot.kcal > kcalLeft + 100) continue
    out.push({ food, grams, kcal: tot.kcal, p: tot.p })
    if (out.length >= limit) break
  }
  return out
}

/* -------------------------------------------------------------------------- search -- */

export const foldText = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Does every word of the query start a word of the text (accents and case aside)? */
export function matches(text, query) {
  const words = foldText(text).split(/[^a-z0-9%]+/).filter(Boolean)
  return foldText(query).split(/\s+/).filter(Boolean).every(q => words.some(w => w.startsWith(q)))
}

/**
 * The language food names are shown in: Romanian when the app or the phone is set to it, else
 * English. The built-in foods carry both, and a search matches either.
 */
export function foodLang(appLang, languages = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || []) {
  if (appLang === 'ro') return 'ro'
  return [].concat(languages).some(l => /^ro\b/i.test(String(l || ''))) ? 'ro' : 'en'
}

const basicAsFood = (b, lang) => ({
  id: b.id, ref: b.id, src: 'basic', cat: b.cat, name: lang === 'ro' ? b.ro : b.en,
  // what a search also finds it by: the other language's name and its cooking method's words
  alt: (lang === 'ro' ? b.en : b.ro) + (b.kw ? ' ' + b.kw : ''), brand: '', code: '',
  unit: b.unit, per100: b.per100,
  ...(b.serving ? { serving: { label: lang === 'ro' ? b.serving.ro : b.serving.en, amount: b.serving.amount } } : {}),
})

/** The shelves of the built-in list, named in `lang`: [{ id, name }]. */
export const basicCats = (lang = 'en') => FOOD_CATS.map(c => ({ id: c.id, name: lang === 'ro' ? c.ro : c.en }))

/** The built-in foods as foods, named in `lang` ('ro' or anything else for English). */
export function basicFoods(lang = 'en') {
  return BASIC_FOODS.map(b => basicAsFood(b, lang))
}

/**
 * The whole food behind a diary item or a recent row — with its serving and pack size, which an
 * item does not carry: the built-in food, the kept one with that barcode or id, or else the item
 * itself as a food (its own numbers per 100).
 */
export function foodFor(S, it, lang = 'en') {
  if (!it) return null
  const ref = String(it.ref || '')
  if (ref.startsWith('basic:') && BASIC_BY_ID.has(ref)) return basicAsFood(BASIC_BY_ID.get(ref), lang)
  const mine = (it.code && myFoodByCode(S, it.code)) || (S?.foods || []).find(f => f.id === ref) || null
  if (mine) return mine
  if (!it.per100) return null
  return { id: ref || null, ref, src: it.src === 'off' ? 'off' : 'custom', name: it.name, brand: it.brand || '', code: it.code || '', unit: it.unit || 'g', per100: it.per100 }
}

/**
 * The foods eaten lately, most recent first, one row per food (the same product, built-in or
 * custom food counts once), each with the amount and meal it was last logged with.
 */
export function recentFoods(S, today, { days = 45, limit = 40 } = {}) {
  const from = (() => { const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() - days); return isoOf(d) })()
  const rows = new Map()
  const entries = (S?.dailyLog || []).filter(e => e && e.d >= from && e.d <= today && e.food?.length).sort((a, b) => b.d.localeCompare(a.d))
  for (const e of entries) {
    for (const it of [...e.food].sort((a, b) => (b.at || 0) - (a.at || 0))) {
      if (!it.per100) continue
      const key = it.code ? 'code:' + it.code : it.ref ? 'ref:' + it.ref : 'name:' + foldText(it.name + '|' + it.brand)
      if (rows.has(key)) { rows.get(key).times++; continue }
      rows.set(key, { key, name: it.name, brand: it.brand, code: it.code, src: it.src, ref: it.ref, unit: it.unit, per100: it.per100, lastAmount: it.amount, lastSv: it.sv ?? null, lastMeal: it.meal, lastDay: e.d, times: 1 })
    }
  }
  return [...rows.values()].slice(0, limit)
}

/**
 * How much of a food was had the last time it was logged — { amount, sv, unit, meal, d } — or null.
 * The same barcode, the same built-in or kept food, or else the same name and brand.
 */
export function lastPortionOf(S, food) {
  if (!food) return null
  const code = food.code || ''
  const ref = food.ref || food.id || ''
  const name = foldText((food.name || '') + '|' + (food.brand || ''))
  const same = it => it.per100 && it.amount > 0 && ((code && it.code === code) || (ref && it.ref === ref) || foldText(it.name + '|' + (it.brand || '')) === name)
  const entries = (S?.dailyLog || []).filter(e => e?.food?.length).sort((a, b) => b.d.localeCompare(a.d))
  for (const e of entries) {
    const hit = [...e.food].sort((a, b) => (b.at || 0) - (a.at || 0)).find(same)
    if (hit) return { amount: hit.amount, sv: hit.sv ?? null, unit: hit.unit, meal: hit.meal, d: e.d }
  }
  return null
}

// Best first: a name that starts with what was typed, then one with every word in the name
// itself (not only in the other language or the method words), then the rest in list order.
const rank = (list, q, nameOf) => {
  const fq = foldText(q)
  const score = f => (foldText(nameOf(f)).startsWith(fq) ? 0 : matches(nameOf(f), q) ? 1 : 2)
  return list.map((f, i) => [score(f), i, f]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2])
}

/** My foods and the built-in ones that match a query, mine first; `cat` narrows the built-in ones. */
export function searchLocal(S, query, lang = 'en', cat = null) {
  const q = String(query || '').trim()
  const mine = (S?.foods || []).filter(f => !q || matches(f.name + ' ' + (f.brand || ''), q) || (f.code && f.code === q))
  let basics = basicFoods(lang).filter(f => (!cat || f.cat === cat) && (!q || matches(f.name + ' ' + f.alt, q)))
  if (q) basics = rank(basics, q, f => f.name)
  return { mine: q ? rank(mine, q, f => f.name) : mine, basics }
}

/* ------------------------------------------------------------------------- targets -- */

/** The day's targets: calories, then protein, carbs and fat in grams. */
export const macroTargets = cut => ({ kcal: cut.kcal, p: cut.protein, c: cut.carbs, f: cut.fat })
