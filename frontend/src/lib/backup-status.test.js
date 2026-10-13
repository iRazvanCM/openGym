import { describe, expect, it } from 'vitest'
import {
  BACKUP_ON, DAILY_BACKUP_EVERY_MS, EXPORT_REMINDER_IDS, backupDelay, buildExportNotifications, dailySig,
  exportStatus, exportedOf, markExported, turnOnAutoBackup,
} from './backup-status.js'

const DAY = 86400000
const at = (iso, hh = 12) => new Date(`${iso}T${String(hh).padStart(2, '0')}:00:00`).getTime()

describe('exports', () => {
  it('remembers the last export, and the last complete one apart', () => {
    const a = markExported(null, { full: false }, 100)
    expect(a).toEqual({ at: 100, full: null })
    const b = markExported(a, { full: true }, 200)
    expect(b).toEqual({ at: 200, full: 200 })
    expect(markExported(b, { full: false }, 300)).toEqual({ at: 300, full: 200 })
    expect(exportedOf({ exported: { at: 'x', full: -1 } })).toEqual({ at: null, full: null })
  })

  it('is due when never done or a week old; a plain export counts while there are no photos', () => {
    const now = at('2026-11-20')
    expect(exportStatus({}, now)).toMatchObject({ last: null, days: null, due: true })
    const S = { exported: { at: now - 2 * DAY, full: now - 9 * DAY } }
    expect(exportStatus(S, now, { hasMedia: true })).toMatchObject({ days: 9, due: true })
    expect(exportStatus(S, now, { hasMedia: false })).toMatchObject({ days: 2, due: false })
    expect(exportStatus({ exported: { at: now - 6.5 * DAY } }, now)).toMatchObject({ days: 6, due: false })
  })
})

describe('the weekly export reminder', () => {
  it('rings the first evening a week after the last complete export, then weekly', () => {
    const last = at('2026-11-10', 9)
    const now = new Date(at('2026-11-12', 10))
    const n = buildExportNotifications({ exported: { at: last, full: last } }, now, { hasMedia: true })
    expect(n.map(x => x.id)).toEqual(EXPORT_REMINDER_IDS)
    expect(n[0].schedule.at.getTime()).toBe(at('2026-11-17', 19))
    expect(n[1].schedule.at.getTime()).toBe(at('2026-11-24', 19))
    expect(n[0].body).toContain('7 days')
    expect(n[0].title).toBe('Export with photos')
  })

  it('asks the same evening when overdue, or the next one once 19:00 has passed', () => {
    const before = buildExportNotifications({}, new Date(at('2026-11-12', 10)))
    expect(before[0].schedule.at.getTime()).toBe(at('2026-11-12', 19))
    expect(before[0].body).toContain('No export yet')
    const after = buildExportNotifications({}, new Date(at('2026-11-12', 21)))
    expect(after[0].schedule.at.getTime()).toBe(at('2026-11-13', 19))
  })
})

describe('what an automatic copy follows', () => {
  const base = () => ({ dailyLog: [{ d: '2026-11-01', t: 5 }], bodyweight: [], measurements: [], foods: [], cut: { kcal: 2000 }, workouts: [] })

  it('changes with the daily log, weigh-ins, foods and the plan, not with a workout set', () => {
    const S = base()
    const sig = dailySig(S)
    expect(dailySig({ ...S, workouts: [{ id: 1 }] })).toBe(sig)
    expect(dailySig({ ...S, dailyLog: [{ d: '2026-11-01', t: 6 }] })).not.toBe(sig)
    expect(dailySig({ ...S, bodyweight: [{ d: '2026-11-01', w: 100, t: 1 }] })).not.toBe(sig)
    expect(dailySig({ ...S, cut: { kcal: 1900 } })).not.toBe(sig)
    expect(dailySig({ ...S, foods: [{ id: 'a', at: 3 }] })).not.toBe(sig)
    expect(dailySig(null)).toBe(dailySig({}))
  })

  it('waits until five minutes after the last copy, never less than a moment', () => {
    expect(backupDelay(0, 1e12)).toBe(2000)
    expect(backupDelay(1e12 - 60000, 1e12)).toBe(DAILY_BACKUP_EVERY_MS - 60000)
  })
})

describe('auto-backup on by default', () => {
  it('switches a phone profile on once, and leaves a later "off" alone', () => {
    const s = turnOnAutoBackup({ autoBackup: false }, true)
    expect(s).toEqual({ autoBackup: true, backupOn: BACKUP_ON })
    s.autoBackup = false
    expect(turnOnAutoBackup(s, true).autoBackup).toBe(false)
    expect(turnOnAutoBackup({ autoBackup: false }, false)).toEqual({ autoBackup: false })
  })
})
