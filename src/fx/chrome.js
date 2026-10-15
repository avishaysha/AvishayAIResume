// Package `chrome`: the page's furniture, and the small moments that make it feel built.
//
// NAV        an IntersectionObserver over [data-section] (rootMargin '-1px 0px -95% 0px': the top 5% of
//            the viewport) sets nav[data-theme] to the section under it; re-read on 'theme:change' and on
//            any data-theme mutation. The first theme of a mid-page load snaps; later swaps fade .3s.
// PROGRESS   scroll-linked WAAPI (native ScrollTimeline where supported): the bar scaleX 0->1 from the
//            right, and the head (the period again) rides its leading edge right to left.
// LED        the logo period glows while |scroll velocity| > 40px/s, and fades 600ms after. Also one
//            blink on 'ignite:done'. Off while paused.
// BUS        html.fx-bus: JS drives the logo track. x = (x + dir*(W/45 + min(|v|*.25, 900))*surge*dt) mod W,
//            v = scroll velocity smoothed by .12, dir = sign(v) with hysteresis at |v| > 80. One transform
//            write per frame, only while the band is in view and not paused (hover, keyboard focus, the
//            bus toggle, the global pause); it eases to a stop and the loop sleeps. onArrive(tools): the
//            beam draws down the band, the halo blooms and the speed surges 4x -> 1x over 1.4s.
// FLOOD      every [data-flood] gets span.flood[aria-hidden]: a clipped copy of its own content in the
//            flooded colours, so the colour change follows the circle edge exactly. The circle grows from
//            the pointer's entry point (hover), the tap point (touch, .is-pressed + scale .97) or the
//            centre (keyboard focus), and drains toward the exit point.
// MAGNET     fine pointers only: the hero WhatsApp CTA and the nav CTA get an inner .skin (it carries every
//            visual; the hit area never moves) that leans up to 8px toward a pointer within 80px (spring
//            stiffness 250, damping 20). a.row--wa leans its content the same way (--mx/--my).
// REVEALS    [data-reveal] eyebrows rise 16px and fade in; titles rise line by line out of a mask
//            (lines measured at reveal time, the original markup restored when done). inView amount
//            .35, once, staggered .08s. Anything already on screen at init is simply shown.
// HIGHLIGHT  .hl::before scaleX(var(--hl)) scrubbed by the title's scroll (start 85% -> start 45%).
// DEPTH      [data-sheet-inner] scale 1 -> .965, opacity 1 -> .55 while the projects sheet rises over it.
//
// Reduced motion: only the nav retint (no transitions) and the progress bar as a static position
// indicator; hover colours swap instantly in CSS. Everything else returns early.
// Contract   listens  'theme:change', 'ignite:done', 'run:reset', 'motion:pause', flow:arrive on tools
//            sets     html.fx-chrome (sync), html.fx-bus (while JS drives the logos), nav[data-theme]
//            reads    --rail-x (thread) for the beam and the halo, in CSS only

import '../styles/chrome.css'
import { animate, scroll, inView, frame, cancelFrame } from 'motion'
import * as env from '../core/env.js'
import { isPaused, onPause } from '../core/state.js'
import { EVT, onArrive } from '../core/flow.js'
import { onRefresh } from '../core/refresh.js'
import { targetY } from '../core/scroll.js'

const root = document.documentElement
const OUT = [0.22, 1, 0.36, 1]
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]
const later = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn))

// the latest scroll velocity (px/s) and when it was sampled; motion's scroll() only reports on scroll
// events, so a stale sample means the page has stopped
const vel = { v: 0, t: -1e9 }
const undo = []

export function init() {
  root.classList.add('fx-chrome')
  const motion = env.motionOk
  try {
    navTheme()
    progress(motion)
    if (!motion) return
    led()
    bus()
    skins() // before the floods: a magnetic CTA's flood lives inside its skin
    floods()
    magnet()
    reveals()
    highlighter()
    depth()
  } catch (e) {
    // main.js removes html.fx-chrome; hand the logos back to the CSS marquee as well
    for (const fn of undo.splice(0)) { try { fn() } catch (err) { /* keep unwinding */ } }
    throw e
  }
}

