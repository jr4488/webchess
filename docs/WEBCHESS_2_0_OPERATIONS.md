# WebChess 2.2 account-authenticated operator guide

This guide describes the implemented lifecycle in the `2.2.0-rc.1` candidate.
The latest tagged package remains `2.1.0`; this guide does not claim that a
Preview or Production gameplay deployment exists. The sole supported runtime is
the packed OpenClaw plugin with one selected OpenAI account/OAuth profile for
both inference and official Codex Hosted Search. Provider API keys/tokens and
non-OpenClaw principals fail closed. This candidate's attested runtime is Linux
x86_64 only; other platforms fail closed until their exact provider/runtime and
native-executable bytes receive equivalent review and end-to-end evidence.

## Lifecycle authority

The interface presents this authoritative sequence:

```text
Anansi → Chess → Portia → Answer → Charlotte → Wilbur → Web
```

The state machine records the deterministic Gate and semantic Retry policy as
internal branches between Portia and Answer. They remain inspectable in the
genealogy but are not presented as additional player-facing stages.

The browser may request an allowed operation, but it cannot provide survivor
sets, the board-derived answer prompt or digest, Portia IDs, assessments or
dispositions, technical-attempt counters, Gate decisions, retry counters,
Answer approval provenance, Charlotte support authority, provenance, or
observation ownership. Every mutation is owner-scoped. Game mutations use the
saved game revision; lifecycle and Wilbur mutations use compare-and-swap
revisions inside the repository.

Division, Portia, Answer, and Charlotte are separately authorized and durably
accounted model stages. Portia receives the exact concrete prompt assembled
from replay-derived board weights, values, routes, captures, and survivors
before any answer is generated. The Gate and Retry policy are deterministic and
make no provider call. Wilbur actions and observations are human-owned records
and make no provider call.

Automatic external research is available only in the OpenClaw runtime. Its
deterministic broker runs immediately before Portia, invokes local Codex Search
at most once, retains at most five citation candidates and bounded synthesis,
and uses a 150-second WebChess envelope. With separate case-scoped consent, the
local broker may fetch at most three eligible public-HTTPS pages through bounded
redirect, address, media, size, provenance, and injection filters. Accepted
excerpts and every failure are retained as attributed, untrusted evidence.

## Retry and cost ceiling

For one root inquiry, the policy permits:

- the initial game;
- at most two same-field replay games;
- at most one regenerated 64-facet field; and
- no further attempt after `insufficient_basis`.

That semantic budget is separate from Portia's technical execution budget. A
Portia operation evaluates the ordered survivor signals and then the complete
candidate prompt. Every validated per-signal assessment is persisted. If a
provider-started attempt fails or becomes indeterminate, a new fenced attempt
resumes from that saved prefix. The run permits three such failed attempts in
total; the third ends at `portia_unavailable`, retains completed work, and
authorizes neither Gate nor Answer. An individual signal's successful review
does not reset this technical failure count.

Answer is called only after Portia permits the exact prompt and the persisted
Gate passes it. Charlotte is called only after that exact approved Answer is
durably stored. A failed or exhausted Gate and a technically unavailable Portia
cannot invoke either downstream model stage. Model reservations retain the
existing durable quota, rate, lease, idempotency, deletion-barrier, and
settlement behavior. An ambiguous provider completion is reconciled through
the durable ledger before another bounded Portia attempt can begin.

The operator should budget account allowance, context, runtime, and retries for
the worst bounded path, not only the happy path. OpenAI account controls and
allowance notices remain external to WebChess; a provider key or alternate
billing route is not an accepted backstop.

## Migration and runtime roles

The supported OpenClaw launcher owns local bootstrap: it applies all 15
canonical migrations, from
`db/migrations/0001_durable_webchess.sql` through
`db/migrations/0015_direct_page_research_evidence.sql`, to the dedicated
loopback database and rejects an existing ledger that is not an exact checksum-
matching prefix. A local player must not run the hosted deployment migration
owner or supply its credentials. `npm run db:migrate` is retained solely for the
retired hosted deployment boundary. Never modify applied migration bytes.

