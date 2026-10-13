// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { addDays } from '../lib/cut.js'
import { todayISO } from '../lib/format.js'
import { OffPlanSheet, PlansCard } from './OffPlan.jsx'

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toasts: [] })
  useStore.setState(s => ({ S: { ...s.S, dailyLog: [], plans: [] } }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

describe('off plan in three taps', () => {
  it('a guess and a trigger log it on the day, counted like any food', () => {
    const close = vi.fn()
    act(() => root.render(<OffPlanSheet date={todayISO()} close={close} />))
    act(() => { button('600').click() })
    act(() => { button('Boredom').click() })
    const e = useStore.getState().S.dailyLog.find(x => x.d === todayISO())
    expect(e.food).toHaveLength(1)
    expect(e.food[0]).toMatchObject({ kcal: 600, off: true, trig: 'bored', src: 'quick' })
    expect(close).toHaveBeenCalled()
  })

  it('asks for the amount before anything is logged', () => {
    act(() => root.render(<OffPlanSheet date={todayISO()} close={() => {}} />))
    act(() => { button('Hunger').click() })
    expect(useStore.getState().S.dailyLog).toEqual([])
  })
})

describe('the plans card', () => {
  it('proposes a plan for a trigger that came back, and keeps it once used', () => {
    const d = addDays(todayISO(), -1)
    const item = (id) => ({ id, meal: 's', name: 'Off plan', src: 'quick', kcal: 500, p: 0, c: 0, f: 0, off: true, trig: 'hunger' })
    useStore.setState(s => ({ S: { ...s.S, dailyLog: [{ d, t: 1, food: [item('a'), item('b')] }], plans: [] } }))
    act(() => root.render(<PlansCard />))
    expect(host.textContent).toContain('Hunger came up 2 times in two weeks.')
    act(() => { button('Use this plan').click() })
    const plans = useStore.getState().S.plans
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ trig: 'hunger', on: true })
    expect(host.querySelector('.ifplan-sug')).toBeNull()
    expect(host.querySelectorAll('.ifplan')).toHaveLength(1)
  })
})
