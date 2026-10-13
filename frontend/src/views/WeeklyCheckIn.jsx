// The weekly check-in: the week in brief, the half-logged days, next week's calories, one focus
// (lib/checkin.js). Two or three minutes on the plan's check-in day; Home offers it then, and
// Progress any time.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { addDays, cutOf, cutReport } from '../lib/cut.js'
import {
  FOCUS, MAX_STEP, addCheckIn, checkInFor, proposeKcal, suggestFocus, weekBrief, weekDays, withPartial,
} from '../lib/checkin.js'
import { fmtDate, fmtNum, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, Switch, TextField } from '../components/ui.jsx'
import { fmt1, fmtInt, fmtPace, fmtRate, phaseInfo } from '../components/DailyLog.jsx'

const toast = m => useUI.getState().toast(m)
const signed = (x, unit) => (x == null ? '–' : (x > 0.05 ? '+' : x < -0.05 ? '−' : '±') + fmt1(Math.abs(x)) + ' ' + unit)

function Stat({ icon, label, value, sub, tone }) {
  return <div className="tile cut-tile">
    <div className="l"><Icon name={icon} />{label}</div>
    <div className={'v' + (tone ? ' ' + tone : '')}>{value}</div>
    {sub && <div className="cut-ts">{sub}</div>}
  </div>
}

export const focusText = (f, cut) => t(f.text, f.id === 'protein' ? fmtInt(cut.protein) : f.id === 'steps' ? fmtInt(cut.steps) : '')