// ---------- NAV: the section under the nav sets its theme ----------
function navTheme() {
  const nav = $('[data-nav]')
  const secs = $$('[data-section]')
  if (!nav || !secs.length) return
  const hits = new Set()
  let retintT = 0
  // sections are in document order and only overlap at the sheets' rounded tops: the one under the
  // probe band is the last whose top has passed it
  const byRect = () => {
    const band = innerHeight * 0.05
    let cur = secs[0]
    for (const s of secs) if (s.getBoundingClientRect().top <= band) cur = s
    return cur
  }
  const apply = (calm = false) => {
    let cur = null
    for (const s of secs) if (hits.has(s)) cur = s
    if (!cur) cur = byRect()
    const t = cur.dataset.theme || 'ink'
    if (nav.dataset.theme === t) return
    if (calm) {
      nav.classList.add('nav--calm')
      nav.dataset.theme = t
      void getComputedStyle(nav).backgroundColor
      later(() => nav.classList.remove('nav--calm'))
      return
    }
    nav.classList.add('nav--retint')
    nav.dataset.theme = t
    clearTimeout(retintT)
    retintT = setTimeout(() => nav.classList.remove('nav--retint'), 380)
  }
  apply(true)
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) { if (e.isIntersecting) hits.add(e.target); else hits.delete(e.target) }
    apply()
  }, { rootMargin: '-1px 0px -95% 0px' })
  secs.forEach((s) => io.observe(s))
  document.addEventListener(EVT.THEME, () => apply())
  // belt and braces: a section that changes theme without the event (e.g. the static lime contact)
  const mo = new MutationObserver((list) => { if (list.some((m) => m.target !== nav)) apply() })
  secs.forEach((s) => mo.observe(s, { attributes: true, attributeFilter: ['data-theme'] }))
}

// ---------- PROGRESS: right to left, led by the period ----------
function progress(motion) {
  const nav = $('[data-nav]')
  if (!nav) return
  const bar = $('.nav__progress-bar', nav)
  const wrap = $('.nav__progress-headwrap', nav)
  const head = $('.nav__progress-head', nav)
  if (bar) scroll(animate(bar, { transform: ['scaleX(0)', 'scaleX(1)'] }, { ease: 'linear' }))
  if (!motion || !wrap || !head) return
  scroll(animate(wrap, { transform: ['translateX(0%)', 'translateX(-100%)'] }, { ease: 'linear' }))
  // the head appears once the run is moving (it would be a stray half-dot at the very top)
  scroll(animate(head, { opacity: [0, 1, 1] }, { ease: 'linear', times: [0, 0.012, 1] }))
}

// ---------- LED: the logo period glows while the page moves ----------
function led() {
  const dot = $('.nav__logo .period')
  let timer = 0
  const live = (ms) => {
    if (!dot || isPaused()) return
    dot.classList.add('is-live')
    clearTimeout(timer)
    timer = setTimeout(() => dot.classList.remove('is-live'), ms)
  }
  // motion reports 0 when two scroll frames are more than 50ms apart (a busy phone mid-fling): then
  // measure the step ourselves, so the LED and the bus still feel the flick
  let lastY = window.scrollY
  let lastT = performance.now()
  scroll((p, info) => {
    const now = performance.now()
    const y = info.y.current
    const dt = now - lastT
    let v = info.y.velocity || 0
    if (!v && y !== lastY && dt > 0 && dt < 250) v = ((y - lastY) / dt) * 1000
    lastY = y
    lastT = now
    vel.v = v
    vel.t = now
    if (Math.abs(v) > 40) live(600)
  })
  document.addEventListener(EVT.IGNITE_DONE, () => live(900))
  onPause((paused) => { if (paused && dot) { clearTimeout(timer); dot.classList.remove('is-live') } })
}

