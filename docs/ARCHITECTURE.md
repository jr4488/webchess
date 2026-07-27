# Architecture

WebChess keeps five transformations separate so their provenance and failure modes remain inspectable.

1. **Question** — preserves the user's unresolved problem as the governing reference.
2. **Division** — a structured model call proposes 64 bounded perspective facets. Deterministic checks reject obvious scaffolds and lexical near-duplication; they do not prove relevance or truth.
3. **Independent cast** — facets, I Ching change lenses, and final board locations use independent random permutations. A replay preserves the field.
4. **Circular play** — eight rings and eight wrapping sectors create a finite game. White moves outside evidence inward; Black moves inner intention outward. Captures create a chronological salience record.
5. **Synthesis** — after a real game ending, a second model call receives the original question, outcome metadata, grouped captured facets, recurrence and attention data, and the capture trail. Uncaptured facets and ordinary non-capture moves are omitted.

## Invariants

- Randomization generates variation, not evidence.
- Board events create salience, not factual warrant.
- The original question remains inspectable.
- Provider selection fails closed and never silently changes.
- Credentials stay outside the browser bundle and repository.
- Final synthesis must remain traceable to the finite game record.
- Local Codex and Ollama modes remain single-owner and loopback-only.

See the [technical white paper](https://webchess.madness.chatgpt.site/research) for the intellectual lineage, evidence matrix, limitations, and evaluation agenda.
