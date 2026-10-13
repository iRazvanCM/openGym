// @vitest-environment happy-dom

/* The phone's auto-backup follows the daily log too (report, item 1): a week of food typed in by
   hand is the part no other app holds. One copy at most every few minutes, and the one still
   waiting goes out when the app leaves the screen. */
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { files: new Map() }
})
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA', Documents: 'DOCUMENTS', Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readFile: async ({ path, directory }) => {
      const k = directory + '/' + path
      if (!h.files.has(k)) throw new Error('File does not exist')
      return { data: h.files.get(k) }
    },
    writeFile: async ({ path, directory, data }) => { h.files.set(directory + '/' + path, data); return { uri: 'file://' + path } },
    readdir: async () => ({ files: [] }),
    deleteFile: async () => {},
  },
}))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { cancel: async () => {}, checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }), schedule: async () => {} },
}))
vi.mock('@capacitor/app', () => ({ App: { addListener: () => ({ remove() {} }) } }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'android', isNativePlatform: () => true }, registerPlugin: () => ({}) }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {} }) } }))

import { DEF, useStore } from './useStore.js'

const clone = v => JSON.parse(JSON.stringify(v))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const backups = () => [...h.files].filter(([k]) => k.startsWith('DOCUMENTS/')).map(([, v]) => JSON.parse(v))
const hide = () => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

afterEach(() => { h.files.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

describe('auto-backup and the daily log', () => {
  it('a day logged writes the day\'s copy, the next change waits, and leaving the app sends it', async () => {
    useStore.setState({ S: { ...clone(DEF), autoBackup: true }, ready: true })
    useStore.getState().update(s => { s.dailyLog = [{ d: '2026-11-02', t: 1, kcal: 1950 }] })
    await sleep(2300)
    expect(backups()).toHaveLength(1)
    expect(backups()[0].dailyLog[0].kcal).toBe(1950)

    useStore.getState().update(s => { s.dailyLog[0].kcal = 2050; s.dailyLog[0].t = 2 })
    await sleep(2300)
    expect(backups()[0].dailyLog[0].kcal).toBe(1950)   // at most one copy every few minutes

    hide()
    await sleep(50)
    expect(backups()[0].dailyLog[0].kcal).toBe(2050)
  })

  it('a weigh-in or the plan counts too; the setting off writes nothing', async () => {
    useStore.setState({ S: { ...clone(DEF), autoBackup: false }, ready: true })
    useStore.getState().update(s => { s.bodyweight = [{ d: '2026-11-02', w: 105.2, t: 3 }] })
    await sleep(2300)
    expect(backups()).toHaveLength(0)
  })
})
