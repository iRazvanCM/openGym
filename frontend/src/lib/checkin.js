// The weekly check-in (report, item 5): two or three minutes on a fixed weekday that turn the
// week's log into one decision.
//
// Feedback, a reviewed target and one plan for the week ahead are what made self-monitoring work
// in the trials (Michie 2009: 0.42 against 0.26 for monitoring alone); MacroFactor builds its
// coaching on the same loop. So the check-in, in order:
//
//   1. the week in brief — the trend's change and pace (kilos and a share of body weight), the days
//      logged and weighed, calories, protein, steps, sleep, training;
//   2. the days that look half logged, to mark as such (`partial` on the day, lib/cut.js): an
//      unlogged dinner would otherwise read as a deficit and pull the maintenance estimate down;
//   3. next week's calories: towards the pace aimed for, from the maintenance worked out, in steps
//      of at most 150 kcal (big changes wait for the data to confirm them) — accepted, changed by
//      hand, or skipped;
//   4. one focus for the week ahead.
//
// Each check-in is kept, S.checkIns = [{ d, from, to, at, week, partial, kcalFrom, kcalTo,
// decision, focus }], newest last, for the history on Progress and the focus Home shows.
import {
  KCAL_PER_KG, activeBreak, addDays, cutOf, cutReport, daysBetween, isIso, kcalForRate, logFor, summarize, weighIns,
} from './cut.js'
import { entryNutrition } from './food.js'
import { maintainKcal } from './maintain.js'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const round10 = n => Math.round(n / 10) * 10
const list = v => (Array.isArray(v) ? v : [])

/** The weekday of the check-in: the one chosen, else the cut's start's, else Monday. */
export const checkInDayOf = cut => cut.checkInDay ?? (cut.start ? new Date(cut.start + 'T12:00:00').getDay() : 1)
export const checkInDayName = cut => DAY_NAMES[checkInDayOf(cut)]

/** How long a missed check-in stays on offer. */
export const CHECKIN_GRACE_DAYS = 3
/** The most a check-in moves the calories at once. */
export const MAX_STEP = 150

/**
 * The check-in for `today`: { d, from, to, done, due } — `d` its day (the latest check-in weekday
 * up to today, a week into the cut at the earliest), `from`–`to` the seven days it looks back on,
 * `due` while it is not done and no more than three days late. Null before the cut's first week.
 */
export function checkInFor(S, today) {
  const cut = cutOf(S)
  if (!cut.start || today < addDays(cut.start, 7)) return null
  const wd = checkInDayOf(cut)
  const back = (new Date(today + 'T12:00:00').getDay() - wd + 7) % 7
  const d = addDays(today, -back)
  if (d < addDays(cut.start, 7)) return null
  const done = list(S?.checkIns).some(c => c?.d === d)
  return { d, from: addDays(d, -7), to: addDays(d, -1), done, due: !done && daysBetween(d, today) <= CHECKIN_GRACE_DAYS }
}

/**
 * The week's days as the check-in shows them: [{ d, kind, kcal, meals, partial }] — 'none' with
 * nothing to eat logged, 'suspect' with too little for a whole day (under 60% of the day's target,
 * or one meal only and under 80%), 'ok' otherwise. A day already marked keeps its mark.
 */
export function weekDays(S, from, to, { cut = cutOf(S), maintenance = cut.maintenance } = {}) {
  const out = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const e = logFor(S, d)
    const n = entryNutrition(e)
    if (n.kcal == null) { out.push({ d, kind: 'none', kcal: null, meals: 0, partial: !!e?.partial }); continue }
    const goal = activeBreak(cut, d) ? maintenance : cut.kcal
    const meals = new Set(list(e.food).map(it => it.meal)).size
    const suspect = n.kcal < goal * 0.6 || (n.src === 'food' && meals <= 1 && n.kcal < goal * 0.8)
    out.push({ d, kind: suspect ? 'suspect' : 'ok', kcal: n.kcal, meals, partial: !!e.partial })
  }
  return out
}

