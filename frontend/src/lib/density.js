// Food volume and hunger (report, item 11): how many calories each gram of food carried, day by
// day, set against how hungry the day felt.
//
// Eating foods that hold water (vegetables, fruit, soups, lean protein) means more food for the
// same calories, and less hunger: in a year-long trial, women who added them ate 25% more food by
// weight, felt less hungry and lost 8.9 kg in six months against 6.7 (Ello-Martin et al. 2007).
// Hardly anyone can see it in their own diary, because hardly anyone weighs their food — and
// someone who does has every number for it. Only weighed foods count (an item with grams); drinks
// (logged in ml) stay out, as in the studies, since a litre of water would halve a day's density.
import { addDays, countedNutrition, logFor } from './cut.js'
import { portion } from './food.js'

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const r2 = n => (n == null ? null : Math.round(n * 100) / 100)

/** One day's density: { kcal, grams, density } from its weighed foods, or null with too little weighed. */
export function dayDensity(e) {
  if (!e?.food?.length) return null
  let kcal = 0, grams = 0
  for (const it of e.food) {
    if (!(it?.amount > 0) || it.unit === 'ml' || !it.per100) continue
    // an item as stored carries its portion; one read straight from a file is worked out from its label
    kcal += it.kcal ?? portion(it.per100, it.amount).kcal
    grams += it.amount
  }
  return grams >= 300 ? { kcal, grams, density: kcal / grams } : null
}

/**
 * The days from `from` to `to` that have both: [{ d, density, grams, hunger, protein, sleep }] —
 * a counted day only (today once complete, never one marked as logged in part).
 */
export function densityDays(S, from, to, today) {
  const out = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const e = logFor(S, d)
    const n = e ? countedNutrition(e, today) : null
    if (!n || n.kcal == null) continue
    const x = dayDensity(e)
    if (!x) continue
    out.push({ d, density: x.density, grams: x.grams, kcal: n.kcal, protein: n.protein, hunger: e.hunger ?? null, sleep: e.sleep ?? null })
  }
  return out
}

/**
 * The last four weeks in brief: { week: { density, grams, n }, full, hungry, ready } — `full` the
 * days rated 1–2 for hunger, `hungry` those rated 4–5, each { density, grams, protein, sleep, n };
 * `ready` once each has three days.
 */
export function densityReport(S, today) {
  const days = densityDays(S, addDays(today, -27), today, today)
  const avg = (list, k) => r2(mean(list.map(x => x[k]).filter(v => v != null)))
  const sum = list => ({ density: avg(list, 'density'), grams: list.length ? Math.round(mean(list.map(x => x.grams))) : null, protein: avg(list, 'protein'), sleep: avg(list, 'sleep'), n: list.length })
  const last7 = days.filter(x => x.d > addDays(today, -7))
  const full = days.filter(x => x.hunger != null && x.hunger <= 2)
  const hungry = days.filter(x => x.hunger != null && x.hunger >= 4)
  return { days: days.length, week: sum(last7), full: sum(full), hungry: sum(hungry), ready: full.length >= 3 && hungry.length >= 3 }
}
