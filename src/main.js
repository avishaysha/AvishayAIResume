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
  animate($$('[data-float]'), { opacity: [0, 1], scale: [0.8, 1] }, { duration: 0.7, delay: stagger(0.25, { startDelay: 0.9 }), ease })

  // Floating cards drift gently
  $$('[data-float] .float-card__inner').forEach((el, i) => {
    animate(el, { y: [0, i ? -12 : -10, 0] }, { duration: i ? 6 : 5, repeat: Infinity, ease: 'easeInOut', delay: i * 1.2 })
  })

  // Photo leans toward the pointer
  if (finePointer) {
    const hero = $('[data-hero]')
    const photo = $('[data-photo]')
    const floats = $$('[data-float]')
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect()
      const dx = (e.clientX - r.left) / r.width - 0.5
      const dy = (e.clientY - r.top) / r.height - 0.5
      animate(photo, { rotateY: dx * 10, rotateX: -dy * 8 }, { duration: 0.6, ease })
      floats.forEach((f, i) => animate(f, { x: dx * (i ? 22 : -22), y: dy * (i ? 14 : -14) }, { duration: 0.8, ease }))
    })
    hero.addEventListener('pointerleave', () => {
      animate(photo, { rotateY: 0, rotateX: 0 }, { duration: 0.8, ease })
      floats.forEach((f) => animate(f, { x: 0, y: 0 }, { duration: 0.8, ease }))
    })
  }

  // ---------- Reveal sections on scroll ----------
  inView('[data-reveal-group]', (group) => {
    animate($$('[data-reveal]', group), { opacity: [0, 1], y: [32, 0] }, { duration: 0.8, delay: stagger(0.1), ease })
  }, { amount: 0.25 })

  inView('[data-reveal-card]', (card) => {
    animate(card, { opacity: [0, 1], y: [48, 0], scale: [0.97, 1] }, { duration: 0.9, ease })
    playMiniUi(card)
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

// Each mini UI acts out what the product does, once, when it scrolls into view
function playMiniUi(card) {
  const bars = $$('[data-bar]', card)
  bars.forEach((bar, i) => {
    animate(bar, { width: ['0%', getComputedStyle(bar).getPropertyValue('--v')] }, { duration: 1.4, delay: 0.4 + i * 0.15, ease })
  })

  const signup = $('[data-signup]', card)
  if (signup) {
    setTimeout(() => {
      signup.classList.add('is-done')
      animate(signup, { scale: [1, 1.12, 1] }, { duration: 0.45, ease: 'easeOut' })
    }, 1400)
  }

  const fresh = $('[data-new-ticket]', card)
  const old = $('[data-old-ticket]', card)
  if (fresh && old) {
    setTimeout(async () => {
      animate(old, { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, marginTop: -9 }, { duration: 0.4, ease })
      fresh.style.display = 'flex'
      await animate(fresh, { opacity: [0, 1], height: [0, fresh.offsetHeight], x: [24, 0] }, { duration: 0.5, ease })
      old.style.display = 'none'
      fresh.style.height = ''
    }, 1200)
  }
}
