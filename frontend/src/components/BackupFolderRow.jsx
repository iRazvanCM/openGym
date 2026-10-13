import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { backupFolder, chooseBackupFolder, resetBackupFolder, onBackupFolderChange } from '../lib/mobile.js'
import { useUI } from '../store/useUI.js'
import { Row } from './ui.jsx'

const DEFAULT_FOLDER = 'Documents/openGym'
// The same folder as the iPhone's Files app shows it (Info.plist UIFileSharingEnabled).
const IOS_FOLDER = 'Files › On My iPhone › LiftLog › openGym'

/* Where auto-backup puts its copies on this phone (#161): Documents/openGym (on the iPhone the
   app's folder in Files), or a folder chosen with the system picker — a sync app's, an SD card's,
   iCloud Drive. The choice is this phone's alone (lib/mobile.js), so it is read here and not from
   the synced state. When the chosen folder stops taking copies they go to the default folder
   again, and this says so until the folder is chosen again or the default is confirmed. */
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
   not Documents/openGym regardless (Android QA). `keep` is AUTO_BACKUP_KEEP. A copy is made after
   a workout, a routine edited and a day logged (food, weight, the daily log). */
export function autoBackupSubtitle(folder, keep, { ios = false } = {}) {
  if (folder?.uri && folder.label) return t('Saves a dated copy to “{0}” after you log a day or a workout, and keeps the newest {1}.', folder.label, keep)
  if (folder?.uri) return t('Saves a dated copy to the folder you chose after you log a day or a workout, and keeps the newest {0}.', keep)
  if (ios) return t('Saves a dated copy to {0} after you log a day or a workout, and keeps the newest {1}. Choose an iCloud Drive folder below to take the copies off the phone.', IOS_FOLDER, keep)
  return t('Saves a dated copy to Documents/openGym after you log a day or a workout, and keeps the newest {0}. Point a sync app at that folder, or copy it out by hand.', keep)
}

export default function BackupFolderRow({ ios = false }) {
  const [folder, setFolder] = useBackupFolder()
  if (!folder) return null
  const where = ios ? IOS_FOLDER : DEFAULT_FOLDER

  const choose = async () => {
    try {
      const next = await chooseBackupFolder()
      if (next) setFolder(next)
    } catch (e) { useUI.getState().toast(t('This folder can’t be used for backups.')) }
  }
  const useDefault = async () => { setFolder(await resetBackupFolder()) }

  return <>
    <Row icon="folder" iconTint="var(--blue)" title={t('Backup folder')}
      subtitle={folder.uri ? (folder.label || t('Chosen folder')) : ios ? t('In the app ({0}). Choose iCloud Drive to keep copies off the phone.', where) : where} accessory="chevron" onClick={choose} />
    {folder.lost && <Row icon="warning" iconTint="var(--orange)" className="backup-lost"
      title={ios
        ? t('The backup folder can no longer be written to, so copies stay in the app again. Choose the folder again to switch back.')
        : folder.lostLabel
          ? t('openGym can no longer write to “{0}”, so copies go to Documents/openGym again. Choose the folder again to switch back.', folder.lostLabel)
          : t('openGym can no longer write to the chosen folder, so copies go to Documents/openGym again. Choose the folder again to switch back.')} />}
    {(folder.uri || folder.lost) && <Row icon="reset" iconTint="var(--label-3)" title={t('Use default folder')}
      subtitle={where} onClick={useDefault} />}
  </>
}
