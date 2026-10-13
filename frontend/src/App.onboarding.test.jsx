// @vitest-environment happy-dom
// The first-run questions (views/Onboarding.jsx) are the screen the app opens on until they are
// answered or skipped, with no tab bar under them; once done, the app opens on Home as before.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'
import { DEF, useStore } from './store/useStore.js'

vi.mock('./lib/sound.js', () => ({ setPlayOnSilent: vi.fn(), setVibrate: vi.fn(), setAlarmBuzzer: vi.fn() }))
vi.mock('./lib/api.js', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, api: vi.fn(() => Promise.resolve({})), beacon: vi.fn() }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, originalS
beforeEach(() => {
  originalS = useStore.getState().S
  window.scrollTo = vi.fn()
  window.requestAnimationFrame = vi.fn(() => 1)
  window.cancelAnimationFrame = vi.fn()
  localStorage.clear()
  localStorage.setItem('gym_guest', '1')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  localStorage.clear()
  useStore.setState({ S: originalS })
})

const boot = async over => {
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), ...over } })
  await act(async () => { root.render(<App />) })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

describe('the first run', () => {
  it('opens on the questions, with no tab bar', async () => {
    await boot({})
    expect(host.querySelector('.onb')).toBeTruthy()
    expect(host.textContent).toContain('Welcome to LiftLog')
    expect(document.getElementById('tabbar')).toBeNull()
  })

  it('once answered, opens on Home', async () => {
    await boot({ onboarded: Date.now() })
    expect(host.querySelector('.onb')).toBeNull()
    expect(host.querySelector('.tday')).toBeTruthy()
  })

  it('never stands in front of a session in progress', async () => {
    await boot({ active: { id: 'a', d: '2026-10-14', start: Date.now(), name: 'Push', cur: 0, entries: [] } })
    expect(host.querySelector('.onb')).toBeNull()
  })
})
