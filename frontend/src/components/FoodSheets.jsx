// The food diary's sheets: finding a food, the portion, a food of one's own, a quick add.
//
// Finding a food: what was eaten lately, the foods kept (S.foods), the everyday foods built in
// (lib/food-basics.js) — all on the phone, filtered as you type — and, on the Search key, Open
// Food Facts (lib/off.js). A barcode is scanned in the app or typed into the search field; a
// product already kept answers at once, anything else is looked up, and a code OFF does not know
// opens the food form with the code filled in, so a product is typed in once and scanned ever after.
//
// The portion opens at 100 g (100 ml for a drink) — the amount a label is written for — with
// the amount selected to type over and the totals following every digit. g, ml and servings
// switch in place; the last amount eaten, one serving and the whole pack are a tap.
//
// Nothing here imports sheets.jsx: Home renders the diary's card and its tests mock that module.
import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import {
  MEALS, MEAL_NAMES, addFoodItem, cleanPer100, foodFor, foodLang, lastPortionOf, myFoodByCode, normalizeFood,
  portion, recentFoods, removeFoodItem, saveMyFood, searchLocal, updateFoodItem,
} from '../lib/food.js'
import { cleanCode, offProduct, offSearch } from '../lib/off.js'
import { MOBILE } from '../lib/mobile.js'
import { todayISO } from '../lib/format.js'
import { t, dateLocale, getLang } from '../lib/i18n.js'
import { useSheetKeyboard } from '../lib/use-sheet-keyboard.js'
import Icon from './Icon.jsx'
import { Button, NumberField, SearchField, Segmented, TextField } from './ui.jsx'

const ui = () => useUI.getState()
const toast = (m, o) => ui().toast(m, o)
const update = fn => useStore.getState().update(fn)
const lang = () => foodLang(getLang())

export const mealName = m => t(MEAL_NAMES[m] || MEAL_NAMES.s)
/** An amount: whole numbers as they are, anything else to one decimal. */
export const fmtAmt = n => (n == null ? '–' : (Math.round(n * 10) / 10).toLocaleString(dateLocale()))
export const fmtKcal = n => (n == null ? '–' : Math.round(n).toLocaleString(dateLocale()))
const macroLine = x => t('P {0} · C {1} · F {2}', fmtAmt(x.p), fmtAmt(x.c), fmtAmt(x.f))

/** What a diary item says under its name: brand, amount (and servings), macros. */
export function itemLine(it) {
  const parts = []
  if (it.brand) parts.push(it.brand)
  if (it.amount != null) parts.push(it.sv ? `${fmtAmt(it.sv)} × ${t('serving')} · ${fmtAmt(it.amount)} ${it.unit}` : `${fmtAmt(it.amount)} ${it.unit}`)
  parts.push(macroLine(it))
  return parts.join(' · ')
}

export function offMessage(e) {
  if (e?.code === 'offline') return t('No connection. Your own foods and the everyday list still work.')
  if (e?.code === 'rate') return t('Open Food Facts is busy. Try again in a minute.')
  return t('Open Food Facts did not answer. Try again.')
}

function MealChips({ value, onChange }) {
  return <div className="food-meals" role="radiogroup" aria-label={t('Meal')}>
    {MEALS.map(m => <button key={m} role="radio" aria-checked={value === m} className={'chip nocap' + (value === m ? ' on' : '')} onClick={() => onChange(m)}>{mealName(m)}</button>)}
  </div>
}

/* ================================================================ portion == */

