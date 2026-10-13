// The numbers behind the daily log and the Progress screen: a fat-loss phase ("cut") followed
// day by day.
//
// What a person logs each day lives in S.dailyLog, one entry per day like a weigh-in or a
// measurement check-in: { d, t, kcal, protein, steps, cardio, sleep, alcohol, gym, energy, hunger,
// note, food, done, hk }. `food` is that day's food diary (lib/food.js): when a day has one, its
// calories and protein are the diary's totals, and the typed `kcal`/`protein` only stand for days
// without it. `done` marks today's diary as complete — until then today's food is a day still
// being eaten, and it stays out of the averages. `hk` lists the fields Apple Health filled in
// (lib/apple-health.js), which a later import may update and a hand edit takes over. Body weight
// stays in S.bodyweight and the waist in S.measurements, so every screen that already reads those
// keeps working; this module only reads them. The plan itself (start date, daily targets, the
// loss rate aimed for, diet breaks) is S.cut, read through cutOf().
//
// Trend. Holt's linear exponential smoothing (a level and a slope) over the weigh-ins, the days
// between two weigh-ins filled in on a straight line. A plain moving average (the Hacker's Diet
// 10% EMA) trails a steady loss by about nine days, which at a kilo a week leaves the "trend" more
// than a kilo above where the scale really is; the slope term takes that lag out. On simulated
// cuts (0.5 kg of daily noise, a fifth of the days missed, the first week's water loss)
// α = 0.2, β = 0.05 kept the level within ~0.2 kg of the truth and the weekly rate within
// ~0.06 kg/week once past the first three weeks — better than the EMA, a 14/21-day regression or
// the difference of two weekly averages at every stage of the cut.
//
// Maintenance (TDEE) comes from energy balance, the way the adaptive apps (MacroFactor) work it
// out: the average logged intake, plus the energy that came off the body meanwhile — 7,700 kcal
// per kg (3,500 per lb). That figure is the classic rule; the true one depends on how much of what
// is lost is fat and how much is lean tissue and water, which is why the first week of a cut
// (mostly glycogen and water) is left out of the window.
//
// The plan's rules come from the evidence on keeping muscle while dieting: a loss of roughly
// 0.5–1% of body weight a week, protein high, heavy training kept up (strength holding is the
// best everyday sign that muscle is), sleep, and diet breaks at maintenance, which in the MATADOR
// trial (2-week blocks) cost no extra lean mass and lost more fat per week of dieting.
import { isoOf, todayISO, weekKey } from './format.js'
import { workoutDay } from './history.js'
import { e1rmSeries } from './onerm.js'
import { isCardio, exOr } from './exercises.js'
import { entryNutrition, normalizeFoodList } from './food.js'
import { excusedOn } from './day-notes.js'
import { normalizeDayPhotos } from './day-photos.js'

export const KCAL_PER_KG = 7700
export const LB_PER_KG = 2.20462262
const DAY_MS = 86400000

/** The plan's defaults: the targets set when the cut was planned (2,000 kcal, 175 g protein, …). */
export const CUT_DEFAULTS = Object.freeze({
  start: null,          // iso date the cut began; null = not started yet
  kcal: 2000,           // daily calorie target
  protein: 175,         // g a day
  fat: 60,              // g a day; carbs are what the calories leave (cutOf)
  steps: 10000,
  cardio: 45,           // minutes a day
  sleep: 8,             // hours a night
  gymDays: 6,           // sessions a week
  minKcal: 1800,        // never suggest eating below this
  rateMin: 0.8,         // loss aimed for per week, kg (converted for an lb profile)
  rateMax: 1.2,
  maintenance: 3200,    // the starting guess for maintenance until the data gives its own
  breaks: [],           // [{ from, to }] maintenance phases: a diet break, the holidays
  changedAt: null,      // iso date calories or steps were last changed, for the two weeks a change needs
  remind: null,         // { weigh: 'HH:MM' | null, log: 'HH:MM' | null } — the phone's two daily reminders
  rateMode: 'kg',       // the pace aimed for as kilos a week ('kg': rateMin–rateMax) or a share of body weight ('pct')
  ratePctMin: 0.7,      // % of body weight a week, when rateMode is 'pct'
  ratePctMax: 1.0,
  checkInDay: null,     // the weekly check-in's weekday (0 Sunday … 6 Saturday); null = the start's weekday
  mode: 'cut',          // 'cut', or 'maintain' once the goal is reached (lib/maintain.js)
  endW: null,           // the trend weight the maintenance phase holds to, set when it began
  endedAt: null,        // iso date the cut ended and maintenance began
  cutKcal: null,        // the cut's calories when it ended, for a mini-cut
  keyLifts: [],         // up to six exercise ids the strength check follows; empty = the most-trained ones
})

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/
export const isIso = s => typeof s === 'string' && ISO_RE.test(s) && isoOf(new Date(s + 'T12:00:00')) === s
export const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
export const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / DAY_MS)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const round = (n, dec = 0) => { const f = 10 ** dec; return Math.round(n * f) / f }
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** The weight unit per kilogram: 1 for a kg profile, 2.2046 for an lb one. */
export const unitPerKg = S => (S?.unit === 'lb' ? LB_PER_KG : 1)