// ---------- BUS: the logos run on scroll speed ----------
function bus() {
  const sec = $('[data-node="tools"]') || $('#tools')
  const track = sec && $('.marquee__track', sec)
  const list = track && $('.marquee__list', track)
  if (!list) return
  const toggle = $('[data-bus-toggle]', sec)

  const halo = document.createElement('span')
  halo.className = 'bus__halo'
  halo.setAttribute('aria-hidden', 'true')
  sec.prepend(halo)

  let W = list.getBoundingClientRect().width
  let x = 0
  let dir = 1
  let vs = 0
  let surge = 1
  let surgeAnim = null
  let visible = false
  let hover = false
  let focus = false
  let held = toggle ? toggle.getAttribute('aria-pressed') === 'true' : false
  let running = false
  let dead = false

  const want = () => (!hover && !focus && !held && !isPaused() ? 1 : 0)
  let gate = want() // a page that loads paused never starts the logos
  const write = () => { track.style.transform = `translate3d(${x.toFixed(2)}px,0,0)` }

  function step(fd) {
    try {
      const dt = Math.min(fd.delta, 50) / 1000
      const v = performance.now() - vel.t < 120 ? vel.v : 0
      vs += (v - vs) * (1 - Math.pow(0.88, dt * 60))
      if (Math.abs(vs) > 80) dir = vs > 0 ? 1 : -1
      const target = want()
      gate += (target - gate) * (1 - Math.exp(-dt / 0.16))
      if (target === 0 && gate < 0.004) gate = 0
      const speed = Math.min((W / 45 + Math.min(Math.abs(vs) * 0.25, 900)) * surge, 2400) * gate
      if (W > 1) {
        x = (x + dir * speed * dt) % W
        if (x < 0) x += W
      }
      write()
      if (!visible || (target === 0 && gate === 0)) stop()
    } catch (e) {
      kill(e)
    }
  }
  function start() {
    if (running || dead || !visible) return
    if (want() === 0 && gate === 0) return
    running = true
    frame.update(step, true)
  }
  function stop() {
    if (!running) return
    running = false
    cancelFrame(step)
  }
  // a runtime error hands the logos back to the CSS marquee instead of freezing them
  function kill(e) {
    dead = true
    stop()
    root.classList.remove('fx-bus')
    track.style.transform = ''
    console.error('[fx:chrome] bus stopped, CSS marquee restored', e)
  }
  undo.push(() => { dead = true; stop(); root.classList.remove('fx-bus'); track.style.transform = ''; halo.remove() })

  root.classList.add('fx-bus')
  write()

  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      const w = list.getBoundingClientRect().width
      if (w > 1) { W = w; x %= W }
    }).observe(list)
  }

  inView(sec, () => {
    visible = true
    start()
    return () => { visible = false }
  }, { margin: '80px 0px 80px 0px' })

  // pause triggers: a mouse over the band, keyboard focus inside it, the toggle, the global pause
  sec.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hover = true } })
  sec.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { hover = false; start() } })
  sec.addEventListener('focusin', (e) => {
    if (e.target.matches && e.target.matches(':focus-visible')) focus = true
  })
  sec.addEventListener('focusout', (e) => {
    if (!sec.contains(e.relatedTarget)) { focus = false; start() }
  })
  if (toggle) {
    toggle.addEventListener('click', () => {
      held = !held
      focus = false // the explicit choice wins over the focus pause
      toggle.setAttribute('aria-pressed', String(held))
      start()
    })
  }
  onPause((paused) => {
    if (paused) { gate = 0; stop() } else start()
  })

  // the packet taps the bus: draw the beam, bloom the halo, surge the logos
  const calm = (fn) => {
    sec.classList.add('is-calm')
    fn()
    void sec.offsetWidth
    later(() => sec.classList.remove('is-calm'))
  }
  const arm = () => onArrive(sec, (d) => {
    // a stage reached by a jump (silent arrival, or latched before we listened) lights without a show
    const quiet = d.fallback === 'latched' || (!d.fallback && d.silent)
    if (quiet || isPaused()) { calm(() => sec.classList.add('is-live')); return }
    sec.classList.remove('is-surging', 'is-calm')
    void sec.offsetWidth
    sec.classList.add('is-live', 'is-surging')
    if (surgeAnim) surgeAnim.stop()
    surge = 4
    const a = surgeAnim = animate(4, 1, { duration: 1.4, ease: OUT, onUpdate: (v) => { surge = v } })
    a.then(() => {
      if (surgeAnim !== a) return
      surge = 1
      sec.classList.remove('is-surging')
    })
    start()
  }, {
    // the band is thin and often sits at the bottom of the screen long before the packet reaches it:
    // with the thread running, wait for the packet (its failure dispatches flow:off, which still fires
    // this at once); the timer is only a last resort for a thread that never builds
    fallbackDelay: 6000,
  })
  let cancelArm = arm()
  document.addEventListener(EVT.RESET, () => {
    cancelArm()
    if (surgeAnim) surgeAnim.stop()
    surge = 1
    calm(() => sec.classList.remove('is-live', 'is-surging'))
    cancelArm = arm()
  })
}

