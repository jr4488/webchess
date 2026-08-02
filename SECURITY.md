# Security policy

## Reporting a vulnerability

Do not report vulnerabilities in a public issue or Discussion. Use the
repository's private **Security → Report a vulnerability** flow:

https://github.com/jr4488/webchess/security/advisories/new

Include the affected revision, environment, reproduction steps, impact, and a
safe proof of concept if available. Remove credentials, private questions, and
personal data.

Use this private advisory path only for security vulnerabilities. General
support belongs in GitHub Discussions.

## Supported versions

Security fixes target the current `main` branch and the current production
release after one exists. Until tagged releases are published, older revisions
are unsupported.

## Trust boundaries

### Browser

The browser is untrusted. It receives only public configuration and
user-authorized game views. It may request a move by piece ID and destination,
but it may not authoritatively supply the board, capture record, forced pass,
outcome, attention weight, terminal survivor, Portia disposition, Gate result,
retry eligibility, quota balance, usage record, Charlotte result, or Wilbur
observation.

Never put secrets in `NEXT_PUBLIC_*`, client components, browser storage,
analytics, logs, screenshots, issues, or Discussions.

### Authentication

Clerk handles Google, verified-email, and passkey authentication. Configured
deployments use Clerk's dynamic provider and nonce-bearing strict Content
Security Policy. `script-src` contains `strict-dynamic` and no
`unsafe-inline`; Clerk token verification accepts only the authorized-party
claim for the one exact resolved environment origin. The inline-compatible
static policy is limited to unconfigured offline/local tests.

Routing middleware may redirect signed-out users, but every protected route
must independently verify the Clerk session and bind every database operation
to the verified Clerk user ID. Client-supplied user IDs are ignored. Preview
and Production use separate Clerk instances, credential classes, origins, and
webhook secrets.

User suspension and product-specific controls are durable in Neon. A browser
deletion request can erase application content, but it leaves a suspended
marker that prevents the still-valid identity from returning with reset
limits. Final marker cleanup is authenticated through Clerk's signed
`user.deleted` webhook, not a browser assertion. Releases require Clerk's
**Allow users to delete their accounts** setting and a real disposable-user
smoke that proves `user.delete()` and the signed webhook both complete.

### OpenAI

There is one WebChess-owned OpenAI Platform project key, stored only as a
server-side Vercel secret. Visitors never supply an API key and cannot choose a
model or provider. Clerk sign-in does not grant WebChess access to a user's
ChatGPT account or allowance.

The server uses a code-fixed `gpt-5.6-sol` model, bounded structured outputs,
timeouts, `store: false`, and a purpose-separated, pseudonymous
`safety_identifier`. `store: false` does not override OpenAI organization,
project, abuse-monitoring, retention, or data-sharing policy.

Trusted instructions, user text, persisted game data, and model output remain
separate. User text and generated facets are data, not instructions. No model
output can authorize a tool, change a quota, alter ownership, or write game
state without deterministic validation.

### Database and replay

Neon Postgres is authoritative for ownership, current games, append-only move
events, model-request accounting, usage quotas, rate buckets, and concurrency
leases. The server reconstructs a position from the canonical initial board
and ordered events before accepting a move or lifecycle request. Portia
receives only server-derived terminal survivors. The Gate and Retry policy run
in deterministic code, Charlotte requires a stored Gate pass, and Wilbur
observations are accepted only from authenticated user mutations.

Ordered schema changes are applied only by the protected
`MIGRATION_DATABASE_URL` owner command. Its supported wrapper fails closed
unless the checkout is clean, attached, and published as the exact commit on
its configured live remote branch; it verifies the same commit before loading
migration bytes and again before opening the owner connection. Direct
invocation of the underlying migration script is forbidden.

`db/migrations/0001_durable_webchess.sql` becomes immutable at its first
durable application. Never edit, rename, reorder, or delete an applied
migration; append `0002_*`, `0003_*`, and later files. Future changes use
expand/contract so the current rollback deployment remains compatible for the
entire rollback window. Drops, renames, stricter constraints, and other
contracting changes wait until that deployment is explicitly retired.
Application rollback never rewrites or reverses migration history.

