// core/env.js: environment facts shared by every package.
// motionOk / saveData are fixed for the page's life. isMobile / finePointer are LIVE bindings:
// importers always read the current value (ES modules re-export the updated `let`).
// tier() buckets the device for GPU budgets: 'high' | 'mid' | 'low'.

const root = document.documentElement
const mm = (q) => window.matchMedia(q)

/** Motion allowed (html.motion-ok, set by the head script unless prefers-reduced-motion). */
export const motionOk = root.classList.contains('motion-ok')

/** navigator.connection.saveData, false when unknown. */
export const saveData = !!(navigator.connection && navigator.connection.saveData)

/** MediaQueryLists, exported so packages can listen for changes themselves. */
export const mqMobile = mm('(max-width: 768px)')
export const mqFinePointer = mm('(hover: hover) and (pointer: fine)')

/** Viewport is 768px wide or less (live). */
export let isMobile = mqMobile.matches
/** Primary input can hover and is precise (live). */
export let finePointer = mqFinePointer.matches

mqMobile.addEventListener('change', (e) => { isMobile = e.matches })
mqFinePointer.addEventListener('change', (e) => { finePointer = e.matches })

/**
 * Device tier for particle counts and DPR caps.
 * low:  <= 4 cores, <= 4GB memory, or Save-Data
 * high: fine pointer and >= 8 cores
 * mid:  everything else
 */
export function tier() {
  const cores = navigator.hardwareConcurrency || 4
  const mem = navigator.deviceMemory || 8
  if (saveData || cores <= 4 || mem <= 4) return 'low'
  if (finePointer && cores >= 8) return 'high'
  return 'mid'
}
