// @vitest-environment happy-dom
// Home's "Add exercise" (components/TodayCard.jsx) starts an empty session and asks the workout
// screen, through useUI.pickOnStart, to open the exercise picker on it — once, and only while the
// ask is fresh: a weigh-in sheet closed without starting must not open it on a later session.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, container

function renderWith(entries, pickOnStart) {
  const S = JSON.parse(JSON.stringify(DEF))
  S.active = { id: 'pick', d: '2026-10-14', start: Date.now(), name: 'Freestyle', bw: null, cur: 0, entries }
  useStore.setState({ S, user: null })
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null, pickOnStart })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('a session started from Home\'s Add exercise', () => {
  it('opens the picker on the empty session, once', () => {
    renderWith([], Date.now())
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(useUI.getState().pickOnStart).toBe(0)
  })

  it('leaves a stale ask, and a session with exercises, alone', () => {
    renderWith([], Date.now() - 5 * 60000)
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useUI.getState().pickOnStart).toBe(0)
    act(() => root.unmount()); container.remove()
    renderWith([{ id: '0025', target: { mode: 'reps', sets: 1, reps: 5 }, sets: [{ w: 60, r: 5, done: false }] }], Date.now())
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('opens nothing on an ordinary session', () => {
    renderWith([], 0)
    expect(useUI.getState().sheets).toHaveLength(0)
  })
})
