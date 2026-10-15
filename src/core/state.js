// core/state.js: the global "pause all motion" state (WCAG 2.2.2).
// Source of truth is html.is-paused (the head script restores it from localStorage before first paint).
// setPaused() persists it, syncs every [data-pause-toggle] and dispatches 'motion:pause' {paused} on document.
// ARIA: the toggle keeps ONE fixed label ("עצירת אנימציות") and aria-pressed alone carries the state, so a
// screen reader hears "עצירת אנימציות, toggle button, pressed" = paused. (Swapping the label as well would
// announce a pressed "play" button, which contradicts itself.) The pause/play icon swap is CSS only.

const root = document.documentElement
const KEY = 'motion-paused'
const EVT_PAUSE = 'motion:pause'

export function isPaused() {
  return root.classList.contains('is-paused')
}

function syncToggles(paused) {
  document.querySelectorAll('[data-pause-toggle]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(paused))
  })
}

export function setPaused(paused) {
  paused = !!paused
  if (paused === isPaused()) { syncToggles(paused); return }
  root.classList.toggle('is-paused', paused)
  try { localStorage.setItem(KEY, paused ? '1' : '0') } catch (e) { /* storage blocked: session-only */ }
  syncToggles(paused)
  document.dispatchEvent(new CustomEvent(EVT_PAUSE, { detail: { paused } }))
}

/** cb(paused) on every change. Returns an unsubscribe function. */
export function onPause(cb) {
  const h = (e) => cb(e.detail.paused)
  document.addEventListener(EVT_PAUSE, h)
  return () => document.removeEventListener(EVT_PAUSE, h)
}

/** Resolves immediately when running, otherwise on the next un-pause. */
export function whenRunning() {
  if (!isPaused()) return Promise.resolve()
  return new Promise((resolve) => {
    const off = onPause((paused) => { if (!paused) { off(); resolve() } })
  })
}

/** Wires every [data-pause-toggle] button (click toggles) and syncs their initial ARIA state. */
export function initPauseToggle() {
  syncToggles(isPaused())
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-pause-toggle]')
    if (btn) setPaused(!isPaused())
  })
}
