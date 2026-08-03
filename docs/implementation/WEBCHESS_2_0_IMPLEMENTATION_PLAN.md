# WebChess 2.0 implementation plan

**Target branch:** `feature/webchess-2.0`
**Baseline commit:** `6d3c7fa0f86d9ec09dd25f899a9fbc12c5b33c67`
**Prepared:** August 1, 2026

## Delivery boundary

This branch upgrades the existing authenticated, server-authoritative WebChess
application to this seven-stage visible lifecycle:

```text
Anansi -> Chess -> Portia -> Answer -> Charlotte -> Wilbur -> Web
```

The deterministic Gate and bounded semantic Retry policy remain authoritative,
inspectable internal branches between Portia and Answer; they are not separate
steps on the player-facing rail.

The circular-chess rules and Engine V2 remain semantically blind and retain
their current versions. Existing v1 games retain their saved event and answer
semantics and are shown as legacy runs; v2 lifecycle artifacts are never
fabricated for them. No deployment, production resource mutation, secret
change, DNS change, or hosted configuration change is part of this work.

## Worktree and baseline audit

The existing `/Users/anansi/Codex/webchess` worktree contained ten unrelated,
uncommitted OpenClaw changes on `feature/openclaw-webchess`. They were left
untouched. This implementation uses the isolated worktree
`/Users/anansi/Codex/webchess-2.0`, created on `feature/webchess-2.0` from the
locally verified `origin/main` commit above. A remote refresh was attempted but
the local HTTPS Git credential path returned `Repository not found`; the local
remote-tracking commit exactly matches the commit reviewed by the v2 paper.

Dependencies were installed with `npm ci` from `package-lock.json`:

- 393 packages installed.
- `npm audit` during installation reported 0 vulnerabilities.
- The shell is Node 25.9.0 with npm 11.12.1; the project declares Node 22.x and
  npm 11.x. This engine warning is recorded and verification results must not
  be represented as Node 22 evidence.

Baseline checks before editing:

| Command | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed; Next route types generated |
| `npm run test` | Passed: 59 files, 773 tests |
| `npm run test:integration` | Baseline was initially environment-blocked. A loopback-only disposable PostgreSQL 17 container was later authorized for this worktree; the expanded v2 suite passes against it. |
| `npm run build` | Passed; 15 static/dynamic route groups compiled |
| `git diff --check` | Passed; isolated worktree remained clean |

The integration failure is a missing test database, not a baseline application
regression. Completion reporting will keep database-backed results separate
unless an explicitly disposable PostgreSQL 17 URL becomes available.

## Authoritative end-to-end flow

1. `POST /api/divide` validates the problem, reserves a durable `division`
   model request, creates a `games` shell, calls OpenAI with `store:false`,
   validates exactly 64 facets, composes the seeded field, and persists it.
2. `POST /api/games/:id/start` transitions `mapped -> playing` with an expected
   revision and idempotency key.
3. `POST /api/games/:id/moves` accepts only a piece ID, destination, and
   expected revision. The repository replays canonical events, validates the
   move, derives captures/promotions/passes/endings, and appends events using
   compare-and-swap semantics.
4. `GET /api/games/:id` and `/api/games/current` rebuild the public board from
   the canonical initial state and ordered append-only event history.
5. After canonical replay proves the ending, the server derives the survivor
   ecology and assembles the exact candidate Answer prompt from the original
   question and replay-derived board weights, values, routes, captures, and
   signal provenance.
6. `POST /api/games/:id/portia` validates that exact prompt before generation.
   Each schema-valid per-signal assessment, the current signal, completed IDs,
   and prompt digest are persisted. Recovery resumes only unfinished signals.
   Three failed or indeterminate provider-started attempts end in the technical
   `portia_unavailable` state without fabricating a review or downstream result.
7. The internal deterministic Gate evaluates a complete Portia review. A failed
   Gate may authorize a bounded same-field or regenerated-field Retry; semantic
   exhaustion becomes `insufficient_basis`.
8. `POST /api/games/:id/answer` generates from the exact reviewed prompt only
   after Portia permits it and the Gate passes. The stored Answer carries the
   lifecycle-run, prompt-digest, and Gate-input provenance.
9. `POST /api/games/:id/charlotte` qualifies that exact persisted Answer for
   truthfulness, uncertainty, values, stakeholders, audience, and reversible
   action. It cannot substitute an unrelated synthesis.
10. Wilbur records the user's action and observation; Web provenance preserves
    the genealogy and versioned artifacts.
11. `POST /api/games/:id/replay` atomically clones the field and accounts for a
   counted game start through `game_start_requests`, usage, and rate buckets.
12. Account export uses a bounded repeatable-read snapshot; deletion is guarded
   by durable provider leases and Clerk's signed deletion webhook.

Legacy v1 games without a v2 lifecycle retain their stored answer semantics;
the v2 path never falls back to them when Portia, Gate, Answer, or Charlotte is
unavailable.

## Affected-surface map

