export default function NotFound() {
  return (
    <main className="main-content">
      <section className="stage-card" aria-labelledby="not-found-title">
        <p className="eyebrow">404</p>
        <h1 id="not-found-title">That page is not on this board.</h1>
        <p>Return to the WebChess method or begin a game.</p>
        <p>
          <a href="/">WebChess home</a> · <a href="/play">Play WebChess</a>
        </p>
      </section>
    </main>
  )
}
