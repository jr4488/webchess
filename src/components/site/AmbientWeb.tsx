'use client'

import { useEffect, useRef } from 'react'

interface DewPoint {
  spoke: number
  radius: number
  phase: number
  speed: number
  size: number
}

export function AmbientWeb() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const spokes = 22
    const rings = 9
    let width = 0
    let height = 0
    let centerX = 0
    let centerY = 0
    let elapsed = 0
    let dewPoints: DewPoint[] = []
    let animationFrame = 0

    const resize = () => {
      const ratio = Math.max(1, window.devicePixelRatio || 1)
      width = Math.max(1, Math.round(canvas.clientWidth * ratio))
      height = Math.max(1, Math.round(canvas.clientHeight * ratio))
      canvas.width = width
      canvas.height = height
      centerX = width * 0.72
      centerY = height * 0.42
      const maxRadius = Math.hypot(width, height) * 0.55
      dewPoints = Array.from({ length: 46 }, () => ({
        spoke: Math.floor(Math.random() * spokes),
        radius: (0.15 + Math.random() * 0.85) * maxRadius,
        phase: Math.random() * Math.PI * 2,
        speed: 0.15 + Math.random() * 0.5,
        size: (0.8 + Math.random() * 1.6) * ratio,
      }))
    }

    const draw = () => {
      context.clearRect(0, 0, width, height)
      const maxRadius = Math.hypot(width, height) * 0.55
      const wobble = reducedMotion ? 0 : Math.sin(elapsed * 0.0004) * 0.012
      const ratio = Math.max(1, window.devicePixelRatio || 1)

      context.lineWidth = ratio * 0.55
      for (let index = 0; index < spokes; index += 1) {
        const angle = (index / spokes) * Math.PI * 2 + wobble
        const endX = centerX + Math.cos(angle) * maxRadius
        const endY = centerY + Math.sin(angle) * maxRadius
        const gradient = context.createLinearGradient(centerX, centerY, endX, endY)
        gradient.addColorStop(0, 'rgba(200,162,75,0.16)')
        gradient.addColorStop(0.4, 'rgba(234,230,219,0.055)')
        gradient.addColorStop(1, 'rgba(234,230,219,0)')
        context.strokeStyle = gradient
        context.beginPath()
        context.moveTo(centerX, centerY)
        context.lineTo(endX, endY)
        context.stroke()
      }

      for (let ring = 1; ring <= rings; ring += 1) {
        const radius = (ring / rings) ** 1.35 * maxRadius
        context.strokeStyle = `rgba(234,230,219,${0.075 - ring * 0.006})`
        context.beginPath()
        for (let index = 0; index <= spokes; index += 1) {
          const angle = (index / spokes) * Math.PI * 2 + wobble
          const midpointAngle = ((index + 0.5) / spokes) * Math.PI * 2 + wobble
          const pointX = centerX + Math.cos(angle) * radius
          const pointY = centerY + Math.sin(angle) * radius
          const sagRadius = radius * 0.985
          const midpointX = centerX + Math.cos(midpointAngle) * sagRadius
          const midpointY = centerY + Math.sin(midpointAngle) * sagRadius
          if (index === 0) {
            context.moveTo(pointX, pointY)
          } else {
            context.quadraticCurveTo(midpointX, midpointY, pointX, pointY)
          }
        }
        context.stroke()
      }

      dewPoints.forEach((dew) => {
        const angle = (dew.spoke / spokes) * Math.PI * 2 + wobble
        const twinkle = reducedMotion
          ? 0.5
          : (Math.sin(elapsed * 0.001 * dew.speed + dew.phase) + 1) / 2
        context.fillStyle = `rgba(227,199,126,${0.05 + twinkle * 0.32})`
        context.beginPath()
        context.arc(
          centerX + Math.cos(angle) * dew.radius,
          centerY + Math.sin(angle) * dew.radius,
          dew.size * (0.7 + twinkle * 0.5),
          0,
          Math.PI * 2,
        )
        context.fill()
      })

      elapsed += 16
      if (!reducedMotion) animationFrame = window.requestAnimationFrame(draw)
    }

    resize()
    draw()

    const resizeObserver = new ResizeObserver(() => {
      resize()
      if (reducedMotion) draw()
    })
    resizeObserver.observe(canvas)

    return () => {
      resizeObserver.disconnect()
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
    }
  }, [])

  return <canvas ref={canvasRef} className="wc-webcanvas" aria-hidden="true" />
}
