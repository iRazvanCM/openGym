// Backups that leave the phone: when the data last went out, when it is due again, and which
// changes are worth a fresh automatic copy.
//
// On the iPhone app every record — weigh-ins, the food diary, workouts, photos — lives in the app
// alone. The automatic copy (lib/mobile.js writeAutoBackup) keeps a dated file in the app's
// Documents/openGym folder, which the Files app shows (Info.plist UIFileSharingEnabled), or in a
// folder chosen once, such as one in iCloud Drive; deleting the app still takes the default folder
// with it. So once a week the whole thing — with the photos, as a .zip — goes somewhere else by
// hand, and this module keeps track of when that was:
//
//   S.exported = { at, full }   `at` the last export of any kind, `full` the last complete one: the
//                               .zip, or the plain backup while the profile had no photos to leave out
//
// It is kept in S (it syncs and rides in the backup) rather than in a file of the phone's own: an
// export brought back by an import says, correctly, how old the newest copy outside is.
const DAY = 86400000
// English with the {0} filled in: what t() does with a string no language pack has.
const fill = (s, ...a) => String(s).replace(/\{(\d)\}/g, (_, i) => a[i] ?? '')

/** S.exported after an export now: `full` when nothing was left out. */
export function markExported(prev, { full }, now = Date.now()) {
  const p = prev && typeof prev === 'object' ? prev : {}
  const old = Number(p.full) > 0 ? Number(p.full) : null
  return { at: now, full: full ? now : old }
}

/** The times in S.exported, cleaned: { at, full }, each a time in ms or null. */
export function exportedOf(S) {
  const e = S?.exported && typeof S.exported === 'object' ? S.exported : {}
  const ms = v => (Number(v) > 0 ? Number(v) : null)
  return { at: ms(e.at), full: ms(e.full) }
}

export const EXPORT_EVERY_DAYS = 7

/**
 * How the last complete export stands: { last, days, due } — the time, whole days since, and
 * whether the weekly one is due (never done, or a week old). With no photos at all, a plain
 * export is complete too, so its time counts.
 */
export function exportStatus(S, now = Date.now(), { hasMedia = false } = {}) {
  const e = exportedOf(S)
  const last = hasMedia ? e.full : (e.full != null && e.at != null ? Math.max(e.full, e.at) : e.full ?? e.at)
  const days = last != null ? Math.max(0, Math.floor((now - last) / DAY)) : null
  return { last, days, due: last == null || days >= EXPORT_EVERY_DAYS }
}

/* ------------------------------------------------------------- the weekly reminder -- */

const EXPORT_ID_BASE = 3200
export const EXPORT_REMINDERS = 3
export const EXPORT_REMINDER_IDS = Array.from({ length: EXPORT_REMINDERS }, (_, i) => EXPORT_ID_BASE + i)
const REMIND_HOUR = 19   // an evening at home, when the Mac or a charger is near

/**
 * The phone's reminders to export: the first evening (19:00) once a week has gone by since the last
 * complete export, then a week apart, three at most — the next export moves them all. They run
 * whatever the auto-backup setting says: the automatic copy in the app's own folder goes when the
 * app goes. `t` words them (i18n), `hasMedia` says whether there are photos to take along.
 */
export function buildExportNotifications(S, now = new Date(), { hasMedia = false, t = fill } = {}) {
  const nowMs = now.getTime()
  const { last } = exportStatus(S, nowMs, { hasMedia })
  const due = last == null ? nowMs : last + EXPORT_EVERY_DAYS * DAY
  const first = new Date(Math.max(due, nowMs))
  first.setHours(REMIND_HOUR, 0, 0, 0)
  if (first.getTime() <= Math.max(due, nowMs)) first.setDate(first.getDate() + 1)
  const out = []
  for (let i = 0; i < EXPORT_REMINDERS; i++) {
    const at = new Date(first)
    at.setDate(first.getDate() + 7 * i)
    const days = last != null ? Math.floor((at.getTime() - last) / DAY) : null
    out.push({
      id: EXPORT_ID_BASE + i,
      title: hasMedia ? t('Export with photos') : t('Export a backup'),
      body: days != null
        ? t('Last export {0} days ago. Save a copy to iCloud Drive or your Mac: if the app is ever deleted, that copy is all there is.', days)
        : t('No export yet. Save a copy to iCloud Drive or your Mac: if the app is ever deleted, that copy is all there is.'),
      schedule: { at, allowWhileIdle: true },
    })
  }
  return out
}

/* ------------------------------------------------------- what an automatic copy follows -- */

const list = v => (Array.isArray(v) ? v : [])
const latest = (xs, key) => xs.reduce((m, x) => Math.max(m, Number(x?.[key]) || 0), 0)

/**
 * A cheap fingerprint of the records logged day by day — the daily log and its food, weigh-ins,
 * measurements, the foods and meals kept, the plan and its check-ins. Every edit of one of them
 * changes its count or stamps a newer time, so two fingerprints differ exactly when a day's data
 * changed; it never serialises the lists, which update() would otherwise do on every set ticked.
 */
export function dailySig(S) {
  const s = S || {}
  return [
    list(s.dailyLog).length, latest(list(s.dailyLog), 't'),
    list(s.bodyweight).length, latest(list(s.bodyweight), 't'),
    list(s.measurements).length, latest(list(s.measurements), 't'),
    list(s.foods).length, latest(list(s.foods), 'at'),
    list(s.meals).length, latest(list(s.meals), 'at'),
    list(s.checkIns).length, latest(list(s.checkIns), 'at'),
    list(s.plans).length, latest(list(s.plans), 'at'),
    s.cut ? JSON.stringify(s.cut) : '',
  ].join('|')
}

/** Throttle for the copies the daily log asks for: at most one in this long. */
export const DAILY_BACKUP_EVERY_MS = 5 * 60 * 1000

/** How long to wait before the next copy, given when the last one was made. */
export const backupDelay = (lastAt, now = Date.now(), soon = 2000) =>
  Math.max(soon, (Number(lastAt) || 0) + DAILY_BACKUP_EVERY_MS - now)

/* ------------------------------------------------------------- turning it on once -- */

// Auto-backup was off until a profile switched it on, so the copies it makes did not exist for
// most people. On the phone app it is now on from the start, and a profile that never saw this
// version is switched on once — `backupOn` remembers that, so turning it off afterwards sticks.
// Done where the stored copy is read, like the look (lib/look.js): nothing is stamped or pushed.
export const BACKUP_ON = 1

export function turnOnAutoBackup(s, mobile) {
  if (!mobile || !s || typeof s !== 'object' || (Number(s.backupOn) || 0) >= BACKUP_ON) return s
  s.autoBackup = true
  s.backupOn = BACKUP_ON
  return s
}