/** S.cut with every missing or out-of-range value replaced by its default. */
export function cutOf(S) {
  const raw = S?.cut && typeof S.cut === 'object' ? S.cut : {}
  const c = { ...CUT_DEFAULTS, breaks: [], keyLifts: [] }
  if (isIso(raw.start)) c.start = raw.start
  if (isIso(raw.changedAt)) c.changedAt = raw.changedAt
  if (isIso(raw.endedAt)) c.endedAt = raw.endedAt
  if (raw.rateMode === 'pct') c.rateMode = 'pct'
  if (raw.mode === 'maintain') c.mode = 'maintain'
  if (Number.isInteger(raw.checkInDay) && raw.checkInDay >= 0 && raw.checkInDay <= 6) c.checkInDay = raw.checkInDay
  if (Number(raw.endW) > 0 && Number(raw.endW) < 1000) c.endW = round(Number(raw.endW), 2)
  if (Number(raw.cutKcal) >= 800 && Number(raw.cutKcal) <= 8000) c.cutKcal = Math.round(Number(raw.cutKcal))
  c.keyLifts = (Array.isArray(raw.keyLifts) ? raw.keyLifts : []).filter(id => typeof id === 'string' && id && id.length <= 64).slice(0, 6)
  const RANGES = {
    kcal: [800, 8000], protein: [20, 500], fat: [10, 400], steps: [500, 60000], cardio: [0, 300], sleep: [3, 14],
    gymDays: [0, 7], minKcal: [800, 6000], maintenance: [1000, 9000], rateMin: [0.05, 2.5], rateMax: [0.1, 3],
    ratePctMin: [0.1, 2], ratePctMax: [0.2, 2.5],
  }
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    const n = Number(raw[k])
    if (raw[k] != null && raw[k] !== '' && Number.isFinite(n) && n >= lo && n <= hi) c[k] = round(n, k.startsWith('rate') || k === 'sleep' ? 2 : 0)
  }
  if (c.rateMin >= c.rateMax) { c.rateMin = CUT_DEFAULTS.rateMin; c.rateMax = CUT_DEFAULTS.rateMax }
  if (c.ratePctMin >= c.ratePctMax) { c.ratePctMin = CUT_DEFAULTS.ratePctMin; c.ratePctMax = CUT_DEFAULTS.ratePctMax }
  c.carbs = carbsFor(c.kcal, c.protein, c.fat)
  const time = v => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null)
  const remind = { weigh: time(raw.remind?.weigh), log: time(raw.remind?.log) }
  c.remind = remind.weigh || remind.log ? remind : null
  c.breaks = (Array.isArray(raw.breaks) ? raw.breaks : [])
    .filter(b => b && isIso(b.from) && isIso(b.to) && b.from <= b.to)
    .map(b => ({ from: b.from, to: b.to }))
    .sort((a, b) => a.from.localeCompare(b.from))
  return c
}

/**
 * The carbs a day's calories leave once protein and fat are in (4 kcal a gram of protein or carbs,
 * 9 of fat): protein and fat are the targets that matter on a cut, carbs fill the rest. 2,000 kcal
 * with 175 g protein and 60 g fat leaves 190 g.
 */
export const carbsFor = (kcal, protein, fat) => Math.max(0, Math.round((kcal - 4 * protein - 9 * fat) / 4))

/**
 * The pace aimed for, in the profile's unit a week: { min, max, mid, pctMin, pctMax } — kilos (or
 * pounds) as set, or a share of the body weight given (`weight`, the trend), which slows the pace
 * in kilos as the weight comes down (0.7–1% is 0.74–1.06 kg a week at 106 kg, 0.6–0.85 at 85).
 * Each comes with the other's view: the kilos as a share of `weight`, the share in kilos.
 */
export function rateBand(cut, weight, per = 1) {
  const w = Number(weight) > 0 ? Number(weight) : null
  if (cut.rateMode === 'pct' && w) {
    const min = w * cut.ratePctMin / 100, max = w * cut.ratePctMax / 100
    return { min, max, mid: (min + max) / 2, pctMin: cut.ratePctMin, pctMax: cut.ratePctMax, mode: 'pct' }
  }
  const min = cut.rateMin * per, max = cut.rateMax * per
  return { min, max, mid: (min + max) / 2, pctMin: w ? min / w * 100 : null, pctMax: w ? max / w * 100 : null, mode: 'kg' }
}

export const activeBreak = (cut, iso) => cut.breaks.find(b => b.from <= iso && iso <= b.to) || null
export const nextBreak = (cut, iso) => cut.breaks.find(b => b.from > iso) || null

/* ------------------------------------------------------------------- diet breaks -- */
// A break is days at maintenance, part of the plan rather than time off it, and every number
// treats it so (MATADOR: two weeks at maintenance cost no lean mass and lost more fat per week of
// dieting). The plan's line stands still through it, so the first day back does not open a kilo
// and a half "behind plan"; maintenance is worked out without it, nor the week after it while the
// water from the extra carbs comes off (that week's fast drop is water, not a pace to slow down);
// and the dates ahead move by the break days still to come.

/** The days after a break that its water takes to come off: out of the estimates, no pace advice. */
export const WATER_DAYS = 7
/** How far the trend may rise over a break: the holiday studies' target (BMJ 2018: at most +0.5 kg). */
export const BREAK_RISE_KG = 0.5

/** The break whose water week `iso` falls in — the seven days after it — or null. */
export const waterWeekOf = (cut, iso) => cut.breaks.find(b => iso > b.to && iso <= addDays(b.to, WATER_DAYS)) || null

/** Whether a day stays out of the maintenance estimate: a break day, or one of its water week. */
export const outOfEstimate = (cut, iso) => cut.breaks.some(b => iso >= b.from && iso <= addDays(b.to, WATER_DAYS))

/** The days of dieting from `a` to `b` (b − a), the break days among them left out. */
export function dietDays(cut, a, b) {
  if (!(b > a)) return 0
  let n = daysBetween(a, b)
  const lastDay = addDays(b, -1)
  for (const br of cut.breaks) {
    const from = br.from > a ? br.from : a
    const to = br.to < lastDay ? br.to : lastDay
    if (from <= to) n -= daysBetween(from, to) + 1
  }
  return n
}

/** The day `n` days of dieting after `from`, the break days on the way not counted. */
export function addDietDays(cut, from, n) {
  let d = from, left = Math.max(0, Math.round(n))
  if (!cut.breaks.some(b => b.to > from)) return addDays(from, left)
  for (let guard = 0; left > 0 && guard < 20000; guard++) {
    d = addDays(d, 1)
    if (!activeBreak(cut, d)) left--
  }
  return d
}

/* --------------------------------------------------------------- daily log entries -- */

