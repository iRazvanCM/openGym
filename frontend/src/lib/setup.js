// The setup: what a person tells the app once — sex, age, height, weight, goal, how active —
// worked out into a plan the way a coach (or MyFitnessPal) would, next to the plan already set.
//
// Maintenance is Mifflin–St Jeor (1990), the resting-energy equation the Academy of Nutrition and
// Dietetics found the most accurate for most adults (within 10% for most people), times an
// activity factor. It is a starting guess: Progress replaces it with the maintenance the log itself
// shows after a few weeks (lib/cut.js expenditure). Calories are maintenance minus the pace aimed
// for (7,700 kcal a kg), never under a floor; protein is set from the goal weight (≈2 g/kg — the
// cut literature's 1.6–2.4 g/kg of body weight, higher while lean mass is at stake), fat a floor of
// about 0.7 g/kg of goal weight, carbs whatever is left (lib/cut.js carbsFor).
import { KCAL_PER_KG, carbsFor } from './cut.js'

/** How active a day is, beyond the training itself counted in the factor. */
export const ACTIVITY = Object.freeze([
  { id: 'low', factor: 1.2 },        // sitting most of the day, little walking
  { id: 'light', factor: 1.375 },    // some walking, training 1–3 times a week
  { id: 'moderate', factor: 1.5 },   // on your feet a fair bit, training 3–5 times
  { id: 'high', factor: 1.6 },       // training most days, daily cardio, ~10,000 steps
  { id: 'very', factor: 1.8 },       // a physical job on top of hard training
])
export const activityFactor = id => (ACTIVITY.find(a => a.id === id) || ACTIVITY[3]).factor

const round10 = n => Math.round(n / 10) * 10
const round5 = n => Math.round(n / 5) * 5
const num = (v, lo, hi) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n >= lo && n <= hi ? n : null }

/** The profile in its stable shape: { sex: 'm' | 'f', born, heightCm, activity }, unknowns null. */
export function profileOf(S) {
  const p = S?.profile && typeof S.profile === 'object' ? S.profile : {}
  return {
    sex: p.sex === 'f' ? 'f' : p.sex === 'm' ? 'm' : null,
    born: num(p.born, 1900, 2100),
    heightCm: num(p.heightCm, 100, 250),
    activity: ACTIVITY.some(a => a.id === p.activity) ? p.activity : 'high',
  }
}

/** Age on a day from the year of birth (the birthday itself unknown: the year is enough here). */
export const ageOn = (born, iso) => (born ? Number(String(iso).slice(0, 4)) - born : null)

/** Resting energy, kcal a day (Mifflin–St Jeor); null without all four inputs. */
export function bmr({ sex, age, heightCm, weightKg }) {
  if (!sex || !(age > 0) || !(heightCm > 0) || !(weightKg > 0)) return null
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'f' ? -161 : 5)
}

/**
 * The plan worked out from a profile: { bmr, maintenance, kcal, floor, protein, fat, carbs,
 * rate } — kcal a day for losing `rateKgWk` (kg a week) at that maintenance, never under the floor
 * (the resting energy itself, and 1,500 kcal for a man or 1,200 for a woman at the least). Null
 * when the profile is not complete enough to work anything out.
 */
export function suggestPlan({ sex, age, heightCm, weightKg, goalKg, activity, rateKgWk = 1 }) {
  const rest = bmr({ sex, age, heightCm, weightKg })
  if (rest == null) return null
  const maintenance = round10(rest * activityFactor(activity))
  const floor = round10(Math.max(rest, sex === 'f' ? 1200 : 1500))
  const kcal = Math.max(floor, round10(maintenance - rateKgWk * KCAL_PER_KG / 7))
  const ref = goalKg > 0 && goalKg < weightKg ? goalKg : weightKg
  const protein = round5(2 * ref)
  const fat = round5(0.7 * ref)
  return {
    bmr: Math.round(rest), maintenance, kcal, floor, protein, fat, carbs: carbsFor(kcal, protein, fat),
    // the weekly loss these calories give at that maintenance (less than asked when the floor holds)
    rate: Math.round((maintenance - kcal) * 7 / KCAL_PER_KG * 100) / 100,
  }
}

/** Weeks to go from one weight to another at a weekly loss; null when it does not add up. */
export const weeksTo = (fromKg, toKg, rateKgWk) => (fromKg > toKg && rateKgWk > 0 ? Math.ceil((fromKg - toKg) / rateKgWk) : null)
