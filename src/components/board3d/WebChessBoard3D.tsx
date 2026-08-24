'use client'

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  AdditiveBlending,
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  Points,
  SRGBColorSpace,
  Vector3,
} from 'three'

import { cellKey } from '../../lib/board'
import type { CellCoord, Piece, PieceKind, Stage } from '../../types'
import type { RadialBoardProps } from '../RadialBoard'
import { BOARD_3D_CAMERA_FOV, boardCameraLookAt, boardCameraPosition } from './camera'
import {
  BOARD_3D_OUTER_RADIUS,
  boardCellIndex,
  boardCellPosition,
  createBoardCellShape,
  createWebGeometry,
} from './geometry'
import { captureMotionPoint, portiaTraversalPoint } from './motion'

const INK = '#edf1ff'
const VOID = '#050713'
const GOLD = '#ffc978'
const VERMILLION = '#ff5f86'
const JADE = '#4fe3d0'
const BLUE = '#758cff'

type Board3DProps = RadialBoardProps & {
  reducedMotion: boolean
  onContextLost: () => void
}

type CellVisualState = {
  mapped: boolean
  selected: boolean
  legal: boolean
  captured: boolean
  highlighted: boolean
  portiaCurrent: boolean
  portiaReviewed: boolean
  lastMove: boolean
}

const ignoreCellSelection = () => undefined

function toKeySet(keys: ReadonlySet<string> | readonly string[] | undefined) {
  if (!keys) return new Set<string>()
  return keys instanceof Set ? keys : new Set(keys)
}

function sameCell(left: CellCoord | undefined | null, right: CellCoord) {
  return Boolean(left && left.ring === right.ring && left.sector === right.sector)
}

function isValidCell(cell: CellCoord) {
  return (
    Number.isInteger(cell.ring)
    && Number.isInteger(cell.sector)
    && cell.ring >= 0
    && cell.ring < 8
    && cell.sector >= 0
    && cell.sector < 8
  )
}

function cellColors(state: CellVisualState, shade: boolean) {
  if (state.portiaCurrent) return { color: GOLD, emissive: VERMILLION, intensity: 1.4 }
  if (state.legal) return { color: '#ffb3c4', emissive: VERMILLION, intensity: 0.75 }
  if (state.highlighted || state.captured) return { color: GOLD, emissive: GOLD, intensity: 0.52 }
  if (state.portiaReviewed) return { color: '#173d43', emissive: JADE, intensity: 0.48 }
  if (state.lastMove) return { color: '#343f71', emissive: INK, intensity: 0.32 }
  if (!state.mapped) return { color: '#090c19', emissive: VOID, intensity: 0.04 }
  return shade
    ? { color: '#18203d', emissive: BLUE, intensity: 0.08 }
    : { color: '#785f45', emissive: GOLD, intensity: 0.1 }
}

const BoardCell = memo(function BoardCell({
  cell,
  state,
  disabled,
  reducedMotion,
  onHover,
  onSelect,
}: {
  cell: CellCoord
  state: CellVisualState
  disabled: boolean
  reducedMotion: boolean
  onHover: (cell: CellCoord | null) => void
  onSelect: (cell: CellCoord) => void
}) {
  const meshRef = useRef<Mesh>(null)
  const geometry = useMemo(() => {
    const nextGeometry = new ExtrudeGeometry(createBoardCellShape(cell), {
      depth: 0.16,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: 0.025,
      bevelThickness: 0.025,
      curveSegments: 7,
    })
    nextGeometry.rotateX(-Math.PI / 2)
    return nextGeometry
  }, [cell])
  const visual = cellColors(state, (cell.ring + cell.sector) % 2 === 0)
  const targetHeight = state.portiaCurrent
    ? 0.25
    : state.selected || state.legal || state.highlighted
      ? 0.13
      : state.mapped
        ? 0
        : -0.2

  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.position.y = reducedMotion
      ? targetHeight
      : MathUtils.damp(mesh.position.y, targetHeight, 9, delta)
  })

  const stop = (event: ThreeEvent<MouseEvent> | ThreeEvent<PointerEvent>) => event.stopPropagation()

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      castShadow={state.mapped}
      receiveShadow
      onClick={disabled ? undefined : (event) => {
        stop(event)
        onSelect(cell)
      }}
      onPointerOver={(event) => {
        stop(event)
        onHover(cell)
      }}
      onPointerOut={(event) => {
        stop(event)
        onHover(null)
      }}
    >
      <meshStandardMaterial
        color={visual.color}
        emissive={visual.emissive}
        emissiveIntensity={visual.intensity}
        metalness={0.38}
        opacity={state.mapped ? 0.98 : 0.28}
        roughness={0.42}
        transparent={!state.mapped}
      />
    </mesh>
  )
}, (previous, next) => (
  previous.cell === next.cell
  && previous.disabled === next.disabled
  && previous.reducedMotion === next.reducedMotion
  && previous.onHover === next.onHover
  && previous.onSelect === next.onSelect
  && previous.state.mapped === next.state.mapped
  && previous.state.selected === next.state.selected
  && previous.state.legal === next.state.legal
  && previous.state.captured === next.state.captured
  && previous.state.highlighted === next.state.highlighted
  && previous.state.portiaCurrent === next.state.portiaCurrent
  && previous.state.portiaReviewed === next.state.portiaReviewed
  && previous.state.lastMove === next.state.lastMove
))

