# WebChess architecture

WebChess keeps semantic transformation, game rules, persistence, and model
access separate so that each has an inspectable provenance and failure mode.

## Product pipeline

1. **Question** — preserve the authenticated user's normalized 12–240
   character problem as the governing reference.
2. **Division** — a structured model request proposes 64 bounded perspective
   facets. Deterministic checks reject known structural and lexical failure
   patterns; they do not prove truth, relevance, or distinctness.
3. **Independent cast** — the server creates a seed and independently
   permutes facets, I Ching-inspired change lenses, and completed pair
   positions. The exact field and provenance are persisted.
4. **Circular play** — the complete rules engine operates on eight bounded
   rings and eight wrapping sectors. White moves outside evidence inward;
   Black moves inner intention outward. Captures create a chronological
   salience record.
5. **Authoritative replay** — every requested move is checked by replaying the
   immutable starting state and ordered event log. The server derives captures,
   forced passes, promotion, counters, and outcomes.
6. **Synthesis** — only a server-proven ending may trigger the second
   structured OpenAI request. The answer remains traceable to the persisted
   question, cast, outcome, and capture trail.

## Runtime topologies

The local plugin and hosted service share the visual experience, rules engine,
cast construction, replay, model prompts, and output validation. They do not
share identity, persistence, credentials, or model billing.

### Local OpenClaw plugin

```text
OpenClaw CLI
  |
  | startup-lazy `webchess` command
  v
Foreground Next.js process bound to 127.0.0.1
  |-- /openclaw visual application
  |-- /api/openclaw/status
  |-- /api/openclaw/divide
  |-- /api/openclaw/answer
  |
  +--> browser localStorage: one current question, cast, event log, and answer
  |
  +--> `openclaw infer model run --local --json --thinking medium`
         +--> user's configured default provider, model, and authentication
```

The plugin is the install and launch boundary; it includes the complete
browser application rather than exposing a headless agent tool. It registers no
background service and starts no process until the user runs
`openclaw webchess`. The launcher disables Next.js telemetry, clears hosted
Clerk/database settings, blocks a repository `.env.local` from introducing a
missing OpenAI key, preserves provider environment already present in the
user's shell, binds only to IPv4 loopback, prints and optionally opens the local
URL, and remains in the foreground until Ctrl-C. For a managed install, it
stages the bundled application code in an operating-system temporary directory,
links the installed dependency tree, and removes that working directory on
exit. Persistent game data remains browser-local.

The browser applies moves locally for responsive animation, but it cannot make
arbitrary saved state authoritative. On every load, WebChess recomposes the
cast from its facets and seed and canonically replays the event log. Before the
second model call, the loopback route repeats that composition and replay,
requires a real ending, and derives the answer evidence itself.

There is no local account, cloud database, hosted WebChess request, sync, or
shared operator credential. The configured model provider may be remote; that
network boundary belongs to the user's OpenClaw configuration. The plugin never
returns provider credentials to the app.

### Hosted service

```text
Unauthenticated browser
  +-- public Next.js pages
  +-- white paper, policies, installation, license, source downloads

Authenticated browser
  |
  | Clerk session cookie
  v
Next.js route handler on Vercel
  |-- verify Clerk identity and route authorization
  |-- validate input, origin, idempotency key, and expected revision
  |-- reserve quota/rate/concurrency state in Neon
  |-- replay and mutate canonical game state
  |-- call OpenAI from the server when required
  |-- settle usage and persist provider provenance
  v
Neon Postgres                 OpenAI Responses API
```

Vercel Functions are stateless compute. A warm module cache is an optimization,
not a source of truth.

The Vercel `DATABASE_URL` belongs to a least-privileged runtime Postgres role
that can use the application schema and read/write the required tables but
cannot own or migrate the schema, manage roles, or create, alter, or drop
schema objects. A separate migration-owner credential is used only from a
protected operator environment and is never stored in Vercel or the
application environment.

`npm run db:migrate` is the sole public migration boundary. Before migration
bytes are loaded and again before the owner connection is opened, it requires a
clean attached checkout whose exact commit is published at its configured live
remote branch; both checks must identify the same commit. Direct invocation of
the underlying migration script is unsupported. The owner applies pending
files atomically under an advisory lock and records their normalized checksums.

After `0001_durable_webchess.sql` is first applied to a durable database, that
file is immutable. Later changes are append-only, monotonically ordered
`0002_*`, `0003_*`, and later migrations. They follow expand/contract: a schema
expansion must support the candidate release and the previous Production
deployment throughout its rollback window. Contracting changes such as drops,
renames, and tightened constraints wait for a later migration after the old
deployment is retired as a rollback target. Application rollback moves code
back; it does not rewrite or reverse migration history.

The migration owner explicitly revokes and grants the reviewed per-table
runtime allowlist after each migration. The runtime role has database
`CONNECT`, schema `USAGE`, ledger `SELECT`, and only the table operations used
by the application. It has no schema `CREATE`, object ownership, owner-role
membership, or sequence privileges.

