// core/split.js: split(el, {by: 'chars' | 'words'}) for per-glyph CSS (the compile morph).
// - Idempotent: a second call returns the existing spans (el[data-split]).
// - A11y: prepends span.sr-only with the element's accessible text and marks the visual copy
//   aria-hidden. If el already has a direct .sr-only child (e.g. p.sig), that one is kept instead.
//   If el is itself inside [aria-hidden=true], no sr-only copy is made.
// - Words become span.w (white-space: nowrap). In 'chars' mode every glyph becomes span.ch with
//   style --i = continuous index across the whole element (spaces are not counted); el gets --n.
// - Runs of Latin letters/digits (with punctuation strictly between them, e.g. "050-923", "co.il")
//   are wrapped in span[dir=ltr] so they keep their order inside RTL text.
// - Existing element children (.period, .line, .sr-only, svg...) stay in place; only text nodes change.
//   Hebrew has no joining, so per-char spans never break shaping.

const LTR_RUN = /[A-Za-z0-9]+(?:[^\sA-Za-z0-9֐-׿]+[A-Za-z0-9]+)*/g
const SKIP = '.sr-only, [data-nosplit], svg, .w, .ch'

function accessibleText(node) {
  let out = ''
  for (const n of node.childNodes) {
    if (n.nodeType === 3) out += n.data
    else if (n.nodeType === 1) {
      if (n.getAttribute('aria-hidden') === 'true' || n.tagName === 'svg') continue
      if (n.tagName === 'BR') { out += ' '; continue }
      out += accessibleText(n)
    }
  }
  return out
}

function result(el) {
  return {
    el,
    words: [...el.querySelectorAll('.w')],
    chars: [...el.querySelectorAll('.ch')],
    count: Number(el.style.getPropertyValue('--n')) || 0,
  }
}

export function split(el, { by = 'chars' } = {}) {
  if (!el) return null
  if (el.dataset.split) return result(el)

  const inHidden = !!el.closest('[aria-hidden="true"]')
  const hasSr = [...el.children].some((c) => c.classList.contains('sr-only'))
  const addSr = !inHidden && !hasSr
  const chars = by === 'chars'
  let i = 0

  const mkChar = (c) => {
    const s = document.createElement('span')
    s.className = 'ch'
    s.style.setProperty('--i', i++)
    s.textContent = c
    return s
  }
  const fillWord = (w, word) => {
    if (!chars) { w.textContent = word; w.style.setProperty('--i', i++); return }
    let last = 0
    for (const m of word.matchAll(LTR_RUN)) {
      for (const c of word.slice(last, m.index)) w.append(mkChar(c))
      const ltr = document.createElement('span')
      ltr.dir = 'ltr'
      for (const c of m[0]) ltr.append(mkChar(c))
      w.append(ltr)
      last = m.index + m[0].length
    }
    for (const c of word.slice(last)) w.append(mkChar(c))
  }
  const words = (text) => {
    const frag = document.createDocumentFragment()
    for (const part of text.split(/(\s+)/)) {
      if (!part) continue
      if (/^\s+$/.test(part)) { frag.append(' '); continue }
      const w = document.createElement('span')
      w.className = 'w'
      fillWord(w, part)
      frag.append(w)
    }
    return frag
  }
  const walk = (parent) => {
    for (const n of [...parent.childNodes]) {
      if (n.nodeType === 3) { if (n.data.trim()) n.replaceWith(words(n.data)) }
      else if (n.nodeType === 1 && !n.matches(SKIP)) walk(n)
    }
  }

  const srText = addSr ? accessibleText(el).replace(/\s+/g, ' ').trim() : ''
  for (const n of [...el.childNodes]) {
    if (n.nodeType === 3) {
      if (!n.data.trim()) continue
      const vis = document.createElement('span')
      vis.className = 'split__vis'
      if (addSr) vis.setAttribute('aria-hidden', 'true')
      vis.append(words(n.data))
      n.replaceWith(vis)
    } else if (n.nodeType === 1 && !n.matches('.sr-only')) {
      if (addSr) n.setAttribute('aria-hidden', 'true')
      if (!n.matches(SKIP)) walk(n)
    }
  }
  if (addSr) {
    const sr = document.createElement('span')
    sr.className = 'sr-only'
    sr.dataset.splitSr = ''
    sr.textContent = srText
    el.prepend(sr)
  }
  el.dataset.split = by
  el.style.setProperty('--n', i)
  return result(el)
}
