// Apple Health on the iPhone app: steps, sleep, body weight and workouts into the daily log.
//
// Read only. Garmin Connect, an Apple Watch, the iPhone itself or a smart scale write to Apple
// Health, and this reads them back — so a Garmin's steps and sleep reach the log with no Garmin
// account in the app. The native side (ios/App/App/AppleHealthPlugin.swift) answers with the raw
// samples of a range of days; the rest is here, pure and tested:
//
//   healthDays()      which day each sample belongs to: steps as Health sums them (one count for
//                     a walk the phone and the watch both saw), a night's sleep as the union of
//                     every source's asleep stages ending that day (two sources never count twice),
//                     the first weigh-in of a day, workout minutes split into cardio and training.
//   applyHealthDays() what goes into S: a field Apple Health filled in (the entry's `hk` list)
//                     follows Health; a value typed by hand is never overwritten; a day's weigh-in
//                     is added only to a day without one.
//
// Whether it is on is a fact about this phone, like Health Connect on Android (health-sync.js):
// its own file in the app's data directory, never S — it does not sync or ride in a backup.
import { MOBILE, readJsonFile, writeJsonFile } from './mobile.js'
import { LB_PER_KG, addDays, isIso, normalizeLogEntry } from './cut.js'
import { isoOf, todayISO } from './format.js'

export const AH_FILE = 'opengym-apple-health.json'
const OFF = { on: false, at: 0, error: null, imported: 0 }
const MIN = 60000

/* ------------------------------------------------------------- what samples mean -- */

// HKWorkoutActivityType raw values that are training with weights, and those that are neither
// training nor cardio (stretching, mobility, leisure). Every other kind of workout — running,
// cycling, walking, rowing, the elliptical, HIIT, sports — is cardio minutes.
const STRENGTH = new Set([11, 20, 50, 59])               // cross, functional, traditional strength, core
const NOT_CARDIO = new Set([7, 19, 21, 26, 29, 32, 33, 38, 57, 58, 62, 66, 72, 80, 83, 84])
export const workoutKind = type => (STRENGTH.has(type) ? 'strength' : NOT_CARDIO.has(type) ? 'other' : 'cardio')

const ASLEEP = new Set(['asleep', 'core', 'deep', 'rem'])

// The total length of a set of [start, end] intervals, overlaps counted once.
function unionMs(intervals) {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  let total = 0, curA = null, curB = null
  for (const [a, b] of sorted) {
    if (curB == null || a > curB) { if (curB != null) total += curB - curA; curA = a; curB = b }
    else if (b > curB) curB = b
  }
  if (curB != null) total += curB - curA
  return total
}

// A day's night: 18:00 the evening before to 18:00 that day, so last night counts for the day it
// ended on — the morning it is logged — and an afternoon nap counts for its own day.
const nightOf = iso => {
  const d = new Date(iso + 'T18:00:00')
  return [d.getTime() - 24 * 3600e3, d.getTime()]
}

/**
 * The samples Apple Health handed back, day by day from `from` to `to`:
 * { [iso]: { steps, sleep (hours), weightKg, weighedAt, cardio (minutes), trained } }, a field
 * only where Health had something for it.
 */