// [lowest (exclusive), highest, decimals] for the numbers a day can carry. Zero is "not logged":
// nobody eats 0 kcal or walks 0 steps on a day worth recording, and an emptied field reads 0.
export const LOG_NUMS = Object.freeze({
  kcal: [0, 15000, 0],
  protein: [0, 1000, 0],
  steps: [0, 150000, 0],
  cardio: [0, 1440, 0],
  sleep: [0, 24, 1],
})
const LOG_FLAGS = ['alcohol', 'gym']
const LOG_SCALES = ['energy', 'hunger']
const LOG_KEYS = [...Object.keys(LOG_NUMS), ...LOG_FLAGS, ...LOG_SCALES]
/** The fields Apple Health can fill in. */
export const HK_FIELDS = Object.freeze(['steps', 'sleep', 'cardio', 'gym'])

const logNum = (v, [lo, hi, dec]) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > lo && n <= hi ? round(n, dec) : null
}

/** One day's entry in its stable shape, or null for something that is not one. */
export function normalizeLogEntry(raw) {
  if (!raw || typeof raw !== 'object' || !isIso(raw.d)) return null
  const e = { d: raw.d, t: Number.isFinite(+raw.t) && +raw.t > 0 ? +raw.t : new Date(raw.d + 'T12:00:00').getTime() }
  for (const [k, spec] of Object.entries(LOG_NUMS)) e[k] = logNum(raw[k], spec)
  for (const k of LOG_FLAGS) e[k] = typeof raw[k] === 'boolean' ? raw[k] : null
  for (const k of LOG_SCALES) { const n = Math.round(Number(raw[k])); e[k] = raw[k] != null && n >= 1 && n <= 5 ? n : null }
  e.note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 500) : ''
  const food = normalizeFoodList(raw.food)
  if (food.length) e.food = food
  if (raw.done === true && food.length) e.done = true
  if (raw.partial === true) e.partial = true
  const photos = normalizeDayPhotos(raw.photos)
  if (photos.length) e.photos = photos
  const hk = Array.isArray(raw.hk) ? HK_FIELDS.filter(k => raw.hk.includes(k) && e[k] != null) : []
  if (hk.length) e.hk = hk
  return e
}

export const logHasValues = e => !!e && (LOG_KEYS.some(k => e[k] != null) || !!e.note || !!e.food?.length || !!e.photos?.length)

/**
 * The list in its one-entry-per-day shape, oldest first. Two entries for a day (an imported
 * backup, another client) are two halves of one day: the later-saved one wins field by field and
 * a field it left empty keeps the earlier value, the way measurement check-ins fold.
 */
export function normalizeDailyLogState(state) {
  const byDay = new Map()
  for (const raw of Array.isArray(state.dailyLog) ? state.dailyLog : []) {
    const e = normalizeLogEntry(raw)
    if (!e) continue
    const prev = byDay.get(e.d)
    if (!prev) { byDay.set(e.d, e); continue }
    const [a, b] = prev.t <= e.t ? [prev, e] : [e, prev]
    const m = { ...a, t: b.t }
    for (const k of LOG_KEYS) m[k] = b[k] ?? a[k]
    m.note = b.note || a.note
    // the two halves' food, the later one's version of an item both have
    if (a.food || b.food) {
      const ids = new Set((b.food || []).map(it => it.id))
      m.food = [...(a.food || []).filter(it => !ids.has(it.id)), ...(b.food || [])]
    }
    if (a.done || b.done) m.done = true
    // the two halves' photos, one per file
    if (a.photos || b.photos) m.photos = normalizeDayPhotos([...(b.photos || []), ...(a.photos || [])])
    // a day either half marked as logged only in part stays so
    if (a.partial || b.partial) m.partial = true; else delete m.partial
    // a field Apple Health filled in stays marked so only where the value kept came from there
    const hk = HK_FIELDS.filter(k => ((b[k] != null ? b.hk : a.hk) || []).includes(k))
    if (hk.length) m.hk = hk; else delete m.hk
    byDay.set(e.d, normalizeLogEntry(m) || m)
  }
  state.dailyLog = [...byDay.values()].filter(logHasValues).sort((a, b) => a.d.localeCompare(b.d))
  return state
}

export const logFor = (S, iso) => (Array.isArray(S?.dailyLog) ? S.dailyLog : []).find(e => e?.d === iso) || null

/* ------------------------------------------------------------------------- workouts -- */

export const workoutsOn = (S, iso) => (S?.workouts || []).filter(w => w && workoutDay(w) === iso)

/** Minutes of cardio sets ({ min, speed }) logged in that day's workouts — any exercise. */
export function cardioMinutesOn(S, iso) {
  let min = 0
  for (const w of workoutsOn(S, iso)) {
    for (const en of w.entries || []) {
      for (const s of en?.sets || []) {
        if (Number(s?.min) > 0 && s.done !== false) min += Number(s.min)
      }
    }
  }
  return Math.round(min)
}

/** Whether the day had a workout: one logged in the app, or ticked by hand in the daily log. */
export const trainedOn = (S, iso) => workoutsOn(S, iso).length > 0 || logFor(S, iso)?.gym === true

/** The day's cardio: what the log says, else what its workouts hold. */
export const cardioOn = (S, iso) => logFor(S, iso)?.cardio ?? (cardioMinutesOn(S, iso) || null)

/* ---------------------------------------------------------------------------- trend -- */

export const TREND_ALPHA = 0.2
export const TREND_BETA = 0.05

/** The weigh-ins, one per day (the later-saved of a day), oldest first, bad rows skipped. */
export function weighIns(bodyweight) {
  const byDay = new Map()
  for (const b of Array.isArray(bodyweight) ? bodyweight : []) {
    if (!b || !isIso(b.d) || !(Number(b.w) > 0)) continue
    const prev = byDay.get(b.d)
    if (!prev || (Number(b.t) || 0) >= (Number(prev.t) || 0)) byDay.set(b.d, { d: b.d, w: Number(b.w), t: Number(b.t) || 0 })
  }
  return [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d))
}

/**
 * The trend for every day from the first weigh-in to the last: [{ d, w, L, T }] where `w` is the
 * scale reading that day (null on a day filled in between two readings), `L` the trend weight and
 * `T` its slope per day (negative while losing). Ends on the last weigh-in, never projects past it.
 */