function PieceCrown({ kind, color }: { kind: PieceKind; color: string }) {
  switch (kind) {
    case 'pawn':
      return (
        <>
          <mesh position={[0, 0.48, 0]} castShadow><sphereGeometry args={[0.17, 18, 14]} /><meshStandardMaterial color={color} metalness={0.72} roughness={0.2} /></mesh>
          <mesh position={[0, 0.3, 0]} castShadow><coneGeometry args={[0.21, 0.31, 18]} /><meshStandardMaterial color={color} metalness={0.68} roughness={0.24} /></mesh>
        </>
      )
    case 'rook':
      return (
        <>
          <mesh position={[0, 0.39, 0]} castShadow><cylinderGeometry args={[0.2, 0.24, 0.42, 8]} /><meshStandardMaterial color={color} metalness={0.7} roughness={0.2} /></mesh>
          <mesh position={[0, 0.63, 0]} castShadow><boxGeometry args={[0.43, 0.18, 0.43]} /><meshStandardMaterial color={color} metalness={0.7} roughness={0.2} /></mesh>
        </>
      )
    case 'knight':
      return (
        <group rotation={[0.05, 0, -0.22]}>
          <mesh position={[0, 0.4, 0]} castShadow><coneGeometry args={[0.24, 0.54, 10]} /><meshStandardMaterial color={color} metalness={0.67} roughness={0.23} /></mesh>
          <mesh position={[0.08, 0.69, -0.02]} scale={[0.78, 1.2, 0.72]} castShadow><sphereGeometry args={[0.2, 16, 12]} /><meshStandardMaterial color={color} metalness={0.67} roughness={0.23} /></mesh>
          <mesh position={[0.2, 0.71, -0.02]} rotation={[0, 0, -0.7]} castShadow><coneGeometry args={[0.08, 0.24, 8]} /><meshStandardMaterial color={color} metalness={0.67} roughness={0.23} /></mesh>
        </group>
      )
    case 'bishop':
      return (
        <>
          <mesh position={[0, 0.4, 0]} castShadow><coneGeometry args={[0.25, 0.55, 18]} /><meshStandardMaterial color={color} metalness={0.7} roughness={0.2} /></mesh>
          <mesh position={[0, 0.72, 0]} scale={[0.78, 1.12, 0.78]} castShadow><sphereGeometry args={[0.17, 18, 14]} /><meshStandardMaterial color={color} metalness={0.7} roughness={0.2} /></mesh>
        </>
      )
    case 'queen':
      return (
        <>
          <mesh position={[0, 0.43, 0]} castShadow><coneGeometry args={[0.29, 0.65, 20]} /><meshStandardMaterial color={color} metalness={0.72} roughness={0.18} /></mesh>
          <mesh position={[0, 0.76, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow><torusGeometry args={[0.19, 0.055, 8, 20]} /><meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.25} /></mesh>
          <mesh position={[0, 0.88, 0]} castShadow><sphereGeometry args={[0.11, 14, 10]} /><meshStandardMaterial color={color} metalness={0.72} roughness={0.18} /></mesh>
        </>
      )
    case 'king':
      return (
        <>
          <mesh position={[0, 0.44, 0]} castShadow><coneGeometry args={[0.3, 0.67, 20]} /><meshStandardMaterial color={color} metalness={0.74} roughness={0.17} /></mesh>
          <mesh position={[0, 0.86, 0]} castShadow><boxGeometry args={[0.09, 0.34, 0.09]} /><meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.28} /></mesh>
          <mesh position={[0, 0.9, 0]} castShadow><boxGeometry args={[0.28, 0.08, 0.08]} /><meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.28} /></mesh>
        </>
      )
  }
}

