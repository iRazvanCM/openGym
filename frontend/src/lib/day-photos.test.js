import { describe, expect, it } from 'vitest'
import { addDayPhoto, normalizeDayPhotos, removeDayPhoto, setDayPhotoPose } from './day-photos.js'
import { logHasValues, normalizeDailyLogState, normalizeLogEntry } from './cut.js'
import { referencedHashes } from './media-refs.js'
import { sanitizeCustomMedia } from './backup-media.js'

const ref = c => ({ kind: 'image', hash: c.repeat(64), mime: 'image/webp', size: 1000, width: 800, height: 600, at: 1 })

describe('progress photos on a day', () => {
  it('are kept on the day\'s entry with their pose, one per file', () => {
    const S = { dailyLog: [] }
    expect(addDayPhoto(S, '2026-11-02', ref('a'), 'front', 5)).toBe('added')
    expect(addDayPhoto(S, '2026-11-02', ref('a'), 'side')).toBe('dup')
    expect(addDayPhoto(S, '2026-11-02', { kind: 'video', hash: 'b'.repeat(64) })).toBe('invalid')
    expect(addDayPhoto(S, '2026-11-02', ref('b'), 'nope')).toBe('added')
    const e = S.dailyLog[0]
    expect(e.photos.map(p => p.pose)).toEqual(['front', null])
    expect(logHasValues(normalizeLogEntry(e))).toBe(true)
    expect([...referencedHashes(S)].sort()).toEqual(['a'.repeat(64), 'b'.repeat(64)])
    expect(setDayPhotoPose(S, '2026-11-02', 'b'.repeat(64), 'back')).toBe(true)
    expect(S.dailyLog[0].photos[1].pose).toBe('back')
    expect(removeDayPhoto(S, '2026-11-02', 'a'.repeat(64))).toBe(true)
    expect(S.dailyLog[0].photos).toHaveLength(1)
  })

  it('survive the daily log\'s own tidying, the fold of two halves of a day and an import', () => {
    const folded = normalizeDailyLogState({ dailyLog: [
      { d: '2026-11-02', t: 1, kcal: 2000, photos: [{ pose: 'front', m: ref('a') }] },
      { d: '2026-11-02', t: 2, steps: 9000, photos: [{ pose: 'side', m: ref('b') }, { pose: 'front', m: ref('a') }] },
    ] })
    expect(folded.dailyLog[0].photos.map(p => p.m.hash[0])).toEqual(['b', 'a'])
    const imported = sanitizeCustomMedia({ dailyLog: [{ d: '2026-11-03', photos: [{ pose: 'front', m: { hash: 'zz' } }] }] })
    expect(imported.dailyLog[0].photos).toBeUndefined()
    expect(normalizeDayPhotos('x')).toEqual([])
  })
})
