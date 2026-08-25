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

Security fixes target the current `main` branch and any separately identified
supported release. `2.1.0` is the latest tagged release; the `2.2.0` package
identity in this source tree is a release candidate until it is verified and
tagged. No production hosted deployment is claimed.

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

### Local OpenClaw plugin

The installable OpenClaw plugin is a separate trust boundary from the hosted
service. It launches the complete visual application in a foreground child
process bound explicitly to `127.0.0.1`. The plugin does not register a
background service, agent tool, Gateway HTTP route, cloud database, hosted
account, telemetry endpoint, or WebChess-operated model proxy. Inspect the
package and `openclaw.plugin.json` before installing it, as with any code that
runs on the local machine.

The launcher clears Clerk and hosted `DATABASE_URL` settings for the child
process, admits only the dedicated loopback
`WEBCHESS_OPENCLAW_DATABASE_URL`, and disables Next.js telemetry. The bridge
refuses to start if the parent OpenClaw process inherits any nonempty provider
API-key, API-token, access-token, or OAuth-token environment variable. The
allowlisted Next.js child receives none of them, and a repository `.env.local`
cannot introduce a hosted-service key. Managed installs stage only
bundled application code in a temporary local working directory, link the
plugin's installed dependencies, and remove the directory at shutdown; game
data remains in the dedicated local PostgreSQL database. Local model routes are
disabled on Vercel, reject non-loopback Host/URL pairs, require an exact
same-origin `Origin` on mutations, enforce bounded JSON bodies, and return
no-store responses. The launcher starts an ephemeral bridge on `127.0.0.1`,
gives the Next.js child only its URL and random bearer, and closes the bridge
when the foreground runtime stops. The bridge requires the exact loopback peer
and `Host`, compares the bearer in constant time, accepts only versioned
`application/json`, and applies request, prompt, response, timeout, and
concurrency ceilings.

Prompts cross that authenticated loopback bridge as structured JSON request
bodies, not shell text or one `argv` value. The plugin passes the complete user
message directly to the pinned OpenClaw simple-completion runtime and records
its exact UTF-8 byte count and SHA-256; it does not silently truncate evidence.
OpenClaw resolves the sole selected OpenAI account/OAuth profile and selected
OpenAI model. Its in-process runtime applies that auth object to the request;
WebChess never logs, persists, exports, returns, or places it in the browser,
bridge payload, PostgreSQL records, or Next.js child environment. Provider
key/token environment variables and alternate-provider auth fail closed. OpenAI
may process the question or final game-derived prompt under the account's data
controls.

The supported candidate is intentionally narrower than OpenClaw's general
platform support. It runs only on Linux x86_64 and attests the exact official
global Codex plugin record, package/lock tree, reviewed provider and private-
client runtime modules, wrapper, and native executable. Those file identities,
real paths, and the one-profile OAuth/config binding are revalidated at request
boundaries. Unsupported platforms, altered bytes, link substitution, auth-store
drift, or a different provider client fail closed rather than falling back.

Only this OpenClaw composition provides automatic external research. It is off
without case-scoped, versioned consent. Its deterministic pre-Portia policy
invokes local Codex Search at most once, accepts at most five result links and
five stored citation candidates, and uses a coherent 300-second WebChess
envelope. The local broker may then attempt at most three consented
public-HTTPS pages in total. It rejects credentials, non-global DNS results and
connected addresses, unsafe redirects, unsupported content, oversized bodies,
and page text with guarded injection signals; accepted excerpts and every
failure remain bounded
and separately attributed. Search synthesis, titles, URLs, page text, and
failure labels remain untrusted evidence candidates and cannot authorize a
mutation, provider selection, or Gate pass.

The dedicated local PostgreSQL database is the persistence boundary, while the
shared server handlers and append-only event log remain authoritative.
WebChess recomputes the 64-cell cast from the saved facets and seed, replays the
ordered event log under the canonical rules, derives captures and endings, and
rejects inconsistent saved state before requesting an answer. Browser profiles
on the same loopback installation restore the same owner-scoped game; another
machine does not receive it, and WebChess provides no cloud backup or
synchronization for local mode.

### Retired hosted and source-checkout runtimes

Earlier candidates described a key-backed hosted model adapter and a separate
source-checkout launcher with Clerk or a signed machine principal. Those paths
are retained only as historical code and contract-test fixtures; they are not
release instructions or supported WebChess 2.2 runtimes. The `local:setup`,
`local:dev`, and `local:down` npm entry points have been removed, invoking the
legacy launcher directly fails closed, and API service selection rejects every
principal except `local-openclaw` before any hosted adapter can load.

Do not configure a WebChess, OpenAI, Codex, cloud-provider, or alternate-provider
key/token to revive those paths. The public website is a brochure and source/
paper navigator, not a hosted gameplay or model service. The only supported
authentication boundary is the dedicated OpenClaw profile and its one selected
OpenAI account/OAuth profile for both model inference and official Codex Hosted
Search. Historical Clerk, Neon, deletion, and hosted-provider controls remain
useful review evidence, but they do not establish a runnable release surface.

Trusted instructions, user text, persisted game data, and model output remain
separate. User text and generated facets are data, not instructions. No model
output can authorize a tool, change a quota, alter ownership, or write game
state without deterministic validation.

### Retained hosted database and replay controls

The supported local launcher applies the same canonical append-only migrations
to its dedicated loopback PostgreSQL database and validates the resulting
ledger. It does not ask a player to configure a migration-owner credential.
The Neon role separation and deployment commands in the remainder of this
subsection describe the retired hosted design only; they are review evidence,
not local installation instructions.

In that retired hosted design, Neon Postgres is authoritative for ownership,
current games, append-only move
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

