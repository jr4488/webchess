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
6. **Board-derived answer prompt** — replay-derived weights, values, routes,
   captures, and terminal survivors are assembled into the concrete prompt
   package that would generate the substantive answer.
7. **Portia** — before any answer exists, a strict structured model operation
   validates that exact prompt by attacking every survivor with the complete
   versioned taxonomy. Each accepted per-signal assessment is persisted. Three
   failed provider-started attempts end at the technical `portia_unavailable`
   state without authorizing an answer.
8. **Internal Gate and Retry** — deterministic code checks usable count,
   independent clusters, coverage, tension, severe objections, and fatal
   contradictions. A stored semantic policy permits at most two same-field
   games and one regenerated field, then ends at `insufficient_basis`.
9. **Answer, then Charlotte** — Portia permission and a persisted Gate pass
   authorize generation from the exact reviewed board prompt. Charlotte then
   qualifies that exact generated answer for evidence boundaries, values,
   stakeholders, audience, and reversible action; it cannot substitute an
   unrelated answer.
10. **Wilbur and Web** — the player owns action status and appends observations
    to the immutable genealogy; model output cannot declare real-world success.

## Runtime topologies

The OpenClaw plugin, loopback source-checkout runtime, and intended hosted
service share the visual experience, rules engine, cast construction, replay,
model prompts, and output validation. They do not share identity, persistence,
credentials, model billing, or automatic-research availability.

### Local OpenClaw plugin

```text
OpenClaw CLI
  |
  | startup-lazy `webchess` command
  v
Foreground Next.js process bound to 127.0.0.1
  |-- /openclaw visual application
  |-- /api/openclaw/status
  |-- shared /api/divide and /api/games/* handlers
  |
  +--> dedicated loopback PostgreSQL 17
  |      +--> games, events, usage ledger, lifecycle, actions, observations
  |
  +--> `openclaw infer model run --local --json --thinking medium`
         +--> user's configured default provider, model, and authentication
```

The plugin is the install and launch boundary; it includes the complete
browser application rather than exposing a headless agent tool. It registers no
background service and starts no process until the user runs
`openclaw webchess`. The launcher disables Next.js telemetry, clears hosted
Clerk/generic database settings, requires a dedicated loopback PostgreSQL URL,
blocks a repository `.env.local` from introducing an OpenAI key, binds only to
IPv4 loopback, prints and optionally opens the local URL, and remains in the
foreground until Ctrl-C. For a managed install, it
stages the bundled application code in an operating-system temporary directory,
links the installed dependency tree, and removes that working directory on
exit. Persistent game and lifecycle data remains in the local database.

The browser animates shared, server-accepted moves but cannot make arbitrary
saved state authoritative. The shared service recomposes the cast from its
facets and seed and canonically replays the durable event log before every
mutation and lifecycle transition.

There is no Clerk login, cloud database, hosted WebChess request, sync, or
shared operator credential. A stable installation-scoped principal owns local
records; the browser header is a mode discriminator within the same-OS trust
boundary, not a reusable hosted credential. The configured model provider may
be remote; that network boundary belongs to the user's OpenClaw configuration.

### Local source checkout

The same application and server-side OpenAI path can run from a source
checkout without OpenClaw (`npm run local:dev`). The launcher binds Next.js to
`127.0.0.1:3005`, uses Docker PostgreSQL 17 at `127.0.0.1:55433`, and selects
exactly one authentication mode: a signed installation-owned local principal
when both Clerk keys are absent, or Clerk development identity when a complete
`pk_test_...` / `sk_test_...` pair is present. A partial pair, live keys, or a
non-loopback database fails closed. The modes have separate owner identifiers
and never merge records.

A launcher-only activation flag and dedicated, generated
`WEBCHESS_LOCAL_SESSION_SECRET` prevent an ordinary or partially configured
hosted process from silently entering local-auth mode. That secret must be
preserved with the database: losing it changes the signed local owner and makes
the previous owner's rows inaccessible to the new session. The signed session
is a machine boundary, not proof of a human identity.

