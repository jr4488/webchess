'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { Header } from './components/Header'
import {
  countDueWebMemoryActions,
  WebMemoryPanel,
} from './components/WebMemoryPanel'
import { LifecycleStage } from './components/stages/LifecycleStage'
import { MappingStage } from './components/stages/MappingStage'
import { PlayingStage } from './components/stages/PlayingStage'
import { QuestionStage } from './components/stages/QuestionStage'
import { ReadingStage } from './components/stages/ReadingStage'
import {
  coordKey,
  getLegalMoves,
  isSameCoord,
} from './lib/game'
import { createAutoPlayEngine } from './lib/auto-play'
import type { AutoPlayEngine } from './lib/auto-play'
import { normalizeProblemInput, problemPartAt } from './lib/problem'
import { PIECE_METAPHORS, synthesizeReading } from './lib/reading'
import { beginModelActivity } from './lib/model-activity'
import { isWebChessApiError } from './lib/webchess-api'
import type { ResearchConsentDecision } from './lib/research'
import type {
  AppendWilburObservationCommand,
  CreateWilburActionCommand,
  DurableGame,
  UpdateWilburActionCommand,
} from './lib/webchess-api'
import type {
  LifecycleAggregate,
  WebMemoryIndex,
  WilburAction,
  WilburObservation,
} from './lib/lifecycle/contracts'
import { CURRENT_WILBUR_CHARLOTTE_BINDING_VERSION } from './lib/lifecycle/contracts'
import {
  HOSTED_WEBCHESS_RUNTIME,
  OPENCLAW_WEBCHESS_RUNTIME,
} from './lib/webchess-runtime'
import type { WebChessRuntime } from './lib/webchess-runtime'
import type {
  AnswerStatus,
  CaptureRecord,
  CellCoord,
  DivisionPhase,
  DivisionStatus,
  GameOutcome,
  LastMove,
  ModelActivityState,
  Piece,
  ProblemPart,
  Side,
  Stage,
} from './types'

const EMPTY_SET = new Set<string>()
const CAST_REVEAL_INTERVAL_MS = 90
const DIVISION_PHASE_DURATION_MS = 780

function researchProgressFingerprint(
  lifecycle: LifecycleAggregate | null,
): string {
  return lifecycle?.research.map((record) =>
    `${record.id}:${record.status}:${record.updatedAt}:${record.sources.length}`,
  ).join('|') ?? ''
}

type EngineSearchMode = 'manual' | 'autoplay'

interface ActiveEngineRequest {
  generation: number
  mode: EngineSearchMode
}

type GameMutationMode = 'starting' | 'resetting'
type LifecycleMode = 'loading' | 'v2' | 'legacy'

interface ActiveGameMutation {
  mode: GameMutationMode
}

interface ActiveRestoreRequest {
  controller: AbortController
  silent: boolean
}

interface RevisionMutationIntent {
  gameId: string
  expectedRevision: number
  key: string
}

interface WilburActionIntent {
  gameId: string
  charlotteActionIndex: number
  command: CreateWilburActionCommand
  key: string
}

interface WilburStatusIntent {
  gameId: string
  actionId: string
  command: UpdateWilburActionCommand
  key: string
}

interface WilburObservationIntent {
  gameId: string
  actionId: string
  command: AppendWilburObservationCommand
  key: string
}

function observationMatchesIntent(
  observation: WilburObservation,
  command: AppendWilburObservationCommand,
): boolean {
  return observation.observedAt === command.observedAt &&
    observation.observation === command.observation &&
    observation.evidenceClassification === command.evidenceClassification &&
    observation.expectedEffect === command.expectedEffect &&
    observation.unexpectedEffect === command.unexpectedEffect &&
    observation.stakeholderResponse === command.stakeholderResponse &&
    observation.assumptionResult === command.assumptionResult &&
    observation.nextDecision === command.nextDecision
}

function isAmbiguousWilburMutationFailure(error: unknown): boolean {
  return isWebChessApiError(error) && (
    error.kind === 'transport' ||
    error.kind === 'invalid-response' ||
    (error.status !== null && error.status >= 500)
  )
}

function isAmbiguousAnswerMutationFailure(error: unknown): boolean {
  return isWebChessApiError(error) && !error.prompt && (
    error.kind === 'transport' ||
    error.kind === 'invalid-response' ||
    (error.status !== null && error.status >= 500)
  )
}

function outcomeNotice(outcome: GameOutcome): string {
  if (outcome.reason === 'king-captured' && outcome.winner) {
    const winner = outcome.winner === 'white' ? 'White' : 'Black'
    return `${winner} reached the opposing Core Purpose. The captured signals and ending are becoming an answer.`
  }
  if (outcome.reason === 'no-progress') {
    return 'The board reached a reflective standstill. The captured signals and ending are becoming an answer.'
  }
  if (outcome.reason === 'move-limit') {
    return 'The board completed its full arc. The captured signals and ending are becoming an answer.'
  }
  return 'Neither side has an open path. The captured signals and ending are becoming an answer.'
}

export function App() {
  return <WebChessExperience runtime={HOSTED_WEBCHESS_RUNTIME} />
}

export function OpenClawApp() {
  return <WebChessExperience runtime={OPENCLAW_WEBCHESS_RUNTIME} />
}

