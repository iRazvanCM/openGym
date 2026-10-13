// Exporting the backup — the JSON, or the zip with photos and videos — for Settings and for the
// reminder on Home (components/SafetyCard.jsx). A finished export is remembered in S.lastExport,
// so the reminder knows how old the newest copy off the phone is (lib/safety.js exportDue).
// On the phone the file goes out through the share sheet (Files, iCloud Drive, AirDrop to a Mac);
// it counts once the sheet has taken it, not when it was dismissed.
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { MOBILE, shareExport, shareExportBlob } from '../lib/mobile.js'
import { todayISO } from '../lib/format.js'
import { t, tn } from '../lib/i18n.js'

const toast = m => useUI.getState().toast(m)
const remember = () => useStore.getState().update(s => { s.lastExport = Date.now() })

/** The whole state as JSON. Resolves true when the file left. */
export async function exportBackupJson() {
  const json = JSON.stringify(useStore.getState().S, null, 2)
  const name = 'opengym-backup-' + todayISO() + '.json'
  // WKWebView can't download blob URLs — the native build hands the file to the share sheet.
  if (MOBILE) {
    try { await shareExport(json, name) } catch (e) { return false }   // share sheet dismissed
    remember()
    toast(t('Backup exported'))
    return true
  }
  const blob = new Blob([json], { type: 'application/json' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
  remember()
  toast(t('Backup exported'))
  return true
}

/**
 * The same JSON plus every file the state refers to, in a zip (lib/backup-media.js). `fetchOne`
 * fetches a file this device never downloaded (signed in); one nobody has is left out and counted.
 * Resolves true when the file left.
 */
export async function exportBackupWithMedia({ fetchOne = null } = {}) {
  const { exportBackupZip } = await import('../lib/backup-media.js')
  let out
  try { out = await exportBackupZip(useStore.getState().S, { fetchOne }) }
  catch { toast(t('Something went wrong')); return false }
  const name = 'opengym-backup-' + todayISO() + '.zip'
  if (out.missing) toast(tn('{0} file could not be included', '{0} files could not be included', out.missing))
  if (MOBILE) {
    try { await shareExportBlob(out.blob, name) } catch (e) { return false }   // share sheet dismissed
    remember()
    if (!out.missing) toast(t('Backup exported'))
    return true
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(out.blob); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 60000)
  remember()
  if (!out.missing) toast(t('Backup exported'))
  return true
}