Runtime grants are a protected operator action after each migration. The owner
applies the reviewed per-table allowlist to a dedicated non-owner role, removes
the owner credential, and then reconnects through the exact runtime URL to run
the schema check. The runtime role must have schema `USAGE` but not `CREATE`,
must not own or be able to assume an owner of any application table, and must
have only ledger `SELECT` and the required operations on each named application
table.

The Vercel build uses only the least-privileged runtime `DATABASE_URL` for a
repeatable-read, read-only check of the exact migration ledger; the seventeen-table
column catalog; the two critical partial unique indexes; and effective
schema/table privileges obtained directly, through role membership, or through
`PUBLIC`. Missing or unexpected tables or columns, an invalid index,
under-privilege, or over-privilege fails closed without printing credentials or
database identities.

Mutations use idempotency keys and an expected game revision. Forced passes,
captures, promotion, quiet-ply counts, ending precedence, and the final prompt
payload are derived server-side. A malformed or impossible event log moves the
game to an integrity-error state rather than trusting the client.

### Serverless execution

Vercel Function memory is ephemeral and may exist in several regions or
instances. Module caches may improve performance, but no authentication,
authorization, game, rate, quota, concurrency, or billing decision may rely on
them.

The legacy Express prototype's in-memory sessions, revocations, request
counters, daily quota, and concurrency gate are replaced by Clerk and Neon.
Leases expire durably so an interrupted Function cannot hold model concurrency
forever.

### Abuse and cost controls

Controls are layered:

- Clerk identity and per-route authorization;
- per-user and HMAC-pseudonymized IP rate buckets;
- daily game and model-request quotas;
- an hourly model-request quota;
- one active model request per user by default;
- global concurrency slots with expiring leases;
- bounded request and response sizes;
- transactionally reserved and settled model usage;
- hard lifecycle Retry bounds (two same-field games and one regenerated field);
- durable provider response IDs and token counts;
- suspensions and temporary blocks; and
- an OpenAI project budget as the external spend backstop.

Raw IP addresses are not stored in rate-limit tables. `WEBCHESS_HMAC_SECRET`
must be long and random, and every derived identifier must use a distinct
purpose label.

### Hosting and deployment

WebChess targets an independent Vercel project named `webchess`. It must not
reuse MadnessBot projects, secrets, domains, data, or billing configuration.
Production promotion and domain attachment require explicit approval after a
fully passing preview inspection. That inspection includes real Google,
verified-email, passkey, account-export, self-deletion, and signed-webhook
flows; mocked webhook verification is not release evidence.

The intended custom hostname is `webchess.anansiportia.com`. GoDaddy remains
authoritative DNS; Vercel serves the application and manages TLS. DNS must point
directly from GoDaddy to the exact project-specific Vercel records. Do not move
the nameservers to Cloudflare or place a Cloudflare proxy in front of Vercel
without redesigning and retesting the trusted client-address and IP-rate-limit
boundary. The `challenges.cloudflare.com` browser-policy allowance exists only
for Clerk's challenge service and does not make Cloudflare a WebChess host or
proxy.

Vercel Git auto-deployments are disabled. A Preview is a manual deployment of
an exact commit after all local and CI gates pass. Production promotion uses
the exact inspected source but performs a new build with separately scoped
Production credentials and durable resources. Missing deployment credentials,
the wrong Vercel project ID, wrong-class Clerk keys, a non-`whsec_` webhook
secret, Clerk routes, HMACs, conflicting release SHAs, an invalid environment
origin, or incompatible database migration history fail the Vercel prebuild
without printing IDs, URLs, or secret values. Preview accepts only Clerk test
keys and Production accepts only live keys. The local release source verifier
also refuses dirty/untracked files and any `HEAD` that is not the exact commit
advertised by its live configured remote branch. The migration wrapper enforces
the same source boundary independently before any owner connection. Production
promotion, domain attachment, billing changes, and secret changes remain
separately approved operations.

## Priority reports

Reports involving secret disclosure, authentication or ownership bypass,
cross-user game access, replay-integrity failure, Clerk webhook forgery,
prompt/log leakage, quota or cost-control bypass, unsafe redirects, injection,
or account-deletion failure receive priority.