export default function WeeklyCheckIn() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = todayISO()
  // the check-in that is due, or — opened from Progress on another day — the seven days before today
  const ci = useMemo(() => {
    const c = checkInFor(S, today)
    return c && (c.due || c.d === today) ? c : { d: today, from: addDays(today, -7), to: addDays(today, -1) }
  }, [S, today])
  const r0 = useMemo(() => cutReport(S, today), [S, today])
  const days = useMemo(() => weekDays(S, ci.from, ci.to, { cut: r0.cut, maintenance: r0.maintenance }), [S, ci, r0])
  const [marks, setMarks] = useState(() => Object.fromEntries(days.filter(x => x.partial).map(x => [x.d, true])))
  const draft = useMemo(() => withPartial(S, marks), [S, marks])
  const r = useMemo(() => cutReport(draft, today), [draft, today])
  const brief = useMemo(() => weekBrief(draft, ci, r), [draft, ci, r])
  const prop = useMemo(() => proposeKcal(draft, today, r), [draft, today, r])
  const cut = r.cut
  const unit = r.unit
  const [choice, setChoice] = useState('accept')
  const [own, setOwn] = useState(null)
  const [focus, setFocus] = useState(() => suggestFocus(weekBrief(S, ci, r0), r0.cut))
  const [ownFocus, setOwnFocus] = useState('')

  const suspect = days.filter(x => x.kind === 'suspect' || x.partial || marks[x.d])
  const unlogged = days.filter(x => x.kind === 'none')
  const changes = prop.kind === 'kcal' || prop.kind === 'steps'

  const save = () => {
    const now = Date.now()
    const decision = !changes ? prop.kind : choice
    const kcalTo = decision === 'accept' && prop.kind === 'kcal' ? prop.kcal : decision === 'modify' && own > 0 ? Math.round(own) : cut.kcal
    if (decision === 'modify' && !(own >= 800 && own <= 8000)) { toast(t('Enter the calories for next week')); return }
    const stepsTo = decision === 'accept' && prop.kind === 'steps' ? prop.steps : null
    const f = focus === 'own' ? (ownFocus.trim() ? { id: 'own', text: ownFocus.trim() } : null) : (() => { const x = FOCUS.find(y => y.id === focus); return x ? { id: x.id, text: focusText(x, cut) } : null })()
    useStore.getState().update(s => {
      for (const [d, on] of Object.entries(marks)) {
        const e = (s.dailyLog || []).find(x => x.d === d)
        if (!e) continue
        if (on) e.partial = true; else delete e.partial
        e.t = now
      }
      if (kcalTo !== cut.kcal || stepsTo) {
        const c = cutOf(s)
        if (kcalTo !== cut.kcal) c.kcal = kcalTo
        if (stepsTo) c.steps = stepsTo
        c.changedAt = today
        s.cut = cutOf({ cut: c })
      }
      s.checkIns = addCheckIn(s.checkIns, {
        d: ci.d, from: ci.from, to: ci.to, at: now,
        week: { logged: brief.kcal.n, weighIns: brief.weighIns, kcal: brief.kcal.avg, protein: brief.protein.avg, steps: brief.steps.avg, sleep: brief.sleep.avg, gym: brief.gym, lossWk: brief.lossWk, ratePct: brief.ratePct, trendW: brief.trendW, change: brief.change },
        partial: Object.keys(marks).filter(d => marks[d]),
        kcalFrom: cut.kcal, kcalTo, stepsTo, decision, focus: f,
      })
    })
    toast(kcalTo !== cut.kcal ? t('Check-in saved · {0} kcal from today', fmtInt(kcalTo)) : stepsTo ? t('Check-in saved · {0} steps a day', fmtInt(stepsTo)) : t('Check-in saved'))
    nav(-1)
  }

  const info = phaseInfo(r.phase, r.zone, r.gaining)
  const kcalTone = brief.kcal.n ? (Math.abs(brief.kcal.avg - cut.kcal) <= 150 ? 'good' : 'warn') : ''

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 10, minWidth: 0 }}>
        <h1>{t('Weekly check-in')}</h1>
        <div className="sub">{fmtDate(ci.from, true)} – {fmtDate(ci.to, true)}</div>
      </div>
    </div>

    {/* 1. the week in brief */}
    <div className="row between" style={{ margin: '4px 2px 10px' }}>
      <h4 className="sec" style={{ margin: 0 }}>{t('Your week')}</h4>
      <span className={'dl-status ' + info.tone}><Icon name={info.icon} />{info.label}</span>
    </div>
    <div className="tiles">
      <Stat icon="scale" label={t('Weekly average')} value={brief.avgW != null ? fmtNum(brief.avgW) + ' ' + unit : '–'}
        sub={brief.change != null ? t('{0} on the week before', signed(brief.change, unit)) : t('a week of weigh-ins compares')} tone={brief.change != null && (r.gaining ? brief.change > 0.05 : brief.change < -0.05) ? 'good' : ''} />
      <Stat icon="gauge" label={t('Pace')} value={fmtRate(r.lossWk, unit)}
        sub={r.ratePct != null ? t('{0}% of body weight · aim {1}–{2}%', fmt1(Math.abs(r.ratePct)), fmt1(r.band.pctMin), fmt1(r.band.pctMax)) : null} />
      <Stat icon="clipboard" label={t('Logged')} value={brief.kcal.n + ' / 7'} sub={t('weighed {0} / 7', brief.weighIns)} tone={brief.kcal.n >= 6 ? 'good' : 'warn'} />
      <Stat icon="flame" label={t('Calories')} value={fmtInt(brief.kcal.avg)} sub={t('target {0}', fmtInt(cut.kcal))} tone={kcalTone} />
      <Stat icon="bolt" label={t('Protein')} value={brief.protein.n ? fmtInt(brief.protein.avg) + ' g' : '–'} sub={t('target {0} g', fmtInt(cut.protein))}
        tone={brief.protein.n ? (brief.protein.avg >= cut.protein * 0.9 ? 'good' : 'warn') : ''} />
      <Stat icon="steps" label={t('Steps')} value={fmtInt(brief.steps.avg)} sub={t('target {0}', fmtInt(cut.steps))}
        tone={brief.steps.n ? (brief.steps.avg >= cut.steps ? 'good' : brief.steps.avg >= cut.steps * 0.8 ? '' : 'warn') : ''} />
      <Stat icon="moon" label={t('Sleep')} value={brief.sleep.n ? fmtNum(brief.sleep.avg) + ' ' + t('h') : '–'} sub={t('target {0} h', fmtNum(cut.sleep))}
        tone={brief.sleep.n ? (brief.sleep.avg >= 7 ? 'good' : 'warn') : ''} />
      <Stat icon="dumbbell" label={t('Gym')} value={brief.gym + ' / ' + cut.gymDays}
        sub={r.strength.ready ? (r.strength.status === 'hold' ? t('strength holding') : r.strength.status === 'slip' ? t('strength slipping') : t('strength dropping')) : t('sessions')}
        tone={brief.gym >= cut.gymDays ? 'good' : ''} />
    </div>

    {/* 2. the days that look half logged */}
    <h4 className="sec">{t('Days logged in part?')}</h4>
    <div className="card wk-days">
      {suspect.length ? <>
        <div className="muted small" style={{ marginBottom: 6, lineHeight: 1.45 }}>{t('These days look logged only in part. Mark the ones that were: an incomplete day counts in neither the averages nor the maintenance estimate.')}</div>
        {suspect.map(x => <div className="lrow" key={x.d}>
          <span className="lrow-m"><span className="lrow-t">{fmtDate(x.d, true)}</span>
            <span className="lrow-s">{t('{0} kcal', fmtInt(x.kcal))}{x.meals ? ' · ' + (x.meals === 1 ? t('1 meal') : t('{0} meals', x.meals)) : ''}</span></span>
          <Switch checked={!!marks[x.d]} onChange={on => setMarks(m => ({ ...m, [x.d]: on }))} aria-label={t('Incomplete')} />
        </div>)}
      </> : <div className="muted small" style={{ lineHeight: 1.45 }}>{t('Every logged day looks whole.')}</div>}
      {unlogged.length > 0 && <div className="small dim" style={{ marginTop: 8 }}>{t('Not logged: {0}. They count for nothing either way.', unlogged.map(x => fmtDate(x.d, true)).join(', '))}</div>}
    </div>

    {/* 3. next week's calories */}
    <h4 className="sec">{t('Next week')}</h4>
    <div className="card wk-next">
      {prop.kind === 'kcal' && <>
        <div className="wk-eq"><span>{fmtInt(prop.from)}</span><Icon name="chevronRight" /><b>{fmtInt(prop.kcal)}</b><i>kcal</i></div>
        <div className="small muted" style={{ lineHeight: 1.45 }}>
          {prop.maintain ? t('Towards your maintenance of about {0} kcal, at most 300 a week.', fmtInt(prop.target))
            : prop.early
            ? t('The pace has been outside {0}–{1} a week for three weeks, and maintenance is not worked out yet: a small step, 100 kcal.', fmt1(r.rateMin), fmt1(r.rateMax) + ' ' + unit)
            : prop.gain
              ? t('Maintenance is about {0} kcal. For {1} a week the plan wants about {2} kcal; one step of at most {3} at a time, which gains about {4} a week.', fmtInt(prop.tdee), fmtPace(r.rateMid) + ' ' + unit, fmtInt(prop.want), MAX_STEP, fmt1(prop.rate) + ' ' + unit)
              : t('Maintenance is about {0} kcal. For {1} a week the plan wants about {2} kcal; one step of at most {3} at a time, which loses about {4} a week.', fmtInt(prop.tdee), fmtPace(r.rateMid) + ' ' + unit, fmtInt(prop.want), MAX_STEP, fmt1(prop.rate) + ' ' + unit)}
        </div>
      </>}
      {prop.kind === 'steps' && <>
        <div className="wk-eq"><span>{fmtInt(cut.steps)}</span><Icon name="chevronRight" /><b>{fmtInt(prop.steps)}</b><i>{t('steps')}</i></div>
        <div className="small muted" style={{ lineHeight: 1.45 }}>{t('The calories are at your floor of {0}. More movement instead of less food.', fmtInt(cut.minKcal))}</div>
      </>}
      {prop.kind === 'minicut' && <div className="small" style={{ lineHeight: 1.45 }}>{t('More than {0} over the end weight: a mini-cut of three to four weeks. Start it on Progress.', fmt1(r.zone?.yellow ?? 2.3) + ' ' + unit)}</div>}
      {prop.kind === 'keep' && <>
        <div className="wk-eq"><b>{fmtInt(cut.kcal)}</b><i>kcal</i></div>
        <div className="small muted" style={{ lineHeight: 1.45 }}>{prop.maintain
          ? (r.zone?.zone === 'yellow' ? t('Above the green zone: hold the calories and log every bite for two weeks.') : t('At maintenance. Keep weighing every morning.'))
          : prop.early
          ? t('Keep the calories. Maintenance is worked out after about three weeks of logging; until then only a pace well off the range changes them.')
          : prop.gain
            ? t('Keep the calories: at your maintenance of about {0} kcal they gain about {1} a week, inside the range.', fmtInt(prop.tdee), fmt1(prop.rate) + ' ' + unit)
            : t('Keep the calories: at your maintenance of about {0} kcal they lose about {1} a week, inside the range.', fmtInt(prop.tdee), fmt1(prop.rate) + ' ' + unit)}</div>
      </>}
      {prop.kind === 'break' && <div className="small" style={{ lineHeight: 1.45 }}>{t('Diet break: about {0} kcal a day until {1}. Nothing changes for next week.', fmtInt(prop.kcal), fmtDate(r.breakNow.to, true))}</div>}
      {prop.kind === 'hold' && <div className="small" style={{ lineHeight: 1.45 }}>{t('Water week after the break: {0} kcal, nothing changed for the fast drop on the scale.', fmtInt(prop.kcal))}</div>}
      {changes && <>
        <div className="wk-choice" role="radiogroup" aria-label={t('Next week')}>
          {[['accept', t('Accept')], ['modify', t('Change')], ['skip', t('Keep as is')]].map(([k, label]) =>
            <button key={k} role="radio" aria-checked={choice === k} className={'chip nocap' + (choice === k ? ' on' : '')} onClick={() => setChoice(k)}>{label}</button>)}
        </div>
        {choice === 'modify' && <label className="measure-field" style={{ marginTop: 10 }}>
          <span>{t('Calories next week')}</span>
          <span className="measure-input"><NumberField nullable decimal={false} value={own} onChange={setOwn} /><i>kcal</i></span>
        </label>}
      </>}
    </div>

    {/* 4. one focus */}
    <h4 className="sec">{t('One focus for next week')}</h4>
    <div className="card">
      <div className="wk-focus">
        {FOCUS.map(f => <button key={f.id} className={'chip nocap' + (focus === f.id ? ' on' : '')} onClick={() => setFocus(f.id)}>{focusText(f, cut)}</button>)}
        <button className={'chip nocap' + (focus === 'own' ? ' on' : '')} onClick={() => setFocus('own')}>{t('My own…')}</button>
      </div>
      {focus === 'own' && <TextField value={ownFocus} maxLength={120} placeholder={t('If… then…, or one thing to do every day')} onChange={e => setOwnFocus(e.target.value)} style={{ marginTop: 10 }} />}
    </div>

    <div style={{ height: 14 }} />
    <Button variant="primary" icon="check" onClick={save}>{t('Save check-in')}</Button>
    <div style={{ height: 24 }} />
  </div>
}
