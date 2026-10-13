// Progress: where the cut stands, from the daily log, the weigh-ins and the workouts.
//
// Top to bottom it answers, in order, the questions a cut raises every week: how much is gone and
// how far is the goal (trend weight, not the morning's reading); is the pace right and what to
// change if not (the verdict, with the one change worth making as a button); was the week what the
// plan asked (the last seven days against each target); is the muscle staying (strength of the
// main lifts against the start); and the week-by-week record under it all. The numbers are worked
// out in lib/cut.js; this screen only words and draws them.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import {
  CUT_DEFAULTS, LB_PER_KG, addDays, carbsFor, cutOf, cutReport, dailyLogCSV, daysBetween, isIso, liftsTrained, logFor,
  weeklyRows,
} from '../lib/cut.js'
import { latestMeasurement, toMeasurementDisplay, measurementUnit } from '../lib/measurements.js'
import { fmtDate, fmtNum, todayISO, weekStartOf, exerciseNameText, DAYS } from '../lib/format.js'
import { checkInDayOf, checkInDayName, checkInFor } from '../lib/checkin.js'
import { exOr } from '../lib/exercises.js'
import { MOBILE, shareExport } from '../lib/mobile.js'
import { t } from '../lib/i18n.js'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, Segmented } from '../components/ui.jsx'
import { DayChips, dailyLogSheet, fmt1, fmtInt, fmtRate, phaseInfo } from '../components/DailyLog.jsx'
import { goalSheet } from '../sheets.jsx'
import PrecutCard from '../components/PrecutCard.jsx'
import { finishCut, startMiniCut } from '../lib/maintain.js'
import { densityReport } from '../lib/density.js'
import { profileOf } from '../lib/setup.js'

const update = fn => useStore.getState().update(fn)
const toast = message => useUI.getState().toast(message)
// English singular/plural through t(): these strings have no translation yet, and tn() keys must
// carry every plural form in the ru/uk/pl packs (i18n-plural.test.js) — t() falls back to English.
const plural = (n, one, other) => t(n === 1 ? one : other, n)
const pct = x => (x == null ? '–' : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(Math.round(x * 100)) + '%')

/* ============================================================== cut settings == */

