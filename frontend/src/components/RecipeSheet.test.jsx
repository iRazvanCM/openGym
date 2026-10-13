// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { recipeSheet } from './RecipeSheet.jsx'

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toasts: [] })
  useStore.setState(s => ({ S: { ...s.S, foods: [] } }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const top = () => useUI.getState().sheets.at(-1)
const show = () => act(() => root.render(top().render(() => useUI.getState().closeSheet?.(top().id))))
const type = (input, v) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})

describe('a recipe', () => {
  it('takes picked ingredients and the cooked pot, and is kept with its label per 100 g', () => {
    const picks = [
      { food: { name: 'Chicken breast', id: 'c', per100: { kcal: 110, p: 23, c: 0, f: 1.5 } }, grams: 500, unit: 'g' },
      { food: { name: 'Rice', id: 'r', per100: { kcal: 350, p: 7, c: 77, f: 1 } }, grams: 250, unit: 'g' },
    ]
    const pickIngredient = vi.fn(cb => cb(picks.shift()))
    recipeSheet({ pickIngredient })
    show()
    const add = () => act(() => { [...host.querySelectorAll('button')].find(b => b.textContent.includes('Add an ingredient')).click() })
    add(); add()
    expect(host.querySelectorAll('.recipe-ing')).toHaveLength(2)
    type(host.querySelector('input[aria-label="Name"]'), 'Chicken and rice')
    const cooked = [...host.querySelectorAll('.measure-field')].find(f => f.textContent.includes('Cooked pot')).querySelector('input')
    type(cooked, '1300')
    act(() => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Save recipe').click() })
    const f = useStore.getState().S.foods[0]
    expect(f).toMatchObject({ name: 'Chicken and rice', src: 'recipe', cooked: 1300 })
    expect(f.per100.kcal).toBeCloseTo((550 + 875) / 13, 0)
    expect(f.ingredients.map(i => i.amount)).toEqual([500, 250])
  })
})
