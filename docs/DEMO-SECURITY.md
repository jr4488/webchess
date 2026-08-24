# Public application security model

This filename and the hosted threat-model detail below are retained for audit
compatibility with earlier repository links. They are not current deployment or
installation instructions. WebChess 2.2 supports only the packed OpenClaw
runtime with one selected OpenAI account/OAuth profile for both inference and
official Codex Hosted Search. Every non-OpenClaw API principal and every
provider key/token path fails closed. See [SECURITY.md](../SECURITY.md) and
[INSTALL.md](../INSTALL.md) for the current boundary.

## Public routes

Public pages explain the real method and provide documentation, policies,
installation material, the Apache-2.0 license, and release downloads. Public
routes do not call OpenAI, create a game, expose another user's data, or accept
a model credential.

## Retired hosted protected-route model

The earlier hosted target required a Clerk-authenticated session and derived
database ownership from the verified Clerk user ID. That contract remains
reviewable below, but Clerk cannot select the WebChess 2.2 API service graph and
is not an alternate launch path.

The browser never supplies:

- an OpenAI key or model;
- authoritative pieces or captures;
- a forced pass or game outcome;
- another user's identity;
- quota or token usage; or
- a final model answer.

## Retired provider path

The earlier hosted provider route is retired. Its service adapter cannot load
for a hosted principal, provider clients cannot self-construct from environment
credentials, and deployment preflight rejects provider credential variables.
Do not configure a project key, token, alternate endpoint, or separate billing
path to reactivate it. The supported OpenClaw runtime keeps the selected account
OAuth object inside OpenClaw and applies the durable ownership, rate, quota,
idempotency, and concurrency contracts before model work.

## Retained hosted durable enforcement

This section records the retired Clerk/Neon/Vercel design. The supported local
plugin reuses the canonical data and lifecycle contracts in its dedicated
loopback PostgreSQL database, but it does not use these hosted identities,
credentials, deployment roles, or operator paths.

Neon stores games, append-only events, model-call accounting, usage buckets,
rate buckets, replay-start intents, deletion tombstones, and expiring
concurrency leases. These controls do not depend on the memory of an Express
process or Vercel Function.

New divisions and replays share daily game-start accounting and hourly user/IP
game-start limits. Replay source validation, child cloning, idempotency,
current-game activation, and the rate/quota debit are atomic. Account exports
use `webchess-account-export/4`, have separate hourly user/IP limits, and have a
default 3,000,000-byte serialized response ceiling. They include owner user-rate
windows, all lifecycle recovery fields, `charlotteBindingVersion`, and sanitized
Wilbur mutation-ledger rows. Private mutation capacity reservations, owner/IP
identifiers, HMAC material, shared IP/global counters, Clerk/vendor data, and
database-restore metadata are omitted. Exports are synchronous single-file
responses with no
pagination or asynchronous fallback; oversized exports are refused and the
account owner is directed to `/support` for non-sensitive assistance. Wilbur's
admission envelope preserves existing history and does not guarantee that every
whole account fits the bounded response.

Wilbur actions and observations have independent per-user/IP hourly limits.
Each current action is version-bound to one exact Charlotte suggestion index,
and the database permits at most one current-bound action for that suggestion in
a lifecycle run. A durable owner-plus-key mutation claim supplies exact replay,
conflict, and denial; charges rate admission once; expires abandoned pending
claims after 24 hours; reserves capacity across durable Wilbur rows and pending
future rows; preserves existing over-limit history; and atomically commits the
artifact, lifecycle activity, and ledger result.

A repeated model intent recovers its committed result or the existing pending
request. Once a started provider lease expires without definitive settlement,
the request is terminally `indeterminate`; the application requires a new
intent and never silently repeats the provider call. Rejected provider
responses persist only sanitized provider IDs, safe failure metadata, and
normalized usage when reported—not raw output or reasoning.

Self-service deletion removes content but preserves a suspended raw-ID marker
until Clerk confirms deletion. The signed `user.deleted` webhook replaces that
state with only a lifetime-stable HMAC tombstone while deleting raw IDs and
content. The foreign-key-safe deletion order is tested with Portia and Charlotte
artifact rows. Shared IP rate windows and vendor backups age under their own
retention policies.

Vercel receives only the least-privileged runtime Postgres URL. Migration-owner
credentials remain in a protected operator environment and are never stored in
the application or Vercel.

See [SECURITY.md](../SECURITY.md) for the complete trust boundaries and
[PRIVACY.md](PRIVACY.md) for data handling.
