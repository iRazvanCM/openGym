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
