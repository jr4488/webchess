# WebChess 2.0 operator guide

This guide describes the implemented WebChess 2.0 lifecycle. It does not claim
that a Preview or Production deployment exists.

## Lifecycle authority

The server owns this state sequence:

```text
Anansi → Chess → Portia → Gate → Retry → Charlotte → Wilbur → Web
```

The browser may request an allowed operation, but it cannot provide survivor
sets, Portia IDs or dispositions, Gate decisions, retry counters, Charlotte
support authority, provenance, or observation ownership. Every mutation is
owner-scoped. Game mutations use the saved game revision; lifecycle and Wilbur
mutations use compare-and-swap revisions inside the repository.

Portia and Charlotte are separately metered OpenAI operations. The Gate and
Retry policy are deterministic and make no provider call. Wilbur actions and
observations are human-owned records and make no provider call.

## Retry and cost ceiling

For one root inquiry, the policy permits:

- the initial game;
- at most two same-field replay games;
- at most one regenerated 64-facet field; and
- no further attempt after `insufficient_basis`.

Each terminal attempt can use one Portia call. Charlotte is called only after
a persisted Gate pass. A failed or exhausted Gate cannot invoke Charlotte.
Model reservations retain the existing durable quota, rate, lease,
idempotency, deletion-barrier, and settlement behavior. An ambiguous provider
completion is recovered from the winning ledger payload; it is not silently
called again.

The operator should budget for the worst bounded path, not only the happy
path. OpenAI spend alerts are notifications. Durable application quotas remain
the primary control; an explicitly configured provider hard limit is only an
external backstop.

## Migration and runtime roles

Apply `db/migrations/0002_webchess_2_lifecycle.sql` only through the documented
`npm run db:migrate` owner boundary. Never modify applied migration bytes.
After migration, reapply the exact runtime privilege contract and remove the
owner credential before handing the runtime URL to the application.

The runtime schema check expects seventeen application tables. Lifecycle runs
and Wilbur actions need `SELECT`, `INSERT`, and `UPDATE`. Portia reviews, Gate
decisions, Charlotte results, Wilbur observations, and lifecycle events need
only `SELECT` and `INSERT`. The runtime role has no lifecycle `DELETE`; owner
and game foreign-key cascades perform deletion through the existing account
boundary.

## Recovery behavior

- `reserved` or `in_progress` ledger work is reported as pending.
- A settled Portia or Charlotte payload is the recovery authority after an
  interrupted response.
- A persisted Portia review can advance through the deterministic Gate after a
  restart without another model call.
- A persisted Charlotte result is returned idempotently after later Wilbur
  states begin.
- A lost compare-and-swap race returns conflict; the client reloads the saved
  aggregate instead of inventing a local state.
- A repeated Wilbur observation idempotency key returns the original
  observation only when its request digest and action match.

Do not manually rewrite a lifecycle row to recover an operation. Preserve the
record and diagnose the ledger, artifact, transition, and event rows together.

## Observability without hidden reasoning

Useful versioned metrics include operation status and duration, Portia
disposition counts, Gate result and missing requirements, retry mode and count,
Charlotte support count, Wilbur action status, and observation count. Do not
log prompts, raw model output, user observations, chain-of-thought, secrets,
database URLs, Clerk artifacts, or raw client addresses.

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

Migration `0002` is a forward-compatible expansion. Application rollback
moves code back but never reverses migration history or drops lifecycle data.
Legacy v1 games remain readable through their stored answer path. New v2 games
fail closed if their lifecycle authority is unavailable; the client does not
fabricate a legacy answer.