export function weightTrend(bodyweight, { alpha = TREND_ALPHA, beta = TREND_BETA } = {}) {
  const pts = weighIns(bodyweight)
  const out = []
  let L = null, T = 0
  const step = y => {
    if (L == null) { L = y; T = 0; return }
    const prev = L
    L = alpha * y + (1 - alpha) * (L + T)
    T = beta * (L - prev) + (1 - beta) * T
  }
  pts.forEach((p, i) => {
    if (i > 0) {
      const prev = pts[i - 1], gap = daysBetween(prev.d, p.d)
      for (let k = 1; k < gap; k++) {
        step(prev.w + (p.w - prev.w) * k / gap)
        out.push({ d: addDays(prev.d, k), w: null, L, T })
      }
    }
    step(p.w)
    out.push({ d: p.d, w: p.w, L, T })
  })
  return out
}

/** The trend as it stood on `iso`: its point that day, or the last one before it. */
export function trendOn(trend, iso) {
  for (let i = trend.length - 1; i >= 0; i--) if (trend[i].d <= iso) return trend[i]
  return null
}

/* ------------------------------------------------------------------------ summaries -- */

const inRange = (d, from, to) => d >= from && d <= to
// summarize's stats that come from a day's nutrition rather than from the entry's own fields
const NUT_KEYS = { kcal: 'kcal', protein: 'protein', carbs: 'carbs', fat: 'fat' }

/**
 * A day's calories and macros as they count for the averages: the food diary's totals, or the
 * typed calories and protein of a day without one. Today's diary is still being eaten, so it
 * counts only once marked complete (`done`) — a breakfast logged at nine would otherwise drag
 * every average, and the maintenance estimate, down for the rest of the day.
 */
export function countedNutrition(e, today = todayISO()) {
  const n = entryNutrition(e)
  if (n.src === 'food' && e.d >= today && !e.done) return { kcal: null, protein: null, carbs: null, fat: null, src: null }
  // a day marked as logged only in part (the weekly check-in asks) would pull the averages and
  // the maintenance estimate down by whatever went unlogged
  if (e?.partial) return { kcal: null, protein: null, carbs: null, fat: null, src: null }
  return n
}

/**
 * What a stretch of days added up to, against the plan's targets. Both ends included. A break
 * day's calorie target is maintenance (`brkKcal`, the plan's guess unless worked out).
 */
export function summarize(S, from, to, cut = cutOf(S), today = todayISO(), brkKcal = cut.maintenance) {
  const days = daysBetween(from, to) + 1
  const logs = (Array.isArray(S?.dailyLog) ? S.dailyLog : []).filter(e => e && inRange(e.d, from, to))
  const nut = new Map(logs.map(e => [e, countedNutrition(e, today)]))
  const vals = k => logs.map(e => (k in NUT_KEYS ? nut.get(e)[NUT_KEYS[k]] : e[k])).filter(v => v != null)
  const stat = k => { const v = vals(k); return { avg: mean(v), n: v.length } }
  const kcal = stat('kcal'), protein = stat('protein'), steps = stat('steps'), sleep = stat('sleep')
  const carbs = stat('carbs'), fat = stat('fat')
  const energy = stat('energy'), hunger = stat('hunger')
  const kcalOf = e => nut.get(e).kcal, proteinOf = e => nut.get(e).protein
  let cardioTotal = 0, cardioDays = 0, cardioHit = 0, gym = 0
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i)
    const c = cardioOn(S, d)
    if (c) { cardioTotal += c; cardioDays++; if (c >= cut.cardio) cardioHit++ }
    if (trainedOn(S, d)) gym++
  }
  const weigh = weighIns(S?.bodyweight).filter(b => inRange(b.d, from, to))
  return {
    from, to, days,
    logged: logs.length,
    kcal: { ...kcal, hit: logs.filter(e => { const k = kcalOf(e), goal = activeBreak(cut, e.d) ? brkKcal : cut.kcal; return k != null && k <= goal + 100 && k >= goal - 300 }).length },
    protein: { ...protein, hit: logs.filter(e => proteinOf(e) != null && proteinOf(e) >= cut.protein * 0.9).length },
    carbs, fat,
    foodDays: logs.filter(e => nut.get(e).src === 'food').length,
    steps: { ...steps, hit: logs.filter(e => e.steps != null && e.steps >= cut.steps).length },
    sleep: { ...sleep, hit: logs.filter(e => e.sleep != null && e.sleep >= 7).length },
    cardio: { total: cardioTotal, days: cardioDays, hit: cardioHit },
    gym,
    alcoholFree: logs.filter(e => e.alcohol === false).length,
    alcoholDays: logs.filter(e => e.alcohol === true).length,
    energy, hunger,
    weighIns: weigh.length,
    avgW: mean(weigh.map(b => b.w)),
  }
}

/** Week by week from `from` to `to` (the profile's weeks), newest first, each with its summary. */
export function weeklyRows(S, from, to, ws = 1, cut = cutOf(S), today = todayISO(), brkKcal = cut.maintenance) {
  if (!isIso(from) || !isIso(to) || from > to) return []
  const rows = []
  for (let key = weekKey(from, ws); key <= to; key = addDays(key, 7)) {
    const a = key < from ? from : key
    const end = addDays(key, 6)
    const b = end > to ? to : end
    rows.push({ key, ...summarize(S, a, b, cut, today, brkKcal) })
  }
  rows.forEach((r, i) => { r.change = i && r.avgW != null && rows[i - 1].avgW != null ? r.avgW - rows[i - 1].avgW : null })
  return rows.reverse()
}

/** Consecutive days up to today — or up to yesterday while today has nothing yet. */
function streak(today, has) {
  let d = has(today) ? today : addDays(today, -1), n = 0
  while (has(d) && n < 3660) { n++; d = addDays(d, -1) }
  return n
}

/**
 * How regular the logging is, the forgiving way (report, item 6): of the last seven days, how many
 * were logged, weighed and alcohol-free — "6/7", never a streak that drops to nought after one
 * missed day, which costs more motivation than the day itself (a broken streak lowers the next
 * attempts; Duolingo kept more people by making one easier to keep). A diet break day or a day
 * noted as sick or away (lib/day-notes.js) that went unlogged is left out of the count instead of
 * against it, and does not break a run. The seven days end today, or yesterday while today has
 * nothing yet. Each comes with the current run and the best one.
 *   → { from, to, log: { n, of, run, best }, weigh: {…}, dry: {…} }
 */