function Portion({ date, meal: meal0, food, item, last, close, onDone }) {
  const base = food.unit === 'ml' ? 'ml' : 'g'
  const serving = food.serving?.amount > 0 ? food.serving : null
  const [mode, setMode] = useState(() => (item ? (item.sv && serving ? 'sv' : item.unit === 'ml' ? 'ml' : 'g') : base))
  const [n, setN] = useState(() => (item ? (item.sv && serving ? item.sv : item.amount) : 100))
  const [meal, setMeal] = useState(item?.meal || meal0)
  const grams = mode === 'sv' ? (n || 0) * serving.amount : (n || 0)
  const tot = portion(food.per100, grams)
  const shownUnit = mode === 'sv' ? base : mode

  const setPortion = (m, v) => { setMode(m); setN(v) }
  const switchMode = m => {
    if (m === mode) return
    if (m === 'sv') setN(grams > 0 && grams !== 100 ? Math.round(grams / serving.amount * 100) / 100 : 1)
    else if (mode === 'sv') setN(Math.round(grams * 10) / 10)
    setMode(m)
  }

  // "1 egg (50 g)", "15 g", "1 serving (30 g)": the label, and the grams unless it says them already
  const svText = !serving ? '' : serving.label
    ? (serving.label.includes(fmtAmt(serving.amount)) ? serving.label : `${serving.label} (${fmtAmt(serving.amount)} ${base})`)
    : `${t('1 serving')} (${fmtAmt(serving.amount)} ${base})`
  const chips = [{ key: '100', label: `100 ${base}`, on: mode !== 'sv' && n === 100, apply: () => setPortion(base, 100) }]
  if (serving) chips.push({ key: 'sv', label: svText, on: mode === 'sv' && n === 1, apply: () => setPortion('sv', 1) })
  if (food.pack && food.pack !== 100) chips.push({ key: 'pack', label: t('Whole pack ({0})', `${fmtAmt(food.pack)} ${base}`), on: mode !== 'sv' && n === food.pack, apply: () => setPortion(base, food.pack) })
  if (last?.amount > 0 && !item) {
    const asSv = last.sv && serving
    chips.unshift({
      key: 'last', label: t('Like last time ({0})', asSv ? `${fmtAmt(last.sv)} × ${t('serving')}` : `${fmtAmt(last.amount)} ${last.unit || base}`),
      on: asSv ? mode === 'sv' && n === last.sv : mode !== 'sv' && n === last.amount,
      apply: () => (asSv ? setPortion('sv', last.sv) : setPortion(last.unit === 'ml' ? 'ml' : 'g', last.amount)),
    })
  }

  const save = () => {
    if (!(grams > 0) || grams > 10000) { toast(t('Enter an amount')); return }
    const sv = mode === 'sv' ? n : null
    update(s => {
      if (item) { updateFoodItem(s, date, item.id, { meal, amount: grams, unit: shownUnit, sv }); return }
      // a product from Open Food Facts is kept, so the next scan needs no connection
      if (food.src === 'off') saveMyFood(s, food)
      addFoodItem(s, date, {
        meal, name: food.name, brand: food.brand || '', code: food.code || '',
        src: food.src === 'basic' ? 'basic' : food.src === 'off' ? 'off' : 'custom', ref: food.ref || food.id || '',
        unit: shownUnit, amount: grams, sv, per100: food.per100,
      })
    })
    toast(item ? t('Saved') : t('Added to {0}', mealName(meal)))
    close()
    onDone?.()
  }

  const remove = () => {
    const old = item
    update(s => { removeFoodItem(s, date, old.id) })
    toast(t('Removed'), { action: t('Undo'), onAction: () => update(s => { addFoodItem(s, date, old) }) })
    close()
    onDone?.()
  }

  const units = [{ value: 'g', label: 'g' }, { value: 'ml', label: 'ml' }]
  if (serving) units.push({ value: 'sv', label: t('serving') })

  return <>
    <h3 style={{ marginBottom: 2 }}>{food.name}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {food.brand ? food.brand + ' · ' : ''}{t('{0} kcal per 100 {1}', fmtKcal(food.per100.kcal), base)} · {macroLine(food.per100)}
    </div>

    <div className="food-amt">
      <label className="measure-input food-amt-in">
        <NumberField decimal value={n} onChange={setN} aria-label={t('Amount')} />
        <i>{mode === 'sv' ? '× ' + (serving.label || t('serving')) : mode}</i>
      </label>
      <Segmented className="food-units" options={units} value={mode} onChange={switchMode} />
    </div>
    {mode === 'sv' && <div className="dim small" style={{ margin: '6px 2px 0' }}>{t('= {0} {1}', fmtAmt(grams), base)}</div>}
    {mode !== base && mode !== 'sv' && <div className="dim small" style={{ margin: '6px 2px 0' }}>{t('Counted as 1 ml = 1 g.')}</div>}

    <div className="food-quick">
      {chips.map(c => <button key={c.key} className={'chip nocap' + (c.on ? ' on' : '')} onClick={c.apply}>{c.label}</button>)}
    </div>

    <div className="food-tot" aria-live="polite">
      <div><b>{fmtKcal(tot.kcal)}</b><span>kcal</span></div>
      <div><b>{fmtAmt(tot.p)}</b><span>{t('protein')}</span></div>
      <div><b>{fmtAmt(tot.c)}</b><span>{t('carbs')}</span></div>
      <div><b>{fmtAmt(tot.f)}</b><span>{t('fat')}</span></div>
    </div>

    <MealChips value={meal} onChange={setMeal} />

    <Button variant="primary" onClick={save}>{item ? t('Save') : t('Add to {0}', mealName(meal))}</Button>
    {item && <><div style={{ height: 6 }} /><Button variant="ghost" className="danger-text" icon="trash" onClick={remove}>{t('Remove from the diary')}</Button></>}
  </>
}

