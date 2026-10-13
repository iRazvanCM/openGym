// A recipe: the ingredients weighed raw, the cooked pot weighed once, and the dish kept with its
// numbers per 100 g of what came out (lib/food.js recipeNumbers). A stew, a soup, a tray of
// chicken and rice: cooked once, logged by the plate for days. It is a food of one's own (S.foods),
// so it is found, logged and edited like one.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { normalizeIngredient, portion, recipeNumbers, saveMyFood } from '../lib/food.js'
import Icon from './Icon.jsx'
import { Button, NumberField, TextField } from './ui.jsx'

const toast = m => useUI.getState().toast(m)
const fmt = n => (n == null ? '–' : (Math.round(n * 10) / 10).toLocaleString())
const fmtK = n => (n == null ? '–' : Math.round(n).toLocaleString())

function Recipe({ food, close, onSaved, pickIngredient }) {
  const [name, setName] = useState(food?.name || '')
  const [items, setItems] = useState(() => (food?.ingredients || []).map(normalizeIngredient).filter(Boolean))
  const [cooked, setCooked] = useState(food?.cooked ?? null)
  const nums = recipeNumbers(items, cooked)

  const add = () => pickIngredient(picked => {
    const ing = normalizeIngredient({ name: picked.food.name, ref: picked.food.ref || picked.food.id || '', code: picked.food.code || '', unit: picked.unit, amount: picked.grams, per100: picked.food.per100 })
    if (ing) setItems(list => [...list, ing])
  })
  const setAmount = (i, v) => setItems(list => list.map((x, j) => (j === i ? { ...x, amount: v || 0 } : x)))
  const remove = i => setItems(list => list.filter((_, j) => j !== i))

  const save = () => {
    const clean = items.map(normalizeIngredient).filter(Boolean)
    if (!name.trim()) { toast(t('Give the recipe a name')); return }
    const r = recipeNumbers(clean, cooked)
    if (!r?.per100) { toast(t('Add the ingredients, with their raw weights')); return }
    let kept = null
    useStore.getState().update(s => {
      kept = saveMyFood(s, { ...(food ? { id: food.id, at: food.at } : {}), name: name.trim(), src: 'recipe', unit: 'g', per100: r.per100, ingredients: clean, ...(cooked > 0 ? { cooked } : {}) })
    })
    toast(food ? t('Recipe saved') : t('Recipe added to My foods'))
    close()
    if (kept) onSaved?.(kept)
  }
  const del = () => {
    const old = food
    useStore.getState().update(s => { s.foods = (s.foods || []).filter(f => f.id !== old.id) })
    toast(t('Recipe removed'))
    close()
  }

  return <>
    <h3 style={{ marginBottom: 4 }}>{food ? t('Edit recipe') : t('New recipe')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>{t('Weigh every ingredient raw, then the cooked pot (weigh the empty pot once and take it off). Each plate is then logged by its grams.')}</div>
    <TextField value={name} maxLength={120} placeholder={t('Name, e.g. Chicken stew')} aria-label={t('Name')} onChange={e => setName(e.target.value)} />

    <span className="sect-t" style={{ marginTop: 14 }}>{t('Ingredients, raw')}</span>
    <div className="sect-b recipe-list">
      {items.map((x, i) => <div className="lrow recipe-ing" key={i}>
        <span className="lrow-m"><span className="lrow-t">{x.name}</span><span className="lrow-s">{t('{0} kcal', fmtK(portion(x.per100, x.amount).kcal))} · {t('P {0}', fmt(portion(x.per100, x.amount).p))}</span></span>
        <label className="measure-input recipe-amt"><NumberField decimal value={x.amount} onChange={v => setAmount(i, v)} aria-label={t('Amount')} /><i>{x.unit}</i></label>
        <button className="iconbtn" onClick={() => remove(i)} aria-label={t('Remove')}><Icon name="xmark" /></button>
      </div>)}
      <button className="food-add" onClick={add}><Icon name="plus" />{t('Add an ingredient')}</button>
    </div>

    <label className="measure-field" style={{ marginTop: 18 }}>
      <span>{t('Cooked pot')}{nums && <i className="dl-hint"> · {t('raw {0} g', fmt(nums.raw))}</i>}</span>
      <span className="measure-input"><NumberField nullable decimal value={cooked} onChange={setCooked} /><i>g</i></span>
    </label>
    <div className="muted small" style={{ margin: '6px 2px 0', lineHeight: 1.45 }}>{t('Left empty, the raw weight is used — right for a salad, too low for anything that drank water.')}</div>

    {nums && <div className="food-tot recipe-tot" aria-live="polite">
      <div><b>{fmtK(nums.per100.kcal)}</b><span>{t('kcal / 100 g')}</span></div>
      <div><b>{fmt(nums.per100.p)}</b><span>{t('protein')}</span></div>
      <div><b>{fmt(nums.per100.c)}</b><span>{t('carbs')}</span></div>
      <div><b>{fmt(nums.per100.f)}</b><span>{t('fat')}</span></div>
    </div>}
    {nums && <div className="small dim" style={{ margin: '-6px 2px 14px' }}>{t('The whole pot: {0} kcal, {1} g protein', fmtK(nums.total.kcal), fmt(nums.total.p))}</div>}

    <Button variant="primary" onClick={save}>{t('Save recipe')}</Button>
    {food && <><div style={{ height: 6 }} /><Button variant="ghost" className="danger-text" icon="trash" onClick={del}>{t('Delete recipe')}</Button></>}
  </>
}

/** The recipe editor: a new one, or `food` (a kept recipe) to change. */
export function recipeSheet({ food = null, onSaved, pickIngredient }) {
  return useUI.getState().openSheet(close => <Recipe food={food} close={close} onSaved={onSaved} pickIngredient={pickIngredient} />)
}
