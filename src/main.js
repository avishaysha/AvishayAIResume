import './style.css'
import { animate, inView, scroll, stagger } from 'motion'

const motionOk = document.documentElement.classList.contains('motion-ok')
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches
const ease = [0.22, 1, 0.36, 1]
const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

// Nav turns solid after scrolling a bit
const nav = $('[data-nav]')
const updateNav = () => nav.classList.toggle('is-scrolled', window.scrollY > 16)
updateNav()
window.addEventListener('scroll', updateNav, { passive: true })

if (motionOk) {
  // ---------- Hero intro ----------
  animate($$('.hero__title .w > span'), { y: ['110%', '0%'] }, { duration: 0.9, delay: stagger(0.1, { startDelay: 0.15 }), ease })
  animate($$('[data-hero-item]'), { opacity: [0, 1], y: [24, 0] }, { duration: 0.8, delay: stagger(0.1, { startDelay: 0.05 }), ease })
  animate('[data-hero-visual]', { opacity: [0, 1], scale: [0.92, 1] }, { duration: 1.1, delay: 0.3, ease })

  // Photo leans toward the pointer
  if (finePointer) {
    const hero = $('[data-hero]')
    const photo = $('[data-photo]')
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect()
      const dx = (e.clientX - r.left) / r.width - 0.5
      const dy = (e.clientY - r.top) / r.height - 0.5
      animate(photo, { rotateY: dx * 10, rotateX: -dy * 8 }, { duration: 0.6, ease })
    })
    hero.addEventListener('pointerleave', () => {
      animate(photo, { rotateY: 0, rotateX: 0 }, { duration: 0.8, ease })
    })
  }

  // ---------- Reveal sections on scroll ----------
  inView('[data-reveal-group]', (group) => {
    animate($$('[data-reveal]', group), { opacity: [0, 1], y: [32, 0] }, { duration: 0.8, delay: stagger(0.1), ease })
  }, { amount: 0.25 })

  inView('[data-reveal-card]', (card) => {
    animate(card, { opacity: [0, 1], y: [48, 0], scale: [0.97, 1] }, { duration: 0.9, ease })
  }, { amount: 0.2 })

  // Lecture photo wipes in from the right, then settles from a slight zoom.
  // Observe the section, not the photo: a fully clipped element never counts as visible.
  inView('.talk', (talk) => {
    const media = $('[data-talk-media]', talk)
    animate(media, { clipPath: ['inset(0 0 0 100%)', 'inset(0 0 0 0%)'] }, { duration: 1.2, ease })
    animate($('img', media), { scale: [1.18, 1] }, { duration: 1.6, ease })
  }, { amount: 0.3 })

  inView('[data-contact]', (el) => {
    animate(el, { opacity: [0, 1], scale: [0.94, 1], y: [40, 0] }, { duration: 0.9, ease })
  }, { amount: 0.3 })

  // Event-it screenshot drifts inside its browser frame while scrolling
  const frame = $('[data-parallax-frame]')
  scroll(animate('[data-parallax]', { y: ['0%', '-10.7%'] }, { ease: 'linear' }), {
    target: frame,
    offset: ['start end', 'end start'],
  })

  // Project stories: each mini UI acts out the product, looping while it is on screen
  playWhileVisible($('[data-story="cv"]'), cvStory)
  playWhileVisible($('[data-story="portal"]'), portalStory)
  playWhileVisible($('[data-story="tickets"]'), ticketsStory)

  // Cards tilt slightly under the pointer
  if (finePointer) {
    $$('[data-reveal-card]').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect()
        const dx = (e.clientX - r.left) / r.width - 0.5
        const dy = (e.clientY - r.top) / r.height - 0.5
        animate(card, { rotateY: dx * 4, rotateX: -dy * 4, transformPerspective: 1200 }, { duration: 0.5, ease })
      })
      card.addEventListener('pointerleave', () => {
        animate(card, { rotateY: 0, rotateX: 0 }, { duration: 0.7, ease })
      })
    })
  }
}

// ---------- Project stories ----------
// The markup holds each story's final state (what reduced-motion visitors see);
// every cycle resets to the start and plays through to that state again.
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const set = (el, values) => animate(el, values, { duration: 0 })
const press = (el) => animate(el, { scale: [1, 0.9, 1] }, { duration: 0.35 })

function playWhileVisible(root, makeCycle) {
  const cycle = makeCycle(root)
  let visible = false
  let running = false
  const loop = async () => {
    running = true
    while (visible) await cycle()
    running = false
  }
  inView(root, () => {
    visible = true
    if (!running) loop()
    return () => { visible = false }
  }, { amount: 0.4 })
}

