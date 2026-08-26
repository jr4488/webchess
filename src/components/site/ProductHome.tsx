import Link from 'next/link'

import {
  configuredReleaseCommit,
  immutableReleaseSourceUrl,
} from '@/lib/release-source'

import { AmbientWeb } from './AmbientWeb'
import { EpisodePlayer } from './EpisodePlayer'
import { PublicShell } from './PublicShell'

const HEXAGRAMS = Array.from({ length: 64 }, (_, index) =>
  String.fromCharCode(0x4dc0 + index),
).join(' ')

const LIFECYCLE_PANELS = [
  {
    glyph: '䷀',
    authority: 'Model-mediated authority',
    authorityClass: 'wc-authority-model',
    title: 'Anansi',
    body: 'Generates exactly 64 facets and applies the seeded cast as a first-class direction for each mapped board part.',
    prohibition: 'declare any facet true or complete.',
  },
  {
    glyph: '䷄',
    authority: 'Deterministic authority',
    authorityClass: 'wc-authority-det',
    title: 'Chess',
    body: 'A semantically blind engine plays a complete game, then code derives one replay-verifiable directional record from every move, pass, capture, piece value, survivor route, and terminal outcome.',
    prohibition: 'read facet meaning or assess evidence.',
  },
  {
    glyph: '䷅',
    authority: 'Model-mediated authority',
    authorityClass: 'wc-authority-model',
    title: 'Portia',
    body: 'Attacks every surviving candidate with thirteen examinations and must retain auditable amendments from the trajectory-directional record before any answer exists.',
    prohibition: 'generate the substantive answer.',
  },
  {
    glyph: '䷐',
    authority: 'Deterministic authority',
    authorityClass: 'wc-authority-det',
    title: 'Gate',
    body: 'Code decides whether the record-bound reviewed basis and exact prospective Answer prompt satisfy the persisted sufficiency rules.',
    prohibition: 'invent material, waive requirements, or certify truth.',
  },
  {
    glyph: '䷏',
    authority: 'Deterministic authority',
    authorityClass: 'wc-authority-det',
    title: 'Retry',
    body: 'Code permits at most two additional same-field games and one regenerated field after a failed Gate.',
    prohibition: 'erase ancestry, exceed the budget, or force an Answer after exhaustion.',
  },
  {
    glyph: '䷊',
    authority: 'Generated artifact · not an authority',
    authorityClass: 'wc-authority-model',
    title: 'Answer artifact',
    body: 'After a passed Gate, the model synthesizes only the exact permitted prompt: reviewed evidence, usable candidates, required directional amendments, and qualifications.',
    prohibition: 'cite consumed or unresolved candidates.',
  },
  {
    glyph: '䷗',
    authority: 'Model-mediated authority',
    authorityClass: 'wc-authority-model',
    title: 'Charlotte',
    body: 'Applies truth, stakeholder, audience, and directional review to the stored Answer and returns one standalone corrected final answer plus exactly three reversible actions.',
    prohibition: 'defer corrections or substitute unrelated analysis.',
  },
  {
    glyph: '䷒',
    authority: 'Human-owned authority',
    authorityClass: 'wc-authority-human',
    title: 'Wilbur',
    body: 'The person plans, runs, abandons, or completes an action—and records what reality did.',
    prohibition: 'be delegated: the model never declares success.',
  },
  {
    glyph: '䷾',
    authority: 'Persistence authority',
    authorityClass: 'wc-authority-store',
    title: 'The Web',
    body: 'Preserves the full genealogy—field, seeds, moves, the directional record and digest, dispositions, actions, and observations.',
    prohibition: 'convert provenance into truth.',
  },
] as const

const STATUS = [
  {
    title: 'Implemented',
    body: '64-facet cast contract, full-trajectory directional record, circular engine, 13 Portia attacks, deterministic Gate, Charlotte, Wilbur, and provenance.',
    limit: 'Does not establish that any component improves reasoning.',
  },
  {
    title: 'Reproducible',
    body: 'The same field, seeds, versions, and canonical event log reconstruct the cast, game state, directional record, and digest.',
    limit: 'Does not make a reproducible trajectory epistemically privileged.',
  },
  {
    title: 'Inspectable',
    body: 'Typed artifacts expose how the complete trajectory shaped surviving directions, amendments, dispositions, thresholds, transitions, and ancestry.',
    limit: 'Does not guarantee truth or prevent manipulation.',
  },
  {
    title: 'Falsifiable',
    body: 'Preregistered baselines, component ablations, cross-seed analysis, adversarial suites, and real-world follow-up.',
    limit: 'Does not promise the system will survive evaluation.',
  },
] as const

