// The top of Home: what is left of today's calories, and the three things a day asks for most —
// add food, train, weigh in — one tap each.
//
// The ring is MyFitnessPal's: the calories eaten against the day's target, what is left in the
// middle. The target is the plan's (the first-run questions set it, Progress adjusts it): on a
// diet break, maintenance. With no plan yet the card asks for one instead. The training button
// says what it will do: resume the session running, start the routine planned for today, or —
// nothing planned — add an exercise, which starts an empty session with the exercise picker open.
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { activeBreak, carbsFor, cutOf, cutReport } from '../lib/cut.js'
import { dayNutrition, mealAt } from '../lib/food.js'
import { effectiveRoutineIds, effectiveRoutines } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { bwSheet, startFlow } from '../sheets.jsx'
import { addFoodSheet } from './FoodSheets.jsx'
import Icon from './Icon.jsx'
import { fmtInt } from './DailyLog.jsx'

/** The calories eaten against the target, as a ring; what is left (or over) in the middle. */
function Ring({ eaten, goal }) {
  const R = 52, C = 2 * Math.PI * R
  const frac = goal > 0 ? Math.min(1, eaten / goal) : 0
  const left = goal - eaten
  const over = left < 0
  return <div className={'tday-ring' + (over ? ' over' : '')}>
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r={R} className="tday-ring-bg" />
      <circle cx="60" cy="60" r={R} className="tday-ring-fg" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} transform="rotate(-90 60 60)" />
    </svg>
    <div className="tday-ring-m">
      <b>{fmtInt(Math.abs(left))}</b>
      <span>{over ? t('kcal over') : t('kcal left')}</span>
    </div>
  </div>
}

export default function TodayCard() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = todayISO()

  // the training button: resume, today's routine, or an exercise to start with
  const routines = effectiveRoutines(S, today)
  const doneToday = routines.length > 0 && S.workouts.some(w => w.d === today && (Array.isArray(w.routineIds) ? w.routineIds : [w.routineId]).some(id => routines.some(r => r.id === id)))
  const train = S.active
    ? { label: S.active.editingWorkoutId ? t('Back to the edit') : t('Resume workout'), icon: 'play', go: () => nav('/workout') }
    : routines.length && !doneToday
      ? { label: t('Start {0}', routines.map(r => r.name).join(' + ')), icon: 'dumbbell', go: () => startFlow(effectiveRoutineIds(S, today)) }
      : { label: t('Add exercise'), icon: 'dumbbell', go: () => { useUI.setState({ pickOnStart: Date.now() }); startFlow([]) } }

  const actions = <div className="tday-acts">
    <button className="tday-act" onClick={() => addFoodSheet({ date: today, meal: mealAt() })}><span className="tday-ic tone-green"><Icon name="utensils" /></span><b>{t('Add food')}</b></button>
    <button className={'tday-act' + (S.active ? ' live' : '')} onClick={train.go}><span className="tday-ic tone-blue"><Icon name={train.icon} /></span><b>{train.label}</b></button>
    <button className="tday-act" onClick={() => bwSheet()}><span className="tday-ic tone-purple"><Icon name="scale" /></span><b>{t('Log weight')}</b></button>
  </div>

  // no plan yet (the questions skipped): ask for one rather than measure against defaults
  if (!S.cut) {
    return <div className="card tday">
      <div className="tday-setup" {...tappable(() => nav('/setup'))}>
        <span className="tday-ic tone-orange"><Icon name="flame" /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{t('Get your daily calories')}</b>
          <span>{t('A few questions about you and your goal: a minute.')}</span>
        </div>
        <Icon name="chevronRight" className="chev" />
      </div>
      {actions}
    </div>
  }

  const cut = cutOf(S)
  const brk = activeBreak(cut, today)
  // on a diet break the day is eaten at maintenance: the one worked out from the log, once there is one
  const goal = brk ? cutReport(S, today).maintenance : cut.kcal
  const nut = dayNutrition(S, today)
  const eaten = nut.kcal ?? 0
  const carbsGoal = carbsFor(goal, cut.protein, cut.fat)
  const macro = (label, value, target, tone) => <div className={'tday-mac ' + tone}>
    <div className="tday-mac-h"><span>{label}</span><b>{fmtInt(value ?? 0)}<i> / {fmtInt(target)} g</i></b></div>
    <div className="tday-bar"><span style={{ width: Math.min(100, target > 0 ? (value ?? 0) / target * 100 : 0) + '%' }} /></div>
  </div>

  return <div className="card tday">
    <div className="tday-top" {...tappable(() => nav('/food'))}>
      <Ring eaten={eaten} goal={goal} />
      <div className="tday-side">
        <div className="tday-lbl">{brk ? t('Diet break · maintenance') : t('Today')}</div>
        <div className="tday-row"><Icon name="target" /><span>{t('Goal')}</span><b>{fmtInt(goal)}</b></div>
        <div className="tday-row"><Icon name="utensils" /><span>{t('Eaten')}</span><b>{fmtInt(eaten)}</b></div>
        {macro(t('Protein'), nut.protein, cut.protein, 'tone-blue')}
        {nut.src === 'food' && macro(t('Carbs'), nut.carbs, carbsGoal, 'tone-orange')}
        {nut.src === 'food' && macro(t('Fat'), nut.fat, cut.fat, 'tone-purple')}
      </div>
    </div>
    {actions}
  </div>
}
