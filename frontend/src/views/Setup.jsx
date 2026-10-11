// The setup: the plan made once, step by step, the way MyFitnessPal starts — about you, the goal,
// how active the days are, the targets, the reminders.
//
// The targets start as the plan already set (Progress's, the defaults being the plan this cut was
// built on: 2,000 kcal, 175 g protein, 60 g fat, 10,000 steps, 45 minutes of cardio, 8 hours of
// sleep, six sessions a week, never under 1,800). What the numbers given here work out to (lib/
// setup.js, Mifflin–St Jeor) sits beside each one, with a button to take those instead — the plan
// stays the person's to decide. The start may be a day still to come: the cut then begins there.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { CUT_DEFAULTS, LB_PER_KG, addDays, carbsFor, cutOf, isIso, weighIns } from '../lib/cut.js'
import { ACTIVITY, ageOn, profileOf, suggestPlan, weeksTo } from '../lib/setup.js'
import { MOBILE, syncReminder } from '../lib/mobile.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, Segmented, Switch } from '../components/ui.jsx'
import { fmt1, fmtInt } from '../components/DailyLog.jsx'

const toast = m => useUI.getState().toast(m)
const ACTIVITY_COPY = {
  low: () => [t('Mostly sitting'), t('Little walking, few workouts')],
  light: () => [t('Lightly active'), t('Some walking, training 1–3 times a week')],
  moderate: () => [t('Active'), t('On your feet a fair bit, training 3–5 times a week')],
  high: () => [t('Very active'), t('Training most days, daily cardio, ~10,000 steps')],
  very: () => [t('Extremely active'), t('A physical job on top of hard training')],
}
const PACES = [
  { id: 'easy', min: 0.4, max: 0.6 },
  { id: 'steady', min: 0.6, max: 0.9 },
  { id: 'plan', min: 0.8, max: 1.2 },
  { id: 'fast', min: 1.0, max: 1.4 },
]

