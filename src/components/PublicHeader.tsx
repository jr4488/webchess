import { ArrowRight } from 'lucide-react'

export function PublicHeader() {
  return (
    <header className="public-header">
      <a className="brand public-brand" href="/" aria-label="WebChess home">
        <span className="brand-mark" aria-hidden="true">
          <span />
        </span>
        <span className="brand-word">WebChess</span>
      </a>

      <nav className="public-nav" aria-label="About WebChess">
        <a href="#method">Method</a>
        <a href="#board-logic">Board logic</a>
        <a href="#lineage">Lineage</a>
        <a href="#innovation">Innovation</a>
      </nav>

      <a className="public-header__cta" href="/play">
        Play WebChess
        <ArrowRight size={15} aria-hidden="true" />
      </a>
    </header>
  )
}
