# WebChess architecture

WebChess keeps semantic transformation, game rules, persistence, and model
access separate so that each has an inspectable provenance and failure mode.

## Product pipeline

1. **Question** — preserve the runtime-authoritative owner's normalized 12–240
   character problem as the governing reference.
2. **Cast-directed Division** — before the model call, the server derives one
   immutable I Ching direction for each of 64 facet IDs. A structured request
   proposes one bounded perspective per ID and must explain in a saved
   `castApplication` how that assigned direction materially shaped the facet.
   Deterministic checks reject missing or mismatched cast fields and known
   structural or lexical failures; they do not prove truth, relevance, or
   distinctness.
3. **Independent field cast** — the server independently permutes the accepted
   facets, cast-derived change lenses, and completed pair positions from
   recorded seeds. The exact field and provenance are persisted.
4. **Circular play** — the complete rules engine operates on eight bounded
   rings and eight wrapping sectors. White moves outside evidence inward;
   Black moves inner intention outward. Captures create a chronological
   salience record.
5. **Authoritative replay** — every requested move is checked by replaying the
   immutable starting state and ordered event log. The server derives captures,
   forced passes, promotion, counters, and outcomes.
6. **Trajectory-direction record** — at the terminal transition, the server
   deterministically rolls the full canonical event stream into
   `webchess-directional-record-v1`: move ordering, forced passes, promotions,
   exact moving and captured-piece identities, kinds and values, capture order,
   survivor routes and values, terminal outcome, and every field cell's cast
   application. The complete record and its digest are stored atomically with
   the terminal lifecycle state. Identical source inputs replay to the same
   digest; materially different legal trajectories can change it.
7. **Board-derived answer prompt** — replay-derived weights, values, routes,
   captures, terminal survivors, and the verified directional record are
   assembled into the concrete prompt package that would generate the
   substantive answer.
8. **Portia** — before any answer exists, a strict structured model operation
   validates that exact prompt by attacking every survivor with the complete
   versioned taxonomy. Each current assessment must bind the directional
   digest, cite permitted surviving direction keys, and explain how direction
   changed its interpretation or required amendment. Each accepted per-signal
   assessment is persisted. Three failed provider-started attempts end at the
   technical `portia_unavailable` state without authorizing an answer.
9. **Internal Gate and Retry** — deterministic code checks usable count,
   independent clusters, coverage, tension, severe objections, and fatal
   contradictions, plus the complete directional binding. A stored semantic
   policy permits at most two same-field games and one regenerated field, then
   ends at `insufficient_basis`.
10. **Answer, then Charlotte** — Portia permission and a persisted Gate pass
    authorize generation from the exact reviewed prompt and directional
    record. Charlotte then qualifies that exact generated answer and its
    directional provenance for evidence boundaries, values, stakeholders,
    audience, and reversible action; it cannot substitute an unrelated answer.
11. **Wilbur and Web** — the player owns action status and appends observations
    to the immutable genealogy; model output cannot declare real-world success.

The I Ching/cast record is first-class direction, not optional metaphor. Its
influence is inspectable in Division, Portia amendments, Gate inputs, Answer,
Charlotte, the **What survived scrutiny** view, and export. It remains a
method-generated interpretive input—not external factual evidence—and cannot
override verified facts, source provenance, safety constraints, or consent.
Runs created before this contract retain null record columns and expose
`legacy_pre_directional_generation`. Those rows and their parsers are retained
only for historical read-only inspection; recovery never fabricates a new
record, resumes provider generation/gameplay, imports or replays them, or
rewrites their already persisted Portia/Gate history.

## Runtime topology

The packed OpenClaw plugin is the sole supported WebChess 2.2 runtime. Earlier
loopback source-checkout and intended hosted-service surfaces shared parts of
the visual experience and server contracts, but they are now retired audit/test
fixtures rather than alternate identity, persistence, credential, billing, or
research choices.

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
  +--> authenticated, ephemeral 127.0.0.1 JSON bridge
         +--> pinned OpenClaw simple-completion runtime
                +--> selected OpenAI account/OAuth model
                +--> official Codex Hosted Search under the same account profile
