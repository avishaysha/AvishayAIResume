// Package `finale` (spec/finale.md): the run's output. The packet docks inside the WhatsApp row as a
// status light, lime blooms out from that dot until the whole contact act is lime, the process line runs
// right to left, the phone number rolls in on an odometer; then the footer signs off ("אבישי אויזרץ."
// compiles and ends on the dot) and prints the visitor's own run receipt, with a rerun.
//
// DOCK      onArrive(contact) (thread docks the packet; without a thread: inView). The dot pops
//           (scale 0 -> 1.4 -> 1), an ink ring leaves it (1 -> 3), then it keeps a slow CSS pulse (pausable,
//           only while on screen). The pop waits until the dot is actually on screen.
// BLOOM     .finale__flood: clip-path circle(--r at --cx --cy), centred on the dot's rect centre (section px).
//           Scroll-scrubbed and reversible after the dock: y0 = the scroll y where the dot sits on the
//           thread's head line (62% of the viewport, 70% <= 768px), y1 = y0 + 45% of the viewport (clamped to
//           the page end). r runs from r0 (the nearest card edge: the bloom is hidden under the lime card
//           until there, so it leaks out exactly where the wire went in) to R (the farthest section corner).
//           The spec's ['start end', 'center center'] offset is not used: the dock happens at or after the
//           section's centre has crossed the viewport's centre at every width (pDock >= 1), which would make
//           the bloom an instant switch. A late dock (fast fling) catches up over 1.1s instead of jumping.
//           Theme: data-theme=lime + document 'theme:change' once r > 60% of R AND the lime covers the
//           section's whole width under the nav (so the nav never turns lime over ink). Reversible.
// PROCESS   An ink runner travels the track right to left (.35s per step, eased per step), lighting each
//           step with a scale pulse; unlit steps are dimmed until then, then latch.
// ROWS      Ink fill (::before scaleY from the bottom) + lime text on hover/focus-visible (CSS); odometer on
//           inView once: each digit cell gets a 0..d column for the roll, then goes back to plain text.
// COPY      navigator.clipboard (legacy execCommand fallback); "העתקה" -> "הועתק" for 1.8s + live region;
//           on failure the address is selected.
// SIGNATURE inView(.4): compile(sig), then the period pops.
// RECEIPT   t0 = 'ignite:done'.t; records flow:arrive t for tools, router (or svc-ai), p-tickets, talks,
//           contact. Counts are read from the DOM. On inView the lines print (90ms apart), a caret blinks,
//           then "הזמן שלכם: mm:ss" (contact - t0). Silent (jumped) or skipped stages show "—".
// RERUN     dispatch 'run:reset', scroll to the top, focus the h1. The receipt and signature rewind in place
//           and replay on the next visit; the flood drains back into the dot; everything re-arms.
//
// Events: listens 'ignite:done', 'flow:arrive' (all nodes, for the receipt), 'run:reset';
//         dispatches 'theme:change' {section, theme} and 'run:reset' (rerun).
// Reduced motion: no motion at all. The section is lime (main.js), the dot, process, digits and signature
// are static; copy works; the receipt shows its ticks without times or total; rerun jumps instantly.
// Any runtime error switches the package off (html.fx-finale removed, inline styles cleared): the
// foundation's static page remains.

import '../styles/finale.css'
import { animate, inView, frame } from 'motion'
import * as env from '../core/env.js'
import { isPaused } from '../core/state.js'
import { EVT, onArrive, flowState } from '../core/flow.js'
import { compile, decompile } from '../core/compile.js'
import { onRefresh } from '../core/refresh.js'
import { scrollToY, navH } from '../core/scroll.js'

const root = document.documentElement
const OUT = [0.22, 1, 0.36, 1] // --ease-out
const IO = [0.65, 0, 0.35, 1] // --ease-io
const POP = [0.34, 1.56, 0.64, 1] // --ease-pop

const STEP_S = 0.35 // process: seconds per step
const LINE_MS = 90 // receipt: line print stagger
const LINE_S = 0.45 // receipt: one line's print
const COPY_MS = 1800
const BLOOM_SPAN = 0.45 // bloom length in viewport heights of scrolling
const BLOOM_MIN = 0.2 // ... never shorter than this, even at the very end of the page

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const smooth = (t) => t * t * (3 - 2 * t)
const pad = (n) => String(n).padStart(2, '0')