Every configured Vercel build checks the runtime connection in a
repeatable-read, read-only transaction. The check requires exact migration IDs
and checksums; exactly the expected ten tables and their column names, types, and
nullability; valid and ready definitions for the two critical partial unique
indexes; and the exact effective schema/table privilege allowlist, including
access inherited through memberships or `PUBLIC`. Missing or extra application
tables or columns, invalid indexes, over-privilege, under-privilege, ownership,
or the ability to assume an owner fails the build before application
compilation.

## Authentication and ownership

Clerk provides Google, email, and passkey authentication. The routing proxy
improves navigation by redirecting signed-out requests, but it is not the
authorization boundary. Each protected route calls Clerk's server
authentication, obtains the verified Clerk user ID, and scopes all queries to
that ID.

The API does not accept a user ID as authority. A valid game UUID owned by a
different user is indistinguishable from a missing game.

`user_controls` adds product-specific suspension, temporary blocking, and
per-user quota overrides. An authenticated self-deletion request removes
unstarted reservations and application content but leaves a suspended
deletion-pending record containing the raw Clerk ID, preventing quota reset
while the identity still exists. Self-service deletion waits while a provider
call is genuinely `in_progress`.
Clerk's signed `user.deleted` webhook is the authority for forced cleanup: it
first installs the lifetime-stable HMAC barrier under the shared usage lock,
then wins over reserved or in-progress work and deletes the raw-ID record and
all remaining content. Late provider finalization cannot recreate the deleted
rows. A browser request cannot impersonate that event.

## Hosted durable data model

### `user_controls`

One record per Clerk user. Stores suspension state, temporary blocks,
per-user limit overrides, and product timestamps. A deletion-pending record is
retained only until Clerk confirms identity deletion. It does not store Google
credentials, passkeys, passwords, or Clerk session tokens.

### `deleted_user_tombstones`

Stores only a stable, purpose-separated HMAC of a deleted Clerk user ID and the
deletion time. It contains no raw account identifier or game content. The
deletion HMAC secret is independent from the rotatable rate/safety HMAC secret
and must remain stable for the lifetime of every tombstone because the deleted
raw IDs are unavailable for re-keying.

### `games`

Stores owner, source replay, current-game flag, compare-and-swap revision,
status, normalized problem digest, server seed, validated facets, composed
problem parts, prompt/model/rules/engine/software versions, final outcome, and
answer.

A user has at most one current game. Replaying creates a separately identified
game that references its source while retaining the same division.

### `game_start_requests`

The idempotency ledger for replay starts. One locked database transaction
validates the source owner/revision/state, checks the deletion barrier and user
controls, checks daily and hourly user/IP limits, clones the field, records the
replay intent, consumes the counters, retires the prior current game, and
activates the child. A durable `activated_at` marker distinguishes a fresh
mutation from an exact retry. A same-key retry returns the existing child
without another debit and never re-promotes an older replay over a newer
current game. A final in-transaction invariant check fails closed before commit.
There is no debit-before-clone interval.

### `game_events`

An append-only move/pass stream with one record per ply and a unique
idempotency key for client moves. Client events contain only the accepted
piece, origin, destination, side, request digest, and resulting game revision.
Forced passes are server events.

Captures, attention weights, pieces, counters, and outcomes are derived from
replay rather than trusted as event input.

### `model_requests`

The authoritative model-call ledger. Each division or answer records an
idempotency key, request digest, status, model and prompt provenance, provider
response ID, bounded token counts, timestamps, and a safe failure code.
Provider output that is refused, incomplete, malformed, or schema-invalid is
not persisted; WebChess keeps only a syntactically sanitized provider response
ID, safe failure classification, HTTP status when applicable, and normalized
token usage when the provider supplied it. Prompts and secrets are not copied
into operational logs.

### `usage_buckets`

Transactional per-user and global counters for game starts and model requests.
New divisions and replays share the daily game-start allowance. Model
reservations happen before an OpenAI call and are settled afterward. This
prevents concurrent serverless instances from independently spending the same
allowance.

### `rate_buckets`

Short-window counters for model calls, game starts, moves, and account exports.
New divisions and replays share the `game_start` action. Each action has
per-user and per-IP limits. User IDs and client addresses are converted to
purpose-separated HMAC digests before storage. Raw IP addresses are not
retained in this table.

### `model_concurrency_slots`

A small set of durable, expiring leases. The default allows one active model
request per user. Lease expiry prevents an interrupted Function from holding a
slot forever.

## Game command path

A move command contains:

```json
{
  "pieceId": "white-pawn-4",
  "to": { "ring": 4, "sector": 3 },
  "expectedRevision": 12
}
```

The request also carries an idempotency key. The server:

1. verifies the Clerk session;
2. loads the game scoped to that user;
3. rejects a stale expected revision;
4. rebuilds the initial pieces and replays ordered events;
5. confirms the game is playable and the piece belongs to the side to move;
6. validates the requested destination with the canonical rules;
7. applies the move;
8. derives promotion, capture, attention data, counters, and outcome;
9. derives and appends any forced pass;
10. commits events and the new revision atomically; and
11. returns a user-safe view of the reconstructed state.

