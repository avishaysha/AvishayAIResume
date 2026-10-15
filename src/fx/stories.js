// Package `stories`: the six looping demos as "monitors".
//
// The three service illustrations (.svc-illus[data-svc]) and the three project minis
// (.mini.story[data-story]) each act out their field or product in a loop. The markup holds every
// story's FINAL state (what reduced-motion visitors see); each cycle resets to its start and plays
// through to that state again. The cycle code and timings are the original ones, moved verbatim with one
// mechanical refactor: wait(ms) -> ctx.wait(ms), animate(...) -> ctx.run(...), so a cycle can be
// cancelled at any await.
//
//   ARMED     a story starts on its node's arrival (core/flow onArrive; with the thread off it is
//             inView, and after 1.5s in view without an arrival it arms anyway). Services also compile
//             their field name (thin -> heavy, right to left) and power on their icon.
//   VISIBLE   inView(root, amount .4). Leaving the view cancels the cycle and restores the final state.
//   PAUSED    the global pause (and a hidden tab) cancels every cycle and restores the final state within
//             the same frame; un-pausing restarts the visible, armed ones.
//   RESTART   click / tap on a monitor: cancel, restore, start a fresh cycle on the next frame. Only one
//             cycle ever runs per monitor (a cancelled cycle throws AbortError at its next await).
//   CHROME    span.story__progress: a 2px RTL hairline at the monitor's foot. Cycle 1 shows a 1.2s
//             indeterminate seek while it measures itself; later cycles fill right to left over the
//             measured duration, led by a bright tip. The project's "הדגמה" dot pulses only while live.
//
// Contract: listens 'flow:arrive' through onArrive (svc-ai/svc-auto/svc-crm, p-cv/p-portal/p-tickets),
// 'motion:pause' through onPause. Dispatches nothing. 'run:reset' needs nothing: stories stay armed and
// the service names stay compiled.
// Reduced motion: init returns before adding anything; the markup's final states and the heavy names show.

import '../styles/stories.css'
import { animate, inView, stagger, frame, visualElementStore } from 'motion'
import { isPaused, onPause } from '../core/state.js'
import { onArrive } from '../core/flow.js'
import { compile } from '../core/compile.js'
import { split } from '../core/split.js'

const root = document.documentElement
const ease = [0.22, 1, 0.36, 1]
const POP = [0.34, 1.56, 0.64, 1]
const DEV = !!import.meta.env.DEV
const $ = (sel, scope = document) => scope.querySelector(sel)
const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)]
const noop = () => {}

const STORIES = [
  ['[data-svc="ai"]', aiStory],
  ['[data-svc="auto"]', autoStory],
  ['[data-svc="crm"]', crmStory],
  ['[data-story="cv"]', cvStory],
  ['[data-story="portal"]', portalStory],
  ['[data-story="tickets"]', ticketsStory],
]

export function init() {
  if (!root.classList.contains('motion-ok')) return
  root.classList.add('fx-stories')

  const players = []
  const byNode = new Map()
  for (const [sel, make] of STORIES) {
    const el = $(sel)
    if (!el) continue
    const p = player(el, make)
    players.push(p)
    if (p.node) byNode.set(p.node, p)
  }

  // Services: the packet's arrival compiles the field name, powers the icon on and arms the story.
  let initing = true
  for (const card of $$('.service[data-node]')) {
    const name = $('.service__name[data-compile]', card)
    const icon = $('.service__icon', card)
    if (name) prepareName(name)
    onArrive(card, () => {
      if (initing && name) void name.offsetWidth // a latched arrival: the new glyphs need a "before" style
      powerOn(card, name, icon)
      byNode.get(card)?.arm()
    }, { fallback: true, fallbackDelay: 1500 })
  }
  // Projects: the arrival (gallery deploy or the thread's port) arms the story.
  for (const p of players) {
    if (p.node && !p.node.matches('.service')) onArrive(p.node, () => p.arm(), { fallback: true, fallbackDelay: 1500 })
  }
  initing = false

  onPause((paused) => players.forEach((p) => (paused ? p.halt() : p.kick())))
  document.addEventListener('visibilitychange', () => {
    players.forEach((p) => (document.hidden ? p.halt() : p.kick()))
  })
  // a width change moves what the cycles measured (columns, tracks): re-measure, restart what plays
  let lastW = window.innerWidth
  let rt = 0
  window.addEventListener('resize', () => {
    clearTimeout(rt)
    rt = setTimeout(() => {
      if (window.innerWidth === lastW) return
      lastW = window.innerWidth
      players.forEach((p) => p.remeasure())
    }, 200)
  }, { passive: true })

  if (DEV) window.__stories = players
}

