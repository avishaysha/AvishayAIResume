// Package `ignition`: the headline compiles right to left and its period lands.
//
// FIRST VISIT (html.ignite, set by the head script: motion ok, no 'run-seen' in this session, no stored
//   pause). The foundation paints the h1 in its idea state from the first frame (Rubik 300, ghosted, the
//   period at scale 0), so the text is readable at every frame and LCP is never delayed.
//   1. Font gate: fontsReady('900 1em Rubik', 'מרעיון', 700). No Rubik in time: no morph, a 300ms
//      cross-fade to the final headline, then the event.
//   2. Wave: compile(h1). The foundation's per-glyph transitions (weight 300 -> 900 over .7s with
//      --ease-compile, 32ms * --i stagger, --i continuous over the 3 lines; colour to --text / --lime,
//      timed in ignition.css to land with the weight) run right to left, and a 1px lime sweep runs right
//      to left under each line as it compiles.
//   3. Landing: as the last glyph snaps heavy, the period lands (scale 0 > 1.35 > .9 > 1 over .45s, one
//      Motion animation, on the compositor) and a ring (1 > 3.2, .8 > 0, .6s) and one glow flash leave
//      it at the impact.
//   4. Done: final at (n-1)*32 + 730 = 1274ms after the wave starts; html.ignite is removed, sessionStorage
//      'run-seen' is set and 'ignite:done' fires.
// REPEAT VISIT (no html.ignite): the h1 is final from the first paint and is left untouched (not even
//   split); 'ignite:done' fires right after the font gate.
// SKIP: wheel, touchmove, keydown, pointerdown, a scroll down, or the pause toggle completes the run at
//   once. The hero out of view or the tab hidden when the wave would start: the instant path.
// REPLAY ('run:reset', finale's rerun): decompile instantly, then rerun the wave (no font gate) once
//   350ms have passed and the h1 is back in view, and fire 'ignite:done' again.
// REDUCED MOTION: init returns before doing anything; no class, no event (the flow is off).
//
// Every timed piece (glyph transitions, period, ring, glow, sweeps) starts in ONE task with delays on the
// document timeline, so a busy main thread can delay the whole wave but never put it out of step. There
// is no rAF loop and no setTimeout choreography; timers only guard against lost frames.
//
// Contract
//   dispatches  document 'ignite:done' exactly once per run. detail: {x, y, t, instant, skipped, replay,
//               silent}. x, y: the document-space centre of the h1 period in its final layout; t:
//               performance.now() at dispatch; instant: no wave played (repeat visit, skip, no font,
//               paused, hidden); skipped: the visitor cut it short; replay: after a run:reset; silent:
//               the h1 was out of view (nobody saw the headline land).
//   listens     'run:reset' (replay), 'motion:pause' (pausing completes a running wave)
//   sets        html.fx-ignition (sync, motion only); removes html.ignite when the first run settles;
//               sessionStorage 'run-seen'=1 (try/catch) once the visitor has seen or skipped the intro
//   classes     h1.ign-hold (period held at scale 0 through a wave or a replay's idea state) and
//               html.ign-soft (the no-font cross-fade), both gated on html.fx-ignition in ignition.css

import '../styles/ignition.css'
// motion/mini: Motion's pure-WAAPI animate (also drives ::before/::after). The hybrid animate() keeps a
// motion value that re-renders an inline transform a frame after finishing, which a replay would fight.
import { animate } from 'motion/mini'
import { motionOk } from '../core/env.js'
import { isPaused, onPause } from '../core/state.js'
import { fontsReady } from '../core/fonts.js'
import { split } from '../core/split.js'
import { compile, decompile } from '../core/compile.js'
import { EVT } from '../core/flow.js'
import { navH } from '../core/scroll.js'

const root = document.documentElement

// timing (ms). STAGGER mirrors the foundation's compile contract (style.css: calc(var(--i) * 32ms)).
const STAGGER = 32
const LAND_MS = 450 // the period landing
const PEAK = 0.42 // the landing's peak (scale 1.35) as a fraction of LAND_MS: the ring and glow leave here
// The landing starts this long after the last glyph starts compiling: its peak then hits as that glyph
// reaches ~90% of its weight (--ease-compile), and everything is final at (n-1)*32 + 730ms.
const LAND_LEAD = 280
const RING_MS = 600
const GLOW_MS = 900
const SWEEP_MS = 500
const SWEEP_LEAD = 200 // a line's sweep starts this long after its first glyph starts compiling
const SOFT_MS = 300 // the no-font cross-fade
const REPLAY_BEAT = 350 // a rerun holds the idea state at least this long
const REPLAY_MAX = 1150 // ...and starts the wave by then at the latest (the thread waits 2600ms for us)
const SKIP_SCROLL = 24 // px scrolled down that counts as a skip