const PHASES = [
  {
    label: 'Phase 1',
    title: 'Contract and implementation audit',
    body: 'One authoritative version manifest; every lifecycle transition tested; artifacts bound to exact prompt and source digests.',
  },
  {
    label: 'Phase 2',
    title: 'Minimum scientific evaluation',
    body: 'A diverse ill-structured problem corpus; direct, matched-compute, and ablation baselines; multiple seeds per problem; preregistered analysis.',
  },
  {
    label: 'Phase 3',
    title: 'Adversarial safety evaluation',
    body: 'Dynamic prompt injection, correlated-model conditions, memory poisoning, and replay tampering. Attack failures get published, not laundered.',
  },
  {
    label: 'Phase 4',
    title: 'Human consequence and longitudinal learning',
    body: 'Do people execute the actions? Do thresholds change decisions? Does memory improve later cycles without amplifying contamination?',
  },
  {
    label: 'Phase 5',
    title: 'Simplification',
    body: 'Remove any component that does not earn its cost. A system that refuses to molt has mistaken its current shell for its essence.',
  },
] as const

export function ProductHome() {
  const immutableSourceUrl = immutableReleaseSourceUrl()
  const releaseCommit = immutableSourceUrl ? configuredReleaseCommit() : null

  return (
    <PublicShell>
      <section className="wc-hero" id="top" aria-labelledby="wc-home-title">
        <AmbientWeb />
        <div className="wc-hero-veil" aria-hidden="true" />
        <div className="wc-hero-in">
          <div className="wc-kicker">WebChess 2.2.0-rc.1 · Research instrument</div>
          <h1 id="wc-home-title">
            Every question arrives wrapped in its first frame.{' '}
            <span className="wc-goldline">WebChess cuts it loose.</span>
          </h1>
          <p className="wc-hero-lede">
            An external institution around a foundation model: <strong>sixty-four candidate
            perspectives</strong>, a reproducible symbolic cast, a complete circular-chess
            traversal, <strong>adversarial review before any answer exists</strong>, a
            deterministic Gate that can refuse—and durable provenance for everything that
            survives.
          </p>
          <div className="wc-hero-ctas">
            <Link className="wc-btn" href="/install">Run WebChess locally</Link>
            {immutableSourceUrl ? (
              <Link className="wc-btn wc-btn-plain" href="/white-paper">
                Read mapped paper 3.1
              </Link>
            ) : (
              <Link className="wc-btn wc-btn-plain" href="/white-paper">
                Read historical paper 3.0
              </Link>
            )}
            <a className="wc-btn wc-btn-plain" href="#episode">Watch an episode</a>
          </div>
        </div>
        <div className="wc-scroll-cue" aria-hidden="true">Descend</div>
      </section>

      <div className="wc-hexstrip" aria-hidden="true">
        <div className="wc-hexrow">{HEXAGRAMS} {HEXAGRAMS}</div>
      </div>

      <section className="wc-rule" id="rulemoment" data-wc-rule>
        <div className="wc-wrap">
          <div className="wc-kicker">The governing rule</div>
          <h2>
            Full trajectories generate <span className="wc-salience">direction,</span>
            <br />
            <span className="wc-strike">not evidence.</span>
          </h2>
          <p>
            The seeded cast directs every mapped facet, and the complete legal trajectory—not
            captures alone—deterministically ranks the directions that Portia must scrutinize.
            That directional influence is required and traceable, but it is <b>never factual
            evidence</b>. Evidence enters only through observation, sources, domain knowledge,
            stakeholder testimony, formal tools, and real-world tests.
          </p>
        </div>
      </section>

      <section className="wc-block" id="method">
        <div className="wc-wrap">
          <div className="wc-kicker" data-wc-reveal>Why it exists</div>
          <h2 className="wc-sec" data-wc-reveal>A model can solve the wrong problem beautifully.</h2>
          <div className="wc-method-grid">
            <div data-wc-reveal>
              <p>
                Many consequential questions are ill structured: the actors are disputed, the
                objective is unstable, constraints are incomplete, values collide, and the
                initial wording already smuggles in a preferred answer. In those conditions, a
                fluent completion is a fast route to a confident answer to the wrong problem.
              </p>
              <div className="wc-pull">
                Once the first frame captures the prompt, every later sentence pays taxes to it.
              </div>
            </div>
            <div data-wc-reveal>
              <p>
                <b>WebChess does not change the model&apos;s weights. It changes the episode the
                model operates in.</b> Generation, perturbation, traversal, attack, admission,
                communication, action, and memory are separated into components with distinct
                authority.
              </p>
              <p>
                The result is <b>deliberative middleware</b>: an external computational institution
                surrounding a parametric model. Whether it earns its cost remains an open,
                explicitly falsifiable question—and the project publishes failure conditions next
                to its claims.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="wc-block wc-episode" id="episode">
        <div className="wc-wrap">
          <EpisodePlayer />
        </div>
      </section>

      <section className="wc-block" id="lifecycle">
        <div className="wc-wrap">
          <div className="wc-kicker" data-wc-reveal>The Arachne lifecycle</div>
          <h2 className="wc-sec" data-wc-reveal>
            Eight formal authorities, one generated Answer artifact.
          </h2>
          <p className="wc-sec-lede" data-wc-reveal>
            The Arachne Method names the whole deliberative architecture, and WebChess is its
            software instrument. ANANSI names only Anansi&apos;s initial Division and field
            construction. Its eight authorities are Anansi, Chess, Portia, Gate, Retry,
            Charlotte, Wilbur, and the Web. Answer sits between a passed Gate and Charlotte as a
            generated artifact—not a ninth authority. Every panel states its narrow power and an
            explicit prohibition.
          </p>
          <div className="wc-stages">
            {LIFECYCLE_PANELS.map((stage) => (
              <article className="wc-stage" data-wc-reveal key={stage.title}>
                <span className="wc-stage-glyph" aria-hidden="true">{stage.glyph}</span>
                <span className={`wc-authority ${stage.authorityClass}`}>{stage.authority}</span>
                <h3>{stage.title}</h3>
                <p>{stage.body}</p>
                <p className="wc-maynot"><b>May not</b> {stage.prohibition}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="wc-block" id="honesty">
        <div className="wc-wrap">
          <div className="wc-kicker" data-wc-reveal>Stated plainly</div>
          <h2 className="wc-sec" data-wc-reveal>The claims and the refusals.</h2>
          <p className="wc-sec-lede" data-wc-reveal>
            The architecture is implemented. Its benefits are hypotheses.
          </p>
          <div className="wc-ledger" data-wc-reveal>
            <div className="wc-ledger-is">
              <h3>WebChess is</h3>
              <ul>
                <li>A structured external representation for difficult questions</li>
                <li>A reproducible perturbation and traversal protocol</li>
                <li>A separation-of-authority architecture</li>
                <li>A generator of hypotheses, countercases, and reversible actions</li>
                <li>An auditable episode with persistent ancestry</li>
              </ul>
            </div>
            <div className="wc-ledger-isnot">
              <h3>WebChess is not</h3>
              <ul>
                <li>A replacement for evidence or expertise</li>
                <li>Divination, prophecy, or a causal oracle</li>
                <li>Proof that multiple model calls are independent minds</li>
                <li>An autonomous high-stakes decision maker</li>
                <li>A validated safety technology—yet</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="wc-block" id="research">
        <div className="wc-wrap">
          <div className="wc-kicker" data-wc-reveal>Research program</div>
          <h2 className="wc-sec" data-wc-reveal>Every layer must earn its complexity.</h2>
          <p className="wc-sec-lede" data-wc-reveal>
            A spider-shaped bureaucracy is still a bureaucracy. Each component must survive
            direct, matched-compute, random, semantic, and human baselines—and null results belong
            in the record.
          </p>
          <div className="wc-status-grid">
            {STATUS.map((item) => (
              <article className="wc-status" data-wc-reveal key={item.title}>
                <h4>{item.title}</h4>
                <p>{item.body}</p>
                <p className="wc-not">{item.limit}</p>
              </article>
            ))}
          </div>
          <div>
            {PHASES.map((item) => (
              <article className="wc-phase" data-wc-reveal key={item.label}>
                <span className="wc-phase-label">{item.label}</span>
                <div>
                  <h4>{item.title}</h4>
                  <p>{item.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="wc-block" id="paper">
        <div className="wc-wrap">
          <div className="wc-paper-card" data-wc-reveal>
            <div className="wc-paper-left">
              {immutableSourceUrl ? (
                <>
                  <div className="wc-kicker">Mapped candidate paper · edition 3.1</div>
                  <h3>The Arachne Method and WebChess</h3>
                  <p>
                    The replication companion maps the Arachne Method to WebChess 2.2.0-rc.1,
                    this exact immutable source commit, and the reviewed release identity. It
                    documents the public reader-to-running-game path and makes no validated
                    efficacy claim. Historical edition 3.0 remains available as a preserved audit
                    artifact; it is not the candidate release paper.
                  </p>
                  <p>
                    Exact candidate source:{' '}
                    <a href={immutableSourceUrl}>
                      <code>{releaseCommit}</code>
                    </a>
                  </p>
                </>
              ) : (
                <>
                  <div className="wc-kicker">Historical technical paper · edition 3.0</div>
                  <h3>The First Answer Is Not Enough</h3>
                  <p>
                    Deliberation before decision. This repository-audited account preserves the
                    Arachne Method before integration and maps to audited source{' '}
                    <a href="https://github.com/jr4488/webchess/tree/0384978b2ba709da4c9824f2821c8623d3f84364">
                      <code>0384978b2ba709da4c9824f2821c8623d3f84364</code>
                    </a>
                    . Candidate paper 3.1 remains publication-blocked until the immutable release
                    source and artifacts resolve.
                  </p>
                </>
              )}
              <div className="wc-paper-actions">
                <Link className="wc-btn" href="/white-paper">
                  {immutableSourceUrl
                    ? 'Open mapped candidate paper 3.1'
                    : 'Open historical paper 3.0'}
                </Link>
                {immutableSourceUrl ? (
                  <a className="wc-btn wc-btn-plain" href="/downloads/webchess-white-paper.pdf" download>
                    Download mapped PDF
                  </a>
                ) : null}
                <a className="wc-btn wc-btn-plain" href="/downloads/webchess-white-paper-v3-historical.pdf" download>
                  Download historical PDF
                </a>
                {immutableSourceUrl ? (
                  <>
                    <a className="wc-btn wc-btn-plain" href={immutableSourceUrl}>
                      Inspect exact source
                    </a>
                    <a className="wc-btn wc-btn-plain" href="/downloads/webchess-release-identity.json" download>
                      Verify release identity
                    </a>
                  </>
                ) : (
                  <span className="wc-btn wc-btn-plain" role="status" aria-disabled="true">
                    Source identity pending
                  </span>
                )}
              </div>
            </div>
            <div className="wc-paper-right">
              <h4>Reference implementation manifest</h4>
              <ul className="wc-manifest">
                <li><span className="wc-manifest-key">whole method</span><span className="wc-manifest-value">The Arachne Method</span></li>
                <li><span className="wc-manifest-key">software</span><span className="wc-manifest-value">WebChess 2.2.0-rc.1</span></li>
                <li><span className="wc-manifest-key">ANANSI</span><span className="wc-manifest-value">Anansi / Division field construction</span></li>
                <li><span className="wc-manifest-key">code freeze</span><span className="wc-manifest-value">{releaseCommit ?? 'unresolved · publication blocked'}</span></li>
                <li><span className="wc-manifest-key">released tag</span><span className="wc-manifest-value">v2.1.0 · 9980328581ba3e6fed6f2c4fc99b555fec4773bc</span></li>
                <li><span className="wc-manifest-key">boundary</span><span className="wc-manifest-value">candidate · efficacy not validated</span></li>
                <li><span className="wc-manifest-key">board</span><span className="wc-manifest-value">8 rings × 8 sectors</span></li>
                <li><span className="wc-manifest-key">engine</span><span className="wc-manifest-value">150,000-node default · depth cap 12</span></li>
                <li><span className="wc-manifest-key">retry budget</span><span className="wc-manifest-value">2 same-field · 1 regenerated-field</span></li>
                <li><span className="wc-manifest-key">license</span><span className="wc-manifest-value">Apache-2.0</span></li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </PublicShell>
  )
}