### Contracts and versions

- `package.json` and lockfile: software version `2.1.0`.
- `src/types.ts` and `src/lib/game-contract.ts`: public lifecycle DTOs and
  version constants. Rules, engine, cast, and event versions do not change.
- New `src/lib/lifecycle/` modules: strict contracts, state transitions,
  survivor derivation, Gate algorithm, retry policy, Charlotte validation,
  Wilbur records, digests, and render helpers.
- `src/lib/webchess-api.ts`: lifecycle parsing and typed client mutations.

### Model operations and accounting

- `src/server/openai/`: Portia prompt validation, approved Answer generation,
  and Charlotte exact-answer qualification as distinct structured operations
  with bounded prompts/outputs, fixed model configuration, `store:false`,
  prompt-injection framing, and no hidden reasoning field.
- `src/server/usage/types.ts`, `service.ts`, and `queries.ts`: recognize
  `portia` and `charlotte` as distinct operations while retaining the existing
  reservation, lease, settlement, idempotency, deletion, and quota behavior.
- `model_requests.operation` and `rate_buckets.action` constraints expand
  forward-only. The `answer` operation carries v2 Portia/Gate approval
  provenance while the stored legacy-v1 path remains readable.

### Persistence and exact schema verification

- Add `db/migrations/0002_webchess_2_lifecycle.sql` and later forward-only
  lifecycle migrations such as `0003_prompt_review_answer_stage.sql`; never
  alter applied migration bytes.
- Small relational lifecycle design:
  - `lifecycle_runs`
  - `portia_reviews`
  - `gate_decisions`
  - `charlotte_results`
  - `wilbur_actions`
  - `wilbur_observations`
  - `lifecycle_events`
- Runs link to authoritative games and preserve root/parent ancestry, lifecycle
  state, independent seeds, semantic retry counters, terminal fingerprints,
  survivor packages, the reviewed Answer-prompt digest, current and completed
  Portia signals, validated assessment drafts, the active-attempt fence, the
  persisted three-attempt failure budget, and every required
  contract/algorithm version.
- Final Portia reviews, Gate decisions, generated Answer approval provenance,
  and Charlotte qualifications are immutable per attempt. Wilbur observations
  are append-only. Lifecycle events preserve transition genealogy without
  storing hidden chain-of-thought.
- `scripts/deployment-database.mjs` exact table/column/index and least-privilege
  allowlists expand for all new tables.
- Row schemas in `src/server/db/rows.ts` validate new tables and expanded model
  operations.

### Server lifecycle authority

- New `src/server/lifecycle/` repository and service modules own every v2
  transition. No lifecycle authority is reconstructed from browser input.
- Terminal survivors are derived from canonical replay, including stable IDs,
  final square/facet/lens, piece role and polarity, route, captures, promotion,
  move count, attempt IDs, and immutable digests.
- Portia input is the complete server-derived candidate Answer prompt package,
  bound to its canonical digest. Output must contain exactly one assessment per
  survivor and use the controlled disposition, attack, and coverage taxonomies.
  Each accepted assessment is persisted in deterministic traversal order; an
  active model-request fence prevents a late attempt from overwriting it.
- Portia technical execution is bounded separately from semantic Retry. The
  third failed or indeterminate provider-started attempt produces
  `portia_unavailable`, preserves partial progress, and creates no Portia
  review, Gate decision, Answer, or Charlotte result.
- The Gate is deterministic and versioned. Initial hard floors are four usable
  candidates, three independent clusters, required purpose/evidence/risk/action
  coverage, an explicit non-redundant tension, and no fatal contradiction.
- Retry permits at most two same-field replays and one field regeneration.
  Duplicate terminal/survivor fingerprints escalate toward regeneration.
  Exhaustion produces `insufficient_basis`; Answer and Charlotte remain
  inaccessible.
- Answer generation receives only the exact Portia-permitted, Gate-passed board
  prompt and stores its approval provenance.
- Charlotte receives that exact persisted Answer plus its Portia/Gate source,
  preserves every wound used as support, exposes uncertainty and reversal
  conditions, and returns exactly three structured reversible experiments.
- Wilbur actions and observations remain human-owned, owner-scoped, revisioned,
  and idempotent. A model cannot mark an action successful.

### HTTP routes and service adapter

- Extend `src/server/http/contracts.ts`, `ports.ts`, `handlers.ts`, and the
  production adapter with operations equivalent to:
  - `GET /api/games/:id/lifecycle`
  - `POST /api/games/:id/portia`
  - `POST /api/games/:id/answer`
  - `POST /api/games/:id/retry`
  - `POST /api/games/:id/charlotte`
  - `POST /api/games/:id/wilbur/actions`
  - `POST /api/games/:id/wilbur/actions/:actionId/observations`
  - `GET /api/games/:id/provenance`
- Every mutation retains Clerk authentication, same-origin checks, strict JSON,
  owner-scoped lookup, idempotency, expected revision, rate/quota enforcement,
  and safe public errors.