function AnimatedPiece({
  piece,
  selected,
  captureTarget,
  captureMove,
  interactive,
  reducedMotion,
  onActivate,
}: {
  piece: Piece
  selected: boolean
  captureTarget: boolean
  captureMove: boolean
  interactive: boolean
  reducedMotion: boolean
  onActivate: () => void
}) {
  const groupRef = useRef<Group>(null)
  const moveStartRef = useRef(new Vector3())
  const moveTargetRef = useRef(new Vector3())
  const moveProgressRef = useRef(1)
  const captureMoveRef = useRef(false)
  const pieceRing = piece.position.ring
  const pieceSector = piece.position.sector
  const target = useMemo(() => new Vector3(...boardCellPosition({
    ring: pieceRing,
    sector: pieceSector,
  }, 0.2)), [pieceRing, pieceSector])
  const [initialPosition] = useState(() => target.clone())
  const targetKey = cellKey(piece.position)
  const targetKeyRef = useRef(targetKey)
  const color = piece.side === 'white' ? '#f4f7ff' : '#58679f'
  const sideGlow = piece.side === 'white' ? JADE : VERMILLION

  useEffect(() => {
    if (targetKeyRef.current === targetKey) return
    const group = groupRef.current
    moveStartRef.current.copy(group?.position ?? target)
    moveTargetRef.current.copy(target)
    moveProgressRef.current = 0
    captureMoveRef.current = captureMove
    targetKeyRef.current = targetKey
  }, [captureMove, target, targetKey])

  useFrame((state, delta) => {
    const group = groupRef.current
    if (!group) return
    if (reducedMotion) {
      group.position.copy(target)
      moveProgressRef.current = 1
    } else if (moveProgressRef.current < 1) {
      const duration = captureMoveRef.current ? 1.12 : 0.72
      moveProgressRef.current = Math.min(1, moveProgressRef.current + delta / duration)
      const start = moveStartRef.current
      const destination = moveTargetRef.current
      const motionPoint = captureMotionPoint(
        [start.x, start.y, start.z],
        [destination.x, destination.y, destination.z],
        moveProgressRef.current,
        captureMoveRef.current,
      )
      group.position.set(...motionPoint)
    } else {
      group.position.lerp(target, 1 - Math.exp(-delta * 10))
    }
    const impact = captureMoveRef.current && moveProgressRef.current > 0.72
      ? Math.sin(((moveProgressRef.current - 0.72) / 0.28) * Math.PI) * 0.17
      : 0
    const pulse = selected || captureTarget
      ? 1.05 + Math.sin(state.clock.elapsedTime * 4) * 0.05
      : 1
    const scale = reducedMotion ? (selected ? 1.08 : 1) : pulse + impact
    group.scale.setScalar(scale)
    group.rotation.y = reducedMotion
      ? 0
      : Math.sin(state.clock.elapsedTime * 0.65 + boardCellIndex(piece.position)) * 0.025
  })

  return (
    <group
      ref={groupRef}
      position={initialPosition}
      onClick={interactive ? (event) => {
        event.stopPropagation()
        onActivate()
      } : undefined}
      onPointerOver={interactive ? (event) => event.stopPropagation() : undefined}
    >
      <mesh position={[0, 0.09, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.28, 0.34, 0.18, 24]} />
        <meshStandardMaterial
          color={selected ? VERMILLION : color}
          emissive={captureTarget ? VERMILLION : selected ? GOLD : color}
          emissiveIntensity={captureTarget ? 0.72 : selected ? 0.42 : 0.05}
          metalness={0.68}
          roughness={0.2}
        />
      </mesh>
      <mesh position={[0, 0.11, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.31, 0.025, 8, 24]} />
        <meshBasicMaterial color={sideGlow} transparent opacity={0.9} blending={AdditiveBlending} />
      </mesh>
      <PieceCrown kind={piece.kind} color={selected ? VERMILLION : color} />
      <pointLight
        color={captureTarget ? VERMILLION : selected ? GOLD : sideGlow}
        distance={selected || captureTarget ? 2.2 : 1.25}
        intensity={selected || captureTarget ? 2.1 : 0.48}
        position={[0, 0.55, 0]}
      />
    </group>
  )
}

