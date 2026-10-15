// core/fonts.js: fontsReady(spec, text, timeoutMs) -> Promise<boolean>.
// true only when a real face matching `spec` is loaded for `text` within the timeout.
// (document.fonts.check alone returns true when NO face matches, e.g. if Google Fonts failed,
// so we also require load() to have returned at least one face.)

export function fontsReady(spec = '900 1em Rubik', text = 'א', timeoutMs = 700) {
  const fonts = document.fonts
  if (!fonts || typeof fonts.load !== 'function') return Promise.resolve(false)
  let timer
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs) })
  const load = fonts.load(spec, text)
    .then((faces) => faces.length > 0 && fonts.check(spec, text))
    .catch(() => false)
  return Promise.race([load, timeout]).finally(() => clearTimeout(timer))
}
