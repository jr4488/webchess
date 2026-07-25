# WebChess

WebChess is a circular problem-solving game inspired by ideas of change and polarity in the I Ching. Before play, `gpt-5.6-sol` uses medium reasoning to propose a bounded 64-cell perspective map of the player's actual question. Deterministic quality checks reject obvious numbered scaffolds and widespread near-duplicate wording; they do not prove that every facet is relevant, correct, or semantically distinct. The accepted facets are placed across an eight-ring by eight-sector board. White moves from outside evidence inward; Black moves from inner intention outward. Captures identify the facets that deserve closer attention, while each piece contributes a different metaphor.

Each new division uses independent random permutations for the problem facets, the 64 I Ching hexagrams, and the completed facet–hexagram pairs' board positions. A replay preserves the current field so different moves can be compared against the same material; submitting the problem for a new division creates a new field.

The game plays to a real ending: capturing a King (the opposing Core Purpose) wins. A no-move position, 100 moves without a capture, or a 256-move limit supplies a finite draw fallback. Seven captured signals mark reflection depth; they are not evidence and do not stop the game.

After the ending, the server turns the complete capture trail, recurring captured facets, their randomly paired I Ching change-lenses, attacking and challenged piece metaphors, attention weights, and result into an inspectable prompt. Uncaptured facets are not sent to the final synthesis. The server sends the prompt to `gpt-5.6-sol` with the OpenAI Responses API and displays the answer. The board reading remains visible as an explanation of how the prompt was formed. WebChess is a reflective problem-solving tool, not divination or prediction.

## Run locally

1. Install the locked dependencies:

   ```bash
   npm ci
   ```

2. Copy `.env.example` to `.env`, then set `OPENAI_API_KEY`, a private
   `WEBCHESS_ACCESS_CODE` of at least 12 characters, and a random
   `WEBCHESS_SESSION_SECRET` of at least 32 bytes. Keep all three server-side;
   never put them in a `VITE_*` variable.

3. Start WebChess:

   ```bash
   npm run dev
   ```

4. Open `http://localhost:5173` for the public explainer or
   `http://localhost:5173/play` to go directly to the game.

An API key is required for the model-generated 64-cell perspective map. WebChess shows a retryable error instead of silently substituting a fallback template when analysis cannot be reached or its bounded quality checks fail. One new game normally makes two model calls: the initial structured division and the final answer. Replaying the current board reuses its existing division.

## Production

```bash
npm run build
npm start
```

The production server serves `dist/`, `/api/divide`, and `/api/answer` from the same process. `OPENAI_MODEL` can override the default model without exposing it to the browser. Production sessions use `Secure` cookies, so terminate TLS at the server or a trusted reverse proxy and forward requests over HTTPS.

Access revocations, per-session request limits, the daily 100-call ceiling, and
the four-call concurrency gate are held in process memory. They reset when the
process restarts and do not coordinate across multiple replicas. Run one
WebChess API process unless those controls are moved to shared storage, and set
an OpenAI project budget as the durable spend backstop in either case.

## Verification

```bash
npm run verify
npm audit --audit-level=high
```

`verify` runs the offline test suite with coverage thresholds, lint,
TypeScript and production build checks, plus the production dependency
audit. The second command also audits development tooling.

The offline division-quality fixtures can be run separately with:

```bash
npx vitest run server/division-quality.test.js
```

These fixtures cover obvious templates and lexical near-duplication. They are a regression check, not a substitute for representative model evaluations and human review.

## Circular movement and players

- The board has eight bounded rings and eight wrapping sectors.
- Rooks travel radially or around a ring; bishops travel along ring-sector diagonals.
- Knights, queens, and kings combine the corresponding polar moves.
- White pawns move inward and Black pawns move outward.
- The guided players compare material value, immediate recapture risk, King safety, direct pressure, radial progress, and convergence toward opponents. Equal moves use a seeded tie-break, so replaying the current board follows the same guided path.
- Castling and en passant are intentionally omitted in this reflective circular variant.