export function consistency(S, today = todayISO(), cut = cutOf(S)) {
  const log = new Set((S?.dailyLog || []).filter(e => e && entryNutrition(e).kcal != null).map(e => e.d))
  const weigh = new Set(weighIns(S?.bodyweight).map(b => b.d))
  const dry = new Set((S?.dailyLog || []).filter(e => e?.alcohol === false).map(e => e.d))
  const excused = d => !!activeBreak(cut, d) || excusedOn(S, d)
  const to = log.has(today) || weigh.has(today) ? today : addDays(today, -1)
  const from = addDays(to, -6)
  const first = [...log, ...weigh].sort()[0] || to
  const count = set => {
    let n = 0, of = 0
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (set.has(d)) { n++; of++ } else if (!excused(d)) of++
    }
    // the run up to the end of the window, an excused day stepped over
    let run = 0
    for (let d = to; d >= first; d = addDays(d, -1)) {
      if (set.has(d)) run++
      else if (!excused(d)) break
    }
    // the best run since the first entry
    let best = 0, cur = 0
    for (let d = first; d <= to; d = addDays(d, 1)) {
      if (set.has(d)) best = Math.max(best, ++cur)
      else if (!excused(d)) cur = 0
    }
    return { n, of, run, best }
  }
  return { from, to, log: count(log), weigh: count(weigh), dry: count(dry) }
}

export function streaks(S, today = todayISO()) {
  const logged = new Set((S?.dailyLog || []).filter(logHasValues).map(e => e.d))
  const dry = new Set((S?.dailyLog || []).filter(e => e?.alcohol === false).map(e => e.d))
  const weighed = new Set(weighIns(S?.bodyweight).map(b => b.d))
  return {
    log: streak(today, d => logged.has(d)),
    alcoholFree: streak(today, d => dry.has(d)),
    weighIn: streak(today, d => weighed.has(d)),
  }
}

/* --------------------------------------------------------------------- maintenance -- */

/** The slope, unit a day, of a straight line through the weigh-ins between two days; null with too few. */
export function weighInSlope(bodyweight, from, to, minPoints = 8) {
  const pts = weighIns(bodyweight).filter(b => inRange(b.d, from, to))
  if (pts.length < minPoints) return null
  const xs = pts.map(p => daysBetween(from, p.d)), mx = mean(xs), my = mean(pts.map(p => p.w))
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0)
  return sxx ? xs.reduce((s, x, i) => s + (x - mx) * (pts[i].w - my), 0) / sxx : null
}

/**
 * The slope, unit per day of dieting, of a straight line through the weigh-ins on `used` days,
 * each placed at its position among `days` (the days of dieting, in order).
 */
function slopeOver(bodyweight, days, used, minPoints = 8) {
  const at = new Map(days.map((d, i) => [d, i]))
  const pts = weighIns(bodyweight).filter(b => used.has(b.d) && at.has(b.d))
  if (pts.length < minPoints) return null
  const xs = pts.map(p => at.get(p.d)), mx = mean(xs), my = mean(pts.map(p => p.w))
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0)
  return sxx ? xs.reduce((s, x, i) => s + (x - mx) * (pts[i].w - my), 0) / sxx : null
}

/**
 * Maintenance from energy balance over up to the last four weeks: the average logged intake plus
 * what came off the body (or went on) meanwhile. Needs two weeks of weigh-ins and ten days with
 * calories; the cut's first week stays out of the window, its loss being mostly water and glycogen.
 *
 * The weight change is the slope of a straight line through the window's weigh-ins, not the
 * trend's level at its two ends: the trend is still settling after the first week's water drop,
 * and on simulated cuts its ends put maintenance ~350 kcal too high four weeks in where the line
 * was within ~40 (and within a few kcal by week six), for about the same day-to-day noise.
 *
 * Diet breaks: the window is four weeks of the cut's own days, the break days taken out of the
 * time line — at maintenance, the body neither lost nor gained what the line is about — and the
 * week after each break left without data, its water coming off on top of the loss. Through a break
 * and that week, the estimate stays what it was the day before the break began (`held`, `asOf`).
 * A day logged as half eaten (`partial`) counts for its weigh-in but not for the intake.
 */
export function expenditure(S, today = todayISO(), cut = cutOf(S), trend = weightTrend(S?.bodyweight)) {
  const end = trendOn(trend, today)
  if (!end || !trend.length) return { ready: false, logged: 0, span: 0 }
  let lower = trend[0].d
  if (cut.start && addDays(cut.start, 7) > lower) lower = addDays(cut.start, 7)
  const around = cut.breaks.find(b => end.d >= b.from && end.d <= addDays(b.to, WATER_DAYS))
  const asOf = around ? addDays(around.from, -1) : end.d
  const days = []
  for (let d = asOf; d >= lower && days.length < 28; d = addDays(d, -1)) if (!activeBreak(cut, d)) days.push(d)
  days.reverse()
  const used = new Set(days.filter(d => !waterWeekOf(cut, d)))
  const span = Math.max(0, days.length - 1)
  const kcal = (S?.dailyLog || []).filter(e => e && used.has(e.d)).map(e => countedNutrition(e, today).kcal).filter(v => v != null)
  const perDay = span >= 13 ? slopeOver(S?.bodyweight, days, used) : null
  const held = !!around
  if (perDay == null || kcal.length < 10) return { ready: false, logged: kcal.length, span, held, asOf }
  const intake = mean(kcal)
  const tdee = intake - perDay * (KCAL_PER_KG / unitPerKg(S))   // perDay is negative while losing
  return { ready: true, tdee: round(tdee / 10) * 10, intake: round(intake), span, logged: kcal.length, from: days[0], to: asOf, held, asOf }
}

/** Daily calories that lose `rate` (unit a week) at maintenance `tdee`, never under the floor. */
export const kcalForRate = (S, tdee, rate, cut = cutOf(S)) =>
  Math.max(cut.minKcal, round((tdee - rate * (KCAL_PER_KG / unitPerKg(S)) / 7) / 10) * 10)