// ---------- service heads: compile + power-on ----------

// Split once at init so the arrival only toggles a class. Latin names ("AI", "CRM") get their glyph
// order reversed for the stagger, so every field name compiles right to left like the Hebrew one.
function prepareName(el) {
  split(el)
  for (const run of $$('[dir="ltr"]', el)) {
    const chars = $$('.ch', run)
    const idx = chars.map((c) => c.style.getPropertyValue('--i'))
    chars.forEach((c, k) => c.style.setProperty('--i', idx[chars.length - 1 - k]))
  }
}

function powerOn(card, name, icon) {
  const still = isPaused()
  const dur = name ? compile(name, { instant: still }) : 0
  if (still || !icon) { card.classList.add('is-live'); return }
  // the name compiles right to left and ends at the icon (on its left): the icon lights as it lands
  const delay = Math.max(0, dur / 1000 - 0.35)
  icon.style.setProperty('--svc-on', `${delay.toFixed(2)}s`)
  animate(icon, { scale: [1, 1.15, 1] }, { duration: 0.6, delay, ease: [POP, ease] })
  animate(icon, {
    boxShadow: ['0 0 0 0 rgba(200, 240, 49, 0)', '0 0 14px 3px rgba(200, 240, 49, 0.55)', '0 0 0 0 rgba(200, 240, 49, 0)'],
  }, { duration: 0.9, delay, ease: 'easeOut' })
  card.classList.add('is-live')
}

// ---------- the cancellable context ----------

const abortError = () => new DOMException('story cancelled', 'AbortError')
const isAbort = (e) => !!e && e.name === 'AbortError'

// ctx = {token, wait, run, cancel}. Every promise it hands out rejects with an AbortError the moment
// cancel() runs, so a cancelled cycle stops at its next await and never touches the DOM again.
function makeCtx() {
  const controls = new Set()
  const pending = new Set() // reject functions of the waits and runs in flight
  const ctx = {
    token: 0,
    wait(ms) {
      const t = ctx.token
      return new Promise((resolve, reject) => {
        let id = 0
        const kill = (e) => { clearTimeout(id); reject(e) }
        id = setTimeout(() => {
          pending.delete(kill)
          if (t !== ctx.token || isPaused()) reject(abortError())
          else resolve()
        }, ms)
        pending.add(kill)
      })
    },
    run(target, keyframes, options) {
      const t = ctx.token
      const c = animate(target, keyframes, options)
      controls.add(c)
      const p = new Promise((resolve, reject) => {
        pending.add(reject)
        const done = () => {
          pending.delete(reject)
          controls.delete(c)
          if (t === ctx.token) resolve()
          else reject(abortError())
        }
        Promise.resolve(c.finished).then(done, done)
      })
      p.catch(noop) // fire-and-forget runs must not surface as unhandled rejections
      return p
    },
    cancel() {
      ctx.token++
      for (const c of controls) { try { c.stop() } catch (e) { /* already gone */ } }
      controls.clear()
      const list = [...pending]
      pending.clear()
      for (const kill of list) kill(abortError())
    },
  }
  return ctx
}

// ---------- one monitor ----------