export default function Setup() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = todayISO()
  const cut = cutOf(S)
  const prof = profileOf(S)
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const per = unit === 'lb' ? LB_PER_KG : 1
  const lastW = (() => { const w = weighIns(S.bodyweight); return w.length ? w[w.length - 1].w : null })()
  const xmasFrom = (() => { const y = Number(today.slice(0, 4)) - (today.slice(5) <= '01-01' ? 1 : 0); return `${y}-12-23` })()
  const xmasTo = addDays(xmasFrom, 9)

  const [step, setStep] = useState(0)
  const [v, setV] = useState(() => ({
    sex: prof.sex || 'm', age: prof.born ? ageOn(prof.born, today) : null, heightCm: prof.heightCm, weight: lastW,
    goal: S.targetW ?? null,
    pace: PACES.find(p => Math.abs(p.min - cut.rateMin) < 0.01 && Math.abs(p.max - cut.rateMax) < 0.01)?.id || 'plan',
    start: cut.start || today,
    holidays: !cut.breaks.length || cut.breaks.some(b => b.from === xmasFrom),
    activity: prof.activity,
    steps: cut.steps, cardio: cut.cardio, gymDays: cut.gymDays, sleep: cut.sleep,
    kcal: cut.kcal, protein: cut.protein, fat: cut.fat, minKcal: cut.minKcal, maintenance: cut.maintenance,
    weigh: cut.remind?.weigh || '07:30', log: cut.remind?.log || '21:00',
    weighOn: cut.remind ? !!cut.remind.weigh : true, logOn: cut.remind ? !!cut.remind.log : true,
  }))
  const set = (k, val) => setV(x => ({ ...x, [k]: val }))
  const pace = PACES.find(p => p.id === v.pace) || PACES[2]

  const weightKg = v.weight > 0 ? v.weight / per : null
  const goalKg = v.goal > 0 ? v.goal / per : null
  const calc = useMemo(() => suggestPlan({
    sex: v.sex, age: v.age, heightCm: v.heightCm, weightKg, goalKg, activity: v.activity, rateKgWk: (pace.min + pace.max) / 2,
  }), [v.sex, v.age, v.heightCm, weightKg, goalKg, v.activity, pace])
  const steps = MOBILE ? 5 : 4

  // what the targets chosen give: the pace at the maintenance known (calculated, or the guess)
  const maint = v.maintenance || calc?.maintenance || CUT_DEFAULTS.maintenance
  const paceKg = v.kcal > 0 ? (maint - v.kcal) * 7 / 7700 : null
  const weeks = weightKg && goalKg && paceKg > 0.05 ? weeksTo(weightKg, goalKg, paceKg) : null
  const startOn = isIso(v.start) ? v.start : today

  const check = () => {
    if (step === 0) {
      if (!(v.weight > 0)) { toast(t('Enter your weight')); return false }
      if (v.heightCm != null && (v.heightCm < 100 || v.heightCm > 250)) { toast(t('Enter your height in cm')); return false }
    }
    if (step === 1) {
      if (!(v.goal > 0) || v.goal >= v.weight) { toast(t('The goal must be below your weight')); return false }
      if (!isIso(v.start)) { toast(t('Choose a valid date')); return false }
    }
    if (step === 3 && !(v.kcal >= 800 && v.protein >= 20 && v.fat >= 10)) { toast(t('Check the targets')); return false }
    return true
  }
  const next = () => { if (check()) setStep(s => s + 1) }
  const useCalc = () => { if (calc) setV(x => ({ ...x, kcal: calc.kcal, protein: calc.protein, fat: calc.fat, minKcal: Math.max(800, calc.floor), maintenance: calc.maintenance })) }
  const usePlan = () => setV(x => ({ ...x, kcal: CUT_DEFAULTS.kcal, protein: CUT_DEFAULTS.protein, fat: CUT_DEFAULTS.fat, minKcal: CUT_DEFAULTS.minKcal, maintenance: calc?.maintenance || CUT_DEFAULTS.maintenance }))

  const finish = () => {
    if (!check()) return
    const now = Date.now()
    const breaks = cut.breaks.filter(b => b.from !== xmasFrom)
    if (v.holidays) breaks.push({ from: xmasFrom, to: xmasTo })
    useStore.getState().update(s => {
      s.profile = { sex: v.sex, born: v.age > 0 ? Number(today.slice(0, 4)) - Math.round(v.age) : null, heightCm: v.heightCm || null, activity: v.activity }
      s.targetW = Math.round(v.goal * 10) / 10
      s.cut = cutOf({
        cut: {
          ...cutOf(s), start: startOn, changedAt: null,
          kcal: v.kcal, protein: v.protein, fat: v.fat, minKcal: v.minKcal, maintenance: v.maintenance,
          steps: v.steps, cardio: v.cardio, gymDays: v.gymDays, sleep: v.sleep,
          rateMin: pace.min, rateMax: pace.max, breaks,
          remind: MOBILE ? { weigh: v.weighOn ? v.weigh : null, log: v.logOn ? v.log : null } : cutOf(s).remind,
        },
      })
      // today's weight, when there is none yet: the first point of the trend
      const w = Math.round(v.weight * 10) / 10
      if (!(s.bodyweight || []).some(b => b.d === today) && w !== lastW) {
        s.bodyweight = [...(s.bodyweight || []), { d: today, w, t: now }].sort((a, b) => (a.d < b.d ? -1 : 1))
      }
    })
    if (MOBILE && (v.weighOn || v.logOn)) syncReminder(useStore.getState().S, true).catch(() => {})
    toast(startOn > today ? t('Plan saved. The cut starts {0}.', fmtDate(startOn, true)) : t('Plan saved. Day one starts now.'))
    nav('/progress', { replace: true })
  }

  const num = (key, label, u, { decimal = false, hint } = {}) => <label className="measure-field" key={key}>
    <span>{label}{hint != null && <i className="dl-hint"> · {hint}</i>}</span>
    <span className="measure-input"><NumberField nullable decimal={decimal} value={v[key]} onChange={val => set(key, val)} />{u && <i>{u}</i>}</span>
  </label>

  const titles = [t('About you'), t('Your goal'), t('Your days'), t('Your targets'), t('Reminders')]
  const subs = [
    t('What the starting numbers are worked out from. Nothing leaves your phone.'),
    t('Where to, how fast, and from when.'),
    t('How active a normal day is, and the habits the plan counts.'),
    t('Your plan, with what your numbers work out to beside it.'),
    t('A nudge to weigh in each morning and to log each evening.'),
  ]

  return <div className="narrow setup">
    <div className="hdr">
      <button className="iconbtn" onClick={() => (step ? setStep(step - 1) : nav(-1))} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 10, minWidth: 0 }}>
        <h1>{titles[step]}</h1>
        <div className="sub">{subs[step]}</div>
      </div>
    </div>
    <div className="setup-dots" aria-label={t('Step {0} of {1}', step + 1, steps)}>
      {Array.from({ length: steps }, (_, i) => <span key={i} className={i <= step ? 'on' : ''} />)}
    </div>

    {step === 0 && <div className="card">
      <div className="muted small" style={{ margin: '0 2px 6px' }}>{t('Sex')}</div>
      <Segmented options={[{ value: 'm', label: t('Male') }, { value: 'f', label: t('Female') }]} value={v.sex} onChange={x => set('sex', x)} />
      <div style={{ height: 14 }} />
      <div className="measure-form">
        {num('age', t('Age'), t('years'))}
        {num('heightCm', t('Height'), 'cm')}
        {num('weight', t('Weight now'), unit, { decimal: true })}
      </div>
    </div>}

    {step === 1 && <>
      <div className="card">
        <div className="measure-form">{num('goal', t('Goal weight'), unit, { decimal: true })}</div>
        <div className="muted small" style={{ margin: '14px 2px 8px' }}>{t('Weekly loss')}</div>
        <div className="setup-opts">
          {PACES.map(p => <button key={p.id} className={'setup-opt' + (v.pace === p.id ? ' on' : '')} onClick={() => set('pace', p.id)}>
            <b>{fmt1(p.min * per)}–{fmt1(p.max * per)} {unit}</b>
            <span>{{ easy: t('Easy: the most muscle kept, the slowest'), steady: t('Steady'), plan: t('Our plan: about 1% of your weight a week'), fast: t('Fast: harder to keep strength') }[p.id]}</span>
          </button>)}
        </div>
      </div>
      <div className="card">
        <label className="measure-date" style={{ marginBottom: 6 }}>
          <span>{t('Start')}</span>
          <div className="row" style={{ gap: 8 }}>
            <input className="field" type="date" value={v.start} min={addDays(today, -60)} onChange={e => set('start', e.target.value)} />
            <Button size="sm" variant="tinted" onClick={() => set('start', today)}>{t('Today')}</Button>
          </div>
        </label>
        <div className="lrow" style={{ padding: '10px 0 0' }}>
          <span className="lrow-i" style={{ '--tint': 'var(--blue)' }}><Icon name="sun" /></span>
          <span className="lrow-m"><span className="lrow-t">{t('Holiday break')}</span>
            <span className="lrow-s">{t('{0} – {1} at maintenance', fmtDate(xmasFrom, true), fmtDate(xmasTo, true))}</span></span>
          <Switch checked={v.holidays} onChange={x => set('holidays', x)} aria-label={t('Holiday break')} />
        </div>
      </div>
    </>}

    {step === 2 && <>
      <div className="setup-opts" style={{ marginBottom: 12 }}>
        {ACTIVITY.map(a => { const [name, about] = ACTIVITY_COPY[a.id](); return <button key={a.id} className={'setup-opt' + (v.activity === a.id ? ' on' : '')} onClick={() => set('activity', a.id)}>
          <b>{name}</b><span>{about}</span>
        </button> })}
      </div>
      <div className="card">
        <div className="measure-form">
          {num('steps', t('Steps a day'), '')}
          {num('cardio', t('Cardio a day'), t('min'))}
          {num('gymDays', t('Gym days a week'), '')}
          {num('sleep', t('Sleep'), t('h'), { decimal: true })}
        </div>
      </div>
    </>}

    {step === 3 && <>
      {calc && <div className="card setup-calc">
        <div className="dl-lbl">{t('Worked out from your numbers')}</div>
        <div className="setup-calc-g">
          <div><b>{fmtInt(calc.maintenance)}</b><span>{t('maintenance')}</span></div>
          <div><b>{fmtInt(calc.kcal)}</b><span>{t('kcal a day')}</span></div>
          <div><b>{fmtInt(calc.protein)} g</b><span>{t('protein')}</span></div>
          <div><b>{fmtInt(calc.fat)} g</b><span>{t('fat')}</span></div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button size="sm" variant="tinted" onClick={useCalc}>{t('Use these')}</Button>
          <Button size="sm" onClick={usePlan}>{t('Back to our plan')}</Button>
        </div>
      </div>}
      {!calc && <div className="card muted small">{t('Add your age and height on the first step to see what your numbers work out to.')}</div>}
      <div className="card">
        <div className="measure-form">
          {num('kcal', t('Calories'), 'kcal')}
          {num('protein', t('Protein'), 'g')}
          {num('fat', t('Fat'), 'g')}
          <div className="measure-field"><span>{t('Carbs')}</span>
            <span className="measure-input cut-derived"><b>{v.kcal && v.protein && v.fat ? carbsFor(v.kcal, v.protein, v.fat) : '–'}</b><i>{t('g · the rest')}</i></span></div>
          {num('minKcal', t('Never below'), 'kcal')}
          {num('maintenance', t('Maintenance guess'), 'kcal')}
        </div>
        {paceKg != null && <div className="setup-sum">
          {paceKg > 0.05
            ? t('About {0} {1} a week at first{2}.', fmt1(paceKg * per), unit, weeks ? ' · ' + t('the goal around {0}', fmtDate(addDays(startOn, weeks * 7), true, true)) : '')
            : t('These calories are about maintenance: the weight will hold, not drop.')}
          <div className="dim" style={{ marginTop: 4 }}>{t('Progress works out your real maintenance from the log after about three weeks, and says when to change.')}</div>
        </div>}
      </div>
    </>}

    {step === 4 && MOBILE && <div className="card">
      {[['weighOn', 'weigh', t('Weigh-in'), t('Every morning, before breakfast'), 'scale'], ['logOn', 'log', t('Log your day'), t('Every evening, if the day is not logged yet'), 'clipboard']].map(([on, key, title, sub, icon]) =>
        <div className="lrow" key={key} style={{ padding: '10px 0' }}>
          <span className="lrow-i" style={{ '--tint': 'var(--indigo)' }}><Icon name={icon} /></span>
          <span className="lrow-m"><span className="lrow-t">{title}</span><span className="lrow-s">{sub}</span></span>
          {v[on] && <input className="field setup-time" type="time" value={v[key]} onChange={e => e.target.value && set(key, e.target.value)} aria-label={title} />}
          <Switch checked={v[on]} onChange={x => set(on, x)} aria-label={title} />
        </div>)}
    </div>}

    <div className="setup-foot">
      {step < steps - 1
        ? <Button variant="primary" onClick={next}>{t('Next')}</Button>
        : <Button variant="primary" icon="flag" onClick={finish}>{startOn > today ? t('Save the plan') : t('Start the cut')}</Button>}
    </div>
  </div>
}
