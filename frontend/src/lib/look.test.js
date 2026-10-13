import { describe, expect, it } from 'vitest'
import { LOOK, localMoves, moveToAppleLook } from './look.js'

describe('the move to the iPhone look', () => {
  it('moves a profile still on the old default, once', () => {
    expect(moveToAppleLook({ theme: 'dark', accent: 'lime' })).toEqual({ theme: 'system', accent: 'sky', look: LOOK })
    expect(moveToAppleLook({})).toEqual({ theme: 'system', accent: 'sky', look: LOOK })
  })

  it('keeps a look that was chosen, before the move or after it', () => {
    expect(moveToAppleLook({ theme: 'light', accent: 'lime' })).toEqual({ theme: 'light', accent: 'lime', look: LOOK })
    expect(moveToAppleLook({ theme: 'dark', accent: 'violet' })).toEqual({ theme: 'dark', accent: 'violet', look: LOOK })
    expect(moveToAppleLook({ theme: 'dark', accent: 'lime', look: LOOK })).toEqual({ theme: 'dark', accent: 'lime', look: LOOK })
    expect(moveToAppleLook(null)).toBeNull()
  })
})

describe('the other one-time moves', () => {
  it('switches the phone app\'s backups on once, and leaves a browser copy alone', () => {
    expect(localMoves({ autoBackup: false }, { mobile: true })).toMatchObject({ autoBackup: true, moves: { backup: 1 } })
    const web = localMoves({ autoBackup: false }, { mobile: false })
    expect(web.autoBackup).toBe(false)
    expect(web.moves.backup).toBeUndefined()
    // switched off after the move, it stays off
    expect(localMoves({ autoBackup: false, moves: { backup: 1, ratePct: 1 } }, { mobile: true }).autoBackup).toBe(false)
  })

  it('moves a cut that never chose to a pace in % of body weight, once', () => {
    const s = localMoves({ cut: { start: '2026-11-01', rateMin: 0.8, rateMax: 1.2 } })
    expect(s.cut).toEqual({ start: '2026-11-01', rateMin: 0.8, rateMax: 1.2, rateUnit: 'pct', ratePctMin: 0.7, ratePctMax: 1 })
    expect(localMoves({ cut: { rateUnit: 'kg' } }).cut).toEqual({ rateUnit: 'kg' })
    // a cut set up after the move keeps whatever it chose
    expect(localMoves({ cut: { start: '2026-11-01' }, moves: { ratePct: 1 } }).cut).toEqual({ start: '2026-11-01' })
  })

  it('makes the look move too', () => {
    expect(localMoves({}).look).toBe(LOOK)
    expect(localMoves(null)).toBeNull()
  })
})