function CaptureEffect({
  capture,
}: {
  capture: NonNullable<RadialBoardProps['latestCapture']>
}) {
  const echoRef = useRef<Group>(null)
  const ringRef = useRef<Mesh>(null)
  const ringMaterialRef = useRef<MeshBasicMaterial>(null)
  const lightRef = useRef<PointLight>(null)
  const elapsedRef = useRef(0)
  const capturedColor = capture.captured.side === 'white' ? '#f4f7ff' : '#58679f'
  const impactColor = capture.attacker.side === 'white' ? JADE : VERMILLION

  useFrame((_, delta) => {
    elapsedRef.current += delta
    const progress = Math.min(1, elapsedRef.current / 1.45)
    const impact = Math.max(0, Math.min(1, (progress - 0.36) / 0.64))
    const echo = echoRef.current
    if (echo) {
      const scale = 1 - impact * 0.82
      echo.scale.setScalar(scale)
      echo.position.y = -impact * 0.68
      echo.rotation.y = impact * Math.PI * 1.4
      echo.rotation.z = impact * 0.36
    }
    if (ringRef.current) ringRef.current.scale.setScalar(0.55 + impact * 3.2)
    if (ringMaterialRef.current) {
      ringMaterialRef.current.opacity = impact === 0 ? 0 : Math.sin(impact * Math.PI) * 0.92
    }
    if (lightRef.current) lightRef.current.intensity = Math.sin(impact * Math.PI) * 7.5
  })

  return (
    <group position={boardCellPosition(capture.cell, 0.2)}>
      <group ref={echoRef}>
        <mesh position={[0, 0.09, 0]} castShadow>
          <cylinderGeometry args={[0.28, 0.34, 0.18, 24]} />
          <meshStandardMaterial
            color={capturedColor}
            emissive={impactColor}
            emissiveIntensity={0.55}
            metalness={0.68}
            roughness={0.2}
          />
        </mesh>
        <PieceCrown kind={capture.captured.kind} color={capturedColor} />
      </group>
      <mesh ref={ringRef} position={[0, 0.16, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.32, 0.045, 10, 40]} />
        <meshBasicMaterial
          ref={ringMaterialRef}
          color={impactColor}
          transparent
          opacity={0}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <pointLight ref={lightRef} color={impactColor} intensity={0} distance={4.6} />
    </group>
  )
}