const OUT = [0.22, 1, 0.36, 1]
const IO = [0.65, 0, 0.35, 1]
const POP = [0.34, 1.56, 0.64, 1]

const SKIP_EVENTS = ['wheel', 'touchmove', 'keydown', 'pointerdown']
const ACTIVE = new Set(['new', 'gate', 'soft', 'hold', 'wave'])

let started = false

export function init() {
  if (!motionOk || started) return
  const h1 = document.querySelector('h1[data-ignite]')
  const period = h1 && h1.querySelector('[data-period]')
  if (!h1 || !period) return
  started = true
  root.classList.add('fx-ignition')
  return createIgnition(h1, period)
}

function createIgnition(h1, period) {
  // WAAPI on pseudo-elements (the sweeps, ring and glow). Without it they are simply left out.
  const pseudoOk = typeof KeyframeEffect !== 'undefined' && 'pseudoElement' in KeyframeEffect.prototype
  let run = null
  let dead = false
  let fx = [] // the decorative animations (sweeps, ring, glow): they may outlive their run by ~.4s

  // ---------- safety: a runtime error leaves the full heavy headline and still reports back ----------
  function bail(e) {
    if (dead) return
    dead = true
    console.error('[fx:ignition] failed, falling back to the static page', e)
    const r = run
    try { if (r) stop(r) } catch (_) { /* nothing left to stop */ }
    try { endFx() } catch (_) { /* nothing left to stop */ }
    try { if (h1.dataset.split) compile(h1, { instant: true }) } catch (_) { /* the CSS below still shows the final state */ }
    h1.classList.remove('ign-hold', 'is-idea')
    period.style.transform = ''
    root.classList.remove('fx-ignition', 'ignite', 'ign-soft')
    // the thread and the intake wait for this event: never leave them hanging
    if (r && !r.dispatched) { try { dispatch(r) } catch (_) { /* best effort */ } }
  }
  const guard = (fn) => (...a) => { if (dead) return; try { fn(...a) } catch (e) { bail(e) } }

  // ---------- runs: every pass of the headline (first, repeat, replay) is one run, dispatched once ----------
  function newRun(kind) {
    if (run) stop(run)
    run = { kind, phase: 'new', timers: new Set(), offs: [], anim: null, animDone: false, dispatched: false, skipped: false }
    return run
  }
  function later(r, fn, ms) {
    const id = setTimeout(guard(() => { r.timers.delete(id); if (run === r) fn() }), ms)
    r.timers.add(id)
  }
  function stop(r) {
    r.timers.forEach(clearTimeout)
    r.timers.clear()
    for (const off of r.offs.splice(0)) off()
    if (r.anim) { r.anim.cancel(); r.anim = null }
    if (ACTIVE.has(r.phase)) r.phase = 'stopped'
  }

  const seen = () => { try { sessionStorage.setItem('run-seen', '1') } catch (_) { /* storage blocked */ } }

  function inView(min = 0) {
    const b = h1.getBoundingClientRect()
    if (!b.height) return false
    const vis = Math.min(b.bottom, window.innerHeight) - Math.max(b.top, navH())
    return vis > b.height * min
  }

  function dispatch(r, extra = {}) {
    if (r.dispatched) return
    r.dispatched = true
    const b = period.getBoundingClientRect()
    const detail = {
      x: b.left + b.width / 2 + window.scrollX,
      y: b.top + b.height / 2 + window.scrollY,
      t: performance.now(),
      instant: true,
      skipped: r.skipped,
      replay: r.kind === 'replay',
      silent: document.hidden || !inView(),
      ...extra,
    }
    document.dispatchEvent(new CustomEvent(EVT.IGNITE_DONE, { detail }))
  }

  // ---------- decorative animations (all on pseudo-elements: nothing is ever committed inline) ----------
  function endFx() {
    for (const a of fx) { try { a.cancel() } catch (_) { /* gone */ } }
    fx = []
  }
  function startFx(ringAt) {
    endFx()
    if (!pseudoOk) return
    const ms = (n) => n / 1000
    // Motion fills both ways: each keyframe 0 is invisible (it shows through the delay), and a finished
    // animation is dropped so its pseudo-element falls back to the same invisible resting style
    const add = (el, kf, opts) => {
      const a = animate(el, kf, opts)
      fx.push(a)
      a.finished.then(() => { a.cancel(); fx = fx.filter((x) => x !== a) }, () => {})
    }
    // the sweep: draws right to left from the word's right edge, then runs off its left end
    for (const w of h1.querySelectorAll('.line .w')) {
      const ch = w.querySelector('.ch')
      const i = ch ? Number(ch.style.getPropertyValue('--i')) || 0 : 0
      add(w, {
        transform: ['scaleX(0)', 'scaleX(1)', 'scaleX(1)', 'scaleX(0)'],
        transformOrigin: ['100% 50%', '100% 50%', '0% 50%', '0% 50%'],
        opacity: [1, 1, 1, 0.6],
      }, { duration: ms(SWEEP_MS), delay: ms(i * STAGGER + SWEEP_LEAD), times: [0, 0.56, 0.5601, 1], ease: [IO, 'linear', IO], pseudoElement: '::after' })
    }
    // the ring: one thin shock wave out of the dot at the impact
    add(period, { transform: ['scale(1)', 'scale(1)', 'scale(3.2)'], opacity: [0, 0.8, 0] },
      { duration: ms(RING_MS), delay: ms(ringAt), times: [0, 0.001, 1], ease: ['linear', OUT], pseudoElement: '::after' })
    // the dot powers on: one LED flash of the token glow (lime only glows when something works)
    add(period, { opacity: [0, 1, 0] },
      { duration: ms(GLOW_MS), delay: ms(ringAt), times: [0, 0.22, 1], ease: [OUT, OUT], pseudoElement: '::before' })
  }

  // ---------- the final state, at once (repeat visit, skip, hidden, paused) ----------
  function settle() {
    // Only a headline a wave or a replay has split needs compiling: an untouched one is already final
    // once html.ignite goes, and stays unsplit (pixel-identical to the static page; per-glyph spans lay
    // out the same but rasterise a hair differently).
    if (h1.dataset.split) compile(h1, { instant: true })
    h1.classList.remove('ign-hold')
    period.style.transform = ''
    root.classList.remove('ignite', 'ign-soft')
  }
  function finishInstant(r, { skipped = false } = {}) {
    if (run !== r || !ACTIVE.has(r.phase)) return
    r.skipped = r.skipped || skipped
    stop(r)
    endFx()
    settle()
    r.phase = 'done'
    if (skipped) seen() // the visitor met the intro and moved on (a hidden or scrolled-away page did not)
    dispatch(r, { instant: true })
  }

  // ---------- skip: the visitor moves, the intro gets out of the way ----------
  function armSkip(r) {
    const onInput = guard(() => finishInstant(r, { skipped: true }))
    let low = window.scrollY // the lowest y seen: a rerun's scroll back up never counts, a scroll down does
    const onScroll = guard(() => {
      const y = window.scrollY
      if (y < low) low = y
      else if (y > low + SKIP_SCROLL) finishInstant(r, { skipped: true })
    })
    for (const t of SKIP_EVENTS) window.addEventListener(t, onInput, { passive: true, capture: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    r.offs.push(() => {
      for (const t of SKIP_EVENTS) window.removeEventListener(t, onInput, { capture: true })
      window.removeEventListener('scroll', onScroll)
    })
  }

  // ---------- the wave ----------
  function wave(r) {
    if (isPaused() || document.hidden || !inView()) { finishInstant(r); return }
    r.phase = 'wave'
    seen()
    // Start everything inside one animation frame, so the CSS transitions and the WAAPI animations all
    // take that frame's time as their start.
    requestAnimationFrame(guard(() => { if (run === r && r.phase === 'wave') startWave(r) }))
  }

  function startWave(r) {
    h1.classList.add('ign-hold') // the period stays down until it lands (a replay has no html.ignite)
    // compile() splits on first use and flushes the fresh glyphs' idea style, so every glyph transitions
    compile(h1)
    const { count } = split(h1) // idempotent: the spans compile() just made
    const landAt = Math.max(0, (count - 1) * STAGGER + LAND_LEAD)
    const ringAt = landAt + Math.round(LAND_MS * PEAK)
    const a = animate(period,
      { transform: ['scale(0)', 'scale(1.35)', 'scale(0.9)', 'scale(1)'] },
      { delay: landAt / 1000, duration: LAND_MS / 1000, times: [0, PEAK, 0.72, 1], ease: [OUT, IO, POP] })
    r.anim = a
    startFx(ringAt)
    a.finished.then(guard(() => { r.animDone = true; if (run === r && r.phase === 'wave') complete(r) }), () => {})
    // done at the nominal end (or at Motion's finish, if a frame gets there first): the finish event is
    // frame-quantised and can trail by a frame or two, while the last ~20ms of the landing is a <1% settle
    later(r, () => { if (r.phase === 'wave') complete(r) }, landAt + LAND_MS)
  }

  function complete(r) {
    // Motion has committed scale(1) inline and released its WAAPI animation (cleared below); if the
    // timer won, drop the animation now (it is within its last <1% settle), so a late finish can never
    // write a transform over a later replay's held period
    if (!r.animDone && r.anim) r.anim.cancel()
    r.anim = null
    stop(r)
    period.style.transform = ''
    h1.classList.remove('ign-hold')
    root.classList.remove('ignite')
    // every glyph transition ended ~50ms ago; on a janky frame clock snap any remainder, so the
    // coordinates reported below are the period's final place
    h1.classList.add('no-anim')
    void h1.offsetWidth
    h1.classList.remove('no-anim')
    r.phase = 'done'
    dispatch(r, { instant: false })
  }

  // ---------- no Rubik in time: no morph, a short cross-fade to the final headline ----------
  function soft(r) {
    r.phase = 'soft'
    seen()
    root.classList.add('ign-soft')
    root.classList.remove('ignite') // the lines' colour and the period's scale transition (ignition.css)
    later(r, () => {
      root.classList.remove('ign-soft')
      stop(r)
      r.phase = 'done'
      dispatch(r, { instant: true }) // the headline stays unsplit; a replay splits it on demand
    }, SOFT_MS + 20)
  }

  // ---------- entry paths ----------
  async function first(r) {
    r.phase = 'gate'
    armSkip(r)
    const ok = await fontsReady('900 1em Rubik', 'מרעיון', 700)
    if (dead || run !== r || r.phase !== 'gate') return // skipped or reset while waiting
    if (ok) wave(r)
    else soft(r)
  }

  async function repeat(r) {
    r.phase = 'gate'
    await fontsReady('900 1em Rubik', 'מרעיון', 700)
    if (dead || run !== r || r.phase !== 'gate') return
    finishInstant(r)
  }

  function replay() {
    const r = newRun('replay')
    endFx()
    root.classList.remove('ign-soft', 'ignite')
    decompile(h1, { instant: true })
    h1.classList.add('ign-hold')
    period.style.transform = ''
    r.phase = 'hold'
    if (isPaused()) { finishInstant(r); return }
    armSkip(r)
    // the rerun scrolls back to the top: start once the beat has passed and the h1 is in view again
    const t0 = performance.now()
    const go = guard(() => {
      if (run !== r || r.phase !== 'hold') return
      const waited = performance.now() - t0
      if (waited >= REPLAY_MAX || (waited >= REPLAY_BEAT && inView(0.6))) wave(r) // wave() goes instant if still away
    })
    window.addEventListener('scroll', go, { passive: true })
    r.offs.push(() => window.removeEventListener('scroll', go))
    later(r, go, REPLAY_BEAT)
    later(r, go, REPLAY_MAX)
  }

  // ---------- wiring ----------
  document.addEventListener(EVT.RESET, guard(replay))
  onPause(guard((paused) => {
    if (!paused) return
    if (run && ACTIVE.has(run.phase)) finishInstant(run, { skipped: true })
    endFx() // WAAPI ignores the CSS pause: a ring or glow caught mid-air is dropped, not frozen
  }))

  const r = newRun(root.classList.contains('ignite') ? 'first' : 'repeat')
  return (r.kind === 'first' ? first(r) : repeat(r)).catch(bail)
}
