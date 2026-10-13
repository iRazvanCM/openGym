// "Check a backup": an exported file opened the way Import opens it, and what it holds said — no
// import, nothing replaced (lib/backup-check.js). In Settings → Data, and on the checklist before
// the cut, where reading one back once is what tells a backup from a hope.
import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { markPrecut } from '../lib/precut.js'
import { backupComplete, summarizeBackup } from '../lib/backup-check.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

const update = fn => useStore.getState().update(fn)
const plural = (n, one, other) => t(n === 1 ? one : other, n)

function CheckBackup({ close }) {
  const ref = useRef(null)
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const pick = async ev => {
    const f = ev.target.files?.[0]
    ev.target.value = ''
    if (!f) return
    setBusy(true)
    try {
      const { readBackupFile } = await import('../lib/backup-media.js')
      const sum = summarizeBackup(await readBackupFile(f))
      setRes({ ok: true, name: f.name, sum })
      update(s => { s.precut = markPrecut(s.precut, 'importTest') })
    } catch (e) {
      setRes({ ok: false, name: f.name })
    } finally { setBusy(false) }
  }
  const s = res?.sum
  return <>
    <h3 style={{ marginBottom: 4 }}>{t('Check a backup')}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.45 }}>
      {t('Pick an exported file (from iCloud Drive, say). It is read the way Import reads it, and nothing is changed: this only shows that the copy opens and what it holds.')}
    </div>
    <input ref={ref} type="file" accept=".json,.zip,application/json,application/zip" hidden onChange={pick} />
    <Button variant="tinted" icon="folder" disabled={busy} onClick={() => ref.current?.click()}>{busy ? t('Reading…') : t('Choose a backup file')}</Button>
    {res && (res.ok ? <div className={'precut-res ' + (backupComplete(s) ? 'good' : 'warn')}>
      <b><Icon name={backupComplete(s) ? 'checkCircle' : 'warning'} />{backupComplete(s) ? t('This backup opens and is complete') : t('This backup opens, but without some photos')}</b>
      <span>{res.name}</span>
      <ul>
        <li>{plural(s.days, '{0} day logged', '{0} days logged')} · {plural(s.foods, '{0} food item', '{0} food items')}</li>
        <li>{plural(s.weighIns, '{0} weigh-in', '{0} weigh-ins')} · {plural(s.workouts, '{0} workout', '{0} workouts')}</li>
        {s.photos > 0 && <li>{t('Photos and videos: {0} of {1}', s.zip ? s.photosIn : 0, s.photos)}</li>}
        {s.newest && <li>{t('Newest entry: {0}', fmtDate(s.newest, true, true))}</li>}
      </ul>
    </div> : <div className="precut-res bad"><b><Icon name="warning" />{t('This file is not a backup the app can read')}</b><span>{res.name}</span></div>)}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}

export const checkBackupSheet = () => useUI.getState().openSheet(close => <CheckBackup close={close} />)