Loopback `DATABASE_URL` values use the PostgreSQL wire adapter. The local
runtime applies the same canonical migrations on first use, but only when the
launcher-only activation flag is present and after requiring the existing
ledger to be an exact checksum-matching prefix. A genuinely empty database is
accepted; a nonempty schema with an unrelated relation is refused rather than
adopted. Ordinary development, hosted, and Vercel starts never auto-migrate.
The launcher reports the `2.2.0-rc.1-local` candidate identity, disables OpenClaw
and test-auth bypasses, validates an existing named database container before
starting it, and opens the browser only after a bounded readiness probe.
Automatic Codex Search research is not wired into this runtime.

A pre-hardening `webchess-local-postgres` container without the immutable
ownership label is intentionally refused. The data-preserving adoption path is
to inspect and back up `webchess_local_pgdata`, remove only the stopped
container, and rerun `npm run local:setup -- --adopt-volume` so the named volume
is reused. The volume must never be removed as part of adoption.

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

Vercel deployments never take the local PostgreSQL-wire migration path; they
keep Neon HTTP and the guarded owner migration command. Automatic Codex Search
research is not wired into this runtime. The repository describes this hosted
architecture but does not claim that a production hosted deployment is live.

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
Both the owner runner and the local runtime reject any existing ledger that is
not an exact checksum-matching prefix of the 13 canonical migrations from
`0001_durable_webchess` through `0013_wilbur_mutation_requests`.

Migration `0012` is upgrade-safe without a duplicate-data audit. It preserves
all pre-`0012` rows with a null `charlotte_binding_version`, including duplicate
suggestion indexes. A trigger stamps new actions with the current binding
version before the partial unique constraint is checked, and thereafter keeps
the canonical action identity/content/binding immutable. Actions start planned
at revision zero; each status update advances revision exactly once and cannot
move update time backward. Migration `0013` adds the durable Wilbur mutation
ledger. Its guard requires pending/unadmitted insertion, freezes claim identity
and pending reservations, orders admission before settlement, prevents update
time from moving backward, and makes admission timestamps and terminal rows
immutable. Neither migration deletes or chooses among legacy rows.

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
by the application. Column-scoped `UPDATE` is limited to
`gate_decisions.answer_user_prompt`,
`gate_decisions.answer_user_prompt_sha256`, and `wilbur_actions.status`,
`wilbur_actions.revision`, and `wilbur_actions.updated_at`. The mutation ledger
has column-scoped `UPDATE` only on `rate_admitted_at`, `denial_code`, `retry_at`,
`reserved_future_rows`, `reserved_text_bytes`, `status`, `result_entity_id`,
`result_revision`, `result_status`, `result_updated_at`, and `updated_at`. It has
no schema `CREATE`, object ownership, owner-role membership, or sequence
privileges.

Every configured Vercel build checks the runtime connection in a
repeatable-read, read-only transaction. The check requires exact migration IDs
and checksums; exactly 19 application tables plus the migration ledger—20 total—
and their column names, types, and nullability; valid and ready definitions for
all eight contract unique indexes; exactly two origin-enabled, unfiltered
`BEFORE INSERT OR UPDATE FOR EACH ROW` Wilbur trigger/function pairs, 18
critical Wilbur constraints, and all five `0013` defaults; and the exact
effective schema/table privilege allowlist, including access inherited through
memberships or `PUBLIC`. The indexes cover the current game, succeeded
operation, one run per game, one current-bound Wilbur action per Charlotte
suggestion, the Wilbur mutation owner/key primary key, and the three research
uniqueness contracts.
Missing or extra application tables or columns, an invalid index, trigger,
constraint, or default, over-privilege, under-privilege, ownership, or the
ability to assume an owner fails the build before application compilation.
Unexpected noninternal triggers, trigger arguments/filters, altered constraint
validation/deferrability/parent shape, and disabled foreign-key enforcement
triggers also fail.

## Authentication and ownership

The hosted service uses Clerk for Google, email, and passkey authentication.
The routing proxy improves navigation by redirecting signed-out requests, but
it is not the authorization boundary. Each protected route calls Clerk's
server authentication, obtains the verified Clerk user ID, and scopes all
queries to that ID.

The local source runtime selects either the same Clerk route contract with a
complete test-key pair or a seven-day, HMAC-signed, HttpOnly, SameSite=Lax
cookie for one loopback machine principal. OpenClaw uses its installation
principal and loopback mode discriminator. Neither local mechanism is a
password or verified-human account, and neither may activate on Vercel.

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
rows. The foreign-key-safe cleanup order has artifact-bearing deletion tests,
including Portia and Charlotte model requests. A browser request cannot
impersonate that event. Shared IP rate windows and vendor backups are outside
the immediate account-row deletion and age out under their own retention
policies.

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

