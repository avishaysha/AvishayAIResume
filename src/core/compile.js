// core/compile.js: the COMPILE grammar. Thin "idea" type (wght 300) becomes heavy "system" type (--cw, 900).
// compile(el, {instant}) / decompile(el, {instant}) only toggle classes; the motion is CSS (style.css,
// "Compile contract"): per-char font-weight + colour transitions staggered by --i * 32ms.
//   .is-compiled  final state      .is-idea  explicit idea state (set by decompile)
//   .no-anim      kills the transitions for one synchronous style flush (instant changes)
// Idea states before the first compile are gated in CSS on the owning package's html.fx-<id> class
// (or html.ignite for the h1), so a stubbed or failed package can never leave text thin.
// compile() returns the expected duration in ms (0 when instant).

import { split } from './split.js'

const STAGGER = 32
const TAIL = 750 // max(weight .7s, colour .3s delay + .45s)

const flush = (el) => void el.offsetWidth

export function compileDuration(count) {
  return count > 0 ? (count - 1) * STAGGER + TAIL : 0
}

export function compile(el, { instant = false } = {}) {
  if (!el) return 0
  const fresh = !el.dataset.split
  const { count } = split(el)
  if (instant) {
    el.classList.add('no-anim')
    el.classList.remove('is-idea')
    el.classList.add('is-compiled')
    flush(el)
    el.classList.remove('no-anim')
    return 0
  }
  // Freshly created .ch spans need a computed "before" style, otherwise no transition runs.
  if (fresh) flush(el)
  el.classList.remove('is-idea')
  el.classList.add('is-compiled')
  return compileDuration(count)
}

export function decompile(el, { instant = false } = {}) {
  if (!el) return 0
  const { count } = split(el)
  if (instant) el.classList.add('no-anim')
  el.classList.remove('is-compiled')
  el.classList.add('is-idea')
  if (instant) { flush(el); el.classList.remove('no-anim'); return 0 }
  return compileDuration(count)
}
