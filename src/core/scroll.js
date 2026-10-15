// core/scroll.js: programmatic scrolling that respects reduced motion and the sticky nav.
// scrollToY(y): absolute document y. scrollToEl(el, {focus, offset}): el's top lands below the nav
// (offset defaults to --nav-h + 16px, the same as the CSS scroll-margin-top on [id]).
// Smooth only under html.motion-ok; otherwise an instant jump.
//
// Anchor routing (for targets a pinned stage moves, which the browser's fragment scroll cannot reach):
//   registerTarget(el, resolveY) -> unregister. resolveY(target) returns the document y to scroll to
//     (e.g. gallery: galleryTop + p_i * D for panel i; keyhole: the y where p = .9 for #talks).
//     A resolver on an ancestor also covers its descendants' ids.
//   Same-page links (a[href^="#"]), hashchange and a hash present at load are routed through it ONLY
//   when the target has a resolver: preventDefault, scrollToY(resolved y), history.pushState(hash),
//   .is-arrived on the target for 1.6s (the arrival pulse; pushState sets no :target), and focus
//   (tabindex -1, preventScroll). Every other link keeps native fragment navigation (:target pulse).
//   landHash() (main.js calls it once the page has settled) re-lands a load-time hash exactly, unless
//   the visitor has already scrolled.

const root = document.documentElement

const smooth = () => root.classList.contains('motion-ok')

export function navH() {
  return parseFloat(getComputedStyle(root).getPropertyValue('--nav-h')) || 0
}

/** Absolute document y. Smooth under motion-ok unless {instant: true} (which also overrides CSS smooth). */
export function scrollToY(y, { instant = false } = {}) {
  const top = Math.max(0, Math.round(y))
  if (smooth() && !instant) { window.scrollTo({ top, behavior: 'smooth' }); return }
  try { window.scrollTo({ top, behavior: 'instant' }) } catch (e) { window.scrollTo(0, top) }
}

export function scrollToEl(el, { focus = false, offset } = {}) {
  if (!el) return
  const off = offset ?? navH() + 16
  scrollToY(el.getBoundingClientRect().top + window.scrollY - off)
  if (focus) focusEl(el)
}

function focusEl(el) {
  if (!el.matches('a[href], button, input, select, textarea, [tabindex]')) el.setAttribute('tabindex', '-1')
  el.focus({ preventScroll: true })
}

// ---------- anchor routing ----------
const resolvers = new Map()

/** Route jumps to `el` (and ids inside it) through resolveY(target). Returns an unregister function. */
export function registerTarget(el, resolveY) {
  if (!el || typeof resolveY !== 'function') return () => {}
  resolvers.set(el, resolveY)
  return () => { if (resolvers.get(el) === resolveY) resolvers.delete(el) }
}

function resolverFor(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const r = resolvers.get(n)
    if (r) return r
  }
  return null
}

/** The document y a jump to `el` lands on: its resolver's answer, else its top below the nav. */
export function targetY(el) {
  const r = resolverFor(el)
  const y = r ? r(el) : NaN
  return Number.isFinite(y) ? y : el.getBoundingClientRect().top + window.scrollY - navH() - 16
}

let arrivedTimer = 0
function markArrived(el) {
  document.querySelectorAll('.is-arrived').forEach((n) => n.classList.remove('is-arrived'))
  void el.offsetWidth // restart the pulse
  el.classList.add('is-arrived')
  clearTimeout(arrivedTimer)
  arrivedTimer = setTimeout(() => el.classList.remove('is-arrived'), 1600)
}

/** Jump to a routed target: scroll, record the hash, pulse, focus. */
export function goTo(el, { push = true, focus = true, instant = false } = {}) {
  if (!el) return
  scrollToY(targetY(el), { instant })
  if (push && el.id && location.hash !== `#${el.id}`) history.pushState(null, '', `#${el.id}`)
  markArrived(el)
  if (focus) focusEl(el)
}

function hashTarget(hash = location.hash) {
  if (!hash || hash.length < 2) return null
  let id = hash.slice(1)
  try { id = decodeURIComponent(id) } catch (e) { /* keep raw */ }
  return document.getElementById(id)
}

let userMoved = false
let anchorsOn = false

/** Wire the delegated click + hashchange routing. Idempotent. */
export function initAnchors() {
  if (anchorsOn) return
  anchorsOn = true
  const moved = () => { userMoved = true }
  for (const t of ['wheel', 'touchstart', 'keydown', 'pointerdown']) addEventListener(t, moved, { once: true, passive: true })

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = e.target.closest && e.target.closest('a[href^="#"]')
    if (!a) return
    const el = hashTarget(a.hash)
    if (!el || !resolverFor(el)) return // native fragment navigation
    e.preventDefault()
    goTo(el)
  })
  addEventListener('hashchange', () => {
    const el = hashTarget()
    if (el && resolverFor(el)) goTo(el, { push: false })
  })
}

/** Once the page has settled (load + fonts): land a load-time hash exactly, unless the visitor moved. */
export function landHash() {
  const el = hashTarget()
  if (!el || userMoved) return
  const y = Math.max(0, Math.round(targetY(el)))
  if (resolverFor(el)) { goTo(el, { push: false, focus: false, instant: true }); return }
  if (Math.abs(window.scrollY - y) > 2) scrollToY(y, { instant: true })
}