function player(el, makeCycle) {
  const node = el.closest('[data-node]')
  const article = el.closest('.project')
  const name = el.dataset.svc || el.dataset.story

  // Snapshot of the final state, taken before anything moves: every descendant's style and class
  // attributes, plus the text of the typed field and the counters.
  const snap = $$('*', el).map((n) => [n, n.getAttribute('style'), n.getAttribute('class')])
  const texts = $$('[data-typed], [data-count]', el).map((n) => [n, n.textContent])

  const ctx = makeCtx()
  const bar = progressBar(el)
  const stats = { name, cycles: 0, completed: 0, aborted: 0, active: 0, maxActive: 0, measured: 0 }

  let cycle = null // built lazily, while the DOM shows the final state (it measures that state)
  let armed = false
  let visible = false
  let dead = false
  let gen = 0 // bumped by every start and halt; a loop only continues while its generation is current
  let live = -1 // generation of the loop that is running, -1 when none
  let measured = 0 // ms of the last full cycle (0 until cycle 1 completes)
  let settleQueued = false
  let wantStart = false
  let dirty = false // a cycle has touched the DOM since the last settled restore

  const canRun = () => armed && visible && !dead && !isPaused() && !document.hidden

  function writeFinal() {
    el.classList.add('story-snap') // no CSS transitions: the final state lands in this frame
    for (const [n, style, cls] of snap) {
      if (n.getAttribute('style') !== style) style === null ? n.removeAttribute('style') : n.setAttribute('style', style)
      if (n.getAttribute('class') !== cls) cls === null ? n.removeAttribute('class') : n.setAttribute('class', cls)
    }
    for (const [n, text] of texts) if (n.textContent !== text) n.textContent = text
    bar.reset()
    void el.offsetWidth
    el.classList.remove('story-snap')
  }

  // Motion commits a stopped animation's value on its next frame, after this restore. Settle once that
  // render has run: write the final state again and drop Motion's cached values for these elements, so
  // the next cycle reads the real (final) DOM instead of stale numbers.
  function settle() {
    settleQueued = false
    if (live !== gen) {
      writeFinal()
      if (visualElementStore) {
        for (const [n] of snap) visualElementStore.delete(n)
        bar.forget()
      }
      dirty = false
    }
    if (wantStart) { wantStart = false; start() }
  }

  function setLive(on) {
    el.classList.toggle('is-playing', on)
    if (article) article.classList.toggle('is-demo-live', on)
  }

  function halt() {
    gen++
    live = -1
    wantStart = false
    if (!dirty) return // never played (or already restored): nothing to undo, no reflow
    ctx.cancel()
    setLive(false)
    writeFinal()
    if (!settleQueued) { settleQueued = true; frame.postRender(settle) }
  }

  function start() {
    if (!canRun()) return
    if (settleQueued) { wantStart = true; return } // a halt is settling: start right after it
    const g = ++gen
    live = g
    dirty = true
    loop(g)
  }

  async function loop(g) {
    if (!cycle) {
      try { cycle = makeCycle(el, ctx) } catch (e) { fail(e); return }
    }
    while (g === gen && canRun()) {
      setLive(true)
      const t0 = performance.now()
      bar.start(measured)
      stats.cycles++
      stats.active++
      stats.maxActive = Math.max(stats.maxActive, stats.active)
      try {
        await cycle()
      } catch (e) {
        if (isAbort(e)) { stats.aborted++; return }
        if (g === gen) fail(e)
        return
      } finally {
        stats.active--
      }
      if (g !== gen) return
      stats.completed++
      measured = stats.measured = performance.now() - t0
    }
    if (g === gen) halt()
  }

  function fail(e) {
    if (dead) return
    dead = true
    console.error(`[fx:stories] the "${name}" story stopped and shows its final state`, e)
    halt()
  }

  // click / tap: replay from the start (the global pause wins)
  el.addEventListener('click', () => {
    if (dead || isPaused() || !visible) return
    armed = true
    halt()
    start()
  })

  inView(el, () => {
    visible = true
    start()
    return () => { visible = false; halt() }
  }, { amount: 0.4 })

  return {
    el,
    node,
    stats,
    arm() { if (armed) return; armed = true; if (live !== gen) start() },
    halt,
    kick() { if (live !== gen) start() },
    remeasure() {
      const playing = live === gen
      if (playing) halt()
      cycle = null
      if (playing) start()
    },
  }
}

