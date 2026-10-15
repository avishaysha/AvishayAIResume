// Package `keyhole` (spec/keyhole.md): the colossal "AI" you dive through into the lecture photo.
//
// PINNED (motion ok, viewport >= 520px tall): [data-keyhole].is-pinned + data-flow-external. The wrapper is
// 220svh (170svh <= 768px), the stage is a sticky 100svh full-bleed ink box. p = scroll progress through the
// wrapper ('start start' -> 'end end'), driven by one passive scroll listener and at most one rAF per frame.
//   layers  1 the photo (full-bleed img, object-position 62% 30%)
//           2 canvas.keyhole__mask: ink with "AI"-shaped holes. Every redraw: one ink fillRect, then
//             destination-out fillText('A') + fillText('I') in '900 F px Rubik' (F = min(72svh, 62vw)), scaled
//             by s around the I-stem centre. Vector glyphs are re-rasterised each draw, so the holes stay
//             crisp at any scale; no blend modes, no giant DOM text.
//           3 the kicker "גם מרצה על" (Rubik 800, .155F), a right-to-left staircase into the I
//           4 .talk__text (eyebrow, h2, description, link)
//   timeline  0-.2   kicker fades and slides 20vw to the right
//             0-.6   s: 1 -> S (cubic-bezier(.55,0,.8,.2)), S = 1.15 x the scale at which the I stem covers
//                    the stage around its own centre; the photo settles 1.25 -> 1 around the same point
//             .55-.62 the mask fades out (below it the photo is already full); no redraws from .62 on
//             .62    arrive(talks node), once per run (silent when the visitor jumped straight past it)
//             .62-.75 the photo recedes into its frame: clip-path inset(0) -> the frame, while the img
//                    transform FLIPs from "covers the stage" to "covers the frame" (so it is never upscaled
//                    full-bleed at rest). Wide landscape: framed on the left, the text column on the right.
//                    Phones and portrait tablets: framed under the nav, the text at the bottom.
//             .65-.82 the text rises (y 40px -> 0, opacity 0 -> 1), its four blocks 20ms-of-p apart
//   focus   the text is opacity-hidden (it stays in the accessibility tree and the tab order); a focusin on
//           anything inside it jumps to p = .9, so a keyboard user never lands on an invisible link.
//   anchors registerTarget(#talks) -> the y where p = .9 (nav, footer, deep links land on the end state).
//   before Rubik has loaded the stage shows its end frame; if the canvas or the font fails: FALLBACK.
// FALLBACK (no 2D canvas, no Rubik, or a viewport under 520px tall): no pin. The foundation's static
//   two-column layout plus the clip-wipe reveal (inset(0 0 0 100%) -> 0 over 1.2s, img 1.18 -> 1) on inView.
// Contract
//   sets     html.fx-keyhole (sync), [data-keyhole].is-pinned|.is-wipe, data-flow-external while pinned
//   calls    arrive(figure[data-node=talks], {silent}) while pinned (the thread skips the node then)
//   listens  'run:reset' (re-arms the arrival once the visitor is back above it)
//   anchors  registerTarget(section#talks) while pinned
// Reduced motion: init returns early (the foundation's static two columns). Paused: the scrub follows the
// visitor's own scroll (nothing moves by itself); the fallback wipe lands instantly.
// Any runtime error tears the package down (classes, custom properties, canvas) and leaves the static page.

import '../styles/keyhole.css'
import { animate, inView, cubicBezier } from 'motion'
import { motionOk } from '../core/env.js'
import { isPaused } from '../core/state.js'
import { EVT, arrive } from '../core/flow.js'
import { fontsReady } from '../core/fonts.js'
import { onRefresh, requestRefresh } from '../core/refresh.js'
import { registerTarget, scrollToY, navH } from '../core/scroll.js'

const root = document.documentElement
const PIN_Q = '(min-height: 520px)' // below this the end frame cannot hold the photo and the text
const SPLIT_Q = '(min-width: 1024px) and (min-aspect-ratio: 23/20)'

