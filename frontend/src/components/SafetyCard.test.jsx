// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { _setSigning } from '../lib/renewal.js'
import SafetyCard, { SafetyRows, exportLine, renewalLine } from './SafetyCard.jsx'

const DAY = 86400000
let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toasts: [] })
  useStore.setState(s => ({ S: { ...s.S, workouts: [], customEx: [], exported: null } }))
  _setSigning(null)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); _setSigning(undefined) })

const render = async el => { await act(async () => { root.render(el) }) }

describe('the safety card on Home', () => {
  it('asks for an export until there is a recent one', async () => {
    await render(<SafetyCard />)
    expect(host.textContent).toContain('No export yet')
    expect([...host.querySelectorAll('button')].some(b => b.textContent === 'Export')).toBe(true)
    await act(async () => { useStore.setState(s => ({ S: { ...s.S, exported: { at: Date.now() - 2 * DAY, full: Date.now() - 2 * DAY } } })) })
    expect(host.querySelector('.safety-card')).toBeNull()
  })

  it('says when the app stops opening, two days out, and opens the rules', async () => {
    useStore.setState(s => ({ S: { ...s.S, exported: { at: Date.now(), full: Date.now() } } }))
    _setSigning({ created: Date.now() - 6 * DAY, expires: Date.now() + 1.5 * DAY, team: '' })
    await render(<SafetyCard />)
    expect(host.textContent).toContain('Time to renew LiftLog')
    expect(host.textContent).toContain('Stops opening in 1 day')
    await act(async () => { host.querySelector('.safety-row').click() })
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('stays away with days to spare', async () => {
    useStore.setState(s => ({ S: { ...s.S, exported: { at: Date.now(), full: Date.now() } } }))
    _setSigning({ created: Date.now() - DAY, expires: Date.now() + 6 * DAY, team: '' })
    await render(<SafetyCard />)
    expect(host.querySelector('.safety-card')).toBeNull()
  })
})

describe('Settings → Data', () => {
  it('always shows the age of the last export, and the renewal on a sideloaded install', async () => {
    useStore.setState(s => ({ S: { ...s.S, exported: { at: Date.now() - 3 * DAY, full: Date.now() - 3 * DAY } } }))
    await render(<SafetyRows />)
    expect(host.textContent).toContain('Last export 3 days ago')
    expect(host.textContent).not.toContain('Renewing the app')
    _setSigning({ created: Date.now() - DAY, expires: Date.now() + 6 * DAY, team: '' })
    act(() => root.unmount())
    root = createRoot(host)
    await render(<SafetyRows />)
    expect(host.textContent).toContain('Renewing the app')
  })
})

describe('wording', () => {
  it('reads the export age and the expiry plainly', () => {
    expect(exportLine({ last: null })).toBe('No export yet')
    expect(exportLine({ last: 1, days: 0 })).toBe('Last export today')
    expect(exportLine({ last: 1, days: 1 })).toBe('Last export 1 day ago')
    expect(renewalLine({ tone: 'urgent', days: 0, expires: Date.now() + 3600000 })).toMatch(/^Stops opening today at /)
  })
})

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
