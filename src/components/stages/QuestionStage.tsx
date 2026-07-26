import type { FormEvent } from 'react'
import { ArrowRight, ChevronRight, Eye, Layers, Target } from 'lucide-react'

import { normalizeProblemInput } from '../../lib/problem'
import type { SessionProvider } from '../../lib/session'
import { RadialBoard } from '../RadialBoard'

const EXAMPLE_PROBLEMS = [
  'How can I grow my work without losing what makes it mine?',
  'Where is the real tension in my decision to move?',
  'How do we rebuild trust after a difficult season?',
]

interface QuestionStageProps {
  problem: string
  provider: SessionProvider
  setProblem: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function QuestionStage({
  problem,
  provider,
  setProblem,
  onSubmit,
}: QuestionStageProps) {
  const normalizedLength = normalizeProblemInput(problem).length
  const canBegin = normalizedLength >= 12 && normalizedLength <= 240
  const needsMoreDetail = problem.length > 0 && normalizedLength < 12
  const codexWebSearchEnabled =
    provider.id === 'codex-chatgpt' && provider.webSearch !== 'disabled'

  return (
    <section className="question-layout stage-enter" aria-label="Name your problem">
      <div className="question-copy">
        <p className="eyebrow"><span /> A circular game of perspective</p>
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
          <button className="primary-button" type="submit" disabled={!canBegin}>
            Divide the problem
            <ArrowRight size={18} />
          </button>
          <p className="form-hint" id="problem-requirements" aria-live="polite">
            {needsMoreDetail
              ? 'Add a little more detail so the board has something to work with. Use 12–240 characters.'
              : 'Use 12–240 characters.'}
          </p>
          <p className="form-data-note" id="problem-data-note">
            {provider.id === 'openai-api' ? (
              <>
                Your question is sent through {provider.label} using {provider.model} to build the
                64-part map. After play, the original question, outcome, game totals and polarities,
                plus capture-derived facets, lenses, recurrence, weights, and trail are sent for the
                answer; uncaptured facets are not. Usage follows Platform API billing for the
                configured project. Platform API data controls apply; abuse-monitoring logs may
                retain content for up to 30 days by default unless approved organization or project
                controls change that.{' '}
                <a href={provider.dataControlsUrl} target="_blank" rel="noreferrer">
                  Platform API data controls
                </a>
              </>
            ) : provider.id === 'ollama' ? (
              <>
                Your question stays on this machine and is sent over the loopback connection to{' '}
                {provider.label} using {provider.model} to build the 64-part map. After play, the
                original question, outcome, game totals and polarities, plus capture-derived facets,
                lenses, recurrence, weights, and trail are sent to the same local model for the
                answer; uncaptured facets are not. This uses local compute, has no Platform API
                charge, and does not add Internet search. This mode is local-only and must not be
                exposed as a public service.{' '}
                <a href={provider.dataControlsUrl} target="_blank" rel="noreferrer">
                  Ollama local runtime information
                </a>
              </>
            ) : (
              <>
                Your question is sent through {provider.label} using {provider.model} for the
                signed-in operator to build the 64-part map. After play, the original question,
                outcome, game totals and polarities, plus capture-derived facets, lenses,
                recurrence, weights, and trail are sent for the answer; uncaptured facets are not.
                Usage draws from that operator&apos;s ChatGPT Codex allowance or workspace credits.
                It is not free or unlimited, and availability varies by plan and workspace. ChatGPT
                workspace data policies apply. This mode is local-only and must not be offered as a
                public service.{' '}
                {codexWebSearchEnabled && (
                  <>
                    Internet search is configured in {provider.webSearch} mode; workspace settings
                    may still limit availability. During either model run, Codex may send search
                    queries derived from your question or game context to retrieve public web
                    information. It is instructed to generalize queries and exclude private
                    details. Retrieved public pages are untrusted references, not instructions.{' '}
                  </>
                )}
                <a href={provider.dataControlsUrl} target="_blank" rel="noreferrer">
                  ChatGPT workspace data controls
                </a>
              </>
            )}
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