export function healthDays(raw, { from, to }) {
  const out = {}
  if (!isIso(from) || !isIso(to) || from > to) return out
  const day = d => (out[d] ||= {})
  const inRange = d => d >= from && d <= to

  for (const s of Array.isArray(raw?.steps) ? raw.steps : []) {
    const n = Math.round(Number(s?.steps))
    if (isIso(s?.d) && inRange(s.d) && n > 0) day(s.d).steps = n
  }

  const sleep = (Array.isArray(raw?.sleep) ? raw.sleep : []).filter(s => Number(s?.end) > Number(s?.start))
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const [a, b] = nightOf(d)
    const clip = s => [Math.max(Number(s.start), a), Math.min(Number(s.end), b)]
    const asleep = unionMs(sleep.filter(s => ASLEEP.has(s.value)).map(clip))
    // a phone without a watch only knows when you were in bed
    const ms = asleep || unionMs(sleep.filter(s => s.value === 'inBed').map(clip))
    if (ms >= 30 * MIN) day(d).sleep = Math.round(ms / 3600e3 * 10) / 10
  }

  for (const w of Array.isArray(raw?.weights) ? raw.weights : []) {
    const kg = Number(w?.kg), t = Number(w?.t)
    if (!(kg > 20 && kg < 400) || !(t > 0)) continue
    const d = isoOf(new Date(t))
    if (!inRange(d)) continue
    const x = day(d)
    if (x.weighedAt == null || t < x.weighedAt) { x.weightKg = Math.round(kg * 100) / 100; x.weighedAt = t }
  }

  const cardio = {}
  for (const w of Array.isArray(raw?.workouts) ? raw.workouts : []) {
    const start = Number(w?.start), end = Number(w?.end)
    if (!(end > start)) continue
    const d = isoOf(new Date(start))
    if (!inRange(d)) continue
    const kind = workoutKind(Number(w.type))
    if (kind === 'strength') day(d).trained = true
    else if (kind === 'cardio') (cardio[d] ||= []).push([start, end])
  }
  // two sources recording the same run (the watch and the phone) count once
  for (const [d, list] of Object.entries(cardio)) {
    const min = Math.round(unionMs(list) / MIN)
    if (min > 0) day(d).cardio = min
  }
  return out
}

/**
 * Puts the days into S (a draft: the store's update()). Returns how many things changed. A field
 * typed by hand is the user's; one Apple Health filled in follows Health; nothing is ever cleared
 * because Health has nothing for it (an entry already there stays as it is).
 */
export function applyHealthDays(state, days, now = Date.now()) {
  let changed = 0
  if (!Array.isArray(state.dailyLog)) state.dailyLog = []
  if (!Array.isArray(state.bodyweight)) state.bodyweight = []
  const per = state.unit === 'lb' ? LB_PER_KG : 1
  for (const [d, h] of Object.entries(days || {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isIso(d)) continue
    const i = state.dailyLog.findIndex(e => e?.d === d)
    const old = i >= 0 ? state.dailyLog[i] : null
    const next = { ...(old || { d, t: now }) }
    const hk = new Set(old?.hk || [])
    let touched = false
    const take = (field, v) => {
      if (v == null) return
      if (next[field] != null && !hk.has(field)) return   // typed by hand
      if (next[field] === v && hk.has(field)) return
      if (next[field] == null || hk.has(field)) { next[field] = v; hk.add(field); touched = true }
    }
    take('steps', h.steps)
    take('sleep', h.sleep)
    take('cardio', h.cardio)
    if (h.trained) take('gym', true)
    if (touched) {
      next.hk = [...hk]
      next.t = now
      const e = normalizeLogEntry(next)
      if (e) {
        if (i >= 0) state.dailyLog[i] = e
        else { state.dailyLog.push(e); state.dailyLog.sort((a, b) => a.d.localeCompare(b.d)) }
        changed++
      }
    }
    if (h.weightKg != null && !state.bodyweight.some(b => b?.d === d)) {
      state.bodyweight.push({ d, w: Math.round(h.weightKg * per * 10) / 10, t: h.weighedAt || now })
      state.bodyweight.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
      changed++
    }
  }
  return changed
}

/* --------------------------------------------------------------- the phone side -- */

// Wrapped in an object: a Capacitor plugin proxy answers `then`, so a promise resolved with the
// bare proxy never settles (as in health-sync.js).
let pluginP = null
const plugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE) return null
  const { Capacitor, registerPlugin } = await import('@capacitor/core')
  if (Capacitor.getPlatform() !== 'ios') return null
  return { AH: registerPlugin('AppleHealth') }
})().catch(() => null))

