// Every progress photo — the ones on logged workouts and the ones kept on a day of the daily log
// (lib/day-photos.js), tagged front, side or back — in one place, newest first: a photo added to
// any day with its pose, a filter by pose, and a before/after comparison between any two.
//
// WorkoutMedia.jsx already lets a photo or video be attached to a finished workout — that is
// still the only place one is stored (addWorkoutMedia, a saved workout's own `media` list) and
// where one is removed. What this view adds is a shortcut for the common case (today's workout
// is already logged) straight onto the record WorkoutMedia.jsx would have written to anyway, plus
// lining every still up chronologically and a slider to compare two dates directly. Nothing new
// to store, sync or back up — one more way to reach and to look at data the media system already
// keeps, private to the account the same way everything else there is (DATA_DIR/uploads/<uid>/,
// api/media.js).
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { workoutMediaOf } from '../lib/media-refs.js'
import { POSES, POSE_LABEL, addDayPhoto, normalizeDayPhotos } from '../lib/day-photos.js'
import { isIso } from '../lib/cut.js'
import { syncMedia } from '../lib/media-sync.js'
import { useMediaPicker } from '../components/CustomMediaField.jsx'
import { CustomThumb, MediaView, useMediaUrl } from '../components/CustomMedia.jsx'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

const toast = m => useUI.getState().toast(m)

/** Today's own logged workout, the latest one if there is more than one — where "Add photo"
 *  attaches to, same as opening that workout and using WorkoutMedia.jsx there directly. */
export function todaysWorkout(S) {
  const today = (S.workouts || []).filter(w => w.d === todayISO())
  if (!today.length) return null
  return today.reduce((a, b) => (b.start || 0) > (a.start || 0) ? b : a)
}

/**
 * Every still photo (no video — the comparison wants two stills, not two clips) across every
 * logged workout, newest first. Each entry carries the date and the workout it came from, so the
 * grid and the comparator can both say when a photo was taken without re-deriving it.
 */
export function progressPhotosOf(S) {
  const out = []
  for (const w of (S && S.workouts) || []) {
    for (const m of workoutMediaOf(w)) {
      if (m.kind === 'video') continue
      // `key`: the same file can sit on two workouts (one hash), and each is its own photo here.
      out.push({ key: (w.id || w.start || w.d) + ':' + m.hash, d: w.d, start: w.start || 0, w, m, pose: null })
    }
  }
  // the photos kept on a day of the daily log, with their pose
  for (const e of (S && S.dailyLog) || []) {
    if (!e || !isIso(e.d)) continue
    for (const p of normalizeDayPhotos(e.photos)) out.push({ key: 'day:' + e.d + ':' + p.m.hash, d: e.d, start: p.m.at || 0, m: p.m, pose: p.pose, day: true })
  }
  out.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : b.start - a.start))
  return out
}

/** Runs an already-sorted progressPhotosOf() list into { d, items }[] groups of the same date. */
export function groupByDate(photos) {
  const out = []
  for (const p of photos) {
    const last = out[out.length - 1]
    if (last && last.d === p.d) last.items.push(p)
    else out.push({ d: p.d, items: [p] })
  }
  return out
}

/** Whole days between two ISO dates, always ≥ 0 regardless of which comes first. */
export function daysBetween(a, b) {
  const ms = new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')
  return Math.abs(Math.round(ms / 86400000))
}

function openPhotoView(p) {
  useUI.getState().openSheet(close => (
    <div className="mviewer" role="dialog" aria-modal="true" aria-label={t('Photo')}>
      <div className="mviewer-bar">
        <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
        <span className="mviewer-count">{fmtDate(p.d, true, true)}</span>
        <span style={{ width: 36 }} />
      </div>
      <div className="mviewer-stage"><MediaView m={p.m} cls="exmedia viewer" /></div>
    </div>
  ), { kind: 'viewer' })
}

