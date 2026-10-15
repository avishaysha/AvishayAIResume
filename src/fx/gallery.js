// Package `gallery`: the packet deploys the five projects one by one.
//
// MODES (rebuilt when the query changes; requestRefresh() after every change)
//   PINNED  (min-width 1024, min-height 640, hover + fine pointer, motion ok): [data-gallery].is-pinned +
//           data-flow-external. A sticky full-bleed stage; the track moves sideways with a scroll-linked
//           WAAPI transform (a native ViewTimeline, so it runs on the compositor; a paused animation
//           scrubbed from the scroll listener where ViewTimeline is missing). Wrapper height = D + stage
//           height, D = track width - stage width, so the travel is 1:1 with the scroll.
//           A static deploy line sits 28px above the panels: lime (drawn) from the right edge to the
//           packet at 50%, the dashed route beyond it. The line draws in from the right edge as the stage
//           arrives (the last 40% of a viewport before the pin) with the packet riding its tip; during the
//           pin the packet holds the centre and the panels' ports slide past it. A port crossing the
//           packet = arrive(panel) + deploy. HUD "0X / 05" + five segments.
//           Focus inside a panel and routed anchor jumps (core/scroll registerTarget) land on the y where
//           that panel is centred in the stage.
//   INDEX   (everything else, incl. every touch device): numerals stick under the nav while the card
//           slides over them; their weight scrubs 300 -> 900 between 'start end' and 'start 35%' of the
//           article (quantised to 25); lime once the node has arrived (thread port, or core's fallbacks).
// DEPLOY (both): .is-deployed; a border trace from the port; the numeral compiled to lime; Event-it boot
//   (progress bar, URL retyped LTR at 65ms/char, screenshot crossfades in over its skeleton); FollowUp scan
//   (clip-path reveal with a lime scanline). Each panel deploys once per run. Paused: deploys land instantly.
// Contract
//   sets     html.fx-gallery (sync), [data-gallery].is-pinned|.is-index, data-flow-external while pinned
//   calls    arrive(panel, {silent}) while pinned (flow:arrive bubbles; finale records p-tickets)
//   listens  onArrive(panel) while in index mode, 'run:reset' (undeploy, re-arm once above the gallery)
//   anchors  registerTarget(panel) while pinned
// Reduced motion: init returns early; foundation's static rows apply.

import '../styles/gallery.css'
import { animate } from 'motion'
import { motionOk } from '../core/env.js'
import { isPaused, onPause } from '../core/state.js'
import { EVT, arrive, onArrive } from '../core/flow.js'
import { compile, decompile } from '../core/compile.js'
import { split } from '../core/split.js'
import { onRefresh, requestRefresh } from '../core/refresh.js'
import { registerTarget, scrollToY } from '../core/scroll.js'

const root = document.documentElement
const PIN_Q = '(min-width: 1024px) and (min-height: 640px) and (hover: hover) and (pointer: fine)'
const IO = [0.65, 0, 0.35, 1] // --ease-io
const NATIVE = typeof window.ViewTimeline === 'function'
const LEAD = 0.4 // the deploy line draws in over this share of a viewport before the pin
const TYPE_MS = 65
const MINI_SCALE = 1.25
const MINI_MIN_W = 360 // a story monitor is never laid out narrower than this
const GRID = 28 // the dot-grid tile
const PORT_Y = 40 // thread's default port depth (index mode: the trace starts there)

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const pad2 = (n) => String(n).padStart(2, '0')
const deg = (dx, dy) => (Math.atan2(dx, -dy) * 180) / Math.PI // conic-gradient angle: 0 = up, clockwise

function mk(tag, cls, parent, before = null) {
  const e = document.createElement(tag)
  e.className = cls
  e.setAttribute('aria-hidden', 'true')
  e.setAttribute('data-gallery-fx', '')
  parent.insertBefore(e, before)
  return e
}

/** Resolves when the image is decoded (or failed), at the latest after `ms`. */
function decoded(img, ms) {
  if (!img) return Promise.resolve()
  const dec = () => (img.decode ? img.decode().catch(() => {}) : undefined)
  const ready = img.complete && img.naturalWidth
    ? Promise.resolve(dec())
    : new Promise((r) => {
      img.addEventListener('load', r, { once: true })
      img.addEventListener('error', r, { once: true })
    }).then(dec)
  return Promise.race([ready, new Promise((r) => setTimeout(r, ms))])
}