function CutSettings({ close }) {
  const S = useStore(s => s.S)
  const cut = cutOf(S)
  const per = S.unit === 'lb' ? LB_PER_KG : 1
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const r1 = n => Math.round(n * 10) / 10
  const [v, setV] = useState(() => ({
    start: cut.start || '', goal: S.targetW ?? null,
    kcal: cut.kcal, protein: cut.protein, fat: cut.fat, steps: cut.steps, cardio: cut.cardio, sleep: cut.sleep, gymDays: cut.gymDays,
    minKcal: cut.minKcal, maintenance: cut.maintenance,
    rateMin: r1(cut.rateMin * per), rateMax: r1(cut.rateMax * per),
    rateMode: cut.rateMode, ratePctMin: cut.ratePctMin, ratePctMax: cut.ratePctMax, checkInDay: checkInDayOf(cut),
    breaks: cut.breaks, bFrom: '', bTo: '',
  }))
  const set = (k, val) => setV(x => ({ ...x, [k]: val }))
  const today = todayISO()

  // The holidays coming up next: 23 December to 1 January.
  const xmasFrom = (() => { const y = Number(today.slice(0, 4)) - (today.slice(5) <= '01-01' ? 1 : 0); return `${y}-12-23` })()
  const xmasTo = addDays(xmasFrom, 9)
  const addBreak = (from, to) => {
    if (!isIso(from) || !isIso(to) || from > to) { toast(t('Choose a valid date')); return }
    setV(x => ({ ...x, breaks: [...x.breaks.filter(b => b.from !== from), { from, to }].sort((a, b) => a.from.localeCompare(b.from)), bFrom: '', bTo: '' }))
  }

  const save = () => {
    if (v.rateMode === 'kg' && (v.rateMin == null || v.rateMax == null || v.rateMin >= v.rateMax)) { toast(t('The lowest weekly loss must be below the highest')); return }
    if (v.rateMode === 'pct' && (v.ratePctMin == null || v.ratePctMax == null || v.ratePctMin >= v.ratePctMax)) { toast(t('The lowest weekly loss must be below the highest')); return }
    if (v.start && !isIso(v.start)) { toast(t('Choose a valid date')); return }
    const changed = v.kcal !== cut.kcal || v.steps !== cut.steps
    update(s => {
      s.cut = {
        ...cutOf(s),
        changedAt: changed ? today : cut.changedAt,
        start: v.start || null,
        kcal: v.kcal, protein: v.protein, fat: v.fat, steps: v.steps, cardio: v.cardio, sleep: v.sleep, gymDays: v.gymDays,
        minKcal: v.minKcal, maintenance: v.maintenance, remind: cut.remind,
        rateMin: v.rateMin != null ? Math.round(v.rateMin / per * 100) / 100 : cut.rateMin, rateMax: v.rateMax != null ? Math.round(v.rateMax / per * 100) / 100 : cut.rateMax,
        rateMode: v.rateMode, ratePctMin: v.ratePctMin, ratePctMax: v.ratePctMax, checkInDay: v.checkInDay,
        breaks: v.breaks,
      }
      // cutOf puts the defaults back for anything left empty or out of range
      s.cut = cutOf(s)
      if (v.goal != null && v.goal > 0) s.targetW = Math.round(v.goal * 10) / 10
    })
    toast(t('Plan saved'))
    close()
  }

  const num = (key, label, u, { decimal = false } = {}) => <label className="measure-field" key={key}>
    <span>{label}</span>
    <span className="measure-input"><NumberField nullable decimal={decimal} value={v[key]} onChange={val => set(key, val)} />{u && <i>{u}</i>}</span>
  </label>

  return <>
    <h3 style={{ marginBottom: 4 }}>{t('Cut plan')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('What Progress measures your days against. Empty fields go back to the plan\'s defaults.')}</div>

    <label className="measure-date">
      <span>{t('Start date')}</span>
      <div className="row" style={{ gap: 8 }}>
        <input className="field" type="date" value={v.start} onChange={e => set('start', e.target.value)} />
        <Button size="sm" variant="tinted" onClick={() => set('start', today)}>{t('Today')}</Button>
      </div>
    </label>

    <div className="measure-form">
      {num('goal', t('Goal weight'), unit, { decimal: true })}
      {num('kcal', t('Calories'), 'kcal')}
      {num('protein', t('Protein'), 'g')}
      {num('fat', t('Fat'), 'g')}
      <div className="measure-field"><span>{t('Carbs')}</span>
        <span className="measure-input cut-derived"><b>{v.kcal && v.protein && v.fat ? carbsFor(v.kcal, v.protein, v.fat) : '–'}</b><i>{t('g · the rest')}</i></span></div>
      {num('steps', t('Steps'), '')}
      {num('cardio', t('Cardio a day'), t('min'))}
      {num('sleep', t('Sleep'), t('h'), { decimal: true })}
      {num('gymDays', t('Gym days a week'), '')}
      {num('minKcal', t('Never below'), 'kcal')}
      {num('maintenance', t('Maintenance guess'), 'kcal')}
    </div>

    <label className="sect-t">{t('Weekly loss aimed for')}</label>
    <Segmented className="seg-range" value={v.rateMode} onChange={m => set('rateMode', m)}
      options={[{ value: 'kg', label: unit + t('/wk') }, { value: 'pct', label: t('% of body weight') }]} />
    <div className="measure-form" style={{ marginTop: 8 }}>
      {v.rateMode === 'kg' ? <>
        {num('rateMin', t('Lose at least'), unit + t('/wk'), { decimal: true })}
        {num('rateMax', t('Lose at most'), unit + t('/wk'), { decimal: true })}
      </> : <>
        {num('ratePctMin', t('Lose at least'), t('%/wk'), { decimal: true })}
        {num('ratePctMax', t('Lose at most'), t('%/wk'), { decimal: true })}
      </>}
    </div>
    <div className="muted small" style={{ margin: '8px 2px 16px', lineHeight: 1.45 }}>{v.rateMode === 'kg'
      ? t('A share of body weight slows down in kilos as you get lighter: 0.5–1% a week is the range linked to keeping muscle.')
      : t('In kilos this is less as the weight comes down: 0.7–1% is about 0.74–1.06 kg a week at 106 kg, 0.6–0.85 at 85.')}</div>

    <label className="sect-t">{t('Weekly check-in day')}</label>
    <div className="ci-focus" role="radiogroup" aria-label={t('Weekly check-in day')} style={{ marginBottom: 16 }}>
      {[1, 2, 3, 4, 5, 6, 0].map(d => <button key={d} role="radio" aria-checked={v.checkInDay === d} className={'chip nocap' + (v.checkInDay === d ? ' on' : '')} onClick={() => set('checkInDay', d)}>{t(DAYS[d])}</button>)}
    </div>
    <div className="muted small" style={{ margin: '8px 2px 16px' }}>{t('The maintenance guess is used until Progress works yours out from your log — about three weeks in.')}</div>

    <label className="sect-t">{t('Diet breaks')}</label>
    <div className="sect-b" style={{ marginBottom: 10 }}>
      {v.breaks.map(b => <div className="lrow" key={b.from}>
        <span className="lrow-i" style={{ '--tint': 'var(--blue)' }}><Icon name="sun" /></span>
        <span className="lrow-m"><span className="lrow-t">{fmtDate(b.from, true)} – {fmtDate(b.to, true)}</span>
          <span className="lrow-s">{plural(daysBetween(b.from, b.to) + 1, '{0} day at maintenance', '{0} days at maintenance')}</span></span>
        <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={() => set('breaks', v.breaks.filter(x => x !== b))} aria-label={t('Remove')}><Icon name="trash" /></button>
      </div>)}
      {!v.breaks.length && <div className="lrow"><span className="lrow-m"><span className="lrow-s">{t('None planned. A week or two at maintenance over the holidays keeps the cut going.')}</span></span></div>}
    </div>
    <div className="measure-form cut-break-form">
      <label className="measure-field"><span>{t('From')}</span><input className="field" type="date" value={v.bFrom} onChange={e => set('bFrom', e.target.value)} /></label>
      <label className="measure-field"><span>{t('To')}</span><input className="field" type="date" value={v.bTo} min={v.bFrom || undefined} onChange={e => set('bTo', e.target.value)} /></label>
    </div>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      <Button size="sm" icon="plus" onClick={() => addBreak(v.bFrom, v.bTo)} disabled={!v.bFrom || !v.bTo}>{t('Add break')}</Button>
      {!v.breaks.some(b => b.from === xmasFrom) && <Button size="sm" variant="tinted" icon="sun" onClick={() => addBreak(xmasFrom, xmasTo)}>{t('Add the holidays ({0} – {1})', fmtDate(xmasFrom, true), fmtDate(xmasTo, true))}</Button>}
    </div>

    <div style={{ height: 16 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 6 }} />
    {cut.start && cut.mode !== 'maintain' && <Button variant="ghost" icon="flag" onClick={() => { close(); finishSheet(cutReport(useStore.getState().S, today)) }}>{t('End the cut: maintenance')}</Button>}
    {cut.mode === 'maintain' && <Button variant="ghost" icon="flag" onClick={() => { update(s => { s.cut = startMiniCut(s, { today }) }); toast(t('Cutting again from today.')); close() }}>{t('Back to cutting')}</Button>}
    <Button variant="ghost" className="dim" onClick={() => setV(x => ({ ...x, ...CUT_DEFAULTS, start: x.start, goal: x.goal, breaks: x.breaks, checkInDay: x.checkInDay, rateMin: r1(CUT_DEFAULTS.rateMin * per), rateMax: r1(CUT_DEFAULTS.rateMax * per) }))}>{t('Reset targets to the plan')}</Button>
  </>
}

export const cutSettingsSheet = () => useUI.getState().openSheet(close => <CutSettings close={close} />)

/* ============================================================== how it works == */

