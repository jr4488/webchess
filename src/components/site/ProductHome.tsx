import {
  ArrowRight,
  BookOpenText,
  Braces,
  CircleDotDashed,
  GitBranch,
  OctagonX,
  ShieldCheck,
} from 'lucide-react'
import Link from 'next/link'

import styles from './PublicSite.module.css'
import { HeroBoard } from './HeroBoard'
import { PublicShell } from './PublicShell'

const METHOD = [
  {
    number: '01',
    title: 'Expand the question',
    body: 'Anansi constructs 64 distinct facets so the first plausible framing loses its monopoly.',
  },
  {
    number: '02',
    title: 'Force real conflict',
    body: 'A complete circular-chess game creates a bounded, replayable path through the field.',
  },
  {
    number: '03',
    title: 'Attack what survives',
    body: 'Portia applies 13 adversarial tests. A deterministic Gate can permit, retry, or refuse.',
  },
  {
    number: '04',
    title: 'Act and remember',
    body: 'Charlotte qualifies the answer; Wilbur records a reversible action and what happened next.',
  },
] as const

const ANANSI = [
  ['A', 'Analyze'],
  ['N', 'Name'],
  ['A', 'Associate'],
  ['N', 'Navigate'],
  ['S', 'Synthesize'],
  ['I', 'Iterate'],
] as const

export function ProductHome() {
  return (
    <PublicShell>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>A deliberative computation layer for AI</p>
          <h1 id="hero-title">Move past the first answer.</h1>
          <p className={styles.heroLead}>
            WebChess turns a difficult question into an auditable process of divergence,
            conflict, adversarial testing, refusal, action, and memory.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryAction} href="/play">
              Play WebChess <ArrowRight aria-hidden="true" size={18} />
            </Link>
            <Link className={styles.secondaryAction} href="/research">
              See the research
            </Link>
          </div>
          <dl className={styles.heroMetrics} aria-label="WebChess method at a glance">
            <div>
              <dt>64</dt>
              <dd>problem perspectives</dd>
            </div>
            <div>
              <dt>13</dt>
              <dd>Portia attack classes</dd>
            </div>
            <div>
              <dt>3</dt>
              <dd>reversible next actions</dd>
            </div>
          </dl>
        </div>
        <HeroBoard />
      </section>

      <section className={styles.boundaryStrip} aria-label="Governing epistemic boundary">
        <strong>Board events generate salience, not evidence.</strong>
        <span>Reality—not the game—decides what holds.</span>
      </section>

      <section className={styles.section} id="method" aria-labelledby="method-title">
        <header className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionIndex}>01 · Method</p>
            <h2 id="method-title">One question. Four visible transformations.</h2>
          </div>
          <p>
            WebChess does not ask one model call to generate, criticize, authorize, persuade,
            and declare success. Those powers are separated and recorded.
          </p>
        </header>
        <ol className={styles.methodGrid}>
          {METHOD.map((step) => (
            <li key={step.number}>
              <span>{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={`${styles.section} ${styles.darkSection}`} aria-labelledby="refusal-title">
        <div className={styles.refusalGrid}>
          <div>
            <p className={styles.sectionIndex}>02 · Safety by architecture</p>
            <h2 id="refusal-title">The system can say no.</h2>
            <p className={styles.largeBody}>
              Portia reviews the exact answer package before generation. The Gate requires
              independent surviving material, mandatory coverage, explicit tension, and no
              severe unresolved contradiction.
            </p>
            <Link className={styles.inlineLinkLight} href="/research#safety">
              Read the threat model <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </div>
          <div className={styles.gatePanel} aria-label="WebChess admission sequence">
            <div className={styles.gateRow}>
              <ShieldCheck aria-hidden="true" />
              <div><strong>Portia</strong><span>Attack every survivor</span></div>
              <b>REVIEW</b>
            </div>
            <div className={styles.gateConnector} aria-hidden="true" />
            <div className={styles.gateRow}>
              <GitBranch aria-hidden="true" />
              <div><strong>Gate</strong><span>Apply deterministic thresholds</span></div>
              <b>DECIDE</b>
            </div>
            <div className={styles.gateOutcomes}>
              <span><CircleDotDashed aria-hidden="true" /> Permit</span>
              <span><Braces aria-hidden="true" /> Retry</span>
              <span><OctagonX aria-hidden="true" /> Refuse</span>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="anansi-title">
        <header className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionIndex}>03 · ANANSI</p>
            <h2 id="anansi-title">A recursive protocol for thinking before concluding.</h2>
          </div>
          <p>
            The acronym names the full metaprotocol. The mythic Anansi supplies the image of
            plural intelligence and strategic indirection; the software turns that image into
            explicit operations.
          </p>
        </header>
        <ol className={styles.anansiRail} aria-label="ANANSI protocol">
          {ANANSI.map(([letter, word]) => (
            <li key={`${letter}-${word}`}>
              <span>{letter}</span>
              <strong>{word}</strong>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section} aria-labelledby="proof-title">
        <header className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionIndex}>04 · Inspection</p>
            <h2 id="proof-title">A result with a chain of custody.</h2>
          </div>
          <p>
            Seeds, board state, moves, attacks, Gate decisions, model prompts, qualifications,
            actions, and observations remain linked in a replayable genealogy.
          </p>
        </header>
        <div className={styles.proofGrid}>
          <article>
            <GitBranch aria-hidden="true" />
            <h3>Replayable</h3>
            <p>The server reconstructs the game from canonical state and ordered events.</p>
          </article>
          <article>
            <ShieldCheck aria-hidden="true" />
            <h3>Prompt-bound</h3>
            <p>Portia and the Gate authorize one exact answer package, not a later substitute.</p>
          </article>
          <article>
            <CircleDotDashed aria-hidden="true" />
            <h3>Falsifiable</h3>
            <p>Every layer can be ablated and compared against simpler baselines.</p>
          </article>
        </div>
      </section>

      <section className={styles.researchBand} aria-labelledby="research-title">
        <div>
          <p className={styles.sectionIndex}>Research program</p>
          <h2 id="research-title">Publish the machinery. Test the claims.</h2>
          <p>
            Read the full architecture, implementation boundary, failure modes, and evaluation
            program. WebChess is presented as a testable method—not a revealed truth.
          </p>
        </div>
        <div className={styles.researchActions}>
          <Link href="/white-paper">
            <BookOpenText aria-hidden="true" />
            <span><strong>White paper</strong><small>Architecture and research agenda</small></span>
            <ArrowRight aria-hidden="true" />
          </Link>
          <a href="https://github.com/jr4488/webchess">
            <Braces aria-hidden="true" />
            <span><strong>Source code</strong><small>Apache-2.0 implementation</small></span>
            <ArrowRight aria-hidden="true" />
          </a>
        </div>
      </section>

      <section className={styles.closing} aria-labelledby="closing-title">
        <p className={styles.eyebrow}>Bring a question worth examining</p>
        <h2 id="closing-title">The first answer is where WebChess begins.</h2>
        <Link className={styles.primaryAction} href="/play">
          Start a game <ArrowRight aria-hidden="true" size={18} />
        </Link>
      </section>
    </PublicShell>
  )
}
