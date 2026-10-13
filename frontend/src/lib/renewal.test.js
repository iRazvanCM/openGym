import { describe, expect, it } from 'vitest'
import { RENEWAL_RULES, RENEW_REMINDER_IDS, buildRenewalNotifications, isWeekly, renewalOf, signingOf } from './renewal.js'

const HOUR = 3600000, DAY = 24 * HOUR
const ms = (iso, hh = 12, mm = 0) => new Date(`${iso}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`).getTime()
const week = (created) => signingOf({ created, expires: created + 7 * DAY, team: 'R M' })

describe('signing profile', () => {
  it('needs an expiry date, and tells a free week from a paid year', () => {
    expect(signingOf(null)).toBeNull()
    expect(signingOf({ created: 5 })).toBeNull()
    const w = week(ms('2026-11-02', 14, 32))
    expect(isWeekly(w)).toBe(true)
    expect(isWeekly(signingOf({ created: 0 + 1, expires: 1 + 365 * DAY }))).toBe(false)
  })

  it('says how long is left and how urgent it is', () => {
    const w = week(ms('2026-11-02', 14))
    expect(renewalOf(w, ms('2026-11-04', 14))).toMatchObject({ days: 5, tone: 'ok' })
    expect(renewalOf(w, ms('2026-11-07', 14)).tone).toBe('soon')
    expect(renewalOf(w, ms('2026-11-09', 2))).toMatchObject({ tone: 'urgent', hours: 12 })
    expect(renewalOf(w, ms('2026-11-09', 15)).tone).toBe('expired')
    // a paid profile months away has nothing to say
    expect(renewalOf(signingOf({ created: ms('2026-11-01'), expires: ms('2027-11-01') }), ms('2026-11-02'))).toBeNull()
    expect(renewalOf(null)).toBeNull()
  })
})

describe('renewal reminders', () => {
  it('rings two days before, the day before and the last morning', () => {
    const w = week(ms('2026-11-02', 14, 32))   // expires 9 Nov, 14:32
    const n = buildRenewalNotifications(w, new Date(ms('2026-11-02', 15)))
    expect(n.map(x => x.id)).toEqual(RENEW_REMINDER_IDS)
    expect(n.map(x => x.schedule.at.getTime())).toEqual([ms('2026-11-07', 10), ms('2026-11-08', 10), ms('2026-11-09', 9)])
    expect(n[1].body).toContain('14:32')
  })

  it('leaves out the times gone by, and everything once expired', () => {
    const w = week(ms('2026-11-02', 14, 32))
    expect(buildRenewalNotifications(w, new Date(ms('2026-11-08', 12))).map(x => x.id)).toEqual([RENEW_REMINDER_IDS[2]])
    expect(buildRenewalNotifications(w, new Date(ms('2026-11-10', 12)))).toEqual([])
    // expiring before 9:00 has no last-morning reminder after it
    const early = week(ms('2026-11-02', 7))
    expect(buildRenewalNotifications(early, new Date(ms('2026-11-02', 8))).map(x => x.id)).toEqual(RENEW_REMINDER_IDS.slice(0, 2))
  })

  it('keeps the rules that protect the data', () => {
    expect(RENEWAL_RULES[0].title).toBe('Never delete the app')
    expect(RENEWAL_RULES.length).toBeGreaterThanOrEqual(4)
  })
})
