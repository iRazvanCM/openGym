// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { addDays } from '../lib/cut.js'
import { todayISO } from '../lib/format.js'
import WeeklyCheckIn from './WeeklyCheckIn.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  nav.mockClear()
  useUI.setState({ sheets: [], toasts: [] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

// Five weeks losing 0.4 kg a week on 2,000 kcal: slower than the plan, maintenance known.
function slowCut() {
  const today = todayISO(), start = addDays(today, -35)
  const bodyweight = [], dailyLog = []
  for (let i = 0; i < 35; i++) {
    const d = addDays(start, i), t = new Date(d + 'T07:00:00').getTime()
    bodyweight.push({ d, w: Math.round((106 - 0.4 * i / 7) * 100) / 100, t })
    dailyLog.push({ d, t, kcal: 2000, protein: 176, steps: 10200, sleep: 7.6 })
  }
  dailyLog[33].kcal = 700   // yesterday: dinner never logged
  const checkInDay = new Date(today + 'T12:00:00').getDay()
  return { unit: 'kg', targetW: 85, cut: { start, checkInDay }, bodyweight, dailyLog, workouts: [], measurements: [], checkIns: [] }
}

const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

describe('the weekly check-in', () => {
  it('sums the week, asks about the half-logged day, and moves the calories 150 at most', () => {
    useStore.setState(s => ({ S: { ...s.S, ...slowCut() } }))
    act(() => root.render(<WeeklyCheckIn />))
    const text = host.textContent
    expect(text).toContain('Your week')
    expect(text).toContain('Logged')
    expect(text).toContain('Days logged in part?')
    expect(host.querySelectorAll('.wk-days [role="switch"], .wk-days .sw, .wk-days input').length).toBeGreaterThan(0)
    expect(host.querySelector('.wk-eq').textContent).toContain('2,000')
    expect(host.querySelector('.wk-eq b').textContent).toBe('1,850')

    act(() => { button('Save check-in').click() })
    const S = useStore.getState().S
    expect(S.cut.kcal).toBe(1850)
    expect(S.cut.changedAt).toBe(todayISO())
    expect(S.checkIns).toHaveLength(1)
    expect(S.checkIns[0]).toMatchObject({ d: todayISO(), kcalFrom: 2000, kcalTo: 1850, decision: 'accept' })
    expect(S.checkIns[0].focus.text).toBeTruthy()
    expect(nav).toHaveBeenCalled()
  })

  it('"Keep as is" saves the check-in without touching the plan', () => {
    useStore.setState(s => ({ S: { ...s.S, ...slowCut() } }))
    act(() => root.render(<WeeklyCheckIn />))
    act(() => { button('Keep as is').click() })
    act(() => { button('Save check-in').click() })
    const S = useStore.getState().S
    expect(S.cut.kcal ?? 2000).toBe(2000)
    expect(S.checkIns[0].decision).toBe('skip')
  })
})