```

The plugin is the install and launch boundary; it includes the complete
browser application rather than exposing a headless agent tool. It registers no
background service and starts no process until the user runs
`openclaw webchess`. The launcher disables Next.js telemetry, clears hosted
Clerk/generic database settings, requires a dedicated loopback PostgreSQL URL,
blocks a repository `.env.local` from introducing an OpenAI key, binds only to
IPv4 loopback, rejects inherited provider key/token variables, prints and
optionally opens the local URL, and remains in the
foreground until Ctrl-C. For a managed install, it
stages the bundled application code in an operating-system temporary directory,
links the installed dependency tree, and removes that working directory on
exit. Persistent game and lifecycle data remains in the local database.

The supported platform is deliberately limited to Linux x86_64. The plugin
attests the exact official global Codex plugin record, package and lock tree,
reviewed provider/private-client modules, wrapper, and native executable, then
revalidates their bytes, real paths, and singleton OAuth/config binding at
request boundaries. Unsupported platforms or any identity drift fail closed.

The launcher gives the Next.js child only a random bearer and the exact bridge
origin. The bridge accepts versioned structured JSON from the loopback peer,
enforces the exact `Host` and bearer plus byte, prompt, response, timeout, and
concurrency bounds, and passes the complete prompt into OpenClaw's pinned
simple-completion runtime. Prompts are not carried in `argv` and are not
silently truncated. OpenClaw resolves and applies the selected OpenAI
account/OAuth auth object inside the plugin runtime; it never crosses the
loopback bridge into Next.js or the browser and is never logged or persisted.

The browser animates shared, server-accepted moves but cannot make arbitrary
saved state authoritative. The shared service recomposes the cast from its
facets and seed and canonically replays the durable event log before every
mutation and lifecycle transition.

Board presentation is deliberately ephemeral. Initial load, a new question or
current game, bounded Retry, restore/reload, replay, and import/verification all
begin in the accessible 2D view even when WebGL is available or stale browser
storage mentions 3D. The player may opt in to the side-elevated 3D view for the
active UI session and return to 2D; WebGL loss, render failure, or reduced
motion fails back to 2D. Pre-v2.5 cases are outside all of those runtime paths.

There is no Clerk login, cloud database, hosted WebChess request, sync, or
shared operator credential. A stable installation-scoped principal owns local
records; the browser header is a mode discriminator within the same-OS trust
boundary, not a reusable hosted credential. The supported path contacts OpenAI
for the selected account model and official Codex Hosted Search under that
account's controls; alternate providers and provider key/token variables fail
closed.

### Retired runtime surfaces and the public brochure

Earlier candidates contained a source-checkout launcher and a hosted gameplay
adapter. They are retained only for historical review and contract tests. They
are not WebChess 2.2 installation choices: their `local:*` npm entry points are
removed, direct legacy-launcher execution fails closed, and service selection
rejects every principal except `local-openclaw` before the hosted adapter can
load. No API key, provider token, Clerk session, or signed-machine session can
reactivate model inference or research through those paths.

```text
Unauthenticated browser
  +-- public Next.js pages
  +-- white paper, policies, installation, license, source downloads

Any non-OpenClaw gameplay/model request
  +-- 503 fail-closed response before provider-adapter import