function Spider({
  targetCell,
  status,
  reducedMotion,
}: {
  targetCell: CellCoord | null
  status: NonNullable<RadialBoardProps['portiaActivity']>['status'] | 'resting'
  reducedMotion: boolean
}) {
  const groupRef = useRef<Group>(null)
  const targetBeaconRef = useRef<Mesh>(null)
  const targetBeaconMaterialRef = useRef<MeshBasicMaterial>(null)
  const trailMaterialRef = useRef<LineBasicMaterial>(null)
  const targetRing = targetCell?.ring ?? null
  const targetSector = targetCell?.sector ?? null
  const target = useMemo(() => new Vector3(...(
    targetRing === null || targetSector === null
      ? [0, 0.62, 0] as const
      : boardCellPosition({ ring: targetRing, sector: targetSector }, 0.62)
  )), [targetRing, targetSector])
  const [initialPosition] = useState(() => target.clone())
  const targetKey = targetCell ? cellKey(targetCell) : 'center'
  const targetKeyRef = useRef(targetKey)
  const journeyStartRef = useRef(target.clone())
  const journeyEndRef = useRef(target.clone())
  const journeyProgressRef = useRef(1)
  const legGeometry = useMemo(() => {
    const positions: number[] = []
    for (const side of [-1, 1]) {
      for (let leg = 0; leg < 4; leg += 1) {
        const z = -0.22 + leg * 0.15
        positions.push(side * 0.08, 0, z, side * (0.3 + leg * 0.025), 0.04, z - 0.12)
        positions.push(side * (0.3 + leg * 0.025), 0.04, z - 0.12, side * 0.48, -0.04, z + (leg - 1.5) * 0.04)
      }
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return geometry
  }, [])
  const trailGeometry = useMemo(() => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3))
    return geometry
  }, [])

  useEffect(() => () => {
    legGeometry.dispose()
    trailGeometry.dispose()
  }, [legGeometry, trailGeometry])

  useEffect(() => {
    if (targetKeyRef.current === targetKey) return
    const group = groupRef.current
    journeyStartRef.current.copy(group?.position ?? target)
    journeyEndRef.current.copy(target)
    journeyProgressRef.current = reducedMotion ? 1 : 0
    targetKeyRef.current = targetKey
    if (reducedMotion) group?.position.copy(target)
  }, [reducedMotion, target, targetKey])

  useFrame((state, delta) => {
    const group = groupRef.current
    if (!group) return
    const start = journeyStartRef.current
    const destination = journeyEndRef.current
    if (reducedMotion) {
      group.position.copy(target)
      journeyProgressRef.current = 1
    } else if (journeyProgressRef.current < 1) {
      journeyProgressRef.current = Math.min(1, journeyProgressRef.current + delta / 1.9)
      const point = portiaTraversalPoint(
        [start.x, start.y, start.z],
        [destination.x, destination.y, destination.z],
        journeyProgressRef.current,
      )
      const nextPoint = portiaTraversalPoint(
        [start.x, start.y, start.z],
        [destination.x, destination.y, destination.z],
        Math.min(1, journeyProgressRef.current + 0.025),
      )
      group.position.set(...point)
      group.rotation.y = Math.atan2(nextPoint[0] - point[0], nextPoint[2] - point[2])
    } else if (targetCell && status === 'running') {
      const orbit = state.clock.elapsedTime * 1.7
      group.position.set(
        target.x + Math.sin(orbit) * 0.11,
        target.y + Math.sin(orbit * 2) * 0.075,
        target.z + Math.cos(orbit) * 0.11,
      )
      group.rotation.y = orbit + Math.PI
    } else {
      group.position.lerp(target, 1 - Math.exp(-delta * 7))
      group.rotation.y = state.clock.elapsedTime * (reducedMotion ? 0 : 0.08)
    }

    const trailPosition = trailGeometry.getAttribute('position')
    trailPosition.setXYZ(0, start.x, start.y - 0.08, start.z)
    trailPosition.setXYZ(1, group.position.x, group.position.y - 0.08, group.position.z)
    trailPosition.needsUpdate = true
    if (trailMaterialRef.current) {
      const travelling = journeyProgressRef.current < 1
      trailMaterialRef.current.opacity = reducedMotion ? 0 : travelling ? 0.94 : 0.18
    }
    if (targetBeaconRef.current) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 5.4) * 0.16
      targetBeaconRef.current.scale.setScalar(reducedMotion ? 1 : pulse)
      targetBeaconRef.current.rotation.z += reducedMotion ? 0 : delta * 0.9
    }
    if (targetBeaconMaterialRef.current) {
      targetBeaconMaterialRef.current.opacity = reducedMotion
        ? 0.72
        : 0.55 + Math.sin(state.clock.elapsedTime * 5.4) * 0.25
    }
    const breathe = status === 'running' && !reducedMotion
      ? 1 + Math.sin(state.clock.elapsedTime * 6) * 0.075
      : 1
    group.scale.setScalar(1.28 * breathe)
    group.rotation.z = status === 'running' && !reducedMotion
      ? Math.sin(state.clock.elapsedTime * 8) * 0.045
      : 0
  })

  const glow = status === 'complete' ? JADE : status === 'unavailable' ? GOLD : VERMILLION
  return (
    <>
      <lineSegments geometry={trailGeometry}>
        <lineBasicMaterial
          ref={trailMaterialRef}
          color={VERMILLION}
          transparent
          opacity={0.12}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </lineSegments>
      {targetCell && status === 'running' ? (
        <mesh
          ref={targetBeaconRef}
          position={boardCellPosition(targetCell, 0.27)}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[0.42, 0.045, 10, 36]} />
          <meshBasicMaterial
            ref={targetBeaconMaterialRef}
            color={VERMILLION}
            transparent
            opacity={0.72}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ) : null}
      <group ref={groupRef} position={initialPosition}>
        <lineSegments geometry={legGeometry}>
          <lineBasicMaterial color={INK} linewidth={2} />
        </lineSegments>
        <mesh scale={[1, 0.7, 1.2]} castShadow>
          <sphereGeometry args={[0.2, 18, 12]} />
          <meshStandardMaterial color={INK} emissive={glow} emissiveIntensity={0.62} metalness={0.45} roughness={0.32} />
        </mesh>
        <mesh position={[0, 0, -0.25]} scale={[1, 0.8, 1]} castShadow>
          <sphereGeometry args={[0.14, 16, 10]} />
          <meshStandardMaterial color={INK} emissive={glow} emissiveIntensity={0.52} />
        </mesh>
        <mesh position={[0, 0.11, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.12, 0.026, 8, 18]} />
          <meshBasicMaterial color={glow} blending={AdditiveBlending} />
        </mesh>
        <mesh position={[-0.06, 0.07, -0.36]}><sphereGeometry args={[0.03, 8, 6]} /><meshBasicMaterial color={GOLD} /></mesh>
        <mesh position={[0.06, 0.07, -0.36]}><sphereGeometry args={[0.03, 8, 6]} /><meshBasicMaterial color={GOLD} /></mesh>
        <pointLight color={glow} intensity={status === 'running' ? 3.4 : 1.15} distance={3.4} />
      </group>
    </>
  )
}

