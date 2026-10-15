// Package `thread`: the run's circuit and its packet (the lime dot that carries the work).
//
// MODEL (deliberately simple so it cannot misalign)
// - One vertical RAIL in the left (inline-end) gutter at railX = max(12, contentLeft - 28), drawn per
//   section (div.thread-rail inside each [data-section], so the wire takes the section's colours: lime on
//   ink, ink on bone and lime). Only the rail is scroll-scrubbed.
// - Short horizontal STUBS from the rail into node edges, one ROUTER on the rail in the services lane
//   (>=1024: three L-branches fan out to the cards' top ports; below: a small x3 mark + left stubs), and the
//   intro EDGE from the h1 period into the portrait. All of these run on time when the packet passes.
// - PORTS (12px rings) sit exactly on the node edges: pending (dashed socket) -> done (lime eyelet).
// - The PACKET rides the rail at Hd, a smoothed follower of H = scrollY + 62% (70% <= 768px) of the
//   viewport. Passing a port runs its stub, then arrive(node). Cards (z-card) and pinned stages (z-stage)
//   sit above the packet (z-packet), so it visibly processes inside them.
//
// Geometry is measured on every core onRefresh (fonts, images, width resize, layout) and on ignite:done,
// never inside a frame: each frame only writes transforms (packet, tail, the rail segment that changed).
// Everything is aria-hidden and pointer-events: none. Every element is display:none unless html.fx-thread
// is on, and any runtime error removes the whole circuit (die), so a failure leaves no residue.
//
// Contract with the other packages
//   listens  'ignite:done' (ignition), 'run:reset' (finale rerun), [data-flow-external] on the gallery and
//            keyhole wrappers while they pin (their nodes are skipped: they call arrive() themselves)
//   calls    arrive(node, {x, y, silent}) for portrait, tools, router, svc-*, p-* (index mode), talks
//            (when not pinned) and contact; x/y are document (page) coordinates of the port or dock dot
//   sets     html.fx-thread (sync), html[data-flow=on] after the first build (motion only), --rail-x on <html>
//   reads    optional data-port-y="<px>" on a node (port depth below its edge's top: default 40, services 95)
//   styles   [data-sheet-inner] gets position:relative (thread.css, gated on fx-thread): the services ports
//            live inside it, so a depth transform on the sheet carries them with their cards
// Reduced motion: one still circuit, fully drawn at 70% opacity. No packet, no loop, no events, no data-flow.

import '../styles/thread.css'
import { animate, cubicBezier } from 'motion'
import * as env from '../core/env.js'
import { isPaused, onPause } from '../core/state.js'
import { EVT, arrive } from '../core/flow.js'
import { onRefresh, requestRefresh } from '../core/refresh.js'

const root = document.documentElement
const SVGNS = 'http://www.w3.org/2000/svg'
const ioEase = cubicBezier(0.65, 0, 0.35, 1)
const OUT = [0.22, 1, 0.36, 1]
const POP = [0.34, 1.56, 0.64, 1]
const mqWide = window.matchMedia('(min-width: 1024px)')
const DEV = !!import.meta.env.DEV // perf marks for the dev server only (stripped from the build)

const GAP = 28 // rail -> content
const MIN_X = 12 // the rail never sits closer than this to the viewport edge
const PORT_Y = 40 // default port depth below a node's top edge
const SVC_PORT_Y = 95 // services' left ports (< 1024px)
const SINK = 12 // packet and sparks run this far under a card edge, so they disappear inside it
const EDGE_R = 28 // portrait corner zone the intro edge never enters (matches the intake's port)

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const r2 = (n) => Math.round(n * 100) / 100
const px = (n) => `${r2(n)}px`

function mk(tag, cls, parent) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  e.setAttribute('data-thread', '')
  e.setAttribute('aria-hidden', 'true')
  if (parent) parent.append(e)
  return e
}
function mkSvg(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag)
  for (const k in attrs) e.setAttribute(k, attrs[k])
  if (parent) parent.append(e)
  return e
}

// An axis-aligned polyline with rounded 90-degree corners: the SVG d, its length and a point-at-length.
function pathModel(pts, radius = 12) {
  const segs = []
  let d = `M${r2(pts[0][0])} ${r2(pts[0][1])}`
  let cur = pts[0]
  const line = (a, b) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 0.01) return
    segs.push({ t: 'L', a, b, len })
    d += ` L${r2(b[0])} ${r2(b[1])}`
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1]
    if (!c) { line(cur, b); break }
    const ux = Math.sign(b[0] - a[0]), uy = Math.sign(b[1] - a[1])
    const vx = Math.sign(c[0] - b[0]), vy = Math.sign(c[1] - b[1])
    const cross = ux * vy - uy * vx
    if (!cross) { continue } // straight through: the next segment carries on from cur
    const rr = Math.min(radius, Math.hypot(b[0] - cur[0], b[1] - cur[1]), Math.hypot(c[0] - b[0], c[1] - b[1]) / 2)
    const p0 = [b[0] - ux * rr, b[1] - uy * rr], p1 = [b[0] + vx * rr, b[1] + vy * rr]
    line(cur, p0)
    segs.push({ t: 'A', c: [p0[0] + vx * rr, p0[1] + vy * rr], u: [ux, uy], v: [vx, vy], r: rr, len: (Math.PI * rr) / 2 })
    d += ` A${r2(rr)} ${r2(rr)} 0 0 ${cross > 0 ? 1 : 0} ${r2(p1[0])} ${r2(p1[1])}`
    cur = p1
  }
  const len = segs.reduce((s, g) => s + g.len, 0)
  const end = segs.length ? segs[segs.length - 1] : null
  function at(s) {
    if (!segs.length) return pts[0]
    let rest = clamp(s, 0, len)
    for (const g of segs) {
      if (rest <= g.len || g === end) {
        const f = g.len ? clamp(rest / g.len, 0, 1) : 1
        if (g.t === 'L') return [g.a[0] + (g.b[0] - g.a[0]) * f, g.a[1] + (g.b[1] - g.a[1]) * f]
        const th = f * Math.PI / 2, co = Math.cos(th), si = Math.sin(th)
        return [g.c[0] + (-g.v[0] * co + g.u[0] * si) * g.r, g.c[1] + (-g.v[1] * co + g.u[1] * si) * g.r]
      }
      rest -= g.len
    }
    return pts[pts.length - 1]
  }
  return { d, len, at }
}