function HowItWorks({ r, close }) {
  const p = (title, body) => <div className="cut-how" key={title}><b>{title}</b><p>{body}</p></div>
  return <>
    <h3>{t('How Progress works')}</h3>
    {p(t('Trend weight'), t('Your weigh-ins smoothed into one line. Water, salt and carbs move the scale by a kilo or two from one morning to the next; the trend ignores that and follows what is really happening. It does not lag a week behind, the way a plain average does.'))}
    {p(t('Weekly pace'), t('The trend\'s slope. Losing about 0.5–1% of your body weight a week is the range linked to keeping muscle while dieting; your plan says {0}–{1} a week.', fmt1(r.rateMin), fmt1(r.rateMax) + ' ' + r.unit))}
    {p(t('Maintenance'), t('What you eat against how your weigh-ins move: about 7,700 kcal per kg lost. Ready after about three weeks of logging calories; the first week is left out because it is mostly water.'))}
    {p(t('Stalls'), t('The weekly average dropping less than the plan\'s lowest pace two weeks in a row: 100 kcal less a day, never under your floor — at the floor, 2,000 more steps instead. One slow week is noise. After any change it waits two weeks before suggesting another.'))}
    {p(t('Strength check'), t('The estimated one-rep max of your key lifts (or the six you train most), averaged over their last three sessions, against the three before the cut. In a deficit strength usually holds, so a drop across the main lifts is a signal, and the log usually shows why: sleep, protein, the pace.'))}
    {p(t('Diet breaks'), t('Days at maintenance, part of the plan: its line stands still through them, the dates ahead move by them, and the maintenance estimate keeps its value from before the break, leaving out the break and the week after it. The scale goes up with the water of the extra carbs and comes back off in that week, which is why it gives no pace advice. The aim over the break is the trend at most 0.5 kg up (the holiday weighing studies). Breaks in a long diet did not cost muscle and helped fat loss in studies (MATADOR).'))}
    <div className="muted small" style={{ lineHeight: 1.5, margin: '6px 2px 14px' }}>
      {t('Sources: Helms et al. 2014, JISSN (rate, protein); Garthe et al. 2011, IJSNEM (slower loss kept more lean mass); Byrne et al. 2018, Int J Obes (MATADOR diet breaks); Steinberg et al. 2013, Obesity (daily weighing); MacroFactor expenditure method (energy balance).')}
    </div>
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}

/* ===================================================================== screen == */

/**
 * The trend over a break, against the day before it began: during the break, with its target (the
 * holiday studies' +0.5 kg; a little more is the water of the extra carbs, more than a kilo is
 * food); in the week back, the real change the break made, the water still in it said as such.
 */
function BreakResult({ b, unit, per }) {
  const d = b.delta
  const tone = d <= b.target ? 'good' : d <= 2 * b.target ? 'warn' : 'bad'
  const sign = (d > 0.05 ? '+' : d < -0.05 ? '−' : '±') + fmt1(Math.abs(d)) + ' ' + unit
  return <div className={'cut-break ' + tone}>
    <div className="cut-break-n"><b>{sign}</b><span>{t('trend since {0}', fmtDate(b.pre, true))}</span></div>
    <div className="cut-break-t">{b.back
      ? (d <= b.target ? t('The break, all told: within the +{0} target. What is left of it is water and comes off this week.', fmt1(b.target) + ' ' + unit)
        : t('The break, all told, with this week\'s water still in it. Compare again on {0}: what is left then is real.', fmtDate(b.until, true)))
      : (d <= b.target ? t('Within the target of at most +{0}. Keep the portions at maintenance.', fmt1(b.target) + ' ' + unit)
        : d <= 2 * b.target ? t('Over the +{0} target. Part of it is water from the extra carbs; keep the portions at maintenance.', fmt1(b.target) + ' ' + unit)
          : t('Well over the +{0} target: more than water. Weigh the portions again and log every meal until the break ends.', fmt1(b.target) + ' ' + unit))}</div>
  </div>
}

/* Ending the cut: maintenance straight away, or a third of the way now and the rest at the check-ins. */
function FinishCut({ r, close }) {
  const today = todayISO()
  const tdee = r.tdee.ready ? r.tdee.tdee : r.cut.maintenance
  const go = gradual => {
    update(s => { s.cut = finishCut(s, { trendW: r.trendW, tdee, today, gradual }) })
    toast(t('Maintenance from today. Keep weighing every morning.'))
    close()
  }
  const third = Math.round((r.cut.kcal + (Math.round(tdee / 10) * 10 - r.cut.kcal) / 3) / 10) * 10
  return <>
    <h3 style={{ marginBottom: 4 }}>{t('End the cut')}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
      {t('From today the trend is held at {0}. Green up to +{1}, yellow up to +{2} (two weeks of full logging), red above (a mini-cut). Daily weighing is what kept the weight off in the studies; it stays.', fmtNum(r.trendW) + ' ' + r.unit, fmt1(1.4 * r.per), fmt1(2.3 * r.per))}
    </div>
    <Button variant="primary" onClick={() => go(false)}>{t('Straight to maintenance: {0} kcal', fmtInt(tdee))}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={() => go(true)}>{t('Step up: {0} kcal now, the rest at the check-ins', fmtInt(third))}</Button>
    <div className="small dim" style={{ marginTop: 10, lineHeight: 1.45 }}>{r.tdee.ready
      ? t('Maintenance as worked out from your log.') : t('Maintenance is the plan\'s guess: the log has not worked one out yet.')}</div>
  </>
}

const finishSheet = r => useUI.getState().openSheet(close => <FinishCut r={r} close={close} />)

/* The zone after the cut, against the end weight: a bar from the end weight to the red line. */
function ZoneBar({ r }) {
  const z = r.zone
  if (!z) return null
  const max = z.yellow * 1.5
  const pos = Math.max(0, Math.min(100, (Math.max(-max * 0.2, z.delta) + max * 0.2) / (max * 1.2) * 100))
  const at = v => (v + max * 0.2) / (max * 1.2) * 100
  return <div className="zone">
    <div className="zone-bar">
      <span className="g" style={{ width: at(z.green) + '%' }} />
      <span className="y" style={{ width: at(z.yellow) - at(z.green) + '%' }} />
      <span className="r" style={{ flex: 1 }} />
      <i style={{ insetInlineStart: pos + '%' }} />
    </div>
    <div className="row between small dim"><span>{fmtNum(r.cut.endW)} {r.unit}</span><span>+{fmt1(z.green)}</span><span>+{fmt1(z.yellow)}</span></div>
  </div>
}