/* ------------------------------------------------------------------------- strength -- */

/** The lifts trained between two days, most sessions first: [{ id, sessions }] (cardio left out). */
export function liftsTrained(S, from, to) {
  const ids = new Map()
  for (const w of S?.workouts || []) {
    const d = workoutDay(w)
    if (!d || d < from || d > to) continue
    for (const id of new Set((w.entries || []).map(en => en?.id).filter(Boolean))) if (!isCardio(id)) ids.set(id, (ids.get(id) || 0) + 1)
  }
  return [...ids].map(([id, sessions]) => ({ id, sessions })).sort((a, b) => b.sessions - a.sessions)
}

/**
 * Whether strength is holding (report, item 10). For each lift — the four to six chosen in the plan
 * (`keyLifts`), else the six trained most — the estimated 1RM averaged over its last three
 * sessions against the average of its last three before the cut (the four weeks before it and its
 * first week). An average of three takes out the odd great or bad day a single best set rides on.
 * Three weeks in at the earliest, so the two never share a session; recent sessions are those of
 * the last three weeks. In a deficit strength usually holds, so a sustained drop across the main
 * lifts is a signal — `causes` (filled in by cutReport) says what in the log may be behind it.
 */
export function strengthCheck(S, today = todayISO(), cut = cutOf(S)) {
  if (!cut.start) return { ready: false, reason: 'nostart' }
  const dayN = daysBetween(cut.start, today) + 1
  if (dayN < 21) return { ready: false, reason: 'early', inDays: 21 - dayN }
  const baseFrom = addDays(cut.start, -28), baseTo = addDays(cut.start, 6), recFrom = addDays(today, -20)
  const trained = liftsTrained(S, baseFrom, today)
  const chosen = cut.keyLifts.length ? cut.keyLifts.map(id => trained.find(x => x.id === id) || { id, sessions: 0 }) : trained
  const lifts = []
  for (const { id, sessions } of chosen) {
    const pts = e1rmSeries(S, id).filter(p => p.d >= baseFrom && p.d <= today).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.t || 0) - (b.t || 0)))
    const base = pts.filter(p => p.d <= baseTo).slice(-3)
    const recent = pts.filter(p => p.d > baseTo && p.d >= recFrom).slice(-3)
    if (!base.length || !recent.length) continue
    const b = mean(base.map(p => p.y)), r = mean(recent.map(p => p.y))
    if (b > 0 && r > 0) lifts.push({ id, name: exOr(id)?.n || id, sessions, base: b, recent: r, nBase: base.length, nRecent: recent.length, pct: r / b - 1 })
  }
  if (!cut.keyLifts.length) lifts.sort((a, b) => b.sessions - a.sessions || b.base - a.base)
  const top = lifts.slice(0, 6)
  if (!top.length) return { ready: false, reason: 'nolifts', chosen: cut.keyLifts.length > 0 }
  const sorted = top.map(l => l.pct).sort((a, b) => a - b)
  const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  return { ready: true, lifts: top, median: mid, status: mid >= -0.03 ? 'hold' : mid >= -0.07 ? 'slip' : 'drop', chosen: cut.keyLifts.length > 0, causes: [] }
}

/* ---------------------------------------------------------------------- maintenance -- */

/** STOP Regain's zones over the end weight, in kg: green up to +1.4 (3 lb), yellow to +2.3 (5 lb). */
export const ZONE_KG = Object.freeze({ green: 1.4, yellow: 2.3 })

/** The zone of a trend weight against the end weight: { delta, zone, green, yellow } in the unit. */
export function maintainZone(trendW, endW, per = 1) {
  if (!(trendW > 0) || !(endW > 0)) return null
  const delta = trendW - endW
  const green = ZONE_KG.green * per, yellow = ZONE_KG.yellow * per
  const d = Math.round(delta * 100) / 100   // 86.4 − 85 is 1.4000000000000057 in floating point
  return { delta, zone: d <= green ? 'green' : d <= yellow ? 'yellow' : 'red', green, yellow }
}

/* --------------------------------------------------------------------------- report -- */

/**
 * Everything the Progress screen and the Home card show, worked out once:
 *   trend, trendW, lossWk (unit a week, positive while losing), ratePct, startW, goalW, lost, toGo,
 *   pctDone, eta, planEta, vsPlan, phase, action, advice, tdee, week7, prev7, streaks, strength.
 * `phase`: noweight | stale | break | early | gain | slow | stall | fast | ok.
 * `action`: the one change worth making now, { kind: 'kcal' | 'steps', value } or null.
 * `advice`: what else stands out, [{ code, ...numbers }] — the screen words them.
 */
