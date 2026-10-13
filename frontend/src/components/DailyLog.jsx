// The daily log: the sheet a day is logged in, and the Home card that opens it.
//
// One sheet for everything a day of a cut is judged by — weight, calories, protein, steps,
// cardio, sleep, alcohol, training, how hungry and how flat it felt — so logging takes one stop
// instead of five. Weight is written to S.bodyweight and the waist to S.measurements, the lists
// the rest of the app already reads; everything else goes to S.dailyLog (lib/cut.js). A day with a
// food diary (views/Food.jsx) shows its calories and protein from there instead of two fields, and
// saving the form keeps the diary, its Complete mark and what Apple Health filled in untouched —
// except a field typed over, which is the user's from then on. Nothing here imports sheets.jsx:
// Home's tests mock that module, and the card renders inside Home.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import {
  activeBreak, addDays, cardioMinutesOn, cutOf, cutReport, isIso, logFor, logHasValues, normalizeDailyLogState,
  normalizeLogEntry, workoutsOn,
} from '../lib/cut.js'
import { normalizeMeasurementsState, measurementEntryHasValues, emptyMeasurement, toMeasurementDisplay, fromMeasurementDisplay, measurementUnit } from '../lib/measurements.js'
import { dayNutrition } from '../lib/food.js'
import { checkInFor, currentFocus } from '../lib/checkin.js'
import { fmtNum, fmtDate, todayISO } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import Icon from './Icon.jsx'
import { Button, NumberField, Switch, TextField } from './ui.jsx'

