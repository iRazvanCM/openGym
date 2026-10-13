// Keeping the phone app and its data alive: the card on Home when something needs doing, and the
// signature row in Settings. The arithmetic is lib/safety.js; the signature comes from the
// native side (lib/signing.js). Shown on the phone app only — in a browser there is no
// signature, and the data lives where the browser keeps it.
//
// Nothing here imports sheets.jsx: Home's tests mock that module, and the card renders inside Home.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { MOBILE } from '../lib/mobile.js'
import { exportDue, signingState } from '../lib/safety.js'
import { referencedFiles } from '../lib/media-refs.js'
import { loadSigning } from '../lib/signing.js'
import { fmtDate, isoOf } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { useBackupFolder } from './BackupFolderRow.jsx'
import { exportBackupJson, exportBackupWithMedia } from './backup-actions.js'
import Icon from './Icon.jsx'
import { Button, Row } from './ui.jsx'

/** The signature as read from the app (null off the iPhone app), re-read once per mount. */
export function useSigning() {
  const [info, setInfo] = useState(null)
  useEffect(() => {
    if (!MOBILE) return undefined
    let live = true
    loadSigning().then(i => { if (live) setInfo(i) }).catch(() => {})
    return () => { live = false }
  }, [])
  return info
}

const whenText = ms => {
  const d = new Date(ms)
  return d.toLocaleString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const leftText = st => (st.hoursLeft < 24
  ? t('{0} h left', Math.max(1, Math.floor(st.hoursLeft)))
  : st.daysLeft === 1 ? t('1 day left') : t('{0} days left', st.daysLeft))

/** Settings → Data: when this install stops opening, and what to do about it. */
export function SigningRow() {
  const info = useSigning()
  const st = signingState(info)
  if (!st) return null
  return <Row icon="shield" iconTint={st.level === 'ok' ? 'var(--green)' : 'var(--orange)'} title={t('App signature')}
    subtitle={t('Stops opening {0} ({1}). Install it again over itself from Sideloadly before then; never delete the app, that deletes your data.', whenText(st.expires), leftText(st))} />
}

/** Home: the signature running out (three days or less), and a copy off the phone that is due. */
export default function SafetyCard() {
  const S = useStore(s => s.S)
  const info = useSigning()
  const [folder] = useBackupFolder(MOBILE && !!S.autoBackup)
  const [busy, setBusy] = useState(false)
  if (!MOBILE) return null
  const sign = signingState(info)
  const hasMedia = referencedFiles(S).length > 0
  const ex = exportDue(S, { folderAt: folder?.uri ? folder.at || 0 : 0, hasMedia })
  const signDue = sign && sign.level !== 'ok'
  if (!signDue && !ex.due) return null

  const exportNow = async () => {
    setBusy(true)
    try { await (hasMedia ? exportBackupWithMedia() : exportBackupJson()) } finally { setBusy(false) }
  }

  return <>
    {signDue && <div className="card safety-card warn">
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <span className="lrow-i" style={{ '--tint': 'var(--orange)' }}><Icon name="warning" /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="safety-t">{sign.level === 'expired' ? t('The signature has run out') : t('LiftLog stops opening {0}', fmtDate(isoOf(new Date(sign.expires)), true))}</div>
          <div className="small muted safety-s">{t('{0}. Install the same IPA again over the app from Sideloadly, with the same Apple ID. Never delete the app: that deletes your data.', leftText(sign))}</div>
        </div>
      </div>
    </div>}
    {ex.due && <div className="card safety-card">
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <span className="lrow-i" style={{ '--tint': 'var(--blue)' }}><Icon name="share" /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="safety-t">{ex.days == null ? t('No copy off the phone yet') : t('Last copy off the phone: {0} days ago', ex.days)}</div>
          <div className="small muted safety-s">{hasMedia
            ? t('Export with photos and save it to iCloud Drive or your Mac. Everything you logged lives only in this app until you do.')
            : t('Export a backup and save it to iCloud Drive or your Mac. Everything you logged lives only in this app until you do.')}</div>
        </div>
      </div>
      <Button size="sm" variant="tinted" icon="share" disabled={busy} onClick={exportNow} style={{ marginTop: 10 }}>
        {hasMedia ? t('Export with photos') : t('Export backup')}
      </Button>
    </div>}
  </>
}
