// What keeps the data safe on the phone, where it can be seen: the app's seven days (a sideloaded
// install, lib/renewal.js) and the weekly export with the photos (lib/backup-status.js).
//
// Home shows the card only when something is due — a renewal within two days, or an export a week
// old — so a normal day has nothing extra on it. Settings → Data always shows both rows.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate, isoOf } from '../lib/format.js'
import { referencedFiles } from '../lib/media-refs.js'
import { exportStatus } from '../lib/backup-status.js'
import { RENEWAL_RULES, appSigning, renewalOf } from '../lib/renewal.js'
import { exportBackupJSON, exportBackupZip } from '../lib/backup-export.js'
import { APP_NAME } from '../lib/brand.js'
import Icon from './Icon.jsx'
import { Button, Row } from './ui.jsx'

const plural = (n, one, other) => t(n === 1 ? one : other, n)
const timeOf = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const dayOf = ms => fmtDate(isoOf(new Date(ms)), true)

/** This install's signing profile, once the phone has said (null meanwhile, and off the iPhone). */
export function useSigning() {
  const [info, setInfo] = useState(null)
  useEffect(() => {
    let live = true
    appSigning().then(i => { if (live) setInfo(i) }).catch(() => {})
    return () => { live = false }
  }, [])
  return info
}

/** "Last export 9 days ago", "Last export today", "No export yet". */
export function exportLine(status) {
  if (status.last == null) return t('No export yet')
  if (status.days === 0) return t('Last export today')
  return plural(status.days, 'Last export {0} day ago', 'Last export {0} days ago')
}

/** "Stops opening in 2 days (Fri 14:32)", "Stops opening today at 14:32". */
export function renewalLine(r) {
  const at = timeOf(r.expires)
  if (r.tone === 'expired') return t('The signature ran out at {0}. Install the same IPA again with the same Apple ID.', at)
  if (r.days === 0) return t('Stops opening today at {0}', at)
  return t(r.days === 1 ? 'Stops opening in {0} day ({1} {2})' : 'Stops opening in {0} days ({1} {2})', r.days, dayOf(r.expires), at)
}

export const exportNow = hasMedia => (hasMedia ? exportBackupZip() : exportBackupJSON())

/* ====================================================== the rules, in one place == */

function RenewalSheet({ info, close }) {
  const r = renewalOf(info)
  return <>
    <h3 style={{ marginBottom: 4 }}>{t('Keeping {0} and its data', APP_NAME)}</h3>
    {r ? <div className={'safety-when ' + r.tone}>
      <Icon name="hourglass" />
      <span>{renewalLine(r)}</span>
    </div> : <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
      {t('A sideloaded app signed with a free Apple ID stops opening after seven days, until the same IPA is installed over it again.')}
    </div>}
    <ul className="safety-rules">
      {RENEWAL_RULES.map(rule => <li key={rule.title}>
        <span className="lrow-i" style={{ '--tint': rule.icon === 'trash' ? 'var(--red)' : 'var(--blue)' }}><Icon name={rule.icon} /></span>
        <div><b>{t(rule.title)}</b><p>{t(rule.body)}</p></div>
      </li>)}
    </ul>
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}

export const renewalSheet = info => useUI.getState().openSheet(close => <RenewalSheet info={info} close={close} />)

/* ============================================================== the Home card == */

export default function SafetyCard() {
  const S = useStore(s => s.S)
  const info = useSigning()
  const [busy, setBusy] = useState(false)
  const hasMedia = referencedFiles(S).length > 0
  const status = exportStatus(S, Date.now(), { hasMedia })
  const r = renewalOf(info)
  const renew = r && r.tone !== 'ok' ? r : null
  if (!renew && !status.due) return null

  const go = async () => { setBusy(true); try { await exportNow(hasMedia) } finally { setBusy(false) } }

  return <div className="card safety-card">
    {renew && <div className={'safety-row ' + renew.tone} role="button" tabIndex={0} onClick={() => renewalSheet(info)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); renewalSheet(info) } }}>
      <span className="lrow-i" style={{ '--tint': renew.tone === 'soon' ? 'var(--orange)' : 'var(--red)' }}><Icon name="hourglass" /></span>
      <div className="safety-m">
        <b>{renew.days === 0 ? t('Renew {0} today', APP_NAME) : t('Time to renew {0}', APP_NAME)}</b>
        <span>{renewalLine(renew)} · {t('Sideloadly, same Apple ID, never delete the app.')}</span>
      </div>
      <Icon name="chevronRight" className="chev" />
    </div>}
    {status.due && <div className="safety-row">
      <span className="lrow-i" style={{ '--tint': 'var(--blue)' }}><Icon name="share" /></span>
      <div className="safety-m">
        <b>{exportLine(status)}</b>
        <span>{hasMedia ? t('Export with the photos (.zip) to iCloud Drive or your Mac: the copy that survives anything.') : t('Export a backup to iCloud Drive or your Mac: the copy that survives anything.')}</span>
      </div>
      <Button size="sm" variant="tinted" disabled={busy} onClick={go}>{t('Export')}</Button>
    </div>}
  </div>
}

/* ============================================================ Settings → Data == */

/** The two rows under Back up: how old the last export is, and (sideloaded) when the app expires. */
export function SafetyRows() {
  const S = useStore(s => s.S)
  const info = useSigning()
  const hasMedia = referencedFiles(S).length > 0
  const status = exportStatus(S, Date.now(), { hasMedia })
  const r = renewalOf(info)
  return <>
    <Row icon="clock" iconTint={status.due ? 'var(--orange)' : 'var(--green)'} title={exportLine(status)}
      subtitle={status.last != null ? dayOf(status.last) + ' · ' + t('a reminder comes once a week') : t('A reminder comes once a week until there is one.')} />
    {info && <Row icon="hourglass" iconTint={!r || r.tone === 'ok' ? 'var(--green)' : 'var(--orange)'} title={t('Renewing the app')}
      subtitle={r ? renewalLine(r) : t('Signed until {0}', dayOf(info.expires))} accessory="chevron" onClick={() => renewalSheet(info)} />}
  </>
}
