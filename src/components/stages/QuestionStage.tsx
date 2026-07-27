import type { FormEvent } from 'react'
import { ArrowRight, ChevronRight, Eye, Layers, Target } from 'lucide-react'

import type { HostedProvider } from '../../lib/hosted-provider'
import { normalizeProblemInput } from '../../lib/problem'
import { RadialBoard } from '../RadialBoard'

const EXAMPLE_PROBLEMS = [
  'How can I grow my work without losing what makes it mine?',
  'Where is the real tension in my decision to move?',
  'How do we rebuild trust after a difficult season?',
]

interface QuestionStageProps {
  problem: string
  provider: HostedProvider
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
            Your question is saved to your WebChess account and sent from the server through{' '}
            {provider.label} using {provider.model} to build the 64-part map. After play, the server
            replays the saved move log and sends only the original question, verified ending, and
            capture-derived record for the answer. WebChess supplies the provider credential;
            your browser never sends an API key.{' '}
            <a href={provider.dataControlsUrl} target="_blank" rel="noreferrer">
              OpenAI Platform data controls
            </a>
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
