import {
  ArrowRight,
  BookOpenText,
  FlaskConical,
  Github,
  Scale,
  ShieldAlert,
} from 'lucide-react'
import Link from 'next/link'

import styles from './PublicSite.module.css'
import { PublicShell } from './PublicShell'

const PRINCIPLES = [
  {
    icon: FlaskConical,
    title: 'Falsifiable by design',
    body: 'The evaluation program compares WebChess against direct answers, matched-compute reasoning, facet-only systems, random selection, and component ablations.',
  },
  {
    icon: Scale,
    title: 'Claims stay bounded',
    body: 'Random casting creates perturbation. Chess creates a path. Neither creates evidence, probability, causality, or moral authority.',
  },
  {
    icon: ShieldAlert,
    title: 'Threats are explicit',
    body: 'The security model covers prompt injection, monitor evasion, correlated models, seed grinding, poisoned evidence, stale callbacks, and memory contamination.',
  },
] as const

export function ResearchHome() {
  return (
    <PublicShell>
      <section className={styles.researchHero} aria-labelledby="research-hero-title">
        <p className={styles.eyebrow}>WebChess research</p>
        <h1 id="research-hero-title">Research that can survive disassembly.</h1>
        <p>
          WebChess is an implemented architecture and a falsifiable research program. Its value
          depends on controlled comparisons—not how profound the board feels while it is moving.
        </p>
      </section>

      <section className={styles.researchDocuments} aria-label="Research documents">
        <article className={styles.researchDocumentPrimary}>
          <BookOpenText aria-hidden="true" />
          <p>Primary document</p>
          <h2>WebChess 2.0 white paper</h2>
          <span>
            The ANANSI protocol, circular-chess computation, Portia, Gate, Retry, Charlotte,
            Wilbur, provenance, failure modes, and evaluation program.
          </span>
          <Link href="/white-paper">
            Read online <ArrowRight aria-hidden="true" size={17} />
          </Link>
        </article>
        <article>
          <Github aria-hidden="true" />
          <p>Implementation</p>
          <h2>Canonical source</h2>
          <span>
            Complete Next.js application, circular rules engine, durable lifecycle, tests,
            operational documentation, and research fixtures.
          </span>
          <a href="https://github.com/jr4488/webchess">
            Inspect GitHub <ArrowRight aria-hidden="true" size={17} />
          </a>
        </article>
      </section>

      <section className={styles.section} aria-labelledby="principles-title">
        <header className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionIndex}>Research posture</p>
            <h2 id="principles-title">Architecture first. Evidence next.</h2>
          </div>
          <p>
            The paper makes a design-science claim: computation outside model parameters may add
            value by governing representations, authorities, refusal, action, and memory.
          </p>
        </header>
        <div className={styles.proofGrid}>
          {PRINCIPLES.map(({ icon: Icon, title, body }) => (
            <article key={title}>
              <Icon aria-hidden="true" />
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={`${styles.section} ${styles.darkSection}`} id="safety" aria-labelledby="safety-title">
        <div className={styles.researchSafety}>
          <div>
            <p className={styles.sectionIndex}>Safety and control</p>
            <h2 id="safety-title">A safety-relevant architecture, not a safety certificate.</h2>
          </div>
          <div>
            <p>
              WebChess separates generation, criticism, admission, communication, action, and
              memory. That can improve procedural control, but it does not solve alignment,
              intentional model subversion, or catastrophic-risk prevention.
            </p>
            <ul>
              <li>Portia may still share the generator’s blind spots.</li>
              <li>Provenance can preserve poisoned material perfectly.</li>
              <li>Charlotte can make a weak basis sound responsible.</li>
              <li>Only experiments can establish whether the controls add net safety.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="lineage-title">
        <header className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionIndex}>Intellectual lineage</p>
            <h2 id="lineage-title">Influence without counterfeit endorsement.</h2>
          </div>
          <p>
            Wilhelm and the Yijing, Jung, Turing, Fischer, Portia spiders, Anansi, and Charlotte
            illuminate different computational functions. None anticipated or endorsed this software.
          </p>
        </header>
        <div className={styles.lineageList}>
          <span>Richard Wilhelm</span>
          <span>C. G. Jung</span>
          <span>Alan Turing</span>
          <span>Bobby Fischer</span>
          <span>Portia spiders</span>
          <span>Anansi</span>
          <span>Charlotte</span>
        </div>
      </section>

      <section className={styles.closing}>
        <p className={styles.eyebrow}>Open research</p>
        <h2>Attack the architecture. Keep what survives.</h2>
        <a className={styles.primaryAction} href="https://github.com/jr4488/webchess/discussions">
          Join the discussion <ArrowRight aria-hidden="true" size={18} />
        </a>
      </section>
    </PublicShell>
  )
}
