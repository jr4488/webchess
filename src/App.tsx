import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { AccessGate } from './components/AccessGate'
import type { AccessGateStatus } from './components/AccessGate'
import { CosmicBackdrop } from './components/CosmicBackdrop'
import { Header } from './components/Header'
import { MappingStage } from './components/stages/MappingStage'
import { PlayingStage } from './components/stages/PlayingStage'
import { QuestionStage } from './components/stages/QuestionStage'
import { ReadingStage } from './components/stages/ReadingStage'
import { requestWebChessAnswer } from './lib/answer'
import { composeProblemParts, requestProblemDivision } from './lib/division'
import {
  applyMove,
  coordKey,
  createInitialPieces,
  getGameOutcome,
  getLegalMoves,
  hasLegalMove,
  isSameCoord,
} from './lib/game'
import { createAutoPlayEngine } from './lib/auto-play'
import type { AutoPlayEngine } from './lib/auto-play'
import { normalizeProblemInput, problemPartAt } from './lib/problem'
import { PIECE_METAPHORS, synthesizeReading } from './lib/reading'
import {
  beginModelActivity,
  updateModelActivity,
} from './lib/model-activity'
import type { ModelActivityEvent } from './lib/model-activity'
import {
  createWebChessSession,
  deleteWebChessSession,
  getWebChessSession,
  isSessionRequiredError,
} from './lib/session'
import type { AuthenticatedSession } from './lib/session'
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

type AccessState =
  | {
      status: AccessGateStatus
      message?: string
    }
  | {
      status: 'authenticated'
      session: AuthenticatedSession
    }

