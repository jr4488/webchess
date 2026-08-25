'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

type EpisodePhase = 'cast' | 'traverse' | 'attack' | 'gate'

const PHASE_LABELS: Record<EpisodePhase, string> = {
  cast: 'Casting · directing field',
  traverse: 'Traversing · complete game',
  attack: 'Deriving direction · Portia attacking',
  gate: 'Gate · deciding',
}

const STEPS: readonly {
  phase: EpisodePhase
  number: string
  title: string
  body: string
}[] = [
  {
    phase: 'cast',
    number: 'i',
    title: 'Cast',
    body: 'A seeded cast maps 64 facets and gives every board part an auditable directional cue. Same seed, same cast.',
  },
  {
    phase: 'traverse',
    number: 'ii',
    title: 'Traverse',
    body: 'A semantically blind engine plays a complete game. Every move, pass, capture, piece value, survivor route, and outcome enters one replay-verifiable directional record.',
  },
  {
    phase: 'attack',
    number: 'iii',
    title: 'Derive and attack',
    body: 'Code ranks cast-qualified directions from the full trajectory. Portia must apply them through auditable criteria and amendments before any answer exists.',
  },
  {
    phase: 'gate',
    number: 'iv',
    title: 'Gate',
    body: 'Deterministic code checks the record-bound scrutiny and prospective prompt, then admits, retries, or refuses. Direction is not factual evidence.',
  },
]

interface Cell {
  ring: number
  sector: number
  side: 'evidence' | 'intent'
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const RINGS = 8
const SECTORS = 8
const INNER_RADIUS = 46
const OUTER_RADIUS = 214
const RING_WIDTH = (OUTER_RADIUS - INNER_RADIUS) / RINGS

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NAMESPACE, name)
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, String(value))
  })
  return element
}

