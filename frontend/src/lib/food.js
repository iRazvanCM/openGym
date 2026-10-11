// The food diary: what was eaten, meal by meal, and what it adds up to.
//
// A day's food lives on that day's daily-log entry (lib/cut.js), as `food: [item]`, so a day stays
// one record: it syncs, merges, backs up and exports like the weigh-ins do, with no new list for
// the sync to learn. When a day has food logged, its calories and protein come from the food —
// the totals typed into the daily log are for days without a diary. An item is:
//
//   { id, meal: 'b' | 'l' | 'd' | 's', name, brand, code, src: 'off' | 'basic' | 'custom' | 'quick',
//     ref, amount, unit: 'g' | 'ml', per100: { kcal, p, c, f, fib? }, kcal, p, c, f, at }
//
// `per100` is what the label says per 100 g (or 100 ml); the item's own kcal/p/c/f are the portion,
// worked out when it was logged and kept, so a food changed later never rewrites a past day.
// A quick add has no per100 and no amount: just the numbers typed.
//
// The foods a person keeps — scanned products, their own recipes and custom foods — are S.foods:
// [{ id, name, brand, code, unit, per100, serving: { label, amount }, src, at }].
import { BASIC_FOODS } from './food-basics.js'

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
  if (per100 && amount != null && amount > 0) {
    item.per100 = per100
    item.amount = r1(amount)
    Object.assign(item, portion(per100, amount))
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
  for (const it of items || []) { t.kcal += it.kcal || 0; t.p += it.p || 0; t.c += it.c || 0; t.f += it.f || 0; t.n++ }
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
 * A day's calories and macros: the food diary's totals when the day has any food, else the
 * calories and protein typed into the daily log. `src` says which: 'food', 'log' or null.
 */
export function dayNutrition(S, iso) {
  const e = entryOf(S, iso)
  if (e?.food?.length) {
    const t = foodTotals(e.food)
    return { kcal: t.kcal, protein: t.p, carbs: t.c, fat: t.f, n: t.n, src: 'food' }
  }
  if (e && (e.kcal != null || e.protein != null)) return { kcal: e.kcal ?? null, protein: e.protein ?? null, carbs: null, fat: null, n: 0, src: 'log' }
  return { kcal: null, protein: null, carbs: null, fat: null, n: 0, src: null }
}

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
    src: raw.src === 'off' ? 'off' : 'custom',
    at: Number(raw.at) > 0 ? Number(raw.at) : Date.now(),
  }
  const amount = num(raw.serving?.amount, 5000)
  if (amount && amount > 0) f.serving = { label: cleanText(raw.serving.label, 40) || '', amount: r1(amount) }
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

/* -------------------------------------------------------------------------- search -- */

export const foldText = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Does every word of the query start a word of the text (accents and case aside)? */
export function matches(text, query) {
  const words = foldText(text).split(/[^a-z0-9%]+/).filter(Boolean)
  return foldText(query).split(/\s+/).filter(Boolean).every(q => words.some(w => w.startsWith(q)))
}

/** The built-in foods as foods, named in `lang` ('ro' or anything else for English). */
export function basicFoods(lang = 'en') {
  return BASIC_FOODS.map(b => ({
    id: b.id, ref: b.id, src: 'basic', name: lang === 'ro' ? b.ro : b.en, alt: lang === 'ro' ? b.en : b.ro, brand: '', code: '',
    unit: b.unit, per100: b.per100,
    ...(b.serving ? { serving: { label: lang === 'ro' ? b.serving.ro : b.serving.en, amount: b.serving.amount } } : {}),
  }))
}

/**
 * The foods eaten lately, most recent first, one row per food (the same product, built-in or
 * custom food counts once), each with the amount and meal it was last logged with.
 */
export function recentFoods(S, today, { days = 45, limit = 40 } = {}) {
  const from = (() => { const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10) })()
  const rows = new Map()
  const entries = (S?.dailyLog || []).filter(e => e && e.d >= from && e.d <= today && e.food?.length).sort((a, b) => b.d.localeCompare(a.d))
  for (const e of entries) {
    for (const it of [...e.food].sort((a, b) => (b.at || 0) - (a.at || 0))) {
      if (!it.per100) continue
      const key = it.code ? 'code:' + it.code : it.ref ? 'ref:' + it.ref : 'name:' + foldText(it.name + '|' + it.brand)
      if (rows.has(key)) { rows.get(key).times++; continue }
      rows.set(key, { key, name: it.name, brand: it.brand, code: it.code, src: it.src, ref: it.ref, unit: it.unit, per100: it.per100, lastAmount: it.amount, lastMeal: it.meal, lastDay: e.d, times: 1 })
    }
  }
  return [...rows.values()].slice(0, limit)
}

/** My foods and the built-in ones that match a query, mine first. */
export function searchLocal(S, query, lang = 'en') {
  const q = String(query || '').trim()
  const mine = (S?.foods || []).filter(f => !q || matches(f.name + ' ' + (f.brand || ''), q) || (f.code && f.code === q))
  const basics = basicFoods(lang).filter(f => !q || matches(f.name + ' ' + f.alt, q))
  return { mine, basics }
}

/* ------------------------------------------------------------------------- targets -- */

/** The day's targets: calories, then protein, carbs and fat in grams. */
export const macroTargets = cut => ({ kcal: cut.kcal, p: cut.protein, c: cut.carbs, f: cut.fat })