Migration `0012` is upgrade-safe without a duplicate-data audit. It leaves all
pre-`0012` actions at a null `charlotte_binding_version`, including duplicate
suggestion indexes. Its trigger stamps current inserts before the partial unique
constraint, requires a Charlotte suggestion index and planned revision-zero
start, and thereafter freezes action identity/content/binding. Each status update
advances revision exactly once and cannot move update time backward. Migration
`0013` adds the durable Wilbur mutation ledger. Its guard requires pending,
unadmitted insertion; freezes claim identity and pending reservations; orders
admission before settlement; prevents update time from moving backward; and
makes admission timestamps and terminal rows immutable. Neither migration
deletes or selects among legacy rows. After migration,
reapply the exact runtime privilege contract and remove the owner credential
before handing a retained hosted runtime URL to the application. The local
launcher instead uses its dedicated database owner within the loopback boundary.

Migration `0014` adds owner-bound, explicitly selected Web-memory links and
follow-up scheduling; no observation is silently reused. Migration `0015` adds
bounded direct-page research evidence and request/source provenance. Both are
append-only schema evolution and preserve earlier cases as historical records.

The following least-privilege role details apply to the retained hosted design;
they are not extra setup steps for the supported local player. Its runtime
schema check expects 20 application tables plus
`webchess_schema_migrations`—21 total—12 contract indexes, and the
two exact, origin-enabled, unfiltered `BEFORE INSERT OR UPDATE FOR EACH ROW`
Wilbur trigger/function pairs, 18 critical Wilbur constraints, and all five
`0013` defaults. Unexpected noninternal triggers, trigger arguments/filters,
altered constraint shape, or disabled foreign-key enforcement fail the check.
Lifecycle runs need table-level `SELECT`, `INSERT`,
and `UPDATE`. The mutation ledger needs `SELECT` and `INSERT` plus column-scoped
`UPDATE` only on `rate_admitted_at`, `denial_code`, `retry_at`,
`reserved_future_rows`, `reserved_text_bytes`, `status`, `result_entity_id`,
`result_revision`, `result_status`, `result_updated_at`, and `updated_at`.
Wilbur actions need `SELECT` and `INSERT`, plus column-scoped `UPDATE` only on
`status`, `revision`, and `updated_at`.
Portia reviews, Gate
decisions, Charlotte results, Wilbur observations, lifecycle events, and
research sources need only `SELECT` and `INSERT`; research requests also need
`UPDATE`. Gate decisions additionally allow column-scoped
`UPDATE` on `answer_user_prompt` and `answer_user_prompt_sha256` so an
unfinished pre-disclosure Gate pass can acquire the exact recomputed prompt;
no other Gate, Wilbur action, or mutation-ledger column is mutable. The runtime
role has no lifecycle `DELETE`; owner and game foreign-key cascades perform
deletion through the existing account boundary. The foreign-key-safe account
cleanup order is tested with Portia and
Charlotte artifact rows. Shared IP windows and vendor backups remain governed
by their own expiry and retention policies.

Migration `0012` supplies the current-binding unique index. Migration `0013`
adds the owner-plus-idempotency-key primary key, then migrations `0014` and
`0015` extend the contract to 12 checked indexes. The mutation ledger durably
records exact replay, conflict, and denial; admits user/IP rate
capacity once; expires abandoned pending claims after 24 hours; reserves
lifetime row/text admission capacity across actions, observations, Wilbur
lifecycle events, mutation-ledger rows, and pending future rows; and commits the
artifact, lifecycle activity/revision, and ledger result atomically. Existing
over-limit history remains preserved. A fresh claim costs its ledger row plus two
future rows for create/observation or one for update; commit substitutes actual
rows for the reservation. Exact pending/committed replays remain valid after a
cap is lowered, while a fresh over-limit status update is refused. The supported
launcher supplies bounded local quotas; changing them does not authorize a
provider-key path or bypass the durable ledger.

## Recovery behavior

- `reserved` or `in_progress` ledger work is reported as pending.
- A settled Portia or Charlotte payload is the recovery authority after an
  interrupted response.
- Each accepted Portia signal assessment is persisted with the reviewed prompt
  digest. Recovery resumes only the remaining ordered signals.
- The active model-request fence prevents a late callback from an older Portia
  attempt from replacing newer progress. Failed-attempt count survives process
  restart, and the third failure settles visibly as `portia_unavailable`.