/** mm:ss.t from ms */
function fmtT(ms) {
  const d = Math.round(Math.max(0, ms) / 100) // tenths
  const m = Math.floor(d / 600)
  const s = Math.floor((d % 600) / 10)
  return `${pad(m)}:${pad(s)}.${d % 10}`
}
/** mm:ss from ms */
function fmtTotal(ms) {
  const s = Math.round(Math.max(0, ms) / 1000)
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

// receipt stage <- the node ids that can stand for it (the first arrival wins)
const STAGE_OF = { tools: 'tools', router: 'router', 'svc-ai': 'router', 'p-tickets': 'projects', talks: 'talks', contact: 'contact' }

let instance = null

export function init() {
  if (instance) return
  const section = document.getElementById('contact')
  const card = section && section.querySelector('[data-contact]')
  if (!card) return
  root.classList.add('fx-finale')
  instance = createFinale(section, card)
}

function createFinale(section, card) {
  const live = env.motionOk
  const q = (sel, el = document) => el.querySelector(sel)
  const footer = q('footer.footer')
  const E = {
    section,
    card,
    flood: q('.finale__flood', section),
    process: q('.process', card),
    steps: [...card.querySelectorAll('.process__step')],
    wa: q('.row--wa', card),
    dot: q('[data-dock]', card),
    odo: q('[data-odometer]', card),
    copy: q('[data-copy]', card),
    copyStatus: q('[data-copy-status]', card),
    mailText: q('.row--mail bdi', card),
    sig: footer && q('[data-sig]', footer),
    receipt: footer && q('[data-receipt]', footer),
    total: footer && q('[data-total]', footer),
    rerun: footer && q('[data-rerun]', footer),
  }
  E.copyLabel = E.copy && (q('[data-copy-label]', E.copy) || E.copy)
  E.lines = E.receipt ? [...E.receipt.querySelectorAll('li[data-stage]')] : []
  E.period = E.sig && q('.period', E.sig)

  const offs = []
  const timers = new Set()
  const anims = new Set()
  let dead = false

  // ---------- safety: any runtime error leaves the foundation's static page ----------
  function die(e) {
    if (dead) return
    dead = true
    console.error('[fx:finale] failed, falling back to the static page', e)
    offs.splice(0).forEach((f) => { try { f() } catch (_) { /* already gone */ } })
    timers.forEach(clearTimeout)
    anims.forEach((a) => { try { a.stop() } catch (_) { /* done */ } })
    root.classList.remove('fx-finale')
    // a stopped animation may still flush one last frame: scrub now, on the next frame and a beat later
    const scrub = () => {
      try {
        if (E.flood) E.flood.style.removeProperty('--r')
        for (const el of [E.dot, E.period, E.copyLabel, ...E.steps.map((s) => q('.process__node', s))]) {
          if (el) { el.style.transform = ''; el.style.opacity = '' }
        }
        if (E.process) E.process.style.removeProperty('--pp')
        if (E.odo) E.odo.querySelectorAll('.odo__col').forEach((c) => c.remove())
        if (E.odo) E.odo.querySelectorAll('.is-rolling').forEach((c) => c.classList.remove('is-rolling'))
        if (E.sig) E.sig.classList.remove('is-idea')
      } catch (_) { /* best effort */ }
    }
    scrub()
    requestAnimationFrame(scrub)
    setTimeout(scrub, 120)
    try {
      if (live && section.dataset.theme !== 'ink') {
        section.dataset.theme = 'ink'
        document.dispatchEvent(new CustomEvent(EVT.THEME, { detail: { section, theme: 'ink' } }))
      }
    } catch (_) { /* best effort */ }
  }
  const safe = (fn) => function safeFn(...a) {
    if (dead) return undefined
    try { return fn.apply(this, a) } catch (e) { die(e); return undefined }
  }
  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); safe(fn)() }, ms)
    timers.add(t)
    return t
  }
  const listen = (target, type, fn, opts) => {
    const h = safe(fn)
    target.addEventListener(type, h, opts)
    offs.push(() => target.removeEventListener(type, h, opts))
  }
  const track = (a) => {
    anims.add(a)
    a.then(() => anims.delete(a), () => anims.delete(a))
    return a
  }
  // inView that keeps watching: onEnter() on every entry, onLeave() on every exit
  const watch = (el, onEnter, onLeave, opts) => {
    if (!el) return
    offs.push(inView(el, () => {
      safe(onEnter)()
      return () => { if (onLeave) safe(onLeave)() }
    }, opts))
  }

  // ================= always (reduced motion too): counts, copy, rerun =================
  fillCounts()
  if (E.copy) listen(E.copy, 'click', onCopy)
  if (E.rerun) listen(E.rerun, 'click', onRerun)

  function nameOf(h) {
    if (!h) return ''
    const sr = [...h.children].find((c) => c.classList.contains('sr-only'))
    return (sr ? sr.textContent : h.textContent).replace(/\s+/g, ' ').trim()
  }
  function setValue(stage, text) {
    const li = E.lines.find((l) => l.dataset.stage === stage)
    const v = li && q('.receipt__v', li)
    if (v && v.textContent !== text) v.textContent = text
  }
  function fillCounts() {
    const tools = document.querySelectorAll('.marquee__list:first-child .marquee__logo').length
    const services = [...document.querySelectorAll('.service')]
    const names = services.map((s) => nameOf(q('.service__name', s))).filter(Boolean)
    const projects = document.querySelectorAll('.project').length
    if (tools) setValue('tools', `${tools} כלים`)
    if (services.length && names.length === services.length) setValue('router', `${services.length} תחומים: ${names.join(', ')}`)
    if (projects) setValue('projects', `${projects} פרויקטים נבחרים`)
  }

  // ---------- copy ----------
  let copyTimer = 0
  let copyBusy = false
  async function onCopy() {
    if (copyBusy) return
    copyBusy = true
    const text = E.copy.dataset.copy || (E.mailText && E.mailText.textContent) || ''
    let ok = false
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true }
    } catch (_) { ok = false }
    copyBusy = false
    if (dead) return
    if (!ok) ok = legacyCopy()
    if (ok) safe(copied)()
    else safe(selectAddress)()
  }
  function selectAddress() {
    if (!E.mailText) return false
    const sel = window.getSelection()
    if (!sel) return false
    const range = document.createRange()
    range.selectNodeContents(E.mailText)
    sel.removeAllRanges()
    sel.addRange(range)
    return true
  }
  function legacyCopy() {
    if (!selectAddress()) return false
    let ok = false
    try { ok = document.execCommand('copy') } catch (_) { ok = false }
    if (ok) window.getSelection().removeAllRanges()
    return ok
  }
  function copied() {
    clearTimeout(copyTimer)
    E.copy.classList.add('is-copied')
    E.copyLabel.textContent = 'הועתק'
    if (live && !isPaused()) track(animate(E.copyLabel, { opacity: [0, 1], y: ['0.45em', '0em'] }, { duration: 0.32, ease: OUT }))
    if (E.copyStatus) {
      // clear first, so a second copy is announced again
      E.copyStatus.textContent = ''
      later(() => { E.copyStatus.textContent = 'כתובת המייל הועתקה' }, 60)
    }
    copyTimer = later(() => {
      E.copy.classList.remove('is-copied')
      E.copyLabel.textContent = 'העתקה'
      if (live && !isPaused()) track(animate(E.copyLabel, { opacity: [0, 1] }, { duration: 0.25, ease: OUT }))
      if (E.copyStatus) E.copyStatus.textContent = ''
    }, COPY_MS)
  }

  // ---------- rerun ----------
  function onRerun() {
    document.dispatchEvent(new CustomEvent(EVT.RESET))
    scrollToY(0, { instant: !live })
    const h1 = q('h1')
    if (h1) {
      if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1')
      h1.focus({ preventScroll: true })
    }
  }

  if (!live) return { die }

  // ================= motion only =================

  // ---------- receipt: the visitor's own run ----------
  const run = { t0: null, tPortrait: null, stages: new Map() }
  const rc = { printed: false, caret: false, seen: false }
  if (E.total) {
    E.total.textContent = ''
    E.totalText = document.createElement('span')
    E.totalText.className = 'receipt__total-text'
    E.caret = document.createElement('span')
    E.caret.className = 'receipt__caret'
    E.caret.setAttribute('aria-hidden', 'true')
    E.total.append(E.totalText, E.caret)
  }

  listen(document, EVT.IGNITE_DONE, (e) => {
    if (run.t0 == null) run.t0 = (e.detail && Number.isFinite(e.detail.t)) ? e.detail.t : performance.now()
    renderTimes()
  })
  listen(document, EVT.ARRIVE, (e) => {
    const d = e.detail || {}
    if (d.id === 'portrait' && run.tPortrait == null) run.tPortrait = d.t
    record(d.id, d.t, d.silent)
  })
  // the first arrival of a stage wins; a stand-in from our own fallback gives way to the real event
  function record(id, t, silent, fb = false) {
    const k = STAGE_OF[id]
    const had = k && run.stages.get(k)
    if (!k || !Number.isFinite(t) || (had && !(had.fb && !fb))) return
    run.stages.set(k, { t, silent: !!silent, fb })
    renderTimes()
  }

  function renderTimes() {
    const base = run.t0 ?? run.tPortrait
    const t0 = base ?? 0 // no trigger seen (ignition and thread off): the visitor's time since the page opened
    let prev = 0
    for (const li of E.lines) {
      const cell = q('.receipt__t', li)
      if (!cell) continue
      let txt = '—'
      if (li.dataset.stage === 'ignite') {
        if (base != null) txt = fmtT(0)
      } else {
        const s = run.stages.get(li.dataset.stage)
        if (s && !s.silent && s.t - t0 >= prev) { prev = s.t - t0; txt = fmtT(prev) }
      }
      if (cell.textContent !== txt) cell.textContent = txt
    }
    if (E.totalText) {
      const c = run.stages.get('contact')
      if (c) {
        // reached by a jump (or a restored scroll): there is no run to time
        const val = c.silent ? '—' : fmtTotal(c.t - t0)
        const cur = E.totalText.dataset.v
        if (cur !== val) {
          E.totalText.dataset.v = val
          E.totalText.textContent = 'הזמן שלכם: '
          const b = document.createElement('bdi')
          b.dir = 'ltr'
          b.textContent = val
          E.totalText.append(b)
        }
      } else if (E.totalText.textContent) {
        E.totalText.textContent = ''
        delete E.totalText.dataset.v
      }
    }
    if (rc.printed && rc.caret) maybeTotal()
  }

  function print() {
    if (!E.receipt || rc.printed) return
    rc.printed = true
    renderTimes()
    const quiet = isPaused()
    E.receipt.classList.remove('is-rewinding')
    E.receipt.classList.toggle('is-instant', quiet)
    E.receipt.classList.add('is-printed')
    later(() => {
      rc.caret = true
      E.receipt.classList.add('is-caret')
      later(maybeTotal, quiet ? 0 : 620)
    }, quiet ? 0 : (E.lines.length - 1) * LINE_MS + LINE_S * 1000)
  }
  function maybeTotal() {
    if (!rc.printed || !rc.caret || !E.totalText || !E.totalText.textContent) return
    E.receipt.classList.add('is-total')
  }
  function unprint() {
    if (!E.receipt) return
    rc.printed = false
    rc.caret = false
    E.receipt.classList.remove('is-printed', 'is-caret', 'is-total', 'is-instant')
    E.receipt.classList.add('is-rewinding')
  }
  watch(E.receipt, () => { rc.seen = true; E.receipt.classList.add('is-seen'); print() },
    () => { rc.seen = false; E.receipt.classList.remove('is-seen') }, { amount: 0.35 })

  // ---------- footer signature ----------
  const sg = { signed: false }
  function sign() {
    if (!E.sig || sg.signed) return
    sg.signed = true
    const quiet = isPaused()
    const dur = compile(E.sig, { instant: quiet })
    if (!E.period) return
    const pop = () => {
      if (!sg.signed) return
      E.sig.classList.add('is-signed')
      if (quiet || isPaused()) { E.period.style.transform = ''; return }
      track(animate(E.period, { scale: [0, 1.35, 1] }, { duration: 0.5, ease: [OUT, IO], times: [0, 0.55, 1] }))
    }
    if (quiet) pop()
    else later(pop, Math.max(0, dur - 100))
  }
  function unsign() {
    if (!E.sig || !sg.signed) return
    sg.signed = false
    decompile(E.sig)
    if (E.period) {
      track(animate(E.period, { scale: 0 }, { duration: 0.3, ease: OUT })).then(() => {
        if (sg.signed) return
        E.sig.classList.remove('is-signed')
        E.period.style.transform = ''
      })
    }
  }
  watch(E.sig, sign, null, { amount: 0.4 })

  // ---------- odometer ----------
  const dk = { docked: false, silent: false, dotShown: false, waSeen: false, procSeen: false, procDone: false, secSeen: false, armPending: false, cancel: null, safety: 0 }
  const od = { rolled: false }
  const cells = E.odo ? [...E.odo.querySelectorAll('.odo__d')] : []
  function roll() {
    if (od.rolled || !cells.length) return
    od.rolled = true
    if (isPaused()) return
    cells.forEach((cell, i) => {
      const d = clamp(parseInt(cell.dataset.d, 10) || 0, 0, 9)
      if (!d) return // a 0 wheel does not turn
      const col = document.createElement('span')
      col.className = 'odo__col'
      col.setAttribute('aria-hidden', 'true')
      for (let k = 0; k <= d; k++) {
        const s = document.createElement('span')
        s.textContent = String(k)
        col.append(s)
      }
      cell.append(col)
      cell.classList.add('is-rolling')
      track(animate(col, { y: ['0em', `-${d}em`] }, { duration: 1.1 + i * 0.05, ease: OUT })).then(() => {
        col.remove()
        cell.classList.remove('is-rolling')
      })
    })
  }
  watch(E.wa, () => { dk.waSeen = true; E.dot && E.dot.classList.add('is-seen'); roll(); maybeShowDot() },
    () => { dk.waSeen = false; E.dot && E.dot.classList.remove('is-seen') }, { amount: 0.5 })

  // ---------- dock + process ----------
  // The dock is the packet's to make. No timer fallback while the thread runs (a slow reader would see
  // the dot light up before the packet gets there); flow off -> inView, and flow:off -> at once (onArrive).
  // Two safety nets of our own: the thread claimed the run but never built (flow stays 'pending'), or the
  // dock line cannot be reached (an extreme viewport): dock silently after a while.
  function armDock() {
    if (dk.cancel) dk.cancel()
    dk.cancel = onArrive(section, safe(onDock), { fallback: false })
  }
  function armSafety() {
    clearTimeout(dk.safety)
    dk.safety = 0
    if (dk.docked || !dk.secSeen) return
    const st = flowState()
    const atEnd = window.scrollY >= document.documentElement.scrollHeight - window.innerHeight - 4
    if (st === 'pending' || (st === 'on' && atEnd && B.g && !B.g.reachable)) {
      dk.safety = later(() => {
        dk.safety = 0
        if (dk.docked || !dk.secSeen || dk.armPending) return
        if (flowState() === 'pending' || window.scrollY >= document.documentElement.scrollHeight - window.innerHeight - 4) {
          if (dk.cancel) { dk.cancel(); dk.cancel = null }
          onDock({ silent: true, fallback: 'timer', t: performance.now() })
        }
      }, st === 'pending' ? 2500 : 1500)
    }
  }
  function onDock(detail) {
    dk.cancel = null
    clearTimeout(dk.safety)
    if (dk.docked) return
    measure() // fresh geometry, measured while still undocked (r stays 0 until bloomIn sets the gate)
    dk.docked = true
    dk.silent = !!(detail && detail.silent)
    // a fallback dispatches nothing, so the receipt hears it from here (a real flow:arrive replaces it)
    if (!detail || detail.fallback) record('contact', detail && Number.isFinite(detail.t) ? detail.t : performance.now(), true, true)
    bloomIn(dk.silent)
    maybeShowDot()
    maybeRunProcess()
  }

  function maybeShowDot() {
    if (!dk.docked || dk.dotShown || !dk.waSeen || !E.dot) return
    dk.dotShown = true
    E.dot.classList.add('is-docked')
    if (isPaused()) { E.dot.classList.add('is-live'); return }
    track(animate(E.dot, { scale: [0, 1.4, 1] }, { duration: 0.45, ease: [OUT, IO], times: [0, 0.5, 1] }))
    E.dot.classList.remove('is-ring')
    void E.dot.offsetWidth
    E.dot.classList.add('is-ring')
    later(() => { if (dk.dotShown) E.dot.classList.add('is-live') }, 760)
  }
  function hideDot() {
    if (!E.dot || !dk.dotShown) return
    dk.dotShown = false
    E.dot.classList.remove('is-live', 'is-ring')
    track(animate(E.dot, { scale: 0 }, { duration: 0.3, ease: OUT })).then(() => {
      if (dk.dotShown) return
      E.dot.classList.remove('is-docked')
      E.dot.style.transform = ''
    })
  }

  let procAnim = null
  function lightStep(i, pulse) {
    const s = E.steps[i]
    if (!s || s.classList.contains('is-lit')) return
    s.classList.add('is-lit')
    const node = q('.process__node', s)
    if (node && pulse) track(animate(node, { scale: [0.78, 1.4, 1] }, { duration: 0.5, ease: [OUT, IO], times: [0, 0.45, 1] }))
  }
  function maybeRunProcess() {
    if (!dk.docked || dk.procDone || !dk.procSeen || !E.process) return
    dk.procDone = true
    const n = E.steps.length
    if (isPaused() || n < 2) {
      E.process.classList.add('is-run', 'is-instant')
      E.process.style.setProperty('--pp', '1')
      E.steps.forEach((_, i) => lightStep(i, false))
      return
    }
    E.process.classList.add('is-running')
    lightStep(0, true)
    const segs = n - 1
    const kf = Array.from({ length: n }, (_, i) => i / segs)
    // one keyframe per node, eased per segment: the runner eases into and out of every step
    procAnim = track(animate(0, kf, {
      duration: STEP_S * segs,
      ease: Array(segs).fill(IO),
      times: kf,
      onUpdate: safe((v) => {
        E.process.style.setProperty('--pp', v.toFixed(4))
        for (let i = 1; i < n; i++) if (v >= i / segs - 0.004) lightStep(i, true)
      }),
    }))
    procAnim.then(() => {
      if (!dk.procDone) return
      E.process.style.setProperty('--pp', '1')
      E.steps.forEach((_, i) => lightStep(i, true))
      E.process.classList.remove('is-running')
      E.process.classList.add('is-run')
    })
  }
  function resetProcess() {
    dk.procDone = false
    if (procAnim) { procAnim.stop(); procAnim = null }
    if (!E.process) return
    E.process.classList.remove('is-running', 'is-run', 'is-instant')
    E.process.style.removeProperty('--pp')
    E.steps.forEach((s) => {
      s.classList.remove('is-lit')
      const node = q('.process__node', s)
      if (node) node.style.transform = ''
    })
  }
  watch(E.process, () => { dk.procSeen = true; maybeRunProcess() }, () => { dk.procSeen = false }, { amount: 0.6 })
  watch(section, () => { dk.secSeen = true; armSafety() }, () => {
    dk.secSeen = false
    clearTimeout(dk.safety)
    if (dk.armPending) { dk.armPending = false; armDock() }
  }, { amount: 0.3 })

  // ---------- bloom ----------
  const B = { g: null, gate: 1, drain: 1, draining: false, r: -1, theme: section.dataset.theme || 'ink', gateAnim: null, drainAnim: null }

  function measure() {
    if (!E.flood || !E.dot) { B.g = null; return }
    const sr = section.getBoundingClientRect()
    const dr = E.dot.getBoundingClientRect()
    const cr = card.getBoundingClientRect()
    if (!sr.height || !cr.height) { B.g = null; return }
    const sy = window.scrollY
    const vh = window.innerHeight
    const dx = dr.left + dr.width / 2
    const dy = dr.top + dr.height / 2
    const g = { top: sr.top + sy, w: sr.width, h: sr.height, cx: dx - sr.left, cy: dy - sr.top, navH: navH(), vh }
    g.R = Math.ceil(Math.max(
      Math.hypot(g.cx, g.cy), Math.hypot(g.w - g.cx, g.cy),
      Math.hypot(g.cx, g.h - g.cy), Math.hypot(g.w - g.cx, g.h - g.cy),
    )) + 2
    // until r0 the circle is hidden under the (equally lime) card: start there, so lime leaks out at once
    g.r0 = Math.max(0, Math.min(dx - cr.left, cr.right - dx, dy - cr.top, cr.bottom - dy) - 4)
    const dockY = dy + sy
    const maxY = Math.max(0, document.documentElement.scrollHeight - vh)
    const head = vh * (env.isMobile ? 0.7 : 0.62) // the thread's head line
    // can the thread's head line reach the dock at all? (if not, armSafety docks at the page end)
    g.reachable = maxY + head >= dockY - 2
    let y0 = dockY - head
    let y1 = y0 + vh * BLOOM_SPAN
    if (y1 > maxY - 2) { y1 = maxY - 2; y0 = Math.min(y0, y1 - vh * BLOOM_MIN) }
    g.y0 = y0
    g.y1 = Math.max(y1, y0 + 1)
    B.g = g
    E.flood.style.setProperty('--cx', `${g.cx.toFixed(1)}px`)
    E.flood.style.setProperty('--cy', `${g.cy.toFixed(1)}px`)
    B.r = -1
    update()
  }

  function update() {
    const g = B.g
    if (!g) return
    const y = window.scrollY
    let r = 0
    if (dk.docked || B.draining) {
      const p = clamp((y - g.y0) / (g.y1 - g.y0), 0, 1)
      if (p > 0) {
        r = g.r0 + (g.R - g.r0) * smooth(p)
        if (B.gate < 1) r = g.r0 + (r - g.r0) * B.gate
      }
      r *= B.drain
    }
    if (Math.abs(r - B.r) > 0.2 || (r === 0 && B.r !== 0)) {
      B.r = r
      E.flood.style.setProperty('--r', `${r.toFixed(1)}px`)
    }
    // lime once most of the act is lime AND the full width under the nav is (the nav retints over lime only)
    const line = clamp(y + g.navH - g.top, 0, g.h)
    const rNav = Math.max(Math.hypot(g.cx, line - g.cy), Math.hypot(g.w - g.cx, line - g.cy))
    const need = Math.max(0.6 * g.R, rNav)
    const lime = B.theme === 'lime' ? r > need - 6 && r > 1 : r > need + 6
    if (lime !== (B.theme === 'lime')) setTheme(lime ? 'lime' : 'ink')
  }
  const updateSafe = safe(update)
  const schedule = () => {
    frame.render(updateSafe)
    // the dock line may be out of reach on an extreme viewport: the safety net watches the page end
    if (!dk.docked && dk.secSeen && !dk.safety) frame.read(safe(armSafety))
  }

  function setTheme(t) {
    B.theme = t
    section.dataset.theme = t
    document.dispatchEvent(new CustomEvent(EVT.THEME, { detail: { section, theme: t } }))
  }

  function bloomIn(silent) {
    if (B.drainAnim) { B.drainAnim.stop(); B.drainAnim = null }
    B.draining = false
    B.drain = 1
    if (B.gateAnim) { B.gateAnim.stop(); B.gateAnim = null }
    if (silent || isPaused()) { B.gate = 1; update(); return }
    B.gate = 0
    B.gateAnim = track(animate(0, 1, { duration: 1.1, ease: OUT, onUpdate: (v) => { B.gate = v; updateSafe() } }))
    B.gateAnim.then(() => { B.gate = 1; B.gateAnim = null })
  }
  // rerun: undock at once (nothing may re-light from a stale dock), the lime drains back into the dot
  function drainOut() {
    if (B.gateAnim) { B.gateAnim.stop(); B.gateAnim = null }
    B.gate = 1
    const was = dk.docked
    dk.docked = false
    if (!was || B.r <= 0 || isPaused()) { B.draining = false; B.drain = 1; update(); return }
    B.draining = true
    B.drainAnim = track(animate(1, 0, { duration: 0.6, ease: IO, onUpdate: (v) => { B.drain = v; updateSafe() } }))
    B.drainAnim.then(() => {
      if (!B.draining) return // a new dock took over
      B.drainAnim = null
      B.draining = false
      B.drain = 1
      updateSafe()
    })
  }

  offs.push(onRefresh(safe(measure)))
  listen(window, 'scroll', schedule, { passive: true })
  let lastVh = window.innerHeight
  listen(window, 'resize', () => {
    // onRefresh skips height-only resizes; a big one (mobile toolbar, rotation) moves the bloom's range
    if (Math.abs(window.innerHeight - lastVh) > 80) { lastVh = window.innerHeight; frame.read(safe(measure)) }
  }, { passive: true })

  // ---------- run:reset (rerun) ----------
  listen(document, EVT.RESET, () => {
    run.t0 = null
    run.tPortrait = null
    run.stages.clear()
    renderTimes()
    // the footer rewinds in place (it replays when the visitor comes back down)
    unprint()
    unsign()
    // the contact act drains back into the dot and goes dark
    drainOut()
    hideDot()
    resetProcess()
    od.rolled = false
    dk.silent = false
    // flow.js has already cleared data-arrived (its listener was registered first). Re-arm once the
    // section is out of view, so a flow-off fallback cannot re-dock it while the page scrolls away.
    if (dk.secSeen) dk.armPending = true
    else armDock()
  })

  armDock()
  return { die }
}