export function cutReport(S, today = todayISO()) {
  const cut = cutOf(S)
  const per = unitPerKg(S)
  const trend = weightTrend(S?.bodyweight)
  const cur = trendOn(trend, today)
  const last = trend.length ? trend[trend.length - 1] : null
  const trendW = cur ? cur.L : null
  const lossWk = cur ? -cur.T * 7 : null
  const ratePct = trendW && lossWk != null ? lossWk / trendW * 100 : null

  const started = !!cut.start && cut.start <= today
  const dayN = started ? daysBetween(cut.start, today) + 1 : null
  const week = started ? Math.floor((dayN - 1) / 7) + 1 : null
  const firstAfter = started ? weighIns(S?.bodyweight).find(b => b.d >= cut.start) : null
  const atStart = started ? trendOn(trend, cut.start) : null
  const startW = atStart ? atStart.L : firstAfter ? firstAfter.w : null
  const goalW = Number(S?.targetW) > 0 ? Number(S.targetW) : null
  const lost = startW != null && trendW != null ? startW - trendW : null
  const toGo = goalW != null && trendW != null ? trendW - goalW : null
  const pctDone = startW != null && goalW != null && trendW != null && startW > goalW ? clamp((startW - trendW) / (startW - goalW), 0, 1) : null

  const band = rateBand(cut, trendW ?? startW, per)
  const rateMin = band.min, rateMax = band.max, rateMid = band.mid
  const slack = 0.1 * per
  // The dates ahead skip the break days still to come; the plan's line stands still through a break.
  const weeksLeft = toGo != null && toGo > 0 && lossWk > 0.05 * per ? toGo / lossWk : null
  const eta = weeksLeft != null && cur ? addDietDays(cut, cur.d, weeksLeft * 7) : null
  // A pace in kilos is a straight line; a share of the body weight a curve that flattens as it goes.
  const pctMid = (cut.ratePctMin + cut.ratePctMax) / 200
  const pct = cut.rateMode === 'pct'
  const weeksTo = toGo != null && toGo > 0 ? (pct ? Math.log(goalW / trendW) / Math.log(1 - pctMid) : toGo / rateMid) : null
  const planEta = weeksTo != null ? addDietDays(cut, today, weeksTo * 7) : null
  const planAt = d => {
    if (!started || startW == null) return null
    const wk = dietDays(cut, cut.start, d) / 7
    return Math.max(goalW ?? -Infinity, pct ? startW * (1 - pctMid) ** wk : startW - rateMid * wk)
  }
  const planW = planAt(today)
  let vsPlan = planW != null && trendW != null ? trendW - planW : null

  // A break and the week after it, as the screens tell it: the trend against the day before the
  // break began (BREAK_RISE_KG is the target over it), and "behind plan" held at that day's value
  // — the water of the break and of the week after it is not a pace.
  const brkNow = activeBreak(cut, today)
  const water = brkNow ? null : waterWeekOf(cut, today)
  const around = brkNow || water
  let breakResult = null, planHeld = false
  if (around && cur) {
    const pre = addDays(around.from, -1)
    const before = trendOn(trend, pre)
    if (before) {
      const delta = cur.L - before.L
      breakResult = { from: around.from, to: around.to, pre, before: before.L, now: cur.L, delta, target: BREAK_RISE_KG * per, over: delta > BREAK_RISE_KG * per, back: !!water, until: water ? addDays(around.to, WATER_DAYS) : null }
      const planPre = planAt(pre)
      if (planPre != null && started && pre >= cut.start) { vsPlan = before.L - planPre; planHeld = true }
    }
  }

  const tdee = expenditure(S, today, cut, trend)
  const maintenance = tdee.ready ? tdee.tdee : cut.maintenance
  const week7 = summarize(S, addDays(today, -6), today, cut, today, maintenance)
  const prev7 = summarize(S, addDays(today, -13), addDays(today, -7), cut, today, maintenance)
  const strength = strengthCheck(S, today, cut)
  const brk = brkNow
  // What in the last two weeks may be costing strength: too little sleep or protein, a pace above
  // the range, eating under the floor, alcohol, flat energy.
  if (strength.ready && strength.status !== 'hold') {
    const two = summarize(S, addDays(today, -13), today, cut, today, maintenance)
    if (two.sleep.n >= 5 && two.sleep.avg < 7) strength.causes.push({ code: 'sleep', avg: round(two.sleep.avg, 1) })
    if (two.protein.n >= 5 && two.protein.avg < cut.protein * 0.9) strength.causes.push({ code: 'protein', avg: round(two.protein.avg), target: cut.protein })
    if (lossWk != null && lossWk > rateMax + 0.1 * per) strength.causes.push({ code: 'pace', lossWk, ratePct })
    if (two.kcal.n >= 5 && two.kcal.avg < cut.minKcal) strength.causes.push({ code: 'kcal', avg: round(two.kcal.avg), floor: cut.minKcal })
    if (two.alcoholDays >= 2) strength.causes.push({ code: 'alcohol', n: two.alcoholDays })
    if (two.energy.n >= 5 && two.energy.avg <= 2.2) strength.causes.push({ code: 'energy' })
  }

  // Where the cut stands this week.
  const recentWeighIns = weighIns(S?.bodyweight).filter(b => inRange(b.d, addDays(today, -13), today)).length
  // Two slow weeks, the plan's rule as written: the weekly average dropped by less than the
  // lowest pace twice in a row. Read off the weigh-ins themselves rather than the trend's slope,
  // which is smooth because it is slow to turn: a stall two weeks old could still read as on pace
  // there. With 0.5 kg of daily noise a 7-day average is good to ~0.2 kg, so a true kilo a week
  // shows as two slow weeks about 2% of the time and a real stall about 95%. Three full weeks of
  // cut are needed (the first holds the water drop, and its average is the baseline), and none of
  // it may touch a diet break.
  const weekAvg = (a, b) => { const w = weighIns(S?.bodyweight).filter(x => inRange(x.d, a, b)).map(x => x.w); return w.length >= 3 ? mean(w) : null }
  const avg0 = weekAvg(addDays(today, -20), addDays(today, -14))
  const avg1 = weekAvg(addDays(today, -13), addDays(today, -7))
  const avg2 = weekAvg(addDays(today, -6), today)
  const weekDrops = avg0 != null && avg1 != null && avg2 != null ? [avg0 - avg1, avg1 - avg2] : null
  const brkIn3 = cut.breaks.some(b => b.to >= addDays(today, -20) && b.from <= today)
  const slow2 = !!weekDrops && weekDrops.every(x => x < rateMin - slack) && !brkIn3 && (!started || daysBetween(cut.start, today) >= 20)
  // After the cut: the zone against the end weight is the whole verdict (lib/maintain.js).
  const maintaining = cut.mode === 'maintain'
  const zone = maintaining && cut.endW ? maintainZone(trendW, cut.endW, per) : null
  let phase
  if (!trend.length) phase = 'noweight'
  else if (recentWeighIns < 3 || daysBetween(last.d, today) > 7) phase = 'stale'
  else if (maintaining) phase = 'maintain'
  else if (brk) phase = 'break'
  else if (water) phase = 'water'
  else if (started && dayN <= 7) phase = 'early'
  else if (lossWk < -slack) phase = 'gain'
  else if (slow2 && lossWk < rateMax) phase = 'stall'
  else if (lossWk < rateMin - slack) phase = 'slow'
  else if (lossWk > rateMax + slack) phase = 'fast'
  else phase = 'ok'

  let action = null
  if (phase === 'stall' || (phase === 'gain' && slow2)) {
    action = cut.kcal - 100 >= cut.minKcal ? { kind: 'kcal', value: cut.kcal - 100 } : { kind: 'steps', value: cut.steps + 2000 }
  } else if (phase === 'fast' && strength.ready && strength.status !== 'hold') {
    action = { kind: 'kcal', value: cut.kcal + 150 }
  }
  // A change needs two weeks to show on the scale. Until then the same data would ask for the same
  // change again on every visit, and a stall would ratchet the calories down 100 a tap.
  const settling = !!cut.changedAt && cut.changedAt <= today && daysBetween(cut.changedAt, today) < 14
  if (action && settling) action = null
  if (maintaining) action = null

  const advice = []
  if (maintaining && zone) advice.push({ code: 'zone-' + zone.zone, delta: zone.delta, green: zone.green, yellow: zone.yellow })
  if (settling && (phase === 'stall' || phase === 'slow' || phase === 'fast' || phase === 'gain')) advice.push({ code: 'settling', since: cut.changedAt, until: addDays(cut.changedAt, 14) })
  const upcoming = nextBreak(cut, today)
  if (brk) advice.push({ code: 'break', kcal: maintenance, to: brk.to })
  else if (water) advice.push({ code: 'water', until: addDays(water.to, WATER_DAYS), kcal: cut.kcal })
  else if (upcoming && daysBetween(today, upcoming.from) <= 7) advice.push({ code: 'break-soon', from: upcoming.from, kcal: maintenance })
  const anyLog = (S?.dailyLog || []).some(logHasValues)
  if (anyLog && week7.kcal.n < 5) advice.push({ code: 'log-kcal', n: week7.kcal.n })
  if (trend.length && week7.weighIns < 4) advice.push({ code: 'weigh-more', n: week7.weighIns })
  if (week7.protein.n >= 3 && week7.protein.avg < cut.protein * 0.9) advice.push({ code: 'protein-low', avg: round(week7.protein.avg), target: cut.protein })
  if (week7.kcal.n >= 3 && week7.kcal.avg < cut.minKcal - 100 && !brk) advice.push({ code: 'kcal-too-low', avg: round(week7.kcal.avg), floor: cut.minKcal })
  if (week7.sleep.n >= 3 && week7.sleep.avg < 7) advice.push({ code: 'sleep-low', avg: round(week7.sleep.avg, 1) })
  if (week7.steps.n >= 3 && week7.steps.avg < cut.steps * 0.8) advice.push({ code: 'steps-low', avg: round(week7.steps.avg), target: cut.steps })
  if (week7.alcoholDays > 0) advice.push({ code: 'alcohol', n: week7.alcoholDays })
  if (week7.energy.n >= 4 && week7.hunger.n >= 4 && week7.energy.avg <= 2.2 && week7.hunger.avg >= 3.8) advice.push({ code: 'fatigue' })
  if (strength.ready && strength.status === 'drop') advice.push({ code: 'strength-drop', pct: round(strength.median * 100) })
  if (tdee.ready && !brk && !maintaining) {
    // the calories for the middle of the range — but never under the floor, so the pace that floor
    // gives is what is promised, not the one asked for
    const kcal = kcalForRate(S, tdee.tdee, rateMid, cut)
    advice.push({ code: 'tdee', tdee: tdee.tdee, kcal, rate: Math.max(0, (tdee.tdee - kcal) * 7 / (KCAL_PER_KG / per)) })
  }

  return {
    cut, unit: S?.unit === 'lb' ? 'lb' : 'kg', per, today,
    trend, cur, trendW, lossWk, ratePct, rateMin, rateMax, rateMid, band,
    started, dayN, week, startW, goalW, lost, toGo, pctDone, eta, planEta, planAt, planW, vsPlan, planHeld, weekDrops,
    week7, prev7, tdee, maintenance, strength, phase, action, settling, advice, breakNow: brk, water, breakResult,
    maintaining, zone,
    streaks: streaks(S, today),
    consistency: consistency(S, today, cut),
  }
}

