// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'
import { bwSheet, startFlow } from '../sheets.jsx'
import TodayCard from './TodayCard.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../sheets.jsx', () => ({ bwSheet: vi.fn(), startFlow: vi.fn() }))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  nav.mockClear(); bwSheet.mockClear(); startFlow.mockClear()
  useUI.setState({ sheets: [], toasts: [], pickOnStart: 0 })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const food = kcal => [{ id: 'a', meal: 'b', name: 'Oats', src: 'quick', kcal, p: 30, c: 60, f: 10 }]
const setS = (over = {}) => useStore.setState(s => ({
  S: { ...s.S, unit: 'kg', routines: [], week: {}, dayPlan: {}, workouts: [], active: null, queue: null, scheduleMode: null,
    cut: { kcal: 2000, protein: 170, fat: 60, start: todayISO() }, dailyLog: [{ d: todayISO(), t: 1, food: food(500) }], ...over },
}))
const mount = () => act(() => root.render(<TodayCard />))
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))

describe('the Today card', () => {
  it('shows what is left of today\'s calories, and the macros against theirs', () => {
    setS(); mount()
    expect(host.querySelector('.tday-ring-m').textContent).toBe('1,500kcal left')
    expect(host.textContent).toContain('Goal2,000')
    expect(host.textContent).toContain('Eaten500')
    expect(host.textContent).toContain('Protein30 / 170 g')
    act(() => { host.querySelector('.tday-top').click() })
    expect(nav).toHaveBeenCalledWith('/food')
  })

  it('says it when the day went over', () => {
    setS({ dailyLog: [{ d: todayISO(), t: 1, food: food(2300) }] }); mount()
    expect(host.querySelector('.tday-ring').classList.contains('over')).toBe(true)
    expect(host.querySelector('.tday-ring-m').textContent).toBe('300kcal over')
  })

  it('nothing planned: Add exercise starts an empty session with the picker asked for', () => {
    setS(); mount()
    act(() => { button('Add exercise').click() })
    expect(startFlow).toHaveBeenCalledWith([])
    expect(useUI.getState().pickOnStart).toBeGreaterThan(0)
  })

  it('a routine today: the button starts it; a session running: it resumes', () => {
    const wd = new Date(todayISO() + 'T12:00:00').getDay()
    setS({ routines: [{ id: 'r1', name: 'Push', ex: [] }], week: { [wd]: ['r1'] } }); mount()
    act(() => { button('Start Push').click() })
    expect(startFlow).toHaveBeenCalledWith(['r1'])
    act(() => { setS({ active: { id: 'a', name: 'Push', start: Date.now(), cur: 0, entries: [] } }) })
    act(() => { button('Resume workout').click() })
    expect(nav).toHaveBeenCalledWith('/workout')
  })

  it('adds food and logs the weight in one tap', () => {
    setS(); mount()
    act(() => { button('Add food').click() })
    expect(useUI.getState().sheets).toHaveLength(1)
    act(() => { button('Log weight').click() })
    expect(bwSheet).toHaveBeenCalled()
  })

  it('with no plan yet, asks for one instead of counting against defaults', () => {
    setS({ cut: null }); mount()
    expect(host.querySelector('.tday-ring')).toBeNull()
    act(() => { host.querySelector('.tday-setup').click() })
    expect(nav).toHaveBeenCalledWith('/setup')
    expect(button('Add food')).toBeTruthy()
  })
})