The same replay function drives recovery after refresh, answer eligibility,
downloaded replay data, and integrity tests.

## Replay start path

A replay is a new counted game that preserves the source division. The
browser supplies the source game ID, expected revision, and an idempotency key.
Under the durable usage advisory lock, the database either returns the child
already associated with that exact intent or atomically performs every source
check, hourly user/IP game-start check, daily game-start check, clone, intent
record, counter update, and current-game switch. No intermediate state can
consume the allowance without creating the clone.

## Ending precedence

After each legal action:

1. direct King capture is decisive;
2. if neither side can move, the result is a draw;
3. 100 consecutive non-capturing plies is a draw; then
4. 256 completed plies is a draw.

If only the next side is immobile, the server appends a forced pass, increments
both total and quiet plies, changes side, and checks endings again. The 256th
move is legal; a King captured on it wins before the limit draw applies.

## Model-call transaction boundary

Database transactions do not remain open during a remote OpenAI request.

1. In a short `READ COMMITTED` statement batch under one transaction-scoped
   advisory lock, check deletion, suspension, rate, quota, prior idempotency,
   and concurrency; reserve usage and a lease.
2. Commit.
3. Make the bounded server-side OpenAI request with `store: false` and a
   pseudonymous, purpose-separated safety identifier.
4. In another short transaction, settle token usage, release the lease, and
   atomically attach the validated result to the game.

Failures are explicit. A retry with the same idempotency key recovers a
committed result or reports the existing `reserved`/`in_progress` operation as
pending rather than creating another provider call. A reservation whose lease
expires before provider start becomes terminally failed and its reservation is
refunded. A provider-started request whose lease expires before definitive
settlement becomes terminally `indeterminate`; that intent is never called
again automatically, and the user must create a new intent and idempotency key.
If settlement committed but final game attachment was interrupted, the durable
result payload is the recovery authority.

The application quotas and concurrency leases are the primary cost controls.
OpenAI spend alerts are notifications, not caps. An explicitly enabled OpenAI
hard spend limit is an external backstop, but its enforcement is not
instantaneous and recorded spend can slightly exceed the configured amount.

## Account export path

Exports are authenticated and limited independently by per-user and
HMAC-pseudonymized IP hourly counters (two per user and ten per IP per hour by
default). A repeatable-read transaction estimates the result before selecting
account rows, and the serialized JSON is checked again before return.
`WEBCHESS_ACCOUNT_EXPORT_MAX_BYTES` defaults to 3,000,000 bytes. There is no
pagination or asynchronous export job: an
oversized export is refused, and the account UI directs the owner to
`/support` for non-sensitive assistance through GitHub Discussions without
promising a custom data handoff or response time.

## Serverless-state migration

The legacy Express implementation used one process as a database. That fails on
Vercel because instances are short-lived, parallel, and regionally independent.

| Legacy process state | Failure on serverless | Replacement |
| --- | --- | --- |
| Shared access-code sessions and CSRF records | Lost on cold start; split across instances | Clerk session plus per-route verification |
| Revoked/expired session set | Inconsistent authorization | Clerk revocation plus `user_controls` |
| Current game held by the browser/process | Refresh loss and client tampering | `games` and `game_events` |
| Per-session request timestamps | Instance-specific throttling | `rate_buckets` |
| Process-global daily count | Quota multiplied by replicas | `usage_buckets` |
| Replay debit then clone | Lost allowance or duplicate child after interruption | atomic `game_start_requests`, clone, and counters |
| In-process concurrency gate | Overspend under parallel Functions | leased `model_concurrency_slots` |
| Provider epoch/readiness cache | Stale or contradictory state | fixed server configuration and request ledger |
| Deleted raw identity needed as a barrier | Identity recreation can reset controls | stable HMAC-only `deleted_user_tombstones` |

This is the smallest durable replacement because it uses the two services
already required for identity and persistence—Clerk and one Neon database—
without introducing a separate queue or cache as an authority.

## Invariants

- Randomization generates variation, not evidence.
- Board events create salience, not factual warrant.
- The original question and every transformation remain inspectable.
- The local plugin never receives model credentials; OpenClaw owns provider
  authentication and may contact the user's configured remote provider.
- Hosted visitors never supply model credentials.
- Hosted OpenAI calls occur only in authenticated server routes.
- The server is authoritative for ownership, moves, passes, captures, endings,
  prompts, quota, and usage.
- No correctness or security property depends on Function memory.
- Final synthesis is allowed only after canonical replay proves an ending.
- A replay preserves the cast; a new division creates a new cast.
- Model and prompt provenance are recorded without logging secrets.
- A replay start is cloned and accounted atomically.
- Forced deletion retains no raw Clerk ID in application tables.

See the [technical white paper](WEBCHESS_WHITE_PAPER.md) for the intellectual
lineage, evidence matrix, limitations, and evaluation agenda.
