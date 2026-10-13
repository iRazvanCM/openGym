// The checks before a cut starts (report, item 3): what has to work on the installed app, and the
// baseline the numbers later lean on. Most of it can be read off the data — a start date, the
// holiday break, Apple Health filling the log, a week of weigh-ins, the lifts logged before the
// cut (the strength check compares against them), a waist measurement, a recent export. Two are
// a person's word: that a test reminder rang, and that an export was imported once somewhere
// else. Those are kept in S.precut = { test, importTest, hidden } (times in ms).
import { addDays, cutOf, daysBetween, isIso, weighIns } from './cut.js'
import { workoutDay } from './history.js'
import { exportStatus } from './backup-status.js'

/** The holidays a day falls before or in: 23 December to 1 January. */
export function holidayWindow(iso) {
  const y = Number(iso.slice(0, 4))
  const year = iso.slice(5) <= '01-01' ? y - 1 : y
  return { from: `${year}-12-23`, to: `${year + 1}-01-01` }
}

const overlaps = (b, w) => b.from <= w.to && b.to >= w.from

/**
 * The checklist: [{ id, done, ...facts }], in the order to do them.
 *   start      the cut has a start date
 *   holidays   a break over the holidays, when the cut runs into them ({ hol })
 *   health     Apple Health fills the log ({ state: 'off' | 'empty' | 'ok' }) — iPhone app only
 *   reminders  the morning weigh-in and the evening log reminders are set — phone app only
 *   test       a test reminder was sent and rang — phone app only
 *   export     an export in the last week; `import`: one was imported once somewhere else
 *   weigh      five weigh-ins in the last seven days ({ n })
 *   lifts      three workouts logged in the last four weeks: the strength check's baseline ({ n })
 *   waist      the waist measured in the last two weeks
 * `health` is the Apple Health file's content (lib/apple-health.js), or null.
 */
export function precutItems(S, { today, mobile = false, ios = false, health = null, hasMedia = false, folder = null } = {}) {
  const cut = cutOf(S)
  const p = S?.precut && typeof S.precut === 'object' ? S.precut : {}
  const from = cut.start || today
  const items = [{ id: 'start', done: !!cut.start }]

  // A cut of up to about five months that starts before Christmas runs into it.
  const hol = holidayWindow(from)
  if (daysBetween(from, hol.from) >= 0 && daysBetween(from, hol.from) <= 150) {
    items.push({ id: 'holidays', done: cut.breaks.some(b => overlaps(b, hol)), hol })
  }

  if (ios) {
    const recent = (S?.dailyLog || []).some(e => e && e.d >= addDays(today, -3) && e.d <= today && (e.hk || []).length)
    const state = !health?.on ? 'off' : recent ? 'ok' : 'empty'
    items.push({ id: 'health', done: state === 'ok', state })
  }
  if (mobile) {
    items.push({ id: 'reminders', done: !!(cut.remind?.weigh && cut.remind?.log) })
    items.push({ id: 'test', done: Number(p.test) > 0 })
  }

  const ex = exportStatus(S, new Date(today + 'T12:00:00').getTime(), { hasMedia, folder })
  items.push({ id: 'export', done: ex.last != null && ex.days < 7, days: ex.days })
  items.push({ id: 'import', done: Number(p.importTest) > 0 })

  const n = weighIns(S?.bodyweight).filter(b => b.d > addDays(today, -7) && b.d <= today).length
  items.push({ id: 'weigh', done: n >= 5, n })
  const lifts = (S?.workouts || []).filter(w => { const d = workoutDay(w); return d && d > addDays(today, -28) && d <= today }).length
  items.push({ id: 'lifts', done: lifts >= 3, n: lifts })
  const waist = (S?.measurements || []).some(m => m && isIso(m.d) && Number(m.waist) > 0 && m.d > addDays(today, -14) && m.d <= today)
  items.push({ id: 'waist', done: waist })
  return items
}

/**
 * Whether the card shows: before the cut and in its first two weeks, until every item is done or
 * it is put away.
 */
export function precutShown(S, items, today) {
  const cut = cutOf(S)
  if (Number(S?.precut?.hidden) > 0) return false
  if (cut.start && today > addDays(cut.start, 13)) return false
  return items.some(i => !i.done)
}

/** S.precut with `key` set now — a reminder that rang, an import that worked, the card put away. */
export function markPrecut(prev, key, now = Date.now()) {
  const p = prev && typeof prev === 'object' && !Array.isArray(prev) ? prev : {}
  return { ...p, [key]: now }
}
