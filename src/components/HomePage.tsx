import type { CSSProperties } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Eye,
  Layers,
  Shuffle,
  Sparkles,
  Swords,
  Target,
} from 'lucide-react'

import { PIECE_GLYPHS, PIECE_ORDER } from '../constants'
import { PROBLEM_DIMENSIONS, PROBLEM_MOVEMENTS } from '../lib/problem'
import { PIECE_METAPHORS } from '../lib/reading'
import { PublicHeader } from './PublicHeader'
import { RadialBoard } from './RadialBoard'

const METHOD_STEPS = [
  {
    number: '01',
    label: 'Name it',
    title: 'Begin with a consequential question.',
    body: 'State a real tension, decision, or problem in ordinary language. The original question remains the anchor for everything that follows.',
  },
  {
    number: '02',
    label: 'Divide it',
    title: 'AI proposes a 64-cell perspective map.',
    body: 'The configured model works across eight practical dimensions and eight movements of change. Bounded checks reject obvious numbered templates and widespread near-duplicates; they do not prove every facet is relevant or distinct.',
  },
  {
    number: '03',
    label: 'Play it',
    title: 'Conflict creates an attention map.',
    body: 'Facets, I Ching lenses, and board positions are independently shuffled. As the round-board game plays to an ending, captures mark tensions for closer examination.',
  },
  {
    number: '04',
    label: 'Read it',
    title: 'AI turns the trail into an answer.',
    body: 'The configured model receives the original problem, ending, capture trail, recurring facets, attention weights, piece metaphors, and change lenses—then proposes practical next moves.',
  },
] as const

const LINEAGE = [
  {
    initials: 'RW',
    name: 'Richard Wilhelm',
    role: 'Movement over fixed things',
    quote: '“Attention centers not on things in their state of being … but upon their movements in change.”',
    source: 'Introduction to The I Ching, 1923; English rendering by Cary F. Baynes',
    href: 'https://yijing.website/Pages/wilhelm.php',
    bridge: 'WebChess reads a problem through transitions. Moves and captures matter because they reveal what changes under pressure.',
  },
  {
    initials: 'BF',
    name: 'Bobby Fischer',
    role: 'Structure made unfamiliar',
    quote: '“I want to keep the old chess game, but just make a change so the starting positions are mixed.”',
    source: 'DWCM radio interview, June 27, 1999; transcript pp. 66–67',
    href: 'https://richardbean.id.au/chess/bf.pdf#page=67',
    bridge: 'WebChess keeps the discipline of chess while random assignment interrupts rehearsed answers and forces fresh interpretation.',
  },
  {
    initials: 'AT',
    name: 'Alan Turing',
    role: 'Chance as a search instrument',
    quote: '“A random element is rather useful when we are searching for a solution of some problem.”',
    source: 'Computing Machinery and Intelligence, 1950',
    href: 'https://doi.org/10.1093/mind/LIX.236.433',
    bridge: 'WebChess uses randomness to perturb attention—not to claim truth—so overlooked relationships have a chance to become visible.',
  },
  {
    initials: 'YL',
    name: 'Yann LeCun',
    role: 'Generate, then evaluate',
    quote: '“You need a component to generate candidate branches and a second component to evaluate them…”',
    source: 'Learning Abstractions, Dædalus, 2026',
    href: 'https://www.amacad.org/publication/daedalus/learning-abstractions-conversation-yann-lecun',
    bridge: 'WebChess separates generation from evaluation: AI maps possibilities, play selects tensions, and a later AI pass evaluates the resulting trail.',
  },
] as const

const INNOVATION_PATHS = [
  {
    number: '01',
    title: 'Semantically aware players',
    body: 'Let each side weigh the relevance of a facet as well as material, safety, and position—making the game strategically responsive to the actual problem.',
  },
  {
    number: '02',
    title: 'Counterfactual branches',
    body: 'Compare several complete games and ask which answer changes when a different capture trail, assumption, or stakeholder perspective is followed.',
  },
  {
    number: '03',
    title: 'Deeper change mechanics',
    body: 'Add trigrams, changing lines, and derived hexagrams while preserving the boundary between reflective metaphor and evidence.',
  },
  {
    number: '04',
    title: 'Learning from action',
    body: 'Record what happened after a recommended next move, then use real outcomes to revise the facet map instead of treating one reading as final.',
  },
] as const

