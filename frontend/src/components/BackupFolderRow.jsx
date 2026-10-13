import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { backupFolder, chooseBackupFolder, resetBackupFolder, onBackupFolderChange } from '../lib/mobile.js'
import { useUI } from '../store/useUI.js'
import { APP_NAME } from '../lib/brand.js'
import { Row } from './ui.jsx'

/* The folder auto-backup's copies go to when none was chosen: Documents/openGym on Android, and
   on the iPhone the same folder as the Files app shows it, under the app's name. */
export const defaultFolder = ios => (ios ? t('On My iPhone › {0} › openGym', APP_NAME) : 'Documents/openGym')

/* Where auto-backup puts its copies on this phone (#161): the default folder, or a folder chosen
   with the system picker — a sync app's, an SD card's on Android; iCloud Drive's on the iPhone,
   which is what keeps the copies when the app itself is gone. The choice is this phone's alone
   (lib/mobile.js), so it is read here and not from the synced state. When the chosen folder
   stops taking copies they go to the default folder again, and this says so until the folder is
   chosen again or the default is confirmed. */
export function useBackupFolder(enabled = true) {
  const [folder, setFolder] = useState(null)
  useEffect(() => {
    if (!enabled) return undefined
    let live = true
    let off = () => {}
    try {
      backupFolder().then(f => { if (live) setFolder(f) }).catch(() => { if (live) setFolder({}) })
      off = onBackupFolderChange(f => { if (live) setFolder(f) })
    } catch (e) { setFolder({}) }
    return () => { live = false; off() }
  }, [enabled])
  return [folder, setFolder]
}

/* The Auto-backup row's subtitle names where the copies go: the chosen folder once there is one,
   not the default regardless (Android QA). `keep` is AUTO_BACKUP_KEEP. */
export function autoBackupSubtitle(folder, keep, ios = false) {
  if (folder?.uri && folder.label) return t('Saves a dated copy to “{0}” after a workout, a routine edit or a change to the day’s log, and keeps the newest {1}.', folder.label, keep)
  if (folder?.uri) return t('Saves a dated copy to the folder you chose after a workout, a routine edit or a change to the day’s log, and keeps the newest {0}.', keep)
  if (ios) return t('Saves a dated copy to {0} in the Files app after a workout, a routine edit or a change to the day’s log, and keeps the newest {1}. Those copies go if the app is deleted: choose a folder in iCloud Drive below.', defaultFolder(true), keep)
  return t('Saves a dated copy to Documents/openGym after a workout, a routine edit or a change to the day’s log, and keeps the newest {0}. Point a sync app at that folder, or copy it out by hand.', keep)
}

export default function BackupFolderRow({ ios = false }) {
  const [folder, setFolder] = useBackupFolder()
  if (!folder) return null
  const home = defaultFolder(ios)

  const choose = async () => {
    try {
      const next = await chooseBackupFolder()
      if (next) setFolder(next)
    } catch (e) { useUI.getState().toast(t('This folder can’t be used for backups.')) }
  }
  const useDefault = async () => { setFolder(await resetBackupFolder()) }

  return <>
    <Row icon="folder" iconTint="var(--blue)" title={t('Backup folder')}
      subtitle={folder.uri ? (folder.label || t('Chosen folder')) + (folder.cloud ? ' · iCloud Drive' : '') : ios ? t('{0} · tap to choose iCloud Drive', home) : home} accessory="chevron" onClick={choose} />
    {folder.lost && <Row icon="warning" iconTint="var(--orange)" className="backup-lost"
      title={folder.lostLabel
        ? t('{0} can no longer write to “{1}”, so copies go to {2} again. Choose the folder again to switch back.', APP_NAME, folder.lostLabel, home)
        : t('{0} can no longer write to the chosen folder, so copies go to {1} again. Choose the folder again to switch back.', APP_NAME, home)} />}
    {(folder.uri || folder.lost) && <Row icon="reset" iconTint="var(--label-3)" title={t('Use default folder')}
      subtitle={home} onClick={useDefault} />}
  </>
}