/** S with the given days marked (true) or unmarked (false) as half logged — a draft to look ahead with. */
export function withPartial(S, marks) {
  const dailyLog = list(S?.dailyLog).map(e => {
    if (!e || !(e.d in marks)) return e
    const next = { ...e }
    if (marks[e.d]) next.partial = true; else delete next.partial
    return next
  })
  return { ...S, dailyLog }
}

/** The week in brief: the summary of its seven days plus where the weight went. */
export function weekBrief(S, ci, r) {
  const cut = r.cut
  const sum = summarize(S, ci.from, ci.to, cut, r.today, r.maintenance)
  const avg = (a, b) => { const w = weighIns(S?.bodyweight).filter(x => x.d >= a && x.d <= b).map(x => x.w); return w.length ? w.reduce((x, y) => x + y, 0) / w.length : null }
  const now = avg(ci.from, ci.to), before = avg(addDays(ci.from, -7), addDays(ci.from, -1))
  return {
    ...sum,
    avgW: now, change: now != null && before != null ? now - before : null,
    lossWk: r.lossWk, ratePct: r.ratePct, trendW: r.trendW,
  }
}

/**
 * Next week's calories: { kind, kcal, from, tdee, want, rate, early } where kind is
 *   'kcal'   a change to `kcal` (at most MAX_STEP from `from`), towards `want`, the calories that
 *            would give the middle of the pace aimed for at the maintenance worked out (`tdee`);
 *   'steps'  the floor reached and the numbers still asking for less: more steps instead (`steps`);
 *   'keep'   no change: on target (within 50 kcal), no estimate yet, or the change is settling;
 *   'break'  in a diet break: maintenance until it ends;
 *   'hold'   the water week after a break: nothing changes for its drop.
 * Before maintenance can be worked out (about three weeks), a pace well outside the range three
 * weeks in moves 100 kcal, the way the stall rule would. `rate` is the pace the new calories give.
 */
export function proposeKcal(S, today, r = cutReport(S, today)) {
  const cut = r.cut
  const per = r.per
  const from = cut.kcal
  // after the cut: towards maintenance, or holding while the trend sits above the green zone
  if (r.maintaining) return { ...maintainKcal(cut, { tdee: r.tdee.ready ? r.tdee.tdee : null, zone: r.zone?.zone }), from, maintain: true }
  if (r.breakNow) return { kind: 'break', kcal: r.maintenance, from }
  if (r.water) return { kind: 'hold', kcal: from, from }
  const perKg = KCAL_PER_KG / per
  if (r.tdee.ready) {
    const tdee = r.tdee.tdee
    const want = kcalForRate(S, tdee, r.rateMid, cut)            // never under the floor
    const below = tdee - r.rateMid * perKg / 7 < cut.minKcal - 50  // the pace needs less than the floor
    const rateOf = k => Math.max(0, (tdee - k) * 7 / perKg)
    const kcal = Math.max(cut.minKcal, from + clamp(round10(want - from), -MAX_STEP, MAX_STEP))
    if (below && kcal >= from && from <= cut.minKcal + 50) return { kind: 'steps', kcal: from, from, tdee, want, steps: cut.steps + 2000, rate: rateOf(from) }
    if (Math.abs(want - from) < 50 || kcal === from) return { kind: 'keep', kcal: from, from, tdee, want, rate: rateOf(from) }
    return { kind: 'kcal', kcal, from, tdee, want, rate: rateOf(kcal) }
  }
  const slack = 0.1 * per
  if (r.started && r.dayN >= 21 && r.lossWk != null) {
    if (r.lossWk < r.rateMin - slack) {
      const kcal = Math.max(cut.minKcal, from - 100)
      return kcal === from ? { kind: 'steps', kcal: from, from, steps: cut.steps + 2000, early: true } : { kind: 'kcal', kcal, from, early: true }
    }
    if (r.lossWk > r.rateMax + slack && r.strength.ready && r.strength.status !== 'hold') return { kind: 'kcal', kcal: from + 100, from, early: true }
  }
  return { kind: 'keep', kcal: from, from, early: true }
}

