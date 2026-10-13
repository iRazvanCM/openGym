// The first-run questions (views/Onboarding.jsx): who you are, where your weight stands, what you
// want, and the calories that get you there — the way the big diet apps start.
//
// Where the weight stands is the BMI, in the WHO's bands: under 18.5 underweight, 18.5–24.9 a
// healthy weight, 25–29.9 overweight, 30 and over obesity (class I to 35, II to 40, III above).
// BMI cannot tell muscle from fat — a lifter heavy with muscle reads as overweight — so the screen
// says so, and Progress later has the better check (the waist under half the height).
//
// The calories: maintenance from Mifflin–St Jeor times how active the days are (lib/setup.js).
//   lose      maintenance minus the weekly pace (7,700 kcal a kg), never under a floor: the
//             resting energy itself, and at least 1,500 kcal for a man, 1,200 for a woman. Paces of
//             0.25 to 1 kg a week; the one offered first is the fastest within 1% of the body
//             weight, the edge of the range linked to keeping muscle (Helms 2014, Garthe 2011).
//   maintain  maintenance.
//   gain      maintenance plus the pace: 0.25 or 0.5 kg a week. A lean gain is slow; past about
//             half a kilo a week most of what comes on is fat.
// Protein: 2 g per kg of the goal weight when losing (the cut studies' 1.6–2.4), 1.6 g/kg to
// maintain, 1.8 g/kg to gain (the 1.6–2.2 that building muscle needs) — per kg of body weight, up
// to the weight at a BMI of 30: protein follows lean mass, not fat. Fat: 0.7 g a kg of that weight
// at least, and a quarter of the calories. Carbs: the rest (lib/cut.js carbsFor).
import { KCAL_PER_KG, LB_PER_KG, addDays, carbsFor, cutOf, isIso } from './cut.js'
import { activityFactor, bmr } from './setup.js'

export const GOALS = Object.freeze(['lose', 'maintain', 'gain'])

/** The weekly paces on offer, kg a week; each is aimed for as a band of ±20% around it. */
export const PACES = Object.freeze({
  lose: Object.freeze([0.25, 0.5, 0.75, 1]),
  gain: Object.freeze([0.25, 0.5]),
})

/** What the questions accept: adults only — the bands and the equations are for adults. */
export const LIMITS = Object.freeze({ age: [18, 100], heightCm: [120, 230], weightKg: [35, 300] })

const round = (n, dec = 0) => { const f = 10 ** dec; return Math.round(n * f) / f }
const round5 = n => Math.round(n / 5) * 5
const round10 = n => Math.round(n / 10) * 10
const inRange = (v, [lo, hi]) => Number.isFinite(Number(v)) && v !== null && v !== '' && Number(v) >= lo && Number(v) <= hi

/** The weight at a BMI for a height, kg. */
export const weightAtBmi = (bmi, heightCm) => bmi * (heightCm / 100) ** 2

/** Body mass index, one decimal; null without a height and a weight. */
export function bmiOf(weightKg, heightCm) {
  if (!(weightKg > 0) || !(heightCm > 0)) return null
  return round(weightKg / (heightCm / 100) ** 2, 1)
}

/** The WHO band of a BMI: under | healthy | over | obese1 | obese2 | obese3. */
export function bmiBand(bmi) {
  if (bmi == null) return null
  if (bmi < 18.5) return 'under'
  if (bmi < 25) return 'healthy'
  if (bmi < 30) return 'over'
  if (bmi < 35) return 'obese1'
  if (bmi < 40) return 'obese2'
  return 'obese3'
}

/** The healthy weights for a height, kg: BMI 18.5 to 24.9, one decimal. */
export function healthyRange(heightCm) {
  if (!(heightCm > 0)) return null
  return { min: round(weightAtBmi(18.5, heightCm), 1), max: round(weightAtBmi(24.9, heightCm), 1) }
}

/** The goal the BMI points to: lose from 25, gain under 18.5, otherwise maintain. */
export const recommendGoal = bmi => (bmi == null ? 'maintain' : bmi >= 25 ? 'lose' : bmi < 18.5 ? 'gain' : 'maintain')

/** A pace in kg a week as the band the plan aims for, ±20%: 1 kg is 0.8–1.2. */
export const paceBand = kg => ({ min: round(kg * 0.8, 2), max: round(kg * 1.2, 2) })

/**
 * The pace offered first: losing, the fastest within 1% of the body weight (1 kg a week at 106 kg,
 * 0.5 at 70); gaining, the slow one.
 */
export function recommendedPace(goal, weightKg) {
  if (goal === 'gain') return PACES.gain[0]
  const fits = PACES.lose.filter(kg => kg <= weightKg * 0.01 + 1e-9)
  return fits.length ? fits[fits.length - 1] : PACES.lose[0]
}

/**
 * The goal weight to start the field with, kg: the one already set when it points the right way;
 * losing, the top of the healthy range, or 15% off when that is further than a first goal should be;
 * gaining, the bottom of the healthy range when under it, else 5 kg more.
 */
export function suggestGoalWeight(goal, weightKg, heightCm, current = null) {
  if (!(weightKg > 0)) return null
  if (goal === 'lose' && current > 0 && current < weightKg) return current
  if (goal === 'gain' && current > 0 && current > weightKg) return current
  const hr = healthyRange(heightCm)
  if (goal === 'lose') {
    const top = hr ? hr.max : weightKg * 0.9
    return Math.round(top < weightKg - 1 ? Math.max(top, weightKg * 0.85) : weightKg - 5)
  }
  if (goal === 'gain') return Math.round(hr && hr.min > weightKg + 1 ? hr.min : weightKg + 5)
  return round(weightKg, 1)
}