function cellCenter(ring: number, sector: number): [number, number] {
  const radius = INNER_RADIUS + (ring + 0.5) * RING_WIDTH
  const angle = ((sector + 0.5) / SECTORS) * Math.PI * 2 - Math.PI / 2
  return [Math.cos(angle) * radius, Math.sin(angle) * radius]
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function EpisodePlayer() {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [phase, setPhase] = useState<EpisodePhase>('cast')
  const [phaseLabel, setPhaseLabel] = useState(PHASE_LABELS.cast)
  const [seedLabel, setSeedLabel] = useState('seed —')

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const gold = '#c8a24b'
    const goldHigh = '#e3c77e'
    const evidence = '#8fb4ce'
    const intent = '#c06b62'
    const line = '#232a36'
    const lineSoft = '#1b212c'
    const silk = '#eae6db'

    let cancelled = false
    let visible = false
    let seed = 0x9f3a2c
    let loop = 0
    let visibilityResolver: (() => void) | null = null

    const grid = createSvgElement('g', {})
    for (let ring = 0; ring <= RINGS; ring += 1) {
      grid.appendChild(
        createSvgElement('circle', {
          cx: 0,
          cy: 0,
          r: INNER_RADIUS + ring * RING_WIDTH,
          fill: 'none',
          stroke: ring === 0 || ring === RINGS ? line : lineSoft,
          'stroke-width': ring === 0 || ring === RINGS ? 1.3 : 1,
        }),
      )
    }
    for (let sector = 0; sector < SECTORS; sector += 1) {
      const angle = (sector / SECTORS) * Math.PI * 2 - Math.PI / 2
      grid.appendChild(
        createSvgElement('line', {
          x1: Math.cos(angle) * INNER_RADIUS,
          y1: Math.sin(angle) * INNER_RADIUS,
          x2: Math.cos(angle) * OUTER_RADIUS,
          y2: Math.sin(angle) * OUTER_RADIUS,
          stroke: lineSoft,
          'stroke-width': 1,
        }),
      )
    }
    const centerGlyph = createSvgElement('text', {
      x: 0,
      y: 9,
      'text-anchor': 'middle',
      fill: gold,
      opacity: 0.5,
      style: "font-family:'Segoe UI Symbol',sans-serif;font-size:26px",
    })
    centerGlyph.textContent = '䷀'
    grid.appendChild(centerGlyph)

    const dynamicLayer = createSvgElement('g', {})
    const verdict = createSvgElement('g', { opacity: 0 })
    const verdictRect = createSvgElement('rect', {
      x: -118,
      y: -26,
      width: 236,
      height: 52,
      fill: '#0b0e14',
      stroke: gold,
      'stroke-width': 1,
    })
    const verdictText = createSvgElement('text', {
      x: 0,
      y: 6,
      'text-anchor': 'middle',
      fill: goldHigh,
      style: "font-family:ui-monospace,monospace;font-size:13px;letter-spacing:3px",
    })
    verdict.append(verdictRect, verdictText)
    svg.replaceChildren(grid, dynamicLayer, verdict)

    const sleep = (milliseconds: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))

    const waitUntilVisible = async () => {
      while (!cancelled && (!visible || document.hidden)) {
        await new Promise<void>((resolve) => {
          visibilityResolver = resolve
          window.setTimeout(resolve, 300)
        })
      }
      visibilityResolver = null
    }

    const fade = async (
      node: SVGElement,
      from: number,
      to: number,
      duration: number,
    ) => {
      if (reducedMotion) {
        node.setAttribute('opacity', String(to))
        return
      }
      const animation = node.animate(
        [{ opacity: from }, { opacity: to }],
        { duration, fill: 'forwards', easing: 'ease' },
      )
      await animation.finished.catch(() => undefined)
    }

    const setCurrentPhase = (nextPhase: EpisodePhase, label: string) => {
      if (cancelled) return
      setPhase(nextPhase)
      setPhaseLabel(label)
    }

    const drawStaticReducedMotionState = () => {
      setSeedLabel('seed 0x9F3A2C · illustrative')
      setCurrentPhase('gate', 'Gate · permit')
      const random = mulberry32(seed)
      const used = new Set<string>()
      const cells: Cell[] = []
      while (cells.length < 16) {
        const ring = Math.floor(random() * RINGS)
        const sector = Math.floor(random() * SECTORS)
        const key = `${ring}-${sector}`
        if (used.has(key)) continue
        used.add(key)
        cells.push({
          ring,
          sector,
          side: random() < 0.5 ? 'evidence' : 'intent',
        })
      }
      cells.forEach((cell, index) => {
        const [x, y] = cellCenter(cell.ring, cell.sector)
        dynamicLayer.appendChild(
          createSvgElement('circle', {
            cx: x,
            cy: y,
            r: index % 5 === 0 ? 8 : 4.6,
            fill: cell.side === 'evidence' ? evidence : intent,
            opacity: index % 5 === 0 ? 0.45 : 0.95,
            stroke: index % 5 === 0 ? goldHigh : 'none',
          }),
        )
      })
      verdictText.textContent = 'GATE · PERMIT'
      verdict.setAttribute('opacity', '1')
    }

    const runEpisode = async () => {
      const refuse = loop % 3 === 2
      const random = mulberry32(seed)
      setSeedLabel(`seed 0x${(seed >>> 0).toString(16).toUpperCase()} · illustrative`)
      dynamicLayer.replaceChildren()
      verdict.setAttribute('opacity', '0')

      await waitUntilVisible()
      if (cancelled) return
      setCurrentPhase('cast', PHASE_LABELS.cast)

      const cells: Cell[] = []
      const used = new Set<string>()
      while (cells.length < 16) {
        const ring = Math.floor(random() * RINGS)
        const sector = Math.floor(random() * SECTORS)
        const key = `${ring}-${sector}`
        if (used.has(key)) continue
        used.add(key)
        cells.push({
          ring,
          sector,
          side: random() < 0.5 ? 'evidence' : 'intent',
        })
      }

      const dots = cells.map((cell, index) => {
        const [x, y] = cellCenter(cell.ring, cell.sector)
        const dot = createSvgElement('circle', {
          cx: x,
          cy: y,
          r: 4.6,
          fill: cell.side === 'evidence' ? evidence : intent,
          opacity: 0,
        })
        dynamicLayer.appendChild(dot)
        dot.animate(
          [{ opacity: 0 }, { opacity: 0.95 }],
          { duration: 300, delay: index * 55, fill: 'forwards' },
        )
        return dot
      })
      await sleep(1500)

      await waitUntilVisible()
      if (cancelled) return
      setCurrentPhase('traverse', PHASE_LABELS.traverse)
      const routeIndices: number[] = []
      while (routeIndices.length < 8) {
        const index = Math.floor(random() * cells.length)
        if (!routeIndices.includes(index)) routeIndices.push(index)
      }
      const points = routeIndices.map((index) =>
        cellCenter(cells[index].ring, cells[index].sector),
      )
      const route = points
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${point[0].toFixed(1)} ${point[1].toFixed(1)}`)
        .join(' ')
      const trace = createSvgElement('path', {
        d: route,
        fill: 'none',
        stroke: silk,
        'stroke-width': 1.2,
        opacity: 0.55,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      })
      dynamicLayer.appendChild(trace)
      const length = trace.getTotalLength()
      trace.style.strokeDasharray = String(length)
      trace.style.strokeDashoffset = String(length)
      trace.animate(
        [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
        { duration: 1800, fill: 'forwards', easing: 'ease-in-out' },
      )

      ;[routeIndices[2], routeIndices[4], routeIndices[6]].forEach((cellIndex, index) => {
        const [x, y] = cellCenter(cells[cellIndex].ring, cells[cellIndex].sector)
        const capture = createSvgElement('circle', {
          cx: x,
          cy: y,
          r: 8.5,
          fill: 'none',
          stroke: gold,
          'stroke-width': 1.3,
          opacity: 0,
        })
        dynamicLayer.appendChild(capture)
        capture.animate(
          [
            { opacity: 0, r: 5 },
            { opacity: 0.9, r: 9.5 },
            { opacity: 0.6, r: 11 },
          ],
          { duration: 650, delay: 600 + index * 420, fill: 'forwards', easing: 'ease-out' },
        )
      })
      await sleep(2300)

      await waitUntilVisible()
      if (cancelled) return
      setCurrentPhase('attack', PHASE_LABELS.attack)
      const consumedCount = refuse ? 6 : 3
      const targets: number[] = []
      while (targets.length < consumedCount + 2) {
        const index = Math.floor(random() * cells.length)
        if (!targets.includes(index)) targets.push(index)
      }
      const consumed = targets.slice(0, consumedCount)
      const wounded = targets.slice(consumedCount)

      consumed.forEach((cellIndex, index) => {
        const [x, y] = cellCenter(cells[cellIndex].ring, cells[cellIndex].sector)
        const size = 5.5
        const slashOne = createSvgElement('line', {
          x1: x - size,
          y1: y - size,
          x2: x + size,
          y2: y + size,
          stroke: intent,
          'stroke-width': 1.6,
          opacity: 0,
        })
        const slashTwo = createSvgElement('line', {
          x1: x + size,
          y1: y - size,
          x2: x - size,
          y2: y + size,
          stroke: intent,
          'stroke-width': 1.6,
          opacity: 0,
        })
        dynamicLayer.append(slashOne, slashTwo)
        slashOne.animate(
          [{ opacity: 0 }, { opacity: 0.95 }],
          { duration: 180, delay: index * 300, fill: 'forwards' },
        )
        slashTwo.animate(
          [{ opacity: 0 }, { opacity: 0.95 }],
          { duration: 180, delay: index * 300 + 90, fill: 'forwards' },
        )
        dots[cellIndex]?.animate(
          [{ opacity: 0.95 }, { opacity: 0.22 }],
          { duration: 400, delay: index * 300, fill: 'forwards' },
        )
      })

      wounded.forEach((cellIndex, index) => {
        const [x, y] = cellCenter(cells[cellIndex].ring, cells[cellIndex].sector)
        const marker = createSvgElement('circle', {
          cx: x,
          cy: y,
          r: 8,
          fill: 'none',
          stroke: goldHigh,
          'stroke-width': 1.2,
          'stroke-dasharray': '2.5 3',
          opacity: 0,
        })
        dynamicLayer.appendChild(marker)
        marker.animate(
          [{ opacity: 0 }, { opacity: 0.85 }],
          { duration: 400, delay: consumed.length * 300 + index * 250, fill: 'forwards' },
        )
      })
      await sleep(consumed.length * 300 + 1300)

      await waitUntilVisible()
      if (cancelled) return
      setCurrentPhase('gate', refuse ? 'Gate · refusing' : 'Gate · admitting')
      verdictText.textContent = refuse ? 'INSUFFICIENT BASIS' : 'GATE · PERMIT'
      verdictText.setAttribute('fill', refuse ? intent : goldHigh)
      verdictRect.setAttribute('stroke', refuse ? intent : gold)
      await fade(verdict, 0, 1, 500)
      await sleep(2400)
      await fade(verdict, 1, 0, 400)

      const fadeOut = dynamicLayer.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: 600, fill: 'forwards' },
      )
      await fadeOut.finished.catch(() => undefined)
      dynamicLayer.style.opacity = '1'
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      loop += 1
    }

    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        visible = Boolean(entries[0]?.isIntersecting)
        if (visible) visibilityResolver?.()
      },
      { threshold: 0.2 },
    )
    visibilityObserver.observe(svg)

    const handleVisibilityChange = () => {
      if (!document.hidden) visibilityResolver?.()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    if (reducedMotion) {
      drawStaticReducedMotionState()
    } else {
      void (async () => {
        while (!cancelled) {
          await runEpisode()
        }
      })()
    }

    return () => {
      cancelled = true
      visibilityResolver?.()
      visibilityObserver.disconnect()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      svg.getAnimations({ subtree: true }).forEach((animation) => animation.cancel())
    }
  }, [])

  return (
    <div className="wc-ep-grid">
      <div className="wc-ep-stage" data-wc-reveal>
        <svg
          ref={svgRef}
          viewBox="-230 -230 460 460"
          role="img"
          aria-label="Illustrative deterministic WebChess sequence showing a cast-directed field, complete circular trajectory, derived directional scrutiny, and a Gate verdict."
        />
        <div className="wc-ep-hud" aria-live="polite">
          <span className="wc-ep-phase">{phaseLabel}</span>
          <span className="wc-ep-seed">{seedLabel}</span>
        </div>
        <p className="wc-ep-disclosure">
          Illustrative sequence, not the live engine.{' '}
          <Link href="/install">Install and run the candidate system.</Link>
        </p>
      </div>
      <div className="wc-ep-side">
        <div className="wc-kicker" data-wc-reveal>One episode, continuously</div>
        <h2 data-wc-reveal>Watch the institution work.</h2>
        <ol className="wc-ep-steps" data-wc-reveal>
          {STEPS.map((step) => (
            <li key={step.phase} data-live={phase === step.phase ? 'true' : 'false'}>
              <span className="wc-step-number">{step.number}</span>
              <span>
                <b>{step.title}</b>
                {step.body}
              </span>
            </li>
          ))}
        </ol>
        <p className="wc-ep-note">
          <b>Blue</b> — outside-in evidence. <b>Red</b> — inside-out intent. When the
          surviving basis is too thin, the Gate returns <b>insufficient basis</b> instead of
          manufacturing coherence.
        </p>
      </div>
    </div>
  )
}
