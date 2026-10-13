// The iPhone app's signature, read once per launch from the native side
// (ios/App/App/SafetyPlugins.swift AppSigningPlugin): when this install stops opening. What the
// date means and the warnings that go with it are in lib/safety.js, where they have tests.
import { MOBILE } from './mobile.js'

// Wrapped in an object: a Capacitor plugin proxy answers `then`, so a promise resolved with the
// bare proxy never settles (as in apple-health.js).
let pluginP = null
const plugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE) return null
  const { Capacitor, registerPlugin } = await import('@capacitor/core')
  if (Capacitor.getPlatform() !== 'ios') return null
  return { AS: registerPlugin('AppSigning') }
})().catch(() => null))

let cached = null
/**
 * { found, expires, created, team, name, healthKit, devices, bundleId } — `found` false on an
 * App Store or TestFlight build, null off the iPhone app or on a build from before the plugin.
 */
export function loadSigning() {
  if (cached) return cached
  cached = (async () => {
    const p = await plugin()
    if (!p) return null
    try { return await p.AS.info() } catch { return null }
  })()
  return cached
}

// Tests only.
export function _resetSigning() { cached = null; pluginP = null }