/** The portion screen for a food — a new item for `meal`, or `item` to change. */
export function portionSheet({ date, meal, food, item = null, last = null, onDone }) {
  return ui().openSheet(close => <Portion date={date} meal={meal} food={food} item={item} last={last} close={close} onDone={onDone} />)
}

/* ============================================================ own food == */

function FoodForm({ food, code: code0 = '', name: name0 = '', brand: brand0 = '', note, close, onSaved }) {
  const editing = !!food
  const [v, setV] = useState(() => ({
    name: food?.name || name0, brand: food?.brand || brand0, code: food?.code || code0, unit: food?.unit || 'g',
    kcal: food?.per100?.kcal ?? null, p: food?.per100?.p ?? null, c: food?.per100?.c ?? null, f: food?.per100?.f ?? null,
    svAmount: food?.serving?.amount ?? null, svLabel: food?.serving?.label || '',
  }))
  const set = (k, val) => setV(x => ({ ...x, [k]: val }))
  const per = v.unit === 'ml' ? '100 ml' : '100 g'

  const save = () => {
    const name = v.name.trim()
    if (!name) { toast(t('Give the food a name')); return }
    const per100 = cleanPer100({ kcal: v.kcal, p: v.p, c: v.c, f: v.f })
    if (!per100) { toast(t('Enter the calories or the macros per {0}', per)); return }
    const raw = {
      ...(food ? { id: food.id, at: food.at } : {}), name, brand: v.brand, code: cleanCode(v.code), unit: v.unit, per100,
      src: food?.src === 'off' ? 'off' : 'custom',
      ...(v.svAmount > 0 ? { serving: { amount: v.svAmount, label: v.svLabel.trim() } } : {}),
      ...(food?.pack ? { pack: food.pack } : {}),
    }
    if (!normalizeFood(raw)) { toast(t('Check the numbers')); return }
    let kept = null
    update(s => { kept = saveMyFood(s, raw) })
    toast(editing ? t('Food saved') : t('Food added to My foods'))
    close()
    if (kept) onSaved?.(kept)
  }

  const remove = () => {
    const old = food
    update(s => { s.foods = (s.foods || []).filter(f => f.id !== old.id) })
    toast(t('Food removed'), { action: t('Undo'), onAction: () => update(s => { saveMyFood(s, old) }) })
    close()
  }

  const num = (key, label, u, decimal = true) => <label className="measure-field" key={key}>
    <span>{label}</span>
    <span className="measure-input"><NumberField nullable decimal={decimal} value={v[key]} onChange={val => set(key, val)} />{u && <i>{u}</i>}</span>
  </label>

  return <>
    <h3 style={{ marginBottom: 4 }}>{editing ? t('Edit food') : t('New food')}</h3>
    {note && <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>{note}</div>}
    <div className="food-form">
      <TextField value={v.name} maxLength={120} placeholder={t('Name')} aria-label={t('Name')} onChange={e => set('name', e.target.value)} />
      <TextField value={v.brand} maxLength={80} placeholder={t('Brand (optional)')} aria-label={t('Brand')} onChange={e => set('brand', e.target.value)} />
      <TextField value={v.code} inputMode="numeric" maxLength={20} placeholder={t('Barcode (optional)')} aria-label={t('Barcode')} onChange={e => set('code', e.target.value)} />
    </div>
    <div className="row between" style={{ margin: '14px 2px 8px', gap: 10 }}>
      <span className="muted small">{t('From the label, per {0}', per)}</span>
      <Segmented className="food-units sm" options={[{ value: 'g', label: 'g' }, { value: 'ml', label: 'ml' }]} value={v.unit} onChange={u => set('unit', u)} />
    </div>
    <div className="measure-form">
      {num('kcal', t('Calories'), 'kcal', false)}
      {num('p', t('Protein'), 'g')}
      {num('c', t('Carbs'), 'g')}
      {num('f', t('Fat'), 'g')}
    </div>
    <div className="muted small" style={{ margin: '14px 2px 8px' }}>{t('A serving (optional)')}</div>
    <div className="measure-form">
      {num('svAmount', t('Size'), v.unit)}
      <label className="measure-field"><span>{t('Called')}</span>
        <span className="measure-input"><input className="num food-txt" value={v.svLabel} maxLength={40} placeholder={t('1 slice')} onChange={e => set('svLabel', e.target.value)} /></span></label>
    </div>
    <div style={{ height: 16 }} />
    <Button variant="primary" onClick={save}>{editing ? t('Save') : onSaved ? t('Save and add') : t('Save')}</Button>
    {editing && <><div style={{ height: 6 }} /><Button variant="ghost" className="danger-text" icon="trash" onClick={remove}>{t('Delete this food')}</Button></>}
  </>
}