function WebStrands() {
  const geometry = useMemo(() => createWebGeometry(), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={VERMILLION} transparent opacity={0.22} blending={AdditiveBlending} />
    </lineSegments>
  )
}

function StarField({ reducedMotion }: { reducedMotion: boolean }) {
  const pointsRef = useRef<Points>(null)
  const geometry = useMemo(() => {
    const positions: number[] = []
    for (let index = 0; index < 110; index += 1) {
      const angle = (index * 2.399963) % (Math.PI * 2)
      const radius = 6.4 + (index % 13) * 0.38
      positions.push(
        Math.cos(angle) * radius,
        0.3 + (index % 9) * 0.42,
        Math.sin(angle) * radius,
      )
    }
    const next = new BufferGeometry()
    next.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return next
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])
  useFrame((_, delta) => {
    if (!reducedMotion && pointsRef.current) pointsRef.current.rotation.y += delta * 0.018
  })
  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial color={INK} size={0.055} transparent opacity={0.5} blending={AdditiveBlending} depthWrite={false} />
    </points>
  )
}

function SceneDirector({
  stage,
  focusCell,
  reducedMotion,
}: {
  stage: Stage
  focusCell: CellCoord | null
  reducedMotion: boolean
}) {
  const { camera } = useThree()
  const targetCamera = useMemo(() => new Vector3(...boardCameraPosition(stage)), [stage])
  const targetLookAt = useMemo(() => {
    const focus = focusCell ? boardCellPosition(focusCell) : null
    return new Vector3(...boardCameraLookAt(focus, reducedMotion))
  }, [focusCell, reducedMotion])
  const lookAt = useRef(new Vector3())

  useFrame((_, delta) => {
    if (reducedMotion) camera.position.copy(targetCamera)
    else camera.position.lerp(targetCamera, 1 - Math.exp(-delta * 2.4))
    lookAt.current.lerp(targetLookAt, reducedMotion ? 1 : 1 - Math.exp(-delta * 3.4))
    camera.lookAt(lookAt.current)
  })
  return null
}

function WebGLContextGuard({ onContextLost }: { onContextLost: () => void }) {
  const { gl } = useThree()

  useEffect(() => {
    const handleContextLoss = (event: Event) => {
      event.preventDefault()
      onContextLost()
    }

    gl.domElement.addEventListener('webglcontextlost', handleContextLoss)
    return () => gl.domElement.removeEventListener('webglcontextlost', handleContextLoss)
  }, [gl, onContextLost])

  return null
}

function LastMoveFlare({ cell, reducedMotion }: { cell: CellCoord; reducedMotion: boolean }) {
  const meshRef = useRef<Mesh>(null)
  const position = boardCellPosition(cell, 0.29)
  useFrame((state) => {
    if (!meshRef.current || reducedMotion) return
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 5.5) * 0.13
    meshRef.current.scale.setScalar(pulse)
  })
  return (
    <mesh ref={meshRef} position={position} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.23, 0.035, 8, 28]} />
      <meshBasicMaterial color={INK} transparent opacity={0.78} blending={AdditiveBlending} />
    </mesh>
  )
}

