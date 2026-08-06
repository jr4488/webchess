import styles from './PublicSite.module.css'

interface Point {
  x: number
  y: number
}

function polar(radius: number, angleDegrees: number): Point {
  const angle = ((angleDegrees - 90) * Math.PI) / 180
  return {
    x: 300 + radius * Math.cos(angle),
    y: 300 + radius * Math.sin(angle),
  }
}

function sectorPath(
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const outerStart = polar(outerRadius, startAngle)
  const outerEnd = polar(outerRadius, endAngle)
  const innerEnd = polar(innerRadius, endAngle)
  const innerStart = polar(innerRadius, startAngle)

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerRadius} ${outerRadius} 0 0 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${innerRadius} ${innerRadius} 0 0 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    'Z',
  ].join(' ')
}

const HIGHLIGHTS = new Set([5, 12, 22, 31, 45, 56])
const EVIDENCE_PIECES = [0, 1, 2, 3, 4, 5, 6, 7]
const INTENT_PIECES = [0, 1, 2, 3, 4, 5, 6, 7]

export function HeroBoard() {
  const cells = Array.from({ length: 64 }, (_, index) => {
    const ring = Math.floor(index / 8)
    const sector = index % 8
    const innerRadius = 54 + ring * 28
    const outerRadius = innerRadius + 25
    const startAngle = sector * 45 + 1.6
    const endAngle = (sector + 1) * 45 - 1.6

    return {
      index,
      ring,
      path: sectorPath(innerRadius, outerRadius, startAngle, endAngle),
    }
  })

  return (
    <figure className={styles.heroBoard} aria-labelledby="board-caption">
      <svg
        className={styles.heroBoardSvg}
        viewBox="0 0 600 600"
        role="img"
        aria-label="A circular WebChess field showing outside-in evidence meeting inside-out intention"
      >
        <defs>
          <radialGradient id="board-core" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="#d9ff8d" stopOpacity="0.95" />
            <stop offset="52%" stopColor="#62d6b6" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#101b18" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="capture-path" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f5f1e8" />
            <stop offset="48%" stopColor="#b8ff6a" />
            <stop offset="100%" stopColor="#8f82ff" />
          </linearGradient>
          <filter id="soft-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx="300" cy="300" r="290" className={styles.boardBackdrop} />
        <circle cx="300" cy="300" r="258" className={styles.boardBoundary} />

        <g className={styles.boardCells}>
          {cells.map((cell) => (
            <path
              className={HIGHLIGHTS.has(cell.index) ? styles.boardCellHot : styles.boardCell}
              d={cell.path}
              data-ring={cell.ring}
              key={cell.index}
            />
          ))}
        </g>

        <circle cx="300" cy="300" r="116" fill="url(#board-core)" className={styles.boardCoreGlow} />
        <circle cx="300" cy="300" r="50" className={styles.boardCore} />
        <text x="300" y="293" textAnchor="middle" className={styles.boardCoreTitle}>QUESTION</text>
        <text x="300" y="316" textAnchor="middle" className={styles.boardCoreSub}>held open</text>

        <path
          d="M 113 460 C 230 390, 352 353, 471 139"
          className={styles.captureRoute}
          stroke="url(#capture-path)"
          filter="url(#soft-glow)"
        />
        <circle cx="113" cy="460" r="9" className={styles.routeNode} />
        <circle cx="275" cy="358" r="9" className={styles.routeNodeActive} />
        <circle cx="471" cy="139" r="9" className={styles.routeNode} />

        <g className={styles.evidencePieces}>
          {EVIDENCE_PIECES.map((sector) => {
            const point = polar(266, sector * 45 + 22.5)
            return <circle cx={point.x} cy={point.y} r="8" key={`e-${sector}`} />
          })}
        </g>
        <g className={styles.intentPieces}>
          {INTENT_PIECES.map((sector) => {
            const point = polar(87, sector * 45 + 22.5)
            return <circle cx={point.x} cy={point.y} r="6" key={`i-${sector}`} />
          })}
        </g>

        <text x="300" y="25" textAnchor="middle" className={styles.boardAxisLabel}>OUTSIDE-IN EVIDENCE</text>
        <text x="300" y="580" textAnchor="middle" className={styles.boardAxisLabel}>INSIDE-OUT INTENTION</text>

        <g className={styles.boardAnnotations}>
          <text x="69" y="118">64 perspectives</text>
          <text x="427" y="492">replayable path</text>
          <text x="431" y="86">salience, not proof</text>
        </g>
      </svg>
      <figcaption id="board-caption" className={styles.heroBoardCaption}>
        The board creates a trace to inspect. Portia and the Gate decide whether an answer is allowed.
      </figcaption>
    </figure>
  )
}