function pieceName(kind: (typeof PIECE_ORDER)[number]): string {
  return `${kind[0].toUpperCase()}${kind.slice(1)}`
}

export function HomePage() {
  return (
    <div className="public-shell">
      <div className="paper-noise" aria-hidden="true" />
      <a className="public-skip-link" href="#public-main">Skip to content</a>
      <PublicHeader />

      <main id="public-main">
        <section className="public-hero" aria-labelledby="public-hero-title">
          <div className="public-hero__copy">
            <p className="eyebrow"><span /> A problem-solving game in 64 parts</p>
            <h1 id="public-hero-title">
              Do not just think harder.
              <em> Change the board.</em>
            </h1>
            <p className="public-hero__lede">
              WebChess combines a round chess game, the I Ching’s language of change, and two
              deliberate AI passes to turn a difficult problem into an inspectable path toward action.
            </p>
            <div className="public-hero__actions">
              <a className="primary-button" href="/play">
                Bring a problem
                <ArrowRight size={18} aria-hidden="true" />
              </a>
              <a className="public-text-link" href="#method">See how it works</a>
            </div>
            <div className="public-hero__boundary">
              <span aria-hidden="true">◌</span>
              A reflective creativity instrument—not prophecy, proof, or a substitute for judgment.
            </div>
          </div>

          <div className="public-hero__visual" aria-label="WebChess round board preview">
            <div className="public-board-orbit" aria-hidden="true" />
            <div className="board-card public-board-card">
              <RadialBoard parts={[]} pieces={[]} stage="question" disabled />
              <div className="public-orbit-label public-orbit-label--white">
                <strong>WHITE</strong>
                <span>evidence moves inward</span>
              </div>
              <div className="public-orbit-label public-orbit-label--black">
                <strong>BLACK</strong>
                <span>intention moves outward</span>
              </div>
            </div>
            <div className="public-board-counter"><strong>64</strong><span>facets</span></div>
          </div>
        </section>

        <section className="site-section method-section" id="method" aria-labelledby="method-title">
          <div className="section-heading">
            <p className="eyebrow"><span /> The complete method</p>
            <h2 id="method-title">Four transformations.<br /><em>One visible trail.</em></h2>
            <p>
              The process is staged so the answer cannot appear before the problem has been
              decomposed, randomized, played, and interpreted.
            </p>
          </div>

          <ol className="method-grid">
            {METHOD_STEPS.map((step) => (
              <li key={step.number}>
                <div className="method-step__meta"><span>{step.number}</span><strong>{step.label}</strong></div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="site-section systems-section" aria-labelledby="systems-title">
          <div className="section-heading section-heading--wide">
            <p className="eyebrow"><span /> Three systems, different jobs</p>
            <h2 id="systems-title">Constraint, change, and synthesis.</h2>
          </div>

          <div className="systems-grid">
            <article>
              <div className="system-icon"><Swords size={23} aria-hidden="true" /></div>
              <p className="system-index">01 · Chess</p>
              <h3>Conflict makes attention selective.</h3>
              <p>
                Chess supplies legal movement, opposing directions, risk, sacrifice, and an ending.
                It turns reflection into a sequence of consequential choices rather than an open-ended brainstorm.
              </p>
              <small>Rules create pressure. Captures create emphasis.</small>
            </article>
            <article>
              <div className="system-icon"><Shuffle size={23} aria-hidden="true" /></div>
              <p className="system-index">02 · I Ching</p>
              <h3>Change gives conflict a second vocabulary.</h3>
              <p>
                Each facet receives one independently randomized hexagram theme. The pairing is a
                perspective-opening metaphor—not evidence, prediction, or a formal divination reading.
              </p>
              <small>Chance opens a view. Judgment decides its value.</small>
            </article>
            <article>
              <div className="system-icon"><Bot size={23} aria-hidden="true" /></div>
              <p className="system-index">03 · AI</p>
              <h3>Analysis happens before and after play.</h3>
              <p>
                The configured model first proposes 64 bounded perspectives on the problem. After
                the game, it receives the capture trail and produces an answer with concrete next
                moves.
              </p>
              <small>AI expands the map, then synthesizes the trace.</small>
            </article>
          </div>
        </section>

        <section className="site-section board-logic-section" id="board-logic" aria-labelledby="board-logic-title">
          <div className="board-logic__copy">
            <p className="eyebrow"><span /> How to read a capture</p>
            <h2 id="board-logic-title">Every conflict becomes a sentence.</h2>
            <p>
              The attacking side supplies a direction. The attacking piece supplies the active mode
              of attention. The captured piece names what is challenged. The destination square
              supplies the literal problem facet and its randomized change lens.
            </p>
            <div className="polarity-pair">
              <div><span className="polarity-stone polarity-stone--white" /><strong>White</strong><small>outside-in evidence</small></div>
              <div><span className="polarity-stone polarity-stone--black" /><strong>Black</strong><small>inside-out intent</small></div>
            </div>
            <p className="board-logic__note">
              Neither color means good or bad. A capture identifies a tension worth examining; it
              does not prove the attacker right or the captured concern wrong.
            </p>
          </div>

          <div className="capture-grammar" aria-label="Example WebChess capture interpretation">
            <div className="capture-force capture-force--active">
              <span className="capture-piece">♖</span>
              <small>Active force</small>
              <strong>White Rook</strong>
              <p>Evidence applies <b>Structure</b></p>
            </div>
            <div className="capture-impact" aria-hidden="true">
              <span />
              <b>captures</b>
              <span />
            </div>
            <div className="capture-force">
              <span className="capture-piece capture-piece--dark">♝</span>
              <small>Challenged force</small>
              <strong>Black Bishop</strong>
              <p><b>Perspective</b> goes under review</p>
            </div>
            <div className="capture-facet">
              <div><span>FACET 27</span><strong>What assumption makes this constraint feel fixed?</strong></div>
              <div><span>HEXAGRAM 49</span><strong>Revolution · clarify what truly needs to change</strong></div>
            </div>
          </div>
        </section>

        <section className="site-section facets-section" aria-labelledby="facets-title">
          <div className="section-heading">
            <p className="eyebrow"><span /> Bounded decomposition</p>
            <h2 id="facets-title">Eight dimensions × eight movements.</h2>
            <p>
              The configured model must address every intersection. Deterministic checks can reject
              obvious numbered scaffolds and widespread near-duplicate wording, but cannot guarantee
              semantic distinctness, relevance, or correctness.
            </p>
          </div>

          <div className="facet-matrix-wrap" tabIndex={0} aria-label="Scrollable 8 by 8 problem facet matrix">
            <div className="facet-matrix">
              <div className="facet-matrix__header">
                <strong>Dimension</strong>
                {PROBLEM_MOVEMENTS.map((movement) => <span key={movement.name}>{movement.name}</span>)}
              </div>
              {PROBLEM_DIMENSIONS.map((dimension, dimensionIndex) => (
                <div className="facet-matrix__row" key={dimension.name}>
                  <strong>{dimension.name}<small>{dimension.keyword}</small></strong>
                  {PROBLEM_MOVEMENTS.map((movement, movementIndex) => {
                    const facetNumber = dimensionIndex * PROBLEM_MOVEMENTS.length + movementIndex + 1
                    return (
                      <span
                        className="facet-matrix__cell"
                        data-testid="facet-cell"
                        key={movement.name}
                        aria-label={`${dimension.name} by ${movement.name}, facet ${facetNumber}`}
                        style={{ '--facet-order': facetNumber } as CSSProperties}
                      >
                        {String(facetNumber).padStart(2, '0')}
                      </span>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="site-section pieces-section" aria-labelledby="pieces-title">
          <div className="section-heading section-heading--split">
            <div>
              <p className="eyebrow"><span /> Six modes of attention</p>
              <h2 id="pieces-title">The pieces ask different questions.</h2>
            </div>
            <p>
              On a capture, the attacker’s metaphor becomes the active method. The captured piece’s
              metaphor identifies the capacity, assumption, or concern placed under pressure.
            </p>
          </div>

          <div className="piece-metaphor-grid">
            {PIECE_ORDER.map((kind, index) => {
              const metaphor = PIECE_METAPHORS[kind]
              return (
                <article key={kind} aria-label={`${pieceName(kind)} means ${metaphor.label}`}>
                  <span className="piece-metaphor__number">0{index + 1}</span>
                  <span className="piece-metaphor__glyph" aria-hidden="true">{PIECE_GLYPHS[kind]}</span>
                  <small>{pieceName(kind)}</small>
                  <h3>{metaphor.label}</h3>
                  <p>{metaphor.role}</p>
                  <strong>{metaphor.action}</strong>
                </article>
              )
            })}
          </div>
        </section>

        <section className="site-section lineage-section" id="lineage" aria-labelledby="lineage-title">
          <div className="section-heading section-heading--wide">
            <p className="eyebrow"><span /> An intellectual lineage</p>
            <h2 id="lineage-title">Four ideas WebChess puts into motion.</h2>
            <p>
              These thinkers did not describe or endorse WebChess. Their words identify design ideas
              the game combines—and directions in which the experiment can grow.
            </p>
          </div>

          <div className="lineage-grid">
            {LINEAGE.map((person) => (
              <article key={person.name}>
                <div className="lineage-card__top"><span>{person.initials}</span><small>{person.role}</small></div>
                <blockquote>{person.quote}</blockquote>
                <h3>{person.name}</h3>
                <p>{person.bridge}</p>
                <a href={person.href} target="_blank" rel="noreferrer">
                  Source · {person.source}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </a>
              </article>
            ))}
          </div>
          <p className="lineage-caveat">
            Quotations are used for design history only. Wilhelm’s English wording is Baynes’s
            translation; citing Fischer’s chess innovation does not endorse his broader views.
          </p>
        </section>

        <section className="site-section creativity-section" aria-labelledby="creativity-title">
          <div className="creativity-intro">
            <p className="eyebrow"><span /> Why it can unlock better ideas</p>
            <h2 id="creativity-title">Creativity needs both divergence and pressure.</h2>
            <p>
              WebChess is designed to interrupt a problem’s first framing, generate remote
              associations, and then force those associations back through constraints and action.
            </p>
          </div>
          <div className="creativity-list">
            <article><Layers size={20} aria-hidden="true" /><div><strong>Forced decomposition</strong><p>A vague whole becomes 64 candidate distinctions to inspect and test.</p></div></article>
            <article><Shuffle size={20} aria-hidden="true" /><div><strong>Structured surprise</strong><p>Independent pairings create associations the first framing would not.</p></div></article>
            <article><Swords size={20} aria-hidden="true" /><div><strong>Adversarial balance</strong><p>Evidence and intention continuously challenge each other.</p></div></article>
            <article><Target size={20} aria-hidden="true" /><div><strong>Attention under constraint</strong><p>Captures force prioritization instead of endless ideation.</p></div></article>
            <article><Eye size={20} aria-hidden="true" /><div><strong>An inspectable trail</strong><p>The answer can be traced back to concrete conflicts and facets.</p></div></article>
            <article><Sparkles size={20} aria-hidden="true" /><div><strong>Actionable convergence</strong><p>AI must translate metaphors into reversible next moves.</p></div></article>
          </div>
          <div className="evidence-boundary">
            <strong>Designed to help; not yet scientifically validated.</strong>
            <p>
              WebChess may improve creativity by widening and reorganizing attention. Its output
              should still be tested against domain knowledge, lived experience, and observable results.
            </p>
          </div>
        </section>

        <section className="site-section innovation-section" id="innovation" aria-labelledby="innovation-title">
          <div className="innovation-heading">
            <p className="eyebrow"><span /> Where the experiment can go</p>
            <h2 id="innovation-title">The next board is more alive.</h2>
            <p>
              Today the automated players understand chess pressure, not the semantic importance of
              a facet. The clearest innovations connect meaning, simulation, and real-world feedback.
            </p>
          </div>
          <div className="innovation-grid">
            {INNOVATION_PATHS.map((path) => (
              <article key={path.number}>
                <span>{path.number}</span>
                <h3>{path.title}</h3>
                <p>{path.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="site-section transparency-section" aria-labelledby="transparency-title">
          <div className="transparency-card">
            <div>
              <p className="eyebrow"><span /> What AI actually sees</p>
              <h2 id="transparency-title">Two model passes. Two distinct jobs.</h2>
            </div>
            <ol>
              <li><span>01</span><div><strong>Before play</strong><p>The original problem is sent to the configured model for a structured 64-facet analysis using medium reasoning.</p></div></li>
              <li><span>02</span><div><strong>After the ending</strong><p>The problem, outcome, capture trail, weights, metaphors, and captured lenses become the final answer prompt.</p></div></li>
            </ol>
            <p className="transparency-card__note">
              The app displays process milestones and the exact inspectable prompts. Private model
              reasoning is never displayed. Uncaptured facets are not declared unimportant.
            </p>
          </div>
        </section>

        <section className="site-section faq-section" aria-labelledby="faq-title">
          <div className="section-heading">
            <p className="eyebrow"><span /> Questions worth asking</p>
            <h2 id="faq-title">What WebChess is—and is not.</h2>
          </div>
          <div className="faq-list">
            <details>
              <summary>Is this an I Ching divination?</summary>
              <p>No. WebChess independently randomizes intact hexagram themes as reflective change lenses. It does not cast changing lines or claim prediction.</p>
            </details>
            <details>
              <summary>Does White winning mean evidence is correct?</summary>
              <p>No. White is outside-in evidence and Black is inside-out intent. Winning means one direction reached the opposing Core Purpose, not that it proved the truth.</p>
            </details>
            <details>
              <summary>Are all 64 facets sent into the final answer?</summary>
              <p>No. The full map guides the board, but the final model receives the original problem, outcome and game totals, side polarities, captured facets and lenses, recurrence, weights, and the capture trail. Uncaptured facets remain available for inspection during play and are not sent in that final request.</p>
            </details>
            <details>
              <summary>How does every game finish?</summary>
              <p>A King capture ends decisively. Safety endings cover a board with no moves, 100 captureless plies, or the 256-ply maximum.</p>
            </details>
            <details>
              <summary>Can I trust the answer?</summary>
              <p>Treat it as a well-structured proposal. Verify facts, challenge assumptions, and test uncertain recommendations with small reversible actions.</p>
            </details>
          </div>
        </section>

        <section className="public-final-cta" aria-labelledby="final-cta-title">
          <div>
            <p className="eyebrow"><span /> Your problem is the opening position</p>
            <h2 id="final-cta-title">Put the question in motion.</h2>
            <p>Let a 64-cell perspective map, two opposing directions, and a complete game show you where to look again.</p>
          </div>
          <a className="primary-button" href="/play">
            Play WebChess
            <ArrowRight size={18} aria-hidden="true" />
          </a>
        </section>
      </main>

      <footer className="public-footer">
        <div><span className="brand-word">WebChess</span><p>A circular problem-solving game inspired by change.</p></div>
        <div><a href="#method">Method</a><a href="#lineage">Sources</a><a href="/play">Play</a></div>
        <p>Thinking aid, not prediction. © {new Date().getFullYear()} WebChess.</p>
      </footer>
    </div>
  )
}
