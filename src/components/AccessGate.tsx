import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react'

import { RadialBoard } from './RadialBoard'

export type AccessGateStatus = 'checking' | 'unauthenticated' | 'error'

interface AccessGateProps {
  status: AccessGateStatus
  message?: string
  onAuthenticate: (accessCode: string) => Promise<void>
  onRetryCheck: () => void
}

export function AccessGate({
  status,
  message,
  onAuthenticate,
  onRetryCheck,
}: AccessGateProps) {
  const [accessCode, setAccessCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submissionError, setSubmissionError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (accessCode.length === 0 || submitting) return

    setSubmitting(true)
    setSubmissionError('')
    try {
      await onAuthenticate(accessCode)
      setAccessCode('')
    } catch (error) {
      setSubmissionError(
        error instanceof Error
          ? error.message
          : 'WebChess could not start an access session.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const error = submissionError || message
  const checking = status === 'checking'

  return (
    <section
      className="question-layout stage-enter access-gate"
      aria-labelledby="access-gate-heading"
    >
      <div className="question-copy">
        <p className="eyebrow"><span /> Protected play</p>
        <h1 id="access-gate-heading">
          <span>{checking ? 'One moment.' : 'Enter the circle.'}</span><br />
          <em>{checking ? 'Checking access…' : 'Your board is protected.'}</em>
        </h1>
        <p className="lede">
          Playing WebChess uses a protected AI service. Your access code is sent directly
          to this server to begin a short session. WebChess does not save it in browser storage.
        </p>

        {checking ? (
          <p className="access-gate-status" role="status" aria-live="polite">
            Checking for an active session…
          </p>
        ) : status === 'error' ? (
          <div className="question-form access-gate-error" role="alert">
            <p>{error || 'WebChess could not check access right now.'}</p>
            <button className="primary-button" type="button" onClick={onRetryCheck}>
              Check access again
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <form className="question-form" onSubmit={submit}>
            <label htmlFor="access-code">Access code</label>
            <div className="textarea-wrap">
              <input
                className="access-code-input"
                id="access-code"
                name="access-code"
                type="password"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={256}
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
                aria-describedby={error ? 'access-code-error access-code-note' : 'access-code-note'}
                aria-invalid={Boolean(error)}
                autoFocus
              />
            </div>
            <p className="form-hint" id="access-code-note">
              The code is exchanged for an HttpOnly session cookie; WebChess does not place
              the code in local storage or bundle it into the site.
            </p>
            {error && (
              <p className="form-hint access-gate-error" id="access-code-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary-button"
              type="submit"
              disabled={accessCode.length === 0 || submitting}
            >
              {submitting ? 'Starting session…' : 'Enter WebChess'}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </form>
        )}
      </div>

      <div className="question-board-column" aria-hidden="true">
        <div className="board-ornament">
          {checking ? <ShieldCheck size={28} /> : <KeyRound size={28} />}
          <small>private</small>
        </div>
        <div className="board-card is-preview">
          <RadialBoard parts={[]} pieces={[]} stage="question" disabled />
        </div>
      </div>
    </section>
  )
}