function BoardScene({
  pieces,
  stage = 'playing',
  mappingProgress = 64,
  activeSide,
  selectedPieceId,
  legalMoves = [],
  capturedCellKeys,
  highlightedCellKeys,
  latestCapture,
  portiaActivity,
  lastMove,
  disabled = false,
  reducedMotion,
  onPieceSelect,
  onCellSelect,
  onHoveredCell,
}: Board3DProps & { onHoveredCell: (cell: CellCoord | null) => void }) {
  const mappedCount = Math.max(0, Math.min(64, Math.floor(mappingProgress)))
  const legalKeys = useMemo(() => new Set(legalMoves.filter(isValidCell).map(cellKey)), [legalMoves])
  const capturedKeys = useMemo(() => toKeySet(capturedCellKeys), [capturedCellKeys])
  const highlightedKeys = useMemo(() => toKeySet(highlightedCellKeys), [highlightedCellKeys])
  const reviewedKeys = useMemo(() => toKeySet(portiaActivity?.reviewedCellKeys), [portiaActivity?.reviewedCellKeys])
  const selectedPiece = pieces.find((piece) => piece.id === selectedPieceId)
  const portiaCell = portiaActivity?.status === 'running' ? portiaActivity.currentCell : null
  const focusCell = portiaCell ?? selectedPiece?.position ?? lastMove?.to ?? null
  const seenCaptureIdRef = useRef(latestCapture?.id ?? null)
  const [activeCapture, setActiveCapture] = useState<NonNullable<RadialBoardProps['latestCapture']> | null>(null)
  const handleCellSelect = onCellSelect ?? ignoreCellSelection
  const cells = useMemo(() => Array.from({ length: 64 }, (_, index) => ({
    ring: Math.floor(index / 8),
    sector: index % 8,
  })), [])

  useEffect(() => {
    if (stage !== 'playing' || !latestCapture || seenCaptureIdRef.current === latestCapture.id) return
    seenCaptureIdRef.current = latestCapture.id
    if (reducedMotion) return
    const frame = window.requestAnimationFrame(() => setActiveCapture(latestCapture))
    const timer = window.setTimeout(() => setActiveCapture(null), 1_550)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [latestCapture, reducedMotion, stage])

  return (
    <>
      <color attach="background" args={['#050713']} />
      <fog attach="fog" args={['#050713', 10, 23]} />
      <SceneDirector stage={stage} focusCell={focusCell} reducedMotion={reducedMotion} />
      <ambientLight intensity={0.7} color="#8b95c7" />
      <hemisphereLight args={['#9fc8ff', '#130915', 1.05]} />
      <directionalLight
        castShadow
        color={GOLD}
        intensity={2.1}
        position={[-5, 9, 7]}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-far={24}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      <pointLight color={VERMILLION} intensity={4.4} distance={15} position={[4.8, 3.5, -3.8]} />
      <pointLight color={BLUE} intensity={3.1} distance={13} position={[-4.5, 2.8, 3.5]} />

      <group rotation={[0, -0.04, 0]}>
        <mesh position={[0, -0.22, 0]} receiveShadow>
          <cylinderGeometry args={[BOARD_3D_OUTER_RADIUS + 0.55, BOARD_3D_OUTER_RADIUS + 0.75, 0.28, 64]} />
          <meshStandardMaterial color="#080b19" metalness={0.62} roughness={0.3} />
        </mesh>
        <mesh position={[0, -0.38, 0]} receiveShadow>
          <cylinderGeometry args={[BOARD_3D_OUTER_RADIUS + 0.9, BOARD_3D_OUTER_RADIUS + 1.25, 0.24, 64]} />
          <meshStandardMaterial color="#2a1830" emissive={VERMILLION} emissiveIntensity={0.08} metalness={0.7} roughness={0.3} />
        </mesh>

        <WebStrands />
        {cells.map((cell, index) => {
          const key = cellKey(cell)
          const state: CellVisualState = {
            mapped: stage === 'question' || stage !== 'mapping' || index < mappedCount,
            selected: sameCell(selectedPiece?.position, cell),
            legal: legalKeys.has(key),
            captured: capturedKeys.has(key),
            highlighted: highlightedKeys.has(key),
            portiaCurrent: sameCell(portiaCell, cell),
            portiaReviewed: reviewedKeys.has(key),
            lastMove: sameCell(lastMove?.from, cell) || sameCell(lastMove?.to, cell),
          }
          return (
            <BoardCell
              cell={cell}
              state={state}
              disabled={disabled || !onCellSelect}
              reducedMotion={reducedMotion}
              onHover={onHoveredCell}
              onSelect={handleCellSelect}
              key={key}
            />
          )
        })}

        {pieces.filter((piece) => isValidCell(piece.position)).map((piece) => {
          const captureTarget = Boolean(selectedPieceId && legalKeys.has(cellKey(piece.position)))
          const interactive = !disabled && (
            captureTarget
              ? Boolean(onCellSelect)
              : Boolean(onPieceSelect) && (!activeSide || piece.side === activeSide)
          )
          const captureMove = Boolean(
            latestCapture
            && lastMove
            && piece.id === latestCapture.attacker.id
            && sameCell(lastMove.to, latestCapture.cell)
            && sameCell(piece.position, latestCapture.cell),
          )
          return (
            <AnimatedPiece
              key={piece.id}
              piece={piece}
              selected={piece.id === selectedPieceId}
              captureTarget={captureTarget}
              captureMove={captureMove}
              interactive={interactive}
              reducedMotion={reducedMotion}
              onActivate={() => {
                if (captureTarget) onCellSelect?.(piece.position)
                else onPieceSelect?.(piece.id)
              }}
            />
          )
        })}

        {activeCapture ? <CaptureEffect key={activeCapture.id} capture={activeCapture} /> : null}
        <Spider
          targetCell={portiaCell}
          status={portiaActivity?.status ?? 'resting'}
          reducedMotion={reducedMotion}
        />
        {lastMove?.to ? <LastMoveFlare cell={lastMove.to} reducedMotion={reducedMotion} /> : null}
      </group>
      <StarField reducedMotion={reducedMotion} />
    </>
  )
}

function visibleCellLabel(cell: CellCoord | null, parts: RadialBoardProps['parts']) {
  if (!cell) return null
  const index = boardCellIndex(cell)
  const part = parts[index]
  return {
    coordinate: `Ring ${cell.ring + 1} · Thread ${cell.sector + 1}`,
    title: part?.title ?? 'Unmapped signal',
    detail: part?.focus ?? 'This strand is waiting for Anansi’s signal.',
  }
}

export function WebChessBoard3D(props: Board3DProps) {
  const instructionsId = useId()
  const [hoveredCell, setHoveredCell] = useState<CellCoord | null>(null)
  const [contextReady, setContextReady] = useState(false)
  const activeCell = props.portiaActivity?.status === 'running'
    ? props.portiaActivity.currentCell
    : hoveredCell
  const label = visibleCellLabel(activeCell, props.parts)
  const portiaProgress = props.portiaActivity?.status === 'running'
    && props.portiaActivity.currentIndex
    && props.portiaActivity.totalCount
    ? ` · Signal ${props.portiaActivity.currentIndex} of ${props.portiaActivity.totalCount}`
    : ''
  const latestCaptureLabel = props.latestCapture
    ? `${props.latestCapture.attacker.side === 'white' ? 'White' : 'Black'} ${props.latestCapture.attacker.kind} captured ${props.latestCapture.captured.side} ${props.latestCapture.captured.kind}`
    : null

  return (
    <section
      className={`radial-board radial-board--3d ${props.className ?? ''}`.trim()}
      data-stage={props.stage ?? 'playing'}
      data-board-dimension="3d"
      data-interactive={!props.disabled && Boolean(props.onCellSelect) || undefined}
      aria-label="WebChess circular board in three dimensions"
      aria-describedby={instructionsId}
    >
      <p className="sr-only" id={instructionsId}>
        The immersive board supports pointer play. Choose the two-dimensional board view
        for the complete keyboard-navigable grid and individual cell descriptions.
      </p>
      <div className="radial-board-3d__viewport" data-context-ready={contextReady || undefined}>
        <Canvas
          aria-hidden="true"
          dpr={props.stage === 'mapping' ? 1 : [1, 1.5]}
          camera={{
            fov: BOARD_3D_CAMERA_FOV,
            near: 0.1,
            far: 48,
            position: boardCameraPosition(props.stage ?? 'playing'),
          }}
          shadows={props.stage === 'mapping' ? false : 'basic'}
          gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => {
            setContextReady(true)
            gl.outputColorSpace = SRGBColorSpace
          }}
          onPointerMissed={() => setHoveredCell(null)}
        >
          <WebGLContextGuard onContextLost={props.onContextLost} />
          <BoardScene {...props} onHoveredCell={setHoveredCell} />
        </Canvas>

        <div className="radial-board-3d__vignette" aria-hidden="true" />
        <div className="radial-board-3d__compass" aria-hidden="true">
          <span>N</span><span>E</span><span>S</span><span>W</span>
        </div>
      </div>
      <div className="radial-board-3d__hud" aria-hidden="true">
        <div className="radial-board-3d__status" aria-hidden="true">
          <small>{props.portiaActivity?.status === 'running' ? `Portia is crossing the web${portiaProgress}` : 'Signal under the lens'}</small>
          <strong>{label?.title ?? 'The full web is awake'}</strong>
          <span>{label?.coordinate ?? '64 interwoven signals'}</span>
          {label?.detail ? <p>{label.detail}</p> : null}
        </div>
        {latestCaptureLabel && props.stage === 'playing' ? (
          <div
            className="radial-board-3d__capture-callout"
            data-capture-id={props.latestCapture?.id}
            key={props.latestCapture?.id}
            aria-hidden="true"
          >
            <i />
            <span><small>Capture resolved</small><strong>{latestCaptureLabel}</strong></span>
          </div>
        ) : null}
        <div className="radial-board-3d__legend" aria-hidden="true">
          <span><i className="is-gold" /> weighted signal</span>
          <span><i className="is-jade" /> reviewed by Portia</span>
          <span><i className="is-pink" /> live path</span>
        </div>
      </div>
      {props.portiaActivity ? (
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {props.portiaActivity.announcement}
          {props.portiaActivity.status === 'running' && props.portiaActivity.currentLabel
            ? ` Current signal: ${props.portiaActivity.currentLabel}.`
            : ''}
        </p>
      ) : null}
    </section>
  )
}