/* ------------------------------------------------------------------- the focus -- */

/** The focus picks, in the order offered. `{0}` is the plan's number. */
export const FOCUS = [
  { id: 'log', text: 'Log every meal, every day' },
  { id: 'weigh', text: 'Weigh in every morning' },
  { id: 'protein', text: 'Protein every day: {0} g' },
  { id: 'steps', text: '{0} steps every day' },
  { id: 'sleep', text: 'In bed by 23:00, 8 hours' },
  { id: 'kitchen', text: 'Kitchen closed after 21:00' },
  { id: 'prep', text: 'Cook and weigh the meals ahead' },
]

/** The pick the week calls for: whatever slipped most, logging first. */
export function suggestFocus(week, cut) {
  if (week.kcal.n < 6) return 'log'
  if (week.weighIns < 5) return 'weigh'
  if (week.protein.n >= 3 && week.protein.avg < cut.protein * 0.9) return 'protein'
  if (week.sleep.n >= 3 && week.sleep.avg < 7) return 'sleep'
  if (week.steps.n >= 3 && week.steps.avg < cut.steps * 0.8) return 'steps'
  if (week.hunger.n >= 3 && week.hunger.avg >= 3.8) return 'kitchen'
  return 'prep'
}

/* -------------------------------------------------------------------- the record -- */

const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null }

/** A check-in in its stable shape, or null. */
export function normalizeCheckIn(raw) {
  if (!raw || typeof raw !== 'object' || !isIso(raw.d)) return null
  const w = raw.week && typeof raw.week === 'object' ? raw.week : {}
  const week = {}
  for (const [k, lo, hi] of [['logged', 0, 7], ['weighIns', 0, 7], ['kcal', 0, 20000], ['protein', 0, 1000], ['steps', 0, 200000],
    ['sleep', 0, 24], ['gym', 0, 14], ['lossWk', -20, 20], ['ratePct', -20, 20], ['trendW', 0, 1000], ['change', -50, 50]]) {
    const v = num(w[k], lo, hi)
    if (v != null) week[k] = Math.round(v * 100) / 100
  }
  const focus = raw.focus && typeof raw.focus === 'object' && typeof raw.focus.text === 'string' && raw.focus.text.trim()
    ? { id: typeof raw.focus.id === 'string' ? raw.focus.id.slice(0, 20) : 'own', text: raw.focus.text.trim().slice(0, 120) } : null
  return {
    d: raw.d,
    from: isIso(raw.from) ? raw.from : addDays(raw.d, -7),
    to: isIso(raw.to) ? raw.to : addDays(raw.d, -1),
    at: num(raw.at, 1, 1e14) || Date.now(),
    week,
    partial: list(raw.partial).filter(isIso).slice(0, 7),
    kcalFrom: num(raw.kcalFrom, 0, 20000),
    kcalTo: num(raw.kcalTo, 0, 20000),
    stepsTo: num(raw.stepsTo, 0, 200000),
    decision: ['accept', 'modify', 'skip', 'keep', 'break', 'hold'].includes(raw.decision) ? raw.decision : 'keep',
    focus,
  }
}

/** The list with `rec` in it (one per day, the newer replacing), oldest first, the last 60 kept. */
export function addCheckIn(listIn, rec) {
  const c = normalizeCheckIn(rec)
  const rest = list(listIn).map(normalizeCheckIn).filter(x => x && (!c || x.d !== c.d))
  return [...rest, ...(c ? [c] : [])].sort((a, b) => a.d.localeCompare(b.d)).slice(-60)
}

/** The focus chosen at the last check-in, for the week it was chosen for. */
export function currentFocus(S, today) {
  const last = list(S?.checkIns).filter(c => c && isIso(c.d) && c.d <= today).sort((a, b) => a.d.localeCompare(b.d)).at(-1)
  if (!last?.focus?.text || daysBetween(last.d, today) > 7) return null
  return { ...last.focus, since: last.d }
}
