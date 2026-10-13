import { describe, expect, it } from 'vitest'
import { EXPORT_NOTE_ID, SIGN_NOTE_IDS, buildSafetyNotifications, daysSince, diaryStamp, exportDue, signingState } from './safety.js'

const H = 3600e3, D = 24 * H
const NOW = new Date('2026-11-10T10:00:00').getTime()
const withData = (extra = {}) => ({ bodyweight: [{ d: '2026-11-01', w: 105, t: NOW - 9 * D }], ...extra })

describe('a copy outside the phone', () => {
  it('counts whole days since the last one', () => {
    expect(daysSince(0, NOW)).toBeNull()
    expect(daysSince(NOW - 8 * D - H, NOW)).toBe(8)
    expect(daysSince(NOW + H, NOW)).toBe(0)
  })

  it('is due after a week, or when there never was one', () => {
    expect(exportDue(withData(), { now: NOW })).toEqual({ due: true, days: null, photos: false })
    expect(exportDue(withData({ lastExport: NOW - 6 * D }), { now: NOW }).due).toBe(false)
    expect(exportDue(withData({ lastExport: NOW - 7 * D }), { now: NOW })).toMatchObject({ due: true, days: 7 })
  })

  it('is never due for a profile with nothing in it', () => {
    expect(exportDue({}, { now: NOW }).due).toBe(false)
  })

  it('takes a backup in a chosen folder as a copy, unless there are photos it leaves out', () => {
    const S = withData({ lastExport: NOW - 20 * D })
    expect(exportDue(S, { now: NOW, folderAt: NOW - D }).due).toBe(false)
    expect(exportDue(S, { now: NOW, folderAt: NOW - D, hasMedia: true })).toMatchObject({ due: true, days: 20, photos: true })
  })
})

describe('the signature', () => {
  it('is nothing to show without a profile to read', () => {
    expect(signingState(null, NOW)).toBeNull()
    expect(signingState({ found: false }, NOW)).toBeNull()
    expect(signingState({ found: true }, NOW)).toBeNull()
  })

  it('goes from ok to soon to urgent to expired', () => {
    const at = h => signingState({ found: true, expires: NOW + h * H }, NOW)
    expect(at(100)).toMatchObject({ level: 'ok', daysLeft: 4 })
    expect(at(72)).toMatchObject({ level: 'soon', daysLeft: 3 })
    expect(at(30)).toMatchObject({ level: 'soon', daysLeft: 1 })
    expect(at(5)).toMatchObject({ level: 'urgent', daysLeft: 0 })
    expect(at(-1)).toMatchObject({ level: 'expired', daysLeft: 0 })
  })
})

describe('the safety notifications', () => {
  it('warns a day and three hours before the signature runs out', () => {
    const notes = buildSafetyNotifications({ S: {}, signing: { found: true, expires: NOW + 5 * D }, now: NOW })
    expect(notes.map(n => n.id)).toEqual(SIGN_NOTE_IDS)
    expect(notes[0].schedule.at.getTime()).toBe(NOW + 4 * D)
    expect(notes[1].schedule.at.getTime()).toBe(NOW + 5 * D - 3 * H)
    expect(notes[0].body).toMatch(/Do not delete it/)
  })

  it('skips a warning whose time has passed, and all of them once expired', () => {
    expect(buildSafetyNotifications({ S: {}, signing: { found: true, expires: NOW + 10 * H }, now: NOW }).map(n => n.id)).toEqual([SIGN_NOTE_IDS[1]])
    expect(buildSafetyNotifications({ S: {}, signing: { found: true, expires: NOW - H }, now: NOW })).toEqual([])
  })

  it('reminds to export a week after the last copy, at six in the evening', () => {
    const last = new Date('2026-11-08T09:30:00').getTime()
    const [note] = buildSafetyNotifications({ S: withData({ lastExport: last }), now: NOW })
    expect(note.id).toBe(EXPORT_NOTE_ID)
    expect(note.schedule.at).toEqual(new Date('2026-11-15T18:00:00'))
  })

  it('reminds the same evening when a copy is already due', () => {
    const [note] = buildSafetyNotifications({ S: withData(), now: NOW })
    expect(note.schedule.at).toEqual(new Date('2026-11-10T18:00:00'))
    const late = new Date('2026-11-10T17:30:00').getTime()
    expect(buildSafetyNotifications({ S: withData(), now: late })[0].schedule.at).toEqual(new Date('2026-11-11T18:00:00'))
  })

  it('asks for the export with photos when there are photos', () => {
    expect(buildSafetyNotifications({ S: withData(), hasMedia: true, now: NOW })[0].body).toMatch(/with photos/)
  })

  it('has nothing to remind an empty profile of', () => {
    expect(buildSafetyNotifications({ S: {}, now: NOW })).toEqual([])
  })
})

describe('the diary stamp', () => {
  it('changes when a day, a weigh-in or a kept food changes, and not otherwise', () => {
    const S = { dailyLog: [{ d: '2026-11-09', t: 5 }], bodyweight: [{ d: '2026-11-09', w: 104, t: 7 }], foods: [] }
    const a = diaryStamp(S)
    expect(diaryStamp(JSON.parse(JSON.stringify(S)))).toBe(a)
    expect(diaryStamp({ ...S, dailyLog: [{ d: '2026-11-09', t: 6 }] })).not.toBe(a)
    expect(diaryStamp({ ...S, bodyweight: [] })).not.toBe(a)
    expect(diaryStamp({ ...S, foods: [{ id: 'x' }] })).not.toBe(a)
    expect(diaryStamp({ ...S, routines: [{ id: 'r' }] })).toBe(a)
  })
})
