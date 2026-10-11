import { describe, expect, it } from 'vitest'
import { LOOK, moveToAppleLook } from './look.js'

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