/* ------------------------------------------------------------------------------ csv -- */

const csvCell = v => {
  if (v == null) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** Every day with anything on it, oldest first: weight and trend, the log, workouts, waist. */
export function dailyLogCSV(S) {
  const unit = S?.unit === 'lb' ? 'lb' : 'kg'
  const lenUnit = unit === 'lb' ? 'in' : 'cm'
  const trend = new Map(weightTrend(S?.bodyweight).map(p => [p.d, p]))
  const weights = new Map(weighIns(S?.bodyweight).map(b => [b.d, b.w]))
  const waist = new Map((S?.measurements || []).filter(m => m && isIso(m.d) && Number(m.waist) > 0)
    .map(m => [m.d, unit === 'lb' ? round(m.waist / 2.54, 1) : round(m.waist, 1)]))
  const days = new Set([...weights.keys(), ...waist.keys(), ...(S?.dailyLog || []).filter(e => e && isIso(e.d)).map(e => e.d),
    ...(S?.workouts || []).map(workoutDay).filter(Boolean)])
  const head = ['date', `weight_${unit}`, `trend_${unit}`, 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'food_items', 'steps',
    'cardio_min', 'sleep_h', 'alcohol', 'gym', 'energy_1_5', 'hunger_1_5', `waist_${lenUnit}`, 'note']
  const rows = [...days].sort().map(d => {
    const e = logFor(S, d) || {}
    const n = entryNutrition(e)
    const p = trend.get(d)
    const yesNo = v => (v == null ? '' : v ? 'yes' : 'no')
    return [d, weights.get(d) ?? '', p ? round(p.L, 2) : '', n.kcal, n.protein != null ? round(n.protein) : null,
      n.carbs != null ? round(n.carbs) : null, n.fat != null ? round(n.fat) : null, e.food?.length || '', e.steps,
      cardioOn(S, d), e.sleep, yesNo(e.alcohol), trainedOn(S, d) ? 'yes' : '', e.energy, e.hunger, waist.get(d) ?? '', e.note || '']
  })
  return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n'
}