// The progress hairline: a faint track, a lime fill growing right to left, and a bright tip leading it.
function progressBar(el) {
  const bar = document.createElement('span')
  bar.className = 'story__progress'
  bar.setAttribute('aria-hidden', 'true')
  const fill = document.createElement('span')
  fill.className = 'story__progress-fill'
  const run = document.createElement('span')
  run.className = 'story__progress-run'
  const tip = document.createElement('span')
  tip.className = 'story__progress-tip'
  run.append(tip)
  bar.append(fill, run)
  el.append(bar)
  let anims = []
  const stop = () => { anims.forEach((a) => a.stop()); anims = [] }
  return {
    // ms = 0: cycle 1 is measuring itself, show the indeterminate seek (CSS)
    start(ms) {
      stop()
      if (!ms) { bar.classList.add('is-measuring'); return }
      bar.classList.remove('is-measuring')
      const o = { duration: ms / 1000, ease: 'linear' }
      anims = [
        animate(fill, { transform: ['scaleX(0)', 'scaleX(1)'] }, o),
        animate(run, { transform: ['translateX(0%)', 'translateX(-100%)'] }, o),
      ]
    },
    reset() {
      stop()
      bar.classList.remove('is-measuring')
      fill.removeAttribute('style')
      run.removeAttribute('style')
    },
    forget() {
      visualElementStore.delete(fill)
      visualElementStore.delete(run)
    },
  }
}

// ---------- the six stories (cycle logic and timings unchanged) ----------

const set = (ctx, el, values) => ctx.run(el, values, { duration: 0 })
const press = (ctx, el) => ctx.run(el, { scale: [1, 0.9, 1] }, { duration: 0.35 })

// CV arrives → gets read → summarised → matched to open roles
function cvStory(root, ctx) {
  const steps = $$('[data-step]', root)
  const fill = $('[data-steps-fill]', root)
  const stage = $('[data-cv-stage]', root)
  const doc = $('[data-doc]', root)
  const scan = $('[data-scan]', root)
  const points = $$('[data-point]', root)
  const matches = $$('[data-match]', root)
  const bars = $$('[data-bar]', root)
  const counts = $$('[data-count]', root)

  const toStep = (i) => {
    steps.forEach((s, j) => {
      s.classList.toggle('is-done', j < i)
      s.classList.toggle('is-active', j === i)
    })
    ctx.run(fill, { width: `${(i + 1) * 25}%` }, { duration: 0.5, ease })
  }

  return async () => {
    steps.forEach((s) => s.classList.remove('is-done', 'is-active'))
    set(ctx, fill, { width: '0%' })
    set(ctx, doc, { opacity: 0, y: -40, rotate: -8 })
    set(ctx, scan, { opacity: 0, y: 0 })
    set(ctx, points, { opacity: 0, x: 16 })
    set(ctx, bars, { width: '0%' })
    counts.forEach((c) => { c.textContent = '0%' })
    matches[0].classList.remove('is-top')
    ctx.run(stage, { opacity: 1 }, { duration: 0.3 })
    await ctx.wait(400)

    toStep(0)
    await ctx.run(doc, { opacity: 1, y: 0, rotate: 0 }, { duration: 0.7, ease })
    await ctx.wait(300)

    toStep(1)
    set(ctx, scan, { opacity: 1 })
    await ctx.run(scan, { y: [0, doc.offsetHeight - 2] }, { duration: 1.3, ease: 'easeInOut' })
    ctx.run(scan, { opacity: 0 }, { duration: 0.2 })

    toStep(2)
    await ctx.run(points, { opacity: 1, x: 0 }, { duration: 0.45, delay: stagger(0.3), ease })
    await ctx.wait(250)

    toStep(3)
    bars.forEach((bar, i) => ctx.run(bar, { width: bar.style.getPropertyValue('--v') }, { duration: 1.1, delay: i * 0.15, ease }))
    await Promise.all(counts.map((c, i) =>
      ctx.run(0, Number(c.dataset.count), { duration: 1.1, delay: i * 0.15, ease, onUpdate: (v) => { c.textContent = `${Math.round(v)}%` } })))

    steps.forEach((s) => { s.classList.add('is-done'); s.classList.remove('is-active') })
    matches[0].classList.add('is-top')
    ctx.run(matches[0], { scale: [1, 1.05, 1] }, { duration: 0.5 })
    await ctx.wait(2800)
    await ctx.run(stage, { opacity: 0 }, { duration: 0.4 })
  }
}

