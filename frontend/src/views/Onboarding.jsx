// The first run: a few questions, one a screen, the way the big diet apps start — sex, age, height,
// weight and how active the days are; where that weight stands (the BMI, in the WHO's bands); what
// the person wants (lose, keep, gain); the goal weight and the pace; then the calories and macros
// that get there (lib/onboarding.js), and on the phone the two daily reminders. App.jsx shows it
// until it is done (S.onboarded); /setup runs it again from the plan's gear, the answers kept.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { LB_PER_KG, addDays, cutOf, isIso, weighIns } from '../lib/cut.js'
import { ACTIVITY, ageOn, profileOf } from '../lib/setup.js'
import {
  LIMITS, PACES, applyOnboarding, bmiBand, bmiOf, healthyRange, planFor, recommendGoal, recommendedPace,
  suggestGoalWeight,
} from '../lib/onboarding.js'
import { MOBILE, syncReminder } from '../lib/mobile.js'
import { fmtNum, todayISO } from '../lib/format.js'
import { dateLocale, t } from '../lib/i18n.js'
import { APP_NAME } from '../lib/brand.js'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, Segmented, Switch } from '../components/ui.jsx'
import { fmt1, fmtInt, fmtPace } from '../components/DailyLog.jsx'

const toast = m => useUI.getState().toast(m)
const r1 = n => Math.round(n * 10) / 10
const monthOf = iso => new Date(iso + 'T12:00:00').toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' })

const ACTIVITY_COPY = {
  low: () => [t('Mostly sitting'), t('Little walking, few workouts')],
  light: () => [t('Lightly active'), t('Some walking, training 1–3 times a week')],
  moderate: () => [t('Active'), t('On your feet a fair bit, training 3–5 times a week')],
  high: () => [t('Very active'), t('Training most days, daily cardio, ~10,000 steps')],
  very: () => [t('Extremely active'), t('A physical job on top of hard training')],
}
const ACTIVITY_ICON = { low: 'person', light: 'steps', moderate: 'figureRun', high: 'dumbbell', very: 'bolt' }

const BAND = {
  under: { label: () => t('Underweight'), tone: 'blue' },
  healthy: { label: () => t('Healthy weight'), tone: 'green' },
  over: { label: () => t('Overweight'), tone: 'orange' },
  obese1: { label: () => t('Obesity, class I'), tone: 'red' },
  obese2: { label: () => t('Obesity, class II'), tone: 'red' },
  obese3: { label: () => t('Obesity, class III'), tone: 'red' },
}

const GOAL_COPY = {
  lose: () => [t('Lose weight'), t('Lose fat and keep the muscle: a steady deficit, protein high')],
  maintain: () => [t('Keep my weight'), t('Eat at maintenance and get fitter')],
  gain: () => [t('Gain weight'), t('Build muscle on a small surplus')],
}
const GOAL_ICON = { lose: 'arrowDown', maintain: 'target', gain: 'arrowUp' }

/** The steps for a goal, in order: the target only for a change of weight, the reminders on the phone. */
const stepsFor = (goal, redo) => [
  ...(redo ? [] : ['welcome']), 'sex', 'age', 'height', 'weight', 'activity', 'verdict', 'goal',
  ...(goal && goal !== 'maintain' ? ['target'] : []), 'plan', ...(MOBILE ? ['reminders'] : []),
]

const inRange = (v, [lo, hi]) => v != null && v >= lo && v <= hi

/** A question: the title and what it is for. */
function Q({ title, sub }) {
  return <div className="onb-q"><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
}

/**
 * One number, big, with its unit; Enter moves on. A fixed width of `size` digits, centred, so an
 * empty field still shows its example (`placeholder`) whole and reads as the place to type.
 */
function BigNumber({ value, onChange, unit, decimal = false, onEnter, error, hint, label, placeholder, size = 3 }) {
  return <div className="onb-num">
    <label className={'onb-num-f' + (error ? ' bad' : '')}>
      <NumberField nullable decimal={decimal} value={value} onChange={onChange} aria-label={label} autoFocus placeholder={placeholder}
        style={{ width: size + 'ch' }} onKeyDown={e => { if (e.key === 'Enter' && onEnter) { e.currentTarget.blur(); onEnter() } }} />
      <i>{unit}</i>
    </label>
    {error ? <div className="onb-num-e" role="alert">{error}</div> : hint ? <div className="onb-num-h">{hint}</div> : null}
  </div>
}

