// Keeping a sideloaded phone app and its data alive through a months-long cut.
//
// Two things end a cut's record that no feature can bring back: the app deleted (or signed with
// another Apple ID) while every copy of the data lived inside it, and the app's signature running
// out in the middle of a week. A free Apple ID signs for seven days; after that the app does not
// open until it is installed again over itself — the data stays, as long as it is not deleted.
// This file is the arithmetic behind the warnings: how old the last copy that left the phone is,
// how long the signature has left, and the notifications that go with both. The native side reads
// the signature (ios/App/App/SafetyPlugins.swift, lib/signing.js); the screens word it
// (components/SafetyCard.jsx, Settings).
import { t } from './i18n-core.js'

const HOUR = 3600e3
const DAY = 24 * HOUR

/** A copy that left the phone (an export, a backup in a folder outside the app) is due after a week. */
export const EXPORT_EVERY_DAYS = 7

// notification ids: 3200 the weekly export, 3300/3301 the signature's last day and last hours
export const EXPORT_NOTE_ID = 3200
export const SIGN_NOTE_IDS = [3300, 3301]

/** Whole days since `at` (ms), or null when it never happened. */
export const daysSince = (at, now = Date.now()) => (Number(at) > 0 ? Math.max(0, Math.floor((now - Number(at)) / DAY)) : null)

/**
 * Whether the person should be asked for a copy that leaves the phone: { due, days, photos }.
 * `days` is the age of the newest copy outside the app — the last export, or the last automatic
 * backup into a folder the person chose (iCloud Drive), which counts only while there are no
 * photos: those ride only in the export with photos. A profile with nothing in it yet is never due.
 */
export function exportDue(S, { now = Date.now(), folderAt = 0, hasMedia = false } = {}) {
  const has = !!((S?.bodyweight || []).length || (S?.workouts || []).length || (S?.dailyLog || []).length)
  const last = Math.max(Number(S?.lastExport) || 0, hasMedia ? 0 : Number(folderAt) || 0)
  const days = daysSince(last, now)
  return { due: has && (days == null || days >= EXPORT_EVERY_DAYS), days, photos: hasMedia }
}

/**
 * Where the signature stands: null when there is none to read (the web, an App Store build), else
 * { expires, hoursLeft, daysLeft, level } with level 'ok' (more than three days), 'soon' (three
 * days or less), 'urgent' (under a day) or 'expired'.
 */
export function signingState(info, now = Date.now()) {
  const expires = Number(info?.expires)
  if (!info?.found || !(expires > 0)) return null
  const hoursLeft = (expires - now) / HOUR
  const level = hoursLeft <= 0 ? 'expired' : hoursLeft < 24 ? 'urgent' : hoursLeft <= 72 ? 'soon' : 'ok'
  return { expires, hoursLeft, daysLeft: Math.max(0, Math.floor(hoursLeft / 24)), level }
}

// The next `hour` o'clock from `now` that is at least `minAhead` away.
function nextAt(now, hour, minAhead = 0) {
  const d = new Date(now)
  d.setHours(hour, 0, 0, 0)
  while (d.getTime() < now + minAhead) d.setDate(d.getDate() + 1)
  return d
}

/**
 * The notifications that keep the app and its data safe, scheduled with the others
 * (lib/mobile.js syncReminder): the signature's last day (24 h before) and last hours (3 h
 * before), and — while a copy outside the phone is due — one export reminder at 18:00, a week
 * after the last copy or tomorrow when that is already past.
 */
export function buildSafetyNotifications({ S, signing = null, folderAt = 0, hasMedia = false, now = Date.now() } = {}) {
  const out = []
  const sign = signingState(signing, now)
  if (sign && sign.level !== 'expired') {
    const steps = [
      { id: SIGN_NOTE_IDS[0], at: sign.expires - 24 * HOUR, title: t('LiftLog stops opening tomorrow'), body: t('Install the app again over itself from Sideloadly today. Do not delete it: deleting it deletes your data.') },
      { id: SIGN_NOTE_IDS[1], at: sign.expires - 3 * HOUR, title: t('LiftLog stops opening in 3 hours'), body: t('Reinstall it over itself from Sideloadly now. Your data stays as long as you do not delete the app.') },
    ]
    for (const s of steps) if (s.at > now + 60e3) out.push({ id: s.id, title: s.title, body: s.body, schedule: { at: new Date(s.at), allowWhileIdle: true } })
  }
  const ex = exportDue(S, { now, folderAt, hasMedia })
  const has = !!((S?.bodyweight || []).length || (S?.workouts || []).length || (S?.dailyLog || []).length)
  if (has) {
    const last = Math.max(Number(S?.lastExport) || 0, hasMedia ? 0 : Number(folderAt) || 0)
    const dueAt = last > 0 ? last + EXPORT_EVERY_DAYS * DAY : now
    const when = ex.due ? nextAt(now, 18, HOUR) : nextAt(dueAt, 18)
    out.push({
      id: EXPORT_NOTE_ID,
      title: t('Back up LiftLog'),
      body: hasMedia ? t('A week since your last copy outside the phone. Export with photos and save it to iCloud Drive or your Mac.') : t('A week since your last copy outside the phone. Export it and save it to iCloud Drive or your Mac.'),
      schedule: { at: when, allowWhileIdle: true },
    })
  }
  return out
}

/**
 * A short fingerprint of what the food diary, the daily log and the weigh-ins hold: it changes
 * whenever an entry of theirs is saved (each carries the time it was saved, `t`) or a food is
 * kept. The store compares it before and after a change to back up after logging, not only after
 * a workout.
 */
export function diaryStamp(S) {
  let log = 0, bw = 0
  for (const e of Array.isArray(S?.dailyLog) ? S.dailyLog : []) if (e && Number(e.t) > log) log = Number(e.t)
  for (const b of Array.isArray(S?.bodyweight) ? S.bodyweight : []) if (b && Number(b.t) > bw) bw = Number(b.t)
  const logs = Array.isArray(S?.dailyLog) ? S.dailyLog.length : 0
  const weights = Array.isArray(S?.bodyweight) ? S.bodyweight.length : 0
  const foods = Array.isArray(S?.foods) ? S.foods.length : 0
  return `${logs}:${log}|${weights}:${bw}|${foods}`
}
