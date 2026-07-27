'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { Header } from './components/Header'
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
import { HOSTED_WEBCHESS_PROVIDER } from './lib/hosted-provider'
import { normalizeProblemInput, problemPartAt } from './lib/problem'
import { PIECE_METAPHORS, synthesizeReading } from './lib/reading'
import { beginModelActivity } from './lib/model-activity'
import {
  abandonGame,
  createIdempotencyKey,
  divideProblem,
  getCurrentGame,
  getOwnedGame,
  isWebChessApiError,
  recoverDivisionIntent,
  replayGame,
  requestGameAnswer,
  startGame,
  submitMove,
} from './lib/webchess-api'
import type { DurableGame } from './lib/webchess-api'
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
const PLAY_SIGN_IN_PATH = '/sign-in?return_url=%2Fplay'
const CAST_REVEAL_INTERVAL_MS = 90
const DIVISION_PHASE_DURATION_MS = 780

type EngineSearchMode = 'manual' | 'autoplay'

interface ActiveEngineRequest {
  generation: number
  mode: EngineSearchMode
}

type GameMutationMode = 'starting' | 'resetting'

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
  const [game, setGame] = useState<DurableGame | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [restoreError, setRestoreError] = useState('')
  const [movePending, setMovePending] = useState(false)
  const [stage, setStage] = useState<Stage>('question')
  const [problem, setProblem] = useState('')
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
  const restoreRequestRef = useRef<ActiveRestoreRequest | null>(null)
  const restoreRequestGenerationRef = useRef(0)
  const divisionRequestRef = useRef<AbortController | null>(null)
  const answerRequestRef = useRef<AbortController | null>(null)
  const movePendingRef = useRef(false)
  const divisionIntentRef = useRef<{ problem: string; key: string } | null>(null)
  const answerIntentRef = useRef<{ gameId: string; key: string } | null>(null)
  const replayIntentRef = useRef<{ gameId: string; key: string } | null>(null)
  const replayPendingRef = useRef(false)
  const startIntentRef = useRef<RevisionMutationIntent | null>(null)
  const resetIntentRef = useRef<RevisionMutationIntent | null>(null)
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
    divisionIntentRef.current = null
    answerIntentRef.current = null
    replayIntentRef.current = null
    replayPendingRef.current = false
    startIntentRef.current = null
    resetIntentRef.current = null
    movePendingRef.current = false
    invalidateEngineRequest(true)
    setStage('question')
    setProblem('')
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
    setNotice('Choose a white piece. Its possible paths will appear.')
  }, [invalidateEngineRequest])

  const applyDurableGame = useCallback((
    nextGame: DurableGame,
    options: { animateMapping?: boolean; preserveAutoPlay?: boolean } = {},
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
      const current = await getCurrentGame({ signal: controller.signal })
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
        window.location.assign(PLAY_SIGN_IN_PATH)
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
  }, [applyDurableGame, invalidateRestoreRequest, resetGameState])

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => void restoreCurrentGame(), 0)
    return () => {
      window.clearTimeout(restoreTimer)
      invalidateRestoreRequest()
    }
  }, [invalidateRestoreRequest, restoreCurrentGame])

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
  }, [stage])

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
        const saved = await submitMove(game.id, {
          expectedRevision: game.revision,
          pieceId,
          to: destination,
        }, {
          idempotencyKey: createIdempotencyKey(),
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
          window.location.assign(PLAY_SIGN_IN_PATH)
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
      turn,
    ],
  )

  const playOneTurn = useCallback(async (mode: EngineSearchMode) => {
    if (
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
    const result = await getEngine().chooseMove(pieces, turn, `${problem}/${turnNumber}`, {
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
    getEngine,
    movePiece,
    outcome,
    pieces,
    problem,
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

  useEffect(() => {
    if (
      stage !== 'reading' ||
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
          : { gameId: game.id, key: createIdempotencyKey() }
        answerIntentRef.current = intent
        const generated = await requestGameAnswer(game.id, {
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
          window.location.assign(PLAY_SIGN_IN_PATH)
          return
        }
        if (!isWebChessApiError(error) || error.kind !== 'transport') {
          answerIntentRef.current = null
        }
        if (isWebChessApiError(error) && error.kind === 'conflict') {
          await restoreCurrentGame()
          return
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
    outcome,
    restoreCurrentGame,
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
    divisionRequestRef.current?.abort()
    const controller = new AbortController()
    divisionRequestRef.current = controller
    const existingIntent = divisionIntentRef.current
    const intent = existingIntent?.problem === subject
      ? existingIntent
      : { problem: subject, key: createIdempotencyKey() }
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
      const divided = await divideProblem(subject, {
        idempotencyKey: intent.key,
        signal: controller.signal,
      })
      if (controller.signal.aborted || divisionRequestRef.current !== controller) return

      divisionIntentRef.current = null
      applyDurableGame(divided, { animateMapping: true })
    } catch (error) {
      if (controller.signal.aborted || divisionRequestRef.current !== controller) return
      if (
        isWebChessApiError(error) &&
        error.kind === 'authentication-required'
      ) {
        window.location.assign(PLAY_SIGN_IN_PATH)
        return
      }

      const errorMessage = error instanceof Error
        ? error.message
        : 'The model could not divide this problem.'
      let recoveryError: unknown

      try {
        const recovered = await recoverDivisionIntent(intent.key, {
          signal: controller.signal,
        })
        if (controller.signal.aborted || divisionRequestRef.current !== controller) return

        if (recovered.status === 'abandoned') {
          resetGameState()
          setGame(null)
          setRestoreError('')
          return
        }

        applyDurableGame(recovered, {
          animateMapping: recovered.status === 'mapped',
        })
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
          window.location.assign(PLAY_SIGN_IN_PATH)
          return
        }
        recoveryError = recoveryFailure
      }

      const originalFailureWasDefinitive =
        isWebChessApiError(error) &&
        error.kind !== 'transport' &&
        error.kind !== 'invalid-response'
      const targetDefinitelyAbsent =
        originalFailureWasDefinitive &&
        isWebChessApiError(recoveryError) &&
        recoveryError.kind === 'not-found'

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
    if (cleaned.length < 12) return

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
          key: createIdempotencyKey(),
        }
    startIntentRef.current = intent

    try {
      const started = await startGame(current.id, {
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
        window.location.assign(PLAY_SIGN_IN_PATH)
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
      : { gameId: current.id, key: createIdempotencyKey() }
    replayIntentRef.current = intent
    replayPendingRef.current = true
    setReplayPending(true)
    setReplayError('')
    try {
      const replayed = await replayGame(current.id, {
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
        window.location.assign(PLAY_SIGN_IN_PATH)
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
          const recovered = await getOwnedGame(intent.key)
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
            window.location.assign(PLAY_SIGN_IN_PATH)
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
            key: createIdempotencyKey(),
          }
      resetIntentRef.current = intent

      await abandonGame(current.id, {
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
  const sharedActionDisabled =
    gameMutationMode !== null ||
    replayPending ||
    movePending ||
    game?.status === 'dividing' ||
    game?.status === 'answering' ||
    answerStatus === 'loading' ||
    divisionTargetUnresolved ||
    (!game && divisionStatus === 'loading')
  const resetDisabled = sharedActionDisabled || replayTargetUnresolved
  const replayDisabled = sharedActionDisabled

  return (
    <div className={`app-shell stage-${visibleStage}`}>
      <Header
        stage={visibleStage}
        resetDisabled={resetDisabled}
        onReset={reset}
      />

      <main className="main-content">
        {restoreError && (
          <div className="session-banner" role="alert">
            <span>{restoreError}</span>
            <button type="button" className="text-button" onClick={() => void restoreCurrentGame()}>
              Restore again
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
                WebChess is replaying the durable move log before play continues.
              </p>
            </div>
          </section>
        ) : stage === 'question' ? (
          <QuestionStage
            problem={problem}
            provider={HOSTED_WEBCHESS_PROVIDER}
            setProblem={setProblem}
            onSubmit={beginMapping}
          />
        ) : null}

        {!restoring && stage === 'mapping' && (
          <MappingStage
            problem={problem}
            provider={HOSTED_WEBCHESS_PROVIDER}
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

        {!restoring && stage === 'reading' && outcome && (
          <ReadingStage
            problem={problem}
            provider={HOSTED_WEBCHESS_PROVIDER}
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
        <a className="text-button" href="/account">Account and usage</a>
      </footer>
    </div>
  )
}