/** The before/after slider between two progress photos `a` (earlier) and `b` (later). */
function ProgressCompare({ a, b, close }) {
  const before = useMediaUrl(a.m)
  const after = useMediaUrl(b.m)
  const [pct, setPct] = useState(50)
  const stageRef = useRef(null)
  const dragging = useRef(false)

  const setFromClientX = x => {
    const el = stageRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (!rect.width) return
    setPct(Math.max(0, Math.min(100, ((x - rect.left) / rect.width) * 100)))
  }
  const onPointerDown = e => { dragging.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); setFromClientX(e.clientX) }
  const onPointerMove = e => { if (dragging.current) setFromClientX(e.clientX) }
  const endDrag = () => { dragging.current = false }

  const days = daysBetween(a.d, b.d)

  return <div className="mviewer" role="dialog" aria-modal="true" aria-label={t('Compare photos')}>
    <div className="mviewer-bar">
      <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
      <span className="mviewer-count">{days > 0 ? tn('{0} day apart', '{0} days apart', days) : t('Same day')}</span>
      <span style={{ width: 36 }} />
    </div>
    {/* A photo has no reading direction: before stays on the left and the finger drives the
        handle the same way in Arabic, so the stage is ltr like DurationWheel's wheel. */}
    <div className="pp-compare" dir="ltr" ref={stageRef} data-swipe-ignore
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
      {after.url && <img className="pp-img" src={after.url} alt="" draggable={false} />}
      {before.url && <img className="pp-img" src={before.url} alt="" draggable={false}
        style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }} />}
      <div className="pp-handle" style={{ insetInlineStart: pct + '%' }}><div className="pp-grip" /></div>
      <div className="pp-label pp-label-before">{fmtDate(a.d, true)}</div>
      <div className="pp-label pp-label-after">{fmtDate(b.d, true)}</div>
    </div>
  </div>
}

/** Opens the before/after slider between two progressPhotosOf() entries, in date order either way. */
export function openProgressCompare(x, y) {
  const [a, b] = x.d <= y.d ? [x, y] : [y, x]
  useUI.getState().openSheet(close => <ProgressCompare a={a} b={b} close={close} />, { kind: 'viewer' })
}