```

The public deployment is therefore a brochure and immutable source/paper
navigator, not a hosted game, database, identity, inference, or research
service. The retained Clerk, Neon, Vercel, and provider-adapter design below is
historical security evidence and test coverage, not current operational
guidance. Vercel Functions remain stateless; a warm module cache was never an
authority.

For the retained hosted design, `npm run db:migrate` is the only migration-owner
boundary. Before migration bytes are loaded and again before the owner
connection is opened, it requires a clean attached checkout whose exact commit
is published at its configured live remote branch; both checks must identify
the same commit. Direct invocation of the underlying migration script is
unsupported. The owner applies pending files atomically under an advisory lock
and records their normalized checksums. The supported local player does not run
that deployment command or supply its credential: the OpenClaw launcher applies
the canonical tail to its dedicated loopback database. Both paths reject any
existing ledger that is not an exact checksum-matching prefix of the 18
canonical migrations from `0001_durable_webchess` through
`0018_align_answer_prompt_durable_limit`.

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
immutable. Migration `0014` adds follow-up scheduling and owner-bound,
explicitly selected Web-memory links; at most eight observations can be carried
into a later game and no observation is silently reused. Migration `0015`
persists versioned research consent and bounded direct-page facts/failures,
while conservatively treating historical rows as not consented. Migration
`0016` extends only the durable Hosted Search timeout ceiling to five minutes;
query, source, page, citation, and consent bounds are unchanged. Migration
`0017` adds an all-or-none, version/digest/shape-checked trajectory-direction
record to lifecycle runs while leaving legacy rows null. Migration `0018`
aligns the exact Gate-approved Answer input with the shared 3,000,000-character
durable model-prompt ceiling, closing the earlier 200,000-character persistence
cap without changing model, research, or evidence bounds. These migrations do
not reinterpret missing consent as permission or old lifecycle data as a
current directional record. Preserving rows and migration evidence is not a
runtime compatibility promise: pre-v2.5 rows cannot authorize provider work,
gameplay, browser import/replay, Retry, Wilbur, or another mutation.

After `0001_durable_webchess.sql` is first applied to a durable database, that
file is immutable. Later changes are append-only, monotonically ordered
`0002_*`, `0003_*`, and later migrations. The retained hosted-design history
records its former expand/contract discipline and rollback windows; current
WebChess does not promise executable compatibility with a pre-v2.5 application
or case. Application rollback never rewrites or reverses migration history.

The migration owner explicitly revokes and grants the reviewed per-table
runtime allowlist after each migration. The runtime role has database
`CONNECT`, schema `USAGE`, ledger `SELECT`, and only the table operations used
by the application. Column-scoped `UPDATE` is limited to
`gate_decisions.answer_user_prompt`,
`gate_decisions.answer_user_prompt_sha256`, and `wilbur_actions.follow_up_at`,
`wilbur_actions.status`, `wilbur_actions.revision`, and
`wilbur_actions.updated_at`. The mutation ledger has column-scoped `UPDATE`
only on `rate_admitted_at`, `denial_code`, `retry_at`,
`reserved_future_rows`, `reserved_text_bytes`, `status`, `result_entity_id`,
`result_revision`, `result_status`, `result_follow_up_at`,
`result_updated_at`, and `updated_at`. It has no schema `CREATE`, object
ownership, owner-role membership, or sequence privileges.

Every configured Vercel build checks the runtime connection in a
repeatable-read, read-only transaction. The check requires exact migration IDs
and checksums; exactly 20 application tables plus the migration ledger—21 total—
and their column names, types, and nullability; valid and ready definitions for
all 12 contract indexes; exactly two origin-enabled, unfiltered
`BEFORE INSERT OR UPDATE FOR EACH ROW` Wilbur trigger/function pairs, all 35
reviewed pre-directional constraints plus the Gate-approved Answer-prompt
constraint and four trajectory-record constraints—40 total—and all 11 reviewed
defaults; and the exact
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

The supported runtime uses one stable installation-scoped OpenClaw principal
and a loopback mode discriminator for WebChess ownership. OpenClaw separately
resolves the sole selected OpenAI account/OAuth profile for inference and
official Codex Hosted Search. The installation principal is a same-machine
ownership boundary, not a password or proof of a human identity.

Retained hosted code verifies Clerk identity and scopes records to that ID, but
Clerk and the historical signed-machine session are not release authentication
paths and cannot select API services. They remain documented below so their
data ownership and deletion contracts can be audited without presenting them
as supported launch choices.

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

## Durable data model and retained hosted tables

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

The authoritative model-call ledger. Each current Division, Portia, approved
Answer, or Charlotte operation records an idempotency key, request digest,
status, model and prompt provenance, provider response ID, bounded token counts,
timestamps, and a safe failure code. Historical legacy-answer rows may remain
for inspection, but no legacy-answer provider operation is callable in the
supported runtime.
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
parent/root relationships, survivor sets, terminal fingerprints, the complete
trajectory-direction record/version/digest, the exact reviewed answer-prompt
digest, resumable per-signal Portia assessments, its
active provider-attempt fence and three-attempt technical budget, Charlotte's
separate active-request fence and three-attempt qualification budget, and all
contract/algorithm versions. Exhausting Charlotte's budget preserves the
Portia-approved generated Answer in a stable `charlotte_unavailable` state; it
does not silently present that Answer as Charlotte-qualified.

`portia_reviews`, `gate_decisions`, and `charlotte_results` are immutable
attempt artifacts. The generated Answer and its lifecycle-run, reviewed-prompt,
Gate-input, and trajectory-direction provenance are stored through the durable
game/model-result boundary. Current Portia reviews bind every usable assessment
and their aggregate summary to the same record; Gate fails closed on a missing
or mismatched binding. `wilbur_actions` is revisioned; `wilbur_observations` and
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

1. resolves the OpenClaw installation principal; retained Clerk and signed-local
   ownership branches are historical test/audit fixtures, not runtime choices;
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

A replay is a new counted lifecycle-v2.5 game that preserves a current source
division. Pre-v2.5 sources are rejected rather than upgraded or reinterpreted.
The browser supplies the source game ID, expected revision, and an idempotency
key.
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

Database transactions do not remain open during a remote account-authenticated
OpenClaw request.

1. In a short `READ COMMITTED` statement batch under one transaction-scoped
   advisory lock, check deletion, suspension, rate, quota, prior idempotency,
   and concurrency; reserve usage and a lease.
2. Commit.
3. Make the bounded OpenClaw request through the authenticated loopback bridge;
   the selected OpenAI account/OAuth profile remains inside OpenClaw.
4. In another short transaction, settle reported or explicitly unreported
   usage, release the lease, and atomically attach the validated result to the
   game.

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

Each lifecycle model request has a 300-second authenticated local bridge
envelope spanning bounded preflight, one provider turn, and postflight. The
provider turn itself remains capped at 150 seconds, so preflight cannot consume
its allowance. The renewed per-request concurrency lease and each
single-generation HTTP route allow 35 additional seconds—335 seconds total: up
to 5 seconds to drain the loopback response after the authenticated envelope,
then 30 seconds for durable settlement. Neither grace period permits more
provider work. Portia's multi-generation route remains separately bounded.

Answer also has a separate hard 300-second logical-operation deadline across
its initial turn and, only after contract-invalid output, one corrective turn.
Each actual provider turn retains its 150-second ceiling, but neither bridge
request restarts or extends the aggregate Answer deadline. A provider hang,
lost response, process interruption, or expired deadline therefore settles or
reconciles visibly during the drain-and-settlement headroom, transitions the
lifecycle to a retryable Answer failure, and releases the slot. An unknown provider outcome
marks the original request `indeterminate`, so the same durable intent cannot be
called again or left indefinitely `in_progress`.

The application quotas and concurrency leases bound WebChess operations, while
the selected account's allowance and workspace controls remain external.
WebChess cannot promise or enforce unmetered use, and no provider key or API-
project billing path is a permitted backstop for the supported runtime.

## Automatic research boundary

Only the OpenClaw composition injects the durable research broker, and it stays
off without case-scoped, versioned consent. Immediately before Portia,
deterministic policy may authorize one local Codex Search invocation with at
most five result links, five stored citation candidates, a 300-second WebChess
ceiling, and a 12,000-character synthesis ceiling. WebChess may then attempt at
most three public-HTTPS pages selected from those sources. Each request is
bounded and rejects credentialed URLs, non-global DNS/connected addresses,
unsafe redirects, oversized or unsupported responses, and guarded injection
signals. Accepted excerpts and visible failures remain separately attributed.
Search synthesis and accepted page text are both untrusted candidate material,
not proof that a page or claim is true. Search remains outside the model-
operation quota ledger and is governed by its own one-invocation bound. Hosted
and local source-checkout compositions do not provide this broker.

The 300-second Search ceiling is coherent across the bridge body, response
parser, HTTP requester, durable request row, and stale-request watchdog; no 150-second
compatibility layer may win first. A response-drain or settlement grace does
not increase provider work. Timeout becomes a visible retryable terminal record
and closes the durable claim without a duplicate provider call. The time increase
changes no query, page, redirect, address, body, citation, injection, consent,
or provenance bound.

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

## Case export and directional replay

The private full case profile retains the exact trajectory-direction record,
its version and digest, and downstream Portia/Gate/Answer/Charlotte bindings.
Offline verification reconstructs the canonical game from the saved initial
field and events, re-derives the record, and rejects a content or digest
mismatch. Redacted profiles may omit sensitive narrative or record detail, but
must retain an explicit omission marker and the permitted version/digest
provenance; an omitted record is not claimed as independently recomputed. A
legacy export retains `legacy_pre_directional_generation` rather than
manufacturing direction from old rows. That retained parser behavior is solely
for offline, read-only historical inspection; it does not import the case into
PostgreSQL or make it eligible for gameplay, replay, provider work, or mutation.
Neither verification nor a matching digest proves that the direction, evidence,
or answer is true or effective.

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

For the retired hosted design, this was the smallest durable replacement
because it used Clerk and one Neon database without introducing a separate
queue or cache as an authority. The supported release instead composes one
dedicated OpenClaw profile and one loopback PostgreSQL database.

## Invariants

- Randomization generates variation, not evidence.
- The complete chess trajectory creates reproducible directional influence,
  not factual warrant.
- The original question and every transformation remain inspectable.
- OpenClaw resolves and applies the selected OpenAI account/OAuth auth object
  inside the local plugin runtime; WebChess never logs, persists, exports, or
  sends it across the loopback bridge to Next.js or the browser.
- Every non-OpenClaw principal is rejected before a provider adapter loads.
- No key-backed hosted or source-checkout model route is a release surface.
- The server is authoritative for ownership, moves, passes, captures, endings,
  prompts, quota, and usage.
- No correctness or security property depends on Function memory.
- Portia is allowed only after canonical replay proves an ending, persists the
  exact trajectory-direction record, and assembles the exact answer prompt.
- Answer generation is allowed only after Portia permits that exact prompt and
  directional binding and the deterministic Gate passes them.
- Charlotte is allowed only after the approved Answer is durably stored; it
  qualifies that exact generated answer and directional provenance and cannot
  replace either.
- Portia progress is persisted per signal and technical failure is bounded to
  three provider-started attempts before `portia_unavailable`.
- Retry is bounded to two same-field games and one regenerated field.
- Model output cannot author or rewrite a Wilbur observation.
- A replay preserves the cast; a new division creates a new cast.
- Current records are replay-verifiable; legacy pre-v2.5 runs remain explicitly
  labeled for historical inspection and are never executed or retroactively
  relabeled.
- Model and prompt provenance are recorded without logging secrets.
- A replay start is cloned and accounted atomically.
- Forced deletion retains no raw Clerk ID in application tables.

See [The First Answer Is Not Enough](WEBCHESS_WHITE_PAPER_V3.md) for the intellectual
lineage, evidence matrix, limitations, and evaluation agenda.
