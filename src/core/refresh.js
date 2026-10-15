// core/refresh.js: one shared "layout may have moved" signal, batched into a single rAF.
// onRefresh(cb) subscribes (cb(reason) runs on the next frame too) and returns an unsubscribe.
// Triggers: document.fonts.ready + later font loads, window load, any <img> load inside <main>,
// width-changing resizes (debounced 150ms; height-only changes such as mobile toolbars are ignored),
// and a ResizeObserver on <main> (debounced 150ms). Call requestRefresh() after you change layout.

const subs = new Set()
let scheduled = false
let reason = ''
let started = false

function run() {
  scheduled = false
  const r = reason
  for (const cb of [...subs]) {
    try { cb(r) } catch (e) { console.error('[refresh]', e) }
  }
}

export function requestRefresh(why = 'manual') {
  reason = why
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(run)
}

const debounce = (fn, ms) => {
  let t = 0
  return () => { clearTimeout(t); t = setTimeout(fn, ms) }
}

function start() {
  if (started) return
  started = true
  const fonts = document.fonts
  if (fonts) {
    fonts.ready.then(() => requestRefresh('fonts'))
    if (fonts.addEventListener) fonts.addEventListener('loadingdone', () => requestRefresh('fonts'))
  }
  if (document.readyState !== 'complete') {
    window.addEventListener('load', () => requestRefresh('load'), { once: true })
  }
  const main = document.querySelector('main') || document.body
  main.addEventListener('load', (e) => { if (e.target && e.target.tagName === 'IMG') requestRefresh('image') }, true)

  let lastW = window.innerWidth
  window.addEventListener('resize', debounce(() => {
    if (window.innerWidth === lastW) return
    lastW = window.innerWidth
    requestRefresh('resize')
  }, 150), { passive: true })

  if ('ResizeObserver' in window) {
    new ResizeObserver(debounce(() => requestRefresh('layout'), 150)).observe(main)
  }
}

export function onRefresh(cb) {
  start()
  subs.add(cb)
  requestRefresh('subscribe')
  return () => subs.delete(cb)
}