// writes that skip unchanged values (a refresh usually moves nothing, so it should cost nothing)
const wcache = new WeakMap()
function css(el, prop, val) {
  let c = wcache.get(el)
  if (!c) { c = {}; wcache.set(el, c) }
  if (c[prop] === val) return
  c[prop] = val
  el.style[prop] = val
}
function attr(el, name, val) {
  const v = String(val)
  if (el.getAttribute(name) !== v) el.setAttribute(name, v)
}

let instance = null

export function init() {
  const main = document.getElementById('main')
  const layer = main && main.querySelector('[data-thread-layer]')
  if (!layer || instance) return
  root.classList.add('fx-thread')
  instance = createThread(main, layer)
  // the hooks are missing: no run (flow reads 'off' and every listener falls back to inView)
  if (!instance) root.classList.remove('fx-thread')
}

function createThread(main, layer) {
  const live = env.motionOk
  const firstVisit = root.classList.contains('ignite')
  const st = {
    phase: live ? 'wait' : 'static', // wait -> intro -> run (motion) | static (reduced motion)
    g: null, // the last measured geometry
    Hd: 0, v: 0, sprint: false, raf: 0, last: 0,
    sy: window.scrollY, vh: window.innerHeight,
    passed: new Set(), // keys whose port is done: in, out, tools, router, svc-*, p-*, talks, contact
    replay: false, dead: false, built: false, forceEnd: null,
    lastInput: -1e9, ts: -1, up: false, tt: '', parked: false, docked: false, shown: false,
    timers: new Set(),
  }
  const tweens = new Set()
  const busy = new Set() // keys a running tween is drawing (paint() leaves them alone)
  const sparks = new Set()
  const E = { rails: new Map(), ports: new Map(), stubs: new Map(), fan: new Map() }
  const offs = []

  // ---------- safety: any error switches the run off and removes every trace ----------
  function die(e) {
    if (st.dead) return
    st.dead = true
    console.error('[fx:thread] failed, falling back to the static page', e)
    cancelAnimationFrame(st.raf)
    tweens.clear()
    st.timers.forEach(clearTimeout)
    for (const f of offs) { try { f() } catch (_) { /* already gone */ } }
    root.classList.remove('fx-thread', 'thread-built', 'thread-void')
    delete root.dataset.flow
    document.querySelectorAll('[data-thread]').forEach((n) => n.remove())
    document.dispatchEvent(new CustomEvent(EVT.OFF))
  }
  const safe = (fn) => (...a) => {
    if (st.dead) return undefined
    try { return fn(...a) } catch (e) { die(e); return undefined }
  }
  const later = (fn, ms) => {
    const t = setTimeout(() => { st.timers.delete(t); safe(fn)() }, ms)
    st.timers.add(t)
    return t
  }
  const listen = (target, type, fn, opts) => {
    const h = safe(fn)
    target.addEventListener(type, h, opts)
    offs.push(() => target.removeEventListener(type, h, opts))
  }

  // ---------- DOM: created once, positioned on every refresh ----------
  const q = (s) => main.querySelector(s)
  E.hero = q('[data-hero]') || q('[data-section]')
  E.portrait = q('[data-node="portrait"]')
  E.period = q('[data-period]')
  E.tools = q('[data-node="tools"]')
  E.track = E.tools && E.tools.querySelector('.marquee__track')
  E.routerNode = q('[data-router]')
  E.lane = E.routerNode && E.routerNode.closest('[data-lane]')
  E.svcSec = E.routerNode && E.routerNode.closest('[data-section]')
  E.inner = (E.routerNode && E.routerNode.closest('[data-sheet-inner]')) || E.svcSec
  E.svcs = [...main.querySelectorAll('[data-node^="svc-"]')]
  E.projects = [...main.querySelectorAll('[data-node^="p-"]')]
  E.talks = q('[data-node="talks"]')
  E.contact = q('[data-node="contact"]')
  E.dock = E.contact && E.contact.querySelector('[data-dock]')
  E.card = E.contact && (E.contact.querySelector('[data-contact]') || E.contact)
  if (!E.hero || !E.portrait || !E.contact) return null

  // the intro edge (period -> portrait input port) and the output stub (portrait -> rail), in the hero
  E.intro = mkSvg('svg', { class: 'thread-intro', 'aria-hidden': 'true', focusable: 'false', 'data-thread': '' }, E.hero)
  E.introRoute = mkSvg('path', { class: 'thread-path thread-path--route' }, E.intro)
  E.introDrawn = mkSvg('path', { class: 'thread-path thread-path--drawn' }, E.intro)
  // the services overlay: lives inside [data-sheet-inner], so the cards' depth transform carries it
  if (E.inner) {
    // (no opacity on the overlay itself: that would make it a stacking context and sink its ports under
    // the cards; each child fades on its own and keeps its own z-index)
    E.overlay = mk('div', 'thread-local', E.inner)
    E.fanSvg = mkSvg('svg', { class: 'thread-fan thread-fade', 'aria-hidden': 'true', focusable: 'false' }, E.overlay)
    for (const s of E.svcs) {
      const k = s.dataset.node
      E.fan.set(k, {
        route: mkSvg('path', { class: 'thread-path thread-path--route' }, E.fanSvg),
        drawn: mkSvg('path', { class: 'thread-path thread-path--drawn' }, E.fanSvg),
      })
    }
  }
  if (E.svcSec) {
    E.router = mk('div', 'thread-router thread-fade', E.svcSec)
    E.router.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 12h5"/><path d="M8 12c4.5 0 4.5-6 9-6"/><path d="M8 12h9"/><path d="M8 12c4.5 0 4.5 6 9 6"/><circle cx="19" cy="6" r="1.7"/><circle cx="19" cy="12" r="1.7"/><circle cx="19" cy="18" r="1.7"/></svg>'
    E.mark = mk('div', 'thread-router thread-router--mark thread-fade', E.svcSec)
    E.mark.dir = 'ltr'
    E.mark.textContent = '×3'
  }
  if (live) {
    E.packet = mk('div', 'thread-packet', layer)
    E.pbody = mk('i', 'thread-packet__body', E.packet)
    E.tail = mk('i', 'thread-packet__tail', E.pbody)
    E.dot = mk('i', 'thread-packet__dot', E.pbody)
  }

  function railFor(sec) {
    let R = E.rails.get(sec)
    if (!R) {
      const el = mk('div', 'thread-rail thread-fade', sec)
      mk('i', 'thread-rail__route', el)
      // drawn: the translated window; inside it the static wire (painted once, with its glow) and the
      // traffic pulse on its own composited layer, so neither repaints the other
      const drawn = mk('i', 'thread-rail__drawn', el)
      mk('i', 'thread-rail__wire', drawn)
      mk('i', 'thread-rail__traffic', drawn)
      R = { el, drawn, p: -1, seg: null }
      E.rails.set(sec, R)
      if (railIO) railIO.observe(el)
    }
    return R
  }
  function portFor(key, host) {
    let P = E.ports.get(key)
    if (!P || P.parentNode !== host) {
      if (P) P.remove()
      P = mk('i', 'thread-port thread-fade', host)
      mk('i', 'thread-port__pulse', P)
      E.ports.set(key, P)
    }
    return P
  }
  function stubFor(key, host) {
    let S = E.stubs.get(key)
    if (!S || S.el.parentNode !== host) {
      if (S) S.el.remove()
      const el = mk('div', 'thread-stub thread-fade', host)
      mk('i', 'thread-stub__route', el)
      S = { el, drawn: mk('i', 'thread-stub__drawn', el), f: -1 }
      E.stubs.set(key, S)
    }
    return S
  }

  // traffic only animates on rails that are on screen (CSS: desktop, not paused)
  const railIO = 'IntersectionObserver' in window
    ? new IntersectionObserver((es) => { for (const e of es) e.target.classList.toggle('is-live', e.isIntersecting) })
    : null
  if (railIO) offs.push(() => railIO.disconnect())

  // ---------- geometry ----------
  function measure() {
    const sy = window.scrollY
    const vh = window.innerHeight
    const mR = main.getBoundingClientRect()
    const ox = mR.left
    const mainTop = mR.top + sy
    const B = (e) => {
      const r = e.getBoundingClientRect()
      return { x: r.left - ox, y: r.top + sy, w: r.width, h: r.height, r: r.right - ox, b: r.bottom + sy }
    }
    const external = (n) => !!n.closest('[data-flow-external]')
    // optional data-port-y="<px>" on a node: the port's depth below the top of the edge it sits on
    const portY = (n, def, h) => { const v = parseFloat(n.dataset.portY); return Math.min(Number.isFinite(v) ? v : def, h / 2) }
    const shown = (n) => !!n && n.getClientRects().length > 0

    const cont = q('.container')
    const cs = getComputedStyle(cont)
    const contentLeft = cont.getBoundingClientRect().left - ox + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0)
    const railX = Math.max(MIN_X, Math.round(contentLeft - GAP))
    const wide = mqWide.matches

    // sections: where each one's top edge really is at the rail (rounded sheet tops dip at small railX)
    const secs = [...main.children].filter((n) => n.hasAttribute('data-section')).map((el) => {
      const b = B(el)
      const rad = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
      const xr = railX - 1 - b.x
      const dy = rad && xr < rad ? rad - Math.sqrt(Math.max(0, rad * rad - (rad - xr) ** 2)) : 0
      return { el, x: b.x, top: b.y, bottom: b.b, dy }
    })
    const secOf = (n) => secs.find((s) => s.el.contains(n)) || null

    // the portrait: input port (intro edge), output port (railStart)
    const P = B(E.portrait)
    if (!P.w || !P.h) return null
    const out = { x: P.x, y: P.y + P.h * 0.7 }
    const railStart = out.y
    const outModel = pathModel([[P.x + SINK, out.y], [railX, out.y]])
    let intro = null
    if (E.period && shown(E.period)) {
      const Q = B(E.period)
      const cx = Q.x + Q.w / 2, cy = Q.y + Q.h / 2
      let pts, port
      if (cy >= P.y + EDGE_R && cy <= P.b - EDGE_R && (cx >= P.r || cx <= P.x)) {
        const dir = cx >= P.r ? -1 : 1 // RTL desktop: the period is right of the card
        const ex = dir < 0 ? P.r : P.x
        port = { x: ex, y: cy }
        pts = [[cx, cy], [ex + dir * SINK, cy]]
      } else {
        const x = clamp(cx, P.x + EDGE_R, P.r - EDGE_R)
        const down = cy < P.y + P.h / 2
        const ey = down ? P.y : P.b
        port = { x, y: ey }
        const endY = ey + (down ? SINK : -SINK)
        pts = Math.abs(x - cx) < 0.5 ? [[x, cy], [x, endY]] : [[cx, cy], [x, cy], [x, endY]]
      }
      intro = { model: pathModel(pts, 14), port }
    }

    // the dock (railEnd)
    let dock = null
    if (E.dock && shown(E.dock)) { const D = B(E.dock); dock = { x: D.x + D.w / 2, y: D.y + D.h / 2 } } else { const C = B(E.contact); dock = { x: C.x + C.w / 2, y: C.y + Math.min(C.h / 2, 400) } }
    const railEnd = dock.y
    if (!(railEnd > railStart + 40)) return null
    const cardB = B(E.card)

    // rail segments, one per section in [railStart, railEnd]
    const segs = []
    for (let i = 0; i < secs.length; i++) {
      const s = secs[i], n = secs[i + 1]
      const a = Math.max(railStart - 1, s.top + s.dy)
      const b = Math.min(railEnd, n ? n.top + n.dy : s.bottom)
      if (b - a > 0.5) segs.push({ sec: s, top: a, h: b - a })
    }

    const list = [] // rail passes, sorted by y
    const ports = [] // {key, host, x, y (host coords), tt}
    const stubs = [] // {key, host, x0, x1, y (host coords), rtl}
    const fan = []
    const layerPort = (key, x, y, tt) => ports.push({ key, host: layer, x, y: y - mainTop, tt })
    const secStub = (key, sec, x0, x1, y) => stubs.push({ key, host: sec.el, x0: x0 - sec.x, x1: x1 - sec.x, y: y - sec.top })

    // tools: a tap on the rail where it crosses the logo band (the bus beam)
    if (E.tools && shown(E.tools)) {
      const T = B(E.track && shown(E.track) ? E.track : E.tools)
      const y = T.y + T.h / 2
      layerPort('tools', railX, y, 'ink')
      list.push({ key: 'tools', kind: 'tap', node: E.tools, y, port: { x: railX, y } })
    }

    // services: the router on the rail in the lane, then the fan (>= 1024) or left stubs
    let router = null
    if (E.lane && E.overlay && shown(E.lane)) {
      const ovR = E.overlay.getBoundingClientRect()
      const s = E.overlay.offsetWidth ? ovR.width / E.overlay.offsetWidth : 1
      const svcSec = secOf(E.lane)
      let O
      if (Math.abs(s - 1) < 0.002 || !svcSec) O = { x: ovR.left - ox, y: ovR.top + sy }
      else {
        // the sheet is mid depth-transform: walk the untransformed offsets instead
        let x = 0, y = 0
        for (let n = E.inner; n && n !== svcSec.el && n !== main; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop }
        O = { x: svcSec.x + x, y: svcSec.top + y }
      }
      const LL = (e) => { const r = e.getBoundingClientRect(); return { x: (r.left - ovR.left) / s, y: (r.top - ovR.top) / s, w: r.width / s, h: r.height / s } }
      const Ln = LL(E.lane)
      const laneY = Ln.y + Ln.h / 2
      const rx = railX - O.x
      router = { x: railX - (svcSec ? svcSec.x : 0), y: O.y + laneY - (svcSec ? svcSec.top : 0), d: wide ? clamp(2 * railX - 2, 22, 40) : 0, wide, w: ovR.width / s, h: ovR.height / s }
      list.push({ key: 'router', kind: 'router', node: E.routerNode, y: O.y + laneY, port: { x: railX, y: O.y + laneY } })
      for (const c of E.svcs) {
        if (!shown(c)) continue
        const k = c.dataset.node
        const C = LL(c)
        if (wide) {
          const cx = C.x + C.w / 2
          fan.push({ key: k, node: c, model: pathModel([[rx, laneY], [cx, laneY], [cx, C.y + SINK]], 12), port: { x: O.x + cx, y: O.y + C.y } })
          ports.push({ key: k, host: E.overlay, x: cx, y: C.y, tt: 'bone' })
        } else {
          const py = C.y + portY(c, SVC_PORT_Y, C.h)
          ports.push({ key: k, host: E.overlay, x: C.x, y: py, tt: 'bone' })
          stubs.push({ key: k, host: E.overlay, x0: rx - 3, x1: C.x + 2, y: py })
          list.push({ key: k, kind: 'stub', node: c, y: O.y + py, port: { x: O.x + C.x, y: O.y + py }, host: E.overlay, model: pathModel([[rx, py], [C.x + SINK, py]]), tt: 'bone' })
        }
      }
    }

    // projects (index mode) and talks (unpinned): a left stub into the media card edge
    const leftNode = (key, node, media) => {
      if (!shown(node) || external(node)) return
      const sec = secOf(node)
      if (!sec) return
      const M = B(media && shown(media) ? media : node)
      const y = M.y + portY(node, PORT_Y, M.h)
      layerPort(key, M.x, y, sec.el.dataset.theme === 'bone' ? 'bone' : 'ink')
      secStub(key, sec, railX - 3, M.x + 2, y)
      list.push({ key, kind: 'stub', node, y, port: { x: M.x, y }, host: sec.el, model: pathModel([[railX, y - sec.top], [M.x + SINK, y - sec.top]].map(([x, yy]) => [x - sec.x, yy])), tt: sec.el.dataset.theme === 'bone' ? 'bone' : 'ink' })
    }
    for (const p of E.projects) leftNode(p.dataset.node, p, p.querySelector('.project__media'))
    if (E.talks) leftNode('talks', E.talks, E.talks)

    // contact: the packet turns into the card at the dock's height and docks inside it
    const cSec = secOf(E.contact)
    if (cSec) {
      secStub('contact', cSec, railX - 3, cardB.x + 2, dock.y)
      list.push({ key: 'contact', kind: 'dock', node: E.contact, y: railEnd, port: dock, host: cSec.el, model: pathModel([[railX - cSec.x, dock.y - cSec.top], [cardB.x + SINK - cSec.x, dock.y - cSec.top]]), tt: 'ink' })
    }
    list.sort((a, b) => a.y - b.y)

    // the portrait's two ports, in the layer
    if (intro) layerPort('in', intro.port.x, intro.port.y, 'ink')
    layerPort('out', out.x, out.y, 'ink')
    const heroSec = secOf(E.portrait)
    stubs.push({ key: 'out', host: heroSec ? heroSec.el : E.hero, x0: railX - 1 - (heroSec ? heroSec.x : 0), x1: P.x + 2 - (heroSec ? heroSec.x : 0), y: out.y - (heroSec ? heroSec.top : 0), rtl: true })

    const heroBox = B(E.hero)
    const f = env.isMobile ? 0.7 : 0.62
    return {
      sy, vh, ox, mainTop, railX, wide, railStart, railEnd, segs, list, ports, stubs, fan, router,
      intro, out, outModel, dock, cardB, hero: heroSec || secOf(E.hero) || { el: E.hero, x: 0, top: mainTop },
      heroW: heroBox.w, heroH: heroBox.h,
      f, lead: Math.max(0, vh * f - railStart),
      byKey: new Map(list.map((n) => [n.key, n])),
      fanByKey: new Map(fan.map((n) => [n.key, n])),
    }
  }

  // ---------- apply geometry (writes only) ----------
  function apply(g) {
    if (root.style.getPropertyValue('--rail-x') !== `${g.railX}px`) root.style.setProperty('--rail-x', `${g.railX}px`)

    const usedRails = new Set()
    for (const seg of g.segs) {
      const R = railFor(seg.sec.el)
      usedRails.add(R)
      R.seg = seg
      R.p = -1
      css(R.el, 'left', px(g.railX - 12 - seg.sec.x))
      css(R.el, 'top', px(seg.top - seg.sec.top))
      css(R.el, 'height', px(seg.h))
      css(R.drawn, 'height', px(seg.h))
      R.el.classList.remove('is-off')
    }
    for (const R of E.rails.values()) if (!usedRails.has(R)) { R.el.classList.add('is-off'); R.seg = null }
    g.rails = [...usedRails]

    const usedPorts = new Set()
    for (const p of g.ports) {
      const P = portFor(p.key, p.host)
      usedPorts.add(P)
      css(P, 'left', px(p.x))
      css(P, 'top', px(p.y))
      attr(P, 'data-tt', p.tt)
      P.classList.remove('is-off')
    }
    for (const P of E.ports.values()) if (!usedPorts.has(P)) P.classList.add('is-off')

    const usedStubs = new Set()
    for (const s of g.stubs) {
      const S = stubFor(s.key, s.host)
      usedStubs.add(S)
      const x0 = Math.min(s.x0, s.x1), w = Math.abs(s.x1 - s.x0)
      S.x0 = x0
      S.w = w
      S.rtl = !!s.rtl
      css(S.el, 'left', px(x0))
      css(S.el, 'top', px(s.y - 1))
      css(S.el, 'width', px(w))
      S.el.classList.toggle('thread-stub--rtl', !!s.rtl)
      S.el.classList.remove('is-off')
    }
    for (const S of E.stubs.values()) if (!usedStubs.has(S)) S.el.classList.add('is-off')

    // intro edge: the svg sits at the hero's origin and its viewBox is in document coordinates
    if (g.intro) {
      const w = Math.ceil(g.heroW), h = Math.ceil(g.heroH)
      attr(E.intro, 'width', w)
      attr(E.intro, 'height', h)
      attr(E.intro, 'viewBox', `${r2(g.hero.x)} ${r2(g.hero.top)} ${w} ${h}`)
      attr(E.introRoute, 'd', g.intro.model.d)
      attr(E.introDrawn, 'd', g.intro.model.d)
      css(E.introDrawn, 'strokeDasharray', `${r2(g.intro.model.len)} ${r2(g.intro.model.len + 4)}`)
      E.intro.classList.remove('is-off')
    } else E.intro.classList.add('is-off')

    // router (section coordinates) + fan (overlay coordinates)
    if (E.router && g.router) {
      const { x, y, d, wide } = g.router
      E.router.classList.toggle('is-off', !wide)
      E.mark.classList.toggle('is-off', wide)
      if (wide) {
        css(E.router, 'left', px(x - d / 2))
        css(E.router, 'top', px(y - d / 2))
        css(E.router, 'width', px(d))
        css(E.router, 'height', px(d))
      } else {
        css(E.mark, 'left', px(x))
        css(E.mark, 'top', px(y))
      }
      const fw = Math.ceil(g.router.w), fh = Math.ceil(g.router.h)
      attr(E.fanSvg, 'width', fw)
      attr(E.fanSvg, 'height', fh)
      attr(E.fanSvg, 'viewBox', `0 0 ${fw} ${fh}`)
    } else {
      if (E.router) { E.router.classList.add('is-off'); E.mark.classList.add('is-off') }
    }
    for (const [k, F] of E.fan) {
      const n = g.fanByKey.get(k)
      css(F.route, 'display', n ? '' : 'none')
      css(F.drawn, 'display', n ? '' : 'none')
      if (!n) continue
      attr(F.route, 'd', n.model.d)
      attr(F.drawn, 'd', n.model.d)
      css(F.drawn, 'strokeDasharray', `${r2(n.model.len)} ${r2(n.model.len + 4)}`)
      F.len = n.model.len
    }
  }

  // ---------- state -> visuals (everything except what a running tween is drawing) ----------
  const done = (k) => !live || st.passed.has(k)
  function stubTo(key, f) {
    const S = E.stubs.get(key)
    if (!S) return
    const v = clamp(f, 0, 1)
    if (v === S.f) return
    S.f = v
    S.drawn.style.transform = `scaleX(${r2(v * 1000) / 1000})`
  }
  function stubToX(key, x) { // draw a stub up to the moving spark's x
    const S = E.stubs.get(key)
    if (!S || !S.w) return
    stubTo(key, S.rtl ? (S.x0 + S.w - x) / S.w : (x - S.x0) / S.w)
  }
  function paint() {
    const g = st.g
    if (!g) return
    for (const [k, P] of E.ports) {
      if (busy.has(k)) continue
      P.classList.toggle('is-done', done(k))
    }
    E.ports.get('in')?.classList.toggle('is-hidden', live && st.phase === 'wait')
    for (const k of E.stubs.keys()) if (!busy.has(k)) stubTo(k, done(k) ? 1 : 0)
    if (g.intro && !busy.has('in')) {
      E.intro.classList.toggle('is-on', !live || st.phase !== 'wait' || done('in'))
      E.introDrawn.style.strokeDashoffset = done('in') ? '0' : `${r2(g.intro.model.len)}`
    }
    if (E.router) {
      E.router.classList.toggle('is-done', done('router'))
      E.mark.classList.toggle('is-done', done('router'))
    }
    if (!busy.has('fan')) for (const [k, F] of E.fan) if (F.len) F.drawn.style.strokeDashoffset = done(k) ? '0' : `${r2(F.len)}`
  }

  // ---------- per frame: transforms only ----------
  function segAt(y) {
    const rails = st.g.rails
    for (let i = rails.length - 1; i >= 0; i--) if (y >= rails[i].seg.top) return rails[i].seg
    return rails[0] ? rails[0].seg : null
  }
  function render(force) {
    const g = st.g
    if (!g) return
    const y = live ? st.Hd : g.railEnd
    for (const R of g.rails) {
      const p = clamp((y - R.seg.top) / R.seg.h, 0, 1)
      if (p !== R.p || force) {
        R.p = p
        R.drawn.style.transform = p >= 1 ? 'none' : `translate3d(0,${r2((p - 1) * R.seg.h)}px,0)`
      }
    }
    if (!live) return
    E.packet.style.transform = `translate3d(${g.railX}px,${r2(y - g.mainTop)}px,0)`
    const s = Math.min(1, Math.abs(st.v) / 1500)
    const ts = s < 0.03 ? 0 : r2(s)
    const up = st.v < 0
    if (ts !== st.ts || up !== st.up) {
      st.ts = ts
      st.up = up
      E.tail.style.transform = `rotate(${up ? 180 : 0}deg) scaleY(${ts})`
    }
    const seg = segAt(y)
    const tt = seg ? (seg.sec.el.dataset.theme || 'ink') : 'ink'
    if (tt !== st.tt) { st.tt = tt; E.packet.dataset.tt = tt }
    const parked = st.phase === 'run' && y <= g.railStart + 0.5 && st.v === 0
    if (parked !== st.parked) { st.parked = parked; E.packet.classList.toggle('is-parked', parked) }
    const docked = st.phase === 'run' && y >= g.railEnd - 0.5
    if (docked !== st.docked) { st.docked = docked; E.packet.classList.toggle('is-docked', docked) }
  }
  function packetAt(x, y) {
    E.packet.style.transform = `translate3d(${r2(x)}px,${r2(y - st.g.mainTop)}px,0)`
  }
  function showPacket(on) {
    if (on === st.shown) return
    st.shown = on
    E.packet.classList.toggle('is-on', on)
  }

  // ---------- the loop: tweens + the packet; sleeps whenever nothing moves ----------
  function kick() {
    if (st.raf || st.dead) return
    st.last = performance.now()
    st.raf = requestAnimationFrame(tick)
  }
  const tick = safe((now) => {
    const m0 = DEV ? performance.now() : 0
    st.raf = 0
    // no small cap: the follower is stable for any dt, so a long frame (image decode on a slow phone)
    // lets the packet catch up in wall time instead of falling behind
    const dt = clamp((now - st.last) / 1000, 0.001, 1)
    st.last = now
    for (const t of [...tweens]) stepTween(t, now)
    let moving = false
    if (st.phase === 'run' && st.g) moving = stepPacket(dt)
    if (moving || tweens.size) st.raf = requestAnimationFrame(tick)
    if (DEV) performance.measure('thread:frame', { start: m0, end: performance.now() })
  })

  function tween({ key, dur, ease = ioEase, update, done: fin, keys = [] }) {
    const t = { key, d: Math.max(1, dur * 1000), t0: performance.now(), ease, update, fin, keys: key ? [key, ...keys] : keys }
    t.keys.forEach((k) => busy.add(k))
    tweens.add(t)
    t.update(0)
    kick()
    return t
  }
  function stepTween(t, now) {
    const p = clamp((now - t.t0) / t.d, 0, 1)
    t.update(t.ease(p))
    if (p >= 1) endTween(t, true)
  }
  function endTween(t, finish) {
    if (!tweens.has(t)) return
    tweens.delete(t)
    t.keys.forEach((k) => busy.delete(k))
    if (finish) { t.update(1); if (t.fin) t.fin() }
  }

  function headTarget() {
    const g = st.g
    const sy = st.sy
    if (st.forceEnd) return g.railEnd
    let H = sy + st.vh * g.f
    // on screens where the head line starts below the output port, ease it in over the first 80% of a
    // viewport of scrolling, so the packet waits at the port until the visitor scrolls
    if (g.lead > 0) H -= g.lead * (1 - Math.min(1, sy / (st.vh * 0.8)))
    return clamp(H, g.railStart, g.railEnd)
  }

  function stepPacket(dt) {
    const target = headTarget()
    const gap = target - st.Hd
    if (Math.abs(gap) > 2 * st.vh) {
      if (performance.now() - st.lastInput > 900) {
        // a programmatic jump nobody asked to watch (scroll restoration, a load-time #hash): land silently
        checkHashEnd()
        const t2 = headTarget()
        st.Hd = t2
        st.v = 0
        passUpTo(t2, true)
        render()
        return false
      }
      st.sprint = true // an anchor jump or a fling: sprint and arrive within .8s
    }
    let next = st.Hd + gap * (1 - Math.exp(-dt * (st.sprint ? 16 : 9)))
    if (Math.abs(target - next) < (st.sprint ? 2 : 0.5)) { next = target; st.sprint = false }
    // docking: once the packet is visibly at the dock, take the last few px at once (no crawl)
    else if (target === st.g.railEnd && target - next < 3) next = target
    const v = (next - st.Hd) / dt
    st.v += (v - st.v) * Math.min(1, dt * 14)
    if (next === target && Math.abs(st.v) < 6) st.v = 0
    st.Hd = next
    render()
    passUpTo(next, false)
    return next !== target || st.v !== 0
  }

  // ---------- arrivals ----------
  const page = (pt) => ({ x: Math.round(pt.x + st.g.ox), y: Math.round(pt.y) })
  function fire(node, pt, silent) { if (node) arrive(node, { silent: !!silent, ...page(pt) }) }

  function passUpTo(y, silent) {
    for (const n of st.g.list) {
      if (n.y > y + 0.5) break
      if (!st.passed.has(n.key)) pass(n, silent)
    }
  }
  function pass(n, silent) {
    st.passed.add(n.key)
    const quiet = silent || isPaused()
    if (n.kind === 'tap') { portDone(n.key, !quiet); fire(n.node, n.port, silent); return }
    if (n.kind === 'router') { routerDone(!quiet); fire(n.node, n.port, silent); if (st.g.wide) runFan(silent, quiet); return }
    runStub(n, silent, quiet)
  }
  function runStub(n, silent, quiet) {
    const key = n.key
    if (quiet) { stubTo(key, 1); portDone(key, false); fire(n.node, n.port, silent); return }
    const dockRun = n.kind === 'dock'
    const spark = makeSpark(n.host, n.tt, dockRun)
    tween({
      key, dur: st.sprint ? 0.14 : 0.3,
      update: (p) => {
        const c = st.g.byKey.get(key) || n
        const [x, y] = c.model.at(c.model.len * p)
        spark.style.transform = `translate3d(${r2(x)}px,${r2(y)}px,0)`
        stubToX(key, x)
      },
      done: () => {
        dropSpark(spark)
        stubTo(key, 1)
        const c = st.g.byKey.get(key) || n
        if (!dockRun) portDone(key, !isPaused())
        fire(c.node, c.port, false)
      },
    })
  }
  function runFan(silent, quiet) {
    const g = st.g
    if (!g.fan.length) return
    if (quiet) {
      for (const n of g.fan) { st.passed.add(n.key); portDone(n.key, false); fire(n.node, n.port, silent) }
      paint()
      return
    }
    const sp = g.fan.map((n) => ({ key: n.key, el: makeSpark(E.overlay, 'bone') }))
    tween({
      key: 'fan', keys: g.fan.map((n) => n.key), dur: st.sprint ? 0.3 : 0.6,
      update: (p) => {
        for (const s of sp) {
          const n = st.g.fanByKey.get(s.key)
          const F = E.fan.get(s.key)
          if (!n || !F) continue
          const d = n.model.len * p
          F.drawn.style.strokeDashoffset = `${r2(n.model.len - d)}`
          const [x, y] = n.model.at(d)
          s.el.style.transform = `translate3d(${r2(x)}px,${r2(y)}px,0)`
        }
      },
      done: () => {
        for (const s of sp) {
          dropSpark(s.el)
          const n = st.g.fanByKey.get(s.key)
          st.passed.add(s.key)
          portDone(s.key, !isPaused())
          if (n) fire(n.node, n.port, false)
        }
      },
    })
  }

  function makeSpark(host, tt, big) {
    const s = mk('i', `thread-spark${big ? ' thread-spark--packet' : ''}`, host)
    s.dataset.tt = tt || 'ink'
    sparks.add(s)
    return s
  }
  function dropSpark(s) { sparks.delete(s); s.remove() }

  function portDone(key, pulse) {
    const P = E.ports.get(key)
    if (!P) return
    P.classList.add('is-done')
    if (!pulse) return
    const ring = P.firstChild
    animate(P, { scale: [0.55, 1.3, 1] }, { duration: 0.45, ease: POP })
    // a finished ring drops its inline scale, so its (invisible) box never pokes past the viewport edge
    animate(ring, { scale: [1, 2.6], opacity: [0.8, 0] }, { duration: 0.6, ease: OUT })
      .then(() => { ring.style.transform = ''; ring.style.opacity = '' }, () => {})
  }
  function routerDone(pulse) {
    const R = st.g.wide ? E.router : E.mark
    if (!R) return
    E.router.classList.add('is-done')
    E.mark.classList.add('is-done')
    if (pulse) animate(R, { scale: [1, 1.14, 1] }, { duration: 0.5, ease: POP })
  }

  // ---------- intro: period -> portrait -> out along the output stub -> park on the rail ----------
  function playIntro() {
    const g = st.g
    if (!g.intro) { finishIntro(false); startLoop(g.railStart); return }
    st.phase = 'intro'
    paint()
    const start = g.intro.model.at(0)
    packetAt(start[0], start[1])
    E.tail.style.transform = 'scaleY(0)'
    st.ts = 0
    showPacket(true)
    animate(E.dot, { scale: [0, 1] }, { duration: 0.3, ease: POP })
    tween({
      key: 'in', dur: 0.55,
      update: (p) => {
        const m = st.g.intro.model
        const d = m.len * p
        E.introDrawn.style.strokeDashoffset = `${r2(m.len - d)}`
        const [x, y] = m.at(d)
        packetAt(x, y)
      },
      done: () => {
        st.passed.add('in')
        portDone('in', true)
        fire(E.portrait, st.g.intro.port, false)
        // the packet is now under the card: it crosses it unseen and comes out of the output port
        later(emerge, 420)
      },
    })
  }
  function emerge() {
    if (st.phase !== 'intro') return
    tween({
      key: 'out', dur: 0.4,
      update: (p) => {
        const m = st.g.outModel
        const [x, y] = m.at(m.len * p)
        packetAt(x, y)
        stubToX('out', x - st.g.hero.x)
        if (p > 0.12 && !st.passed.has('out')) { st.passed.add('out'); portDone('out', true) }
      },
      done: () => {
        st.passed.add('out')
        stubTo('out', 1)
        startLoop(st.g.railStart)
      },
    })
  }
  function finishIntro(silent) {
    for (const t of [...tweens]) if (t.key === 'in' || t.key === 'out') endTween(t, false)
    st.timers.forEach(clearTimeout)
    st.timers.clear()
    const fresh = !st.passed.has('in')
    st.passed.add('in')
    st.passed.add('out')
    if (fresh) fire(E.portrait, (st.g.intro && st.g.intro.port) || st.g.out, silent)
    paint()
  }
  function startLoop(fromY) {
    st.phase = 'run'
    st.Hd = fromY
    st.v = 0
    showPacket(true)
    render(true)
    kick()
  }

  // wait -> run. instant: draw the intro edge at once (repeat visit, skipped wave, paused, mid-page)
  function startRun(instant, tries = 0) {
    if (st.phase !== 'wait' || !st.g) return
    st.timers.forEach(clearTimeout)
    st.timers.clear()
    st.sy = window.scrollY
    // a rerun scrolls back to the top first: wait for it (up to 3s) instead of silently latching every
    // node the page passes on its way up
    if (st.replay && st.sy > st.vh * 0.5 && tries < 30) { later(() => startRun(instant, tries + 1), 100); return }
    const mid = st.sy > st.vh * 0.5
    if (mid) checkHashEnd()
    if (!instant && !mid) { playIntro(); return }
    st.phase = 'run'
    finishIntro(mid)
    const y = mid ? headTarget() : st.g.railStart
    if (mid) passUpTo(y, true)
    startLoop(y)
  }
  // a shared /#contact link lands on the finished run: the packet is already docked
  function checkHashEnd() {
    let id = location.hash.slice(1)
    try { id = decodeURIComponent(id) } catch (_) { /* keep raw */ }
    const t = id && document.getElementById(id)
    if (t && E.contact.contains(t)) st.forceEnd = { y: window.scrollY }
  }

  function reset() {
    for (const t of [...tweens]) endTween(t, false)
    busy.clear()
    for (const s of [...sparks]) dropSpark(s)
    st.timers.forEach(clearTimeout)
    st.timers.clear()
    st.passed.clear()
    st.forceEnd = null
    st.sprint = false
    st.replay = true
    st.phase = 'wait'
    st.v = 0
    if (st.g) st.Hd = st.g.railStart
    showPacket(false)
    E.packet.classList.remove('is-parked', 'is-docked')
    st.parked = st.docked = false
    E.router && E.router.classList.remove('is-done')
    E.mark && E.mark.classList.remove('is-done')
    paint()
    render(true)
    // ignition replays the wave and reports back; if it never does, run anyway
    later(() => startRun(false), 2600)
  }

  // ---------- rebuild on every refresh ----------
  function rebuild() {
    const m0 = DEV ? performance.now() : 0
    const g = measure()
    if (DEV) performance.measure('thread:measure', { start: m0, end: performance.now() })
    // no measurable circuit (a hook is hidden at this width): hide every piece until the next refresh
    root.classList.toggle('thread-void', !g)
    if (!g) return
    st.g = g
    st.vh = g.vh
    apply(g)
    if (live) {
      if (st.phase === 'wait') st.Hd = g.railStart
      else st.Hd = clamp(st.Hd, g.railStart, g.railEnd)
      // nodes that moved above the packet (layout shift) are reached silently
      if (st.phase === 'run') passUpTo(st.Hd, true)
    }
    paint()
    render(true)
    if (!st.built) {
      st.built = true
      if (live) root.dataset.flow = 'on'
      // reveal once the webfonts have settled the layout, so nothing visibly jumps
      const show = () => root.classList.add('thread-built')
      if (document.fonts && document.fonts.status !== 'loaded') {
        Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(safe(show))
      } else show()
      if (live) {
        if (window.scrollY > st.vh * 0.5) startRun(true) // loaded mid-page: everything above has already run
        else later(() => { if (!root.classList.contains('fx-ignition')) startRun(!firstVisit) }, 60)
        later(() => startRun(false), 4200) // ignition never reported back
      }
    }
    if (live && st.phase === 'run') kick()
    if (DEV) performance.measure('thread:rebuild', { start: m0, end: performance.now() })
  }

  // ---------- wiring ----------
  offs.push(onRefresh(safe(rebuild)))
  if ('MutationObserver' in window) {
    const mo = new MutationObserver(() => requestRefresh('thread:external'))
    mo.observe(main, { subtree: true, attributes: true, attributeFilter: ['data-flow-external'] })
    offs.push(() => mo.disconnect())
  }

  if (!live) return { die }

  listen(document, EVT.IGNITE_DONE, () => {
    if (st.phase === 'wait') {
      rebuild() // the headline has just compiled: measure the period where it really landed
      const skipped = performance.now() - st.lastInput < 1500
      startRun(!(firstVisit || st.replay) || skipped || isPaused())
    } else if (st.g && st.g.intro && st.phase === 'run') {
      requestRefresh('thread:ignite')
    }
  })
  listen(document, EVT.RESET, reset)
  listen(window, 'scroll', () => {
    st.sy = window.scrollY
    if (st.forceEnd && st.sy < st.forceEnd.y - st.vh * 0.3) st.forceEnd = null
    if (st.phase === 'run') kick()
    else if (st.phase === 'wait' && !st.replay && st.g && st.sy > st.vh * 0.5) startRun(true)
  }, { passive: true })
  listen(window, 'resize', () => {
    // height-only resizes (mobile toolbars) keep the head line steady unless the change is large
    const h = window.innerHeight
    if (Math.abs(h - st.vh) > 120) { st.vh = h; if (st.g) st.g.lead = Math.max(0, h * st.g.f - st.g.railStart); kick() }
  }, { passive: true })
  const onInput = () => {
    st.lastInput = performance.now()
    if (st.phase === 'intro') { finishIntro(false); startLoop(st.g.railStart) }
  }
  for (const t of ['wheel', 'touchstart', 'touchmove', 'keydown', 'pointerdown']) listen(window, t, onInput, { passive: true, capture: true })
  offs.push(onPause(safe(() => { if (st.phase === 'run') kick() })))

  return { die }
}
