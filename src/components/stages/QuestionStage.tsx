import type { FormEvent } from 'react'
import { ArrowRight, ChevronRight, Database, Eye, Layers, Target } from 'lucide-react'

import type { HostedProvider } from '../../lib/hosted-provider'
import { normalizeProblemInput } from '../../lib/problem'
import type { ResearchConsentDecision } from '../../lib/research'
import { RadialBoard } from '../RadialBoard'

const EXAMPLE_PROBLEMS = [
  'How can I grow my work without losing what makes it mine?',
  'Where is the real tension in my decision to move?',
  'How do we rebuild trust after a difficult season?',
]

interface QuestionStageProps {
  problem: string
  provider: HostedProvider
  researchConsentDecision: ResearchConsentDecision | null
  setProblem: (value: string) => void
  setResearchConsentDecision: (value: ResearchConsentDecision) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  selectedMemoryCount?: number
  onOpenMemory?: () => void
}

export function QuestionStage({
  problem,
  provider,
  researchConsentDecision,
  setProblem,
  setResearchConsentDecision,
  onSubmit,
  selectedMemoryCount = 0,
  onOpenMemory,
}: QuestionStageProps) {
  const normalizedLength = normalizeProblemInput(problem).length
  const isOpenClaw = provider.kind === 'openclaw'
  const canBegin =
    isOpenClaw &&
    normalizedLength >= 12 &&
    normalizedLength <= 240 &&
    researchConsentDecision !== null
  const needsMoreDetail = problem.length > 0 && normalizedLength < 12

  return (
    <section className="question-layout stage-enter" aria-label="Name your problem">
      <div className="question-copy">
        <p className="eyebrow">
          <span />
          {isOpenClaw
            ? 'WebChess 2.2 · OpenClaw local web'
            : 'Hosted gameplay retired · install locally'}
        </p>
        <h1><span>Bring a problem.</span><br /><em>Play toward clarity.</em></h1>
        <p className="lede">
          A difficult question becomes 64 candidate perspectives. White moves from the world inward;
          black moves from intention outward. Where they meet is where you look closer.
        </p>

        <form className="question-form" onSubmit={onSubmit}>
          <label htmlFor="problem">What are you trying to understand?</label>
          <div className="textarea-wrap">
            <textarea
              id="problem"
              value={problem}
              onChange={(event) => setProblem(event.target.value)}
              placeholder="Describe a real tension, decision, or question…"
              rows={3}
              minLength={12}
              maxLength={240}
              required
              aria-describedby="problem-requirements problem-character-count problem-data-note"
              aria-invalid={needsMoreDetail}
            />
            <span className="character-count" id="problem-character-count">{problem.length}/240</span>
          </div>
          <fieldset
            className="research-consent"
            aria-describedby="research-consent-disclosure"
          >
            <legend>External research for this game</legend>
            <label>
              <input
                type="radio"
                name="research-consent"
                value="allow_search_and_page_fetch"
                checked={researchConsentDecision === 'allow_search_and_page_fetch'}
                onChange={() => setResearchConsentDecision('allow_search_and_page_fetch')}
                required
              />
              <span>
                <strong>Allow bounded research</strong>
                Send the exact query shown in the lifecycle through OpenClaw Codex
                Hosted Search, then let this local WebChess process fetch at most
                three returned HTTPS pages.
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="research-consent"
                value="no_external_research"
                checked={researchConsentDecision === 'no_external_research'}
                onChange={() => setResearchConsentDecision('no_external_research')}
                required
              />
              <span>
                <strong>Do not use external research</strong>
                Continue with the model and board lifecycle without Hosted Search
                or direct page retrieval for this game.
              </span>
            </label>
          </fieldset>
          <button className="primary-button" type="submit" disabled={!canBegin}>
            Divide the problem
            <ArrowRight size={18} />
          </button>
          <p className="form-hint" id="problem-requirements" aria-live="polite">
            {needsMoreDetail
              ? 'Add a little more detail so the board has something to work with. Use 12–240 characters.'
              : 'Use 12–240 characters.'}
          </p>
          {onOpenMemory ? (
            <button
              className={`question-memory-selection${selectedMemoryCount > 0 ? ' is-active' : ''}`}
              type="button"
              onClick={onOpenMemory}
            >
              <Database size={15} aria-hidden="true" />
              {selectedMemoryCount > 0
                ? `${selectedMemoryCount} prior observation${selectedMemoryCount === 1 ? '' : 's'} will enter this game`
                : 'Bring a prior Wilbur observation into this game'}
            </button>
          ) : null}
          <p className="form-data-note" id="problem-data-note">
            {isOpenClaw ? (
              <>
                Your game, verified move log, and seven-stage visible WebChess 2.2 lifecycle stay
                in a dedicated PostgreSQL database on this machine. A loopback-only WebChess
                process sends model turns through {provider.label} using {provider.model}.
                OpenClaw uses your sole selected OpenAI account/OAuth profile and contacts OpenAI;
                no provider API key or token fallback is accepted. Credentials never enter the
                browser, Next.js child, PostgreSQL records, or a WebChess-operated service. After
                play, Portia validates the board-derived answer
                prompt, the internal Gate checks sufficiency, Answer generation runs only after
                permission, Charlotte reviews and qualifies it, and Wilbur carries the result into
                action.{' '}
                <a href={provider.dataControlsUrl} target="_blank" rel="noreferrer">
                  {provider.dataControlsLabel ?? 'How OpenClaw runs model requests'}
                </a>
              </>
            ) : (
              <>
                Hosted gameplay is retired and cannot begin here. Use the packed,
                loopback-only OpenClaw runtime with OpenAI account/OAuth authentication.{' '}
                <a href="/install">Open the installation guide</a>
              </>
            )}
          </p>
          <p className="form-data-note" id="research-consent-disclosure">
            This versioned choice is saved with this game and inherited by a
            bounded retry. This game UI does not ask for or store OpenClaw or
            OpenAI credentials; the local OpenClaw runtime handles its authenticated
            provider path separately. Search and page retrieval are recorded
            separately, page text remains untrusted, failures stay visible, and
            you can instead opt out without blocking play.
          </p>
        </form>

        <div className="example-prompts">
          <span>Or begin with an example</span>
          {EXAMPLE_PROBLEMS.map((example) => (
            <button key={example} type="button" onClick={() => setProblem(example)}>
              <ChevronRight size={13} />
              {example}
            </button>
          ))}
        </div>
      </div>

      <div className="question-board-column">
        <div className="board-ornament" aria-hidden="true"><span>64</span><small>parts</small></div>
        <div className="board-card is-preview">
          <RadialBoard parts={[]} pieces={[]} stage="question" disabled />
          <div className="orbit-note orbit-note--outer">
            <span>WHITE</span>
            evidence moves inward
          </div>
          <div className="orbit-note orbit-note--inner">
            <span>BLACK</span>
            intention moves outward
          </div>
        </div>
        <div className="principle-strip">
          <div><Layers size={17} /><span><b>Divide</b> See the whole in parts</span></div>
          <div><Target size={17} /><span><b>Conflict</b> Notice where attention gathers</span></div>
          <div><Eye size={17} /><span><b>Read</b> Turn signals into a next move</span></div>
        </div>
      </div>
    </section>
  )
}