// A participant opens the portal and signs up for an activity
function portalStory(root, ctx) {
  const head = $('[data-portal-head]', root)
  const acts = $$('[data-act]', root)
  const signup = $('[data-signup]', root)
  const tap = $('[data-tap]', root)
  const toast = $('[data-toast]', root)

  return async () => {
    set(ctx, head, { opacity: 0, y: 8 })
    set(ctx, acts, { opacity: 0, y: 14 })
    signup.classList.remove('is-done')
    set(ctx, tap, { opacity: 0, scale: 0.6 })
    set(ctx, toast, { opacity: 0, y: 24 })
    await ctx.wait(300)

    ctx.run(head, { opacity: 1, y: 0 }, { duration: 0.5, ease })
    await ctx.run(acts, { opacity: 1, y: 0 }, { duration: 0.5, delay: stagger(0.12, { startDelay: 0.15 }), ease })
    await ctx.wait(500)

    // A finger moves onto the first "sign up" button and taps it
    tap.style.left = `${signup.offsetLeft + signup.offsetWidth / 2 - 18}px`
    tap.style.top = `${signup.offsetTop + signup.offsetHeight / 2 - 18}px`
    await ctx.run(tap, { opacity: 1, scale: 1, y: [36, 0] }, { duration: 0.6, ease })
    await ctx.wait(250)
    press(ctx, signup)
    await ctx.run(tap, { scale: [1, 0.8, 1.7], opacity: [1, 1, 0] }, { duration: 0.6 })
    signup.classList.add('is-done')
    await ctx.wait(500)

    await ctx.run(toast, { opacity: 1, y: 0 }, { duration: 0.5, ease })
    await ctx.wait(2600)
    await ctx.run([head, ...acts, toast], { opacity: 0 }, { duration: 0.4 })
  }
}

// An employee opens a request, sends it, and follows its status to done
function ticketsStory(root, ctx) {
  const head = $('[data-head]', root)
  const list = $('[data-list]', root)
  const newBtn = $('[data-new-btn]', root)
  const form = $('[data-form]', root)
  const typed = $('[data-typed]', root)
  const chip = $('[data-chip]', root)
  const send = $('[data-send]', root)
  const row = $('[data-ticket-new]', root)
  const status = $('[data-status]', root)
  const subject = typed.textContent
  const rowHeight = row.offsetHeight
  const setStatus = (name) => {
    status.className = `status status--${name}`
    ctx.run(status, { scale: [0.7, 1] }, { duration: 0.35, ease })
  }

  return async () => {
    set(ctx, form, { opacity: 0, y: -10 })
    form.style.visibility = 'hidden'
    typed.textContent = ''
    set(ctx, chip, { opacity: 0, scale: 0.6 })
    set(ctx, row, { height: 0, opacity: 0, paddingTop: 0, paddingBottom: 0, marginBottom: -9 })
    status.className = 'status status--new'
    ctx.run([head, list], { opacity: 1 }, { duration: 0.3 })
    await ctx.wait(600)

    await press(ctx, newBtn)
    form.style.visibility = 'visible'
    await ctx.run(form, { opacity: 1, y: 0 }, { duration: 0.4, ease })
    for (const ch of subject) {
      typed.textContent += ch
      await ctx.wait(65)
    }
    await ctx.run(chip, { opacity: 1, scale: 1 }, { duration: 0.35, ease })
    await ctx.wait(300)
    await press(ctx, send)

    ctx.run(form, { opacity: 0, y: -10 }, { duration: 0.35 }).then(() => { form.style.visibility = 'hidden' }, noop)
    await ctx.run(row, { height: rowHeight, opacity: 1, paddingTop: 10, paddingBottom: 10, marginBottom: 0 }, { duration: 0.5, ease })
    await ctx.wait(1000)
    setStatus('progress')
    await ctx.wait(1300)
    setStatus('done')
    await ctx.wait(2600)
    await ctx.run([head, list], { opacity: 0 }, { duration: 0.4 })
  }
}

