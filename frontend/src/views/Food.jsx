// Food: the day's food diary, meal by meal, against the day's targets.
//
// The page a MyFitnessPal user expects: what is left of the day's calories (goal − food), the
// three macros against theirs, then breakfast, lunch, dinner and snacks, each with its items and
// an Add button. The targets are the cut plan's (Progress → gear): calories, protein and fat set
// there, carbs whatever the calories leave (lib/cut.js carbsFor). On a diet break the calorie goal
// is maintenance. Closing today's diary ("Complete") is what lets today count in the weekly
// averages and the maintenance estimate (lib/cut.js countedNutrition) — and it says, as MFP
// does, where a month of days like this one would lead.
import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { KCAL_PER_KG, activeBreak, addDays, carbsFor, cutOf, cutReport, isIso, logFor } from '../lib/cut.js'
import { MEALS, addFoodItem, copyMeal, dayFood, foodTotals, mealTotals, removeFoodItem } from '../lib/food.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { addFoodSheet, editFoodItem, fmtAmt, fmtKcal, itemLine, mealName, quickAddSheet } from '../components/FoodSheets.jsx'
import { dailyLogSheet, fmt1 } from '../components/DailyLog.jsx'
import { cutSettingsSheet } from './Progress.jsx'
import { menuSheet } from '../sheets.jsx'

const update = fn => useStore.getState().update(fn)
const toast = (m, o) => useUI.getState().toast(m, o)
const plural = (n, one, other) => t(n === 1 ? one : other, n)

function Bar({ value, goal, tone }) {
  const pct = goal > 0 ? Math.min(100, value / goal * 100) : 0
  return <div className="food-bar"><span className={tone || ''} style={{ width: pct + '%' }} /></div>
}

function Macro({ label, value, goal, unit = 'g', least = false }) {
  // protein is a floor (reach it), carbs and fat a budget (stay under, a little over is fine)
  const tone = least ? (value >= goal * 0.9 ? 'good' : '') : (value > goal * 1.1 ? 'over' : '')
  const rest = goal - value
  return <div className="food-mac">
    <div className="row between food-mac-h">
      <span>{label}</span>
      <span className="food-mac-v"><b>{fmtAmt(Math.round(value))}</b> / {fmtAmt(goal)} {unit}</span>
    </div>
    <Bar value={value} goal={goal} tone={tone} />
    <div className="food-mac-s">{rest >= 0.5 ? t('{0} g left', fmtAmt(Math.round(rest))) : rest <= -0.5 ? t('{0} g over', fmtAmt(Math.round(-rest))) : t('On target')}</div>
  </div>
}

