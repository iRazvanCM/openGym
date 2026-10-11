// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { addDays } from '../lib/cut.js'
import { todayISO } from '../lib/format.js'
import { DailyLogSheet } from './DailyLog.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toasts: [] })
  useStore.setState(s => ({ S: { ...s.S, unit: 'kg', bodyweight: [], dailyLog: [], measurements: [], workouts: [], cut: null, active: null } }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const field = label => [...host.querySelectorAll('.measure-field')].find(f => f.querySelector('span').textContent.startsWith(label)).querySelector('input')
const type = (label, v) => act(() => {
  const input = field(label)
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const click = text => act(() => { [...host.querySelectorAll('button')].find(b => b.textContent === text).click() })

describe('the daily log sheet', () => {
  it('saves the day to the log, the weight to the weigh-ins and the waist to the measurements', () => {
    const close = vi.fn()
    act(() => root.render(<DailyLogSheet initial={todayISO()} close={close} />))
    type('Weight', '105.4'); type('Waist', '112'); type('Calories', '1950'); type('Protein', '180')
    type('Steps', '11250'); type('Cardio', '45'); type('Sleep', '7,5')
    click('Save')
    const S = useStore.getState().S
    expect(S.dailyLog).toHaveLength(1)
    expect(S.dailyLog[0]).toMatchObject({ d: todayISO(), kcal: 1950, protein: 180, steps: 11250, cardio: 45, sleep: 7.5, alcohol: false })
    expect(S.bodyweight).toEqual([expect.objectContaining({ d: todayISO(), w: 105.4 })])
    expect(S.measurements.find(m => m.d === todayISO()).waist).toBe(112)
    expect(close).toHaveBeenCalled()
  })

  it('opens a past day with its own numbers and leaves an untouched weigh-in alone', () => {
    const d = addDays(todayISO(), -3)
    useStore.setState(s => ({ S: { ...s.S, bodyweight: [{ d, w: 104, t: 123 }], dailyLog: [{ d, t: 5, kcal: 2100, alcohol: true }] } }))
    act(() => root.render(<DailyLogSheet initial={d} close={() => {}} />))
    expect(field('Calories').value).toBe('2100')
    expect(field('Weight').value).toBe('104')
    type('Calories', '1990')
    click('Save')
    const S = useStore.getState().S
    expect(S.dailyLog[0]).toMatchObject({ d, kcal: 1990, alcohol: true })
    expect(S.bodyweight[0].t).toBe(123)
  })

  it('reads a workout\'s cardio and training without storing them twice', () => {
    const d = todayISO()
    const at = new Date(d + 'T18:00:00').getTime()
    useStore.setState(s => ({ S: { ...s.S, workouts: [{ id: 'w1', d, name: 'Push', start: at, end: at + 3600000, entries: [{ id: '0025', sets: [{ min: 40, speed: 6, done: true }] }] }] } }))
    act(() => root.render(<DailyLogSheet initial={d} close={() => {}} />))
    expect(field('Cardio').value).toBe('40')
    expect(host.textContent).toContain('Logged: Push')
    type('Calories', '2000')
    click('Save')
    const e = useStore.getState().S.dailyLog[0]
    expect(e.cardio).toBeNull()
    expect(e.gym).toBeNull()
  })
})