function WebChessExperience({ runtime }: { runtime: WebChessRuntime }) {
  const [game, setGame] = useState<DurableGame | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [restoreError, setRestoreError] = useState('')
  const [movePending, setMovePending] = useState(false)
  const [stage, setStage] = useState<Stage>('question')
  const [problem, setProblem] = useState('')
  const [researchConsentDecision, setResearchConsentDecision] =
    useState<ResearchConsentDecision | null>(null)
  const [parts, setParts] = useState<ProblemPart[]>([])
  const [pieces, setPieces] = useState<Piece[]>([])
  const [turn, setTurn] = useState<Side>('white')
  const [turnNumber, setTurnNumber] = useState(1)
  const [quietPlies, setQuietPlies] = useState(0)
  const [captures, setCaptures] = useState<CaptureRecord[]>([])
  const [outcome, setOutcome] = useState<GameOutcome | null>(null)
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null)
  const [focusedCell, setFocusedCell] = useState<CellCoord | null>(null)
  const [lastMove, setLastMove] = useState<LastMove | null>(null)
  const [mappingProgress, setMappingProgress] = useState(0)
  const [divisionStatus, setDivisionStatus] = useState<DivisionStatus>('idle')
  const [divisionPhase, setDivisionPhase] = useState<DivisionPhase>('analyzing')
  const [divisionModel, setDivisionModel] = useState('')
  const [divisionPrompt, setDivisionPrompt] = useState('')
  const [divisionError, setDivisionError] = useState('')
  const [divisionActivity, setDivisionActivity] = useState<ModelActivityState | null>(null)
  const [divisionTargetUnresolved, setDivisionTargetUnresolved] = useState(false)
  const [autoPlaying, setAutoPlaying] = useState(false)
  const [notice, setNotice] = useState('Choose a white piece. Its possible paths will appear.')
  const [answerStatus, setAnswerStatus] = useState<AnswerStatus>('idle')
  const [answer, setAnswer] = useState('')
  const [answerModel, setAnswerModel] = useState('')
  const [answerPrompt, setAnswerPrompt] = useState('')
  const [answerError, setAnswerError] = useState('')
  const [answerActivity, setAnswerActivity] = useState<ModelActivityState | null>(null)
  const [engineSearchMode, setEngineSearchMode] = useState<EngineSearchMode | null>(null)
  const [gameMutationMode, setGameMutationMode] = useState<GameMutationMode | null>(null)
  const [replayPending, setReplayPending] = useState(false)
  const [replayError, setReplayError] = useState('')
  const [replayTargetUnresolved, setReplayTargetUnresolved] = useState(false)
  const [lifecycle, setLifecycle] = useState<LifecycleAggregate | null>(null)
  const [lifecycleMode, setLifecycleMode] = useState<LifecycleMode>('loading')
  const [lifecycleBusy, setLifecycleBusy] = useState(false)
  const [lifecycleError, setLifecycleError] = useState('')
  const [actionPendingIndex, setActionPendingIndex] = useState<number | null>(null)
  const [wilburPending, setWilburPending] = useState(false)
  const [webMemory, setWebMemory] = useState<WebMemoryIndex | null>(null)
  const [webMemoryOpen, setWebMemoryOpen] = useState(false)
  const [webMemoryBusy, setWebMemoryBusy] = useState(false)
  const [webMemoryError, setWebMemoryError] = useState('')
  const [selectedMemoryObservationIds, setSelectedMemoryObservationIds] = useState<string[]>([])
  const restoreRequestRef = useRef<ActiveRestoreRequest | null>(null)
  const restoreRequestGenerationRef = useRef(0)
  const divisionRequestRef = useRef<AbortController | null>(null)
  const answerRequestRef = useRef<AbortController | null>(null)
  const lifecycleRequestRef = useRef<AbortController | null>(null)
  const webMemoryRequestRef = useRef<AbortController | null>(null)
  const movePendingRef = useRef(false)
  const divisionIntentRef = useRef<{
    problem: string
    memoryKey: string
    researchConsentDecision: ResearchConsentDecision
    key: string
  } | null>(null)
  const answerIntentRef = useRef<{ gameId: string; key: string } | null>(null)
  const replayIntentRef = useRef<{ gameId: string; key: string } | null>(null)
  const replayPendingRef = useRef(false)
  const startIntentRef = useRef<RevisionMutationIntent | null>(null)
  const resetIntentRef = useRef<RevisionMutationIntent | null>(null)
  const portiaIntentRef = useRef<{ gameId: string; key: string } | null>(null)
  const charlotteIntentRef = useRef<{ gameId: string; key: string } | null>(null)
  const lifecycleRetryIntentRef = useRef<{ gameId: string; key: string } | null>(null)
  const wilburActionIntentRef = useRef<WilburActionIntent | null>(null)
  const wilburStatusIntentRef = useRef<WilburStatusIntent | null>(null)
  const wilburObservationIntentRef = useRef<WilburObservationIntent | null>(null)
  const lifecycleBackoffMsRef = useRef(0)
  const activeGameMutationRef = useRef<ActiveGameMutation | null>(null)
  const gameFinishing = outcome !== null && stage === 'playing'
  const thinking = engineSearchMode !== null || movePending

  // Built on first use and torn down on unmount. It is deliberately not held in
  // state: unmounting disposes it, and under StrictMode's remount a disposed
  // engine would linger and refuse every later search.
  const engineRef = useRef<AutoPlayEngine | null>(null)
  const engineRequestGenerationRef = useRef(0)
  const activeEngineRequestRef = useRef<ActiveEngineRequest | null>(null)
  const getEngine = useCallback(() => {
    engineRef.current ??= createAutoPlayEngine()
    return engineRef.current
  }, [])

  const invalidateEngineRequest = useCallback((alwaysResetEngine = false) => {
    const hadActiveRequest = activeEngineRequestRef.current !== null
    engineRequestGenerationRef.current += 1
    activeEngineRequestRef.current = null
    if (alwaysResetEngine || hadActiveRequest) {
      engineRef.current?.reset()
    }
    setEngineSearchMode(null)
  }, [])

  const invalidateRestoreRequest = useCallback(() => {
    restoreRequestGenerationRef.current += 1
    restoreRequestRef.current?.controller.abort()
    restoreRequestRef.current = null
  }, [])

  useEffect(
    () => () => {
      engineRequestGenerationRef.current += 1
      activeEngineRequestRef.current = null
      engineRef.current?.dispose()
      engineRef.current = null
    },
    [],
  )

  const resetGameState = useCallback(() => {
    divisionRequestRef.current?.abort()
    divisionRequestRef.current = null
    answerRequestRef.current?.abort()
    answerRequestRef.current = null
    lifecycleRequestRef.current?.abort()
    lifecycleRequestRef.current = null
    divisionIntentRef.current = null
    answerIntentRef.current = null
    replayIntentRef.current = null
    replayPendingRef.current = false
    startIntentRef.current = null
    resetIntentRef.current = null
    portiaIntentRef.current = null
    charlotteIntentRef.current = null
    lifecycleRetryIntentRef.current = null
    wilburActionIntentRef.current = null
    wilburStatusIntentRef.current = null
    wilburObservationIntentRef.current = null
    lifecycleBackoffMsRef.current = 0
    movePendingRef.current = false
    invalidateEngineRequest(true)
    setStage('question')
    setProblem('')
    setResearchConsentDecision(null)
    setParts([])
    setPieces([])
    setTurn('white')
    setTurnNumber(1)
    setQuietPlies(0)
    setCaptures([])
    setOutcome(null)
    setSelectedPieceId(null)
    setFocusedCell(null)
    setLastMove(null)
    setMappingProgress(0)
    setDivisionStatus('idle')
    setDivisionPhase('analyzing')
    setDivisionModel('')
    setDivisionPrompt('')
    setDivisionError('')
    setDivisionActivity(null)
    setDivisionTargetUnresolved(false)
    setAutoPlaying(false)
    setAnswerStatus('idle')
    setAnswer('')
    setAnswerModel('')
    setAnswerPrompt('')
    setAnswerError('')
    setAnswerActivity(null)
    setMovePending(false)
    setReplayPending(false)
    setReplayError('')
    setReplayTargetUnresolved(false)
    setLifecycle(null)
    setLifecycleMode('loading')
    setLifecycleBusy(false)
    setLifecycleError('')
    setActionPendingIndex(null)
    setWilburPending(false)
    setSelectedMemoryObservationIds([])
    setNotice('Choose a white piece. Its possible paths will appear.')
  }, [invalidateEngineRequest])

  const applyDurableGame = useCallback((
    nextGame: DurableGame,
    options: {
      animateMapping?: boolean
      preserveAutoPlay?: boolean
      preserveLifecycle?: boolean
    } = {},
  ) => {
    const division = nextGame.division
    const state = nextGame.state
    const storedAnswer = nextGame.answer
    const hasCompletedDivision = division?.parts.length === 64
    const animateMapping = Boolean(options.animateMapping && hasCompletedDivision)

    invalidateEngineRequest(true)
    if (!options.preserveAutoPlay) setAutoPlaying(false)
    setSelectedPieceId(null)
    setGame(nextGame)
    setDivisionTargetUnresolved(false)
    if (nextGame.status !== 'dividing') {
      divisionIntentRef.current = null
    }
    setProblem(nextGame.problem)
    setResearchConsentDecision(nextGame.researchConsent.decision)
    setParts(division ? [...division.parts] : [])
    setDivisionModel(division?.model ?? '')
    setDivisionPrompt(division?.prompt ?? '')
    setDivisionError(
      nextGame.status === 'division_failed'
        ? 'The model could not complete a valid 64-facet division. Try again.'
        : '',
    )
    setDivisionStatus(
      nextGame.status === 'dividing'
        ? 'loading'
        : nextGame.status === 'division_failed'
          ? 'error'
          : hasCompletedDivision
            ? 'success'
            : 'idle',
    )
    setDivisionPhase(
      animateMapping ? 'facets-received' : hasCompletedDivision ? 'casting' : 'analyzing',
    )
    setMappingProgress(animateMapping ? 0 : hasCompletedDivision ? 64 : 0)
    setDivisionActivity(
      nextGame.status === 'dividing'
        ? beginModelActivity('division')
        : null,
    )

    setPieces(state ? state.pieces.map((piece) => ({
      ...piece,
      position: { ...piece.position },
    })) : [])
    setTurn(state?.turn ?? 'white')
    setTurnNumber((state?.completedPlies ?? 0) + 1)
    setQuietPlies(state?.quietPlies ?? 0)
    setCaptures(state ? state.captures.map((capture) => ({
      ...capture,
      attacker: { ...capture.attacker, position: { ...capture.attacker.position } },
      captured: { ...capture.captured, position: { ...capture.captured.position } },
      cell: { ...capture.cell },
      part: { ...capture.part },
    })) : [])
    setOutcome(state?.outcome ?? null)
    setLastMove(state?.lastMove
      ? {
          from: { ...state.lastMove.from },
          to: { ...state.lastMove.to },
        }
      : null)
    setFocusedCell(state?.lastMove?.to ?? null)

    const isTerminal =
      nextGame.status === 'completed' ||
      nextGame.status === 'answering' ||
      nextGame.status === 'answer_failed' ||
      nextGame.status === 'answered'
    if (!options.preserveLifecycle) {
      setLifecycle(null)
      setLifecycleMode(isTerminal ? 'loading' : 'v2')
      setLifecycleBusy(false)
      setLifecycleError('')
    } else {
      setLifecycleMode('v2')
      setLifecycleError('')
    }

    setAnswer(storedAnswer?.answer ?? '')
    setAnswerModel(storedAnswer?.model ?? '')
    setAnswerPrompt(storedAnswer?.prompt ?? '')
    setAnswerError(
      nextGame.status === 'answer_failed'
        ? 'The server replay is complete, but the model answer failed. You can try again.'
        : '',
    )
    setAnswerStatus(
      storedAnswer
        ? 'success'
        : nextGame.status === 'completed' || nextGame.status === 'answering'
          ? 'loading'
          : nextGame.status === 'answer_failed'
            ? 'error'
            : 'idle',
    )
    setAnswerActivity((current) => {
      if (nextGame.status !== 'completed' && nextGame.status !== 'answering') {
        return null
      }
      return current?.operation === 'answer' && current.status === 'active'
        ? current
        : beginModelActivity('answer')
    })

    if (nextGame.status === 'integrity_error') {
      setRestoreError(
        'This saved game could not be verified against the current circular-chess rules.',
      )
      setStage('question')
    } else if (
      nextGame.status === 'completed' ||
      nextGame.status === 'answering' ||
      nextGame.status === 'answer_failed' ||
      nextGame.status === 'answered'
    ) {
      setRestoreError('')
      setStage('reading')
    } else if (nextGame.status === 'playing') {
      setRestoreError('')
      setNotice(
        state?.completedPlies
          ? `Saved at move ${state.completedPlies}. ${state.turn === 'white' ? 'White' : 'Black'} moves next.`
          : 'White begins at the edge. Choose a piece, or let the board play to an ending.',
      )
      setStage('playing')
    } else {
      setRestoreError('')
      setStage('mapping')
    }
  }, [invalidateEngineRequest])

  const selectedPiece = useMemo(
    () => pieces.find((piece) => piece.id === selectedPieceId) ?? null,
    [pieces, selectedPieceId],
  )
  const legalMoves = useMemo(
    () => (selectedPiece ? getLegalMoves(selectedPiece, pieces) : []),
    [pieces, selectedPiece],
  )
  const focusedPart = useMemo(() => {
    if (parts.length !== 64) return null
    if (focusedCell) return problemPartAt(parts, focusedCell)
    return captures.at(-1)?.part ?? null
  }, [captures, focusedCell, parts])
  const reading = useMemo(
    () => synthesizeReading(problem, captures, parts),
    [captures, parts, problem],
  )
  const captureKeys = useMemo(
    () => new Set(captures.map((capture) => coordKey(capture.cell))),
    [captures],
  )
  const focusedKeys = useMemo(
    () => (focusedCell ? new Set([coordKey(focusedCell)]) : EMPTY_SET),
    [focusedCell],
  )

  const restoreCurrentGame = useCallback(async (
    options: { silent?: boolean } = {},
  ) => {
    const silent = Boolean(options.silent)
    if (
      silent &&
      restoreRequestRef.current &&
      !restoreRequestRef.current.silent
    ) {
      return
    }

    invalidateRestoreRequest()
    const controller = new AbortController()
    const generation = restoreRequestGenerationRef.current
    const activeRequest: ActiveRestoreRequest = { controller, silent }
    restoreRequestRef.current = activeRequest
    if (!silent) {
      setRestoring(true)
      setRestoreError('')
    }

    try {
      const current = await runtime.api.getCurrentGame({ signal: controller.signal })
      if (
        controller.signal.aborted ||
        restoreRequestGenerationRef.current !== generation ||
        restoreRequestRef.current !== activeRequest
      ) return

      if (current) {
        applyDurableGame(current)
      } else {
        resetGameState()
        setGame(null)
      }
    } catch (error) {
      if (
        controller.signal.aborted ||
        restoreRequestGenerationRef.current !== generation ||
        restoreRequestRef.current !== activeRequest
      ) return
      if (
        isWebChessApiError(error) &&
        error.kind === 'authentication-required'
      ) {
        if (runtime.signInPath) window.location.assign(runtime.signInPath)
        return
      }
      setRestoreError(
        error instanceof Error
          ? error.message
          : 'WebChess could not restore your saved game.',
      )
    } finally {
      if (
        restoreRequestGenerationRef.current === generation &&
        restoreRequestRef.current === activeRequest
      ) {
        restoreRequestRef.current = null
        if (!silent) setRestoring(false)
      }
    }
  }, [
    applyDurableGame,
    invalidateRestoreRequest,
    resetGameState,
    runtime.api,
    runtime.signInPath,
  ])

  const refreshWebMemory = useCallback(async () => {
    webMemoryRequestRef.current?.abort()
    const controller = new AbortController()
    webMemoryRequestRef.current = controller
    setWebMemoryBusy(true)
    setWebMemoryError('')
    try {
      const memory = await runtime.api.getWebMemory({ signal: controller.signal })
      if (controller.signal.aborted || webMemoryRequestRef.current !== controller) return
      setWebMemory(memory)
    } catch (error) {
      if (controller.signal.aborted || webMemoryRequestRef.current !== controller) return
      if (isWebChessApiError(error) && error.kind === 'authentication-required') {
        if (runtime.signInPath) window.location.assign(runtime.signInPath)
        return
      }
      setWebMemoryError(
        error instanceof Error
          ? error.message
          : 'WebChess could not load the saved case memory.',
      )
    } finally {
      if (webMemoryRequestRef.current === controller) {
        webMemoryRequestRef.current = null
        setWebMemoryBusy(false)
      }
    }
  }, [runtime.api, runtime.signInPath])

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => void restoreCurrentGame(), 0)
    const memoryTimer = window.setTimeout(() => void refreshWebMemory(), 0)
    return () => {
      window.clearTimeout(restoreTimer)
      window.clearTimeout(memoryTimer)
      invalidateRestoreRequest()
      webMemoryRequestRef.current?.abort()
    }
  }, [invalidateRestoreRequest, refreshWebMemory, restoreCurrentGame])

  useEffect(() => {
    if (game?.status !== 'dividing' || gameMutationMode !== null) return

    let cancelled = false
    let pollTimer: number | null = null
    const schedulePoll = () => {
      pollTimer = window.setTimeout(() => {
        void restoreCurrentGame({ silent: true }).finally(() => {
          if (!cancelled) schedulePoll()
        })
      }, 1_500)
    }
    schedulePoll()

    return () => {
      cancelled = true
      if (pollTimer !== null) window.clearTimeout(pollTimer)
    }
  }, [game?.status, gameMutationMode, restoreCurrentGame])

  useEffect(() => {
    if (
      stage !== 'mapping' ||
      divisionStatus !== 'success' ||
      divisionPhase !== 'casting' ||
      parts.length !== 64
    ) return

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      const revealTimer = window.setTimeout(() => setMappingProgress(64), 0)
      return () => window.clearTimeout(revealTimer)
    }

    const interval = window.setInterval(() => {
      setMappingProgress((current) => {
        if (current >= 64) {
          window.clearInterval(interval)
          return 64
        }
        return current + 1
      })
    }, CAST_REVEAL_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [divisionPhase, divisionStatus, parts.length, stage])

  useEffect(() => {
    if (
      stage !== 'mapping' ||
      divisionStatus !== 'success' ||
      parts.length !== 64 ||
      divisionPhase === 'casting'
    ) return

    const phases: readonly DivisionPhase[] = [
      'facets-received',
      'facets-permuted',
      'hexagrams-permuted',
      'paired',
      'casting',
    ]
    const phaseIndex = phases.indexOf(divisionPhase)
    const nextPhase = phases[phaseIndex + 1]
    if (!nextPhase) return

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(() => setDivisionPhase(nextPhase), reduceMotion ? 0 : DIVISION_PHASE_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [divisionPhase, divisionStatus, parts.length, stage])

  useEffect(() => () => {
    invalidateRestoreRequest()
    divisionRequestRef.current?.abort()
    answerRequestRef.current?.abort()
    lifecycleRequestRef.current?.abort()
    webMemoryRequestRef.current?.abort()
  }, [invalidateRestoreRequest])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (stage === 'question') {
        document.getElementById('problem')?.focus()
        return
      }

      const stageRoot = document.querySelector<HTMLElement>('[data-stage-root]')
      stageRoot?.focus({ preventScroll: true })
      stageRoot?.scrollIntoView?.({ block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [lifecycleMode, stage])

  const movePiece = useCallback(
    async (pieceId: string, destination: CellCoord): Promise<boolean> => {
      const movingPiece = pieces.find((piece) => piece.id === pieceId)
      if (
        !game ||
        game.status !== 'playing' ||
        movePendingRef.current ||
        !movingPiece ||
        movingPiece.side !== turn ||
        parts.length !== 64 ||
        outcome
      ) return false

      movePendingRef.current = true
      setMovePending(true)
      try {
        const saved = await runtime.api.submitMove(game.id, {
          expectedRevision: game.revision,
          pieceId,
          to: destination,
        }, {
          idempotencyKey: runtime.api.createIdempotencyKey(),
        })
        const nextState = saved.state
        if (!nextState) throw new Error('The server did not return the saved board.')

        const newEvents = nextState.events.slice(game.state?.events.length ?? 0)
        const forcedPass = newEvents.some((event) => event.type === 'forced-pass')
        const newCapture = nextState.captures.length > captures.length
          ? nextState.captures.at(-1)
          : null
        const movedEvent = [...newEvents]
          .reverse()
          .find((event) => event.type === 'move')
        const promoted = movedEvent?.type === 'move' && movedEvent.promotedTo === 'queen'
        const nextSide = nextState.turn === 'white' ? 'White' : 'Black'

        applyDurableGame(saved, { preserveAutoPlay: autoPlaying })
        if (nextState.outcome) {
          setNotice(outcomeNotice(nextState.outcome))
        } else if (newCapture) {
          setNotice(
            `${newCapture.narration} ${
              forcedPass
                ? `The opposing side has no open path and passes. ${nextSide} moves again.`
                : `${nextSide} moves next.`
            }`,
          )
        } else if (promoted) {
          setNotice(
            `A pawn crossed the whole question and became agency: a new queen. ${nextSide} moves next.`,
          )
        } else {
          const part = problemPartAt(parts, destination)
          setNotice(
            `${movingPiece.kind} moved through ${part.dimension.toLowerCase()}: ${part.keyword}. ${
              forcedPass
                ? `The opposing side passes. ${nextSide} moves again.`
                : `${nextSide} moves next.`
            }`,
          )
        }
        return true
      } catch (error) {
        if (
          isWebChessApiError(error) &&
          error.kind === 'authentication-required'
        ) {
          if (runtime.signInPath) window.location.assign(runtime.signInPath)
          return false
        }
        if (
          isWebChessApiError(error) &&
          (error.kind === 'conflict' || error.kind === 'transport')
        ) {
          await restoreCurrentGame()
        }
        setAutoPlaying(false)
        setNotice(
          error instanceof Error
            ? error.message
            : 'That move could not be saved. The board has been restored.',
        )
        return false
      } finally {
        movePendingRef.current = false
        setMovePending(false)
      }
    },
    [
      applyDurableGame,
      autoPlaying,
      captures.length,
      game,
      outcome,
      parts,
      pieces,
      restoreCurrentGame,
      runtime.api,
      runtime.signInPath,
      turn,
    ],
  )

  const activeGameId = game?.id

  const playOneTurn = useCallback(async (mode: EngineSearchMode) => {
    if (
      !activeGameId ||
      stage !== 'playing' ||
      outcome ||
      movePendingRef.current ||
      activeEngineRequestRef.current ||
      (mode === 'manual' && autoPlaying) ||
      (mode === 'autoplay' && !autoPlaying)
    ) return

    const generation = engineRequestGenerationRef.current + 1
    engineRequestGenerationRef.current = generation
    activeEngineRequestRef.current = { generation, mode }
    setEngineSearchMode(mode)
    // A game id is durable across refreshes and unique for every bounded replay.
    // Including it in the engine seed keeps one saved trajectory reproducible
    // without forcing every retry of the same question down the same path.
    const result = await getEngine().chooseMove(pieces, turn, `${activeGameId}/${turnNumber}`, {
      completedPlies: Math.max(0, turnNumber - 1),
      quietPlies,
    })

    const activeRequest = activeEngineRequestRef.current
    if (
      engineRequestGenerationRef.current !== generation ||
      activeRequest?.generation !== generation ||
      activeRequest.mode !== mode
    ) return

    activeEngineRequestRef.current = null
    setEngineSearchMode(null)

    if (result.status === 'superseded') {
      if (mode === 'autoplay') setAutoPlaying(false)
      return
    }

    if (result.status === 'failed') {
      setAutoPlaying(false)
      setNotice(`${result.message} Move a piece yourself to continue.`)
      return
    }

    const choice = result.move
    if (!choice) {
      setAutoPlaying(false)
      setNotice(
        'The move engine found no move in a server-verified active position. The saved board is being restored.',
      )
      await restoreCurrentGame()
      return
    }

    if (!await movePiece(choice.pieceId, choice.to)) {
      setAutoPlaying(false)
      setNotice('The move engine returned a move that no longer fits this position. Choose a piece yourself to continue.')
    }
  }, [
    autoPlaying,
    activeGameId,
    getEngine,
    movePiece,
    outcome,
    pieces,
    quietPlies,
    restoreCurrentGame,
    stage,
    turn,
    turnNumber,
  ])

  useEffect(() => {
    if (!autoPlaying || stage !== 'playing' || outcome || movePending) return

    // The search itself takes a moment, so the pause before it only has to keep
    // a quick reply from erasing the move the viewer just watched land.
    const timer = window.setTimeout(() => void playOneTurn('autoplay'), 320)
    return () => window.clearTimeout(timer)
  }, [autoPlaying, movePending, outcome, playOneTurn, stage])

  const refreshLifecycle = useCallback(async (): Promise<LifecycleAggregate | null> => {
    const current = game
    if (!current || !outcome) return null
    lifecycleRequestRef.current?.abort()
    const controller = new AbortController()
    lifecycleRequestRef.current = controller
    setLifecycleBusy(true)
    setLifecycleError('')
    try {
      const restored = await runtime.api.getGameLifecycle(current.id, {
        signal: controller.signal,
      })
      if (controller.signal.aborted) return null
      setLifecycle(restored)
      setLifecycleMode('v2')
      const actionIntent = wilburActionIntentRef.current
      if (
        actionIntent?.gameId === current.id &&
        restored.wilburActions.some(
          (action) => action.charlotteBindingVersion ===
              CURRENT_WILBUR_CHARLOTTE_BINDING_VERSION &&
            action.charlotteActionIndex === actionIntent.charlotteActionIndex,
        )
      ) {
        wilburActionIntentRef.current = null
      }
      const statusIntent = wilburStatusIntentRef.current
      if (
        statusIntent?.gameId === current.id &&
        restored.wilburActions.some(
          (action) => action.id === statusIntent.actionId &&
            action.status === statusIntent.command.status,
        )
      ) {
        wilburStatusIntentRef.current = null
      }
      const observationIntent = wilburObservationIntentRef.current
      if (
        observationIntent?.gameId === current.id &&
        restored.wilburObservations.some(
          (observation) => observation.actionId === observationIntent.actionId &&
            observationMatchesIntent(observation, observationIntent.command),
        )
      ) {
        wilburObservationIntentRef.current = null
      }
      if (restored.charlotteRenderedAnswer) {
        setAnswer(restored.charlotteRenderedAnswer)
        setAnswerStatus('success')
        setAnswerActivity(null)
      } else if (current.answer) {
        setAnswer(current.answer.answer)
        setAnswerModel(current.answer.model)
        setAnswerPrompt(current.answer.prompt)
        setAnswerStatus('success')
        setAnswerActivity(null)
      } else {
        setAnswerStatus('idle')
        setAnswerActivity(null)
      }
      return restored
    } catch (error) {
      if (controller.signal.aborted) return null
      if (isWebChessApiError(error) && error.kind === 'not-found') {
        setLifecycleMode('legacy')
        return null
      }
      if (
        isWebChessApiError(error) &&
        error.kind === 'authentication-required'
      ) {
        if (runtime.signInPath) window.location.assign(runtime.signInPath)
        return null
      }
      setLifecycleError(
        error instanceof Error
          ? error.message
          : 'WebChess could not restore the lifecycle record.',
      )
      return null
    } finally {
      if (lifecycleRequestRef.current === controller) {
        lifecycleRequestRef.current = null
        setLifecycleBusy(false)
      }
    }
  }, [game, outcome, runtime.api, runtime.signInPath])

  useEffect(() => {
    if (
      stage !== 'reading' ||
      !outcome ||
      !game ||
      lifecycleMode !== 'loading'
    ) return
    const timer = window.setTimeout(() => void refreshLifecycle(), 0)
    return () => window.clearTimeout(timer)
  }, [game, lifecycleMode, outcome, refreshLifecycle, stage])

  useEffect(() => {
    if (
      stage !== 'reading' ||
      lifecycleMode !== 'v2' ||
      !lifecycle ||
      !game ||
      !outcome
    ) return

    if (lifecycle.state === 'charlotte_unavailable') {
      charlotteIntentRef.current = null
      lifecycleBackoffMsRef.current = 0
      lifecycleRequestRef.current?.abort()
      return
    }

    if (lifecycleBusy || lifecycleError) return

    const portiaState =
      lifecycle.state === 'chess_terminal' ||
      lifecycle.state === 'portia_pending' ||
      lifecycle.state === 'portia_running' ||
      lifecycle.state === 'portia_complete'
    const answerState =
      lifecycle.state === 'gate_passed' && game.status === 'completed'
    const charlotteState =
      (lifecycle.state === 'gate_passed' && game.status === 'answered') ||
      lifecycle.state === 'charlotte_pending' ||
      lifecycle.state === 'charlotte_running'
    if (!portiaState && !answerState && !charlotteState) return

    const delay = Math.max(
      lifecycleBackoffMsRef.current,
      lifecycle.state === 'portia_running' ||
      lifecycle.state === 'charlotte_running'
        ? 1_500
        : 0,
    )
    const timer = window.setTimeout(() => {
      const controller = new AbortController()
      lifecycleRequestRef.current = controller
      setLifecycleBusy(true)
      const existingIntent = portiaState
        ? portiaIntentRef.current
        : answerState
          ? answerIntentRef.current
          : charlotteIntentRef.current
      const intent = existingIntent?.gameId === game.id
        ? existingIntent
        : { gameId: game.id, key: runtime.api.createIdempotencyKey() }
      if (portiaState) portiaIntentRef.current = intent
      else if (answerState) answerIntentRef.current = intent
      else charlotteIntentRef.current = intent

      const advance = async () => {
        if (portiaState) {
          const advanced = await runtime.api.runPortia(
            game.id,
            { expectedRevision: game.revision },
            { idempotencyKey: intent.key, signal: controller.signal },
          )
          if (controller.signal.aborted) return
          portiaIntentRef.current = null
          lifecycleBackoffMsRef.current = 0
          setLifecycle(advanced)
          return
        }
        if (answerState) {
          const generated = await runtime.api.requestGameAnswer(
            game.id,
            { expectedRevision: game.revision },
            { idempotencyKey: intent.key, signal: controller.signal },
          )
          if (controller.signal.aborted) return
          answerIntentRef.current = null
          lifecycleBackoffMsRef.current = 0
          applyDurableGame(generated.game, { preserveLifecycle: true })
          setAnswer(generated.answer.answer)
          setAnswerModel(generated.answer.model)
          setAnswerPrompt(generated.answer.prompt)
          setAnswerStatus('success')
          setAnswerActivity(null)
          return
        }
        const advanced = await runtime.api.runCharlotte(
          game.id,
          { expectedRevision: game.revision },
          { idempotencyKey: intent.key, signal: controller.signal },
        )
        if (controller.signal.aborted) return
        charlotteIntentRef.current = null
        lifecycleBackoffMsRef.current = 0
        setLifecycle(advanced)
        if (advanced.charlotteRenderedAnswer) {
          setAnswer(advanced.charlotteRenderedAnswer)
          setAnswerStatus('success')
          setAnswerActivity(null)
        }
      }

      void advance().catch(async (error: unknown) => {
        if (controller.signal.aborted) return
        if (
          answerState &&
          isWebChessApiError(error) &&
          error.kind === 'http-error' &&
          (error.status === 502 || error.status === 504)
        ) {
          if (error.prompt) answerIntentRef.current = null
          lifecycleBackoffMsRef.current = 0
          const failurePrompt = error.prompt
          await restoreCurrentGame({ silent: true })
          if (failurePrompt) {
            setAnswerPrompt(failurePrompt)
            setAnswerError(error.message)
            setAnswerStatus('error')
            setAnswerActivity(null)
          }
          return
        }
        const recoverable = isWebChessApiError(error) && (
          error.kind === 'conflict' ||
          error.kind === 'rate-limited' ||
          error.kind === 'transport' ||
          (error.kind === 'http-error' &&
            (error.status === 502 || error.status === 504))
        )
        if (recoverable) {
          const requestedDelay = isWebChessApiError(error)
            ? (error.retryAfterSeconds ?? 0) * 1_000
            : 0
          lifecycleBackoffMsRef.current = Math.min(
            10_000,
            Math.max(
              requestedDelay,
              lifecycleBackoffMsRef.current > 0
                ? lifecycleBackoffMsRef.current * 2
                : 1_500,
            ),
          )
          return
        }
        if (portiaState) portiaIntentRef.current = null
        else if (answerState) answerIntentRef.current = null
        else charlotteIntentRef.current = null
        setLifecycleError(
          error instanceof Error
            ? error.message
            : 'The lifecycle stage could not be completed.',
        )
      }).finally(() => {
        if (lifecycleRequestRef.current === controller) {
          lifecycleRequestRef.current = null
          setLifecycleBusy(false)
        }
      })
    }, delay)
    return () => window.clearTimeout(timer)
  }, [
    game,
    applyDurableGame,
    lifecycle,
    lifecycleBusy,
    lifecycleError,
    lifecycleMode,
    outcome,
    runtime.api,
    stage,
    restoreCurrentGame,
  ])

  useEffect(() => {
    if (
      stage !== 'reading' ||
      lifecycleMode !== 'v2' ||
      lifecycle?.state !== 'gate_passed' ||
      game?.status !== 'answering'
    ) return

    let cancelled = false
    let timer: number | null = null
    const poll = () => {
      timer = window.setTimeout(() => {
        void restoreCurrentGame({ silent: true }).finally(() => {
          if (!cancelled) poll()
        })
      }, 1_500)
    }
    poll()
    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [game?.status, lifecycle?.state, lifecycleMode, restoreCurrentGame, stage])

  useEffect(() => {
    const pollingGameId = game?.id ?? null
    const pollingLifecycleState = lifecycle?.state ?? null
    if (
      stage !== 'reading' ||
      lifecycleMode !== 'v2' ||
      !lifecycleBusy ||
      pollingGameId === null ||
      !(
        pollingLifecycleState === 'chess_terminal' ||
        pollingLifecycleState === 'portia_pending' ||
        pollingLifecycleState === 'portia_running' ||
        pollingLifecycleState === 'charlotte_pending' ||
        pollingLifecycleState === 'charlotte_running'
      )
    ) return

    let cancelled = false
    let timer: number | null = null
    const controller = new AbortController()
    const poll = () => {
      timer = window.setTimeout(() => {
        void runtime.api.getGameLifecycle(pollingGameId, {
          signal: controller.signal,
        }).then((latest) => {
          if (!cancelled) {
            setLifecycle((current) =>
              current?.id === latest.id &&
              current.revision === latest.revision &&
              current.updatedAt === latest.updatedAt &&
              researchProgressFingerprint(current) ===
                researchProgressFingerprint(latest)
                ? current
                : latest)
          }
        }).catch(() => {
          // The foreground mutation owns user-facing errors. This poll exists
          // only to reveal durable progress while that request is in flight.
        }).finally(() => {
          if (!cancelled) poll()
        })
      }, 750)
    }
    poll()
    return () => {
      cancelled = true
      controller.abort()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [
    game?.id,
    lifecycle?.state,
    lifecycleBusy,
    lifecycleMode,
    runtime.api,
    stage,
  ])

  useEffect(() => {
    if (
      stage !== 'reading' ||
      lifecycleMode !== 'legacy' ||
      !outcome ||
      answerStatus !== 'loading' ||
      !game
    ) return

    if (game.status === 'answering') {
      let cancelled = false
      let pollTimer: number | null = null
      const schedulePoll = () => {
        pollTimer = window.setTimeout(() => {
          void restoreCurrentGame({ silent: true }).finally(() => {
            if (!cancelled) schedulePoll()
          })
        }, 1_500)
      }
      schedulePoll()

      return () => {
        cancelled = true
        if (pollTimer !== null) window.clearTimeout(pollTimer)
      }
    }
    if (game.status !== 'completed' && game.status !== 'answer_failed') return

    const controller = new AbortController()
    answerRequestRef.current = controller
    const generateAnswer = async () => {
      try {
        const existingIntent = answerIntentRef.current
        const intent = existingIntent?.gameId === game.id
          ? existingIntent
          : { gameId: game.id, key: runtime.api.createIdempotencyKey() }
        answerIntentRef.current = intent
        const generated = await runtime.api.requestGameAnswer(game.id, {
          expectedRevision: game.revision,
        }, {
          idempotencyKey: intent.key,
          signal: controller.signal,
        })
        if (controller.signal.aborted || answerRequestRef.current !== controller) return
        answerIntentRef.current = null
        applyDurableGame(generated.game)
      } catch (error) {
        if (controller.signal.aborted) return
        if (
          isWebChessApiError(error) &&
          error.kind === 'authentication-required'
        ) {
          if (runtime.signInPath) window.location.assign(runtime.signInPath)
          return
        }
        if (!isAmbiguousAnswerMutationFailure(error)) {
          answerIntentRef.current = null
        }
        if (isWebChessApiError(error) && error.kind === 'conflict') {
          await restoreCurrentGame()
          return
        }
        if (isWebChessApiError(error) && error.prompt) {
          setAnswerPrompt(error.prompt)
        }
        setAnswerError(
          error instanceof Error
            ? error.message
            : 'The model answer could not be completed.',
        )
        setAnswerStatus('error')
        setAnswerActivity((current) => current
          ? { ...current, status: 'error', lastUpdatedAt: Date.now() }
          : current)
      } finally {
        if (answerRequestRef.current === controller) {
          answerRequestRef.current = null
        }
      }
    }

    void generateAnswer()
    return () => controller.abort()
  }, [
    answerStatus,
    applyDurableGame,
    game,
    lifecycleMode,
    outcome,
    restoreCurrentGame,
    runtime.api,
    runtime.signInPath,
    stage,
  ])

  const clearAnswer = () => {
    answerRequestRef.current?.abort()
    answerRequestRef.current = null
    setAnswerStatus('idle')
    setAnswer('')
    setAnswerModel('')
    setAnswerPrompt('')
    setAnswerError('')
    setAnswerActivity(null)
  }

  const analyzeProblem = async (subject: string) => {
    if (!researchConsentDecision) return
    divisionRequestRef.current?.abort()
    const controller = new AbortController()
    divisionRequestRef.current = controller
    const existingIntent = divisionIntentRef.current
    const memoryObservationIds = [...selectedMemoryObservationIds]
    const memoryKey = memoryObservationIds.join(':')
    const intent = existingIntent?.problem === subject &&
      existingIntent.memoryKey === memoryKey &&
      existingIntent.researchConsentDecision === researchConsentDecision
      ? existingIntent
      : {
          problem: subject,
          memoryKey,
          researchConsentDecision,
          key: runtime.api.createIdempotencyKey(),
        }
    divisionIntentRef.current = intent
    const activity = beginModelActivity('division')

    setParts([])
    setMappingProgress(0)
    setDivisionStatus('loading')
    setDivisionPhase('analyzing')
    setDivisionModel('')
    setDivisionPrompt('')
    setDivisionError('')
    setDivisionActivity(activity)
    setDivisionTargetUnresolved(true)

    try {
      const divided = await runtime.api.divideProblem(subject, {
        idempotencyKey: intent.key,
        memoryObservationIds,
        researchConsentDecision: intent.researchConsentDecision,
        signal: controller.signal,
      })
      if (controller.signal.aborted || divisionRequestRef.current !== controller) return

      divisionIntentRef.current = null
      setSelectedMemoryObservationIds([])
      applyDurableGame(divided, { animateMapping: true })
      if (memoryObservationIds.length > 0) void refreshWebMemory()
    } catch (error) {
      if (controller.signal.aborted || divisionRequestRef.current !== controller) return
      if (
        isWebChessApiError(error) &&
        error.kind === 'authentication-required'
      ) {
        if (runtime.signInPath) window.location.assign(runtime.signInPath)
        return
      }

      const errorMessage = error instanceof Error
        ? error.message
        : 'The model could not divide this problem.'
      let recoveryError: unknown

      try {
        const recovered = await runtime.api.recoverDivisionIntent(intent.key, {
          signal: controller.signal,
        })
        if (controller.signal.aborted || divisionRequestRef.current !== controller) return

        if (recovered.status === 'abandoned') {
          resetGameState()
          setGame(null)
          setRestoreError('')
          return
        }

        setSelectedMemoryObservationIds([])
        applyDurableGame(recovered, {
          animateMapping: recovered.status === 'mapped',
        })
        if (memoryObservationIds.length > 0) void refreshWebMemory()
        if (recovered.status === 'division_failed') {
          setDivisionError(errorMessage)
          setDivisionStatus('error')
          setDivisionActivity({
            ...activity,
            status: 'error',
            lastUpdatedAt: Date.now(),
          })
        }
        return
      } catch (recoveryFailure) {
        if (controller.signal.aborted || divisionRequestRef.current !== controller) return
        if (
          isWebChessApiError(recoveryFailure) &&
          recoveryFailure.kind === 'authentication-required'
        ) {
          if (runtime.signInPath) window.location.assign(runtime.signInPath)
          return
        }
        recoveryError = recoveryFailure
      }

      const originalFailureWasDefinitive =
        isWebChessApiError(error) &&
        error.kind !== 'transport' &&
        error.kind !== 'invalid-response'
      const recoveryReportedAbsent =
        isWebChessApiError(recoveryError) &&
        recoveryError.kind === 'not-found'
      const targetDefinitelyAbsent =
        recoveryReportedAbsent &&
        (runtime.kind === 'openclaw' || originalFailureWasDefinitive)

      setDivisionTargetUnresolved(!targetDefinitelyAbsent)
      if (targetDefinitelyAbsent) divisionIntentRef.current = null
      setParts([])
      setMappingProgress(0)
      setDivisionPrompt('')
      setDivisionError(errorMessage)
      setDivisionStatus('error')
      setDivisionActivity({
        ...activity,
        status: 'error',
        lastUpdatedAt: Date.now(),
      })
    } finally {
      if (divisionRequestRef.current === controller) {
        divisionRequestRef.current = null
      }
    }
  }

  const beginMapping = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleaned = normalizeProblemInput(problem)
    if (cleaned.length < 12 || !researchConsentDecision) return

    invalidateEngineRequest(true)
    setProblem(cleaned)
    setStage('mapping')
    void analyzeProblem(cleaned)
  }

  const retryDivision = () => {
    void analyzeProblem(problem)
  }

  const beginPlay = async () => {
    const current = game
    if (
      !current ||
      parts.length !== 64 ||
      divisionStatus !== 'success' ||
      mappingProgress < 64 ||
      activeGameMutationRef.current
    ) return

    const mutation: ActiveGameMutation = { mode: 'starting' }
    activeGameMutationRef.current = mutation
    setGameMutationMode(mutation.mode)
    const existingIntent = startIntentRef.current
    const intent = (
      existingIntent?.gameId === current.id &&
      existingIntent.expectedRevision === current.revision
    )
      ? existingIntent
      : {
          gameId: current.id,
          expectedRevision: current.revision,
          key: runtime.api.createIdempotencyKey(),
        }
    startIntentRef.current = intent

    try {
      const started = await runtime.api.startGame(current.id, {
        expectedRevision: current.revision,
      }, {
        idempotencyKey: intent.key,
      })
      if (activeGameMutationRef.current !== mutation) return
      if (startIntentRef.current === intent) startIntentRef.current = null
      clearAnswer()
      applyDurableGame(started)
      setNotice(
        'White begins at the edge. Choose a piece, or let the board play all the way to an ending.',
      )
    } catch (error) {
      if (
        isWebChessApiError(error) &&
        error.kind === 'authentication-required'
      ) {
        if (runtime.signInPath) window.location.assign(runtime.signInPath)
        return
      }
      if (!isWebChessApiError(error) || error.kind !== 'transport') {
        if (startIntentRef.current === intent) startIntentRef.current = null
      }
      if (isWebChessApiError(error) && error.kind === 'conflict') {
        await restoreCurrentGame()
        return
      }
      setRestoreError(
        error instanceof Error
          ? error.message
          : 'WebChess could not start the saved game.',
      )
    } finally {
      if (activeGameMutationRef.current === mutation) {
        activeGameMutationRef.current = null
        setGameMutationMode(null)
      }
    }
  }

  const selectPiece = (pieceId: string) => {
    if (stage !== 'playing' || autoPlaying || gameFinishing || thinking) return

    const piece = pieces.find((candidate) => candidate.id === pieceId)
    if (!piece) return
    setFocusedCell(piece.position)

    if (piece.side !== turn) {
      setNotice(`${turn === 'white' ? 'White' : 'Black'} is moving now. The other side must wait.`)
      return
    }

    setSelectedPieceId((current) => (current === pieceId ? null : pieceId))
    const metaphor = PIECE_METAPHORS[piece.kind]
    setNotice(`${metaphor.label}: ${metaphor.role}.`)
  }

  const selectCell = (cell: CellCoord) => {
    setFocusedCell(cell)
    if (!selectedPiece || autoPlaying || gameFinishing || thinking) return

    if (legalMoves.some((move) => isSameCoord(move, cell))) {
      void movePiece(selectedPiece.id, cell)
      return
    }

    const occupant = pieces.find((piece) => isSameCoord(piece.position, cell))
    if (occupant?.side === turn) selectPiece(occupant.id)
  }

  const toggleAutoPlay = () => {
    if (gameFinishing) return
    if (!autoPlaying && activeEngineRequestRef.current?.mode === 'manual') return

    if (autoPlaying) {
      invalidateEngineRequest(true)
      setSelectedPieceId(null)
      setAutoPlaying(false)
      setNotice(`Auto-play paused. Choose a ${turn === 'white' ? 'White' : 'Black'} piece or play one turn.`)
      return
    }

    setSelectedPieceId(null)
    setAutoPlaying(true)
    setNotice('The players are weighing pressure, safety, and purpose as they play to the end.')
  }

  const retryAnswer = () => {
    if (!game || !outcome) return
    setAnswer('')
    setAnswerPrompt('')
    setAnswerError('')
    setAnswerActivity(beginModelActivity('answer'))
    setAnswerStatus('loading')
  }

  const retryBoardAnswer = async () => {
    const current = game
    if (
      !current ||
      !outcome ||
      lifecycle?.state !== 'gate_passed' ||
      current.status !== 'answer_failed' ||
      lifecycleBusy
    ) return

    const existingIntent = answerIntentRef.current
    const intent = existingIntent?.gameId === current.id
      ? existingIntent
      : { gameId: current.id, key: runtime.api.createIdempotencyKey() }
    answerIntentRef.current = intent
    const controller = new AbortController()
    lifecycleRequestRef.current = controller
    setLifecycleBusy(true)
    setLifecycleError('')
    setAnswerError('')
    setAnswerStatus('loading')
    setAnswerActivity(beginModelActivity('answer'))
    try {
      const generated = await runtime.api.requestGameAnswer(
        current.id,
        { expectedRevision: current.revision },
        { idempotencyKey: intent.key, signal: controller.signal },
      )
      if (controller.signal.aborted) return
      answerIntentRef.current = null
      applyDurableGame(generated.game, { preserveLifecycle: true })
      setAnswer(generated.answer.answer)
      setAnswerModel(generated.answer.model)
      setAnswerPrompt(generated.answer.prompt)
      setAnswerStatus('success')
      setAnswerActivity(null)
    } catch (error) {
      if (controller.signal.aborted) return
      if (!isAmbiguousAnswerMutationFailure(error)) {
        answerIntentRef.current = null
      }
      const failurePrompt = isWebChessApiError(error) ? error.prompt : null
      await restoreCurrentGame({ silent: true })
      if (failurePrompt) setAnswerPrompt(failurePrompt)
      setAnswerError(
        error instanceof Error
          ? error.message
          : 'The board-derived answer could not be completed.',
      )
      setAnswerStatus('error')
      setAnswerActivity(null)
    } finally {
      if (lifecycleRequestRef.current === controller) {
        lifecycleRequestRef.current = null
        setLifecycleBusy(false)
      }
    }
  }

  const retryLifecyclePath = async () => {
    const current = game
    if (!current || !lifecycle || lifecycleBusy) return

    const existingIntent = lifecycleRetryIntentRef.current
    const intent = existingIntent?.gameId === current.id
      ? existingIntent
      : { gameId: current.id, key: runtime.api.createIdempotencyKey() }
    lifecycleRetryIntentRef.current = intent
    setLifecycleBusy(true)
    setLifecycleError('')
    try {
      const retried = await runtime.api.retryLifecycle(current.id, {
        expectedRevision: current.revision,
      }, {
        idempotencyKey: intent.key,
      })
      lifecycleRetryIntentRef.current = null
      if (retried.game) {
        applyDurableGame(retried.game, { animateMapping: true })
        setLifecycle(retried.lifecycle)
        setLifecycleMode('v2')
        setNotice(
          retried.lifecycle.fieldGeneration > lifecycle.fieldGeneration
            ? 'Anansi has woven a fresh field. The changed evidence is ready to play.'
            : 'The same evidence field is ready for a new chess trajectory.',
        )
      } else {
        setLifecycle(retried.lifecycle)
      }
    } catch (error) {
      if (!isWebChessApiError(error) || error.kind !== 'transport') {
        lifecycleRetryIntentRef.current = null
      }
      if (isWebChessApiError(error) && error.kind === 'conflict') {
        await refreshLifecycle()
        return
      }
      setLifecycleError(
        error instanceof Error
          ? error.message
          : 'Retry could not safely create another bounded path.',
      )
    } finally {
      setLifecycleBusy(false)
    }
  }

  const trackCharlotteAction = async (
    index: number,
    followUpAt: string | null,
  ) => {
    const current = game
    const suggestion = lifecycle?.charlotte?.exactlyThreeNextActions[index]
    if (!current || !suggestion || actionPendingIndex !== null) return

    const existingIntent = wilburActionIntentRef.current
    const intent = existingIntent?.gameId === current.id &&
      existingIntent.charlotteActionIndex === index &&
      existingIntent.command.followUpAt === followUpAt
      ? existingIntent
      : {
          gameId: current.id,
          charlotteActionIndex: index,
          command: {
            charlotteActionIndex: index,
            actor: suggestion.actor,
            action: suggestion.smallestAction,
            testedAssumption: suggestion.assumptionBeingTested,
            expectedObservation: suggestion.expectedObservation,
            decisionThreshold: suggestion.decisionThreshold,
            reviewHorizon: suggestion.reviewHorizon,
            followUpAt,
          },
          key: runtime.api.createIdempotencyKey(),
        }
    wilburActionIntentRef.current = intent

    setActionPendingIndex(index)
    setLifecycleError('')
    try {
      await runtime.api.createWilburAction(current.id, intent.command, {
        idempotencyKey: intent.key,
      })
      if (wilburActionIntentRef.current === intent) {
        wilburActionIntentRef.current = null
      }
      await refreshLifecycle()
      await refreshWebMemory()
    } catch (error) {
      if (isAmbiguousWilburMutationFailure(error)) {
        await refreshLifecycle()
        if (wilburActionIntentRef.current !== intent) return
      } else if (wilburActionIntentRef.current === intent) {
        wilburActionIntentRef.current = null
      }
      setLifecycleError(
        error instanceof Error
          ? error.message
          : 'Wilbur could not add that action to the saved record.',
      )
    } finally {
      setActionPendingIndex(null)
    }
  }

  const setWilburActionStatus = async (
    action: WilburAction,
    status: WilburAction['status'],
    followUpAt: string | null,
  ) => {
    const current = game
    if (!current || wilburPending) return

    const existingIntent = wilburStatusIntentRef.current
    const intent = existingIntent?.gameId === current.id &&
      existingIntent.actionId === action.id &&
      existingIntent.command.status === status &&
      existingIntent.command.followUpAt === followUpAt
      ? existingIntent
      : {
          gameId: current.id,
          actionId: action.id,
          command: {
            expectedRevision: action.revision,
            status,
            followUpAt,
          },
          key: runtime.api.createIdempotencyKey(),
        }
    wilburStatusIntentRef.current = intent

    setWilburPending(true)
    setLifecycleError('')
    try {
      await runtime.api.updateWilburAction(current.id, action.id, intent.command, {
        idempotencyKey: intent.key,
      })
      if (wilburStatusIntentRef.current === intent) {
        wilburStatusIntentRef.current = null
      }
      await refreshLifecycle()
      await refreshWebMemory()
    } catch (error) {
      if (isAmbiguousWilburMutationFailure(error)) {
        await refreshLifecycle()
        if (wilburStatusIntentRef.current !== intent) return
      } else if (wilburStatusIntentRef.current === intent) {
        wilburStatusIntentRef.current = null
      }
      if (isWebChessApiError(error) && error.kind === 'conflict') {
        await refreshLifecycle()
        return
      }
      setLifecycleError(
        error instanceof Error
          ? error.message
          : 'Wilbur could not update that action.',
      )
    } finally {
      setWilburPending(false)
    }
  }

  const observeWilburAction = async (
    action: WilburAction,
    observation: AppendWilburObservationCommand,
  ): Promise<boolean> => {
    const current = game
    if (!current || wilburPending) return false

    const existingIntent = wilburObservationIntentRef.current
    const intent = existingIntent?.gameId === current.id &&
      existingIntent.actionId === action.id
      ? existingIntent
      : {
          gameId: current.id,
          actionId: action.id,
          command: observation,
          key: runtime.api.createIdempotencyKey(),
        }
    wilburObservationIntentRef.current = intent

    setWilburPending(true)
    setLifecycleError('')
    try {
      await runtime.api.appendWilburObservation(current.id, action.id, intent.command, {
        idempotencyKey: intent.key,
      })
      if (wilburObservationIntentRef.current === intent) {
        wilburObservationIntentRef.current = null
      }
      await refreshLifecycle()
      await refreshWebMemory()
      return true
    } catch (error) {
      if (isAmbiguousWilburMutationFailure(error)) {
        await refreshLifecycle()
        if (wilburObservationIntentRef.current !== intent) return true
      } else if (wilburObservationIntentRef.current === intent) {
        wilburObservationIntentRef.current = null
      }
      setLifecycleError(
        error instanceof Error
          ? error.message
          : 'Wilbur could not append that observation.',
      )
      return false
    } finally {
      setWilburPending(false)
    }
  }

  const toggleMemoryObservation = (observationId: string) => {
    if (stage !== 'question') return
    setSelectedMemoryObservationIds((current) => {
      if (current.includes(observationId)) {
        return current.filter((id) => id !== observationId)
      }
      return current.length < 8 ? [...current, observationId] : current
    })
  }

  const useMemoryNextDecision = (observation: WilburObservation) => {
    if (stage !== 'question') return
    setProblem(observation.nextDecision.slice(0, 240))
    setSelectedMemoryObservationIds((current) =>
      current.includes(observation.id) || current.length >= 8
        ? current
        : [...current, observation.id],
    )
    setWebMemoryOpen(false)
    window.requestAnimationFrame(() => document.getElementById('problem')?.focus())
  }

  const replayProblem = async () => {
    const current = game
    if (
      !current ||
      replayPendingRef.current ||
      activeGameMutationRef.current ||
      answerStatus === 'loading'
    ) return

    const existingIntent = replayIntentRef.current
    const intent = existingIntent?.gameId === current.id
      ? existingIntent
      : { gameId: current.id, key: runtime.api.createIdempotencyKey() }
    replayIntentRef.current = intent
    replayPendingRef.current = true
    setReplayPending(true)
    setReplayError('')
    try {
      const replayed = await runtime.api.replayGame(current.id, {
        expectedRevision: current.revision,
      }, {
        idempotencyKey: intent.key,
      })
      replayIntentRef.current = null
      setReplayTargetUnresolved(false)
      clearAnswer()
      applyDurableGame(replayed)
      setNotice(
        'Replay preserves these 64 facets in the same places. Guided play follows the same path; your own moves can create another one.',
      )
    } catch (error) {
      if (
        isWebChessApiError(error) &&
        error.kind === 'authentication-required'
      ) {
        if (runtime.signInPath) window.location.assign(runtime.signInPath)
        return
      }

      const ambiguous =
        isWebChessApiError(error) &&
        (
          error.kind === 'transport' ||
          error.kind === 'invalid-response'
        )
      if (ambiguous) {
        try {
          // Replay creation atomically uses its replay idempotency UUID as the
          // child ID. Division recovery must use the separate intent endpoint
          // because division games are identified by a server request UUID.
          const recovered = await runtime.api.getOwnedGame(intent.key)
          if (recovered.sourceGameId !== current.id) {
            throw new Error(
              'The recovered replay does not belong to this source game.',
              { cause: error },
            )
          }

          replayIntentRef.current = null
          setReplayTargetUnresolved(false)
          if (recovered.status === 'abandoned') {
            await restoreCurrentGame()
            return
          }
          clearAnswer()
          applyDurableGame(recovered)
          setNotice(
            'Replay preserves these 64 facets in the same places. Guided play follows the same path; your own moves can create another one.',
          )
          return
        } catch (recoveryError) {
          if (
            isWebChessApiError(recoveryError) &&
            recoveryError.kind === 'authentication-required'
          ) {
            if (runtime.signInPath) window.location.assign(runtime.signInPath)
            return
          }
          setReplayTargetUnresolved(true)
        }
      } else {
        replayIntentRef.current = null
        setReplayTargetUnresolved(false)
      }
      if (isWebChessApiError(error) && error.kind === 'conflict') {
        await restoreCurrentGame()
        return
      }
      setReplayError(
        error instanceof Error
          ? error.message
          : 'WebChess could not create a replay.',
      )
    } finally {
      replayPendingRef.current = false
      setReplayPending(false)
    }
  }

  const reset = async () => {
    if (
      activeGameMutationRef.current ||
      replayPendingRef.current ||
      replayTargetUnresolved ||
      movePendingRef.current ||
      game?.status === 'dividing' ||
      game?.status === 'answering' ||
      answerStatus === 'loading' ||
      divisionTargetUnresolved ||
      (!game && divisionRequestRef.current)
    ) return

    const mutation: ActiveGameMutation = { mode: 'resetting' }
    activeGameMutationRef.current = mutation
    setGameMutationMode(mutation.mode)
    const current = game

    invalidateRestoreRequest()
    divisionRequestRef.current?.abort()
    divisionRequestRef.current = null
    answerRequestRef.current?.abort()
    answerRequestRef.current = null
    invalidateEngineRequest(true)
    setAutoPlaying(false)

    try {
      if (!current) {
        resetGameState()
        setGame(null)
        setRestoreError('')
        return
      }

      const existingIntent = resetIntentRef.current
      const intent = (
        existingIntent?.gameId === current.id &&
        existingIntent.expectedRevision === current.revision
      )
        ? existingIntent
        : {
            gameId: current.id,
            expectedRevision: current.revision,
            key: runtime.api.createIdempotencyKey(),
          }
      resetIntentRef.current = intent

      await runtime.api.abandonGame(current.id, {
        expectedRevision: current.revision,
      }, {
        idempotencyKey: intent.key,
      })
      if (activeGameMutationRef.current !== mutation) return
      if (resetIntentRef.current === intent) resetIntentRef.current = null
      resetGameState()
      setGame(null)
      setRestoreError('')
    } catch (error) {
      if (!isWebChessApiError(error) || error.kind !== 'transport') {
        resetIntentRef.current = null
      }
      if (isWebChessApiError(error) && error.kind === 'conflict') {
        await restoreCurrentGame()
        return
      }
      setRestoreError(
        error instanceof Error
          ? error.message
          : 'WebChess could not close the saved game.',
      )
    } finally {
      if (activeGameMutationRef.current === mutation) {
        activeGameMutationRef.current = null
        setGameMutationMode(null)
      }
    }
  }

  const visibleStage = stage
  const webMemoryObservationCount = webMemory?.cases.reduce(
    (count, item) => count + item.actions.reduce(
      (actionCount, record) => actionCount + record.observations.length,
      0,
    ),
    0,
  ) ?? 0
  const dueWebMemoryCount = countDueWebMemoryActions(webMemory)
  const sharedActionDisabled =
    gameMutationMode !== null ||
    replayPending ||
    movePending ||
    lifecycleBusy ||
    actionPendingIndex !== null ||
    wilburPending ||
    game?.status === 'dividing' ||
    game?.status === 'answering' ||
    (lifecycleMode === 'legacy' && answerStatus === 'loading') ||
    divisionTargetUnresolved ||
    (!game && divisionStatus === 'loading')
  const resetDisabled = sharedActionDisabled || replayTargetUnresolved
  const replayDisabled = sharedActionDisabled
  const lifecycleGameStatus =
    lifecycleBusy &&
    lifecycle?.state === 'gate_passed' &&
    game?.status !== 'answered'
      ? 'answering'
      : game?.status === 'answering' ||
          game?.status === 'answer_failed' ||
          game?.status === 'answered'
        ? game.status
        : 'completed'

  return (
    <div className={`app-shell stage-${visibleStage}`}>
      <Header
        stage={visibleStage}
        resetDisabled={resetDisabled}
        onReset={reset}
        onOpenMemory={() => setWebMemoryOpen(true)}
        memoryCount={webMemoryObservationCount}
        dueMemoryCount={dueWebMemoryCount}
        localMode={runtime.kind === 'openclaw'}
      />

      <WebMemoryPanel
        open={webMemoryOpen}
        memory={webMemory}
        busy={webMemoryBusy}
        error={webMemoryError}
        selectionEnabled={stage === 'question'}
        selectedObservationIds={selectedMemoryObservationIds}
        onClose={() => setWebMemoryOpen(false)}
        onRefresh={() => void refreshWebMemory()}
        onToggleObservation={toggleMemoryObservation}
        onUseNextDecision={useMemoryNextDecision}
      />

      <main className="main-content">
        {dueWebMemoryCount > 0 && !webMemoryOpen ? (
          <button
            className="web-memory-reminder"
            type="button"
            onClick={() => setWebMemoryOpen(true)}
          >
            <span><strong>{dueWebMemoryCount}</strong> Wilbur follow-up{dueWebMemoryCount === 1 ? ' is' : 's are'} due</span>
            <span>Open case memory and record what reality did.</span>
          </button>
        ) : null}
        {restoreError && (
          <div className="session-banner" role="alert">
            <span>{restoreError}</span>
            <button type="button" className="text-button" onClick={() => void restoreCurrentGame()}>
              {runtime.restoreActionLabel}
            </button>
          </div>
        )}

        {restoring ? (
          <section
            className="question-layout restore-layout"
            aria-label="Restoring saved game"
          >
            <div className="question-copy">
              <p className="eyebrow"><span /> Saved game</p>
              <h1>Restoring your board…</h1>
              <p className="lede" role="status">
                {runtime.restoreDescription}
              </p>
            </div>
          </section>
        ) : stage === 'question' ? (
          <QuestionStage
            problem={problem}
            provider={runtime.provider}
            researchConsentDecision={researchConsentDecision}
            setResearchConsentDecision={setResearchConsentDecision}
            setProblem={setProblem}
            onSubmit={beginMapping}
            selectedMemoryCount={selectedMemoryObservationIds.length}
            onOpenMemory={() => setWebMemoryOpen(true)}
          />
        ) : null}

        {!restoring && stage === 'mapping' && (
          <MappingStage
            problem={problem}
            provider={runtime.provider}
            parts={parts}
            progress={mappingProgress}
            divisionStatus={divisionStatus}
            divisionPhase={divisionPhase}
            divisionModel={divisionModel}
            divisionPrompt={divisionPrompt}
            divisionError={divisionError}
            divisionActivity={divisionActivity}
            beginDisabled={gameMutationMode !== null}
            onBegin={beginPlay}
            onRetry={retryDivision}
          />
        )}

        {!restoring && stage === 'playing' && (
          <PlayingStage
            problem={problem}
            parts={parts}
            pieces={pieces}
            turn={turn}
            turnNumber={turnNumber}
            captures={captures}
            selectedPiece={selectedPiece}
            selectedPieceId={selectedPieceId}
            legalMoves={legalMoves}
            focusedPart={focusedPart}
            focusedKeys={focusedKeys}
            captureKeys={captureKeys}
            lastMove={lastMove}
            autoPlaying={autoPlaying}
            searchMode={movePending ? 'manual' : engineSearchMode}
            gameFinishing={gameFinishing}
            notice={notice}
            onPieceSelect={selectPiece}
            onCellSelect={selectCell}
            onStep={() => void playOneTurn('manual')}
            onToggleAuto={toggleAutoPlay}
          />
        )}

        {!restoring && stage === 'reading' && outcome && lifecycleMode !== 'legacy' && (
          <LifecycleStage
            game={game}
            problem={problem}
            parts={parts}
            pieces={pieces}
            captures={captures}
            lastMove={lastMove}
            outcome={outcome}
            lifecycle={lifecycle}
            gameStatus={lifecycleGameStatus}
            boardAnswer={game?.answer ?? null}
            answerFailurePrompt={answerPrompt}
            busy={lifecycleBusy}
            error={lifecycleError}
            actionPendingIndex={actionPendingIndex}
            wilburPending={wilburPending}
            onRefresh={() => void refreshLifecycle()}
            onRetry={() => void retryLifecyclePath()}
            onRetryAnswer={() => void retryBoardAnswer()}
            onCreateAction={(index, followUpAt) => void trackCharlotteAction(index, followUpAt)}
            onUpdateAction={(action, status, followUpAt) => void setWilburActionStatus(action, status, followUpAt)}
            onObserve={observeWilburAction}
          />
        )}

        {!restoring && stage === 'reading' && outcome && lifecycleMode === 'legacy' && (
          <ReadingStage
            problem={problem}
            provider={runtime.provider}
            parts={parts}
            pieces={pieces}
            captures={captures}
            lastMove={lastMove}
            reading={reading}
            outcome={outcome}
            answerStatus={answerStatus}
            answer={answer}
            answerModel={answerModel}
            answerPrompt={answerPrompt}
            answerError={answerError}
            answerActivity={answerActivity}
            replayError={replayError}
            captureKeys={captureKeys}
            replayDisabled={replayDisabled}
            resetDisabled={resetDisabled}
            onRetryAnswer={retryAnswer}
            onReplay={replayProblem}
            onReset={reset}
          />
        )}
      </main>

      <footer className="site-footer">
        <span>WebChess</span>
        <span>A thinking game inspired by change, not a prediction.</span>
        {runtime.footerAction ? (
          <a className="text-button" href={runtime.footerAction.href}>
            {runtime.footerAction.label}
          </a>
        ) : (
          <span>Runs locally through your OpenClaw configuration.</span>
        )}
      </footer>
    </div>
  )
}