function otherSide(side: Side): Side {
  return side === 'white' ? 'black' : 'white'
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
  const [accessState, setAccessState] = useState<AccessState>({ status: 'checking' })
  const [endingSession, setEndingSession] = useState(false)
  const [sessionActionError, setSessionActionError] = useState('')
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
  const [autoPlaying, setAutoPlaying] = useState(false)
  const [notice, setNotice] = useState('Choose a white piece. Its possible paths will appear.')
  const [answerStatus, setAnswerStatus] = useState<AnswerStatus>('idle')
  const [answer, setAnswer] = useState('')
  const [answerModel, setAnswerModel] = useState('')
  const [answerPrompt, setAnswerPrompt] = useState('')
  const [answerError, setAnswerError] = useState('')
  const [answerActivity, setAnswerActivity] = useState<ModelActivityState | null>(null)
  const [thinking, setThinking] = useState(false)
  const sessionRequestRef = useRef<AbortController | null>(null)
  const divisionRequestRef = useRef<AbortController | null>(null)
  const answerRequestRef = useRef<AbortController | null>(null)
  const lastAuthenticatedSessionRef = useRef<AuthenticatedSession | null>(null)
  // Mirrors of request status, so session expiry can tell which work it
  // interrupted without making its own identity depend on that status.
  const divisionStatusRef = useRef<DivisionStatus>('idle')
  const answerStatusRef = useRef<AnswerStatus>('idle')
  const sessionActive = accessState.status === 'authenticated'
  const csrfToken = sessionActive ? accessState.session.csrfToken : ''
  const gameFinishing = outcome !== null && stage === 'playing'

  useEffect(() => {
    divisionStatusRef.current = divisionStatus
    answerStatusRef.current = answerStatus
  }, [answerStatus, divisionStatus])

  // Built on first use and torn down on unmount. It is deliberately not held in
  // state: unmounting disposes it, and under StrictMode's remount a disposed
  // engine would linger and refuse every later search.
  const engineRef = useRef<AutoPlayEngine | null>(null)
  const getEngine = useCallback(() => {
    engineRef.current ??= createAutoPlayEngine()
    return engineRef.current
  }, [])

  useEffect(
    () => () => {
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
    engineRef.current?.reset()
    setThinking(false)
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
    setAutoPlaying(false)
    setAnswerStatus('idle')
    setAnswer('')
    setAnswerModel('')
    setAnswerPrompt('')
    setAnswerError('')
    setAnswerActivity(null)
    setNotice('Choose a white piece. Its possible paths will appear.')
  }, [])

  /**
   * Keep the board when a session is renewed, and discard it only when the
   * model behind it changes.
   *
   * The 64 facets, the captures, and any written answer all belong to one
   * model. A fresh CSRF token does not: signing back in after the eight-hour
   * expiry is the same person continuing the same question, so resetting on
   * token change silently destroyed finished work.
   */
  const adoptAuthenticatedSession = useCallback((session: AuthenticatedSession) => {
    const previous = lastAuthenticatedSessionRef.current
    if (
      previous &&
      (
        previous.provider.id !== session.provider.id ||
        previous.provider.model !== session.provider.model
      )
    ) {
      resetGameState()
    }
    lastAuthenticatedSessionRef.current = session
  }, [resetGameState])

  /**
   * Surface an expired session, failing only the work it actually interrupted.
   *
   * Marking both requests failed put an expiry banner on the division stage
   * when only the answer was running, so a completed 64-facet map appeared to
   * have failed.
   */
  const requireSession = useCallback((message?: string) => {
    const explanation =
      message || 'Your access session has expired. Enter the access code to continue.'
    const failedAt = Date.now()
    const divisionInterrupted = divisionStatusRef.current === 'loading'
    const answerInterrupted = answerStatusRef.current === 'loading'

    divisionRequestRef.current?.abort()
    answerRequestRef.current?.abort()
    setAutoPlaying(false)

    if (divisionInterrupted) {
      setDivisionStatus('error')
      setDivisionError(explanation)
      setDivisionActivity((current) => current
        ? { ...current, status: 'error', lastHeartbeatAt: failedAt }
        : current)
    }
    if (answerInterrupted) {
      setAnswerStatus('error')
      setAnswerError(explanation)
      setAnswerActivity((current) => current
        ? { ...current, status: 'error', lastHeartbeatAt: failedAt }
        : current)
    }
    setAccessState({
      status: 'unauthenticated',
      message: explanation,
    })
  }, [])

  const loadSession = useCallback((controller: AbortController) => {
    void getWebChessSession(controller.signal)
      .then((session) => {
        if (controller.signal.aborted || sessionRequestRef.current !== controller) return
        setSessionActionError('')
        if (session.authenticated) {
          adoptAuthenticatedSession(session)
        }
        setAccessState(
          session.authenticated
            ? { status: 'authenticated', session }
            : { status: 'unauthenticated' },
        )
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || sessionRequestRef.current !== controller) return
        setAccessState({
          status: 'error',
          message: error instanceof Error
            ? error.message
            : 'WebChess could not check access right now.',
        })
      })
  }, [adoptAuthenticatedSession])

  const checkAccess = useCallback(() => {
    sessionRequestRef.current?.abort()
    const controller = new AbortController()
    sessionRequestRef.current = controller
    setAccessState({ status: 'checking' })
    loadSession(controller)
  }, [loadSession])

  const authenticate = useCallback(async (accessCode: string) => {
    sessionRequestRef.current?.abort()
    const controller = new AbortController()
    sessionRequestRef.current = controller

    let session: AuthenticatedSession
    try {
      session = await createWebChessSession(accessCode, controller.signal)
    } catch (error) {
      // A superseded or unmounted attempt is not a failed access code, so it
      // must not reach the gate as a rejected sign-in.
      if (controller.signal.aborted) return
      throw error
    }
    if (sessionRequestRef.current !== controller) return

    adoptAuthenticatedSession(session)
    setSessionActionError('')
    setAccessState({ status: 'authenticated', session })
  }, [adoptAuthenticatedSession])

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

  // The initial state is already `checking`, so the bootstrap reuses the shared
  // loader rather than re-announcing the status it is already showing.
  useEffect(() => {
    const controller = new AbortController()
    sessionRequestRef.current = controller
    loadSession(controller)
    return () => controller.abort()
  }, [loadSession])

  useEffect(() => {
    if (accessState.status !== 'authenticated') return

    const remainingMs = Date.parse(accessState.session.expiresAt) - Date.now()
    if (remainingMs > 2_147_483_647) return

    const timer = window.setTimeout(
      () => requireSession('Your access session has expired. Enter the access code to continue.'),
      Math.max(0, remainingMs),
    )
    return () => window.clearTimeout(timer)
  }, [accessState, requireSession])

  useEffect(() => {
    if (
      !sessionActive ||
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
  }, [divisionPhase, divisionStatus, parts.length, sessionActive, stage])

  useEffect(() => {
    if (
      !sessionActive ||
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
  }, [divisionPhase, divisionStatus, parts.length, sessionActive, stage])

  useEffect(() => () => {
    sessionRequestRef.current?.abort()
    divisionRequestRef.current?.abort()
    answerRequestRef.current?.abort()
  }, [])

  useEffect(() => {
    if (!sessionActive) return

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
  }, [sessionActive, stage])

  const finishGame = useCallback((finished: GameOutcome) => {
    setOutcome(finished)
    setAutoPlaying(false)
    setSelectedPieceId(null)
    setNotice(outcomeNotice(finished))
  }, [])

  const movePiece = useCallback(
    (pieceId: string, destination: CellCoord) => {
      const movingPiece = pieces.find((piece) => piece.id === pieceId)
      if (!movingPiece || movingPiece.side !== turn || parts.length !== 64 || outcome) return false

      try {
        const result = applyMove(pieces, pieceId, destination, parts, turnNumber)
        const nextSide = otherSide(turn)
        const nextQuietPlies = result.capture ? 0 : quietPlies + 1
        const finished = getGameOutcome(result.pieces, {
          quietPlies: nextQuietPlies,
          ply: turnNumber,
        })
        const completed = finished
          ? {
              ...finished,
              ...(result.capture?.captured.kind === 'king'
                ? { terminalCapture: result.capture }
                : {}),
            }
          : null

        setPieces(result.pieces)
        setLastMove({ from: movingPiece.position, to: destination })
        setFocusedCell(destination)
        setSelectedPieceId(null)

        if (result.capture) {
          setCaptures((current) => [...current, result.capture!])
        }

        if (completed) {
          finishGame(completed)
          return true
        }

        // The opponent may have no reply even though the game continues.
        // Handing them the turn anyway would stall the board on a side that
        // cannot move, so the turn passes straight back.
        const opponentCanReply = hasLegalMove(result.pieces, nextSide)
        const passedQuietPlies = opponentCanReply
          ? nextQuietPlies
          : nextQuietPlies + 1
        if (!opponentCanReply) {
          const stalled = getGameOutcome(result.pieces, {
            quietPlies: passedQuietPlies,
            ply: turnNumber + 1,
          })
          if (stalled) {
            finishGame(stalled)
            return true
          }
        }

        const continuingSide = opponentCanReply ? nextSide : turn
        setQuietPlies(passedQuietPlies)
        setTurn(continuingSide)
        setTurnNumber((current) => current + (opponentCanReply ? 1 : 2))

        const sideLabel = (side: Side) => (side === 'white' ? 'White' : 'Black')
        const nextTurn = opponentCanReply
          ? `${sideLabel(nextSide)} moves next.`
          : `${sideLabel(nextSide)} has no open path and passes. ${sideLabel(turn)} moves again.`
        if (result.capture) {
          setNotice(`${result.capture.narration} ${nextTurn}`)
        } else if (result.promoted) {
          setNotice(`A pawn crossed the whole question and became agency: a new queen. ${nextTurn}`)
        } else {
          const part = problemPartAt(parts, destination)
          setNotice(`${movingPiece.kind} moved through ${part.dimension.toLowerCase()}: ${part.keyword}. ${nextTurn}`)
        }
        return true
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'That path is closed.')
        return false
      }
    },
    [finishGame, outcome, parts, pieces, quietPlies, turn, turnNumber],
  )

  const playOneTurn = useCallback(async () => {
    if (outcome) return

    setThinking(true)
    const result = await getEngine().chooseMove(pieces, turn, `${problem}/${turnNumber}`, {
      ply: turnNumber,
      quietPlies,
    })
    if (result.status === 'superseded') return

    setThinking(false)

    if (result.status === 'failed') {
      setAutoPlaying(false)
      setNotice(`${result.message} Move a piece yourself to continue.`)
      return
    }

    const choice = result.move
    if (!choice) {
      const nextSide = otherSide(turn)
      if (!hasLegalMove(pieces, nextSide)) {
        finishGame({
          winner: null,
          reason: 'no-moves',
          completedTurn: Math.max(0, turnNumber - 1),
        })
        return
      }

      const nextQuietPlies = quietPlies + 1
      const safetyEnding = getGameOutcome(pieces, {
        quietPlies: nextQuietPlies,
        ply: turnNumber,
      })
      if (safetyEnding) {
        finishGame(safetyEnding)
        return
      }

      setQuietPlies(nextQuietPlies)
      setTurn(nextSide)
      setTurnNumber((current) => current + 1)
      setNotice(`${turn === 'white' ? 'White' : 'Black'} found no open path. ${nextSide === 'white' ? 'White' : 'Black'} responds.`)
      return
    }

    movePiece(choice.pieceId, choice.to)
  }, [finishGame, getEngine, movePiece, outcome, pieces, problem, quietPlies, turn, turnNumber])

  useEffect(() => {
    if (!sessionActive || !autoPlaying || stage !== 'playing' || outcome) return

    // The search itself takes a moment, so the pause before it only has to keep
    // a quick reply from erasing the move the viewer just watched land.
    const timer = window.setTimeout(() => void playOneTurn(), 320)
    return () => window.clearTimeout(timer)
  }, [autoPlaying, outcome, playOneTurn, sessionActive, stage])

  useEffect(() => {
    if (!sessionActive || stage !== 'playing' || !outcome) return

    const revealTimer = window.setTimeout(() => {
      setAnswerActivity(beginModelActivity('answer'))
      setAnswerStatus('loading')
      setStage('reading')
    }, 1_100)
    return () => window.clearTimeout(revealTimer)
  }, [outcome, sessionActive, stage])

  useEffect(() => {
    if (
      !sessionActive ||
      !csrfToken ||
      stage !== 'reading' ||
      !outcome ||
      answerStatus !== 'loading'
    ) return

    const controller = new AbortController()
    answerRequestRef.current = controller
    const generateAnswer = async () => {
      try {
        const onActivity = (event: ModelActivityEvent) => {
          if (controller.signal.aborted || answerRequestRef.current !== controller) return
          setAnswerActivity((current) =>
            updateModelActivity(current ?? beginModelActivity('answer'), event),
          )
        }
        const generated = await requestWebChessAnswer(
          problem,
          outcome,
          captures,
          controller.signal,
          csrfToken,
          onActivity,
        )
        if (controller.signal.aborted || answerRequestRef.current !== controller) return
        setAnswer(generated.answer)
        setAnswerModel(generated.model)
        setAnswerPrompt(generated.prompt)
        setAnswerError('')
        setAnswerStatus('success')
        setAnswerActivity((current) => current
          ? updateModelActivity(current, { type: 'phase', phase: 'complete' })
          : current)
      } catch (error) {
        if (controller.signal.aborted) return
        const failure = error as Error & { prompt?: string }
        setAnswerError(failure.message)
        setAnswerPrompt(failure.prompt ?? '')
        setAnswerStatus('error')
        setAnswerActivity((current) => current
          ? { ...current, status: 'error', lastHeartbeatAt: Date.now() }
          : current)
        if (isSessionRequiredError(failure)) {
          requireSession(failure.message)
        }
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
    captures,
    csrfToken,
    outcome,
    problem,
    requireSession,
    sessionActive,
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
    if (!sessionActive || !csrfToken) {
      requireSession()
      return
    }

    divisionRequestRef.current?.abort()
    const controller = new AbortController()
    divisionRequestRef.current = controller

    setParts([])
    setMappingProgress(0)
    setDivisionStatus('loading')
    setDivisionPhase('analyzing')
    setDivisionModel('')
    setDivisionPrompt('')
    setDivisionError('')
    setDivisionActivity(beginModelActivity('division'))

    try {
      const onActivity = (event: ModelActivityEvent) => {
        if (controller.signal.aborted || divisionRequestRef.current !== controller) return
        setDivisionActivity((current) =>
          updateModelActivity(current ?? beginModelActivity('division'), event),
        )
      }
      const analysis = await requestProblemDivision(
        subject,
        controller.signal,
        csrfToken,
        onActivity,
      )
      const composedParts = composeProblemParts(analysis.facets, analysis.seed)
      if (controller.signal.aborted || divisionRequestRef.current !== controller) return

      setParts(composedParts)
      setDivisionModel(analysis.model)
      setDivisionPrompt(analysis.prompt)
      setDivisionStatus('success')
      setDivisionPhase('facets-received')
      setDivisionActivity((current) => current
        ? updateModelActivity(current, { type: 'phase', phase: 'complete' })
        : current)
    } catch (error) {
      if (controller.signal.aborted || divisionRequestRef.current !== controller) return
      const failure = error as Error & { prompt?: string }
      setParts([])
      setMappingProgress(0)
      setDivisionPrompt(failure.prompt ?? '')
      setDivisionError(failure.message)
      setDivisionStatus('error')
      setDivisionActivity((current) => current
        ? { ...current, status: 'error', lastHeartbeatAt: Date.now() }
        : current)
      if (isSessionRequiredError(failure)) {
        requireSession(failure.message)
      }
    } finally {
      if (divisionRequestRef.current === controller) {
        divisionRequestRef.current = null
      }
    }
  }

  const beginMapping = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!sessionActive) {
      requireSession()
      return
    }
    const cleaned = normalizeProblemInput(problem)
    if (cleaned.length < 12) return

    setProblem(cleaned)
    setStage('mapping')
    void analyzeProblem(cleaned)
  }

  const retryDivision = () => {
    void analyzeProblem(problem)
  }

  const beginPlay = () => {
    if (
      !sessionActive ||
      parts.length !== 64 ||
      divisionStatus !== 'success' ||
      mappingProgress < 64
    ) return
    setPieces(createInitialPieces())
    setTurn('white')
    setTurnNumber(1)
    setQuietPlies(0)
    setCaptures([])
    setOutcome(null)
    setLastMove(null)
    setFocusedCell(null)
    clearAnswer()
    setNotice('White begins at the edge. Choose a piece, or let the board play all the way to an ending.')
    setStage('playing')
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
      movePiece(selectedPiece.id, cell)
      return
    }

    const occupant = pieces.find((piece) => isSameCoord(piece.position, cell))
    if (occupant?.side === turn) selectPiece(occupant.id)
  }

  const toggleAutoPlay = () => {
    if (gameFinishing) return
    const shouldPlay = !autoPlaying
    setSelectedPieceId(null)
    setAutoPlaying(shouldPlay)
    setNotice(
      shouldPlay
        ? 'The players are weighing pressure, safety, and purpose as they play to the end.'
        : `Auto-play paused. Choose a ${turn === 'white' ? 'White' : 'Black'} piece or play one turn.`,
    )
  }

  const retryAnswer = () => {
    if (!sessionActive) {
      requireSession()
      return
    }
    setAnswer('')
    setAnswerPrompt('')
    setAnswerError('')
    setAnswerActivity(beginModelActivity('answer'))
    setAnswerStatus('loading')
  }

  const replayProblem = () => {
    setPieces(createInitialPieces())
    setTurn('white')
    setTurnNumber(1)
    setQuietPlies(0)
    setCaptures([])
    setOutcome(null)
    setSelectedPieceId(null)
    setFocusedCell(null)
    setLastMove(null)
    setAutoPlaying(false)
    clearAnswer()
    setNotice('Replay preserves these 64 facets in the same places. Guided play follows the same path; your own moves can create another one.')
    setStage('playing')
  }

  const reset = () => {
    resetGameState()
    setSessionActionError('')
  }

  const endSession = async () => {
    if (accessState.status !== 'authenticated' || endingSession) return

    setEndingSession(true)
    setSessionActionError('')
    try {
      await deleteWebChessSession(accessState.session.csrfToken)
      reset()
      lastAuthenticatedSessionRef.current = null
      setAccessState({
        status: 'unauthenticated',
        message: 'Your access session has ended.',
      })
    } catch (error) {
      setSessionActionError(
        error instanceof Error ? error.message : 'WebChess could not end the access session.',
      )
    } finally {
      setEndingSession(false)
    }
  }

  const visibleStage = sessionActive ? stage : 'question'

  return (
    <div className={`app-shell stage-${visibleStage}`}>
      <CosmicBackdrop />
      <div className="paper-noise" aria-hidden="true" />
      <Header stage={visibleStage} onReset={reset} />

      <main className="main-content">
        {!sessionActive ? (
          <AccessGate
            status={accessState.status}
            message={accessState.message}
            onAuthenticate={authenticate}
            onRetryCheck={checkAccess}
          />
        ) : stage === 'question' ? (
          <QuestionStage
            problem={problem}
            provider={accessState.session.provider}
            setProblem={setProblem}
            onSubmit={beginMapping}
          />
        ) : null}

        {sessionActive && stage === 'mapping' && (
          <MappingStage
            problem={problem}
            provider={accessState.session.provider}
            parts={parts}
            progress={mappingProgress}
            divisionStatus={divisionStatus}
            divisionPhase={divisionPhase}
            divisionModel={divisionModel}
            divisionPrompt={divisionPrompt}
            divisionError={divisionError}
            divisionActivity={divisionActivity}
            onBegin={beginPlay}
            onRetry={retryDivision}
          />
        )}

        {sessionActive && stage === 'playing' && (
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
            thinking={thinking}
            gameFinishing={gameFinishing}
            notice={notice}
            onPieceSelect={selectPiece}
            onCellSelect={selectCell}
            onStep={() => void playOneTurn()}
            onToggleAuto={toggleAutoPlay}
          />
        )}

        {sessionActive && stage === 'reading' && outcome && (
          <ReadingStage
            problem={problem}
            provider={accessState.session.provider}
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
            captureKeys={captureKeys}
            onRetryAnswer={retryAnswer}
            onReplay={replayProblem}
            onReset={reset}
          />
        )}
      </main>

      <footer className="site-footer">
        <span>WebChess</span>
        <span>A thinking game inspired by change, not a prediction.</span>
        {sessionActionError && <span role="alert">{sessionActionError}</span>}
        {sessionActive && (
          <button
            className="text-button"
            type="button"
            onClick={() => void endSession()}
            disabled={endingSession}
          >
            {endingSession ? 'Ending session…' : 'End session'}
          </button>
        )}
      </footer>
    </div>
  )
}
