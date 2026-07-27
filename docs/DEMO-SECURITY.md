# Public application security model

This filename is retained for compatibility with earlier repository links. The
production WebChess plan is one complete application, not a reduced
visitor-key demonstration.

## Public routes

Public pages explain the real method and provide documentation, policies,
installation material, the Apache-2.0 license, and release downloads. Public
routes do not call OpenAI, create a game, expose another user's data, or accept
a model credential.

## Protected routes

Creating, resuming, replaying, moving, answering, exporting account data, or
deleting account data requires a Clerk-authenticated session. Authentication
is verified in each server route and database ownership is derived from the
verified Clerk user ID.

The browser never supplies:

- an OpenAI key or model;
- authoritative pieces or captures;
- a forced pass or game outcome;
- another user's identity;
- quota or token usage; or
- a final model answer.

## Credential path

The only OpenAI credential is a WebChess-owned Platform project key stored as a
server-side Vercel environment secret. An authenticated route may use it only
after durable ownership, rate, quota, idempotency, and concurrency checks.

Requests use `store: false`. Vercel, Clerk, Neon, and OpenAI still process data
under their own service and account policies. `store: false` alone does not
establish Zero Data Retention.

OpenAI spend alerts notify the operator but do not stop traffic. An explicitly
enabled hard spend limit is an external backstop; enforcement can lag while
tracked spend propagates. WebChess therefore treats its own durable quotas,
hourly user/IP limits, and concurrency leases as the primary controls.

## Durable enforcement

Neon stores games, append-only events, model-call accounting, usage buckets,
rate buckets, replay-start intents, deletion tombstones, and expiring
concurrency leases. These controls do not depend on the memory of an Express
process or Vercel Function.

New divisions and replays share daily game-start accounting and hourly user/IP
game-start limits. Replay source validation, child cloning, idempotency,
current-game activation, and the rate/quota debit are atomic. Account exports
have separate hourly user/IP limits and a default 3,000,000-byte serialized
response ceiling. Exports are synchronous single-file responses with no
pagination or asynchronous fallback; oversized exports are refused and the
account owner is directed to `/support` for non-sensitive assistance.

A repeated model intent recovers its committed result or the existing pending
request. Once a started provider lease expires without definitive settlement,
the request is terminally `indeterminate`; the application requires a new
intent and never silently repeats the provider call. Rejected provider
responses persist only sanitized provider IDs, safe failure metadata, and
normalized usage when reported—not raw output or reasoning.

Self-service deletion removes content but preserves a suspended raw-ID marker
until Clerk confirms deletion. The signed `user.deleted` webhook replaces that
state with only a lifetime-stable HMAC tombstone while deleting raw IDs and
content.

Vercel receives only the least-privileged runtime Postgres URL. Migration-owner
credentials remain in a protected operator environment and are never stored in
the application or Vercel.

See [SECURITY.md](../SECURITY.md) for the complete trust boundaries and
[PRIVACY.md](PRIVACY.md) for data handling.