The authoritative model-call ledger. Each Division, Portia, approved Answer,
Charlotte, or legacy-answer operation records an
idempotency key, request digest, status, model and prompt provenance, provider
response ID, bounded token counts, timestamps, and a safe failure code.
Provider output that is refused, incomplete, malformed, or schema-invalid is
not persisted; WebChess keeps only a syntactically sanitized provider response
ID, safe failure classification, HTTP status when applicable, and normalized
token usage when the provider supplied it. Prompts and secrets are not copied
into operational logs.

### Lifecycle genealogy

`lifecycle_runs` is the versioned state and ancestry authority behind the
visible Anansi → Chess → Portia → Answer → Charlotte → Wilbur → Web sequence.
Gate and Retry remain inspectable internal decision branches rather than
player-facing stages. The run stores independent seeds, semantic retry counters,
parent/root relationships, survivor sets, terminal fingerprints, the exact
reviewed answer-prompt digest, resumable per-signal Portia assessments, its
active provider-attempt fence and three-attempt technical budget, Charlotte's
separate active-request fence and three-attempt qualification budget, and all
contract/algorithm versions. Exhausting Charlotte's budget preserves the
Portia-approved generated Answer in a stable `charlotte_unavailable` state; it
does not silently present that Answer as Charlotte-qualified.

`portia_reviews`, `gate_decisions`, and `charlotte_results` are immutable
attempt artifacts. The generated Answer and its lifecycle-run, reviewed-prompt,
and Gate-input provenance are stored through the durable game/model-result
boundary. `wilbur_actions` is revisioned; `wilbur_observations` and
`lifecycle_events` are append-only. Each current Wilbur action is copied from
and version-bound to one of the exact three stored Charlotte suggestions.
Migration `0012` permits at most one current-bound action for a suggestion index
in a lifecycle run; upgrade-preserved actions remain explicitly unbound, even
when their legacy suggestion indexes duplicate one another. The binding trigger
makes canonical content immutable while allowing status/revision updates.

`wilbur_mutation_requests` durably claims each create, update, or observation by
owner and idempotency key. An exact retry replays the committed result or stored
denial; a changed operation or request digest conflicts. Rate admission is
once-only, a pending claim abandoned for 24 hours expires durably, and future
row/text capacity is reserved against the lifetime admission envelope. The row
budget covers actions, observations, Wilbur lifecycle events, mutation-ledger
rows, and pending reservations. A fresh claim adds one ledger row and reserves
two future rows for create/observation or one for update. Commit substitutes the
actual artifact/event rows for that reservation atomically with the lifecycle
revision and ledger result. Terminal ledger rows remain counted. Existing
pending claims and committed replays are grandfathered if a cap is later lowered;
a fresh over-limit status update is not.

Every table is owner-scoped and deletes through the tested account/game
boundary. Account export format `webchess-account-export/4` reads the
owner-scoped genealogy, `charlotteBindingVersion`, sanitized mutation-ledger
rows, all ten lifecycle recovery fields, and owner user-rate windows in the same
bounded repeatable-read snapshot. It omits mutation-ledger capacity reservation
fields, owner/IP identifiers, and HMAC material, and excludes shared IP/global
counters, concurrency leases, tombstones, Clerk/vendor records, and database-
restore metadata. The lifetime Wilbur envelope bounds only Wilbur's growth; it
does not guarantee that every whole account fits the synchronous export ceiling.

### `usage_buckets`

Transactional per-user and global counters for game starts and model requests.
New divisions and replays share the daily game-start allowance. Model
reservations happen before an OpenAI call and are settled afterward. This
prevents concurrent serverless instances from independently spending the same
allowance.

### `rate_buckets`

Short-window counters for model calls, game starts, moves, account exports,
Wilbur actions, and Wilbur observations. New divisions and replays share the
`game_start` action. Each action has per-user and per-IP limits; hosted defaults
for Wilbur are 120/240 actions and 60/120 observations per user/IP each hour.
User IDs and client addresses are converted to purpose-separated HMAC digests
before storage. Raw IP addresses are not retained in this table. Wilbur's
durable mutation claim ensures an exact retry does not debit the rate window a
second time.

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