// ---------- MAGNET skins: the hit area keeps its box, the skin carries the visuals ----------
function skins() {
  for (const el of $$('[data-magnetic][data-flood]')) {
    if (el.querySelector(':scope > .skin')) continue
    const skin = document.createElement('span')
    skin.className = 'skin'
    skin.append(...el.childNodes)
    el.append(skin)
    el.classList.add('has-skin')
  }
}

// ---------- FLOOD: a circle of the next colour, from the pointer ----------
function floods() {
  const all = []
  const strip = (n) => {
    if (n.nodeType !== 1) return
    n.removeAttribute('id')
    for (const a of [...n.attributes]) if (a.name.startsWith('data-')) n.removeAttribute(a.name)
    for (const c of n.children) strip(c)
  }
  for (const el of $$('[data-flood]')) {
    const host = el.querySelector(':scope > .skin') || el
    if (host.querySelector(':scope > .flood')) continue
    const fl = document.createElement('span')
    fl.className = 'flood'
    fl.setAttribute('aria-hidden', 'true')
    for (const n of host.childNodes) {
      const c = n.cloneNode(true)
      strip(c)
      fl.append(c)
    }
    host.append(fl)
    all.push({ el, host, fl })

    // pointer position in the flood's own (unscaled) box
    const at = (e) => {
      const r = fl.getBoundingClientRect()
      if (!r.width || !r.height) return
      const sx = fl.offsetWidth / r.width || 1
      const sy = fl.offsetHeight / r.height || 1
      fl.style.setProperty('--x', `${((e.clientX - r.left) * sx).toFixed(1)}px`)
      fl.style.setProperty('--y', `${((e.clientY - r.top) * sy).toFixed(1)}px`)
    }
    let pressedAt = 0
    let releaseT = 0
    const release = () => {
      if (!el.classList.contains('is-pressed')) return
      clearTimeout(releaseT)
      // a quick tap still shows the flood before it drains
      releaseT = setTimeout(() => el.classList.remove('is-pressed'), Math.max(0, 300 - (performance.now() - pressedAt)))
    }
    el.addEventListener('pointerenter', at)
    el.addEventListener('pointerleave', (e) => { at(e); release() })
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return
      at(e)
      clearTimeout(releaseT)
      pressedAt = performance.now()
      el.classList.add('is-pressed')
    })
    el.addEventListener('pointerup', release)
    el.addEventListener('pointercancel', release)
    el.addEventListener('focus', () => {
      if (el.matches(':focus-visible')) { fl.style.setProperty('--x', '50%'); fl.style.setProperty('--y', '50%') }
    })
  }
  // the copy must sit exactly over the original: same padding (plus the border it covers), gap and
  // alignment, re-read whenever the layout may have moved (breakpoints change the paddings)
  const sync = () => {
    for (const { host, fl } of all) {
      const cs = getComputedStyle(host)
      const b = ['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(cs[`border${s}Width`]) || 0)
      const p = ['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(cs[`padding${s}`]) || 0)
      fl.style.inset = `${-b[0]}px ${-b[1]}px ${-b[2]}px ${-b[3]}px`
      fl.style.padding = `${p[0] + b[0]}px ${p[1] + b[1]}px ${p[2] + b[2]}px ${p[3] + b[3]}px`
      fl.style.columnGap = cs.columnGap
      fl.style.justifyContent = cs.justifyContent
      fl.style.alignItems = cs.alignItems
    }
  }
  sync()
  onRefresh(sync)
}

// ---------- MAGNET: three CTAs lean toward a nearby pointer ----------
function magnet() {
  if (!env.finePointer) return
  const K = 250
  const C = 20
  const RANGE = 80
  const MAX = 8
  const items = $$('[data-magnetic]').map((el) => {
    const skin = el.querySelector(':scope > .skin')
    const write = skin
      ? (x, y) => { skin.style.translate = `${x.toFixed(2)}px ${y.toFixed(2)}px` }
      : (x, y) => { el.style.setProperty('--mx', `${x.toFixed(2)}px`); el.style.setProperty('--my', `${y.toFixed(2)}px`) }
    return { el, write, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 }
  })
  if (!items.length) return
  let px = -1e5
  let py = -1e5
  let running = false
  let aimQueued = false

  function aim() {
    aimQueued = false
    const off = isPaused() || !env.finePointer
    for (const it of items) {
      it.tx = 0
      it.ty = 0
      if (off) continue
      const r = it.el.getBoundingClientRect()
      if (!r.width) continue
      const hw = r.width / 2 + RANGE
      const hh = r.height / 2 + RANGE
      const nx = (px - (r.left + r.width / 2)) / hw
      const ny = (py - (r.top + r.height / 2)) / hh
      const n = Math.hypot(nx, ny)
      if (n >= 1 || n < 1e-4) continue
      const m = MAX * Math.min(n / 0.55, 1) * (1 - smooth(0.78, 1, n))
      it.tx = (nx / n) * m
      it.ty = (ny / n) * m
    }
    // a pointer moving far from all three costs three rect reads and nothing else
    if (items.some((it) => it.x !== it.tx || it.y !== it.ty || it.vx || it.vy)) start()
  }
  const queueAim = () => { if (!aimQueued) { aimQueued = true; frame.read(aim) } }

  function step(fd) {
    let busy = false
    // semi-implicit Euler in <= 4ms substeps: stable for k 250 / c 20 at any frame rate
    let t = Math.min(fd.delta, 64) / 1000
    while (t > 0) {
      const h = Math.min(t, 0.004)
      t -= h
      for (const it of items) {
        it.vx += (-K * (it.x - it.tx) - C * it.vx) * h
        it.vy += (-K * (it.y - it.ty) - C * it.vy) * h
        it.x += it.vx * h
        it.y += it.vy * h
      }
    }
    for (const it of items) {
      const rest = Math.abs(it.x - it.tx) < 0.02 && Math.abs(it.y - it.ty) < 0.02 && Math.abs(it.vx) < 0.05 && Math.abs(it.vy) < 0.05
      if (rest) { it.x = it.tx; it.y = it.ty; it.vx = 0; it.vy = 0 } else busy = true
      it.write(it.x, it.y)
    }
    if (!busy) { running = false; cancelFrame(step) }
  }
  function start() {
    if (running) return
    running = true
    frame.update(step, true)
  }

  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return
    px = e.clientX
    py = e.clientY
    queueAim()
  }, { passive: true })
  document.documentElement.addEventListener('pointerleave', () => { px = py = -1e5; queueAim() })
  addEventListener('blur', () => { px = py = -1e5; queueAim() })
  // the hero CTA scrolls under a still pointer
  addEventListener('scroll', () => { if (px > -1e4) queueAim() }, { passive: true })
  onPause(() => queueAim())
  undo.push(() => {
    px = py = -1e5
    for (const it of items) { it.x = it.y = it.tx = it.ty = it.vx = it.vy = 0; it.write(0, 0) }
  })
}