/** The BMI on a bar from 15 to 40, the WHO's bands coloured, a mark where this one sits. */
function BmiScale({ bmi }) {
  const lo = 15, hi = 40
  const at = v => (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo) * 100
  const seg = (from, to, tone) => <span className={'tone-' + tone} style={{ width: at(to) - at(from) + '%' }} />
  return <div className="onb-scale" aria-hidden="true">
    <div className="onb-scale-bar">{seg(lo, 18.5, 'blue')}{seg(18.5, 25, 'green')}{seg(25, 30, 'orange')}{seg(30, hi, 'red')}</div>
    <i style={{ insetInlineStart: at(bmi) + '%' }} />
    <div className="onb-scale-l">{[18.5, 25, 30].map(v => <span key={v} style={{ insetInlineStart: at(v) + '%' }}>{fmtNum(v)}</span>)}</div>
  </div>
}

export default function Onboarding({ redo = false }) {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = todayISO()
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const per = unit === 'lb' ? LB_PER_KG : 1

  // the answers, started from what the app already knows
  const [a, setA] = useState(() => {
    const p = profileOf(S)
    const cut = cutOf(S)
    const w = weighIns(S.bodyweight)
    return {
      sex: p.sex, age: p.born ? ageOn(p.born, today) : null, heightCm: p.heightCm,
      weight: w.length ? w[w.length - 1].w : null,
      activity: S.profile?.activity ? p.activity : null,
      goal: null, goalWeight: null, paceKg: null,
      // a cut already planned for a day to come keeps that day
      start: S.cut && cut.mode === 'cut' && isIso(cut.start) && cut.start > today ? cut.start : today,
      steps: cut.steps, cardio: cut.cardio, sleep: cut.sleep, gymDays: cut.gymDays,
      weighOn: cut.remind ? !!cut.remind.weigh : true, weigh: cut.remind?.weigh || '07:30',
      logOn: cut.remind ? !!cut.remind.log : true, log: cut.remind?.log || '21:00',
    }
  })
  const set = (k, v) => setA(x => ({ ...x, [k]: v }))

  const steps = stepsFor(a.goal, redo)
  const [at, setAt] = useState(steps[0])
  const idx = Math.max(0, steps.indexOf(at))
  const go = id => { setAt(id); window.scrollTo(0, 0) }
  const next = () => { if (idx < steps.length - 1) go(steps[idx + 1]) }
  const back = () => { if (idx > 0) go(steps[idx - 1]); else if (redo) nav(-1) }

  // the body as the formulas take it, in kg
  const weightKg = a.weight > 0 ? a.weight / per : null
  const bmi = bmiOf(weightKg, a.heightCm)
  const band = bmiBand(bmi)
  const healthy = healthyRange(a.heightCm)
  const rec = recommendGoal(bmi)
  const goalKg = a.goalWeight > 0 ? a.goalWeight / per : null
  const body = { sex: a.sex, age: a.age, heightCm: a.heightCm, weightKg, activity: a.activity }
  const plan = useMemo(() => (a.goal ? planFor({ ...body, goal: a.goal, goalKg: a.goal === 'maintain' ? null : goalKg, paceKg: a.paceKg }) : null),
    [a.sex, a.age, a.heightCm, weightKg, a.activity, a.goal, goalKg, a.paceKg])
  const start = a.goal === 'lose' && isIso(a.start) ? a.start : today

  // what each number accepts, said under it once something is typed
  const [wLo, wHi] = LIMITS.weightKg.map(x => Math.round(x * per))
  const ageErr = a.age != null && !inRange(a.age, LIMITS.age) ? t('Between 18 and 100: the numbers here are for adults.') : null
  const heightErr = a.heightCm != null && !inRange(a.heightCm, LIMITS.heightCm) ? t('Between 120 and 230 cm.') : null
  const weightErr = a.weight != null && !inRange(a.weight, [wLo, wHi]) ? t('Between {0} and {1} {2}.', wLo, wHi, unit) : null
  const minGoal = healthy ? Math.ceil(healthy.min * per * 10) / 10 : 0
  const targetErr = a.goalWeight == null ? null
    : a.goal === 'lose' && a.goalWeight >= a.weight ? t('Below your weight now: {0} {1}.', fmtNum(a.weight), unit)
      : a.goal === 'lose' && a.goalWeight < minGoal ? t('Under a healthy weight for your height: {0} {1} at the least.', fmtNum(minGoal), unit)
        : a.goal === 'gain' && a.goalWeight <= a.weight ? t('Above your weight now: {0} {1}.', fmtNum(a.weight), unit)
          : a.goal === 'gain' && a.goalWeight > a.weight + 40 * per ? t('Up to {0} {1}.', fmtNum(r1(a.weight + 40 * per)), unit) : null
  const ok = {
    welcome: true, sex: !!a.sex, age: inRange(a.age, LIMITS.age), height: inRange(a.heightCm, LIMITS.heightCm),
    weight: inRange(a.weight, [wLo, wHi]), activity: !!a.activity, verdict: bmi != null, goal: !!a.goal,
    target: a.goalWeight > 0 && !targetErr && a.paceKg > 0 && (a.goal !== 'lose' || (isIso(a.start) && a.start >= today)),
    plan: !!plan, reminders: !!plan,
  }

  // the goal chosen: its goal weight and pace to start from, then on — the same goal again keeps
  // what was set for it
  const pickGoal = g => {
    if (g === a.goal && (g === 'maintain' || a.goalWeight != null)) { go(g === 'maintain' ? 'plan' : 'target'); return }
    const cur = S.targetW > 0 ? S.targetW / per : null
    const gw = g === 'maintain' ? null : suggestGoalWeight(g, weightKg, a.heightCm, cur)
    setA(x => ({ ...x, goal: g, goalWeight: gw != null ? r1(gw * per) : null, paceKg: g === 'maintain' ? null : recommendedPace(g, weightKg) }))
    go(g === 'maintain' ? 'plan' : 'target')
  }

  const switchUnit = u => {
    if (u === unit) return
    useStore.getState().setUnit(u)
    const conv = v => (v == null ? v : r1(u === 'lb' ? v * LB_PER_KG : v / LB_PER_KG))
    setA(x => ({ ...x, weight: conv(x.weight), goalWeight: conv(x.goalWeight) }))
  }

  const skip = () => { useStore.getState().update(s => { s.onboarded = Date.now() }); nav('/home', { replace: true }) }

  const finish = () => {
    let done = null
    useStore.getState().update(s => {
      done = applyOnboarding(s, { ...a, start, goalWeight: a.goal === 'maintain' ? null : a.goalWeight }, { today })
      if (done && MOBILE) {
        const c = cutOf(s)
        c.remind = { weigh: a.weighOn ? a.weigh : null, log: a.logOn ? a.log : null }
        s.cut = cutOf({ cut: c })
      }
    })
    if (!done) { toast(t('Check your answers')); return }
    if (MOBILE && (a.weighOn || a.logOn)) syncReminder(useStore.getState().S, true).catch(() => {})
    toast(a.goal === 'lose' && start > today ? t('Plan saved. The cut starts {0}.', new Date(start + 'T12:00:00').toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long' }))
      : t('Your plan is set: {0} kcal a day.', fmtInt(done.kcal)))
    nav(redo ? '/progress' : '/home', { replace: true })
  }

  // the screen's own frame: no padding left for a tab bar
  useEffect(() => {
    document.body.classList.add('onb-on')
    return () => document.body.classList.remove('onb-on')
  }, [])

  const last = idx === steps.length - 1
  const foot = (label, onClick, enabled = true) => <div className="onb-foot">
    <Button variant="primary" onClick={onClick} disabled={!enabled}>{label}</Button>
  </div>
  const cont = foot(t('Continue'), next, ok[at])

  const option = (on, icon, title, sub, onClick, { badge, warn, disabled, side } = {}) => <button className={'onb-opt' + (on ? ' on' : '')} onClick={onClick} disabled={disabled} aria-pressed={on}>
    {icon && <span className="lrow-i" style={{ '--tint': 'var(--acc)' }}><Icon name={icon} /></span>}
    <span className="onb-opt-m"><b>{title}{badge && <em className={'onb-badge' + (warn ? ' warn' : '')}>{badge}</em>}</b>{sub && <span>{sub}</span>}</span>
    {side && <span className="onb-opt-k">{side}</span>}
  </button>

  let content = null
  switch (at) {
    case 'welcome': content = <>
      <div className="onb-body">
        <div className="onb-hero">
          <div className="onb-logo"><Icon name="dumbbell" /></div>
          <h1>{t('Welcome to {0}', APP_NAME)}</h1>
          <p>{t('A few questions, about a minute. Then {0} works out your calories, your protein and the pace to your goal.', APP_NAME)}</p>
        </div>
        <ul className="onb-points">
          <li><Icon name="flame" /><div><b>{t('Calories worked out for you')}</b><span>{t('From your body and your goal, adjusted as you log')}</span></div></li>
          <li><Icon name="utensils" /><div><b>{t('Food, weight and training together')}</b><span>{t('One place for the whole day')}</span></div></li>
          <li><Icon name="lock" /><div><b>{t('Private')}</b><span>{MOBILE ? t('Everything stays on this phone') : t('Nothing goes to anyone else')}</span></div></li>
        </ul>
      </div>
      <div className="onb-foot">
        <Button variant="primary" onClick={next}>{t('Get started')}</Button>
        <button className="onb-skip" onClick={skip}>{t('Skip for now')}</button>
      </div>
    </>; break

    case 'sex': content = <>
      <div className="onb-body">
        <Q title={t('What is your sex?')} sub={t('The calorie formula is different for men and women.')} />
        <div className="onb-choices">
          {[['m', t('Male')], ['f', t('Female')]].map(([v, label]) => <button key={v} className={'onb-choice' + (a.sex === v ? ' on' : '')} aria-pressed={a.sex === v}
            onClick={() => { set('sex', v); go('age') }}><Icon name="person" /><b>{label}</b></button>)}
        </div>
      </div>
      {a.sex && cont}
    </>; break

    case 'age': content = <>
      <div className="onb-body">
        <Q title={t('How old are you?')} sub={t('Your resting energy goes down a little with every year.')} />
        <BigNumber value={a.age} onChange={v => set('age', v)} unit={t('years')} label={t('Age')} placeholder="30" size={2.4} error={ageErr} onEnter={ok.age ? next : null} />
      </div>
      {cont}
    </>; break

    case 'height': content = <>
      <div className="onb-body">
        <Q title={t('How tall are you?')} />
        <BigNumber value={a.heightCm} onChange={v => set('heightCm', v)} unit="cm" label={t('Height')} placeholder="175" size={3.4} error={heightErr} onEnter={ok.height ? next : null} />
      </div>
      {cont}
    </>; break

    case 'weight': content = <>
      <div className="onb-body">
        <Q title={t('How much do you weigh?')} sub={t('This morning\'s weight, if you have it: before breakfast is the most honest one.')} />
        <BigNumber value={a.weight} onChange={v => set('weight', v)} unit={unit} decimal label={t('Weight')} placeholder={unit === 'lb' ? '180' : '80'} size={4.4} error={weightErr} onEnter={ok.weight ? next : null} />
        <div className="onb-unit"><Segmented options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} value={unit} onChange={switchUnit} /></div>
      </div>
      {cont}
    </>; break

    case 'activity': content = <>
      <div className="onb-body">
        <Q title={t('How active are your days?')} sub={t('A normal week, training included.')} />
        <div className="onb-opts">
          {ACTIVITY.map(x => { const [name, about] = ACTIVITY_COPY[x.id](); return <div key={x.id}>
            {option(a.activity === x.id, ACTIVITY_ICON[x.id], name, about, () => { set('activity', x.id); go('verdict') })}
          </div> })}
        </div>
      </div>
      {a.activity && cont}
    </>; break

    case 'verdict': {
      const b = BAND[band] || BAND.healthy
      const over = healthy && weightKg ? weightKg - healthy.max : 0
      const text = band === 'under' ? t('Under the healthy range for your height. Putting a little weight on, with strength training, is the way to go.')
        : band === 'healthy' ? t('In the healthy range for your height. Keep it there, or build muscle.')
          : band === 'over' ? t('Above the healthy range for your height, by about {0}.', fmtNum(r1(over * per)) + ' ' + unit)
            : t('Well above the healthy range for your height. Losing even 5–10% of your weight ({0}) already brings real health gains.', fmtNum(Math.round(a.weight * 0.05)) + '–' + fmtNum(Math.round(a.weight * 0.1)) + ' ' + unit)
      content = <>
        <div className="onb-body">
          <Q title={t('Where you stand')} sub={t('Your body mass index: your weight against your height.')} />
          {bmi != null && <div className={'card onb-bmi tone-' + b.tone}>
            <div className="onb-bmi-top">
              <div><span className="onb-bmi-n">{fmt1(bmi)}</span><span className="onb-bmi-u">BMI</span></div>
              <span className="onb-band">{b.label()}</span>
            </div>
            <BmiScale bmi={bmi} />
            <p>{text}</p>
            {healthy && <p className="onb-range">{t('A healthy weight for {0} cm: {1}–{2}.', a.heightCm, fmtNum(r1(healthy.min * per)), fmtNum(r1(healthy.max * per)) + ' ' + unit)}</p>}
          </div>}
          <div className="onb-note"><Icon name="info" /><span>{t('BMI cannot tell muscle from fat: with a lot of muscle it reads high. Later, the waist is the better check — under half your height.')}</span></div>
        </div>
        {cont}
      </>
      break
    }

    case 'goal': content = <>
      <div className="onb-body">
        <Q title={t('What do you want?')} sub={t('Your call. You can change it any time.')} />
        <div className="onb-opts">
          {['lose', 'maintain', 'gain'].map(g => { const [name, about] = GOAL_COPY[g](); const no = g === 'lose' && band === 'under'; return <div key={g}>
            {option(a.goal === g, GOAL_ICON[g], name, no ? t('Not with a BMI under 18.5') : about, () => pickGoal(g),
              { badge: !no && g === rec ? t('Recommended') : null, disabled: no })}
          </div> })}
        </div>
      </div>
      {a.goal && foot(t('Continue'), () => pickGoal(a.goal))}
    </>; break

    case 'target': {
      const diff = a.goalWeight > 0 && a.weight > 0 ? a.goalWeight - a.weight : null
      const recPace = recommendedPace(a.goal, weightKg)
      content = <>
        <div className="onb-body">
          <Q title={t('Your goal weight')} sub={a.goal === 'lose' ? t('A first goal you can see yourself reaching. You can always set the next one.') : t('Where you want to get to.')} />
          <BigNumber value={a.goalWeight} onChange={v => set('goalWeight', v)} unit={unit} decimal label={t('Goal weight')} size={4.4} error={targetErr}
            hint={diff != null ? `${diff > 0 ? '+' : '−'}${fmtNum(Math.abs(r1(diff)))} ${unit}${goalKg && a.heightCm ? ' · BMI ' + fmt1(bmiOf(goalKg, a.heightCm)) : ''}` : null} />

          <h4 className="sec">{t('How fast?')}</h4>
          <div className="onb-opts">
            {(PACES[a.goal] || []).map(kg => {
              const p = planFor({ ...body, goal: a.goal, goalKg, paceKg: kg })
              if (!p) return null
              const capped = a.goal === 'lose' && p.rate < kg - 0.04
              const fast = a.goal === 'lose' ? kg > weightKg * 0.01 + 1e-9 : kg > 0.25
              const eta = p.weeks ? monthOf(addDays(start, p.weeks * 7)) : null
              return <div key={kg}>{option(a.paceKg === kg, null, t('{0} a week', fmtPace(kg * per) + ' ' + unit),
                [t('{0}% of your weight', fmt1(kg / weightKg * 100)), eta && !targetErr ? t('the goal around {0}', eta) : null,
                  capped ? t('your floor of {0} kcal holds it to {1}', fmtInt(p.floor), fmt1(p.rate * per) + ' ' + unit) : null].filter(Boolean).join(' · '),
                () => set('paceKg', kg),
                { badge: kg === recPace ? t('Recommended') : fast ? (a.goal === 'lose' ? t('Hard on muscle') : t('More fat')) : null, warn: kg !== recPace && fast, side: t('{0} kcal', fmtInt(p.kcal)) })}</div>
            })}
          </div>

          {a.goal === 'lose' && <>
            <h4 className="sec">{t('When do you start?')}</h4>
            <div className="card onb-start">
              <div className="row" style={{ gap: 8 }}>
                <input className="field" type="date" value={a.start} min={today} aria-label={t('Start')} onChange={e => set('start', e.target.value)} />
                <Button size="sm" variant={a.start === today ? 'tinted' : 'plain'} onClick={() => set('start', today)}>{t('Today')}</Button>
              </div>
              <div className="small muted" style={{ marginTop: 8, lineHeight: 1.4 }}>{a.start > today ? t('Until then, weigh in and log as usual: the trend and your maintenance get a head start.') : t('Day one is today.')}</div>
            </div>
          </>}
        </div>
        {cont}
      </>
      break
    }

    case 'plan': {
      if (!plan) { content = <div className="onb-body"><Q title={t('Your plan')} sub={t('A few answers are missing. Go back and fill them in.')} /></div>; break }
      const diffKcal = plan.kcal - plan.maintenance
      const eq = a.goal === 'maintain' ? t('What keeps your weight where it is: {0} kcal a day.', fmtInt(plan.maintenance))
        : a.goal === 'gain' ? t('{0} kcal keeps your weight; {1} more a day puts on about {2} a week.', fmtInt(plan.maintenance), fmtInt(diffKcal), fmt1(plan.rate * per) + ' ' + unit)
          : t('{0} kcal keeps your weight; {1} less a day takes off about {2} a week.', fmtInt(plan.maintenance), fmtInt(-diffKcal), fmt1(plan.rate * per) + ' ' + unit)
      const eta = plan.weeks ? addDays(start, plan.weeks * 7) : null
      const pctOf = kcal => Math.round(kcal / plan.kcal * 100)
      const num = (key, label, u, decimal = false) => <label className="measure-field" key={key}>
        <span>{label}</span>
        <span className="measure-input"><NumberField nullable decimal={decimal} value={a[key]} onChange={v => set(key, v)} />{u && <i>{u}</i>}</span>
      </label>
      content = <>
        <div className="onb-body">
          <Q title={t('Your plan')} sub={GOAL_COPY[a.goal]()[0]} />
          <div className="card onb-plan">
            <div className="onb-kcal"><b>{fmtInt(plan.kcal)}</b><span>{t('kcal a day')}</span></div>
            <div className="onb-eq">{eq}</div>
            <div className="onb-macros">
              <div className="tone-blue"><b>{fmtInt(plan.protein)} g</b><span>{t('Protein')} · {pctOf(4 * plan.protein)}%</span><i /></div>
              <div className="tone-orange"><b>{fmtInt(plan.carbs)} g</b><span>{t('Carbs')} · {pctOf(4 * plan.carbs)}%</span><i /></div>
              <div className="tone-purple"><b>{fmtInt(plan.fat)} g</b><span>{t('Fat')} · {pctOf(9 * plan.fat)}%</span><i /></div>
            </div>
            {eta && <div className="onb-eta"><Icon name="flag" /><span>{t('{0} around {1}', fmtNum(a.goalWeight) + ' ' + unit, monthOf(eta))}</span></div>}
          </div>
          <h4 className="sec">{t('Every day, also')}</h4>
          <div className="card">
            <div className="measure-form">
              {num('steps', t('Steps'), '')}
              {num('cardio', t('Cardio'), t('min'))}
              {num('sleep', t('Sleep'), t('h'), true)}
              {num('gymDays', t('Gym days a week'), '')}
            </div>
          </div>
          <div className="onb-note"><Icon name="calculator" /><span>{t('A starting point from a formula. After about three weeks of logging, {0} works out your real maintenance from your weigh-ins and your food, and the weekly check-in moves the calories.', APP_NAME)}</span></div>
        </div>
        {last ? foot(a.goal === 'lose' && start > today ? t('Save the plan') : t('Start'), finish, ok.plan) : cont}
      </>
      break
    }

    case 'reminders': content = <>
      <div className="onb-body">
        <Q title={t('Reminders')} sub={t('A nudge to weigh in each morning and to log each evening, skipped on days already done.')} />
        <div className="card">
          {[['weighOn', 'weigh', t('Weigh-in'), t('Every morning, before breakfast'), 'scale'], ['logOn', 'log', t('Log your day'), t('Every evening, if the day is not logged yet'), 'clipboard']].map(([on, key, title, sub, icon]) =>
            <div className="lrow" key={key} style={{ padding: '10px 0' }}>
              <span className="lrow-i" style={{ '--tint': 'var(--indigo)' }}><Icon name={icon} /></span>
              <span className="lrow-m"><span className="lrow-t">{title}</span><span className="lrow-s">{sub}</span></span>
              {a[on] && <input className="field setup-time" type="time" value={a[key]} onChange={e => e.target.value && set(key, e.target.value)} aria-label={title} />}
              <Switch checked={a[on]} onChange={x => set(on, x)} aria-label={title} />
            </div>)}
        </div>
      </div>
      {foot(a.goal === 'lose' && start > today ? t('Save the plan') : t('Start'), finish, ok.reminders)}
    </>; break

    default: content = null
  }

  const shown = steps.filter(id => id !== 'welcome')
  const pos = shown.indexOf(at)
  return <div className="narrow onb" data-step={at}>
    {at !== 'welcome' && <div className="onb-top">
      <button className="iconbtn" onClick={back} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div className="onb-prog" role="progressbar" aria-valuemin={1} aria-valuemax={shown.length} aria-valuenow={pos + 1} aria-label={t('Step {0} of {1}', pos + 1, shown.length)}>
        <span style={{ width: ((pos + 1) / shown.length * 100) + '%' }} />
      </div>
    </div>}
    {content}
  </div>
}