/** The form for a food of one's own, or to change one kept in S.foods (`food`). */
export function foodFormSheet(opts = {}) {
  return ui().openSheet(close => <FoodForm {...opts} close={close} />)
}

/* =========================================================== quick add == */

function QuickAdd({ date, meal: meal0, item, close }) {
  const [v, setV] = useState(() => ({ name: item?.name || '', kcal: item?.kcal ?? null, p: item?.p || null, c: item?.c || null, f: item?.f || null }))
  const [meal, setMeal] = useState(item?.meal || meal0)
  const set = (k, val) => setV(x => ({ ...x, [k]: val }))
  const save = () => {
    if (!(v.kcal > 0) && !(v.p > 0) && !(v.c > 0) && !(v.f > 0)) { toast(t('Enter the calories')); return }
    const raw = { meal, name: v.name.trim() || t('Quick add'), src: 'quick', kcal: v.kcal, p: v.p, c: v.c, f: v.f }
    update(s => { if (item) updateFoodItem(s, date, item.id, raw); else addFoodItem(s, date, raw) })
    toast(item ? t('Saved') : t('Added to {0}', mealName(meal)))
    close()
  }
  const remove = () => {
    const old = item
    update(s => { removeFoodItem(s, date, old.id) })
    toast(t('Removed'), { action: t('Undo'), onAction: () => update(s => { addFoodItem(s, date, old) }) })
    close()
  }
  const num = (key, label, u, decimal = true) => <label className="measure-field" key={key}>
    <span>{label}</span>
    <span className="measure-input"><NumberField nullable decimal={decimal} value={v[key]} onChange={val => set(key, val)} />{u && <i>{u}</i>}</span>
  </label>
  return <>
    <h3 style={{ marginBottom: 4 }}>{t('Quick add')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('For a meal out or anything not worth weighing: just the numbers.')}</div>
    <TextField value={v.name} maxLength={120} placeholder={t('What was it? (optional)')} aria-label={t('Name')} onChange={e => set('name', e.target.value)} />
    <div style={{ height: 10 }} />
    <div className="measure-form">
      {num('kcal', t('Calories'), 'kcal', false)}
      {num('p', t('Protein'), 'g')}
      {num('c', t('Carbs'), 'g')}
      {num('f', t('Fat'), 'g')}
    </div>
    <MealChips value={meal} onChange={setMeal} />
    <Button variant="primary" onClick={save}>{item ? t('Save') : t('Add to {0}', mealName(meal))}</Button>
    {item && <><div style={{ height: 6 }} /><Button variant="ghost" className="danger-text" icon="trash" onClick={remove}>{t('Remove from the diary')}</Button></>}
  </>
}

export function quickAddSheet({ date, meal, item = null }) {
  return ui().openSheet(close => <QuickAdd date={date} meal={meal} item={item} close={close} />)
}

/** Opens the right sheet for a diary item: its portion, or the quick add it was. */
export function editFoodItem(S, date, item) {
  if (!item.per100) return quickAddSheet({ date, meal: item.meal, item })
  const food = foodFor(S, item, lang()) || { name: item.name, brand: item.brand, code: item.code, unit: item.unit, per100: item.per100, src: item.src, ref: item.ref }
  // the item's own label: a kept food changed since must not change what this portion was
  return portionSheet({ date, meal: item.meal, food: { ...food, name: item.name || food.name, per100: item.per100 }, item })
}

/* ========================================================= finding food == */

