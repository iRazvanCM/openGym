// Exporting the backup by hand — the plain JSON, or the .zip with every photo and video — from
// Settings, from the sheet that asks before leaving a server, and from Home when the weekly one is
// due. Each export that goes through is remembered (S.exported, lib/backup-status.js): Home says
// how old the newest copy outside the phone is, and the weekly reminder moves on.
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from './i18n.js'
import { MOBILE, shareExport, shareExportBlob } from './mobile.js'
import { todayISO } from './format.js'
import { referencedFiles } from './media-refs.js'
import { markExported } from './backup-status.js'

const toast = m => useUI.getState().toast(m)

function record(full) {
  try { useStore.getState().update(s => { s.exported = markExported(s.exported, { full }) }) }
  catch { /* a store that cannot take it: the export itself went through */ }
}

function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 60000)
}

/** The backup as JSON, without the photos. Reads the store at the moment of the tap. */
export async function exportBackupJSON() {
  const S = useStore.getState().S
  const json = JSON.stringify(S, null, 2)
  const name = 'opengym-backup-' + todayISO() + '.json'
  // complete when there is nothing it leaves out
  const full = referencedFiles(S).length === 0
  // WKWebView can't download blob URLs — the native build hands the file to the share sheet.
  if (MOBILE) {
    try { await shareExport(json, name) } catch (e) { return false }   // share sheet dismissed
    toast(t('Backup exported'))
    record(full)
    return true
  }
  download(new Blob([json], { type: 'application/json' }), name)
  toast(t('Backup exported'))
  record(full)
  return true
}

/**
 * "Export with photos & videos": the same JSON plus every file the state refers to, in a zip
 * (lib/backup-media.js). `fetchOne` fetches a file this device never downloaded (signed in); one
 * nobody has is left out and counted.
 */
export async function exportBackupZip({ fetchOne = null } = {}) {
  const { exportBackupZip: build } = await import('./backup-media.js')
  let out
  try { out = await build(useStore.getState().S, { fetchOne }) }
  catch { toast(t('Something went wrong')); return false }
  const name = 'opengym-backup-' + todayISO() + '.zip'
  if (out.missing) toast(tn('{0} file could not be included', '{0} files could not be included', out.missing))
  if (MOBILE) {
    try { await shareExportBlob(out.blob, name) } catch (e) { return false }   // share sheet dismissed
    if (!out.missing) toast(t('Backup exported'))
    record(true)
    return true
  }
  download(out.blob, name)
  if (!out.missing) toast(t('Backup exported'))
  record(true)
  return true
}