// CV arrives → gets read → summarised → matched to open roles
function cvStory(root) {
  const steps = $$('[data-step]', root)
  const fill = $('[data-steps-fill]', root)
  const stage = $('[data-stage]', root)
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
    animate(fill, { width: `${(i + 1) * 25}%` }, { duration: 0.5, ease })
  }

  return async () => {
    steps.forEach((s) => s.classList.remove('is-done', 'is-active'))
    set(fill, { width: '0%' })
    set(doc, { opacity: 0, y: -40, rotate: -8 })
    set(scan, { opacity: 0, y: 0 })
    set(points, { opacity: 0, x: 16 })
    set(bars, { width: '0%' })
    counts.forEach((c) => { c.textContent = '0%' })
    matches[0].classList.remove('is-top')
    animate(stage, { opacity: 1 }, { duration: 0.3 })
    await wait(400)

    toStep(0)
    await animate(doc, { opacity: 1, y: 0, rotate: 0 }, { duration: 0.7, ease })
    await wait(300)

    toStep(1)
    set(scan, { opacity: 1 })
    await animate(scan, { y: [0, doc.offsetHeight - 2] }, { duration: 1.3, ease: 'easeInOut' })
    animate(scan, { opacity: 0 }, { duration: 0.2 })

    toStep(2)
    await animate(points, { opacity: 1, x: 0 }, { duration: 0.45, delay: stagger(0.3), ease })
    await wait(250)

    toStep(3)
    bars.forEach((bar, i) => animate(bar, { width: bar.style.getPropertyValue('--v') }, { duration: 1.1, delay: i * 0.15, ease }))
    await Promise.all(counts.map((c, i) =>
      animate(0, Number(c.dataset.count), { duration: 1.1, delay: i * 0.15, ease, onUpdate: (v) => { c.textContent = `${Math.round(v)}%` } })))

    steps.forEach((s) => { s.classList.add('is-done'); s.classList.remove('is-active') })
    matches[0].classList.add('is-top')
    animate(matches[0], { scale: [1, 1.05, 1] }, { duration: 0.5 })
    await wait(2800)
    await animate(stage, { opacity: 0 }, { duration: 0.4 })
  }
}

// A participant opens the portal and signs up for an activity
function portalStory(root) {
  const head = $('[data-portal-head]', root)
  const acts = $$('[data-act]', root)
  const signup = $('[data-signup]', root)
  const tap = $('[data-tap]', root)
  const toast = $('[data-toast]', root)

  return async () => {
    set(head, { opacity: 0, y: 8 })
    set(acts, { opacity: 0, y: 14 })
    signup.classList.remove('is-done')
    set(tap, { opacity: 0, scale: 0.6 })
    set(toast, { opacity: 0, y: 24 })
    await wait(300)

    animate(head, { opacity: 1, y: 0 }, { duration: 0.5, ease })
    await animate(acts, { opacity: 1, y: 0 }, { duration: 0.5, delay: stagger(0.12, { startDelay: 0.15 }), ease })
    await wait(500)

    // A finger moves onto the first "sign up" button and taps it
    tap.style.left = `${signup.offsetLeft + signup.offsetWidth / 2 - 18}px`
    tap.style.top = `${signup.offsetTop + signup.offsetHeight / 2 - 18}px`
    await animate(tap, { opacity: 1, scale: 1, y: [36, 0] }, { duration: 0.6, ease })
    await wait(250)
    press(signup)
    await animate(tap, { scale: [1, 0.8, 1.7], opacity: [1, 1, 0] }, { duration: 0.6 })
    signup.classList.add('is-done')
    await wait(500)

    await animate(toast, { opacity: 1, y: 0 }, { duration: 0.5, ease })
    await wait(2600)
    await animate([head, ...acts, toast], { opacity: 0 }, { duration: 0.4 })
  }
}

// An employee opens a request, sends it, and follows its status to done
function ticketsStory(root) {
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
    animate(status, { scale: [0.7, 1] }, { duration: 0.35, ease })
  }

  return async () => {
    set(form, { opacity: 0, y: -10 })
    form.style.visibility = 'hidden'
    typed.textContent = ''
    set(chip, { opacity: 0, scale: 0.6 })
    set(row, { height: 0, opacity: 0, paddingTop: 0, paddingBottom: 0, marginBottom: -9 })
    status.className = 'status status--new'
    animate([head, list], { opacity: 1 }, { duration: 0.3 })
    await wait(600)

    await press(newBtn)
    form.style.visibility = 'visible'
    await animate(form, { opacity: 1, y: 0 }, { duration: 0.4, ease })
    for (const ch of subject) {
      typed.textContent += ch
      await wait(65)
    }
    await animate(chip, { opacity: 1, scale: 1 }, { duration: 0.35, ease })
    await wait(300)
    await press(send)

    animate(form, { opacity: 0, y: -10 }, { duration: 0.35 }).then(() => { form.style.visibility = 'hidden' })
    await animate(row, { height: rowHeight, opacity: 1, paddingTop: 10, paddingBottom: 10, marginBottom: 0 }, { duration: 0.5, ease })
    await wait(1000)
    setStatus('progress')
    await wait(1300)
    setStatus('done')
    await wait(2600)
    await animate([head, list], { opacity: 0 }, { duration: 0.4 })
  }
}