// timeline (fractions of p)
const K_END = 0.2 // kicker out
const DIVE = 0.6 // s reaches S, the photo reaches scale 1
const FADE_A = 0.55, FADE_B = 0.62 // mask opacity 1 -> 0
const ARRIVE = 0.62
const FRAME_A = 0.62, FRAME_B = 0.75 // the photo frames itself
const TEXT_A = 0.65, TEXT_B = 0.82, TEXT_STEP = 0.02 // the text rises (4 blocks, staggered)
const FOCUS_P = 0.9 // anchor / focus landing

const PHOTO_Z = 1.25
const FACE = [0.525, 0.267] // his face in lecture.jpg (fractions of the image), kept in the end frame
const FONT_SPEC = '900 1em Rubik'
const OUT = [0.22, 1, 0.36, 1] // --ease-out

const diveEase = cubicBezier(0.55, 0, 0.8, 0.2)
const ioEase = cubicBezier(0.65, 0, 0.35, 1)
const outEase = cubicBezier(0.22, 1, 0.36, 1)
const inEase = cubicBezier(0.55, 0, 1, 0.45)

/** Resolves when the image is decoded (or failed), at the latest after `ms`. */
function decoded(img, ms) {
  const dec = () => (img.decode ? img.decode().catch(() => {}) : undefined)
  const ready = img.complete && img.naturalWidth
    ? Promise.resolve(dec())
    : new Promise((r) => {
      img.addEventListener('load', r, { once: true })
      img.addEventListener('error', r, { once: true })
    }).then(dec)
  return Promise.race([ready, new Promise((r) => setTimeout(r, ms))])
}

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const r2 = (n) => Math.round(n * 100) / 100
const px = (n) => `${r2(n)}px`