// ---------- REVEALS: eyebrows rise, titles rise line by line out of a mask ----------
function reveals() {
  const els = $$('[data-reveal]')
  if (!els.length) return
  const isTitle = (el) => /^H[1-6]$/.test(el.tagName)
  // stagger lane: anything triggered within .08s of the previous item waits its turn
  let lane = 0
  const slot = () => {
    const now = performance.now()
    const t = Math.max(now, lane)
    lane = t + 80
    return (t - now) / 1000
  }
  const done = (el) => {
    el.classList.add('is-revealed')
    el.style.opacity = ''
    el.style.transform = ''
  }

  const fontsSettled = () => {
    const f = document.fonts
    if (!f || f.status === 'loaded') return Promise.resolve()
    return Promise.race([f.ready, new Promise((r) => setTimeout(r, 500))])
  }

  // the hidden "from" state goes inline before the class lifts the CSS one: motion starts its WAAPI
  // animation a frame later, and the heading must not flash in between
  function eyebrow(el) {
    const delay = slot()
    el.style.opacity = '0'
    el.style.transform = 'translateY(16px)'
    el.classList.add('is-revealed')
    animate(el, { opacity: [0, 1], transform: ['translateY(16px)', 'translateY(0px)'] }, { duration: 0.7, delay, ease: OUT })
      .then(() => done(el), () => done(el))
  }

  function title(el) {
    const lines = splitLines(el)
    if (!lines) { // nothing measurable: a plain fade
      el.style.opacity = '0'
      el.classList.add('is-revealed')
      animate(el, { opacity: [0, 1] }, { duration: 0.7, delay: slot(), ease: OUT }).then(() => done(el), () => done(el))
      return
    }
    const runs = lines.map((inner) => {
      inner.style.transform = 'translateY(118%)'
      return { inner, delay: slot() }
    })
    el.classList.add('is-revealed')
    Promise.all(runs.map(({ inner, delay }) =>
      animate(inner, { transform: ['translateY(118%)', 'translateY(0%)'] }, { duration: 0.9, delay, ease: OUT })
    )).catch(() => {}).then(() => { lines.restore(); done(el) })
  }

  function reveal(el) {
    try {
      if (isPaused()) { done(el); return }
      if (isTitle(el)) fontsSettled().then(() => title(el)).catch(() => done(el))
      else eyebrow(el)
    } catch (e) {
      done(el) // never leave a heading hidden
      console.error('[fx:chrome] reveal', e)
    }
  }

  // anything already on screen (or above it) at init is simply shown: no flash, no late entrance.
  // The same goes for the screen a #hash link is about to land on (a shared /#contact link must open
  // on finished headings: the browser's jump comes after this runs). A paused page shows every
  // heading as it is, and pausing later shows the ones still waiting.
  const vh = innerHeight
  const sy = window.scrollY
  let land = -Infinity
  if (location.hash.length > 1) {
    let id = location.hash.slice(1)
    try { id = decodeURIComponent(id) } catch (e) { /* keep raw */ }
    const t = document.getElementById(id)
    if (t) land = targetY(t)
  }
  const pending = new Map()
  for (const el of els) {
    const r = el.getBoundingClientRect()
    const shown = (r.width || r.height) && (r.top < vh * 0.92 || r.top + sy < land + vh)
    if (isPaused() || shown) { done(el); continue }
    const stop = inView(el, () => { stop(); pending.delete(el); reveal(el) }, { amount: 0.35 })
    pending.set(el, stop)
  }
  const showAll = () => {
    for (const [el, stop] of pending) { stop(); done(el) }
    pending.clear()
  }
  onPause((paused) => { if (paused) showAll() })
  undo.push(() => {
    showAll()
    for (const el of els) done(el)
  })
}

