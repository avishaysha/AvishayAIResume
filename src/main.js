// main.js: foundation wiring. The page is complete and static without any of this; each package in
// src/fx/ only adds motion. A package that throws (sync or async) is switched off on its own:
// its html.fx-<id> class is removed, so its hidden/idea initial states fall back to the final page.
import './style.css'
import { initPauseToggle } from './core/state.js'
import { initAnchors, landHash } from './core/scroll.js'
import { EVT } from './core/flow.js'
import * as chrome from './fx/chrome.js'
import * as stories from './fx/stories.js'
import * as thread from './fx/thread.js'
import * as ignition from './fx/ignition.js'
import * as intake from './fx/intake.js'
import * as gallery from './fx/gallery.js'
import * as keyhole from './fx/keyhole.js'
import * as finale from './fx/finale.js'

const root = document.documentElement

function fail(id, e) {
  console.error(`[fx:${id}] failed, falling back to the static page`, e)
  root.classList.remove(`fx-${id}`)
  if (id === 'ignition') root.classList.remove('ignite')
  // a package may have decompiled text (replay, reset) before throwing: never leave it thin
  document.querySelectorAll('[data-compile].is-idea').forEach((el) => el.classList.remove('is-idea'))
  if (id === 'thread') {
    // the run is off: flowState() reads 'off' and pending onArrive listeners fall back to inView
    delete root.dataset.flow
    document.dispatchEvent(new CustomEvent(EVT.OFF))
  }
}

initPauseToggle()
initAnchors()

// Order matters: stories registers arrival listeners before thread dispatches;
// thread listens for ignite:done before ignition fires it.
const packages = [
  ['chrome', chrome],
  ['stories', stories],
  ['thread', thread],
  ['ignition', ignition],
  ['intake', intake],
  ['gallery', gallery],
  ['keyhole', keyhole],
  ['finale', finale],
]
for (const [id, m] of packages) {
  try { Promise.resolve(m.init()).catch((e) => fail(id, e)) } catch (e) { fail(id, e) }
}

// html.ignite (first visit) paints the h1 in its idea state. Only the ignition package may keep it:
// if it did not claim the headline (stub, early return), or never finishes, show the final headline.
if (!root.classList.contains('fx-ignition')) root.classList.remove('ignite')
setTimeout(() => root.classList.remove('ignite'), 4000)

// Without motion the contact section is the finished, full-bleed lime state.
if (!root.classList.contains('motion-ok')) document.getElementById('contact')?.setAttribute('data-theme', 'lime')

// Once the page has settled (load + webfonts): land a load-time #hash exactly (fonts can shift the
// page after the browser's own fragment jump), then allow CSS smooth scrolling for in-page links.
// Until then a deep link jumps instantly instead of animating through the whole page.
const loaded = document.readyState === 'complete'
  ? Promise.resolve()
  : new Promise((r) => addEventListener('load', r, { once: true }))
let settled = false
const settle = () => {
  if (settled) return
  settled = true
  requestAnimationFrame(() => {
    landHash()
    root.classList.add('smooth-ok')
  })
}
loaded.then(() => (document.fonts ? document.fonts.ready : null)).then(settle, settle)
setTimeout(settle, 5000) // a stalled load never leaves smooth scrolling off for good

root.classList.add('js-ready')
