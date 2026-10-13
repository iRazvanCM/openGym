// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { addDays } from '../lib/cut.js'
import { todayISO } from '../lib/format.js'
import Progress from './Progress.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toasts: [] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

function cut(days) {
  const today = todayISO(), start = addDays(today, -(days - 1))
  const bodyweight = [], dailyLog = [], workouts = []
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i), at = new Date(d + 'T07:00:00').getTime()
    bodyweight.push({ d, w: Math.round((106 - i / 7 - 1.2 * (1 - Math.exp(-i / 3)) + (i % 3 - 1) * 0.3) * 10) / 10, t: at })
    dailyLog.push({ d, t: at, kcal: 1950 + (i % 4) * 30, protein: 172, steps: 10500, sleep: 7.4, alcohol: false, energy: 3, hunger: 3 })
    if (i % 7 !== 6) workouts.push({ id: 'w' + i, d, name: 'Session', start: at + 3.6e7, end: at + 4e7, entries: [{ id: '0025', sets: [{ w: 100 - (i > 20 ? 1 : 0), r: 5, done: true }] }, { id: 'cardio', sets: [{ min: 45, speed: 6, done: true }] }] })
  }
  return { start, bodyweight, dailyLog, workouts }
}

describe('Progress', () => {
  it('offers to start a cut on an empty profile, and starts it today', () => {
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', bodyweight: [], dailyLog: [], workouts: [], measurements: [], cut: null, targetW: null } }))
    act(() => root.render(<Progress />))
    expect(host.textContent).toContain('Start your cut')
    act(() => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Start today with these targets').click() })
    expect(useStore.getState().S.cut.start).toBe(todayISO())
  })

  it('shows a cut five weeks in: trend, verdict, the week, strength and the record', () => {
    const c = cut(35)
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', targetW: 85, measurements: [], cut: { start: c.start }, bodyweight: c.bodyweight, dailyLog: c.dailyLog, workouts: c.workouts } }))
    act(() => root.render(<Progress />))
    const text = host.textContent
    expect(text).toContain('Cut · week 5 · day 35')
    expect(text).toContain('Trend weight')
    expect(text).toContain('On track')
    expect(text).toContain('Maintenance')
    expect(text).toContain('Strength check')
    expect(text).toContain('Holding')
    // 35 days touch five or six calendar weeks, depending on the weekday they start on
    expect([5, 6]).toContain(host.querySelectorAll('.cut-wk').length)
    expect(host.querySelectorAll('.cut-day').length).toBe(14)
    expect(host.querySelector('.cut-bar')).toBeTruthy()
  })

  it('in a diet break: the plan stands still, the trend is measured against the day before it', () => {
    const c = cut(45)
    const from = addDays(todayISO(), -4)
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', targetW: 85, measurements: [], cut: { start: c.start, breaks: [{ from, to: addDays(todayISO(), 5) }] }, bodyweight: c.bodyweight, dailyLog: c.dailyLog, workouts: c.workouts } }))
    act(() => root.render(<Progress />))
    const text = host.textContent
    expect(text).toContain('Diet break')
    expect(text).toContain('Aim over the break: the trend at most +0.5 kg')
    expect(host.querySelector('.cut-break')).toBeTruthy()
    expect(text).toContain('trend since')
  })

  it('in the week back: the water week, with no pace advice', () => {
    const c = cut(45)
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', targetW: 85, measurements: [], cut: { start: c.start, breaks: [{ from: addDays(todayISO(), -12), to: addDays(todayISO(), -3) }] }, bodyweight: c.bodyweight, dailyLog: c.dailyLog, workouts: c.workouts } }))
    act(() => root.render(<Progress />))
    expect(host.textContent).toContain('Water week')
    expect(host.textContent).toContain('The break, all told')
    expect(host.textContent).toMatch(/held from .* over the break/)
  })
})