// Split a heading into its visual lines: each line becomes span.rv-line (the mask) > span.rv-in (the
// part that rises). Words are measured as laid out right now; element children (span.hl) stay whole
// and keep their identity. Returns the inner spans plus restore(), which puts the original nodes back.
function splitLines(el) {
  if (!el.getClientRects().length) return null
  const orig = [...el.childNodes]
  const tokens = [] // {node, br}
  const frag = document.createDocumentFragment()
  for (const n of orig) {
    if (n.nodeType === 3) {
      for (const part of n.data.split(/(\s+)/)) {
        if (!part || /^\s+$/.test(part)) continue
        const w = document.createElement('span')
        w.className = 'rv-w'
        w.textContent = part
        tokens.push({ node: w })
        frag.append(w, ' ')
      }
    } else if (n.nodeName === 'BR') {
      tokens.push({ br: true })
      frag.append(n)
    } else if (n.nodeType === 1) {
      tokens.push({ node: n })
      frag.append(n, ' ')
    }
  }
  el.replaceChildren(frag)
  const restore = () => { el.classList.remove('rv-split'); el.replaceChildren(...orig) }

  const lines = []
  let cur = null
  let mid = -1e9
  for (const t of tokens) {
    if (t.br) { cur = null; continue }
    const r = t.node.getBoundingClientRect()
    const c = r.top + r.height / 2
    if (!cur || Math.abs(c - mid) > r.height * 0.5) {
      cur = []
      lines.push(cur)
      mid = c
    }
    cur.push(t.node)
  }
  if (!lines.length) { restore(); return null }

  const inners = []
  const out = document.createDocumentFragment()
  for (const line of lines) {
    const mask = document.createElement('span')
    mask.className = 'rv-line'
    const inner = document.createElement('span')
    inner.className = 'rv-in'
    line.forEach((node, i) => { if (i) inner.append(' '); inner.append(node) })
    mask.append(inner)
    out.append(mask)
    inners.push(inner)
  }
  el.classList.add('rv-split')
  el.replaceChildren(out)
  inners.restore = restore
  return inners
}

// ---------- HIGHLIGHTER: the lime fill draws with the scroll ----------
function highlighter() {
  const hl = $('.hl')
  const h2 = hl && hl.closest('h2, [data-reveal]')
  if (!hl || !h2) return
  let last = -1
  scroll((p) => {
    const v = Math.round(clamp(p, 0, 1) * 1000) / 1000
    if (v === last) return
    last = v
    hl.style.setProperty('--hl', String(v))
  }, { target: h2, offset: ['start 85%', 'start 45%'] })
}

// ---------- DEPTH: services recede as the projects sheet rises over them ----------
function depth() {
  const inner = $('[data-sheet-inner]')
  const sheet = inner && inner.closest('[data-section]')
  let next = sheet && sheet.nextElementSibling
  while (next && !next.hasAttribute('data-section')) next = next.nextElementSibling
  if (!inner || !next) return
  const anim = animate(inner, { transform: ['scale(1)', 'scale(0.965)'], opacity: [1, 0.55] }, { ease: 'linear' })
  const stop = scroll(anim, { target: next, offset: ['start end', 'start 15%'] })
  undo.push(() => {
    stop()
    anim.cancel()
    inner.style.transform = ''
    inner.style.opacity = ''
  })
}
