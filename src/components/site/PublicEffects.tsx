'use client'

import { useEffect } from 'react'

export function PublicEffects() {
  useEffect(() => {
    const navigation = document.querySelector<HTMLElement>('[data-wc-nav]')
    const ruleMoment = document.querySelector<HTMLElement>('[data-wc-rule]')
    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const updateNavigation = () => {
      if (!navigation) return
      navigation.dataset.scrolled = window.scrollY > 40 ? 'true' : 'false'
    }

    updateNavigation()
    window.addEventListener('scroll', updateNavigation, { passive: true })

    const revealObservers: IntersectionObserver[] = []
    const revealNodes = Array.from(
      document.querySelectorAll<HTMLElement>('[data-wc-reveal]'),
    )

    if (reducedMotion || !('IntersectionObserver' in window)) {
      revealNodes.forEach((node) => {
        node.dataset.revealed = 'true'
      })
      if (ruleMoment) ruleMoment.dataset.active = 'true'
    } else {
      const revealObserver = new IntersectionObserver(
        (entries, observer) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return
            const target = entry.target as HTMLElement
            target.dataset.revealed = 'true'
            observer.unobserve(target)
          })
        },
        { threshold: 0.14 },
      )
      revealNodes.forEach((node) => revealObserver.observe(node))
      revealObservers.push(revealObserver)

      if (ruleMoment) {
        const ruleObserver = new IntersectionObserver(
          (entries, observer) => {
            if (!entries[0]?.isIntersecting) return
            ruleMoment.dataset.active = 'true'
            observer.disconnect()
          },
          { threshold: 0.5 },
        )
        ruleObserver.observe(ruleMoment)
        revealObservers.push(ruleObserver)
      }
    }

    return () => {
      window.removeEventListener('scroll', updateNavigation)
      revealObservers.forEach((observer) => observer.disconnect())
    }
  }, [])

  return null
}