export function init() {
  if (!motionOk) return
  const gallery = document.querySelector('[data-gallery]')
  const stage = gallery && gallery.querySelector('[data-gallery-stage]')
  const track = stage && stage.querySelector('[data-gallery-track]')
  const els = track ? [...track.children].filter((n) => n.matches('article.project')) : []
  if (!gallery || !stage || !track || !els.length) return
  root.classList.add('fx-gallery')

  const section = gallery.closest('[data-section]') || gallery.parentElement
  const offs = [] // teardown for listeners that live as long as the package
  let mode = null
  let dead = false
  let armed = true // false after a run reset until the visitor is back above the gallery
  let first = true // the first tick after a build: arrivals found there are silent (loaded mid-page)
  let raf = 0

  const safe = (fn) => (...a) => {
    if (dead) return undefined
    try { return fn(...a) } catch (e) { kill(e); return undefined }
  }

  // ---------- created hooks ----------
  const rig = mk('div', 'gallery__rig', stage, track)
  mk('span', 'gallery__route', rig)
  const wire = mk('span', 'gallery__wire', rig)
  const packet = mk('span', 'gallery__packet', rig)
  const hudEl = mk('div', 'gallery__hud', stage)
  const count = mk('span', 'gallery__count', hudEl)
  const countB = document.createElement('b')
  countB.textContent = '01'
  count.append(countB, Object.assign(document.createElement('span'), { textContent: '/' }),
    Object.assign(document.createElement('span'), { textContent: pad2(els.length) }))
  const segsEl = mk('span', 'gallery__segs', hudEl)
  const segs = els.map(() => segsEl.appendChild(document.createElement('i')))
  let hudActive = -1

  const panels = els.map((el, i) => {
    const num = el.querySelector('.project__num')
    if (num) split(num)
    const card = el.querySelector('.project__card')
    const media = el.querySelector('.project__media')
    const P = {
      el, i, num, card, media,
      mini: media && media.querySelector('.mini'),
      browser: el.querySelector('[data-browser]'),
      shot: el.querySelector('[data-shot]'),
      deployed: false, hit: false, busy: false, token: 0, timers: [], anims: [],
      cancelArrive: null, unreg: null, w: -1,
    }
    P.port = mk('span', 'gallery__port', el, el.firstChild)
    P.port.appendChild(document.createElement('i'))
    P.traceA = mk('span', 'project__trace', el)
    P.traceB = card ? mk('span', 'project__trace', card) : null
    if (P.browser) {
      P.url = P.browser.querySelector('[data-url]')
      P.urlText = P.url ? P.url.textContent : ''
      const bar = P.browser.querySelector('.browser__bar')
      P.progress = bar ? mk('span', 'browser__progress', bar) : null
      P.view = P.browser.querySelector('.browser__view')
      P.img = P.view && P.view.querySelector('img')
    }
    if (P.shot) {
      P.scan = mk('span', 'shot__scan', P.shot)
      P.shotImg = P.shot.querySelector('img')
    }
    return P
  })

  // ---------- scroll-linked scrubs (native ViewTimeline, or a paused animation scrubbed from JS) ----------
  // a, b: scroll offsets relative to the gallery's top, in px (negative = before the pin)
  const toRange = (rel, vh) => (rel < 0 ? `entry ${Math.max(0, vh + rel).toFixed(1)}px` : `exit-crossing ${rel.toFixed(1)}px`)
  function scrub(el, frames, subject) {
    const anim = NATIVE
      ? el.animate(frames, { fill: 'both', easing: 'linear', timeline: new ViewTimeline({ subject, axis: 'block' }) })
      : el.animate(frames, { fill: 'both', easing: 'linear', duration: 1000 })
    if (!NATIVE) anim.pause()
    const s = {
      el, anim, a: 0, b: 1,
      frames(f) { anim.effect.setKeyframes(f) },
      range(start, end) { if (NATIVE) { anim.rangeStart = start; anim.rangeEnd = end } },
      at(t) { if (!NATIVE) anim.currentTime = clamp(t, 0, 1) * 1000 },
      stop() { anim.cancel() },
    }
    return s
  }

  // ---------- PINNED ----------
  const G = { gw: 0, h: 0, D: 0, top: 0, vh: 0, stageW: 0, half: 0, L: 0 }
  let pin = null // {travel, wire, packet, parallax, parallaxP}

  function measurePinned() {
    const gw = root.clientWidth
    if (gw !== G.gw) { G.gw = gw; gallery.style.setProperty('--gw', `${gw}px`) }
    const stageW = stage.clientWidth
    const D = Math.max(0, track.offsetWidth - stageW)
    const h = Math.round(D + stage.offsetHeight)
    if (h !== G.h) { G.h = h; gallery.style.height = `${h}px` }
    const sy = window.scrollY
    const gR = gallery.getBoundingClientRect()
    const top = gR.top + sy
    const vh = window.innerHeight
    const half = stageW / 2
    const L = LEAD * vh
    Object.assign(G, { D, top, vh, stageW, half, L })

    // the dot grid inside the stage continues the section's grid
    const secTop = section.getBoundingClientRect().top + sy
    gallery.style.setProperty('--grid-y', `${-((((top - secTop) % GRID) + GRID) % GRID)}px`)

    const trackLeft = track.offsetLeft // the track's left edge in stage coords at travel 0 (negative in RTL)
    const stageTop = stage.getBoundingClientRect().top
    for (const P of panels) {
      const left = trackLeft + P.el.offsetLeft
      const w = P.el.offsetWidth
      const portX = left + P.port.offsetLeft + P.port.offsetWidth / 2
      // the packet runs in from the right edge over [-L, 0], then holds the centre while the track moves 1:1
      P.arriveAt = portX > half ? -L * (1 - (stageW - portX) / half) : half - portX
      P.center0 = left + w / 2
      P.focusRel = clamp(half - P.center0, 0, D)
      P.left0 = left
      P.w0 = w
      // story monitors: scaled up to fill the panel (never past 1.25, never laid out narrower than 360px)
      if (P.mini && P.media) {
        const ps = getComputedStyle(P.el)
        const ms = getComputedStyle(P.media)
        const availH = P.el.clientHeight - parseFloat(ps.paddingTop) - parseFloat(ps.paddingBottom)
          - parseFloat(ms.paddingTop) - parseFloat(ms.paddingBottom) - 2
        const innerW = P.media.clientWidth - parseFloat(ms.paddingLeft) - parseFloat(ms.paddingRight)
        const mh = P.mini.offsetHeight
        const s = clamp(Math.min(availH / mh, innerW / MINI_MIN_W, MINI_SCALE), 1, MINI_SCALE)
        P.media.style.setProperty('--ms', s.toFixed(3))
        P.media.style.setProperty('--mx', `${(mh * (s - 1)).toFixed(1)}px`)
      }
      // Event-it parallax window: from the frame entering the viewport until panel 01 leaves the stage
      if (P.view) {
        const vR = P.view.getBoundingClientRect()
        const elR = P.el.getBoundingClientRect()
        P.viewTop0 = vR.top - stageTop // relative to the unpinned stage top = the gallery top
        P.viewLeft0 = left + (vR.left - elR.left)
      }
    }
    if (pin) rangePinned()
  }

  function rangePinned() {
    const { D, vh, half, L } = G
    pin.travel.frames([{ transform: 'translate3d(0px, 0, 0)' }, { transform: `translate3d(${D}px, 0, 0)` }])
    pin.travel.range('exit-crossing 0px', `exit-crossing ${D}px`)
    pin.travel.a = 0; pin.travel.b = D
    pin.wire.range(toRange(-L, vh), 'exit-crossing 0px')
    pin.wire.a = -L; pin.wire.b = 0
    pin.packet.frames([{ transform: `translateX(${(half + 16).toFixed(1)}px)` }, { transform: 'translateX(0px)' }])
    pin.packet.range(toRange(-L, vh), 'exit-crossing 0px')
    pin.packet.a = -L; pin.packet.b = 0
    if (pin.parallax) {
      const P = pin.parallaxP
      const a = clamp(P.viewTop0 - vh, -vh, 0)
      const b = clamp(G.stageW - P.viewLeft0, 1, Math.max(1, D))
      pin.parallax.range(toRange(a, vh), toRange(b, vh))
      pin.parallax.a = a; pin.parallax.b = b
    }
  }

  function buildPinned() {
    gallery.classList.remove('is-index')
    gallery.classList.add('is-pinned')
    gallery.setAttribute('data-flow-external', '')
    for (const P of panels) {
      if (P.cancelArrive) { P.cancelArrive(); P.cancelArrive = null }
      if (P.deployed) P.hit = true
    }
    pin = {
      travel: scrub(track, [{ transform: 'translate3d(0px, 0, 0)' }, { transform: 'translate3d(0px, 0, 0)' }], gallery),
      wire: scrub(wire, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], gallery),
      packet: scrub(packet, [{ transform: 'translateX(0px)' }, { transform: 'translateX(0px)' }], gallery),
      parallax: null,
      parallaxP: null,
    }
    const ev = panels.find((P) => P.img && P.view)
    if (ev) {
      pin.parallaxP = ev
      pin.parallax = scrub(ev.img, [{ transform: 'translateY(0%)' }, { transform: 'translateY(-10.7%)' }], gallery)
    }
    measurePinned()
    for (const P of panels) {
      P.unreg = registerTarget(P.el, safe(() => { measurePinned(); return G.top + P.focusRel }))
    }
    // the two screenshots must be ready by the time their ports cross the packet
    const eager = () => {
      for (const P of panels) for (const img of [P.img, P.shotImg]) if (img) img.loading = 'eager'
    }
    if (document.readyState === 'complete') eager()
    else window.addEventListener('load', safe(eager), { once: true })
  }

  function teardownPinned() {
    if (!pin) return
    for (const k of ['travel', 'wire', 'packet', 'parallax']) if (pin[k]) pin[k].stop()
    pin = null
    gallery.classList.remove('is-pinned')
    gallery.removeAttribute('data-flow-external')
    gallery.style.removeProperty('height')
    gallery.style.removeProperty('--gw')
    gallery.style.removeProperty('--grid-y')
    track.style.removeProperty('transform')
    G.gw = 0; G.h = 0
    for (const P of panels) {
      if (P.unreg) { P.unreg(); P.unreg = null }
      if (P.media) { P.media.style.removeProperty('--ms'); P.media.style.removeProperty('--mx') }
      if (P.img) P.img.style.removeProperty('transform')
    }
  }

  function tickPinned() {
    const rel = window.scrollY - G.top
    if (!NATIVE) {
      for (const k of ['travel', 'wire', 'packet', 'parallax']) {
        const s = pin[k]
        if (s) s.at((rel - s.a) / (s.b - s.a || 1))
      }
    }
    if (!armed && rel < -G.vh) armed = true
    if (armed) {
      for (const P of panels) {
        if (P.hit) continue
        if (rel < P.arriveAt) break
        P.hit = true
        arrive(P.el, { silent: first })
        deploy(P)
      }
    }
    // HUD: the panel nearest the centre
    const x = clamp(rel, 0, G.D)
    let best = 0
    let bd = Infinity
    for (const P of panels) {
      const d = Math.abs(P.center0 + x - G.half)
      if (d < bd) { bd = d; best = P.i }
    }
    setActive(best)
  }

  function setActive(i) {
    if (i === hudActive) return
    if (hudActive >= 0) segs[hudActive].classList.remove('is-active')
    hudActive = i
    segs[i].classList.add('is-active')
    countB.textContent = pad2(i + 1)
    countB.classList.remove('is-flip')
    if (isPaused()) return // a paused CSS animation would hold the digits at their dim first frame
    void countB.offsetWidth
    countB.classList.add('is-flip')
  }

  // focus inside an offscreen panel brings it into the stage (after the browser's own focus scroll)
  const onFocus = safe((e) => {
    if (mode !== 'pinned') return
    const P = panels.find((p) => p.el.contains(e.target))
    if (!P) return
    const rel = window.scrollY - G.top
    const left = P.left0 + clamp(rel, 0, G.D)
    if (rel >= 0 && rel <= G.D && left >= 0 && left + P.w0 <= G.stageW) return
    const y = G.top + P.focusRel
    requestAnimationFrame(() => scrollToY(y))
  })
  track.addEventListener('focusin', onFocus)
  offs.push(() => track.removeEventListener('focusin', onFocus))

  // ---------- INDEX ----------
  let idx = null // {parallax}

  function measureIndex() {
    const sy = window.scrollY
    for (const P of panels) P.top = P.el.getBoundingClientRect().top + sy
    if (idx && idx.parallax && !NATIVE) {
      const r = idx.parallaxP.view.getBoundingClientRect()
      idx.vTop = r.top + sy
      idx.vH = r.height
    }
  }

  function armIndex(P) {
    if (P.deployed || P.cancelArrive) return
    const cancel = onArrive(P.el, safe(() => { P.cancelArrive = null; deploy(P) }))
    if (!P.deployed) P.cancelArrive = cancel
  }

  function buildIndex() {
    gallery.classList.remove('is-pinned')
    gallery.classList.add('is-index')
    gallery.removeAttribute('data-flow-external')
    idx = { parallax: null, parallaxP: null, vTop: 0, vH: 1 }
    const ev = panels.find((P) => P.img && P.view)
    if (ev) {
      idx.parallaxP = ev
      idx.parallax = scrub(ev.img, [{ transform: 'translateY(0%)' }, { transform: 'translateY(-10.7%)' }], ev.view)
      idx.parallax.range('cover 0%', 'cover 100%')
    }
    measureIndex()
    if (armed) for (const P of panels) armIndex(P)
  }

  function teardownIndex() {
    if (!idx) return
    if (idx.parallax) idx.parallax.stop()
    idx = null
    gallery.classList.remove('is-index')
    for (const P of panels) {
      if (P.cancelArrive) { P.cancelArrive(); P.cancelArrive = null }
      if (P.num) P.num.style.removeProperty('--w')
      P.w = -1
      if (P.img) P.img.style.removeProperty('transform')
    }
  }

  function tickIndex() {
    const sy = window.scrollY
    const vh = window.innerHeight
    for (const P of panels) {
      // 'start end' -> 'start 35%' of the article, quantised to 25
      const t = clamp((sy + vh - P.top) / (0.65 * vh), 0, 1)
      const w = 300 + Math.round((600 * t) / 25) * 25
      if (w !== P.w && P.num) { P.w = w; P.num.style.setProperty('--w', w) }
    }
    if (idx.parallax && !NATIVE) idx.parallax.at((sy + vh - idx.vTop) / (vh + idx.vH))
    if (!armed && panels[0].el.getBoundingClientRect().top > vh) {
      armed = true
      for (const P of panels) armIndex(P)
    }
  }

  // ---------- DEPLOY ----------
  const later = (P, fn, ms) => { P.timers.push(setTimeout(safe(fn), ms)) }

  function calm(P, fn) {
    // apply final states with every transition off for one style flush
    P.el.classList.add('gal-calm')
    fn()
    void P.el.offsetWidth
    P.el.classList.remove('gal-calm')
  }

  function deploy(P) {
    if (P.deployed || dead) return
    P.deployed = true
    const tok = ++P.token
    P.el.classList.add('is-deployed')
    segs[P.i].classList.add('is-on')
    if (isPaused()) {
      calm(P, () => {
        if (P.num) compile(P.num, { instant: true })
        finishBrowser(P)
        finishShot(P)
      })
      return
    }
    P.busy = true
    later(P, () => { if (tok === P.token) P.busy = false }, 1500)
    if (mode === 'pinned') {
      P.el.classList.add('is-pulsing')
      later(P, () => P.el.classList.remove('is-pulsing'), 700)
    }
    trace(P, tok)
    if (P.num) later(P, () => { if (tok === P.token) compile(P.num) }, mode === 'pinned' ? 120 : 0)
    if (P.browser) bootBrowser(P, tok)
    if (P.shot) scanShot(P, tok)
  }

  function trace(P, tok) {
    const host = mode === 'pinned' ? P.el : P.card
    const span = mode === 'pinned' ? P.traceA : P.traceB
    if (!host || !span) return
    const w = host.offsetWidth
    const h = host.offsetHeight
    let a0
    if (mode === 'pinned') {
      const px = P.port.offsetLeft + P.port.offsetWidth / 2
      a0 = deg(px - w / 2, -h / 2) // the top edge under the port
    } else {
      // the thread's port: the media's left edge, PORT_Y (or data-port-y) below its top
      const mTop = P.media && P.media.offsetParent === host ? P.media.offsetTop : 0
      const mH = P.media ? P.media.offsetHeight : h
      const py = mTop + Math.min(parseFloat(P.el.dataset.portY) || PORT_Y, mH / 2)
      a0 = deg(-w / 2, py - h / 2)
    }
    span.style.setProperty('--a0', `${a0.toFixed(1)}deg`)
    P.el.classList.remove('is-tracing')
    void P.el.offsetWidth
    P.el.classList.add('is-tracing')
    later(P, () => { if (tok === P.token) P.el.classList.remove('is-tracing') }, 1050)
  }

  function bootBrowser(P, tok) {
    const ok = () => tok === P.token && P.deployed
    const { url, progress, img, browser } = P
    if (img) img.loading = 'eager'
    const t0 = performance.now()
    // the URL: cleared (the pill keeps its width) and retyped LTR
    if (url && P.urlText) {
      url.style.minWidth = `${url.offsetWidth}px`
      url.textContent = ''
      url.classList.add('is-typing')
      let k = 0
      const next = () => {
        if (!ok()) return
        k++
        url.textContent = P.urlText.slice(0, k)
        if (k < P.urlText.length) later(P, next, TYPE_MS)
        else later(P, () => { if (ok()) { url.classList.remove('is-typing'); url.style.minWidth = '' } }, 420)
      }
      later(P, next, 110)
    }
    if (progress) {
      const a = animate(progress, { transform: ['scaleX(0)', 'scaleX(1)'], opacity: [1, 1] }, { duration: 0.8, delay: 0.25, ease: IO })
      P.anims.push(a)
      a.then(safe(() => { if (ok()) P.anims.push(animate(progress, { opacity: 0 }, { duration: 0.35 })) }), () => {})
    }
    decoded(img, 1600).then(safe(() => {
      if (!ok()) return
      later(P, () => { if (ok()) browser.classList.add('is-loaded') }, Math.max(0, 620 - (performance.now() - t0)))
    }))
  }

  function finishBrowser(P) {
    if (!P.browser) return
    if (P.url) { P.url.textContent = P.urlText; P.url.classList.remove('is-typing'); P.url.style.minWidth = '' }
    if (P.progress) { P.progress.style.opacity = '0'; P.progress.style.transform = '' }
    P.browser.classList.add('is-loaded')
  }

  function scanShot(P, tok) {
    const ok = () => tok === P.token && P.deployed
    const { shot, shotImg: img, scan } = P
    if (img) img.loading = 'eager'
    decoded(img, 1800).then(safe(() => {
      if (!ok()) return
      const h = shot.clientHeight
      const r = getComputedStyle(shot).borderTopLeftRadius || '18px'
      const a = img
        ? animate(img, { clipPath: [`inset(0% 0% 100% 0% round ${r})`, `inset(0% 0% 0% 0% round ${r})`] }, { duration: 1.1, ease: IO })
        : null
      const s = animate(scan, { transform: ['translateY(0px)', `translateY(${h}px)`], opacity: [1, 1] }, { duration: 1.1, ease: IO })
      P.anims.push(s)
      if (a) P.anims.push(a)
      Promise.all([s, a]).then(safe(() => {
        if (!ok()) return
        shot.classList.add('is-scanned')
        if (img) img.style.removeProperty('clip-path') // Motion commits the last keyframe inline on finish
        P.anims.push(animate(scan, { opacity: 0 }, { duration: 0.3 }))
      }), () => {})
    }))
  }

  function finishShot(P) {
    if (!P.shot) return
    P.shot.classList.add('is-scanned')
    if (P.shotImg) P.shotImg.style.removeProperty('clip-path')
    if (P.scan) { P.scan.style.opacity = '0'; P.scan.style.transform = '' }
  }

  function stopPanel(P) {
    P.token++
    for (const t of P.timers) clearTimeout(t)
    P.timers = []
    for (const a of P.anims) { try { a.cancel() } catch (e) { /* already gone */ } }
    P.anims = []
    P.busy = false
  }

  /** Land an in-flight deploy at once (pause). */
  function settle(P) {
    if (!P.deployed || !P.busy) return
    stopPanel(P)
    calm(P, () => {
      P.el.classList.remove('is-tracing', 'is-pulsing')
      if (P.num) compile(P.num, { instant: true })
      finishBrowser(P)
      finishShot(P)
    })
  }

  function undeploy(P) {
    stopPanel(P)
    P.deployed = false
    P.hit = false
    calm(P, () => {
      P.el.classList.remove('is-deployed', 'is-tracing', 'is-pulsing')
      if (P.num) decompile(P.num, { instant: true })
      if (P.browser) {
        P.browser.classList.remove('is-loaded')
        if (P.url) { P.url.textContent = P.urlText; P.url.classList.remove('is-typing'); P.url.style.minWidth = '' }
        if (P.progress) { P.progress.style.removeProperty('opacity'); P.progress.style.removeProperty('transform') }
      }
      if (P.shot) {
        P.shot.classList.remove('is-scanned')
        if (P.shotImg) P.shotImg.style.removeProperty('clip-path')
        if (P.scan) { P.scan.style.removeProperty('opacity'); P.scan.style.removeProperty('transform') }
      }
    })
    segs[P.i].classList.remove('is-on')
  }

  // ---------- wiring ----------
  const tick = safe(() => {
    raf = 0
    if (mode === 'pinned' && pin) tickPinned()
    else if (mode === 'index' && idx) tickIndex()
    first = false
  })
  const onScroll = () => { if (!raf && !dead) raf = requestAnimationFrame(tick) }
  window.addEventListener('scroll', onScroll, { passive: true })
  offs.push(() => window.removeEventListener('scroll', onScroll))

  const mq = window.matchMedia(PIN_Q)
  const setMode = safe(() => {
    const next = mq.matches ? 'pinned' : 'index'
    if (next === mode) return
    if (mode === 'pinned') teardownPinned()
    else if (mode === 'index') teardownIndex()
    mode = next
    if (mode === 'pinned') buildPinned()
    else buildIndex()
    first = true
    tick()
    requestRefresh('gallery:mode')
  })
  mq.addEventListener('change', setMode)
  offs.push(() => mq.removeEventListener('change', setMode))

  offs.push(onRefresh(safe(() => {
    if (mode === 'pinned' && pin) measurePinned()
    else if (mode === 'index' && idx) measureIndex()
    onScroll()
  })))
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => requestRefresh('gallery:track'))
    ro.observe(track)
    offs.push(() => ro.disconnect())
  }
  // core refresh ignores height-only resizes (mobile toolbars); the pinned stage is 100svh tall, so a
  // desktop window resized in height must re-measure the wrapper (D + stage height)
  let rzRaf = 0
  const onResize = () => {
    if (mode !== 'pinned' || rzRaf || dead) return
    rzRaf = requestAnimationFrame(safe(() => { rzRaf = 0; if (pin) { measurePinned(); onScroll() } }))
  }
  window.addEventListener('resize', onResize, { passive: true })
  offs.push(() => { window.removeEventListener('resize', onResize); if (rzRaf) cancelAnimationFrame(rzRaf) })

  offs.push(onPause(safe((paused) => {
    if (!paused) return
    countB.classList.remove('is-flip')
    for (const P of panels) settle(P)
  })))

  const onReset = safe(() => {
    for (const P of panels) {
      if (P.cancelArrive) { P.cancelArrive(); P.cancelArrive = null }
      undeploy(P)
    }
    armed = false
    onScroll()
  })
  document.addEventListener(EVT.RESET, onReset)
  offs.push(() => document.removeEventListener(EVT.RESET, onReset))

  // ---------- failure: leave the static page ----------
  function kill(e) {
    if (dead) return
    dead = true
    console.error('[fx:gallery] failed, falling back to the static page', e)
    try {
      if (raf) cancelAnimationFrame(raf)
      for (const off of offs) { try { off() } catch (er) { /* keep going */ } }
      try { teardownPinned() } catch (er) { /* keep going */ }
      try { teardownIndex() } catch (er) { /* keep going */ }
      for (const P of panels) {
        stopPanel(P)
        P.el.classList.remove('is-deployed', 'is-tracing', 'is-pulsing')
        if (P.num) { P.num.classList.remove('is-idea'); P.num.style.removeProperty('--w') }
        if (P.url) { P.url.textContent = P.urlText; P.url.style.minWidth = '' }
        if (P.shotImg) P.shotImg.style.removeProperty('clip-path')
      }
      gallery.querySelectorAll('[data-gallery-fx]').forEach((n) => n.remove())
      gallery.classList.remove('is-pinned', 'is-index')
    } finally {
      root.classList.remove('fx-gallery')
      requestRefresh('gallery:off')
    }
  }

  setMode()
}
