/**
 * The animated starfield behind the whole interface.
 *
 * Three parallax layers plus three drifting colour fields, all built from
 * tiled gradients so the cost is a fixed handful of composited layers rather
 * than one element per star. Purely decorative, and hidden from assistive
 * technology.
 */
export function CosmicBackdrop() {
  return (
    <div className="cosmos" aria-hidden="true">
      <div className="cosmos__nebula cosmos__nebula--rose" />
      <div className="cosmos__nebula cosmos__nebula--gold" />
      <div className="cosmos__nebula cosmos__nebula--jade" />
      <div className="cosmos__stars cosmos__stars--far" />
      <div className="cosmos__stars cosmos__stars--mid" />
      <div className="cosmos__stars cosmos__stars--near" />
    </div>
  )
}
