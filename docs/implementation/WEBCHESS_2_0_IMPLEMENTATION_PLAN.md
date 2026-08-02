# WebChess 2.0 implementation plan

**Target branch:** `feature/webchess-2.0`
**Baseline commit:** `6d3c7fa0f86d9ec09dd25f899a9fbc12c5b33c67`
**Prepared:** August 1, 2026

## Delivery boundary

This branch upgrades the existing authenticated, server-authoritative WebChess
application to the eight-stage lifecycle described by the WebChess 2.0 white
paper:

```text
Anansi -> Chess -> Portia -> Gate -> Retry -> Charlotte -> Wilbur -> Web
```

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

## Current end-to-end flow

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
5. `POST /api/games/:id/answer` currently permits synthesis only after terminal
   replay, reserves an `answer` model request, sends the capture trail, and
   stores the rendered answer on `games.answer_payload`.
6. `POST /api/games/:id/replay` atomically clones the field and accounts for a
   counted game start through `game_start_requests`, usage, and rate buckets.
7. Account export uses a bounded repeatable-read snapshot; deletion is guarded
   by durable provider leases and Clerk's signed deletion webhook.

For v2, step 5 becomes Portia -> deterministic Gate -> bounded Retry or
Charlotte. Wilbur and the Web then extend the case after the recommendation.

## Affected-surface map

### Contracts and versions

- `package.json` and lockfile: software version `2.0.0`.
- `src/types.ts` and `src/lib/game-contract.ts`: public lifecycle DTOs and
  version constants. Rules, engine, cast, and event versions do not change.
- New `src/lib/lifecycle/` modules: strict contracts, state transitions,
  survivor derivation, Gate algorithm, retry policy, Charlotte validation,
  Wilbur records, digests, and render helpers.
- `src/lib/webchess-api.ts`: lifecycle parsing and typed client mutations.

### Model operations and accounting

- `src/server/openai/`: new Portia and Charlotte structured operations with
  bounded prompts/outputs, fixed model configuration, `store:false`, prompt
  injection framing, and no hidden reasoning field.
- `src/server/usage/types.ts`, `service.ts`, and `queries.ts`: recognize
  `portia` and `charlotte` as distinct operations while retaining the existing
  reservation, lease, settlement, idempotency, deletion, and quota behavior.
- `model_requests.operation` and `rate_buckets.action` constraints expand
  forward-only. Legacy `answer` remains valid for v1 games only.

### Persistence and exact schema verification

- Add `db/migrations/0002_webchess_2_lifecycle.sql`; never alter `0001`.
- Small relational lifecycle design:
  - `lifecycle_runs`
  - `portia_reviews`
  - `gate_decisions`
  - `charlotte_results`
  - `wilbur_actions`
  - `wilbur_observations`
  - `lifecycle_events`
- Runs link to authoritative games and preserve root/parent ancestry, lifecycle
  state, independent seeds, retry counters, terminal fingerprints, survivor
  packages, and every required contract/algorithm version.
- Portia, Gate, and Charlotte artifacts are immutable per attempt. Wilbur
  observations are append-only. Lifecycle events preserve transition
  genealogy without storing hidden chain-of-thought.
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
- Portia input is derived server-side. Output must contain exactly one
  assessment per survivor and use the controlled disposition, attack, and
  coverage taxonomies.
- The Gate is deterministic and versioned. Initial hard floors are four usable
  candidates, three independent clusters, required purpose/evidence/risk/action
  coverage, an explicit non-redundant tension, and no fatal contradiction.
- Retry permits at most two same-field replays and one field regeneration.
  Duplicate terminal/survivor fingerprints escalate toward regeneration.
  Exhaustion produces `insufficient_basis`; Charlotte remains inaccessible.
- Charlotte can cite only preserved or wounded candidates, preserves every
  wound used as support, exposes uncertainty/reversal conditions, and returns
  exactly three structured reversible experiments.
- Wilbur actions and observations remain human-owned, owner-scoped, revisioned,
  and idempotent. A model cannot mark an action successful.

### HTTP routes and service adapter

- Extend `src/server/http/contracts.ts`, `ports.ts`, `handlers.ts`, and the
  production adapter with operations equivalent to:
  - `GET /api/games/:id/lifecycle`
  - `POST /api/games/:id/portia`
  - `POST /api/games/:id/retry`
  - `POST /api/games/:id/charlotte`
  - `POST /api/games/:id/wilbur/actions`
  - `POST /api/games/:id/wilbur/actions/:actionId/observations`
  - `GET /api/games/:id/provenance`
- Every mutation retains Clerk authentication, same-origin checks, strict JSON,
  owner-scoped lookup, idempotency, expected revision, rate/quota enforcement,
  and safe public errors.
- The old answer route remains compatible only for a game without a v2 run and
  fails closed for v2.

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
- A compact lifecycle rail shows Anansi, Chess, Portia, Gate, Retry, Charlotte,
  Wilbur, and Web.
- The terminal view includes an accessible survivor ecology, Portia
  dispositions and reasons, deterministic Gate explanation, retry ancestry and
  remaining budget, traceable Charlotte recommendation, Wilbur action tracking,
  and a provenance timeline.
- Motion is ornamental to no state: every transition has a text equivalent,
  keyboard path, semantic landmark, live status, and reduced-motion behavior.
- `insufficient_basis` is a first-class visible result and never a generic
  model error.

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
     Retry, Charlotte, Wilbur, and unit tests.
2. `Persist the WebChess 2.0 genealogy`
   - forward migration, exact schema contract, lifecycle repository, export,
     deletion, and persistence tests.
3. `Add Portia Gate Retry and Charlotte services`
   - model operations, durable ledger integration, routes, idempotency, and
     service/security tests.
4. `Add Wilbur actions and Web provenance`
   - action/observation routes, genealogy query, and authorization tests.
5. `Build the eight-stage WebChess interface`
   - lifecycle rail, survivor/Portia/Gate/Retry/Charlotte/Wilbur/Web views,
     refresh recovery, accessibility, reduced motion, and end-to-end fixtures.
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