/**
 * The plan the answers work out to: { bmr, maintenance, kcal, floor, protein, fat, carbs, rate,
 * weeks } — `rate` the weekly change the calories give, kg (a loss positive when losing, a gain
 * positive when gaining; 0 at maintenance), `weeks` to the goal at that rate (null without one).
 * Null when the answers are not complete.
 */
export function planFor({ sex, age, heightCm, weightKg, activity, goal = 'lose', goalKg = null, paceKg = null }) {
  const rest = bmr({ sex, age, heightCm, weightKg })
  if (rest == null || !GOALS.includes(goal)) return null
  const maintenance = round10(rest * activityFactor(activity))
  const floor = round10(Math.max(rest, sex === 'f' ? 1200 : 1500))
  const pace = paceKg > 0 ? paceKg : recommendedPace(goal, weightKg)
  let kcal = maintenance
  if (goal === 'lose') kcal = Math.max(floor, round10(maintenance - pace * KCAL_PER_KG / 7))
  if (goal === 'gain') kcal = round10(maintenance + pace * KCAL_PER_KG / 7)
  const rate = goal === 'maintain' ? 0 : round(Math.abs(kcal - maintenance) * 7 / KCAL_PER_KG, 2)

  const cap = weightAtBmi(30, heightCm)
  const ref = Math.min(goal === 'lose' && goalKg > 0 && goalKg < weightKg ? goalKg : weightKg, cap)
  const protein = round5((goal === 'lose' ? 2 : goal === 'gain' ? 1.8 : 1.6) * ref)
  const fat = round5(Math.max(0.7 * ref, 0.25 * kcal / 9))
  const away = goal === 'lose' ? weightKg - goalKg : goal === 'gain' ? goalKg - weightKg : 0
  const weeks = goalKg > 0 && away > 0 && rate > 0 ? Math.ceil(away / rate) : null
  return { bmr: Math.round(rest), maintenance, kcal, floor, protein, fat, carbs: carbsFor(kcal, protein, fat), rate, weeks, pace }
}

/** Whether the answers are complete and in range: { ok, field } — the first one that is not. */
export function checkAnswers(a, unit = 'kg') {
  const per = unit === 'lb' ? LB_PER_KG : 1
  if (a.sex !== 'm' && a.sex !== 'f') return { ok: false, field: 'sex' }
  if (!inRange(a.age, LIMITS.age)) return { ok: false, field: 'age' }
  if (!inRange(a.heightCm, LIMITS.heightCm)) return { ok: false, field: 'heightCm' }
  if (!inRange(a.weight / per, LIMITS.weightKg)) return { ok: false, field: 'weight' }
  return { ok: true, field: null }
}

/**
 * The answers written into the state: the profile, today's weight, the goal weight and the plan
 * (S.cut) for the goal chosen — a cut, maintenance at today's weight, or a gain — then marked
 * done. What the questions did not ask (reminders, the key lifts, the check-in day; the diet
 * breaks of a cut) stays as it was. `a`: { sex, age, heightCm, weight, activity, goal, goalWeight,
 * paceKg, start, steps, cardio, sleep, gymDays } — the weights in the profile's unit.
 */
export function applyOnboarding(s, a, { today, now = Date.now() } = {}) {
  const per = s.unit === 'lb' ? LB_PER_KG : 1
  const weightKg = a.weight / per
  const goalKg = a.goal === 'maintain' ? null : a.goalWeight / per
  const plan = planFor({ sex: a.sex, age: a.age, heightCm: a.heightCm, weightKg, activity: a.activity, goal: a.goal, goalKg, paceKg: a.paceKg })
  if (!plan) return null

  s.profile = { sex: a.sex, born: Number(today.slice(0, 4)) - Math.round(a.age), heightCm: Math.round(a.heightCm), activity: a.activity }

  // today's weight: a number typed is the morning's reading. The last weigh-in, shown in the field
  // and left as it was, is not a new one — written again as today's it would flatten the trend.
  const w = round(a.weight, 1)
  const list = Array.isArray(s.bodyweight) ? s.bodyweight.slice() : []
  const i = list.findIndex(b => b.d === today)
  const lastW = list.length ? list.reduce((x, y) => (y.d >= x.d ? y : x)).w : null
  if (i >= 0) { if (list[i].w !== w) list[i] = { ...list[i], w, t: now } } else if (w !== lastW) list.push({ d: today, w, t: now })
  s.bodyweight = list.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0))

  s.targetW = a.goal === 'maintain' ? w : round(a.goalWeight, 1)

  const prev = cutOf(s)
  const band = a.goal === 'maintain' ? null : paceBand(plan.pace)
  const habits = {}
  for (const k of ['steps', 'cardio', 'sleep', 'gymDays']) if (a[k] != null && a[k] !== '') habits[k] = a[k]
  const start = isIso(a.start) && a.start >= addDays(today, -60) ? a.start : today
  s.cut = cutOf({
    cut: {
      ...prev, ...habits,
      mode: a.goal === 'lose' ? 'cut' : a.goal,
      start: a.goal === 'lose' ? start : today,
      kcal: plan.kcal, protein: plan.protein, fat: plan.fat, minKcal: Math.min(plan.floor, plan.kcal), maintenance: plan.maintenance,
      rateMode: 'kg', ...(band ? { rateMin: band.min, rateMax: band.max } : {}),
      breaks: a.goal === 'lose' ? prev.breaks : [],
      changedAt: null, cutKcal: null,
      endW: a.goal === 'maintain' ? w : null,
      endedAt: a.goal === 'maintain' ? today : null,
    },
  })
  s.onboarded = now
  return plan
}
