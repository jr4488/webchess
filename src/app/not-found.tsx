import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="main-content">
      <section className="stage-card" aria-labelledby="not-found-title">
        <p className="eyebrow">404</p>
        <h1 id="not-found-title">That page is not on this board.</h1>
        <p>Return to the WebChess method or install the local research runtime.</p>
        <p>
          <Link href="/">WebChess home</Link> ·{' '}
          <Link href="/install">Install WebChess</Link>
        </p>
      </section>
    </main>
  )
}
