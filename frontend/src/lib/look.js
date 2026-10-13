// The app's default look moved from dark-and-green to the iPhone's own: light or dark with the
// phone (theme 'system') and Apple's blue (accent 'sky'). A profile still on the old default
// moves once, when its stored copy is read on this device; one that chose a look keeps it, and
// `look` remembers the move was made, so dark-and-green chosen afterwards stays as well.
//
// Done where the stored copy is read (useStore loadState and the phone's file restore), not as an
// edit: nothing is stamped or pushed for it, so a sync never sees a change nobody made.
export const LOOK = 2

export function moveToAppleLook(s) {
  if (!s || typeof s !== 'object' || (Number(s.look) || 0) >= LOOK) return s
  if ((s.theme || 'dark') === 'dark' && (s.accent || 'lime') === 'lime') { s.theme = 'system'; s.accent = 'sky' }
  s.look = LOOK
  return s
}

/**
 * The other one-time moves of a device's own copy, made the same way and remembered in `moves`:
 *
 *   backup   the phone app backs up on its own (Settings → Auto-backup on changes): until now it
 *            was off unless switched on, so the only copy of months of logging lived inside an app
 *            that a free Apple ID's signature can lock after seven days.
 *   ratePct  the cut's loss pace is a share of body weight (0.7–1% a week) instead of fixed kilos:
 *            0.8–1.2 kg a week is 0.75–1.1% at 106 kg but 0.95–1.4% at 85 kg, faster than the
 *            0.5–1% linked to keeping muscle (Helms et al. 2014; Garthe et al. 2011). Only a cut
 *            that has never chosen either moves; Progress → gear switches back to kilos.
 */
export function localMoves(s, { mobile = false } = {}) {
  if (!s || typeof s !== 'object') return s
  moveToAppleLook(s)
  const moves = s.moves && typeof s.moves === 'object' && !Array.isArray(s.moves) ? { ...s.moves } : {}
  if (!moves.backup) {
    if (mobile && s.autoBackup !== true) s.autoBackup = true
    if (mobile) moves.backup = 1
  }
  if (!moves.ratePct) {
    if (s.cut && typeof s.cut === 'object' && s.cut.rateUnit == null) s.cut = { ...s.cut, rateUnit: 'pct', ratePctMin: 0.7, ratePctMax: 1 }
    moves.ratePct = 1
  }
  s.moves = moves
  return s
}