export default function ProgressPhotos() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const photos = useMemo(() => progressPhotosOf(S), [S.workouts])
  const groups = useMemo(() => groupByDate(photos), [photos])
  const [comparing, setComparing] = useState(false)
  const [picked, setPicked] = useState([])   // up to 2 photo keys, in tap order
  const { pick, busy, canAdd, showAdd } = useMediaPicker()
  const fileRef = useRef(null)
  const [pose, setPose] = useState('front')
  const [day, setDay] = useState(todayISO())
  const [only, setOnly] = useState(null)   // a pose to show alone
  const shown = useMemo(() => (only ? photos.filter(p => p.pose === only) : photos), [photos, only])
  const shownGroups = useMemo(() => (only ? groupByDate(shown) : groups), [shown, groups, only])

  const toggle = p => setPicked(cur => {
    if (cur.includes(p.key)) return cur.filter(k => k !== p.key)
    return cur.length >= 2 ? [cur[1], p.key] : [...cur, p.key]
  })
  const cancelCompare = () => { setComparing(false); setPicked([]) }
  const runCompare = () => {
    if (picked.length !== 2) return
    const [ha, hb] = picked
    const a = photos.find(p => p.key === ha)
    const b = photos.find(p => p.key === hb)
    cancelCompare()
    if (a && b) openProgressCompare(a, b)
  }
  // Kept on the chosen day of the daily log, with its pose — any day, a workout or none. The file
  // picker offers the camera on a phone the same way WorkoutMedia.jsx's does.
  const onFile = async ev => {
    const file = ev.target.files && ev.target.files[0]
    ev.target.value = ''
    if (!file || !isIso(day) || day > todayISO()) return
    const got = await pick(file)
    if (!got) return
    let res
    update(s => { res = addDayPhoto(s, day, got, pose) })
    if (res === 'added') { toast(t('Photo added')); syncMedia({ force: true }) }
    else if (res === 'full') toast(t('Up to {0} photos a day.', 6))
    else if (res === 'invalid') toast(t('Only photos can go here.'))
  }

  return <>
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Progress photos')}</h1>
        <div className="sub">{tn('{0} photo', '{0} photos', photos.length)}</div></div>
      {photos.length >= 2 && (comparing
        ? <Button size="sm" variant="ghost" onClick={cancelCompare}>{t('Cancel')}</Button>
        : <Button size="sm" variant="tinted" onClick={() => setComparing(true)}>{t('Compare')}</Button>)}
    </div>

    {!comparing && showAdd && <div className="card pp-add">
      <div className="pp-poses" role="radiogroup" aria-label={t('Pose')}>
        {POSES.map(x => <button key={x} role="radio" aria-checked={pose === x} className={'chip nocap' + (pose === x ? ' on' : '')} onClick={() => setPose(x)}>{t(POSE_LABEL[x])}</button>)}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <label className="dl-day-m pp-day">
          <span>{day === todayISO() ? t('Today') : fmtDate(day, true)}</span>
          <Icon name="calendar" className="dl-day-ic" />
          <input type="date" value={day} max={todayISO()} aria-label={t('Date')}
            onClick={e => { try { e.currentTarget.showPicker?.() } catch { /* the tap still focuses it */ } }}
            onChange={e => { if (isIso(e.target.value) && e.target.value <= todayISO()) setDay(e.target.value) }} />
        </label>
        <Button icon={busy ? 'image' : 'camera'} variant="tinted" disabled={!canAdd} onClick={() => fileRef.current?.click()}>
          {busy ? t('Loading…') : t('Add photo')}
        </Button>
      </div>
      <div className="small dim" style={{ marginTop: 8, lineHeight: 1.4 }}>{t('Same light, same spot, mornings after the weigh-in: then two dates compare.')}</div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
    </div>}

    {photos.some(p => p.pose) && <div className="pp-poses" style={{ marginBottom: 12 }} role="tablist" aria-label={t('Show')}>
      <button role="tab" aria-selected={!only} className={'chip nocap' + (!only ? ' on' : '')} onClick={() => setOnly(null)}>{t('All')}</button>
      {POSES.map(x => <button key={x} role="tab" aria-selected={only === x} className={'chip nocap' + (only === x ? ' on' : '')} onClick={() => setOnly(x)}>{t(POSE_LABEL[x])}</button>)}
    </div>}

    {comparing && <div className="small dim" style={{ margin: '0 0 12px' }}>
      {picked.length < 2 ? t('Pick two photos to compare.') : t('Ready! Open the comparison.')}
    </div>}

    {!shown.length
      ? <div className="empty"><div className="ico"><Icon name="image" /></div>
          {only ? t('No photos with this pose yet.') : t('No progress photos yet. Pick a pose and add one to any day above.')}
        </div>
      : shownGroups.map(g => (
        <div key={g.d} style={{ marginBottom: 18 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>{fmtDate(g.d, true, true)}</div>
          <div className="wmedia-grid">
            {g.items.map(p => {
              const selected = picked.includes(p.key)
              return (
                <button key={p.key} type="button" data-swipe-ignore
                  className={'wmedia-item' + (selected ? ' pp-selected' : '')}
                  aria-label={fmtDate(p.d, true)}
                  onClick={() => (comparing ? toggle(p) : openPhotoView(p))}>
                  <CustomThumb ex={{ custom: true, media: p.m }} />
                  {p.pose && <span className="pp-pose">{t(POSE_LABEL[p.pose])}</span>}
                  {selected && <span className="pp-check"><Icon name="check" /></span>}
                </button>
              )
            })}
          </div>
        </div>
      ))}

    {comparing && picked.length === 2 && <div className="pp-cta">
      <Button variant="primary" onClick={runCompare}>{t('Compare')}</Button>
    </div>}
  </>
}
