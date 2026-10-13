// "Check a backup": open an exported file and say what is in it, without importing anything.
//
// An export nobody has ever opened is a hope, not a backup. Reading it back the way Import does
// (lib/backup-media.js readBackupFile) proves the file is whole and the app can read it; the
// summary says whether it holds what it should — the days logged, the weigh-ins, the workouts and,
// in a .zip, every photo the data refers to. Nothing is stored and nothing replaced.
import { referencedFiles } from './media-refs.js'
import { isIso } from './cut.js'

const list = v => (Array.isArray(v) ? v : [])

/**
 * What a read backup ({ state, files, zip }) holds: { days, weighIns, workouts, foods, photos,
 * photosIn, newest, zip } — `photos` the files its data refers to, `photosIn` those the zip
 * carries, `newest` the latest day anything was logged.
 */
export function summarizeBackup({ state, files = [], zip = false } = {}) {
  const S = state || {}
  const days = list(S.dailyLog).filter(e => e && isIso(e.d))
  const weigh = list(S.bodyweight).filter(b => b && isIso(b.d))
  const workouts = list(S.workouts).filter(w => w && isIso(w.d))
  const dates = [...days.map(e => e.d), ...weigh.map(b => b.d), ...workouts.map(w => w.d)].sort()
  return {
    days: days.length,
    weighIns: weigh.length,
    workouts: workouts.length,
    foods: days.reduce((n, e) => n + list(e.food).length, 0),
    photos: referencedFiles(S).length,
    photosIn: list(files).length,
    newest: dates.length ? dates[dates.length - 1] : null,
    zip: !!zip,
  }
}

/** Whether the backup is complete: a .zip with every file, or a JSON of data without any. */
export const backupComplete = sum => (sum.zip ? sum.photosIn >= sum.photos : sum.photos === 0)