export function init() {
  if (!motionOk) return
  const wrap = document.querySelector('[data-keyhole]')
  const stage = wrap && wrap.querySelector('[data-keyhole-stage]')
  const figure = stage && stage.querySelector('[data-talk-media]')
  const img = figure && figure.querySelector('img')
  const kicker = stage && stage.querySelector('.keyhole__kicker')
  const text = stage && stage.querySelector('.talk__text')
  const section = wrap && (wrap.closest('[data-section]') || wrap.parentElement)
  if (!wrap || !stage || !figure || !img || !kicker || !text || !section) return
  root.classList.add('fx-keyhole')

  const blocks = [...text.children]
  // the <source>s' sizes: '100vw' suits the static card; pinned, the photo is drawn at its stage-cover width
  const sources = [...figure.querySelectorAll('source[srcset]')]
  const sizes0 = sources.map((s) => s.getAttribute('sizes'))
  let sizesW = 0
  const offs = [] // teardown for listeners that live as long as the package
  let dead = false
  let mode = null // 'pinned' | 'wipe'
  let failed = false // the canvas or the font failed: the wipe for good
  let fontOk = false // Rubik is measurable
  let ready = false // the mask is live (Rubik measured; switched on while the stage was off screen)
  let pendingReady = false // the font arrived while the stage was on screen
  let raf = 0
  let lastP = null // the previous tick's p (null: no tick yet)
  let arrived = false // arrive() called in this run
  let armed = true // false after a run reset until the visitor is back above the arrival point
  let unreg = null
  let wipe = null // {stop, anims}

  const safe = (fn) => (...a) => {
    if (dead) return undefined
    try { return fn(...a) } catch (e) { kill(e); return undefined }
  }

  // ---------- the mask canvas ----------
  let canvas = null
  let ctx = null
  try {
    canvas = document.createElement('canvas')
    canvas.className = 'keyhole__mask'
    canvas.setAttribute('aria-hidden', 'true')
    ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.font = '900 10px sans-serif'
      const m = ctx.measureText('I')
      // measureText's ink boxes are required to find the stem
      if (!Number.isFinite(m.actualBoundingBoxAscent) || !Number.isFinite(m.actualBoundingBoxLeft)) ctx = null
    }
  } catch (e) { ctx = null }
  if (!ctx) failed = true
  else figure.after(canvas)

  const INK = getComputedStyle(root).getPropertyValue('--ink').trim() || '#0C0C10'

  // ---------- custom-property writes that skip unchanged values ----------
  const cache = new Map()
  function prop(el, name, val) {
    let c = cache.get(el)
    if (!c) { c = {}; cache.set(el, c) }
    if (c[name] === val) return
    c[name] = val
    if (val === null) el.style.removeProperty(name)
    else el.style.setProperty(name, val)
  }
  function clearProps() {
    for (const [el, c] of cache) for (const k of Object.keys(c)) el.style.removeProperty(k)
    cache.clear()
  }

  // ---------- geometry (measured on refresh, never in a frame) ----------
  const G = { ok: false, W: 0, H: 0, top: 0, range: 1, sig: '' }

  function measureWrap() {
    const sy = window.scrollY
    G.top = wrap.getBoundingClientRect().top + sy
    G.range = Math.max(1, wrap.offsetHeight - stage.offsetHeight)
  }

  function measure() {
    if (mode !== 'pinned') return
    measureWrap()
    const W = stage.clientWidth
    const H = stage.clientHeight
    if (!W || !H) { G.ok = false; return }
    const nh = Math.min(navH(), H * 0.2)
    const split = window.matchMedia(SPLIT_Q).matches
    wrap.classList.toggle('kh-split', split)
    wrap.classList.toggle('kh-stack', !split)

    // the text: column (split) or bottom block (stack); its layout decides the frame
    let R // the end frame, stage px
    if (split) {
      const m = Math.max(W * 0.04, (W - 1500) / 2)
      const C = W - 2 * m
      const top = nh + H * 0.06
      const bottom = H - H * 0.06
      R = { l: m, r: m + C * 0.6, t: top, b: bottom }
      prop(wrap, '--kh-tl', px(m + C * 0.64))
      prop(wrap, '--kh-tw', px(C * 0.36))
      prop(wrap, '--kh-tt', px(top))
      prop(wrap, '--kh-tb', px(H - bottom))
    } else {
      const g = parseFloat(getComputedStyle(text).right) || 16
      const tTop = text.offsetTop
      R = { l: g, r: W - g, t: nh + 8, b: Math.max(nh + 8 + 96, tTop - 22) }
    }
    // never past 1x density at rest: cap the frame where the cover scale would exceed 1
    const iw = Number(img.getAttribute('width')) || img.naturalWidth || 1448
    const ih = Number(img.getAttribute('height')) || img.naturalHeight || 1086
    if (R.b - R.t > ih) { const c = (R.t + R.b) / 2; R.t = c - ih / 2; R.b = c + ih / 2 }
    if (R.r - R.l > iw) { const c = (R.l + R.r) / 2; R.l = c - iw / 2; R.r = c + iw / 2 }
    const Rw = R.r - R.l, Rh = R.b - R.t
    G.R = R
    G.rad = split ? 28 : 24
    // the photo: D0 covers the stage (object-position 62% 30%), D1 covers the frame with his face kept
    const s0 = Math.max(W / iw, H / ih)
    const D0 = { x: (W - iw * s0) * 0.62, y: (H - ih * s0) * 0.3, w: iw * s0, h: ih * s0 }
    const s1 = Math.max(Rw / iw, Rh / ih)
    const w1 = iw * s1, h1 = ih * s1
    const D1 = {
      x: clamp(R.l + Rw / 2 - FACE[0] * w1, R.r - w1, R.l),
      y: clamp(R.t + Rh * 0.36 - FACE[1] * h1, R.b - h1, R.t),
      w: w1, h: h1,
    }
    G.D0 = D0; G.D1 = D1
    G.W = W; G.H = H
    // ask for the file that matches the drawn width (a phone draws ~1125px wide: the 1448w file, not 800w)
    const want = Math.ceil(D0.w)
    if (Math.abs(want - sizesW) > sizesW * 0.1) {
      sizesW = want
      for (const s of sources) s.setAttribute('sizes', `${want}px`)
    }
    prop(figure, '--kh-ix', px(D0.x))
    prop(figure, '--kh-iy', px(D0.y))
    prop(figure, '--kh-iw', px(D0.w))
    prop(figure, '--kh-ih', px(D0.h))

    if (ready) measureType(W, H, nh)
    G.ok = true
    G.sig = '' // force the next render
  }

  function measureType(W, H, nh) {
    // canvas backing store: CSS px x DPR (<= 2)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr)
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
    G.dprX = cw / W; G.dprY = ch / H

    const F = Math.round(Math.min(H * 0.72, W * 0.62))
    G.font = `900 ${F}px Rubik`
    setType()
    const mA = ctx.measureText('A')
    const mI = ctx.measureText('I')
    const mAI = ctx.measureText('AI')
    const dI = mAI.width - mI.width - F * 0.02 // the I's origin from the A's (kerning + tight tracking)
    // ink boxes relative to the A's origin (x) and the baseline (y)
    const aL = -mA.actualBoundingBoxLeft, aR = mA.actualBoundingBoxRight
    const iL = dI - mI.actualBoundingBoxLeft, iR = dI + mI.actualBoundingBoxRight
    const cap = Math.max(mA.actualBoundingBoxAscent, mI.actualBoundingBoxAscent)

    // the kicker: sized from F, measured in place (hidden until the mask is drawable)
    prop(wrap, '--kh-kfs', px(F * 0.155))
    const kw = kicker.offsetWidth
    const kh = kicker.offsetHeight
    // staircase: the kicker starts over the I stem and runs right; compressed to fit narrow stages
    const g = W < 600 ? 16 : Math.max(16, W * 0.04)
    const avail = W - 2 * g
    let kl = iL
    let right = Math.max(iR, kl + kw)
    if (right - aL > avail) { kl = Math.max(aL, aL + avail - kw); right = Math.max(iR, kl + kw) }
    const ox = (W - (right - aL)) / 2 - aL // the A's origin, stage px
    const gap = F * 0.05
    const blockH = kh + gap + cap
    const visH = H - nh
    const top = nh + Math.max(0, (visH - blockH) / 2 - visH * 0.02)
    const base = top + kh + gap + cap
    prop(wrap, '--kh-kl', px(ox + kl))
    prop(wrap, '--kh-kt', px(top))

    G.ox = ox; G.base = base; G.dI = dI
    const sx0 = ox + iL, sx1 = ox + iR
    const sy0 = base - mI.actualBoundingBoxAscent, sy1 = base + mI.actualBoundingBoxDescent
    G.cx = (sx0 + sx1) / 2
    G.cy = (sy0 + sy1) / 2
    G.stem = [sx0, sy0, sx1, sy1]
    G.aBox = [ox + aL, base - mA.actualBoundingBoxAscent, ox + aR, base + mA.actualBoundingBoxDescent]
    const sw = sx1 - sx0, sh = sy1 - sy0
    G.S = 1.15 * Math.max((2 * Math.max(G.cx, W - G.cx)) / sw, (2 * Math.max(G.cy, H - G.cy)) / sh)
    G.drawnS = -1
  }

  function setType() {
    ctx.font = G.font
    if ('direction' in ctx) ctx.direction = 'ltr' // (single glyphs and an absolute textAlign: optional)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  // ---------- the mask ----------
  function draw(s) {
    const { W, H, cx, cy, dprX, dprY } = G
    const tx = cx - s * cx, ty = cy - s * cy
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    // the stem (minus its rounded corners) covers the whole stage: nothing of the ink is left
    const st = G.stem
    const inset = (st[2] - st[0]) * 0.12 * s
    if (tx + s * st[0] + inset <= 0 && ty + s * st[1] + inset <= 0 && tx + s * st[2] - inset >= W && ty + s * st[3] - inset >= H) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      return
    }
    ctx.fillStyle = INK
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.setTransform(dprX * s, 0, 0, dprY * s, dprX * tx, dprY * ty)
    setType()
    const a = G.aBox
    const ax0 = tx + s * a[0], ax1 = tx + s * a[2], ay0 = ty + s * a[1], ay1 = ty + s * a[3]
    if (ax1 > 0 && ax0 < W && ay1 > 0 && ay0 < H) ctx.fillText('A', G.ox, G.base)
    ctx.fillText('I', G.ox + G.dI, G.base)
    ctx.globalCompositeOperation = 'source-over'
  }

  // ---------- render(p): pure function of p (scrolling back reverses exactly) ----------
  function render(p) {
    const { W, H, D0, D1, R } = G
    const sig = `${r2(p * 10000)}|${ready}`
    if (sig === G.sig) return
    G.sig = sig
    const pv = ready ? p : Math.max(p, FOCUS_P) // before the mask is drawable: the end frame

    // 2 the mask: s over 0-.6, fading out over .55-.62, no redraws from .62 on
    if (ready) {
      if (pv < FADE_B) {
        const s = 1 + (G.S - 1) * diveEase(clamp(pv / DIVE))
        if (s !== G.drawnS) { draw(s); G.drawnS = s }
        const o = 1 - clamp((pv - FADE_A) / (FADE_B - FADE_A))
        prop(wrap, '--kh-mask-o', String(r2(o)))
        prop(wrap, '--kh-mask-v', 'visible')
      } else {
        prop(wrap, '--kh-mask-o', '0')
        prop(wrap, '--kh-mask-v', 'hidden')
      }
      // 3 the kicker: fades and slides 20vw to the right over 0-.2
      const k = clamp(pv / K_END)
      prop(wrap, '--kh-k-o', String(r2(1 - inEase(k))))
      prop(wrap, '--kh-k-x', px(0.2 * W * inEase(k)))
      prop(wrap, '--kh-k-v', k >= 1 ? 'hidden' : 'visible')
    }

    // 1 the photo: the dive zoom around the stem, then the FLIP into the frame
    let tf = 'none'
    let clip = 'none'
    // (the img box is D0, transform-origin its top-left)
    if (pv < DIVE && ready) {
      const z = PHOTO_Z - (PHOTO_Z - 1) * clamp(pv / DIVE)
      tf = `translate3d(${px((1 - z) * (G.cx - D0.x))}, ${px((1 - z) * (G.cy - D0.y))}, 0) scale(${z.toFixed(4)})`
    } else if (pv > FRAME_A) {
      // ease-out: the dive arrives at full speed, the frame takes that momentum and settles
      const t = outEase(clamp((pv - FRAME_A) / (FRAME_B - FRAME_A)))
      const x = lerp(D0.x, D1.x, t), y = lerp(D0.y, D1.y, t), w = lerp(D0.w, D1.w, t)
      tf = `translate3d(${px(x - D0.x)}, ${px(y - D0.y)}, 0) scale(${(w / D0.w).toFixed(4)})`
      clip = `inset(${px(R.t * t)} ${px((W - R.r) * t)} ${px((H - R.b) * t)} ${px(R.l * t)} round ${px(G.rad * t)})`
    }
    prop(figure, '--kh-img', tf)
    prop(figure, '--kh-clip', clip)

    // 4 the text rises over .65-.82, block by block (by the time it is visible the photo has cleared it)
    for (let i = 0; i < blocks.length; i++) {
      const a = TEXT_A + i * TEXT_STEP
      const b = TEXT_B - (blocks.length - 1 - i) * TEXT_STEP * 0.5
      const t = clamp((pv - a) / (b - a))
      prop(blocks[i], '--kh-o', String(r2(ioEase(t))))
      prop(blocks[i], '--kh-y', px(40 * (1 - outEase(t))))
    }
    text.classList.toggle('kh-off', pv < 0.74)
  }

  // ---------- the scroll tick ----------
  const progress = () => (window.scrollY - G.top) / G.range

  const tick = safe(() => {
    raf = 0
    if (mode !== 'pinned' || !G.ok) return
    if (pendingReady && !stageOnScreen()) armReady()
    const p = progress()
    // arrival: once per run; silent when the visitor jumped straight past it (load, hash, instant jump)
    if (!armed && p < ARRIVE) armed = true
    if (armed && !arrived && p >= ARRIVE) {
      arrived = true
      arrive(figure, { silent: lastP === null || lastP < 0 })
    }
    lastP = p
    // render only while the stage is on (or next to) the screen
    const vh = window.innerHeight
    const rel = window.scrollY - G.top // stage top = -rel while p in [0, 1]
    if (rel < -vh * 1.25 || rel > G.range + G.H + vh * 0.25) return
    render(clamp(p, -1, 1.5))
  })
  const onScroll = () => { if (!raf && !dead) raf = requestAnimationFrame(tick) }

  // ---------- anchors and focus ----------
  const focusY = () => wrap.getBoundingClientRect().top + window.scrollY + FOCUS_P * Math.max(1, wrap.offsetHeight - stage.offsetHeight)

  // after the browser's own focus scroll (which mis-measures a sticky child), land on the end state
  let focusRaf = 0
  const land = safe(() => {
    focusRaf = 0
    if (mode !== 'pinned' || !text.contains(document.activeElement)) return
    measureWrap()
    const p = progress()
    if (p >= (ready ? TEXT_B : 0) && p <= 1) return // the text is already fully on screen
    scrollToY(focusY(), { instant: true })
    onScroll()
  })
  const onFocusIn = safe((e) => {
    if (mode !== 'pinned' || !text.contains(e.target) || focusRaf) return
    focusRaf = requestAnimationFrame(land)
  })
  offs.push(() => { if (focusRaf) cancelAnimationFrame(focusRaf) })

  // ---------- modes ----------
  function buildPinned() {
    wrap.classList.remove('is-wipe', 'is-revealed')
    wrap.classList.add('is-pinned')
    wrap.setAttribute('data-flow-external', '')
    unreg = registerTarget(section, safe(focusY))
    G.ok = false
    measure()
    onScroll()
  }

  function teardownPinned() {
    wrap.classList.remove('is-pinned', 'is-ready', 'kh-split', 'kh-stack')
    wrap.removeAttribute('data-flow-external')
    text.classList.remove('kh-off')
    sources.forEach((s, i) => { if (sizes0[i] === null) s.removeAttribute('sizes'); else s.setAttribute('sizes', sizes0[i]) })
    sizesW = 0
    if (unreg) { unreg(); unreg = null }
    clearProps()
    G.ok = false
  }

  function buildWipe() {
    wrap.classList.add('is-wipe')
    // already on screen (or revealed before): never hide what the visitor is looking at
    const r = section.getBoundingClientRect()
    if (wrap.classList.contains('is-revealed') || (r.top < window.innerHeight && r.bottom > 0)) {
      wrap.classList.add('is-revealed')
      return
    }
    const anims = []
    let started = false
    // the stage (never clipped itself) entering the lower 80% of the viewport: works for any section
    // height, unlike an amount threshold on a section taller than the viewport
    const stop = inView(stage, safe(() => {
      if (started) return
      started = true
      if (wipe) { wipe.stop(); wipe.stop = () => {} }
      if (isPaused()) { wrap.classList.add('is-revealed'); return }
      img.loading = 'eager'
      decoded(img, 1200).then(safe(() => {
        if (mode !== 'wipe' || wrap.classList.contains('is-revealed')) return
        if (isPaused()) { wrap.classList.add('is-revealed'); return }
        const a = animate(figure, { clipPath: ['inset(0 0 0 100%)', 'inset(0 0 0 0%)'] }, { duration: 1.2, ease: OUT })
        const b = animate(img, { transform: ['scale(1.18)', 'scale(1)'] }, { duration: 1.6, ease: OUT })
        anims.push(a, b)
        Promise.all([a, b]).then(safe(() => {
          wrap.classList.add('is-revealed')
          figure.style.removeProperty('clip-path')
          img.style.removeProperty('transform')
        }), () => {})
      }))
    }), { margin: '0px 0px -20% 0px' })
    wipe = { stop, anims }
  }

  function teardownWipe() {
    if (!wipe) return
    wipe.stop()
    for (const a of wipe.anims) { try { a.cancel() } catch (e) { /* gone */ } }
    wipe = null
    figure.style.removeProperty('clip-path')
    img.style.removeProperty('transform')
    wrap.classList.remove('is-wipe')
    wrap.classList.add('is-revealed') // a mode switch never re-hides the photo
  }

  const mqPin = window.matchMedia(PIN_Q)
  const setMode = safe(() => {
    const next = !failed && mqPin.matches ? 'pinned' : 'wipe'
    if (next === mode) return
    if (mode === 'pinned') teardownPinned()
    else if (mode === 'wipe') teardownWipe()
    mode = next
    if (mode === 'pinned') {
      buildPinned()
      if (ready) { wrap.classList.add('is-ready'); measure(); onScroll() } else armReady()
    } else buildWipe()
    lastP = null
    requestRefresh('keyhole:mode')
  })

  // the mask needs Rubik's real metrics (the stem): until then the pinned stage shows its end frame.
  // The switch to the dive never happens in front of the visitor: a stage on screen waits until it is not.
  function onFont(ok) {
    if (dead) return
    if (!ok) {
      failed = true
      if (canvas) { canvas.remove(); canvas = null }
      setMode()
      return
    }
    fontOk = true
    armReady()
  }
  function stageOnScreen() {
    const r = stage.getBoundingClientRect()
    return r.top < window.innerHeight && r.bottom > 0
  }
  function armReady() {
    if (!fontOk || ready || mode !== 'pinned') return
    if (stageOnScreen()) { pendingReady = true; return }
    pendingReady = false
    ready = true
    wrap.classList.add('is-ready')
    measure()
    onScroll()
  }

  // ---------- wiring ----------
  window.addEventListener('scroll', onScroll, { passive: true })
  offs.push(() => window.removeEventListener('scroll', onScroll))
  section.addEventListener('focusin', onFocusIn)
  offs.push(() => section.removeEventListener('focusin', onFocusIn))
  mqPin.addEventListener('change', setMode)
  offs.push(() => mqPin.removeEventListener('change', setMode))
  const mqSplit = window.matchMedia(SPLIT_Q)
  const onSplit = safe(() => { if (mode === 'pinned') { measure(); onScroll() } })
  mqSplit.addEventListener('change', onSplit)
  offs.push(() => mqSplit.removeEventListener('change', onSplit))

  offs.push(onRefresh(safe(() => {
    if (mode === 'pinned') { measure(); onScroll() }
  })))
  // core refresh ignores height-only resizes; the stage is 100svh, so a desktop window resized in height
  // re-measures here (a phone's toolbar does not change svh: the cached size makes that a no-op)
  let rz = 0
  const onResize = () => {
    if (mode !== 'pinned' || rz || dead) return
    rz = requestAnimationFrame(safe(() => {
      rz = 0
      if (stage.clientHeight !== G.H || stage.clientWidth !== G.W) { measure(); onScroll() }
    }))
  }
  window.addEventListener('resize', onResize, { passive: true })
  offs.push(() => { window.removeEventListener('resize', onResize); if (rz) cancelAnimationFrame(rz) })

  const onReset = safe(() => { arrived = false; armed = false; onScroll() })
  document.addEventListener(EVT.RESET, onReset)
  offs.push(() => document.removeEventListener(EVT.RESET, onReset))

  // the photo must be decoded by the time the letters reach the screen
  const eager = safe(() => { img.loading = 'eager' })
  if (document.readyState === 'complete') eager()
  else window.addEventListener('load', eager, { once: true })

  // ---------- failure: leave the static page ----------
  function kill(e) {
    if (dead) return
    dead = true
    console.error('[fx:keyhole] failed, falling back to the static page', e)
    try {
      if (raf) cancelAnimationFrame(raf)
      for (const off of offs) { try { off() } catch (er) { /* keep going */ } }
      try { teardownPinned() } catch (er) { /* keep going */ }
      try { teardownWipe() } catch (er) { /* keep going */ }
      if (canvas) canvas.remove()
      canvas = null
      wrap.classList.remove('is-wipe', 'is-revealed')
    } finally {
      root.classList.remove('fx-keyhole')
      requestRefresh('keyhole:off')
    }
  }

  // pin synchronously (the page height is final before the first paint and any #hash landing);
  // the mask joins once Rubik is measurable
  setMode()
  if (!failed) fontsReady(FONT_SPEC, 'AI', 8000).then(safe(onFont), safe(() => onFont(false)))
}