// AI: document lines flow into the spark and come out as a short summary
function aiStory(root, ctx) {
  const doc = $('[data-doc-lines]', root)
  const lines = $$('i', doc)
  const spark = $('[data-spark]', root)
  const check = $('[data-sum-check]', root)
  const sum = $$('[data-sum-line]', root)
  const widths = sum.map((el) => el.offsetWidth)
  const noGlow = '0 0 0 0 rgba(200,240,49,0), 0 0 0 0 rgba(200,240,49,0)'
  const glow = '0 0 0 10px rgba(200,240,49,0.18), 0 0 30px 6px rgba(200,240,49,0.35)'

  return async () => {
    const travel = doc.offsetLeft - spark.offsetLeft
    set(ctx, lines, { x: 0, opacity: 0 })
    set(ctx, sum, { width: 0, opacity: 1 })
    set(ctx, check, { scale: 0, opacity: 0 })
    await ctx.run(lines, { opacity: 1 }, { duration: 0.4, delay: stagger(0.06) })
    await ctx.wait(400)

    ctx.run(lines, { x: -travel, opacity: 0 }, { duration: 0.7, delay: stagger(0.1), ease: [0.55, 0, 0.75, 0.25] })
    await ctx.wait(650)
    ctx.run(spark, { scale: [1, 1.25, 1], rotate: [0, 90] }, { duration: 0.8, ease })
    await ctx.run(spark, { boxShadow: [noGlow, glow, noGlow] }, { duration: 1 })

    await ctx.run(sum[0], { width: [0, widths[0]] }, { duration: 0.45, ease })
    await ctx.run(sum[1], { width: [0, widths[1]] }, { duration: 0.35, ease })
    await ctx.run(check, { scale: [0, 1.2, 1], opacity: 1 }, { duration: 0.45, ease })
    await ctx.wait(1700)
    await ctx.run([...sum, check], { opacity: 0 }, { duration: 0.4 })
  }
}

// Automations: a dot runs from the form, through the automation, to the update
function autoStory(root, ctx) {
  const track = $('[data-track]', root)
  const fill = $('[data-track-fill]', root)
  const dot = $('[data-dot]', root)
  const nodes = $$('[data-auto-node]', root)
  const reach = (node) => {
    node.classList.add('is-on')
    ctx.run(node.firstElementChild, { scale: [1, 1.15, 1] }, { duration: 0.4 })
  }

  return async () => {
    const len = track.offsetWidth
    nodes.forEach((n) => n.classList.remove('is-on'))
    set(ctx, fill, { width: '0%' })
    set(ctx, dot, { x: len, opacity: 0 })
    await ctx.wait(300)

    reach(nodes[0])
    await ctx.run(dot, { opacity: 1 }, { duration: 0.25 })
    ctx.run(fill, { width: '50%' }, { duration: 1, ease: 'easeInOut' })
    await ctx.run(dot, { x: len / 2 }, { duration: 1, ease: 'easeInOut' })
    reach(nodes[1])
    await ctx.wait(300)
    ctx.run(fill, { width: '100%' }, { duration: 1, ease: 'easeInOut' })
    await ctx.run(dot, { x: 0 }, { duration: 1, ease: 'easeInOut' })
    reach(nodes[2])
    await ctx.run(dot, { opacity: 0 }, { duration: 0.3 })
    await ctx.wait(1600)
  }
}

// CRM: a lead moves through the pipeline and becomes a client
function crmStory(root, ctx) {
  const lead = $('[data-lead]', root)
  const won = $('[data-won]', root)
  const cols = $$('[data-col]', root)
  const pipe = cols[0].parentElement
  const move = (x) => ctx.run(lead, { x }, { duration: 0.7, ease: [0.65, 0, 0.35, 1] })

  return async () => {
    // Column centres relative to where the card sits in the markup (the last column)
    const base = lead.offsetLeft + lead.offsetWidth / 2
    const dx = cols.map((c) => pipe.offsetLeft + c.offsetLeft + c.offsetWidth / 2 - base)
    lead.classList.add('is-pending')
    set(ctx, won, { scale: 0, opacity: 0 })
    set(ctx, lead, { x: dx[0], y: 10, opacity: 0 })
    await ctx.run(lead, { y: 0, opacity: 1 }, { duration: 0.4, ease })
    await ctx.wait(700)

    await move(dx[1])
    await ctx.wait(800)
    await move(dx[2])
    lead.classList.remove('is-pending')
    await ctx.run(won, { scale: [0, 1.25, 1], opacity: 1 }, { duration: 0.45, ease })
    await ctx.wait(1700)
    await ctx.run(lead, { opacity: 0 }, { duration: 0.4 })
  }
}
