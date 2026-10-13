// Eating off plan, logged in three taps, and the if–then plans that answer it (report, item 7).
//
// At home all day, the slips come from boredom and hunger more than from anywhere else: among adults
// in a weight-loss programme followed through the day, boredom, loneliness, irritation, hunger and
// feeling deprived each raised the odds of a lapse. Whether a lapse becomes a relapse
// depends on how it is read (Marlatt): "I have no willpower" leads on, "at nine in the evening I
// had no plan" stops it. So an off-plan entry asks only how much (a guess is fine) and what set it
// off, and when the same trigger comes back, the app proposes a plan for it — "if it is after
// 21:00 and I am hungry, then 300 g of Greek yogurt with berries". Plans that put something in the
// place of the snack work better than plans that forbid it (d = 0.51 for adding healthy food
// against 0.29 for cutting unhealthy; Adriaanse 2011), so every template has a replacement as its
// "then". At most three are kept active at once: more stop being remembered.
//
// An off-plan entry is a quick add on the day's food diary (lib/food.js) carrying its trigger
// (`trig`), so its calories count like any other food. Plans live in S.plans:
//   [{ id, trig, if, then, on, at }]
import { addDays } from './cut.js'
import { mealAt } from './food.js'

export const TRIGGERS = ['hunger', 'bored', 'stress', 'tired', 'social', 'alcohol']
export const TRIGGER_LABEL = { hunger: 'Hunger', bored: 'Boredom', stress: 'Stress', tired: 'Tiredness', social: 'Social', alcohol: 'Alcohol' }
export const TRIGGER_ICON = { hunger: 'utensils', bored: 'hourglass', stress: 'bolt', tired: 'moon', social: 'person', alcohol: 'shield' }

/** The calorie guesses offered, a tap each. */
export const OFF_KCAL = [200, 400, 600, 800, 1000, 1500]
export const MAX_ACTIVE_PLANS = 3

/** The plan proposed for each trigger: a time or a cue, and something to do instead. */
export const PLAN_TEMPLATES = {
  hunger: { if: 'it is after 21:00 and I am hungry', then: 'I have 300 g of Greek yogurt with berries' },
  bored: { if: 'I am bored at home and head for the kitchen', then: 'I go for a 15-minute walk first' },
  stress: { if: 'I am stressed and reach for a snack', then: 'I make a tea and step outside for ten minutes' },
  tired: { if: 'I am tired in the evening and want something sweet', then: 'I brush my teeth and get ready for bed' },
  social: { if: 'I eat out or with others', then: 'I start with protein and vegetables, and log it before I eat' },
  alcohol: { if: 'someone offers me a drink', then: 'I ask for sparkling water with lemon' },
}

/** A diary item for an off-plan entry: a quick add of `kcal` with its trigger, in the meal of the hour. */
export function offPlanItem({ kcal, trig, name, meal, at = new Date() }) {
  return {
    meal: meal || mealAt(at), src: 'quick', name: name || 'Off plan',
    kcal: Math.round(kcal), p: 0, c: 0, f: 0, ...(TRIGGERS.includes(trig) ? { trig } : {}), off: true,
  }
}

/** The off-plan entries of a stretch of days, oldest first: [{ d, kcal, trig, name }]. */
export function offPlanEntries(S, from, to) {
  const out = []
  for (const e of Array.isArray(S?.dailyLog) ? S.dailyLog : []) {
    if (!e || e.d < from || e.d > to) continue
    for (const it of e.food || []) if (it?.off) out.push({ d: e.d, kcal: it.kcal || 0, trig: it.trig || null, name: it.name })
  }
  return out.sort((a, b) => a.d.localeCompare(b.d))
}

/** How often each trigger came up in the last `days` days. */
export function triggerCounts(S, today, days = 14) {
  const counts = {}
  for (const x of offPlanEntries(S, addDays(today, -(days - 1)), today)) if (x.trig) counts[x.trig] = (counts[x.trig] || 0) + 1
  return counts
}

/* ---------------------------------------------------------------------- the plans -- */

const clean = (v, max = 160) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** A plan in its stable shape, or null without both halves. */
export function normalizePlan(raw) {
  if (!raw || typeof raw !== 'object') return null
  const ifText = clean(raw.if), thenText = clean(raw.then)
  if (!ifText || !thenText) return null
  return {
    id: clean(String(raw.id ?? ''), 40) || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    trig: TRIGGERS.includes(raw.trig) ? raw.trig : null,
    if: ifText, then: thenText, on: raw.on !== false,
    at: Number(raw.at) > 0 ? Number(raw.at) : Date.now(),
  }
}

export const plansOf = S => (Array.isArray(S?.plans) ? S.plans : []).map(normalizePlan).filter(Boolean)
export const activePlans = S => plansOf(S).filter(p => p.on)

/**
 * The list with `plan` saved (replacing one with its id). Switched on, it takes one of the three
 * active places: the oldest active plan is switched off to make room.
 */
export function savePlan(list, plan, now = Date.now()) {
  const p = normalizePlan({ ...plan, at: now })
  if (!p) return (Array.isArray(list) ? list : []).map(normalizePlan).filter(Boolean)
  let out = (Array.isArray(list) ? list : []).map(normalizePlan).filter(x => x && x.id !== p.id)
  if (p.on) {
    const on = out.filter(x => x.on).sort((a, b) => a.at - b.at)
    for (const x of on.slice(0, Math.max(0, on.length - (MAX_ACTIVE_PLANS - 1)))) x.on = false
  }
  out = [...out, p]
  return out.slice(-20)
}

/**
 * The plans worth proposing: a trigger that came up at least twice in two weeks and has no active
 * plan yet, most frequent first — [{ trig, n, if, then }].
 */
export function suggestPlans(S, today) {
  const counts = triggerCounts(S, today, 14)
  const covered = new Set(activePlans(S).map(p => p.trig).filter(Boolean))
  return Object.entries(counts)
    .filter(([trig, n]) => n >= 2 && !covered.has(trig) && PLAN_TEMPLATES[trig])
    .sort((a, b) => b[1] - a[1])
    .map(([trig, n]) => ({ trig, n, ...PLAN_TEMPLATES[trig] }))
}
