// "Before the cut": the checks to make on the installed app and the baseline to log before the
// first day (lib/precut.js), each with the one tap that does it. Home shows it until the cut is two
// weeks in or everything is ticked; Progress shows it above the verdict while the cut has not begun.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { cutOf } from '../lib/cut.js'
import { markPrecut, precutItems, precutShown } from '../lib/precut.js'
import { referencedFiles } from '../lib/media-refs.js'
import { MOBILE } from '../lib/mobile.js'
import { appleHealthStatus, loadAppleHealth, onAppleHealthChange } from '../lib/apple-health.js'
import { exportNow } from './SafetyCard.jsx'
import { checkBackupSheet } from './CheckBackup.jsx'
import { useBackupFolder } from './BackupFolderRow.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

const update = fn => useStore.getState().update(fn)
const toast = m => useUI.getState().toast(m)
const plural = (n, one, other) => t(n === 1 ? one : other, n)

/** Whether this is the iPhone app, and what its Apple Health file says (null elsewhere). */
function useHealth() {
  const [h, setH] = useState({ ios: false, file: null })
  useEffect(() => {
    if (!MOBILE) return undefined
    let live = true
    appleHealthStatus().then(async st => {
      if (!live || st === 'unsupported') return
      const file = await loadAppleHealth()
      if (live) setH({ ios: true, file })
    }).catch(() => {})
    const off = onAppleHealthChange(file => { if (live) setH(x => ({ ...x, file })) })
    return () => { live = false; off() }
  }, [])
  return h
}

/* ===================================================== a test notification == */

async function sendTestReminder() {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') { toast(t('Notifications are off for this app in the iPhone Settings.')); return false }
    await LocalNotifications.schedule({ notifications: [{
      id: 3900, title: t('Test reminder'), body: t('If you can read this, the weigh-in and log reminders will reach you too.'),
      schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true },
    }] })
    toast(t('A test reminder comes in 5 seconds. Lock the phone to see it.'))
    return true
  } catch { toast(t('Reminders are not available here.')); return false }
}

/* ================================================================ the card == */

export default function PrecutCard() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = todayISO()
  const health = useHealth()
  const [folder] = useBackupFolder(MOBILE && !!S.autoBackup)
  const hasMedia = referencedFiles(S).length > 0
  const items = useMemo(() => precutItems(S, { today, mobile: MOBILE, ios: health.ios, health: health.file, hasMedia, folder }),
    [S, today, health, hasMedia, folder])
  const [open, setOpen] = useState(false)
  if (!precutShown(S, items, today)) return null
  const done = items.filter(i => i.done).length
  const cut = cutOf(S)

  const addHolidays = hol => {
    update(s => { const c = cutOf(s); c.breaks = [...c.breaks.filter(b => !(b.from <= hol.to && b.to >= hol.from)), { from: hol.from, to: hol.to }]; s.cut = cutOf({ cut: c }) })
    toast(t('Holiday break added: {0} – {1}', fmtDate(hol.from, true), fmtDate(hol.to, true)))
  }
  const setReminders = async () => {
    update(s => { const c = cutOf(s); c.remind = { weigh: c.remind?.weigh || '07:30', log: c.remind?.log || '21:00' }; s.cut = c })
    const { syncReminder } = await import('../lib/mobile.js')
    await syncReminder(useStore.getState().S, true)
    toast(t('Reminders set: weigh-in 07:30, log 21:00'))
  }
  const test = async () => { if (await sendTestReminder()) update(s => { s.precut = markPrecut(s.precut, 'test') }) }

  const row = (i, title, sub, action) => <div className={'precut-i' + (i.done ? ' done' : '')} key={i.id}>
    <Icon name={i.done ? 'checkCircle' : 'dot'} className="precut-ic" />
    <div className="precut-m"><b>{title}</b>{sub && <span>{sub}</span>}</div>
    {!i.done && action}
  </div>
  const act = (label, onClick) => <Button size="sm" variant="tinted" onClick={onClick}>{label}</Button>

  const views = {
    start: i => row(i, t('Start date set'), cut.start ? fmtDate(cut.start, true) : t('The day the cut begins: the plan line and the check-ins count from it.'), act(t('Set'), () => nav('/setup'))),
    holidays: i => row(i, t('Holiday break planned'), t('{0} – {1} at maintenance, tied into every number.', fmtDate(i.hol.from, true), fmtDate(i.hol.to, true)), act(t('Add'), () => addHolidays(i.hol))),
    health: i => row(i, t('Apple Health fills the log'), i.state === 'ok' ? t('Steps and sleep are coming in.') : i.state === 'empty' ? t('Connected, but nothing came in for the last 3 days. In Garmin Connect: Connected Apps → Apple Health.') : t('Steps, sleep and weight from the Garmin, without typing.'), act(t('Open'), () => nav('/settings/data'))),
    reminders: i => row(i, t('Weigh-in and log reminders'), t('A nudge at 07:30 and at 21:00, skipped on days already done.'), act(t('Turn on'), setReminders)),
    test: i => row(i, t('A test reminder arrived'), t('Proves the reminders reach the phone.'), act(t('Send'), test)),
    export: i => row(i, t('An export in the last week'), t('Saved to iCloud Drive or your Mac.'), act(t('Export'), () => exportNow(hasMedia))),
    import: i => row(i, t('An export checked'), t('Open the file once to see that it reads, without importing it.'), act(t('Check'), checkBackupSheet)),
    weigh: i => row(i, t('A week of weigh-ins'), t('{0} of 5 mornings weighed this week', i.n), null),
    lifts: i => row(i, t('Lifts logged before the cut'), plural(i.n, '{0} workout in 4 weeks · the strength check compares with these', '{0} workouts in 4 weeks · the strength check compares with these'), null),
    waist: i => row(i, t('Waist measured'), t('At the navel, relaxed, every week at the same spot.'), act(t('Log'), () => nav('/measurements'))),
  }
  const todo = items.filter(i => !i.done)
  const shown = open ? items : todo.slice(0, 3)

  return <div className="card precut">
    <div className="row between" style={{ gap: 10, marginBottom: 6 }}>
      <div className="row" style={{ gap: 9, minWidth: 0 }}>
        <span className="lrow-i" style={{ '--tint': 'var(--indigo)' }}><Icon name="clipboard" /></span>
        <div style={{ minWidth: 0 }}>
          <div className="dl-lbl">{cut.start && cut.start <= today ? t('First weeks') : t('Before the cut')}</div>
          <div className="dl-ttl">{t('{0} of {1} ready', done, items.length)}</div>
        </div>
      </div>
      <button className="iconbtn" onClick={() => update(s => { s.precut = markPrecut(s.precut, 'hidden') })} aria-label={t('Hide')}><Icon name="xmark" /></button>
    </div>
    <div className="precut-bar"><span style={{ width: Math.round(done / items.length * 100) + '%' }} /></div>
    {shown.map(i => views[i.id]?.(i))}
    {items.length > shown.length || open ? <button className="precut-more" onClick={() => setOpen(o => !o)}>
      {open ? t('Show less') : t('Show all {0}', items.length)}<Icon name={open ? 'chevronUp' : 'chevronDown'} />
    </button> : null}
  </div>
}
