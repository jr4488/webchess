import Link from 'next/link'

import {
  configuredReleaseCommit,
  immutableReleaseSourceUrl,
} from '@/lib/release-source'

import { PublicShell } from './PublicShell'

const PRINCIPLES = [
  {
    title: 'Falsifiable by design',
    body: 'The evaluation program compares WebChess against direct answers, matched-compute reasoning, facet-only systems, random selection, semantic selection, and component ablations.',
  },
  {
    title: 'Claims stay bounded',
    body: 'The cast is a required directional input, and the full legal chess trajectory deterministically shapes the scrutiny record. Neither is factual evidence, probability, causality, or moral authority.',
  },
  {
    title: 'Threats are explicit',
    body: 'The security model covers prompt injection, monitor evasion, correlated models, seed grinding, poisoned evidence, stale callbacks, and memory contamination.',
  },
] as const

const LINEAGE = [
  'Richard Wilhelm',
  'C. G. Jung',
  'Alan Turing',
  'Bobby Fischer',
  'Portia spiders',
  'Anansi',
  'Charlotte',
  'Wilbur',
  'Extended cognition',
  'Distributed cognition',
] as const

export function ResearchHome() {
  const immutableSourceUrl = immutableReleaseSourceUrl()
  const releaseCommit = immutableSourceUrl ? configuredReleaseCommit() : null

  return (
    <PublicShell>
      <section className="wc-research-hero" aria-labelledby="wc-research-title">
        <div className="wc-wrap">
          <div className="wc-kicker">WebChess research</div>
          <h1 id="wc-research-title">Research that can survive disassembly.</h1>
          <p>
            WebChess is an implemented architecture and a falsifiable research program. Its value
            depends on controlled comparisons—not how profound the board feels while it is moving.
          </p>
        </div>
      </section>

      <section className="wc-block" aria-labelledby="research-documents-title">
        <div className="wc-wrap">
          <h2 className="wc-sec" id="research-documents-title" data-wc-reveal>
            Read the architecture. Inspect the implementation.
          </h2>
          <div className="wc-research-documents" data-wc-reveal>
            <article className="wc-research-document">
              {immutableSourceUrl ? (
                <>
                  <small>Mapped candidate paper · edition 3.1</small>
                  <h2>The Arachne Method and WebChess</h2>
                  <p>
                    The implementation and replication companion is bound to exact immutable
                    source <a href={immutableSourceUrl}><code>{releaseCommit}</code></a> and the
                    reviewed release identity. It documents reproducibility boundaries and makes
                    no validated efficacy claim.
                  </p>
                  <Link href="/white-paper">Read mapped candidate edition 3.1</Link>
                  {' · '}
                  <a href="/downloads/webchess-white-paper.pdf" download>
                    Download mapped PDF
                  </a>
                  {' · '}
                  <a href="/downloads/webchess-release-identity.json">
                    Verify release identity
                  </a>
                </>
              ) : (
                <>
                  <small>Candidate paper · edition 3.1</small>
                  <h2>Code-freeze release mapping</h2>
                  <p>
                    Edition 3.1 must name the same immutable source commit and artifact digests as
                    the release identity. It is not presented as a public artifact until those
                    values resolve.
                  </p>
                  <span role="status">Edition 3.1 publication pending code freeze</span>
                </>
              )}
            </article>
            <article className="wc-research-document">
              <small>Historical audit document · edition 3.0</small>
              <h2>The First Answer Is Not Enough</h2>
              <p>
                The Arachne Method, circular-chess computation, Portia, Gate, Retry, Answer,
                Charlotte, Wilbur, provenance, implementation audit, and evaluation program.
                WebChess is the software instrument; ANANSI names its initial Anansi/Division
                field-construction stage, not the whole method. This preserved edition maps to{' '}
                <a href="https://github.com/jr4488/webchess/tree/0384978b2ba709da4c9824f2821c8623d3f84364">
                  exact source <code>0384978b2ba709da4c9824f2821c8623d3f84364</code>
                </a>
                . It remains a historical audit artifact and is not silently relabeled as the
                candidate edition 3.1 release paper.
              </p>
              {immutableSourceUrl ? (
                <a href="/downloads/webchess-white-paper-v3-historical.html">
                  Read preserved historical edition 3.0
                </a>
              ) : (
                <Link href="/white-paper">Read historical edition 3.0</Link>
              )}
            </article>
            <article className="wc-research-document">
              <small>Canonical implementation</small>
              <h2>Source and reproducibility</h2>
              <p>
                Complete Next.js application, circular rules engine, durable lifecycle, tests,
                operational documentation, research fixtures, and Apache-2.0 source.
              </p>
              {immutableSourceUrl ? (
                <>
                  <a href={immutableSourceUrl}>
                    Inspect exact source <code>{releaseCommit}</code>
                  </a>{' · '}
                  <a href="/downloads/webchess-release-identity.json">
                    Verify release identity
                  </a>
                </>
              ) : (
                <span role="status">Immutable source pending code freeze</span>
              )}
            </article>
          </div>
        </div>
      </section>

      <section className="wc-block" aria-labelledby="posture-title">
        <div className="wc-wrap">
          <div className="wc-kicker" data-wc-reveal>Research posture</div>
          <h2 className="wc-sec" id="posture-title" data-wc-reveal>
            Architecture first. Evidence next.
          </h2>
          <p className="wc-sec-lede" data-wc-reveal>
            The design-science claim is that useful computation can occur outside model parameters
            by governing representations, authorities, refusal, action, and memory.
          </p>
          <div className="wc-status-grid">
            {PRINCIPLES.map((principle) => (
              <article className="wc-status" data-wc-reveal key={principle.title}>
                <h4>{principle.title}</h4>
                <p>{principle.body}</p>
              </article>
            ))}
            <article className="wc-status" data-wc-reveal>
              <h4>Open to failure</h4>
              <p>
                If chess, symbolic lenses, Portia, Charlotte, or the full architecture add no
                measurable value, those layers should be removed.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="wc-block wc-episode" id="safety" aria-labelledby="safety-title">
        <div className="wc-wrap wc-research-safety">
          <div>
            <div className="wc-kicker" data-wc-reveal>Safety and control</div>
            <h2 className="wc-sec" id="safety-title" data-wc-reveal>
              A safety-relevant architecture, not a safety certificate.
            </h2>
          </div>
          <div data-wc-reveal>
            <p>
              WebChess separates generation, criticism, admission, communication, action, and
              memory. That may improve procedural control, but it does not solve alignment,
              intentional model subversion, or catastrophic-risk prevention.
            </p>
            <ul>
              <li>Portia may still share the generator&apos;s blind spots.</li>
              <li>Provenance can preserve poisoned material perfectly.</li>
              <li>Charlotte can make a weak basis sound responsible.</li>
              <li>Persistent memory creates a new attack surface.</li>
              <li>Only experiments can establish whether the controls add net safety.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="wc-block" aria-labelledby="lineage-title">
        <div className="wc-wrap">
          <div className="wc-kicker" data-wc-reveal>Intellectual lineage</div>
          <h2 className="wc-sec" id="lineage-title" data-wc-reveal>
            Influence without counterfeit endorsement.
          </h2>
          <p className="wc-sec-lede" data-wc-reveal>
            Wilhelm and the <em>Yijing</em>, Jung, Turing, Fischer, Portia spiders, Anansi,
            Charlotte, and Wilbur illuminate different computational functions. None anticipated
            or endorsed this software.
          </p>
          <div className="wc-lineage-list" data-wc-reveal>
            {LINEAGE.map((name) => <span key={name}>{name}</span>)}
          </div>
        </div>
      </section>

      <section className="wc-block" aria-labelledby="research-actions-title">
        <div className="wc-wrap">
          <div className="wc-paper-card" data-wc-reveal>
            <div className="wc-paper-left">
              <div className="wc-kicker">Open research</div>
              <h3 id="research-actions-title">Attack the architecture. Keep what survives.</h3>
              <p>
                Read the paper, verify its release identity, inspect that exact code, reproduce
                the lifecycle, and challenge the assumptions in public.
              </p>
              <div className="wc-paper-actions">
                <Link className="wc-btn" href="/white-paper">
                  {immutableSourceUrl ? 'Read mapped paper 3.1' : 'Read historical paper 3.0'}
                </Link>
                {immutableSourceUrl ? (
                  <a
                    className="wc-btn wc-btn-plain"
                    href="/downloads/webchess-white-paper-v3-historical.html"
                  >
                    Read historical paper 3.0
                  </a>
                ) : null}
                <Link className="wc-btn wc-btn-plain" href="/install">Run the candidate locally</Link>
                <a className="wc-btn wc-btn-plain" href="https://github.com/jr4488/webchess/discussions">
                  Join the discussion
                </a>
              </div>
            </div>
            <div className="wc-paper-right">
              <h4>Project boundary</h4>
              <ul className="wc-manifest">
                <li><span className="wc-manifest-key">architecture</span><span className="wc-manifest-value">implemented</span></li>
                <li><span className="wc-manifest-key">benefit claims</span><span className="wc-manifest-value">unvalidated</span></li>
                <li><span className="wc-manifest-key">safety status</span><span className="wc-manifest-value">research-relevant</span></li>
                <li><span className="wc-manifest-key">license</span><span className="wc-manifest-value">Apache-2.0</span></li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </PublicShell>
  )
}