- The Answer route retains legacy compatibility for a game without a v2 run.
  For v2 it fails closed unless the exact prompt has a persisted Portia permit
  and Gate pass; Charlotte then requires the exact persisted generated Answer.

### Export, deletion, and integrity

- Account export size estimation and payload queries include every lifecycle
  table and event.
- Existing deletion cascades are extended through owner/game foreign keys;
  forced deletion continues to win over late model settlement.
- Database tests cover migration from `0001`, exact schema, least privilege,
  export repeatability, cascade correctness, and provider-settlement races.

### UI and accessibility

- `src/App.tsx` restores and advances v2 lifecycle state instead of requesting
  the legacy answer immediately.
- A compact lifecycle rail shows Anansi, Chess, Portia, Answer, Charlotte,
  Wilbur, and Web. Gate and Retry details remain visible inside the Portia and
  retry explanation without displacing Answer from the sequence.
- The terminal view includes an accessible survivor ecology, Portia
  traversal driven by persisted current/completed signals, dispositions and
  reasons, deterministic Gate explanation, retry ancestry and remaining
  budget, a distinct Answer generation state, Charlotte's exact-answer review,
  Wilbur action tracking, and a provenance timeline.
- Motion is ornamental to no state: every transition has a text equivalent,
  keyboard path, semantic landmark, live status, and reduced-motion behavior.
- `insufficient_basis` is a first-class visible result and never a generic
  model error.
- `portia_unavailable` is a stable accessible technical terminal after three
  provider-started failures; the spider remains at the last persisted signal
  without implying continued work, and no Answer stage is activated.
- `charlotte_unavailable` is a separate stable terminal after three fenced
  qualification failures. The already generated board Answer remains visible
  with an explicit not-qualified warning; Charlotte stops, and Wilbur/Web do
  not imply that a reviewed intervention exists.

### Documentation

- Copy the supplied v2 paper to `docs/WEBCHESS_WHITE_PAPER_V2.md` and make it
  canonical once code and documentation agree.
- Archive the current paper at
  `docs/archive/WEBCHESS_WHITE_PAPER_V1.3.md` without deleting history.
- Update README, architecture, research, security, installation, privacy,
  terms, acceptable use, operator cost/retry guidance, and generated-document
  sources.
- Distinguish implemented facts from hypotheses and do not claim deployment.

## Implementation sequence and commit plan

1. `Define WebChess 2.0 lifecycle contracts`
   - versions, typed state machine, survivor extraction, Portia schemas, Gate,
     Retry, Answer, Charlotte, Wilbur, and unit tests.
2. `Persist the WebChess 2.0 genealogy`
   - forward migration, exact schema contract, lifecycle repository, export,
     deletion, and persistence tests.
3. `Add Portia, internal Gate/Retry, Answer, and Charlotte services`
   - prompt-bound model operations, resumable Portia progress, durable ledger
     integration, routes, idempotency, and service/security tests.
4. `Add Wilbur actions and Web provenance`
   - action/observation routes, genealogy query, and authorization tests.
5. `Build the seven-stage visible WebChess interface`
   - Anansi/Chess/Portia/Answer/Charlotte/Wilbur/Web rail, internal Gate/Retry
     detail, refresh recovery, accessibility, reduced motion, and end-to-end
     fixtures.
6. `Document WebChess 2.0`
   - canonical paper, archive, architecture, research, security, installation,
     privacy, terms, operator guide, and version bump.

Commits are created only after their phase passes focused verification.

## Verification strategy

Focused checks run continuously. The completion gate is:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run test:integration
npm audit --omit=dev --audit-level=high
npm audit --audit-level=high
npm run build
npm run test:a11y
npm run test:e2e
npm run test:links
npm run verify
```

Lifecycle acceptance also covers exact prompt/digest binding, crash recovery
from persisted Portia assessments without repeating completed signals, the
third technical failure reaching `portia_unavailable` across restart, no Answer
or Charlotte call after either terminal refusal, and the visible
Portia → Answer → Charlotte order with equivalent reduced-motion and text
status.

Charlotte acceptance separately covers selected material support, byte-exact
wounded qualifications displayed once, restart-safe active-request fencing,
and the third technical failure reaching `charlotte_unavailable` without a
fourth automatic request.

No test or CI path may make a live model request. Database-backed results will
be reported as environment-blocked unless a disposable PostgreSQL 17 test
database is available. Tests, coverage thresholds, migration verification,
sandbox checks, and security assertions will not be weakened to obtain green
output.

## Completion risks tracked explicitly

- The local remote cannot currently refresh through Git HTTPS credentials.
- The current shell is not the declared Node 22 runtime.
- Database integration and least-privilege verification use the explicitly
  authorized, loopback-only disposable PostgreSQL 17 environment for this
  worktree; no production database is used.
- The v2 architecture remains an experimental hypothesis; passing software
  tests cannot validate cognitive effectiveness.
- No production or preview deployment is authorized by this plan.
