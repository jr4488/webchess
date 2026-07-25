import '@testing-library/jest-dom/vitest'

if (typeof window !== 'undefined' && !window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0)
  window.cancelAnimationFrame = (handle) => window.clearTimeout(handle)
}