function FoodRow({ food, sub, kcal, onClick, onEdit }) {
  return <div className="lrow tap food-row" role="button" tabIndex={0} onClick={onClick}
    onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick() } }}>
    <span className="lrow-m"><span className="lrow-t food-row-n">{food.name}</span><span className="lrow-s">{sub}</span></span>
    {kcal != null && <span className="food-row-k">{fmtKcal(kcal)}<i>kcal</i></span>}
    {onEdit && <button className="iconbtn food-row-e" onClick={e => { e.stopPropagation(); onEdit() }} aria-label={t('Edit food')}><Icon name="pencil" /></button>}
  </div>
}

const per100Line = f => `${f.brand ? f.brand + ' · ' : ''}${t('{0} kcal per 100 {1}', fmtKcal(f.per100.kcal), f.unit === 'ml' ? 'ml' : 'g')}`

function AddFood({ date, meal: meal0, close }) {
  const S = useStore(s => s.S)
  const L = lang()
  const [meal, setMeal] = useState(meal0)
  const [q, setQ] = useState('')
  const [online, setOnline] = useState({ q: '', state: 'idle', foods: [], error: null })
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState(0)
  const [allBasics, setAllBasics] = useState(false)
  const inputRef = useRef(null)
  const syncKeyboard = useSheetKeyboard(inputRef)
  const today = todayISO()
  const query = q.trim()
  const code = /^\d{8,14}$/.test(query) ? query : ''

  const recent = useMemo(() => recentFoods(S, today), [S, today])
  const local = useMemo(() => searchLocal(S, query, L), [S, query, L])

  const pick = food => portionSheet({ date, meal, food, last: lastPortionOf(useStore.getState().S, food), onDone: () => setAdded(n => n + 1) })
  const pickRecent = row => {
    const food = foodFor(useStore.getState().S, row, L) || row
    portionSheet({ date, meal, food, last: { amount: row.lastAmount, sv: row.lastSv, unit: row.unit }, onDone: () => setAdded(n => n + 1) })
  }

  const lookUp = async raw => {
    const c = cleanCode(raw)
    if (!c) { toast(t('That is not a barcode')); return }
    const mine = myFoodByCode(useStore.getState().S, c)
    if (mine) { pick(mine); return }
    setBusy(true)
    try {
      const r = await offProduct(c, { lang: L })
      if (r.status === 'found') { pick(r.food); return }
      foodFormSheet({
        code: c, name: r.food?.name || '', brand: r.food?.brand || '', onSaved: pick,
        note: r.status === 'nodata'
          ? t('Open Food Facts knows this product but not its label. Type it in once from the pack — it is kept for the next scan.')
          : t('This barcode is not in Open Food Facts yet. Type the label in once — it is kept for the next scan.'),
      })
    } catch (e) {
      toast(offMessage(e))
    } finally { setBusy(false) }
  }

  const scan = async () => {
    try {
      const { scanCode } = await import('../lib/scan.js')
      const r = await scanCode()
      if (r?.value) await lookUp(r.value)
    } catch (e) {
      toast(e?.message === 'permission-denied' ? t('Allow the camera for openGym in Settings to scan.') : t('Scanning is not available here. Type the barcode into the search instead.'))
    }
  }

  const searchOnline = async () => {
    if (code) { lookUp(code); return }
    if (query.length < 2 || online.state === 'loading') return
    inputRef.current?.blur()
    setOnline({ q: query, state: 'loading', foods: [], error: null })
    try {
      const foods = await offSearch(query, { lang: L })
      setOnline({ q: query, state: 'done', foods, error: null })
    } catch (e) {
      setOnline({ q: query, state: 'error', foods: [], error: offMessage(e) })
    }
  }

  const editMine = f => foodFormSheet({ food: f })
  const basics = query || allBasics ? local.basics : local.basics.slice(0, 12)
  const onlineHere = online.q === query && online.state !== 'idle'

  return <>
    <h3 style={{ marginBottom: 10 }}>{t('Add to {0}', mealName(meal))}</h3>
    <MealChips value={meal} onChange={setMeal} />
    <div className="picker-search">
      <form onSubmit={e => { e.preventDefault(); searchOnline() }}>
        <SearchField ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} onFocus={syncKeyboard}
          enterKeyHint="search" placeholder={t('Search food or type a barcode')} aria-label={t('Search food')} />
      </form>
    </div>
    <div className="food-acts">
      {MOBILE && <Button size="sm" variant="tinted" icon="barcode" onClick={scan} disabled={busy}>{t('Scan')}</Button>}
      <Button size="sm" icon="bolt" onClick={() => quickAddSheet({ date, meal })}>{t('Quick add')}</Button>
      <Button size="sm" icon="plus" onClick={() => foodFormSheet({ onSaved: pick })}>{t('New food')}</Button>
    </div>
    {busy && <div className="food-busy muted small"><span className="food-spin" />{t('Looking it up…')}</div>}

    {code && <div className="sect">
      <div className="sect-b">
        <button className="lrow tap" onClick={() => lookUp(code)}>
          <span className="lrow-i" style={{ '--tint': 'var(--indigo)' }}><Icon name="barcode" /></span>
          <span className="lrow-m"><span className="lrow-t">{t('Look up barcode {0}', code)}</span></span>
          <Icon name="chevronRight" className="lrow-c" />
        </button>
      </div>
    </div>}

    {!query && recent.length > 0 && <div className="sect">
      <span className="sect-t">{t('Recent')}</span>
      <div className="sect-b">
        {recent.slice(0, 15).map(r => <FoodRow key={r.key} food={r} kcal={portion(r.per100, r.lastAmount).kcal}
          sub={`${r.brand ? r.brand + ' · ' : ''}${r.lastSv ? `${fmtAmt(r.lastSv)} × ${t('serving')}` : `${fmtAmt(r.lastAmount)} ${r.unit}`} · ${t('last time')}`}
          onClick={() => pickRecent(r)} />)}
      </div>
    </div>}

    {local.mine.length > 0 && <div className="sect">
      <span className="sect-t">{t('My foods')}</span>
      <div className="sect-b">
        {local.mine.slice(0, query ? 30 : 20).map(f => <FoodRow key={f.id} food={f} sub={per100Line(f)} onClick={() => pick(f)} onEdit={() => editMine(f)} />)}
      </div>
    </div>}

    {basics.length > 0 && <div className="sect">
      <span className="sect-t">{t('Everyday foods')}</span>
      <div className="sect-b">
        {basics.map(f => <FoodRow key={f.id} food={f} sub={per100Line(f)} onClick={() => pick(f)} />)}
      </div>
      {!query && !allBasics && local.basics.length > basics.length && <div className="row" style={{ justifyContent: 'center', marginTop: 6 }}>
        <Button size="sm" variant="ghost" onClick={() => setAllBasics(true)}>{t('Show all {0}', local.basics.length)}</Button>
      </div>}
    </div>}

    {query.length >= 2 && !code && <div className="sect">
      <span className="sect-t">{t('Open Food Facts')}</span>
      {!onlineHere && <div className="sect-b">
        <button className="lrow tap" onClick={searchOnline}>
          <span className="lrow-i" style={{ '--tint': 'var(--green)' }}><Icon name="globe" /></span>
          <span className="lrow-m"><span className="lrow-t">{t('Search packaged food for “{0}”', query)}</span>
            <span className="lrow-s">{t('Brands and supermarket products, from the open food database.')}</span></span>
          <Icon name="chevronRight" className="lrow-c" />
        </button>
      </div>}
      {onlineHere && online.state === 'loading' && <div className="food-busy muted small"><span className="food-spin" />{t('Searching…')}</div>}
      {onlineHere && online.state === 'error' && <div className="muted small food-note">{online.error}</div>}
      {onlineHere && online.state === 'done' && !online.foods.length && <div className="muted small food-note">{t('Nothing with a label found. Try fewer words, or add it as a new food.')}</div>}
      {onlineHere && online.foods.length > 0 && <div className="sect-b">
        {online.foods.map(f => <FoodRow key={f.code || f.name} food={f} sub={per100Line(f)} onClick={() => pick(f)} />)}
      </div>}
    </div>}

    {query && !code && !local.mine.length && !local.basics.length && !onlineHere && <div className="muted small food-note">{t('Nothing on the phone matches. Search Open Food Facts, or add it as a new food.')}</div>}

    {added > 0 && <div className="food-done">
      <Button variant="primary" onClick={close}>{added === 1 ? t('Done · 1 added') : t('Done · {0} added', added)}</Button>
    </div>}
  </>
}

/** Finding a food to add to `meal` of `date`. */
export function addFoodSheet({ date, meal }) {
  return ui().openSheet(close => <AddFood date={date} meal={meal} close={close} />)
}