export default function Food() {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const today = todayISO()
  const [date, setDate] = useState(() => {
    const d = new URLSearchParams(loc.search).get('d')
    return isIso(d) && d <= today ? d : today
  })
  const go = n => { const d = addDays(date, n); if (d <= today) setDate(d) }

  const cut = cutOf(S)
  const report = useMemo(() => cutReport(S, today), [S, today])
  const brk = activeBreak(cut, date)
  const goalKcal = brk ? report.maintenance : cut.kcal
  const goal = { kcal: goalKcal, p: cut.protein, c: carbsFor(goalKcal, cut.protein, cut.fat), f: cut.fat }

  const entry = logFor(S, date)
  const items = dayFood(S, date)
  const tot = foodTotals(items)
  const byMeal = mealTotals(items)
  const left = goal.kcal - tot.kcal
  const isToday = date === today
  const done = !!entry?.done
  const yesterday = dayFood(S, addDays(date, -1))

  const mealMenu = m => {
    const prev = yesterday.filter(it => it.meal === m)
    const mine = items.filter(it => it.meal === m)
    menuSheet({
      title: mealName(m),
      items: [
        prev.length > 0 && {
          icon: 'copy', label: t('Copy from the day before'), sub: plural(prev.length, '{0} item', '{0} items'),
          onClick: () => { let n = 0; update(s => { n = copyMeal(s, addDays(date, -1), date, m) }); toast(plural(n, '{0} item copied', '{0} items copied')) },
        },
        { icon: 'bolt', label: t('Quick add'), sub: t('Just the calories and macros'), onClick: () => quickAddSheet({ date, meal: m }) },
        mine.length > 0 && {
          icon: 'trash', danger: true, label: t('Clear {0}', mealName(m)), sub: plural(mine.length, '{0} item', '{0} items'),
          onClick: () => {
            update(s => { for (const it of mine) removeFoodItem(s, date, it.id) })
            toast(t('{0} cleared', mealName(m)), { action: t('Undo'), onAction: () => update(s => { for (const it of mine) addFoodItem(s, date, it) }) })
          },
        },
      ],
    })
  }

  const complete = on => update(s => { const e = (s.dailyLog || []).find(x => x.d === date); if (e) { if (on) e.done = true; else delete e.done; e.t = Date.now() } })

  // Where a run of days like this one would lead: at the maintenance worked out so far (or the
  // plan's guess), the week's change on the scale. What MFP shows when a diary is completed.
  const per = report.per
  const weekly = tot.n ? (report.maintenance - tot.kcal) * 7 / (KCAL_PER_KG / per) : null

  return <div className="narrow">
    <div className="hdr">
      <div style={{ minWidth: 0 }}>
        <h1>{t('Food')}</h1>
        <div className="sub">{brk ? t('Diet break — eat at maintenance') : t('{0} kcal · {1} g protein a day', fmtKcal(cut.kcal), fmtAmt(cut.protein))}</div>
      </div>
      <div className="hdr-actions">
        <button className="iconbtn" onClick={() => nav('/progress')} aria-label={t('Progress')}><Icon name="chartLine" /></button>
        <button className="iconbtn" onClick={cutSettingsSheet} aria-label={t('Targets')}><Icon name="gear" /></button>
      </div>
    </div>

    <div className="dl-day">
      <button className="iconbtn" onClick={() => go(-1)} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>
      <label className="dl-day-m">
        <span>{isToday ? t('Today') : date === addDays(today, -1) ? t('Yesterday') : fmtDate(date, true)}</span>
        <Icon name="calendar" className="dl-day-ic" />
        <input type="date" value={date} max={today} aria-label={t('Date')}
          onClick={e => { try { e.currentTarget.showPicker?.() } catch { /* the tap still focuses it */ } }}
          onChange={e => { if (isIso(e.target.value) && e.target.value <= today) setDate(e.target.value) }} />
      </label>
      <button className="iconbtn" onClick={() => go(1)} disabled={date >= today} aria-label={t('Next day')}><Icon name="chevronRight" /></button>
    </div>

    <div className="card food-sum">
      <div className="row between" style={{ gap: 8 }}>
        <span className="dl-lbl">{left >= 0 ? t('Calories remaining') : t('Calories over')}</span>
        {brk && <span className="cut-tag info">{t('Maintenance')}</span>}
      </div>
      <div className="food-eq">
        <div><b>{fmtKcal(goal.kcal)}</b><span>{t('Goal')}</span></div>
        <i>−</i>
        <div><b>{fmtKcal(tot.kcal)}</b><span>{t('Food')}</span></div>
        <i>=</i>
        <div className={'food-left' + (left < 0 ? ' over' : '')}><b>{fmtKcal(Math.abs(left))}</b><span>{left >= 0 ? t('Left') : t('Over')}</span></div>
      </div>
      <Bar value={tot.kcal} goal={goal.kcal} tone={left < -100 ? 'over' : left <= 300 ? 'good' : ''} />
      <div className="food-macs">
        <Macro label={t('Protein')} value={tot.p} goal={goal.p} least />
        <Macro label={t('Carbs')} value={tot.c} goal={goal.c} />
        <Macro label={t('Fat')} value={tot.f} goal={goal.f} />
      </div>
    </div>

    {MEALS.map(m => {
      const mine = items.filter(it => it.meal === m)
      return <div className="card food-meal" key={m}>
        <div className="row between food-meal-h">
          <h2>{mealName(m)}</h2>
          <div className="row" style={{ gap: 2 }}>
            {mine.length > 0 && <span className="food-meal-k">{fmtKcal(byMeal[m].kcal)} kcal</span>}
            <button className="iconbtn" onClick={() => mealMenu(m)} aria-label={t('More for {0}', mealName(m))}><Icon name="more" /></button>
          </div>
        </div>
        {mine.map(it => <div className="food-it" key={it.id} {...tappable(() => editFoodItem(useStore.getState().S, date, it))}>
          <div className="food-it-m">
            <div className="food-it-n">{it.name}</div>
            <div className="food-it-s">{itemLine(it)}</div>
          </div>
          <div className="food-it-k">{fmtKcal(it.kcal)}</div>
        </div>)}
        <button className="food-add" onClick={() => addFoodSheet({ date, meal: m })}><Icon name="plus" />{t('Add food')}</button>
      </div>
    })}

    {tot.n > 0 && isToday && !done && <div className="card food-close">
      <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.45 }}>{t('Done eating for today? Completing the diary counts today in your weekly averages.')}</div>
      <Button variant="tinted" icon="checkCircle" onClick={() => complete(true)}>{t('Complete today\'s diary')}</Button>
    </div>}
    {tot.n > 0 && (done || !isToday) && weekly != null && <div className="card food-close">
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <span className="lrow-i" style={{ '--tint': weekly > 0 ? 'var(--green)' : 'var(--orange)' }}><Icon name={weekly > 0 ? 'arrowDown' : 'arrowUp'} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="food-proj">{weekly >= 0.05
            ? t('A week of days like this: about −{0} {1}', fmt1(weekly), report.unit)
            : weekly <= -0.05 ? t('A week of days like this: about +{0} {1}', fmt1(-weekly), report.unit) : t('A week of days like this: about the same weight')}</div>
          <div className="small dim" style={{ marginTop: 3 }}>{report.tdee.ready
            ? t('At your maintenance of {0} kcal, worked out from your log.', fmtKcal(report.maintenance))
            : t('At the maintenance guess of {0} kcal, until your log has its own.', fmtKcal(report.maintenance))}</div>
        </div>
      </div>
      {done && isToday && <Button size="sm" variant="ghost" style={{ marginTop: 8 }} onClick={() => complete(false)}>{t('Reopen today\'s diary')}</Button>}
    </div>}

    <div className="card food-more" {...tappable(() => dailyLogSheet(date))}>
      <span className="lrow-i" style={{ '--tint': 'var(--indigo)' }}><Icon name="clipboard" /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="food-more-t">{t('Weight, steps, sleep and the rest of the day')}</div>
        <div className="small muted">{t('The daily log for {0}', isToday ? t('today') : fmtDate(date, true))}</div>
      </div>
      <Icon name="chevronRight" className="chev" />
    </div>
  </div>
}
