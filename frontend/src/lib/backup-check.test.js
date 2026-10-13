import { describe, expect, it } from 'vitest'
import { backupComplete, summarizeBackup } from './backup-check.js'

const ref = c => ({ kind: 'image', hash: c.repeat(64), mime: 'image/webp', size: 3, width: 8, height: 6, at: 1 })

describe('checking a backup file', () => {
  it('counts what the file holds and finds its newest day', () => {
    const state = {
      dailyLog: [{ d: '2026-11-02', food: [{ id: 'a' }, { id: 'b' }] }, { d: '2026-11-03' }, { d: 'junk' }],
      bodyweight: [{ d: '2026-11-04', w: 105 }],
      workouts: [{ id: 1, d: '2026-11-01', media: [ref('a'), ref('b')] }],
    }
    const sum = summarizeBackup({ state, files: [{ hash: 'a'.repeat(64) }], zip: true })
    expect(sum).toEqual({ days: 2, weighIns: 1, workouts: 1, foods: 2, photos: 2, photosIn: 1, newest: '2026-11-04', zip: true })
    expect(backupComplete(sum)).toBe(false)
    expect(backupComplete({ ...sum, photosIn: 2 })).toBe(true)
  })

  it('calls a plain export complete only while the data has no photos', () => {
    expect(backupComplete(summarizeBackup({ state: { workouts: [] } }))).toBe(true)
    expect(backupComplete(summarizeBackup({ state: { workouts: [{ id: 1, d: '2026-11-01', media: [ref('c')] }] } }))).toBe(false)
    expect(summarizeBackup({}).newest).toBeNull()
  })
})