- Charlotte has the same durable active-request fence and three-attempt
  technical ceiling. Its third failed or indeterminate attempt settles as
  `charlotte_unavailable`; the approved board Answer remains visible and is
  explicitly labeled as not Charlotte-qualified. Wilbur is not authorized
  from that terminal state.
- A persisted Portia review can advance through the deterministic Gate after a
  restart without another model call.
- A persisted approved Answer is bound to the lifecycle run, reviewed prompt
  digest, and Gate input digest before Charlotte can use it.
- A persisted Charlotte result is returned idempotently after later Wilbur
  states begin.
- A lost compare-and-swap race returns conflict; the client reloads the saved
  aggregate instead of inventing a local state.
- A repeated Wilbur observation idempotency key returns the original
  observation only when its request digest and action match.
- A repeated Wilbur mutation replays its committed result or durable denial
  only when owner, key, operation, and request digest match. A changed request
  conflicts, and an abandoned pending claim expires after 24 hours.

Do not manually rewrite a lifecycle row to recover an operation. Preserve the
record and diagnose the ledger, artifact, transition, and event rows together.

This is transactional request/lifecycle recovery, not disaster recovery. The
repository supplies no backup scheduler, point-in-time recovery proof, restore
command, account-import endpoint, recovery objective, or completed restore
drill. Configure and test vendor backups separately; local recovery also
requires the PostgreSQL volume and the database/HMAC/session secrets.

## Observability without hidden reasoning

Useful versioned metrics include operation status and duration, completed
Portia signal count, failed technical attempt count, `portia_unavailable`
outcomes, Portia disposition counts, Gate result and missing requirements,
semantic retry mode and count, Answer provenance status, Charlotte support
count, Wilbur action status, and observation count. Do not log prompts, raw
model output, user observations, chain-of-thought, secrets, database URLs,
Clerk artifacts, or raw client addresses.

`GET /api/games/:id/provenance` returns the owner-safe lifecycle activity
timeline. Account export format `webchess-account-export/4` includes
owner-scoped application records, `charlotteBindingVersion`, sanitized Wilbur
mutation-ledger rows, all ten lifecycle recovery fields, and owner user-rate
windows without their HMAC key in one bounded repeatable-read snapshot. It
omits private mutation capacity reservations, owner/IP identifiers, and HMAC
material, and excludes shared IP/global counters, vendor/Clerk data, leases,
tombstones, and database-restore metadata. Oversized synchronous exports are
refused; `/support` is a non-sensitive operator fallback, not a promise of a
custom handoff. Wilbur's row/text admission envelope preserves existing history
and does not guarantee whole-account exportability because other owner content
also grows.

## Local verification

Use a disposable PostgreSQL 17 database that contains no production data. Run:

```bash
npm run lint
npm run typecheck
npm run plugin:build
npm run plugin:verify
npm run test
DATABASE_URL='postgresql://…disposable-test-only…' npm run test:integration
DATABASE_URL='postgresql://…disposable-test-only…' npm run test:coverage
npm run build
npm run test:a11y
npm run test:e2e
npm run test:links
npm audit --omit=dev --audit-level=high
npm audit --audit-level=high
```

Automated tests and CI must use deterministic model/search stubs and must never
spend account allowance. A separately authorized real smoke must use the packed
plugin, one account/OAuth profile, a disposable loopback database, and no
nonempty provider credential environment variable. It is not a Preview or
API-key smoke.

The OpenClaw service initializes only against its dedicated loopback PostgreSQL
17 URL. It accepts a genuinely empty database or an exact-prefix WebChess ledger
and refuses a nonempty schema with an unrelated relation. Preserve and back up
the dedicated database outside disposable verification; never point the
launcher at hosted or production data.

## Rollback boundary

The 15-migration history is append-only. Application rollback moves code back
but never reverses migration history or drops lifecycle data. Migration `0012`
preserves legacy null-bound rows while protecting newly stamped bindings, and
`0013` preserves committed or denied mutation history. Migrations `0014` and
`0015` preserve Web-memory selection and research provenance. Legacy v1 games
remain readable through their stored answer path. New v2
games fail closed if their lifecycle authority is unavailable; the client does
not fabricate a Portia review, Gate pass, or legacy answer.
