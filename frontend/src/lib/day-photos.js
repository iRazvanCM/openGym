// Progress photos on any day (report, item 12), tagged by pose: front, side or back.
//
// Until now a progress photo could only ride on a logged workout (lib/workout-media.js), so a rest
// day had nowhere to put one, and nothing told a front view from a side one when two dates were
// compared. A day of the daily log keeps its own now — the same MediaRefs, the same local store,
// sync and backup as every other picture (lib/media-refs.js walks them):
//
//   dailyLog[].photos = [{ pose: 'front' | 'side' | 'back' | null, m: MediaRef }]
//
// Same light, same spot, same time of day (the morning, after the weigh-in) is what makes two of
// them comparable; the pose is what lets the comparison pick the right pair.
import { normalizeMediaRef } from './media-refs.js'

export const POSES = ['front', 'side', 'back']
export const POSE_LABEL = { front: 'Front', side: 'Side', back: 'Back' }
export const DAY_PHOTOS_MAX = 6

/** A day's photos in their stable shape: refs that pass the usual gate, one per file, six at most. */
export function normalizeDayPhotos(list) {
  const out = []
  const seen = new Set()
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || typeof p !== 'object') continue
    const m = normalizeMediaRef(p.m)
    if (!m || m.kind === 'video' || seen.has(m.hash)) continue
    seen.add(m.hash)
    out.push({ pose: POSES.includes(p.pose) ? p.pose : null, m })
    if (out.length >= DAY_PHOTOS_MAX) break
  }
  return out
}

/**
 * Adds a photo to a day of the daily log (state is a draft: the store's update()), the day's entry
 * made when missing. Returns 'added', 'full', 'dup' or 'invalid'.
 */
export function addDayPhoto(state, iso, ref, pose, now = Date.now()) {
  const m = normalizeMediaRef(ref)
  if (!m || m.kind === 'video') return 'invalid'
  if (!Array.isArray(state.dailyLog)) state.dailyLog = []
  let e = state.dailyLog.find(x => x?.d === iso)
  if (!e) { e = { d: iso, t: now }; state.dailyLog.push(e); state.dailyLog.sort((a, b) => a.d.localeCompare(b.d)) }
  const list = normalizeDayPhotos(e.photos)
  if (list.some(p => p.m.hash === m.hash)) return 'dup'
  if (list.length >= DAY_PHOTOS_MAX) return 'full'
  e.photos = [...list, { pose: POSES.includes(pose) ? pose : null, m }]
  e.t = now
  return 'added'
}

/** Takes a photo off a day. Returns whether anything changed. */
export function removeDayPhoto(state, iso, hash, now = Date.now()) {
  const e = (state.dailyLog || []).find(x => x?.d === iso)
  if (!e?.photos?.length) return false
  const left = e.photos.filter(p => p?.m?.hash !== hash)
  if (left.length === e.photos.length) return false
  if (left.length) e.photos = left; else delete e.photos
  e.t = now
  return true
}

/** Changes the pose of a day's photo. */
export function setDayPhotoPose(state, iso, hash, pose, now = Date.now()) {
  const e = (state.dailyLog || []).find(x => x?.d === iso)
  const p = e?.photos?.find(x => x?.m?.hash === hash)
  if (!p) return false
  p.pose = POSES.includes(pose) ? pose : null
  e.t = now
  return true
}