1. resolves the runtime-authoritative owner (Clerk, signed local session, or
   OpenClaw installation principal);
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
settlement becomes terminally `indeterminate`; that same intent is not called
again. Portia may create a new fenced attempt while resuming its persisted
per-signal prefix, but only until its run-wide limit of three failed or
indeterminate provider-started attempts. Exhaustion produces
`portia_unavailable`, not a fabricated review, Gate decision, or answer. If
settlement committed but final attachment was interrupted, the durable result
payload is the recovery authority.

The application quotas and concurrency leases are the primary cost controls.
OpenAI spend alerts are notifications, not caps. An explicitly enabled OpenAI
hard spend limit is an external backstop, but its enforcement is not
instantaneous and recorded spend can slightly exceed the configured amount.

## Automatic research boundary

Only the OpenClaw composition injects the durable research broker. Immediately
before Portia, deterministic policy may authorize one local Codex Search
invocation with at most five result links, five stored citation candidates, a
150-second WebChess ceiling, and a 12,000-character synthesis ceiling. The
broker never fetches a cited page directly; stored links and search synthesis
are untrusted candidate material, not proof that WebChess read or verified the
page. The search is outside the model-operation quota ledger and is governed by
its own one-invocation bound. Hosted and local source-checkout compositions do
not provide this broker.

## Transactional recovery and disaster recovery

Canonical event replay, exact idempotency records, expiring leases, persisted
Portia/Charlotte attempts, and compare-and-swap revisions recover interrupted
requests and lifecycle state. A settled model-result payload is the recovery
authority when final attachment was interrupted. These are transactional and
application-level recovery mechanisms, not backup or disaster recovery.

The repository provides no database backup scheduler, point-in-time recovery
proof, account-import route, restore command, recovery-point or recovery-time
objective, cross-region design, or completed restore drill. An account export
is not a database-restorable backup. Hosted operators must separately configure
and test vendor backup/restore; local operators must preserve the PostgreSQL
volume and the database, HMAC, deletion-HMAC, and local-session secrets needed
to address and interpret its rows.

## Account export path

Exports are authenticated and limited independently by per-user and
HMAC-pseudonymized IP hourly counters (two per user and ten per IP per hour by
default). A repeatable-read transaction estimates the result before selecting
account rows, and the serialized JSON is checked again before return.
`webchess-account-export/4` includes owner-scoped application rows, the ten
lifecycle recovery fields, `charlotteBindingVersion`, sanitized Wilbur mutation-
ledger rows, and pseudonymous owner user-rate windows without exporting the HMAC
key. Private mutation capacity reservations, owner/IP identifiers, HMAC
material, and shared IP/global counters are omitted.
`WEBCHESS_ACCOUNT_EXPORT_MAX_BYTES` defaults to 3,000,000 bytes. There is no
pagination or asynchronous export job: an oversized export is refused, and the
account UI directs the owner to `/support` for non-sensitive assistance through
GitHub Discussions. That bounded operator fallback does not promise a custom
data handoff or response time. Wilbur's row/text admission envelope preserves
existing history and does not guarantee whole-account exportability because
other account data also grows.

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
- Portia is allowed only after canonical replay proves an ending and assembles
  the exact board-derived answer prompt.
- Answer generation is allowed only after Portia permits that exact prompt and
  the deterministic Gate passes it.
- Charlotte is allowed only after the approved Answer is durably stored; it
  qualifies that exact generated answer and cannot replace its provenance.
- Portia progress is persisted per signal and technical failure is bounded to
  three provider-started attempts before `portia_unavailable`.
- Retry is bounded to two same-field games and one regenerated field.
- Model output cannot author or rewrite a Wilbur observation.
- A replay preserves the cast; a new division creates a new cast.
- Model and prompt provenance are recorded without logging secrets.
- A replay start is cloned and accounted atomically.
- Forced deletion retains no raw Clerk ID in application tables.

See [The First Answer Is Not Enough](WEBCHESS_WHITE_PAPER_V3.md) for the intellectual
lineage, evidence matrix, limitations, and evaluation agenda.
