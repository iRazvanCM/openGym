// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { addDays } from '../lib/cut.js'
import { todayISO } from '../lib/format.js'
import PrecutCard from './PrecutCard.jsx'
import { summarizeBackup } from '../lib/backup-check.js'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toasts: [] })
  useStore.setState(s => ({ S: { ...s.S, cut: { start: addDays(todayISO(), 10) }, bodyweight: [], dailyLog: [], measurements: [], workouts: [], precut: null, exported: null } }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const render = async () => { await act(async () => { root.render(<PrecutCard />) }) }
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent === text)

describe('the checklist before the cut', () => {
  it('counts what is ready and shows the next things to do', async () => {
    await render()
    expect(host.textContent).toContain('Before the cut')
    expect(host.textContent).toMatch(/1 of \d+ ready/)   // the start date is set
    expect(host.querySelectorAll('.precut-i').length).toBe(3)
    await act(async () => { button('Show all 7').click() })
    expect(host.querySelectorAll('.precut-i').length).toBe(7)
  })

  it('adds the holiday break in one tap, tied to the plan', async () => {
    const start = todayISO() <= `${todayISO().slice(0, 4)}-12-22` ? addDays(todayISO(), 10) : null
    if (!start) return   // run in the holidays themselves: nothing to plan ahead
    await render()
    await act(async () => { button('Add').click() })
    const breaks = useStore.getState().S.cut.breaks
    expect(breaks).toHaveLength(1)
    expect(breaks[0].from.slice(5)).toBe('12-23')
    expect(breaks[0].to.slice(5)).toBe('01-01')
  })

  it('goes away when put away, and once the cut is two weeks in', async () => {
    await render()
    await act(async () => { host.querySelector('[aria-label="Hide"]').click() })
    expect(host.querySelector('.precut')).toBeNull()
    await act(async () => { useStore.setState(s => ({ S: { ...s.S, precut: null, cut: { start: addDays(todayISO(), -14) } } })) })
    expect(host.querySelector('.precut')).toBeNull()
  })
})

describe('a backup read back', () => {
  it('says what a file holds', () => {
    expect(summarizeBackup({ state: { dailyLog: [{ d: '2026-11-02' }] } }).days).toBe(1)
  })
})