function Verdict({ r, S }) {
  const info = phaseInfo(r.phase, r.zone)
  const unit = r.unit
  const cut = r.cut
  const why = {
    ok: t('Right in the range the plan aims for. Keep everything as it is.'),
    early: t('The first week is mostly water and glycogen, so the scale drops fast. The real pace shows from week two.'),
    slow: t('Below the range this week. One slow week is often water: keep logging carefully and give it another week.'),
    stall: r.settling ? t('Below the range two weeks running, but the plan has just changed. Give the change its two weeks.') : t('Below the range two weeks running. Time for a small change.'),
    fast: r.action ? t('Faster than the range and your lifts are slipping: eat a little more.') : t('Faster than the range. Fine while your lifts hold and you feel good; watch recovery.'),
    gain: t('The trend is going up. Check that every bite and drink is logged before changing the plan.'),
    break: t('Eat at maintenance until the break ends. The plan stands still meanwhile: nothing falls behind, and the maintenance estimate keeps its value from before the break.'),
    water: t('Back from the break, on the plan\'s calories again. The water the break put on comes off this week, so the scale drops fast: that is not the pace, and nothing is changed for it.'),
    stale: t('Weigh in most mornings (after the toilet, before eating) and the trend comes back.'),
    maintain: r.zone?.zone === 'red' ? t('More than {0} over the weight the cut ended at. Time for a mini-cut: three to four weeks on the cut\'s calories.', fmt1(r.zone.yellow) + ' ' + unit)
      : r.zone?.zone === 'yellow' ? t('Between {0} and {1} over the end weight. Two weeks of logging every bite at maintenance brings it back.', fmt1(r.zone.green), fmt1(r.zone.yellow) + ' ' + unit)
        : t('Within {0} of the weight the cut ended at. Keep weighing every morning: that habit is what kept the weight off.', fmt1(r.zone?.green ?? 1.4) + ' ' + unit),
    noweight: t('Log your weight to start the trend.'),
  }[r.phase]
  const apply = () => {
    if (!r.action) return
    update(s => {
      const c = cutOf(s)
      if (r.action.kind === 'kcal') c.kcal = r.action.value
      else c.steps = r.action.value
      c.changedAt = todayISO()
      s.cut = c
    })
    toast(r.action.kind === 'kcal' ? t('Calorie target set to {0}', fmtInt(r.action.value)) : t('Step target set to {0}', fmtInt(r.action.value)))
  }
  const adviceText = a => {
    switch (a.code) {
      case 'settling': return t('You changed the plan on {0}. Give it until {1} to show on the scale before changing anything else.', fmtDate(a.since, true), fmtDate(a.until, true))
      case 'break': return t('Diet break until {0}: about {1} kcal a day.', fmtDate(a.to, true), fmtInt(a.kcal))
      case 'water': return t('Water week until {0}: {1} kcal a day. The pace and the maintenance estimate pick up again after it.', fmtDate(a.until, true), fmtInt(a.kcal))
      case 'break-soon': return t('Diet break from {0}: about {1} kcal a day.', fmtDate(a.from, true), fmtInt(a.kcal))
      case 'log-kcal': return t('Calories logged on {0} of the last 7 days. Six or more keeps the numbers honest.', a.n)
      case 'weigh-more': return t('{0} weigh-ins in the last 7 days. Daily weighing makes the trend sharper.', a.n)
      case 'protein-low': return t('Protein averaged {0} g. Aim for {1} g every day to hold on to muscle.', fmtInt(a.avg), fmtInt(a.target))
      case 'kcal-too-low': return t('Averaging {0} kcal, under your floor of {1}. Too little for this much training.', fmtInt(a.avg), fmtInt(a.floor))
      case 'sleep-low': return t('Sleep averaged {0} h. Under 7 h hurts recovery and makes hunger worse.', fmtNum(a.avg))
      case 'steps-low': return t('Steps averaged {0}, target {1}.', fmtInt(a.avg), fmtInt(a.target))
      case 'alcohol': return plural(a.n, '{0} day with alcohol this week.', '{0} days with alcohol this week.')
      case 'fatigue': return t('Low energy and high hunger all week. A week or two at maintenance (a diet break) can reset both.')
      case 'strength-drop': return t('Your main lifts are down {0}% from the start. Keep the weights heavy, eat a bit more around training.', Math.abs(a.pct))
      case 'tdee': return t('Your maintenance is about {0} kcal. Eating {1} kcal a day loses about {2} a week.', fmtInt(a.tdee), fmtInt(a.kcal), fmt1(a.rate) + ' ' + unit)
      default: return null
    }
  }
  return <div className={'card cut-verdict ' + info.tone}>
    <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
      <span className="cut-vic"><Icon name={info.icon} /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="cut-vt">{info.label}</div>
        {r.lossWk != null && r.phase !== 'noweight' && <div className="small muted" style={{ marginTop: 2 }}>
          {fmtRate(r.lossWk, unit)}{r.ratePct != null && ` · ${fmt1(Math.abs(r.ratePct))}% ${t('of body weight')}`}
        </div>}
        {(r.phase === 'stall' || r.phase === 'slow') && r.weekDrops && <div className="small muted">
          {t('Weekly average: {0}, then {1}', ...r.weekDrops.map(x => (x > 0.05 ? '−' : x < -0.05 ? '+' : '') + fmt1(Math.abs(x)) + ' ' + unit))}
        </div>}
        {r.maintaining ? <div className="small dim">{t('Held at {0} since {1}', fmtNum(r.cut.endW) + ' ' + unit, fmtDate(r.cut.endedAt, true))}</div>
          : r.phase === 'break'
          ? <div className="small dim">{t('Aim over the break: the trend at most +{0}', fmt1(r.breakResult?.target ?? 0.5 * r.per) + ' ' + unit)}</div>
          : <div className="small dim">{r.band.mode === 'pct'
            ? t('Aim: {0}–{1}% of body weight a week ({2})', fmt1(r.band.pctMin), fmt1(r.band.pctMax), fmt1(r.rateMin) + '–' + fmt1(r.rateMax) + ' ' + unit)
            : r.band.pctMin != null ? t('Aim: {0}–{1} a week ({2}% of body weight)', fmt1(r.rateMin), fmt1(r.rateMax) + ' ' + unit, fmt1(r.band.pctMin) + '–' + fmt1(r.band.pctMax))
              : t('Aim: {0}–{1} a week', fmt1(r.rateMin), fmt1(r.rateMax) + ' ' + unit)}</div>}
      </div>
    </div>
    {why && <p className="cut-vp">{why}</p>}
    {r.breakResult && <BreakResult b={r.breakResult} unit={unit} per={r.per} />}
    {r.maintaining && <ZoneBar r={r} />}
    {r.maintaining && r.zone?.zone === 'red' && <Button size="sm" variant="tinted" icon="flag" onClick={() => { update(s => { s.cut = startMiniCut(s, { today: todayISO() }) }); toast(t('Mini-cut from today: {0} kcal.', fmtInt(cutOf(useStore.getState().S).kcal))) }}>{t('Start a mini-cut')}</Button>}
    {r.action && <Button size="sm" variant="tinted" icon="check" onClick={apply}>
      {r.action.kind === 'kcal' ? t('Set calories to {0} (was {1})', fmtInt(r.action.value), fmtInt(cut.kcal)) : t('Set steps to {0} (was {1})', fmtInt(r.action.value), fmtInt(cut.steps))}
    </Button>}
    {r.advice.length > 0 && <ul className="cut-adv">
      {r.advice.map((a, i) => { const text = adviceText(a); return text && <li key={i} className={a.code === 'tdee' || a.code.startsWith('break') ? 'info' : ''}><Icon name={a.code === 'tdee' ? 'calculator' : a.code.startsWith('break') ? 'sun' : 'info'} /><span>{text}</span></li> })}
    </ul>}
    {S.targetW == null && <Button size="sm" variant="plain" icon="target" onClick={goalSheet}>{t('Set a goal weight')}</Button>}
  </div>
}

