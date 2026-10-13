// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { cutOf } from '../lib/cut.js'
import { todayISO } from '../lib/format.js'
import Onboarding from './Onboarding.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  nav.mockClear()
  window.scrollTo = vi.fn()
  useUI.setState({ sheets: [], toasts: [] })
  useStore.setState(s => ({ S: { ...s.S, unit: 'kg', bodyweight: [], dailyLog: [], workouts: [], measurements: [], cut: null, profile: null, targetW: null, onboarded: null } }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text))
const click = text => { const b = button(text); expect(b, text).toBeTruthy(); act(() => { b.click() }) }
const type = value => {
  const el = host.querySelector('.onb-num input')
  act(() => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, String(value))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const step = () => host.querySelector('.onb').dataset.step

describe('the first-run questions', () => {
  it('asks one thing a screen, says where the weight stands and works the calories out', () => {
    act(() => root.render(<Onboarding />))
    expect(step()).toBe('welcome')
    click('Get started')

    expect(step()).toBe('sex')
    click('Male')
    expect(step()).toBe('age')
    expect(button('Continue').disabled).toBe(true)
    type(16)
    expect(host.textContent).toContain('the numbers here are for adults')
    expect(button('Continue').disabled).toBe(true)
    type(32)
    click('Continue')
    type(174)
    click('Continue')
    expect(step()).toBe('weight')
    type(106)
    click('Continue')
    expect(step()).toBe('activity')
    click('Very active')

    expect(step()).toBe('verdict')
    expect(host.querySelector('.onb-bmi-n').textContent).toBe('35.0')
    expect(host.textContent).toContain('Obesity, class II')
    expect(host.textContent).toContain('A healthy weight for 174 cm: 56–75.4 kg')
    click('Continue')

    expect(step()).toBe('goal')
    expect(button('Lose weight').textContent).toContain('Recommended')
    click('Lose weight')

    expect(step()).toBe('target')
    expect(host.querySelector('.onb-num input').value).toBe('90')
    type(85)
    // the recommended pace, a kilo a week at 106 kg, is chosen already
    expect(host.querySelector('.onb-opt.on').textContent).toContain('1.0 kg a week')
    expect(host.querySelector('.onb-opt.on').textContent).toContain('Recommended')
    click('Continue')

    expect(step()).toBe('plan')
    expect(host.querySelector('.onb-kcal b').textContent).toBe('2,090')
    expect(host.textContent).toContain('3,190 kcal keeps your weight; 1,100 less a day takes off about 1.0 kg a week.')
    expect(host.querySelector('.onb-macros').textContent).toContain('170 g')
    click('Start')

    const S = useStore.getState().S
    expect(S.onboarded).toBeGreaterThan(0)
    expect(S.profile).toMatchObject({ sex: 'm', heightCm: 174, activity: 'high' })
    expect(S.targetW).toBe(85)
    expect(S.bodyweight.at(-1)).toMatchObject({ d: todayISO(), w: 106 })
    expect(cutOf(S)).toMatchObject({ mode: 'cut', start: todayISO(), kcal: 2090, protein: 170, rateMin: 0.8, rateMax: 1.2 })
    expect(nav).toHaveBeenCalledWith('/home', { replace: true })
  })

  it('keeps the weight: no goal weight to ask, maintenance as the calories', () => {
    useStore.setState(s => ({ S: { ...s.S, profile: { sex: 'f', born: Number(todayISO().slice(0, 4)) - 30, heightCm: 165, activity: 'moderate' }, bodyweight: [{ d: '2026-01-01', w: 60, t: 1 }] } }))
    act(() => root.render(<Onboarding redo />))
    // what the app knew is filled in: Continue all the way to the verdict
    expect(step()).toBe('sex')
    for (let i = 0; i < 5; i++) click('Continue')
    expect(step()).toBe('verdict')
    expect(host.textContent).toContain('Healthy weight')
    click('Continue')
    expect(button('Keep my weight').textContent).toContain('Recommended')
    click('Keep my weight')
    expect(step()).toBe('plan')
    click('Start')
    const c = cutOf(useStore.getState().S)
    expect(c).toMatchObject({ mode: 'maintain', endW: 60 })
    expect(c.kcal).toBe(c.maintenance)
    expect(nav).toHaveBeenCalledWith('/progress', { replace: true })
  })

  it('will not plan a loss under a healthy weight', () => {
    useStore.setState(s => ({ S: { ...s.S, profile: { sex: 'f', born: 1990, heightCm: 170, activity: 'light' }, bodyweight: [{ d: '2026-01-01', w: 50, t: 1 }] } }))
    act(() => root.render(<Onboarding redo />))
    for (let i = 0; i < 5; i++) click('Continue')
    expect(host.textContent).toContain('Underweight')
    click('Continue')
    expect(button('Lose weight').disabled).toBe(true)
    expect(button('Gain weight').textContent).toContain('Recommended')
    click('Gain weight')
    expect(step()).toBe('target')
    type(49)
    expect(host.textContent).toContain('Above your weight now')
    expect(button('Continue').disabled).toBe(true)
    type(56)
    click('Continue')
    expect(host.querySelector('.onb-eq').textContent).toContain('more a day puts on about')
    click('Start')
    expect(cutOf(useStore.getState().S)).toMatchObject({ mode: 'gain', rateMin: 0.2, rateMax: 0.3 })
  })

  it('a cut already planned for a day to come keeps that day', () => {
    useStore.setState(s => ({ S: { ...s.S, profile: { sex: 'm', born: 1994, heightCm: 174, activity: 'high' }, bodyweight: [{ d: todayISO(), w: 106, t: 1 }], targetW: 85, cut: { start: '2099-11-02', kcal: 2000 } } }))
    act(() => root.render(<Onboarding redo />))
    for (let i = 0; i < 6; i++) click('Continue')
    click('Lose weight')
    expect(host.querySelector('.onb-num input').value).toBe('85')
    expect(host.querySelector('input[type="date"]').value).toBe('2099-11-02')
    click('Continue')
    click('Save the plan')
    expect(cutOf(useStore.getState().S).start).toBe('2099-11-02')
  })

  it('can be skipped, and asks nothing again', () => {
    act(() => root.render(<Onboarding />))
    click('Skip for now')
    expect(useStore.getState().S.onboarded).toBeGreaterThan(0)
    expect(useStore.getState().S.cut).toBeNull()
    expect(nav).toHaveBeenCalledWith('/home', { replace: true })
  })
})
