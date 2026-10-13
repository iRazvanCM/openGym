// After the cut: keeping the weight off (report, item 9).
//
// STOP Regain (Wing et al. 2006): daily weighing with zones decided in advance kept far more
// people within 2.3 kg (5 lb) of their end weight over 18 months than the control group (46–55%
// regained more than that, against 72%). The zones here are its own, against the trend weight on
// the day the cut ended:
//
//   green   up to +1.4 kg (3 lb)     keep weighing every morning; nothing else to do
//   yellow  +1.4 to +2.3 kg          two weeks of full logging at maintenance
//   red     over +2.3 kg (5 lb)      a mini-cut of three to four weeks on the old plan
//
// The plan (S.cut) carries the phase: mode 'maintain', `endW` the trend weight held to, `endedAt`
// the day the cut ended. The calories go to the maintenance worked out on the cut — straight, or a
// third of the way now and the rest over the next check-ins (stepping up slowly, "reverse
// dieting", has only anecdotes behind it, so it is a choice, not the default).
import { cutOf } from './cut.js'

export { ZONE_KG, maintainZone } from './cut.js'

/**
 * The plan once the cut ends: maintenance mode at today's trend weight, the calories at the
 * maintenance worked out (`tdee`) — or, `gradual`, a third of the way there, the check-ins taking
 * it the rest. `cutKcal` keeps the cut's calories for a mini-cut later.
 */
export function finishCut(S, { trendW, tdee, today, gradual = false }) {
  const c = cutOf(S)
  const to = Math.round((tdee || c.maintenance) / 10) * 10
  const kcal = gradual ? Math.round((c.kcal + (to - c.kcal) / 3) / 10) * 10 : to
  // a gain's calories are no mini-cut's: only a cut's are kept for one
  return cutOf({ cut: { ...c, mode: 'maintain', endW: Math.round(trendW * 100) / 100, endedAt: today, cutKcal: c.mode === 'cut' ? c.kcal : null, kcal, maintenance: to, changedAt: today } })
}

/**
 * A mini-cut from maintenance: back to the cut's calories (the ones it ended on), starting today,
 * aimed at the end weight again. Three to four weeks are enough to come back from the red zone.
 */
export function startMiniCut(S, { today }) {
  const c = cutOf(S)
  const kcal = Number(S?.cut?.cutKcal) > 0 ? Number(S.cut.cutKcal) : Math.max(c.minKcal, c.kcal - 500)
  return cutOf({ cut: { ...c, mode: 'cut', start: today, kcal, changedAt: today } })
}

/**
 * The calories the maintenance check-in proposes: towards the maintenance worked out, at most 300
 * kcal a week (the step-up after a cut is better done in a few weeks than in one jump, if at all
 * gradually), and back down 100 while the trend sits in the yellow zone.
 */
export function maintainKcal(c, { tdee, zone }) {
  const target = Math.round((tdee || c.maintenance) / 10) * 10
  if (zone === 'yellow' || zone === 'red') return { kind: zone === 'red' ? 'minicut' : 'keep', kcal: c.kcal, target }
  const gap = target - c.kcal
  if (Math.abs(gap) < 50) return { kind: 'keep', kcal: c.kcal, target }
  const step = Math.max(-300, Math.min(300, Math.round(gap / 10) * 10))
  return { kind: 'kcal', kcal: c.kcal + step, from: c.kcal, target }
}