/* The lifts the strength check follows: four to six chosen, or the most-trained ones. */
function KeyLifts({ close }) {
  const S = useStore(s => s.S)
  const cut = cutOf(S)
  const today = todayISO()
  const from = cut.start ? addDays(cut.start, -28) : addDays(today, -56)
  const trained = liftsTrained(S, from, today).slice(0, 24)
  const [picked, setPicked] = useState(() => cut.keyLifts.slice())
  const toggle = id => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : p.length >= 6 ? p : [...p, id]))
  const save = () => {
    update(s => { const c = cutOf(s); c.keyLifts = picked; s.cut = cutOf({ cut: c }) })
    toast(picked.length ? t('The strength check follows {0} lifts', picked.length) : t('The strength check follows your most-trained lifts'))
    close()
  }
  return <>
    <h3 style={{ marginBottom: 4 }}>{t('Key lifts')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>{t('Pick four to six: a squat, a hinge, a press, a pull. None picked, it follows the six you train most.')}</div>
    {trained.length ? <div className="sect-b">
      {trained.map(x => <div className="lrow tap" key={x.id} role="checkbox" aria-checked={picked.includes(x.id)} tabIndex={0} onClick={() => toggle(x.id)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(x.id) } }}>
        <span className="lrow-m"><span className="lrow-t" style={{ textTransform: 'capitalize' }}>{exerciseNameText(exOr(x.id))}</span>
          <span className="lrow-s">{plural(x.sessions, '{0} session', '{0} sessions')}</span></span>
        <span className={'menu-on' + (picked.includes(x.id) ? ' is-on' : '')}><Icon name="check" /></span>
      </div>)}
    </div> : <div className="muted small">{t('Log your lifts with sets, reps and weight and they show up here.')}</div>}
    <div className="small dim" style={{ margin: '8px 2px 14px' }}>{t('{0} of 6 picked', picked.length)}</div>
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}

const CAUSE_TEXT = {
  sleep: c => t('Sleep averaged {0} h: under 7 h cuts muscle building in a deficit.', fmtNum(c.avg)),
  protein: c => t('Protein averaged {0} g of {1} g.', fmtInt(c.avg), fmtInt(c.target)),
  pace: c => t('Losing {0} a week, faster than the range: a smaller deficit protects strength.', fmtRate(c.lossWk, '').replace(/[−+]/, '').trim() + (c.ratePct != null ? ` (${fmt1(Math.abs(c.ratePct))}%)` : '')),
  kcal: c => t('Eating {0} kcal on average, under your floor of {1}.', fmtInt(c.avg), fmtInt(c.floor)),
  alcohol: c => plural(c.n, 'Alcohol on {0} day in two weeks.', 'Alcohol on {0} days in two weeks.'),
  energy: () => t('Energy logged low most days: recovery is short.'),
}

