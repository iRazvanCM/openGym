import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { APP_NAME } from './brand.js'

// The name under the icon comes from the native and web shells, not from the bundle, so each of
// them carries APP_NAME in its own file. A rename that misses one shows two names for one app.
const read = p => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('the app name', () => {
  it('is a short name that fits under an icon', () => {
    expect(APP_NAME).toMatch(/^\S.{0,11}$/)
  })

  it('is the name on the iPhone home screen and in the Health prompt', () => {
    const plist = read('ios/App/App/Info.plist')
    expect(plist).toMatch(new RegExp(`<key>CFBundleDisplayName</key>\\s*<string>${APP_NAME}</string>`))
    expect(plist).toContain(`<string>${APP_NAME} only reads from Apple Health`)
  })

  it('is the Android launcher label and the Capacitor app name', () => {
    expect(read('android/app/src/main/res/values/strings.xml')).toContain(`<string name="app_name">${APP_NAME}</string>`)
    expect(JSON.parse(read('capacitor.config.json')).appName).toBe(APP_NAME)
  })

  it('is the installed web app\'s name and the page title', () => {
    const manifest = JSON.parse(read('public/manifest.json'))
    expect([manifest.name, manifest.short_name]).toEqual([APP_NAME, APP_NAME])
    const html = read('index.html')
    expect(html).toContain(`<title>${APP_NAME}</title>`)
    expect(html).toContain(`<meta name="apple-mobile-web-app-title" content="${APP_NAME}">`)
  })
})
