// "Off plan" in three taps — the button, a calorie guess, what set it off — and the if–then plans
// that answer a trigger that keeps coming back (lib/offplan.js). On the Food page.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import { addFoodItem } from '../lib/food.js'
import {
  OFF_KCAL, TRIGGERS, TRIGGER_ICON, TRIGGER_LABEL, activePlans, offPlanEntries, offPlanItem, plansOf, savePlan, suggestPlans,
  triggerCounts,
} from '../lib/offplan.js'
import { addDays } from '../lib/cut.js'
import Icon from './Icon.jsx'
import { Button, NumberField, Switch, TextField } from './ui.jsx'

const update = fn => useStore.getState().update(fn)
const toast = (m, o) => useUI.getState().toast(m, o)
export const triggerName = trig => t(TRIGGER_LABEL[trig] || 'Off plan')

/* ================================================================ the entry == */

export function OffPlanSheet({ date, close }) {
  const [kcal, setKcal] = useState(null)
  const save = trig => {
    if (!(kcal > 0)) { toast(t('Choose about how much first')); return }
    const today = todayISO()
    const item = offPlanItem({ kcal, trig, name: t('Off plan'), meal: date === today ? undefined : 's' })
    let added = null
    update(s => { added = addFoodItem(s, date, item) })
    close()
    const counts = triggerCounts(useStore.getState().S, today)
    const covered = activePlans(useStore.getState().S).some(p => p.trig === trig)
    toast(trig && counts[trig] >= 2 && !covered
      ? t('{0} came up {1} times in two weeks. A plan for it is waiting under the meals.', triggerName(trig), counts[trig])
      : t('Logged. One slip changes nothing; the week counts.'), added ? { action: t('Undo'), onAction: () => update(s => { const e = (s.dailyLog || []).find(x => x.d === date); if (e?.food) e.food = e.food.filter(x => x.id !== added.id) }) } : undefined)
  }
  return <>
    <h3 style={{ marginBottom: 4 }}>{t('Off plan')}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.45 }}>{t('A guess is fine: what matters is that it is in the log, so the numbers stay honest.')}</div>
    <span className="sect-t">{t('About how much?')}</span>
    <div className="off-kcal">
      {OFF_KCAL.map(k => <button key={k} className={'chip nocap' + (kcal === k ? ' on' : '')} onClick={() => setKcal(k)}>{k}</button>)}
      <label className="measure-input off-own"><NumberField nullable decimal={false} value={OFF_KCAL.includes(kcal) ? null : kcal} onChange={setKcal} aria-label={t('Calories')} /><i>kcal</i></label>
    </div>
    <span className="sect-t">{t('What set it off?')}</span>
    <div className="off-trig">
      {TRIGGERS.map(trig => <button key={trig} className="chip nocap" onClick={() => save(trig)}><Icon name={TRIGGER_ICON[trig]} />{triggerName(trig)}</button>)}
    </div>
    <Button variant="ghost" className="dim" onClick={() => save(null)}>{t('Log it without a reason')}</Button>
  </>
}

export const offPlanSheet = date => useUI.getState().openSheet(close => <OffPlanSheet date={date} close={close} />)

/* ================================================================ a plan == */

function PlanSheet({ plan, close }) {
  const [v, setV] = useState({ if: plan?.if || '', then: plan?.then || '', on: plan?.on !== false })
  const save = () => {
    if (!v.if.trim() || !v.then.trim()) { toast(t('Fill in both halves of the plan')); return }
    update(s => { s.plans = savePlan(s.plans, { ...(plan || {}), if: v.if, then: v.then, on: v.on }) })
    toast(t('Plan saved'))
    close()
  }
  const remove = () => {
    update(s => { s.plans = plansOf(s).filter(p => p.id !== plan.id) })
    toast(t('Plan removed'))
    close()
  }
  return <>
    <h3 style={{ marginBottom: 4 }}>{plan?.id ? t('Edit plan') : t('New plan')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>{t('A cue you will notice, and something to do instead of the snack — not just "I won\'t". Three at most, so each stays in mind.')}</div>
    <span className="sect-t">{t('If…')}</span>
    <TextField value={v.if} maxLength={160} placeholder={t('it is after 21:00 and I am hungry')} onChange={e => setV(x => ({ ...x, if: e.target.value }))} />
    <span className="sect-t" style={{ marginTop: 12 }}>{t('then…')}</span>
    <TextField value={v.then} maxLength={160} placeholder={t('I have 300 g of Greek yogurt with berries')} onChange={e => setV(x => ({ ...x, then: e.target.value }))} />
    <div className="lrow" style={{ paddingInline: 0, marginTop: 8 }}>
      <span className="lrow-m"><span className="lrow-t">{t('Active')}</span><span className="lrow-s">{t('Shown on the Food page')}</span></span>
      <Switch checked={v.on} onChange={on => setV(x => ({ ...x, on }))} aria-label={t('Active')} />
    </div>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {plan?.id && <><div style={{ height: 6 }} /><Button variant="ghost" className="danger-text" icon="trash" onClick={remove}>{t('Remove plan')}</Button></>}
  </>
}

export const planSheet = plan => useUI.getState().openSheet(close => <PlanSheet plan={plan} close={close} />)

/* ================================================================ the card == */

/** The active plans, a plan proposed for a trigger that repeats, and the slips of the last two weeks. */
export function PlansCard({ today = todayISO() }) {
  const S = useStore(s => s.S)
  const active = activePlans(S)
  const sug = suggestPlans(S, today)[0] || null
  const recent = offPlanEntries(S, addDays(today, -13), today)
  if (!active.length && !sug && !recent.length) return null
  const kcal = recent.reduce((n, x) => n + x.kcal, 0)
  return <div className="card food-plans">
    <div className="row between" style={{ marginBottom: 4, gap: 8 }}>
      <h2 style={{ margin: 0 }}>{t('If–then plans')}</h2>
      <button className="iconbtn" onClick={() => planSheet(null)} aria-label={t('New plan')}><Icon name="plus" /></button>
    </div>
    {recent.length > 0 && <div className="small muted" style={{ marginBottom: 6 }}>
      {t('{0} off plan in two weeks, about {1} kcal', recent.length, Math.round(kcal).toLocaleString())}
    </div>}
    {active.map(p => <div className="ifplan" key={p.id} role="button" tabIndex={0} onClick={() => planSheet(p)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); planSheet(p) } }}>
      {p.trig && <Icon name={TRIGGER_ICON[p.trig]} className="ifplan-ic" />}
      <span><b>{t('If')}</b> {p.if}, <b>{t('then')}</b> {p.then}.</span>
    </div>)}
    {sug && <div className="ifplan-sug">
      <div className="small muted">{t('{0} came up {1} times in two weeks.', triggerName(sug.trig), sug.n)}</div>
      <div className="ifplan-sug-t"><b>{t('If')}</b> {t(sug.if)}, <b>{t('then')}</b> {t(sug.then)}.</div>
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <Button size="sm" variant="tinted" icon="check" onClick={() => { update(s => { s.plans = savePlan(s.plans, { trig: sug.trig, if: t(sug.if), then: t(sug.then) }) }); toast(t('Plan saved')) }}>{t('Use this plan')}</Button>
        <Button size="sm" onClick={() => planSheet({ trig: sug.trig, if: t(sug.if), then: t(sug.then) })}>{t('Write my own')}</Button>
      </div>
    </div>}
  </div>
}
