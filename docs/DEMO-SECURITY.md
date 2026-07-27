# Public demonstration security model

The public website uses a visitor-supplied OpenAI API key for a guided demonstration. It is intentionally separate from the full self-hosted application.

## Credential path

1. The key is held only in page-memory state.
2. It is sent over HTTPS to a same-origin API route.
3. The route validates origin, input size, model identifier, and field shape.
4. The route forwards the key in the OpenAI Authorization header.
5. The request sets `store: false`.
6. The route returns only the structured result with `Cache-Control: no-store`.
7. The key is not written to cookies, browser storage, application storage, analytics, or logs by project code. Reloading clears it.

The deployment platform and OpenAI still process the request under their own operational and account-level policies. `store: false` does not by itself establish Zero Data Retention.

## Scope

The public run demonstrates perspective generation, independently seeded placement, constrained encounters, provenance, and evidence-disciplined synthesis. The repository implements the complete circular-chess game.

Never use the public demonstration with confidential, regulated, or safety-critical material.
