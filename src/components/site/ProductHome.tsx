import Link from 'next/link'

import styles from './PublicSite.module.css'
import { PublicShell } from './PublicShell'

const METHOD = [
  {
    number: '01',
    title: 'Divide the actual question',
    body: 'A server-side reasoning call proposes exactly 64 bounded, problem-specific facets. Structural and lexical checks catch known failure patterns; they cannot prove relevance or truth.',
  },
  {
    number: '02',
    title: 'Cast an unfamiliar field',
    body: 'Facets, I Ching-inspired change lenses, and board positions are shuffled independently. Randomness broadens what may receive attention; it does not validate an association.',
  },
  {
    number: '03',
    title: 'Play the complete game',
    body: 'The circular rules engine plays legal moves to a real ending. Every capture records which facet, lens, piece role, and side polarity met in conflict.',
  },
  {
    number: '04',
    title: 'Synthesize the trail',
    body: 'A second server-side reasoning call receives the original question and inspectable game record, then proposes a candidate answer and reversible next actions.',
  },
] as const

export function ProductHome() {
  return (
    <PublicShell>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div>
          <p className={styles.eyebrow}>Circular chess for difficult questions</p>
          <h1 id="hero-title">A question becomes a field. Play decides what to inspect.</h1>
          <p className={styles.heroLead}>
            WebChess divides an open-ended problem into 64 perspectives, casts them onto a
            circular chessboard, plays the tensions to an ending, and turns the capture trail into
            practical next moves.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryAction} href="/play">
              Play WebChess
            </Link>
            <Link className={styles.secondaryAction} href="/white-paper">
              Read the white paper
            </Link>
          </div>
        </div>

        <aside className={styles.heroBoundary}>
          <strong>The governing boundary</strong>
          <p>
            Board events generate salience, not evidence. WebChess is a reflection protocol—not
            prophecy, proof, or a substitute for judgment.
          </p>
        </aside>
      </section>

      <section className={styles.section} id="method" aria-labelledby="method-title">
        <div className={styles.sectionHeading}>
          <h2 id="method-title">One method, four inspectable transformations.</h2>
          <p>
            The stages stay separate so a fluent answer cannot conceal how the question was
            divided, what was randomized, what happened in play, or which material reached the
            final synthesis.
          </p>
        </div>
        <ol className={styles.methodList}>
          {METHOD.map((step) => (
            <li key={step.number}>
              <span className={styles.stepNumber}>{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section} aria-labelledby="game-title">
        <div className={styles.sectionHeading}>
          <h2 id="game-title">Circular chess, implemented as a complete game.</h2>
          <p>
            The application uses the real WebChess rules and purpose-built Engine V2. It is not a
            simplified animation or a standard chess engine placed behind a round board.
          </p>
        </div>

        <dl className={styles.facts}>
          <dt>Geometry</dt>
          <dd>Eight bounded rings and eight sectors that wrap at the seam.</dd>
          <dt>Polarity</dt>
          <dd>White carries outside-in evidence; Black carries inside-out intention.</dd>
          <dt>Rules</dt>
          <dd>
            Direct King capture, pawn promotion, and a clear initial two-ring pawn move. There is
            no check, castling, or en passant.
          </dd>
          <dt>Ending</dt>
          <dd>
            King capture wins. Mutual immobility, 100 quiet plies, or 256 total plies draws; a side
            with no legal move passes.
          </dd>
          <dt>Engine V2</dt>
          <dd>
            Iterative principal-variation search, transposition tables, tactical exchange search,
            variant-aware evaluation, deterministic work budgets, and worker cancellation.
          </dd>
        </dl>
      </section>

      <section className={styles.section} aria-labelledby="record-title">
        <div className={styles.sectionHeading}>
          <h2 id="record-title">The answer has a visible provenance.</h2>
          <p>
            A saved game can be restored after refresh and replayed from its original field and
            ordered events. The server, not the browser, rechecks the rules and derives the result.
          </p>
        </div>

        <div className={styles.provenanceGrid}>
          <article className={styles.provenancePanel}>
            <h3>Included in final synthesis</h3>
            <ul className={styles.checkList}>
              <li>the original question and game ending;</li>
              <li>turn, conflict, recurrence, and attention information;</li>
              <li>grouped captured facets and their change lenses;</li>
              <li>the chronological capture trail.</li>
            </ul>
          </article>
          <article className={styles.provenancePanel}>
            <h3>Deliberately excluded</h3>
            <ul className={styles.checkList}>
              <li>uncaptured facets;</li>
              <li>ordinary moves that produced no capture;</li>
              <li>visitor-supplied API keys or ChatGPT credentials;</li>
              <li>claims that a random association is factual evidence.</li>
            </ul>
          </article>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="security-title">
        <div className={styles.sectionHeading}>
          <h2 id="security-title">Accounts preserve games. The server holds the cost boundary.</h2>
          <p>
            Clerk protects game and model routes. Neon stores per-user game events and usage
            records durably. OpenAI calls run only in authenticated server-side routes using the
            deployment secret, with quotas, rate limits, concurrency control, and abuse checks.
          </p>
        </div>
        <div className={styles.rulesGrid}>
          <article className={styles.rulesPanel}>
            <h3>For players</h3>
            <p>
              Sign in with the configured Clerk options, continue a saved game after refresh, and
              use the account page to manage stored data. No provider key belongs in the browser.
            </p>
          </article>
          <article className={styles.rulesPanel}>
            <h3>For operators</h3>
            <p>
              Keep Clerk, Neon, and OpenAI credentials in server-only Vercel secrets. Preview,
              inspect, and approve a release before assigning a production domain.
            </p>
          </article>
        </div>
      </section>

      <section className={styles.boundarySection} aria-labelledby="evidence-title">
        <h2 id="evidence-title">A capture tells you where to look. Reality decides what holds.</h2>
        <p>
          Connect highlighted questions to observation, stakeholder testimony, domain knowledge,
          measurements, and reversible experiments. The white paper states the supporting
          research, counterevidence, failure modes, and unvalidated claims.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="open-title">
        <div className={styles.sectionHeading}>
          <h2 id="open-title">Open method. Inspectable implementation.</h2>
          <p>
            WebChess is an independent project published under Apache-2.0. The source, engine
            tests, research record, contribution guide, and support conversations are open for
            review.
          </p>
        </div>
        <div className={styles.openGrid}>
          <article className={styles.openPanel}>
            <h3>Read and build</h3>
            <p>
              <a href="https://github.com/jr4488/webchess">Browse the source on GitHub</a>, read
              the <Link href="/install">installation guide</Link>, or download the{' '}
              <a href="/downloads/webchess-source.zip" download>source archive</a>.
            </p>
          </article>
          <article className={styles.openPanel}>
            <h3>Question and improve</h3>
            <p>
              Use <a href="https://github.com/jr4488/webchess/discussions">GitHub Discussions</a>{' '}
              for method and support, then follow the{' '}
              <Link href="/contributing">contribution guide</Link> for focused changes.
            </p>
          </article>
        </div>
      </section>

      <section className={styles.closing} aria-labelledby="closing-title">
        <h2 id="closing-title">Bring a question worth examining.</h2>
        <Link className={styles.primaryAction} href="/play">
          Start a game
        </Link>
      </section>
    </PublicShell>
  )
}
