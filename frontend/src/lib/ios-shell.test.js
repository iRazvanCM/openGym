import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// The iPhone shell's own files, which no build in this repository compiles: the IPA is built on a
// Mac in CI. What can go wrong in them without a compiler — a Swift file left out of the target, a
// plugin never registered, a key missing from Info.plist — is caught here instead.
const dir = resolve(process.cwd(), 'ios/App/App')
const read = p => readFileSync(resolve(dir, p), 'utf8')
const plistBool = (plist, key) => new RegExp(`<key>${key}</key>\\s*<true/>`).test(plist)

describe('the iPhone shell', () => {
  it('shows the app\'s Documents folder in the Files app, where the automatic copies go', () => {
    const plist = read('Info.plist')
    expect(plistBool(plist, 'UIFileSharingEnabled')).toBe(true)
    expect(plistBool(plist, 'LSSupportsOpeningDocumentsInPlace')).toBe(true)
  })

  it('compiles every Swift file in the app target, and registers every local plugin', () => {
    const pbx = readFileSync(resolve(process.cwd(), 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8')
    const main = read('MainViewController.swift')
    for (const f of readdirSync(dir).filter(n => n.endsWith('.swift'))) {
      expect(pbx, f).toContain(`/* ${f} in Sources */`)
      const plugin = read(f).match(/public class (\w+Plugin): CAPPlugin, CAPBridgedPlugin/)
      if (plugin) expect(main, plugin[1]).toContain(`registerPluginInstance(${plugin[1]}())`)
    }
  })

  it('gives each local plugin the name lib/ calls it by', () => {
    expect(read('BackupFolderPlugin.swift')).toContain('public let jsName = "BackupFolder"')
    expect(read('AppSigningPlugin.swift')).toContain('public let jsName = "AppSigning"')
    expect(read('AppleHealthPlugin.swift')).toContain('public let jsName = "AppleHealth"')
  })
})