function StrengthCard({ r, S }) {
  const st = r.strength
  const unit = r.unit
  return <div className="card">
    <div className="row between" style={{ marginBottom: 8, gap: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Strength check')}</h2>
      <div className="row" style={{ gap: 6 }}>
        {st.ready && <span className={'cut-tag ' + (st.status === 'hold' ? 'good' : st.status === 'slip' ? 'warn' : 'bad')}>
          {st.status === 'hold' ? t('Holding') : st.status === 'slip' ? t('Slipping') : t('Dropping')}</span>}
        {r.cut.start && <button className="iconbtn" onClick={() => useUI.getState().openSheet(close => <KeyLifts close={close} />)} aria-label={t('Key lifts')}><Icon name="slider" /></button>}
      </div>
    </div>
    {st.ready ? <>
      <div className="muted small" style={{ marginBottom: 6 }}>{st.chosen ? t('Your key lifts: estimated 1RM, the last 3 sessions against the 3 before the cut') : t('Your most-trained lifts: estimated 1RM, the last 3 sessions against the 3 before the cut')}</div>
      {st.lifts.map(l => <div className="cut-lift" key={l.id}>
        <span className="cut-lift-n">{exerciseNameText(exOr(l.id))}</span>
        <span className="cut-lift-v">{fmtNum(l.base)} → <b>{fmtNum(l.recent)}</b> {unit}</span>
        <span className={'cut-lift-p ' + (l.pct >= -0.03 ? 'good' : l.pct >= -0.07 ? 'warn' : 'bad')}>{pct(l.pct)}</span>
      </div>)}
      {st.status !== 'hold' && <div className="cut-causes">
        <b>{st.causes.length ? t('What may be behind it') : t('Nothing in the log stands out')}</b>
        {st.causes.length ? <ul>{st.causes.map(c => <li key={c.code}>{CAUSE_TEXT[c.code]?.(c)}</li>)}</ul>
          : <p>{t('Sleep, protein and the pace look right. Keep the weights heavy and check again next week: one bad week is not a trend.')}</p>}
      </div>}
    </> : <div className="muted small" style={{ lineHeight: 1.5 }}>
      {st.reason === 'nostart' ? t('Starts once the cut has a start date. Keep logging your workouts here.')
        : st.reason === 'early' ? plural(st.inDays, 'Ready in {0} day: it compares your last sessions with the ones before the cut.', 'Ready in {0} days: it compares your last sessions with the ones before the cut.')
          : t('Log your lifts with sets, reps and weight and they show up here.')}
    </div>}
  </div>
}

/* Food volume against hunger (lib/density.js): the calories in each gram, and what full days share. */
function DensityCard({ S, today }) {
  const d = useMemo(() => densityReport(S, today), [S, today])
  if (!d.days) return null
  const g = n => (n == null ? '–' : fmtInt(n) + ' g')
  const k = n => (n == null ? '–' : fmt1(n))
  const col = (title, x, tone) => <div className={'dens-col ' + tone}>
    <b>{title}</b>
    <span><i>{k(x.density)}</i> {t('kcal/g')}</span>
    <span><i>{g(x.grams)}</i> {t('of food')}</span>
    <span><i>{x.protein != null ? fmtInt(x.protein) + ' g' : '–'}</i> {t('protein')}</span>
    <span><i>{x.sleep != null ? fmtNum(x.sleep) + ' ' + t('h') : '–'}</i> {t('sleep')}</span>
  </div>
  const denser = d.ready && d.hungry.density != null && d.full.density != null && d.hungry.density - d.full.density >= 0.15
  return <div className="card">
    <h2 style={{ margin: '0 0 4px' }}>{t('Hunger and food volume')}</h2>
    <div className="small muted" style={{ marginBottom: 10 }}>
      {d.week.n ? t('Last 7 days: {0} kcal per gram, about {1} of food a day', k(d.week.density), g(d.week.grams)) : t('Weighed food from the last four weeks')}
    </div>
    {d.ready ? <>
      <div className="dens">
        {col(t('Full days (hunger 1–2)'), d.full, 'good')}
        {col(t('Hungry days (4–5)'), d.hungry, 'warn')}
      </div>
      <div className="small" style={{ marginTop: 10, lineHeight: 1.45, color: 'var(--label-2)' }}>
        {denser ? t('On hungry days the food was denser: the same calories as less food. Vegetables, fruit, soups and lean protein add weight without the calories.')
          : t('Density is not what sets your full days apart: look at protein and sleep beside it.')}
      </div>
    </> : <div className="small muted" style={{ lineHeight: 1.45 }}>{t('Rate your hunger in the daily log (1–5) and weigh the food: after three full and three hungry days this shows what the full ones have in common.')}</div>}
  </div>
}

/* The weekly check-ins (views/WeeklyCheckIn.jsx): the last few, and the way in any day. */
function CheckIns({ S, r, today }) {
  const nav = useNavigate()
  const list = (S.checkIns || []).slice(-5).reverse()
  const ci = checkInFor(S, today)
  const unit = r.unit
  return <div className="card">
    <div className="row between" style={{ marginBottom: list.length ? 6 : 0, gap: 8 }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0 }}>{t('Check-ins')}</h2>
        <div className="small muted">{ci?.due ? t('Due today') : t('Every {0}', t(checkInDayName(r.cut)))}</div>
      </div>
      <Button size="sm" variant={ci?.due ? 'tinted' : 'plain'} icon="calendar" onClick={() => nav('/weekly')}>{ci?.due ? t('Start') : t('Check in now')}</Button>
    </div>
    {list.map(c => <div className="ci-hist" key={c.d}>
      <b>{fmtDate(c.d, true)}</b>
      <span>{c.focus?.text || (c.week?.lossWk != null ? fmtRate(c.week.lossWk, unit) : '')}</span>
      <i>{c.kcalTo != null && c.kcalFrom != null && c.kcalTo !== c.kcalFrom ? `${fmtInt(c.kcalFrom)} → ${fmtInt(c.kcalTo)}` : c.stepsTo ? t('{0} steps', fmtInt(c.stepsTo)) : t('kept {0}', fmtInt(c.kcalTo ?? c.kcalFrom))}</i>
    </div>)}
  </div>
}

function Tile({ icon, label, value, sub, tone }) {
  return <div className="tile cut-tile">
    <div className="l"><Icon name={icon} />{label}</div>
    <div className={'v' + (tone ? ' ' + tone : '')}>{value}</div>
    {sub && <div className="cut-ts">{sub}</div>}
  </div>
}

export default function Progress() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = todayISO()
  const r = useMemo(() => cutReport(S, today), [S, today])
  const [range, setRange] = useState(90)
  const cut = r.cut
  const unit = r.unit
  const w7 = r.week7
  const ws = weekStartOf(S)
  const weeks = useMemo(() => {
    const from = cut.start || addDays(today, -55)
    return weeklyRows(S, from, today, ws, cut, today, r.maintenance).slice(0, 26)
  }, [S, cut, today, ws, r.maintenance])

  // The chart: scale readings as dots, the trend as the line, the plan's pace dashed.
  const chart = useMemo(() => {
    const from = range ? addDays(today, -range) : '0000-00-00'
    const ms = d => new Date(d + 'T12:00:00').getTime()
    const tr = r.trend.filter(p => p.d >= from)
    const scale = tr.filter(p => p.w != null).map(p => ({ t: ms(p.d), y: p.w, d: p.d }))
    const line = tr.map(p => ({ t: ms(p.d), y: Math.round(p.L * 100) / 100, d: p.d, note: p.w != null ? t('scale {0}', fmtNum(p.w)) : undefined }))
    const series = [
      { points: scale, color: 'var(--label-3)', line: false, r: 2.2 },
      { points: line, color: 'var(--acc)', width: 2.6, dots: false },
    ]
    if (r.started && r.startW != null && r.goalW != null && r.startW > r.goalW) {
      const a = cut.start >= from ? cut.start : from
      const b = today
      // flat through each break: the plan stands still there (lib/cut.js dietDays); a pace set as a
      // share of body weight curves, so it gets a point a week
      const turns = cut.breaks.flatMap(x => [addDays(x.from, 1), addDays(x.to, 1)]).filter(d => d > a && d < b)
      const weekly = cut.rateMode === 'pct' ? Array.from({ length: Math.floor(daysBetween(a, b) / 7) }, (_, i) => addDays(a, 7 * (i + 1))).filter(d => d < b) : []
      const pts = [...new Set([a, ...turns, ...weekly, b])].sort().map(d => ({ t: ms(d), y: r.planAt(d), d }))
      if (a < b) series.push({ points: pts, color: 'var(--yellow)', width: 1.4, dash: '5 5', dots: false })
    }
    return { line, series }
  }, [r, range, today, cut.start])

  const waist = latestMeasurement(S, 'waist')
  const waistStart = useMemo(() => {
    if (!cut.start) return null
    const first = (S.measurements || []).filter(m => m.waist != null && m.d >= addDays(cut.start, -7)).sort((a, b) => a.d.localeCompare(b.d))[0]
    return first || null
  }, [S.measurements, cut.start])
  // waist-to-height: the waist in cm over the height in cm (both from the profile), under 0.5 healthy
  const heightCm = profileOf(S).heightCm
  const whtr = waist && heightCm ? waist.value / heightCm : null
  const waistDelta = waist && waistStart && waist.entry.d !== waistStart.d ? toMeasurementDisplay(waist.value, S.unit) - toMeasurementDisplay(waistStart.waist, S.unit) : null

  const exportCsv = async () => {
    const csv = dailyLogCSV(S)
    const name = 'opengym-daily-log-' + today + '.csv'
    if (MOBILE) { try { await shareExport(csv, name) } catch { /* share sheet dismissed */ } return }
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    toast(t('CSV saved'))
  }

  const startToday = () => { update(s => { s.cut = { ...cutOf(s), start: today } }); toast(t('Cut started. Log your weight every morning.')) }
  const recent = Array.from({ length: 14 }, (_, i) => addDays(today, -i))
  const con = r.consistency
  const kcalTone = w7.kcal.n ? (w7.kcal.avg <= cut.kcal + 100 && w7.kcal.avg >= cut.kcal - 300 ? 'good' : 'warn') : ''

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 10, minWidth: 0 }}>
        <h1>{t('Progress')}</h1>
        <div className="sub">{r.maintaining ? t('Maintenance · since {0}', fmtDate(r.cut.endedAt || today, true)) : r.started ? t('Cut · week {0} · day {1}', r.week, r.dayN) : t('Weight, food and training together')}</div>
      </div>
      <button className="iconbtn" onClick={cutSettingsSheet} aria-label={t('Cut plan')}><Icon name="gear" /></button>
    </div>

    {(!cut.start || cut.start > today) && <PrecutCard />}

    {!cut.start && <div className="card">
      <div className="row" style={{ gap: 10, marginBottom: 8 }}>
        <span className="lrow-i" style={{ '--tint': 'var(--indigo)' }}><Icon name="flag" /></span>
        <div className="big" style={{ fontSize: 22 }}>{t('Start your cut')}</div>
      </div>
      <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.5 }}>
        {t('Targets: {0} kcal, {1} g protein, {2} steps, {3} min cardio a day, {4} h sleep. Change them any time with the gear.', fmtInt(cut.kcal), fmtInt(cut.protein), fmtInt(cut.steps), fmtInt(cut.cardio), fmtNum(cut.sleep))}
      </div>
      <Button variant="primary" icon="flag" onClick={() => nav('/setup')}>{t('Set up my plan')}</Button>
      <div style={{ height: 8 }} /><Button onClick={startToday}>{t('Start today with these targets')}</Button>
    </div>}
    {cut.start && cut.start > today && <div className="card row" style={{ gap: 12 }}>
      <span className="lrow-i" style={{ '--tint': 'var(--indigo)' }}><Icon name="flag" /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{t('The cut starts {0}', fmtDate(cut.start, true))}</div>
        <div className="small muted">{plural(daysBetween(today, cut.start), '{0} day to go. Weigh in and log meanwhile: the trend and your maintenance get a head start.', '{0} days to go. Weigh in and log meanwhile: the trend and your maintenance get a head start.')}</div>
      </div>
    </div>}

    {r.trend.length > 0 && <div className="card cut-hero">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="muted small">{t('Trend weight')}</div>
          <div className="big">{fmtNum(r.trendW)} <span className="muted" style={{ fontSize: '1rem' }}>{unit}</span></div>
          <div className="small dim" style={{ marginTop: 3 }}>{r.cur.d === today ? t('today') : fmtDate(r.cur.d, true)}{r.cur.w != null && ' · ' + t('scale {0}', fmtNum(r.cur.w))}</div>
        </div>
        {r.lost != null && <div style={{ textAlign: 'end' }}>
          <div className="muted small">{t('Lost so far')}</div>
          <div className="big" style={{ color: r.lost > 0 ? 'var(--green)' : 'var(--label)' }}>{r.lost > 0 ? '−' : '+'}{fmtNum(Math.abs(r.lost))}</div>
          <div className="small dim" style={{ marginTop: 3 }}>{t('since {0}', fmtDate(cut.start, true))}</div>
        </div>}
      </div>
      {r.pctDone != null && <>
        <div className="cut-bar" role="progressbar" aria-valuenow={Math.round(r.pctDone * 100)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: Math.max(2, r.pctDone * 100) + '%' }} />
        </div>
        <div className="row between small muted">
          <span>{fmtNum(r.startW)}</span><span><b style={{ color: 'var(--label)' }}>{Math.round(r.pctDone * 100)}%</b></span><span style={{ color: 'var(--yellow)' }}>{fmtNum(r.goalW)} {unit}</span>
        </div>
      </>}
      {r.toGo != null && r.toGo > 0 && <div className="small" style={{ marginTop: 10, color: 'var(--label-2)', lineHeight: 1.45 }}>
        {t('{0} to go', fmtNum(r.toGo) + ' ' + unit)}
        {r.eta && <> · {t('about {0} at this pace', fmtDate(r.eta, true, true))}</>}
        {!r.eta && r.planEta && <> · {t('about {0} at {1}', fmtDate(r.planEta, true, true), fmt1(r.rateMid) + ' ' + unit + t('/wk'))}</>}
        {r.vsPlan != null && Math.abs(r.vsPlan) >= 0.3 * r.per && <> · <span style={{ color: r.vsPlan < 0 ? 'var(--green)' : 'var(--orange)' }}>{r.vsPlan < 0 ? t('{0} ahead of plan', fmtNum(-r.vsPlan) + ' ' + unit) : t('{0} behind plan', fmtNum(r.vsPlan) + ' ' + unit)}</span>{r.planHeld && <span className="dim"> {t('(as before the break)')}</span>}</>}
      </div>}
      {r.toGo != null && r.toGo <= 0 && !r.maintaining && <div className="row between" style={{ marginTop: 10, gap: 8 }}>
        <span className="small" style={{ color: 'var(--green)', fontWeight: 600 }}>{t('Goal reached!')}</span>
        <Button size="sm" variant="tinted" icon="flag" onClick={() => finishSheet(r)}>{t('Start maintenance')}</Button>
      </div>}
    </div>}

    <Verdict r={r} S={S} />

    {cut.start && cut.start <= today && <CheckIns S={S} r={r} today={today} />}

    <div className="row between" style={{ margin: '18px 2px 10px' }}>
      <h4 className="sec" style={{ margin: 0 }}>{t('Last 7 days')}</h4>
      <Button size="sm" variant="ghost" icon="plus" onClick={() => dailyLogSheet(today)}>{logFor(S, today) ? t('Edit today') : t('Log today')}</Button>
    </div>
    <div className="tiles">
      <Tile icon="flame" label={t('Calories')} value={fmtInt(w7.kcal.avg)} tone={kcalTone}
        sub={t('target {0} · {1}/7 on target', fmtInt(cut.kcal), w7.kcal.hit)} />
      <Tile icon="bolt" label={t('Protein')} value={w7.protein.n ? fmtInt(w7.protein.avg) + ' g' : '–'} tone={w7.protein.n ? (w7.protein.avg >= cut.protein * 0.9 ? 'good' : 'warn') : ''}
        sub={t('target {0} g', fmtInt(cut.protein))} />
      <Tile icon="steps" label={t('Steps')} value={fmtInt(w7.steps.avg)} tone={w7.steps.n ? (w7.steps.avg >= cut.steps ? 'good' : w7.steps.avg >= cut.steps * 0.8 ? '' : 'warn') : ''}
        sub={t('target {0}', fmtInt(cut.steps))} />
      <Tile icon="figureRun" label={t('Cardio')} value={fmtInt(w7.cardio.total) + ' ' + t('min')} tone={w7.cardio.total >= cut.cardio * 7 ? 'good' : ''}
        sub={t('target {0} a week', fmtInt(cut.cardio * 7))} />
      <Tile icon="dumbbell" label={t('Gym')} value={w7.gym + ' / ' + cut.gymDays} tone={w7.gym >= cut.gymDays ? 'good' : ''}
        sub={t('sessions this week')} />
      <Tile icon="moon" label={t('Sleep')} value={w7.sleep.n ? fmtNum(w7.sleep.avg) + ' ' + t('h') : '–'} tone={w7.sleep.n ? (w7.sleep.avg >= 7 ? 'good' : 'warn') : ''}
        sub={t('target {0} h', fmtNum(cut.sleep))} />
      <Tile icon="calculator" label={t('Maintenance')} value={r.tdee.ready ? fmtInt(r.tdee.tdee) : '≈ ' + fmtInt(cut.maintenance)}
        sub={r.tdee.ready ? (r.tdee.held ? t('held from {0} over the break', fmtDate(r.tdee.asOf, true)) : t('from your last {0} days', r.tdee.span + 1)) : t('estimated after ~3 weeks of logging')} />
      <Tile icon="shield" label={t('Alcohol-free')} value={`${con.dry.n} / ${con.dry.of}`} tone={con.dry.of > 0 && con.dry.n === con.dry.of ? 'good' : ''}
        sub={plural(con.dry.best, 'days this week · best run {0} day', 'days this week · best run {0} days')} />
      {waist && <Tile icon="ruler" label={t('Waist')} value={fmtNum(toMeasurementDisplay(waist.value, S.unit)) + ' ' + measurementUnit(S.unit)} tone={waistDelta != null && waistDelta < 0 ? 'good' : ''}
        sub={[waistDelta != null ? t('{0} since the start', (waistDelta > 0 ? '+' : '−') + fmtNum(Math.abs(waistDelta)) + ' ' + measurementUnit(S.unit)) : fmtDate(waist.entry.d, true),
          whtr != null ? t('{0} of your height · under 0.5 is the healthy range', whtr.toFixed(2)) : null].filter(Boolean).join(' · ')} />}
      <Tile icon="clipboard" label={t('Logged')} value={`${con.log.n} / ${con.log.of}`} tone={con.log.of > 0 && con.log.n >= con.log.of - 1 ? 'good' : ''}
        sub={t('weighed {0} / {1} · best run {2}', con.weigh.n, con.weigh.of, plural(con.log.best, '{0} day', '{0} days'))} />
    </div>

    {r.trend.length > 0 && <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{t('Weight')}</h2>
        <div className="cut-legend small muted"><i className="dot" />{t('scale')}<i className="ln" />{t('trend')}{chart.series.length > 2 && <><i className="pl" />{t('plan')}</>}</div>
      </div>
      <Segmented className="seg-range" value={range} onChange={setRange}
        options={[{ value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 0, label: t('All') }]} />
      {/* No goal line here: 15 kg below the data it squashed a month of the trend into a flat stripe.
          The goal and how far it is are on the card at the top. */}
      <div className="chart"><LineChart points={chart.line} series={chart.series} h={170} unit={unit} /></div>
    </div>}

    <StrengthCard r={r} S={S} />
    <DensityCard S={S} today={today} />

    <h4 className="sec">{t('Week by week')}</h4>
    {weeks.length ? <div className="list">{weeks.map(w => <div className="card cut-wk" key={w.key}>
      <div className="row between">
        <b>{t('Week of {0}', fmtDate(w.key, true))}</b>
        <span className="small">{w.avgW != null ? <>{fmtNum(w.avgW)} {unit}{w.change != null && <span style={{ marginInlineStart: 6, color: w.change < 0 ? 'var(--green)' : w.change > 0 ? 'var(--orange)' : 'var(--label-2)' }}>{w.change > 0 ? '+' : w.change < 0 ? '−' : '±'}{fmtNum(Math.abs(w.change))}</span>}</> : <span className="dim">{t('no weigh-ins')}</span>}</span>
      </div>
      <div className="cut-wk-s">
        <span><Icon name="flame" />{fmtInt(w.kcal.avg)}</span>
        <span><Icon name="bolt" />{w.protein.n ? fmtInt(w.protein.avg) + ' g' : '–'}</span>
        <span><Icon name="steps" />{w.steps.n ? (w.steps.avg / 1000).toFixed(1) + 'k' : '–'}</span>
        <span><Icon name="figureRun" />{fmtInt(w.cardio.total)}′</span>
        <span><Icon name="dumbbell" />{w.gym}</span>
        <span><Icon name="moon" />{w.sleep.n ? fmtNum(w.sleep.avg) + 'h' : '–'}</span>
        <span><Icon name="shield" />{w.alcoholFree}/{w.days}</span>
      </div>
    </div>)}</div> : <div className="empty small">{t('Nothing logged yet')}</div>}

    <h4 className="sec">{t('Last 14 days')}</h4>
    <div className="list">
      {recent.map(d => <div className="card cut-day tappable" key={d} role="button" tabIndex={0} onClick={() => dailyLogSheet(d)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dailyLogSheet(d) } }}>
        <div className="row between" style={{ marginBottom: 6 }}>
          <b className="small">{d === today ? t('Today') : fmtDate(d, true)}</b>
          {logFor(S, d)?.note && <span className="small dim cut-note">{logFor(S, d).note}</span>}
          <Icon name="pencil" className="dim" style={{ fontSize: 14, flex: 'none' }} />
        </div>
        <DayChips S={S} iso={d} cut={cut} brkKcal={r.maintenance} />
      </div>)}
    </div>

    <div style={{ height: 16 }} />
    <Button icon="download" onClick={exportCsv}>{t('Export CSV')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" icon="info" onClick={() => useUI.getState().openSheet(close => <HowItWorks r={r} close={close} />)}>{t('How Progress works')}</Button>
  </div>
}