const toast = message => useUI.getState().toast(message)
export const fmtInt = n => (n == null ? '–' : Math.round(n).toLocaleString(dateLocale()))
/** A rate or a percentage: always one decimal, so a steady 1.0 kg a week does not read as "1". */
export const fmt1 = n => (n == null ? '–' : (Math.round(n * 10) / 10).toLocaleString(dateLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
/** A pace aimed for: one decimal, two when it is a quarter — 0.25 and 0.75 kg a week are paces, 0.3 and 0.8 are not. */
export const fmtPace = n => (n == null ? '–' : (Math.round(n * 100) / 100).toLocaleString(dateLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 2 }))

/**
 * How the screens name and colour where the plan stands (cutReport's `phase`, and after a cut the
 * zone). `gaining`: the plan puts weight on, so going fast is gaining fast and 'loss' the wrong way.
 */
export function phaseInfo(phase, zone = null, gaining = false) {
  switch (phase) {
    case 'maintain': return zone?.zone === 'red' ? { label: t('Over the red line'), tone: 'bad', icon: 'warning' }
      : zone?.zone === 'yellow' ? { label: t('Drifting up'), tone: 'warn', icon: 'arrowUp' }
        : { label: t('Holding'), tone: 'good', icon: 'checkCircle' }
    case 'ok': return { label: t('On track'), tone: 'good', icon: 'checkCircle' }
    case 'early': return { label: t('First week'), tone: 'info', icon: 'hourglass' }
    case 'slow': return { label: t('Slower this week'), tone: 'warn', icon: 'gauge' }
    case 'stall': return { label: t('Stalled'), tone: 'bad', icon: 'warning' }
    case 'fast': return { label: gaining ? t('Gaining fast') : t('Losing fast'), tone: 'warn', icon: 'bolt' }
    case 'gain': return { label: t('Going up'), tone: 'bad', icon: 'arrowUp' }
    case 'loss': return { label: t('Going down'), tone: 'bad', icon: 'arrowDown' }
    case 'break': return { label: t('Diet break'), tone: 'info', icon: 'sun' }
    case 'water': return { label: t('Water week'), tone: 'info', icon: 'sunrise' }
    case 'stale': return { label: t('Weigh in to update'), tone: 'neutral', icon: 'scale' }
    default: return { label: t('No weigh-ins yet'), tone: 'neutral', icon: 'scale' }
  }
}

/** "−1.0 kg/wk": the trend's weekly change, a loss shown with a minus. */
export const fmtRate = (lossWk, unit) => (lossWk == null ? '–' : (lossWk > 0.05 ? '−' : lossWk < -0.05 ? '+' : '') + fmt1(Math.abs(lossWk)) + ' ' + unit + t('/wk'))

const WEIGHT_RANGE = { kg: [25, 400], lb: [55, 880] }
const SCALE_LABELS = {
  energy: ['Drained', 'Low', 'OK', 'Good', 'Great'],
  hunger: ['None', 'Mild', 'Normal', 'Hungry', 'Starving'],
}

/* ================================================================ the sheet == */

function DayForm({ date, close }) {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const nut = dayNutrition(S, date)
  const fromFood = nut.src === 'food'
  const openDiary = () => { close(); nav('/food?d=' + date) }
  const cut = cutOf(S)
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const lenUnit = measurementUnit(S.unit)
  const entry = logFor(S, date)
  const bw = (S.bodyweight || []).find(b => b.d === date) || null
  const waistEntry = (S.measurements || []).find(m => m.d === date) || null
  const waistShown = waistEntry?.waist != null ? toMeasurementDisplay(waistEntry.waist, S.unit) : null
  const workouts = workoutsOn(S, date)
  const fromWorkouts = cardioMinutesOn(S, date)

  const [v, setV] = useState(() => ({
    w: bw ? bw.w : null,
    waist: waistShown,
    kcal: entry?.kcal ?? null,
    protein: entry?.protein ?? null,
    steps: entry?.steps ?? null,
    cardio: entry?.cardio ?? (fromWorkouts || null),
    sleep: entry?.sleep ?? null,
    dry: entry ? entry.alcohol !== true : true,
    gym: entry?.gym === true,
    energy: entry?.energy ?? null,
    hunger: entry?.hunger ?? null,
    note: entry?.note || '',
  }))
  const set = (k, val) => setV(x => ({ ...x, [k]: val }))

  const save = () => {
    if (!isIso(date) || date > todayISO()) { toast(t('Choose a valid date')); return }
    const w = v.w == null || v.w === 0 ? null : Math.round(v.w * 10) / 10
    const [lo, hi] = WEIGHT_RANGE[unit]
    if (w != null && (w < lo || w > hi)) { toast(t('Enter a valid weight')); return }
    const waistCm = v.waist == null || v.waist === 0 ? null : fromMeasurementDisplay(v.waist, S.unit)
    const now = Date.now()
    const next = normalizeLogEntry({
      d: date, t: now, kcal: v.kcal, protein: v.protein, steps: v.steps,
      // the minutes a workout already holds are read from it; only a different number is kept
      cardio: v.cardio && v.cardio !== fromWorkouts ? v.cardio : null,
      sleep: v.sleep, alcohol: !v.dry, gym: workouts.length ? null : (v.gym ? true : null),
      energy: v.energy, hunger: v.hunger, note: v.note,
      food: entry?.food, done: entry?.done, partial: entry?.partial, photos: entry?.photos,
    })
    // What Apple Health filled in stays its own only while it is left as it was.
    const hk = (entry?.hk || []).filter(k => next[k] != null && next[k] === entry[k])
    if (hk.length) next.hk = hk
    useStore.getState().update(s => {
      s.dailyLog = (Array.isArray(s.dailyLog) ? s.dailyLog : []).filter(e => e?.d !== date)
      if (logHasValues(next)) s.dailyLog.push(next)
      normalizeDailyLogState(s)
      // The weigh-in of that day, only when it changed: an untouched one keeps its own time.
      const i = s.bodyweight.findIndex(b => b.d === date)
      if (w != null && (i < 0 || s.bodyweight[i].w !== w)) {
        if (i >= 0) { s.bodyweight[i].w = w; s.bodyweight[i].t = now } else s.bodyweight.push({ d: date, w, t: now })
        s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
      } else if (w == null && i >= 0 && bw) s.bodyweight.splice(i, 1)
      // The waist goes to that day's measurement check-in, which may hold other circumferences.
      if (waistCm != null || waistShown != null) {
        if (!Array.isArray(s.measurements)) s.measurements = []
        let m = s.measurements.find(x => x.d === date)
        if (!m && waistCm != null) { m = emptyMeasurement(date, s.customMeasurements || []); s.measurements.push(m) }
        if (m && (m.waist ?? null) !== waistCm) { m.waist = waistCm; m.t = now }
        if (m && !measurementEntryHasValues(m)) s.measurements = s.measurements.filter(x => x !== m)
        normalizeMeasurementsState(s)
      }
    })
    toast(date === todayISO() ? t('Today saved') : t('Day saved'))
    close()
  }

  const remove = () => {
    useStore.getState().update(s => {
      // the food diary and the day's photos are not this form's to clear: a day with them keeps them
      s.dailyLog = (s.dailyLog || []).map(e => (e?.d !== date ? e : e.food?.length || e.photos?.length
        ? { d: e.d, t: Date.now(), ...(e.food?.length ? { food: e.food } : {}), ...(e.done ? { done: true } : {}), ...(e.photos?.length ? { photos: e.photos } : {}) } : null)).filter(Boolean)
    })
    toast(t('Log removed'))
    close()
  }

  const field = (key, label, u, { decimal = false, hint = null } = {}) => <label className="measure-field" key={key}>
    <span>{label}{hint != null && <i className="dl-hint"> · {hint}</i>}</span>
    <span className="measure-input">
      <NumberField nullable decimal={decimal} value={v[key]} onChange={val => set(key, val)} />
      {u && <i>{u}</i>}
    </span>
  </label>

  const scale = (key, label) => <div className="dl-scale">
    <div className="dl-scale-t">{label}</div>
    <div className="dl-scale-o" role="radiogroup" aria-label={label}>
      {SCALE_LABELS[key].map((name, i) => <button key={i} role="radio" aria-checked={v[key] === i + 1}
        className={'chip nocap' + (v[key] === i + 1 ? ' on' : '')} onClick={() => set(key, v[key] === i + 1 ? null : i + 1)}>
        <b>{i + 1}</b> {t(name)}
      </button>)}
    </div>
  </div>

  return <>
    {fromFood && <div className="dl-food" {...tappable(openDiary)}>
      <span className="lrow-i" style={{ '--tint': 'var(--green)' }}><Icon name="utensils" /></span>
      <div className="dl-food-m">
        <b>{fmtInt(nut.kcal)} kcal · {fmtInt(nut.protein)} g {t('protein')}</b>
        <span>{t('From the food diary')}</span>
      </div>
      <Icon name="chevronRight" className="chev" />
    </div>}
    <div className="measure-form dl-form">
      {field('w', t('Weight'), unit, { decimal: true })}
      {field('waist', t('Waist'), lenUnit, { decimal: true, hint: t('weekly') })}
      {!fromFood && field('kcal', t('Calories'), 'kcal', { hint: fmtInt(cut.kcal) })}
      {!fromFood && field('protein', t('Protein'), 'g', { hint: fmtInt(cut.protein) })}
      {field('steps', t('Steps'), '', { hint: fmtInt(cut.steps) })}
      {field('cardio', t('Cardio'), t('min'), { hint: fmtInt(cut.cardio) })}
      {field('sleep', t('Sleep'), t('h'), { decimal: true, hint: fmtNum(cut.sleep) })}
    </div>

    <div className="sect-b dl-flags">
      <div className="lrow">
        <span className="lrow-i" style={{ '--tint': 'var(--purple)' }}><Icon name="shield" /></span>
        <span className="lrow-m"><span className="lrow-t">{t('Alcohol-free')}</span></span>
        <Switch checked={v.dry} onChange={on => set('dry', on)} aria-label={t('Alcohol-free')} />
      </div>
      <div className="lrow">
        <span className="lrow-i" style={{ '--tint': 'var(--orange)' }}><Icon name="dumbbell" /></span>
        <span className="lrow-m">
          <span className="lrow-t">{t('Trained')}</span>
          {workouts.length > 0 && <span className="lrow-s">{t('Logged: {0}', workouts.map(w => w.name || t('Workout')).join(', '))}</span>}
        </span>
        <Switch checked={workouts.length > 0 || v.gym} disabled={workouts.length > 0} onChange={on => set('gym', on)} aria-label={t('Trained')} />
      </div>
    </div>

    {scale('energy', t('Energy'))}
    {scale('hunger', t('Hunger'))}

    <TextField value={v.note} maxLength={500} placeholder={t('Note (optional)')} onChange={e => set('note', e.target.value)} style={{ marginTop: 12 }} />
    {!fromFood && <button className="dl-diary-link" onClick={openDiary}><Icon name="utensils" />{t('Log the food item by item instead')}</button>}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {entry && <><div style={{ height: 6 }} /><Button variant="ghost" className="dim" onClick={remove}>{t('Clear this day\'s log')}</Button></>}
  </>
}

export function DailyLogSheet({ initial, close }) {
  const today = todayISO()
  const [date, setDate] = useState(initial && isIso(initial) && initial <= today ? initial : today)
  const go = n => { const d = addDays(date, n); if (d <= today) setDate(d) }
  return <>
    <h3 style={{ marginBottom: 4 }}>{t('Daily log')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Fill in what you have. Empty fields stay empty.')}</div>
    <div className="dl-day">
      <button className="iconbtn" onClick={() => go(-1)} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>
      {/* The day reads as words; the native date picker lies over the whole pill, invisible, so a
          tap anywhere on it opens the system picker (showPicker for a desktop browser's click). */}
      <label className="dl-day-m">
        <span>{date === today ? t('Today') : fmtDate(date, true)}</span>
        <Icon name="calendar" className="dl-day-ic" />
        <input type="date" value={date} max={today} aria-label={t('Date')}
          onClick={e => { try { e.currentTarget.showPicker?.() } catch { /* not allowed here: the tap still focuses it */ } }}
          onChange={e => { if (isIso(e.target.value) && e.target.value <= today) setDate(e.target.value) }} />
      </label>
      <button className="iconbtn" onClick={() => go(1)} disabled={date >= today} aria-label={t('Next day')}><Icon name="chevronRight" /></button>
    </div>
    {/* keyed on the day: moving to another day starts that day's own form, not this one's edits */}
    <DayForm key={date} date={date} close={close} />
  </>
}

export function dailyLogSheet(iso) {
  return useUI.getState().openSheet(close => <DailyLogSheet initial={iso} close={close} />)
}

/* ============================================================== the Home card == */

/** The day's numbers as small pills, each against its target — maintenance on a break day (`brkKcal`). */
export function DayChips({ S, iso, cut = cutOf(S), brkKcal = null }) {
  const e = logFor(S, iso) || {}
  const nut = dayNutrition(S, iso)
  // today's diary is still being eaten: only going over shows, not being under
  const open = nut.src === 'food' && iso >= todayISO() && !e.done
  const cardio = e.cardio ?? (cardioMinutesOn(S, iso) || null)
  const trained = workoutsOn(S, iso).length > 0 || e.gym === true
  const bw = (S.bodyweight || []).find(b => b.d === iso)
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const goal = activeBreak(cut, iso) ? (brkKcal ?? cut.maintenance) : cut.kcal
  const chip = (key, icon, val, target, u, { hit, over } = {}) => {
    const has = val != null
    const tone = !has ? 'off' : hit ? 'hit' : over ? 'over' : ''
    return <span key={key} className={'dl-chip ' + tone}>
      <Icon name={icon} />
      <span>{has ? fmtInt(val) : '–'}{target != null && <span className="dl-of"> / {fmtInt(target)}</span>}{u && ' ' + u}</span>
    </span>
  }
  return <div className="dl-chips">
    {bw && <span className="dl-chip hit"><Icon name="scale" /><span>{fmtNum(bw.w)} {unit}</span></span>}
    {chip('kcal', nut.src === 'food' ? 'utensils' : 'flame', nut.kcal, goal, 'kcal', { hit: !open && nut.kcal != null && nut.kcal <= goal + 100 && nut.kcal >= goal - 300, over: nut.kcal > goal + 100 })}
    {chip('protein', 'bolt', nut.protein, cut.protein, 'g', { hit: nut.protein >= cut.protein * 0.9 })}
    {chip('steps', 'steps', e.steps, cut.steps, '', { hit: e.steps >= cut.steps })}
    {chip('cardio', 'figureRun', cardio, cut.cardio, t('min'), { hit: cardio >= cut.cardio })}
    {e.sleep != null
      ? <span className={'dl-chip' + (e.sleep >= 7 ? ' hit' : ' over')}><Icon name="moon" /><span>{fmtNum(e.sleep)} {t('h')}</span></span>
      : <span className="dl-chip off"><Icon name="moon" /><span>–</span></span>}
    {e.alcohol != null && <span className={'dl-chip ' + (e.alcohol ? 'over' : 'hit')}><Icon name="shield" /><span>{e.alcohol ? t('Alcohol') : t('No alcohol')}</span></span>}
    {trained && <span className="dl-chip hit"><Icon name="dumbbell" /><span>{t('Trained')}</span></span>}
  </div>
}

export function DailyLogCard() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = todayISO()
  const cut = cutOf(S)
  const logged = logFor(S, today)
  const report = useMemo(() => cutReport(S, today), [S, today])
  const info = phaseInfo(report.phase, report.zone, report.gaining)
  const unit = report.unit
  const nut = dayNutrition(S, today)
  const focus = currentFocus(S, today)
  const filled = logged ? (nut.kcal != null ? 1 : 0) + (nut.protein != null ? 1 : 0) + ['steps', 'sleep'].filter(k => logged[k] != null).length + (logged.alcohol != null ? 1 : 0) : 0

  return <div className="card dl-card">
    <div className="row between" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 9, minWidth: 0 }}>
        <span className="lrow-i" style={{ '--tint': 'var(--indigo)' }}><Icon name="clipboard" /></span>
        <div style={{ minWidth: 0 }}>
          <div className="dl-lbl">{t('Daily log')}</div>
          <div className="dl-ttl">{logged ? t('{0} of 5 logged today', filled) : t('Nothing logged today')}</div>
        </div>
      </div>
      <Button size="sm" variant={logged ? 'plain' : 'tinted'} icon={logged ? 'pencil' : 'plus'} onClick={() => dailyLogSheet(today)}>{logged ? t('Edit') : t('Log')}</Button>
    </div>
    <DayChips S={S} iso={today} cut={cut} brkKcal={report.maintenance} />
    {focus && <div className="dl-focus"><Icon name="target" /><span>{t('This week: {0}', focus.text)}</span></div>}
    {report.trend.length > 0 && <div className="dl-trend" {...tappable(() => nav('/progress'))}>
      <div className="dl-trend-m">
        <span className="muted small">{t('Trend')}</span>
        <b>{fmtNum(report.trendW)} {unit}</b>
        <span className="dl-rate">{fmtRate(report.lossWk, unit)}</span>
      </div>
      <span className={'dl-status ' + info.tone}><Icon name={info.icon} />{info.label}</span>
      <Icon name="chevronRight" className="chev" />
    </div>}
    {!report.trend.length && <div className="dl-trend" {...tappable(() => nav(S.cut ? '/progress' : '/setup'))}>
      <span className="muted small" style={{ flex: 1 }}>{!S.cut ? t('Set up your plan: targets, goal and reminders') : cut.mode === 'cut' ? t('Open Progress to see your cut') : t('Weigh in to start your trend')}</span>
      <Icon name="chevronRight" className="chev" />
    </div>}
  </div>
}

/** The weekly check-in, on Home while it is due (lib/checkin.js). */
export function CheckInCard() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const ci = checkInFor(S, todayISO())
  if (!ci?.due) return null
  return <div className="card wk-card" {...tappable(() => nav('/weekly'))}>
    <span className="lrow-i" style={{ '--tint': 'var(--purple)' }}><Icon name="calendar" /></span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="dl-lbl">{t('Weekly check-in')}</div>
      <div className="wk-card-t">{t('Two minutes: the week, the half-logged days, next week\'s calories')}</div>
    </div>
    <Button size="sm" variant="tinted" onClick={e => { e.stopPropagation(); nav('/weekly') }}>{t('Start')}</Button>
  </div>
}
