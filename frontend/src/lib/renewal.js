// The sideloaded iPhone app's seven days.
//
// Installed with a free Apple ID (Sideloadly, AltStore), the app is signed with a provisioning
// profile that lasts seven days. After that it no longer opens until the same IPA is installed
// over it again with the same Apple ID — and then everything is still there. Deleted instead, or
// signed with another Apple ID, it comes back empty. So the app says how long it has left, rings
// before it runs out, and keeps the few rules that protect the data in one place.
//
// The native side (ios/App/App/AppSigningPlugin.swift) reads the profile embedded in the app:
// { expires, created, team, profile, installed, bundle } with times in ms. An App Store or
// TestFlight install and the web build have no such profile, and everything here stays quiet.
import { MOBILE } from './mobile.js'

const HOUR = 3600000
const DAY = 24 * HOUR
const fill = (s, ...a) => String(s).replace(/\{(\d)\}/g, (_, i) => a[i] ?? '')

/** The plugin's answer, cleaned: { expires, created, installed, team } or null without a date. */
export function signingOf(raw) {
  if (!raw || typeof raw !== 'object') return null
  const ms = v => (Number(v) > 0 ? Number(v) : null)
  const expires = ms(raw.expires)
  if (!expires) return null
  return { expires, created: ms(raw.created), installed: ms(raw.installed), team: typeof raw.team === 'string' ? raw.team : '' }
}

/** A free account's profile lasts a week; a paid one's a year. */
export const isWeekly = info => !!info && info.created != null && info.expires - info.created <= 8 * DAY

/**
 * Where the app stands: { expires, left (ms), days (whole days left), tone } — 'ok' with more than
 * two days to go, 'soon' within two days (renew now), 'urgent' within a day, 'expired' after.
 * Null when there is nothing to tell (no profile, or a year-long one months away).
 */
export function renewalOf(info, now = Date.now()) {
  if (!info) return null
  const left = info.expires - now
  if (!isWeekly(info) && left > 30 * DAY) return null
  const tone = left <= 0 ? 'expired' : left <= DAY ? 'urgent' : left <= 2 * DAY ? 'soon' : 'ok'
  return { expires: info.expires, left, days: Math.max(0, Math.floor(left / DAY)), hours: Math.max(0, Math.floor(left / HOUR)), tone }
}

/* ------------------------------------------------------------------ the reminders -- */

const RENEW_ID_BASE = 3300
export const RENEW_REMINDER_IDS = [RENEW_ID_BASE, RENEW_ID_BASE + 1, RENEW_ID_BASE + 2]

/**
 * Three reminders before the profile runs out: two days before at 10:00 (renew then, on the
 * fifth or sixth day, as the routine has it), the day before at 10:00 and the last morning at
 * 9:00. A time already gone, or one after the expiry, is left out. `t` words them; `fmtTime`
 * prints the expiry's time of day.
 */
export function buildRenewalNotifications(info, now = new Date(), { t = fill, fmtTime = d => d.toTimeString().slice(0, 5) } = {}) {
  const r = renewalOf(info, now.getTime())
  if (!r || r.tone === 'expired') return []
  const end = new Date(info.expires)
  const when = fmtTime(end)
  const day = (n, h) => { const d = new Date(end); d.setDate(d.getDate() - n); d.setHours(h, 0, 0, 0); return d }
  const plan = [
    { id: RENEW_ID_BASE, at: day(2, 10), title: t('Renew LiftLog'), body: t('The app stops opening in two days ({0}). Install the same IPA over it in Sideloadly, with the same Apple ID. Never delete the app.', when) },
    { id: RENEW_ID_BASE + 1, at: day(1, 10), title: t('Renew LiftLog today'), body: t('The app stops opening tomorrow at {0}. Renew it in Sideloadly with the same Apple ID; your data stays.', when) },
    { id: RENEW_ID_BASE + 2, at: day(0, 9), title: t('LiftLog expires today'), body: t('It stops opening at {0}. Renew it now in Sideloadly, with the same Apple ID.', when) },
  ]
  return plan
    .filter(p => p.at.getTime() > now.getTime() && p.at.getTime() < info.expires)
    .map(p => ({ id: p.id, title: p.title, body: p.body, schedule: { at: p.at, allowWhileIdle: true } }))
}

/** The rules that keep the data through every renewal, in the order they matter. */
export const RENEWAL_RULES = [
  { icon: 'trash', title: 'Never delete the app', body: 'Deleting it deletes every record in it, and the automatic copies in its own folder with them. An expired app keeps its data: installing over it brings it back.' },
  { icon: 'personCircle', title: 'Same Apple ID, same IPA', body: 'Renew with the Apple ID it was installed with. Another Apple ID makes a new, empty app next to it.' },
  { icon: 'repeat', title: 'Renew on day 5 or 6', body: 'Not at the last minute, and the morning before any trip. Sideloadly: plug the iPhone in, pick the same IPA, Start.' },
  { icon: 'share', title: 'Export before any reinstall or iOS update', body: 'Settings → Data → Export with photos, saved to iCloud Drive or your Mac. Hold off on a new major iOS until the sideloader supports it.' },
  { icon: 'hourglass', title: 'Fewer than 10 installs a week', body: 'A free Apple ID allows 10 app IDs a week and 3 sideloaded apps at once. Install a new build when you need it, not every one GitHub makes.' },
]

/* -------------------------------------------------------------- the phone side -- */

let cached
/** The signing profile of this install, read once: signingOf()'s shape, or null. */
export async function appSigning() {
  if (cached !== undefined) return cached
  cached = null
  if (!MOBILE) return cached
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core')
    if (Capacitor.getPlatform() !== 'ios') return cached
    // a plugin proxy answers `then`: it is used here and never handed through a promise
    const plugin = registerPlugin('AppSigning')
    cached = signingOf(await plugin.info())
  } catch { cached = null }   // an app built before the plugin: nothing to ask
  return cached
}

/** Tests only. */
export function _setSigning(v) { cached = v }
