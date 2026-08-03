# WebChess 2.0 operator guide

This guide describes the implemented WebChess 2.0 lifecycle. It does not claim
that a Preview or Production deployment exists.

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

The operator should budget for the worst bounded path, not only the happy
path. OpenAI spend alerts are notifications. Durable application quotas remain
the primary control; an explicitly configured provider hard limit is only an
external backstop.

## Migration and runtime roles

Apply the canonical migration chain, including
`db/migrations/0002_webchess_2_lifecycle.sql` and
`db/migrations/0003_prompt_review_answer_stage.sql` and
`db/migrations/0004_detached_provider_recovery.sql` and
`db/migrations/0005_align_completed_portia_progress.sql` and
`db/migrations/0006_permitted_portia_amendments.sql` through
`db/migrations/0010_player_visible_answer_prompt.sql`, only through the documented
`npm run db:migrate` owner boundary. Never modify applied migration bytes.
After migration, reapply the exact runtime privilege contract and remove the
owner credential before handing the runtime URL to the application.

The runtime schema check expects seventeen application tables. Lifecycle runs
and Wilbur actions need `SELECT`, `INSERT`, and `UPDATE`. Portia reviews, Gate
decisions, Charlotte results, Wilbur observations, and lifecycle events need
only `SELECT` and `INSERT`. Gate decisions additionally allow column-scoped
`UPDATE` on `answer_user_prompt` and `answer_user_prompt_sha256` so an
unfinished pre-disclosure Gate pass can acquire the exact recomputed prompt;
no other Gate column is mutable. The runtime role has no lifecycle `DELETE`; owner
and game foreign-key cascades perform deletion through the existing account
boundary.

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

Do not manually rewrite a lifecycle row to recover an operation. Preserve the
record and diagnose the ledger, artifact, transition, and event rows together.

## Observability without hidden reasoning

Useful versioned metrics include operation status and duration, completed
Portia signal count, failed technical attempt count, `portia_unavailable`
outcomes, Portia disposition counts, Gate result and missing requirements,
semantic retry mode and count, Answer provenance status, Charlotte support
count, Wilbur action status, and observation count. Do not log prompts, raw
model output, user observations, chain-of-thought, secrets, database URLs,
Clerk artifacts, or raw client addresses.

`GET /api/games/:id/provenance` returns the owner-safe lifecycle activity
timeline. Account export format `webchess-account-export/2` includes the full
owner genealogy in one bounded repeatable-read snapshot.

## Local verification

Use a disposable PostgreSQL 17 database that contains no production data. Run:

```bash
npm run lint
npm run typecheck
npm run test
DATABASE_URL='postgresql://…disposable-test-only…' npm run test:integration
npm run test:coverage
npm run build
npm run test:a11y
npm run test:e2e
npm run test:links
npm audit --omit=dev --audit-level=high
npm audit --audit-level=high
```

Automated tests and CI must use deterministic model stubs and must never spend
live OpenAI tokens. A manual Preview smoke, if separately authorized after all
gates pass, uses a dedicated Preview key and the ordinary durable quotas.

## Rollback boundary

Migrations `0002` and `0003` are forward-compatible expansions. Application
rollback moves code back but never reverses migration history or drops
lifecycle data. Legacy v1 games remain readable through their stored answer
path. New v2 games fail closed if their lifecycle authority is unavailable; the
client does not fabricate a Portia review, Gate pass, or legacy answer.
