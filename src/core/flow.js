// core/flow.js: the run's event bus. Thread (the packet) calls arrive(node); every other package
// listens with onArrive(node, cb), which also works when the thread is off or broken:
//   flow 'on'      html[data-flow=on]: wait for the real arrival; fallback timer after fallbackDelay in view
//   flow 'pending' thread claimed the run (html.fx-thread, motion ok) but has not built yet: same as 'on'
//   flow 'off'     no thread / reduced motion: fire as soon as the node is in view (amount .3)
// Arrival latches node[data-arrived="1"]; arrive() is idempotent (a second call is ignored and returns false).
// On 'run:reset' every data-arrived is cleared (listeners registered with onArrive are one-shot).
// If the thread fails after claiming the run, main.js removes html.fx-thread and html[data-flow] and
// dispatches 'flow:off' on document: pending listeners whose node is already in view fire at once
// (fallback 'inview'), the rest fall back to inView like any flow-off page.

import { inView } from 'motion'

const root = document.documentElement

export const EVT = {
  ARRIVE: 'flow:arrive',
  IGNITE_DONE: 'ignite:done',
  RESET: 'run:reset',
  PAUSE: 'motion:pause',
  THEME: 'theme:change',
  OFF: 'flow:off',
}

const idOf = (node) => node.dataset.node || node.id || ''

/** True once the thread has built the circuit (html[data-flow=on]) and is still running (html.fx-thread). */
export function flowOn() {
  return root.dataset.flow === 'on' && root.classList.contains('fx-thread')
}

/** 'on' | 'pending' | 'off' (see header). */
export function flowState() {
  if (flowOn()) return 'on'
  if (root.classList.contains('fx-thread') && root.classList.contains('motion-ok')) return 'pending'
  return 'off'
}

/**
 * Latch and announce an arrival. detail: {silent?, x?, y?, ...}; id and t are filled in.
 * Dispatches a bubbling 'flow:arrive' CustomEvent on the node. Returns false if already arrived.
 */
export function arrive(node, detail = {}) {
  if (!node || node.dataset.arrived === '1') return false
  node.dataset.arrived = '1'
  node.dispatchEvent(new CustomEvent(EVT.ARRIVE, {
    bubbles: true,
    detail: { id: idOf(node), node, t: performance.now(), silent: false, ...detail },
  }))
  return true
}

/**
 * cb(detail) exactly once, when `node` arrives (or via the fallbacks above).
 * detail.fallback is 'latched' | 'inview' | 'timer' when it did not come from a real arrive().
 * Options: fallback (timer fallback while flow is on/pending, default true), fallbackDelay (ms in view,
 * default 1500), amount (inView threshold, default .3). Returns a cancel function.
 */
export function onArrive(node, cb, { fallback = true, fallbackDelay = 1500, amount = 0.3 } = {}) {
  if (!node) return () => {}
  const base = () => ({ id: idOf(node), node, t: performance.now(), silent: true })
  if (node.dataset.arrived === '1') { cb({ ...base(), fallback: 'latched' }); return () => {} }

  let done = false
  let timer = 0
  let stopView = null
  let inViewNow = false
  const cleanup = () => {
    node.removeEventListener(EVT.ARRIVE, onEvt)
    document.removeEventListener(EVT.OFF, onOff)
    clearTimeout(timer)
    if (stopView) stopView()
  }
  const fire = (detail) => {
    if (done) return
    done = true
    cleanup()
    cb(detail)
  }
  function onEvt(e) { if (e.target === node) fire(e.detail) }
  function onOff() { if (inViewNow) fire({ ...base(), fallback: 'inview' }) }
  node.addEventListener(EVT.ARRIVE, onEvt)
  document.addEventListener(EVT.OFF, onOff)

  stopView = inView(node, () => {
    inViewNow = true
    if (flowState() === 'off') { fire({ ...base(), fallback: 'inview' }); return }
    if (fallback) timer = setTimeout(() => fire({ ...base(), fallback: 'timer' }), fallbackDelay)
    return () => { inViewNow = false; clearTimeout(timer) }
  }, { amount })

  return () => { done = true; cleanup() }
}

document.addEventListener(EVT.RESET, () => {
  document.querySelectorAll('[data-arrived]').forEach((n) => { delete n.dataset.arrived })
})