let cached = null
export async function loadAppleHealth() {
  if (cached) return cached
  const f = await readJsonFile(AH_FILE)
  cached = f && typeof f === 'object' ? { ...OFF, ...f } : { ...OFF }
  return cached
}
const save = h => { cached = h; return writeJsonFile(AH_FILE, h) }

const listeners = new Set()
/** Called with the file's content after every import, for the Settings row. */
export function onAppleHealthChange(cb) { listeners.add(cb); return () => listeners.delete(cb) }
const told = h => { listeners.forEach(cb => { try { cb(h) } catch { /* a closed screen */ } }) }

/** 'available' | 'unavailable' (an iPad without Health) | 'unsupported' (not the iPhone app). */
export async function appleHealthStatus() {
  const p = await plugin()
  if (!p) return 'unsupported'
  try { return (await p.AH.isAvailable()).available ? 'available' : 'unavailable' }
  catch { return 'unsupported' }   // an app built before the plugin: nothing native to ask
}

let running = null
/**
 * Reads the last `days` days and puts them into the log. A no-op while it is off, and at most
 * once every few minutes unless forced. Resolves with { changed } or { error }.
 */
export function importAppleHealth(getState, update, { days = 7, force = false } = {}) {
  if (!MOBILE) return Promise.resolve({ skipped: true })
  if (running) return running
  running = (async () => {
    const h = await loadAppleHealth()
    if (!h.on) return { skipped: true }
    if (!force && Date.now() - (h.at || 0) < 5 * MIN) return { skipped: true }
    const p = await plugin()
    if (!p) return { skipped: true }
    const to = todayISO(), from = addDays(to, -(Math.max(1, days) - 1))
    let raw
    try { raw = await p.AH.read({ from, to }) }
    catch (e) {
      const out = { ...h, at: Date.now(), error: e?.code === 'entitlement' ? 'entitlement' : 'failed' }
      await save(out); told(out)
      return { error: out.error }
    }
    const byDay = healthDays(raw, { from, to })
    // a dry run first: an import that changes nothing must not stamp, save and sync the profile
    const probe = JSON.parse(JSON.stringify({ unit: getState().unit, dailyLog: getState().dailyLog || [], bodyweight: getState().bodyweight || [] }))
    let changed = applyHealthDays(probe, byDay)
    if (changed) update(s => { changed = applyHealthDays(s, byDay) })
    const out = { ...h, at: Date.now(), error: null, imported: (h.imported || 0) + changed, days: Object.keys(byDay).length }
    await save(out); told(out)
    return { changed }
  })().finally(() => { running = null })
  return running
}

/**
 * Turning it on: Apple Health's own permission sheet, then the last 30 days. Resolves with
 * { ok, reason } — 'entitlement' when this install was signed without Apple Health access.
 * (Apple Health never says whether reading was allowed: a "no" just reads as no data.)
 */
export async function connectAppleHealth(getState, update) {
  const p = await plugin()
  if (!p) return { ok: false, reason: 'unsupported' }
  try { await p.AH.requestAuthorization() }
  catch (e) { return { ok: false, reason: e?.code === 'entitlement' ? 'entitlement' : e?.code === 'unavailable' ? 'unavailable' : 'failed' } }
  const h = await loadAppleHealth()
  await save({ ...h, on: true, error: null })
  const r = await importAppleHealth(getState, update, { days: 30, force: true })
  return { ok: !r.error, reason: r.error || null, changed: r.changed || 0 }
}

export async function disconnectAppleHealth() {
  const h = await loadAppleHealth()
  const out = { ...h, on: false, error: null }
  await save(out); told(out)
  return out
}

// Back in the foreground (a Garmin synced meanwhile), and once at launch.
let started = false
export function initAppleHealth(getState, update) {
  if (!MOBILE || started) return
  started = true
  import('@capacitor/app').then(({ App }) =>
    App.addListener('appStateChange', ({ isActive }) => { if (isActive) importAppleHealth(getState, update).catch(() => {}) })
  ).catch(() => {})
  setTimeout(() => importAppleHealth(getState, update).catch(() => {}), 4000)
}