Hosted and local migration runners require the existing ledger to be an exact,
checksum-matching prefix of the 17 canonical migrations through
`0017_trajectory_directional_record`. Migration `0012` is upgrade-safe without a
duplicate-data audit: pre-`0012` actions retain a null binding version,
including duplicate suggestion indexes, while a trigger stamps current inserts
before the partial unique constraint and makes their identity, canonical
content, and binding immutable. Current actions start planned at revision zero;
each status change advances revision exactly once without moving update time
backward. Migration `0013` adds the durable Wilbur mutation ledger. Its state
guard requires pending/unadmitted insertion, freezes claim identity and pending
reservations, orders admission before settlement, prevents update time from
moving backward, and makes admission timestamps and terminal rows immutable.
Migration `0014` adds owner-bound, explicitly selected Web-memory links and
follow-up scheduling without silently reusing an observation. Migration `0015`
records the versioned research-consent decision and bounded direct-page facts
or failures; historical rows are conservatively backfilled as not consented.
Migration `0016` raises only the guarded Search ceiling to 300 seconds, and
`0017` adds all-or-none versioned trajectory-direction records while preserving
legacy null rows. These migrations are append-only and do not reinterpret
missing consent as permission or legacy data as current directional input.

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
table. Column-scoped `UPDATE` is limited to
`gate_decisions.answer_user_prompt`,
`gate_decisions.answer_user_prompt_sha256`, and `wilbur_actions.follow_up_at`,
`wilbur_actions.status`, `wilbur_actions.revision`, and
`wilbur_actions.updated_at`. The mutation ledger can update only
`rate_admitted_at`, `denial_code`, `retry_at`,
`reserved_future_rows`, `reserved_text_bytes`, `status`, `result_entity_id`,
`result_revision`, `result_status`, `result_follow_up_at`,
`result_updated_at`, and `updated_at`.
Mutation access to any other Gate, Wilbur action, or ledger column fails the
compatibility check.

The Vercel build uses only the least-privileged runtime `DATABASE_URL` for a
repeatable-read, read-only check of the exact migration ledger; 20 application
tables plus the ledger—21 total; all 12 contract indexes; exactly two
origin-enabled, unfiltered `BEFORE INSERT OR UPDATE FOR EACH ROW` Wilbur
trigger/function pairs; all 39 reviewed constraints; all 11 reviewed defaults;
and effective schema/table privileges obtained directly, through role
membership, or through `PUBLIC`. Missing or unexpected tables or columns, an
invalid index, trigger, constraint, or default, under-privilege, or over-
privilege fails closed without printing credentials or database identities.
Unexpected noninternal triggers, trigger arguments/filters, altered constraint
validation/deferrability/parent shape, or disabled foreign-key enforcement also
fail closed.

Mutations use idempotency keys and an expected game revision. Forced passes,
captures, promotion, quiet-ply counts, ending precedence, and the final prompt
payload are derived server-side. A malformed or impossible event log moves the
game to an integrity-error state rather than trusting the client.

### Retained hosted serverless execution

Vercel Function memory is ephemeral and may exist in several regions or
instances. Module caches may improve performance, but no authentication,
authorization, game, rate, quota, concurrency, or billing decision may rely on
them.

The legacy Express prototype's in-memory sessions, revocations, request
counters, daily quota, and concurrency gate are replaced by Clerk and Neon.
Leases expire durably so an interrupted Function cannot hold model concurrency
forever.

Event replay, idempotency, leases, and persisted provider artifacts support
transactional request recovery; they do not supply database backups, restore
automation, a point-in-time recovery proof, or an account-import path. Account
export `/4` is owner-scoped and bounded, not a disaster-recovery image.

### Retained hosted abuse and cost controls

Controls are layered:

- Clerk identity and per-route authorization;
- per-user and HMAC-pseudonymized IP rate buckets;
- daily game and model-request quotas;
- an hourly model-request quota;
- separate per-user/IP Wilbur action and observation limits;
- a durable owner-plus-key Wilbur mutation ledger with once-only rate admission
  and reserved lifetime row/text admission capacity;
- one active model request per user by default;
- global concurrency slots with expiring leases;
- bounded request and response sizes;
- transactionally reserved and settled model usage;
- hard lifecycle Retry bounds (two same-field games and one regenerated field);
- durable provider response IDs and token counts;
- suspensions and temporary blocks; and
- in the historical hosted design, an OpenAI project budget as an external
  spend backstop.

Raw IP addresses are not stored in rate-limit tables. `WEBCHESS_HMAC_SECRET`
must be long and random, and every derived identifier must use a distinct
purpose label.

For each Wilbur create, update, or observation, an exact owner/key retry replays
the committed result or stored denial; a changed operation or request digest
conflicts. Pending claims abandoned for 24 hours expire durably. Capacity is
reserved before mutation across actions, observations, Wilbur lifecycle events,
mutation-ledger rows, and pending future rows. Existing over-limit history is
preserved, and exact pending/committed replays remain valid if a cap is later
lowered; a fresh status update still requires ledger-plus-event capacity. The
artifact, lifecycle revision/activity, and ledger settlement commit atomically,
so a retry neither double-debits the rate window nor creates a second artifact.

The synchronous `webchess-account-export/4` includes the owner's pseudonymous
user-rate windows without their HMAC key, all lifecycle recovery fields,
`charlotteBindingVersion`, and sanitized Wilbur mutation-ledger rows. It omits
the ledger's private capacity reservations, owner/IP identifiers, and HMAC
material, and does not export shared IP/global counters, Clerk/vendor data,
deletion tombstones, or database-restoration metadata. A configurable byte
ceiling and second serialized-size check prevent an unbounded response. The
Wilbur admission envelope preserves existing history and is not a whole-account
export guarantee because other owner content also accumulates.

### Retained hosted deployment design

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
