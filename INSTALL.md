# Installing and deploying WebChess

This guide covers the installable local OpenClaw plugin, the loopback
source-checkout runtime, hosted-service development, and the approved Vercel
architecture. It does not claim that the hosted service is deployed, and it
does not authorize production promotion, billing changes, secret disclosure,
or DNS changes.

The latest tagged package is `2.1.0`. This source tree and the archive examples
below use the unreleased `2.2.0` candidate identity until verification and a new
tag make it a published release.

## Install the local OpenClaw plugin

The plugin includes and launches the complete visual WebChess application. It
requires OpenClaw 2026.7.1 or later, one of the Node.js versions supported by
that OpenClaw release, npm 11, PostgreSQL 17 on loopback, and a usable default
model already configured in OpenClaw. It does **not** require a WebChess
account, Clerk, hosted Neon, Vercel, `OPENAI_API_KEY`, or an operator-owned
service.

For a source checkout, install the locked dependencies, build the small plugin
entry, and register the checkout as a linked OpenClaw plugin:

```bash
git clone https://github.com/jr4488/webchess.git
cd webchess
npm ci
npm run plugin:build
npm run verify:openclaw
openclaw plugins install --link .
openclaw plugins inspect webchess --runtime --json
openclaw config set tools.web.search.timeoutSeconds 120
export WEBCHESS_OPENCLAW_DATABASE_URL=postgresql://webchess:password@127.0.0.1:55432/webchess
openclaw webchess
```

`plugins install` registers and enables the plugin; there is no separate
Gateway service or WebChess account to configure. The manifest is startup-lazy:
OpenClaw loads it when `openclaw webchess` is invoked. The command launches the
app in the foreground at `http://127.0.0.1:3210/openclaw`, opens the default
browser, and remains attached so Ctrl-C cleanly stops the local server.
The database must be dedicated to this local WebChess installation; the
launcher rejects non-PostgreSQL and non-loopback URLs. It applies the bundled
canonical migrations before reporting readiness. `npm run verify:openclaw`
builds the plugin entry and exercises the application and UI checks; it does
not itself install a packed archive or prove a real OpenClaw provider/database
round trip. `npm run test:integration` requires `DATABASE_URL` to name a
disposable PostgreSQL 17 database.

Automatic research uses OpenClaw's configured Codex Search provider. The
recommended 120-second OpenClaw search window sits inside WebChess's
150-second broker envelope, leaving bounded time for process startup, output
validation, and durable settlement. WebChess does not silently change the
user's global OpenClaw configuration; the explicit `openclaw config set`
command above is therefore part of local research setup.

Useful launch options are:

```bash
openclaw webchess --no-open
openclaw webchess --port 4312
```

For a self-contained local install rather than a source link, build a standard
npm package archive and give that archive to OpenClaw's managed installer:

```bash
npm ci
npm run plugin:build
npm run verify:openclaw
npm pack
openclaw plugins install npm-pack:./webchess-2.2.0.tgz
```

OpenClaw installs production dependencies with lifecycle scripts disabled.
The package therefore contains both the compiled plugin entry and the source
needed by the bundled local Next.js application. Rebuild the archive after any
source change. Before packing a release candidate, run `npm run plugin:build`,
require `git diff --exit-code -- openclaw-plugin/dist`, and inspect
`npm pack --dry-run`. Then install and smoke-test the exact produced archive;
the source-checkout verification command is not a substitute for that managed-
install test. At launch, the plugin stages that bundled source in an
operating-system temporary working directory, links the managed installation's
dependencies, and removes the directory when the foreground command exits.
The temporary directory contains application code only; game history remains
in the dedicated local database.

The launch is intentionally local-only:

- Next.js listens on `127.0.0.1`, not the LAN;
- questions, casts, moves, lifecycle artifacts, actions, and observations are
  stored in the dedicated loopback PostgreSQL database;
- the loopback process invokes `openclaw infer model run --local` without a
  model override, so OpenClaw resolves the user's default model and existing
  authentication;
- hosted Clerk and generic database variables are cleared for the launched
  process; only `WEBCHESS_OPENCLAW_DATABASE_URL` is admitted;
  provider environment already present in the user's shell remains available
  to that user's OpenClaw, while a repository `.env.local` cannot introduce a
  missing OpenAI key into the child process; and
- no WebChess account, telemetry service, sync service, or hosted WebChess
  proxy is contacted.

The user's configured model provider may still be remote. In that case,
OpenClaw sends the division prompt and final game-derived prompt to that
provider under the user's own account and data controls. Credentials remain in
OpenClaw/provider configuration and are never sent to the browser or a
WebChess-operated service.

The dedicated local database is the persistence boundary: browser refreshes
and profiles on the same loopback installation see the same owner-scoped game,
while another machine does not. Concurrent tabs use durable revision checks.
The server recomputes the cast from its seed and replays the event log before
accepting a saved position or running later lifecycle stages.

## Local source-checkout development without OpenClaw

This runs the hosted-service application architecture on one machine with the
operator's server-side OpenAI key and a dedicated loopback PostgreSQL 17
database. It does not install, launch, or call OpenClaw. Authentication is
explicit:

- with neither Clerk key, WebChess offers one signed installation-owned local
  principal for this machine;
- with a matching `pk_test_...` / `sk_test_...` pair, it uses Clerk development
  identity; and
- a partial pair or live Clerk credentials fail closed.

Prerequisites:

- Docker, with permission to run containers on loopback
- Node.js 22.22.3 or later in the supported 22.x line, and npm 11.x
- `OPENAI_API_KEY` in `.env` or `.env.local` (never a `NEXT_PUBLIC_*` variable)
- optional Clerk development keys as a complete pair. If you use them, include
  `http://localhost:3005` as an allowed origin.

```bash
npm ci
npm run local:setup
```

The setup command:

- writes `local/.env` with a generated PostgreSQL password;
- writes `.env.development.local` with a loopback `DATABASE_URL` on
  `127.0.0.1:55433`, separate `WEBCHESS_HMAC_SECRET`,
  `WEBCHESS_DELETION_HMAC_SECRET`, and `WEBCHESS_LOCAL_SESSION_SECRET` values,
  local development quotas (including 1,200/2,400 hourly
  user/IP Wilbur actions and 600/1,200 observations), the `2.2.0-local`
  candidate identity, and `WEBCHESS_OPENCLAW_ENABLED` unset;
- starts PostgreSQL 17 in a Docker container bound only to IPv4 loopback; and
- leaves `.env.local` untouched, preserves only supported secrets already in
  the generated file, and removes unrelated settings from that generated file.

To opt into Clerk, add both development keys to `.env.local`:

```dotenv
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

Then start the app:

```bash
npm run local:dev
```

The command binds Next.js to `127.0.0.1:3005`, opens
`http://localhost:3005/play` only after the application is ready, and uses the
selected authentication mode for `/sign-in` and `/sign-up`. The launcher
refuses an existing same-name PostgreSQL container unless its pinned image,
loopback port, persistent volume, restart policy, and local credentials match.
It never deletes or rewrites a mismatched container. Only the local launcher
sets the activation flag that permits the first authenticated request to apply
canonical migrations; ordinary development, hosted, and Vercel starts never
take that path. Local initialization accepts a genuinely empty database or an
exact-prefix WebChess ledger, and refuses a nonempty schema containing an
unrelated relation rather than adopting it. Stop the app with Ctrl-C. Stop the
database with `npm run local:down`; that keeps the named volume so games survive
a restart.

Containers created before the immutable WebChess ownership label was added are
intentionally refused even when they use the expected name. To adopt the data
without deleting it, first inspect and back up the named
`webchess_local_pgdata` volume, then run:

```bash
docker stop webchess-local-postgres
docker rm webchess-local-postgres
npm run local:setup -- --adopt-volume
```

This removes and recreates only the container and explicitly reuses the named
volume. Never run `docker volume rm` as part of this procedure.

This path never reads `WEBCHESS_OPENCLAW_DATABASE_URL` and never invokes
`openclaw infer`. Model calls use the same server-side OpenAI Platform key and
`gpt-5.6-sol` model as the hosted service. Automatic OpenClaw research is not
available here.

Do not point the generated `.env.development.local` `DATABASE_URL` at Neon or
production data. The signed local principal is a machine boundary, not human
identity proof: browser profiles on the same computer share the same owner.
Adding Clerk later creates a separate Clerk owner and does not merge or reassign
local games. Preserve `.env.development.local` with the database backup because
losing `WEBCHESS_LOCAL_SESSION_SECRET` makes the existing local owner's rows
inaccessible. Signed-local mode provides the bounded synchronous export and
sign-out but intentionally
does not expose Clerk profile, passkey, or hosted account-deletion controls.
In Clerk mode, the `user.deleted` webhook remains the durable hosted deletion
barrier; configure it before treating identity deletion as complete.

## Hosted-service development and deployment

## Prerequisites

- Node.js 22.22.3 or later in the supported 22.x line
- npm 11.x
- a Clerk application
- a Neon Postgres database
- an OpenAI Platform project and server API key
- a Vercel account that can create an independent project named `webchess`

The hosted service does not accept visitor-supplied API keys and does not use
ChatGPT account allowances. Clerk handles identity; the WebChess OpenAI
Platform project pays for hosted model calls.

## 1. Install the locked dependencies

```bash
git clone https://github.com/jr4488/webchess.git
cd webchess
npm ci
cp .env.example .env.local
```

Use the declared Node and npm major versions. Do not replace the lockfile with
an install produced by an unsupported runtime.

## 2. Configure Clerk

Create a dedicated Clerk application for WebChess. In the Clerk dashboard:

1. enable Google sign-in;
2. enable sign-up with email, require an email address, and require email
   verification;
3. enable passkeys;
4. under **User & Authentication → User model**, enable **Allow users to
   delete their accounts** (the account page calls Clerk's `user.delete()`,
   which otherwise fails with `user_delete_self_not_enabled`);
5. add the local origin `http://localhost:3000`;
6. later add the exact Vercel Preview and approved Production origins;
7. configure a separate signed `user.deleted` webhook for each environment;
   and
8. copy the publishable and secret keys to `.env.local`.

Set:

```dotenv
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/play
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/play
CLERK_SECRET_KEY=sk_test_...
```

Vercel Preview must use a Clerk development instance and matching
`pk_test_...` / `sk_test_...` credentials. Vercel Production must use the
separate Clerk production instance and matching `pk_live_...` / `sk_live_...`
credentials. Production Google sign-in must use the operator's configured
Google OAuth client rather than Clerk's shared development credentials. The
deployment preflight rejects a key from the wrong environment class.

The publishable key and route values are intentionally public. The secret key
is not. WebChess pins its custom sign-in and sign-up paths in the routing
proxy as well as the Clerk environment, accepts session tokens only when their
authorized-party claim matches the one exact resolved site origin, and verifies
authentication again inside every protected route; the routing proxy is not
the sole authorization boundary.

For account-deletion cleanup, configure a Clerk `user.deleted` webhook whose
endpoint is:

```text
https://<exact-environment-origin>/api/webhooks/clerk
```

Store its signing secret as:

```dotenv
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...
```

Use a different signing secret for each environment. A self-service WebChess
deletion removes game and accounting content but keeps a suspended
`user_controls` record containing the Clerk user ID until Clerk confirms
identity deletion. The signed webhook performs forced cleanup: it stores only a
stable HMAC deletion marker in `deleted_user_tombstones` while deleting the raw
Clerk user ID and account content. This prevents a deleted identity from being
re-created with fresh quotas. The foreign-key-safe cleanup order is tested with
games that contain Portia and Charlotte artifact rows. Shared IP rate windows
and vendor backups are not synchronously erased; they expire under their own
retention policies. Do not consider deletion complete until that
signed webhook succeeds.

## 3. Configure Neon

Create a dedicated Neon project or database for WebChess. Use separate Neon
branches or databases for development, preview, and production, with two
different database roles:

- a migration owner used only from a protected operator environment to apply
  ordered migrations; and
- a dedicated runtime login with no membership in the migration-owner role and
  only the effective privileges listed below.

The runtime role must not own the schema or have permission to create, alter, or
drop schema objects or manage roles. It must not be able to `SET ROLE` to an
owner. Put only its pooled connection string in:

```dotenv
DATABASE_URL=postgresql://...
```

Install the locked dependencies in a clean checkout of the reviewed commit.
That commit must be on an attached branch and published as the exact commit
advertised by its configured live remote branch. Supply the protected
migration-owner URL only to that operator shell, then use the guarded public
command:

```bash
read -rsp 'Migration owner URL: ' MIGRATION_DATABASE_URL
export MIGRATION_DATABASE_URL
echo
npm run db:migrate
unset MIGRATION_DATABASE_URL
```

`npm run db:migrate` is the only supported migration entry point. It verifies
that the checkout has no tracked or untracked changes and matches its live
remote commit before it loads migration bytes and again before it connects to
the database. It also requires both verifications to identify the same commit.
Do not invoke `scripts/deployment-migrate.mjs` directly or migrate from a dirty,
detached, unpublished, archived, or subsequently changed source tree.

The guarded command reads only `MIGRATION_DATABASE_URL`; it never falls back to
the least-privileged `DATABASE_URL`. It takes a PostgreSQL advisory lock,
applies canonical files in filename order in one transaction, and records the
normalized SHA-256 of each file in `webchess_schema_migrations`. It refuses
checksum drift, a ledger that is not an exact prefix of the release, database
migration IDs absent from the release, embedded transaction-control statements,
and DDL that cannot run inside the outer transaction.

Migration `0012_unique_wilbur_charlotte_actions` is upgrade-safe without a
duplicate-data audit. It preserves every pre-`0012` action with a null
`charlotte_binding_version`, including duplicate suggestion indexes. Its trigger
stamps each new action with the current binding version before the partial
unique constraint is checked, requires a Charlotte suggestion index, requires
the action to start `planned` at revision zero, and makes its identity,
canonical content, and binding immutable. A status update must advance revision
by exactly one and cannot move `updated_at` backward. Migration
`0013_wilbur_mutation_requests` adds the durable Wilbur mutation ledger; neither
migration deletes or chooses among legacy rows. The `0013` state guard requires
every claim to begin pending and unadmitted, freezes its owner/key/request/target
identity and pending reservation, prevents `updated_at` from moving backward,
requires admission to be recorded while still pending before commit, freezes the
admission timestamp once set, and makes terminal claims immutable.

Never place `MIGRATION_DATABASE_URL` in `.env.local`, a Vercel environment, CI
logs, shell history, or repository settings.

After every migration, use the owner connection in the protected operator
environment to remove any earlier direct grants and apply this reviewed
runtime-role allowlist:

- database `CONNECT` and `USAGE` on the application schema, but not schema
  `CREATE`;
- `SELECT` only on `webchess_schema_migrations`;
- `SELECT`, `INSERT`, and `UPDATE` on `deleted_user_tombstones`;
- `SELECT` and `INSERT` on `game_events`;
- `SELECT` and `UPDATE` on `model_concurrency_slots`; and
- `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on `user_controls`, `games`,
  `model_requests`, `game_start_requests`, `usage_buckets`, and
  `rate_buckets`;
- `SELECT`, `INSERT`, and `UPDATE` on `lifecycle_runs`;
- `SELECT` and `INSERT` on `wilbur_actions`, plus column-scoped `UPDATE` only
  on `status`, `revision`, and `updated_at`;
- `SELECT` and `INSERT` on `wilbur_mutation_requests`, plus column-scoped
  `UPDATE` only on `rate_admitted_at`, `denial_code`, `retry_at`,
  `reserved_future_rows`, `reserved_text_bytes`, `status`, `result_entity_id`,
  `result_revision`, `result_status`, `result_updated_at`, and `updated_at`;
- `SELECT` and `INSERT` on `portia_reviews`, `gate_decisions`,
  `charlotte_results`, `wilbur_observations`, `lifecycle_events`, and
  `research_sources`; and
- `SELECT`, `INSERT`, and `UPDATE` on `research_requests`.

Grant no sequence privileges. Remove any role membership that would let the
runtime login assume an owner, and remove excess access inherited from another
role or `PUBLIC`; revoking a direct grant alone does not cancel inherited
privileges. Apply the grants to the exact environment-specific role only.
Remove `MIGRATION_DATABASE_URL` from the shell before testing or handing a
runtime URL to Vercel.

From a protected operator shell, the runtime role can be verified without any
DDL:

```bash
read -rsp 'Runtime database URL: ' DATABASE_URL
export DATABASE_URL
echo
npm run db:schema:check
unset DATABASE_URL
```

That command opens a repeatable-read, read-only transaction and fails unless:

- the migration ledger contains exactly the release's ordered IDs and
  checksums;
- the application schema contains exactly 19 application tables plus
  `webchess_schema_migrations`—20 total—with the expected column names, types,
  and nullability;
- all eight contract indexes are valid, ready, and unique with their expected
  columns and predicates: `games_one_current_per_user`,
  `model_requests_one_succeeded_operation_per_game`,
  `lifecycle_runs_game_id_key`,
  `wilbur_actions_one_per_charlotte_suggestion`,
  `wilbur_mutation_requests_pkey`,
  `research_requests_game_id_stage_policy_version_key`,
  `research_sources_research_request_id_ordinal_key`, and
  `research_sources_research_request_id_url_key`; exactly two origin-enabled
  `BEFORE INSERT OR UPDATE FOR EACH ROW` Wilbur trigger/function pairs—with no
  `WHEN`, `UPDATE OF`, or trigger arguments—18 critical Wilbur constraints, and
  all five `0013` defaults also match the release; unexpected noninternal
  triggers, altered constraint validation/deferrability/parent shape, or
  disabled foreign-key enforcement triggers fail; and
- the connected runtime role has schema `USAGE` but not `CREATE`, has exactly
  the effective per-table privileges above, plus column-scoped `UPDATE` only
  on `gate_decisions.answer_user_prompt` and
  `gate_decisions.answer_user_prompt_sha256` and the three Wilbur action columns
  and eleven mutation-ledger columns above, owns none of the expected tables,
  and cannot assume an owner role.

The privilege check includes access obtained through membership or `PUBLIC`.
Do not continue until it passes using the same runtime URL intended for the
environment.

The migration creates:

- `webchess_schema_migrations`
- `deleted_user_tombstones`
- `user_controls`
- `games`
- `game_events`
- `model_requests`
- `game_start_requests`
- `usage_buckets`
- `rate_buckets`
- `model_concurrency_slots`
- `lifecycle_runs`
- `portia_reviews`
- `gate_decisions`
- `charlotte_results`
- `wilbur_actions`
- `wilbur_observations`
- `lifecycle_events`
- `research_requests`
- `research_sources`
- `wilbur_mutation_requests`

The canonical ledger contains 13 ordered migrations, from
`0001_durable_webchess` through
`0013_wilbur_mutation_requests`. The 19 application tables above plus the ledger
table make 20 total schema tables.

The owner command is idempotent for already-recorded, matching files. Once
`0001_durable_webchess.sql` has been applied to the first durable database, its
name and exact bytes are frozen. Never edit, rename, reorder, or delete it.
Append all later changes as monotonically ordered `0002_*`, `0003_*`, and later
migrations, and correct an applied mistake with another forward migration.

Every future schema change follows expand/contract. The expand migration must
remain compatible with both the candidate application and the currently
recorded Production rollback deployment for the entire rollback window. Add
nullable or safely defaulted structures first, backfill safely, and dual-read or
dual-write when a transition requires it. Drop or rename objects, remove old
representations, or tighten constraints only in a later ordered migration after
the new release is verified and the previous deployment is explicitly retired
as a rollback target. An application rollback does not reverse schema
migrations.

A database previously initialized by running a raw SQL file has no trustworthy
checksum ledger: do not let the command adopt it. Recreate a disposable
development or Preview database from empty; handle any non-disposable database
only through a separately reviewed recovery plan.

## 4. Configure OpenAI and abuse controls

Create a project-scoped OpenAI Platform key and review its spend controls. This
guide does not authorize enabling billing or a hard spend limit. Put the key
only in the server environment:

```dotenv
OPENAI_API_KEY=sk-proj-...
```

The production model is fixed in server code to `gpt-5.6-sol`. There is no
visitor key field and no runtime model selector.

Generate two independent secrets containing at least 32 random bytes each:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Store them separately without printing them again:

```dotenv
WEBCHESS_HMAC_SECRET=<first-independent-secret>
WEBCHESS_DELETION_HMAC_SECRET=<second-independent-secret>
```

`WEBCHESS_HMAC_SECRET` is the general, rotatable secret used with
domain-separated labels for stored user/IP rate identifiers and OpenAI
`safety_identifier` values. Never store a raw client IP for these controls.
`WEBCHESS_DELETION_HMAC_SECRET` is separate and lifetime-stable while any
deletion tombstone exists: the raw Clerk IDs are deliberately deleted, so the
tombstones cannot be re-keyed after rotation.

Default durable limits are:

```dotenv
WEBCHESS_DAILY_GAME_LIMIT=2
WEBCHESS_DAILY_MODEL_REQUEST_LIMIT=100
WEBCHESS_DAILY_GLOBAL_MODEL_REQUEST_LIMIT=200
WEBCHESS_HOURLY_MODEL_REQUEST_LIMIT=20
WEBCHESS_HOURLY_IP_MODEL_REQUEST_LIMIT=40
WEBCHESS_HOURLY_GAME_START_LIMIT=20
WEBCHESS_HOURLY_IP_GAME_START_LIMIT=40
WEBCHESS_HOURLY_GAME_MOVE_LIMIT=600
WEBCHESS_HOURLY_IP_GAME_MOVE_LIMIT=1200
WEBCHESS_HOURLY_ACCOUNT_EXPORT_LIMIT=2
WEBCHESS_HOURLY_IP_ACCOUNT_EXPORT_LIMIT=10
WEBCHESS_HOURLY_WILBUR_ACTION_LIMIT=120
WEBCHESS_HOURLY_IP_WILBUR_ACTION_LIMIT=240
WEBCHESS_HOURLY_WILBUR_OBSERVATION_LIMIT=60
WEBCHESS_HOURLY_IP_WILBUR_OBSERVATION_LIMIT=120
WEBCHESS_ACCOUNT_EXPORT_MAX_BYTES=3000000
WEBCHESS_WILBUR_STORAGE_ROW_LIMIT=500
WEBCHESS_WILBUR_STORAGE_TEXT_BYTES_LIMIT=250000
WEBCHESS_CONCURRENT_MODEL_LIMIT=1
WEBCHESS_GLOBAL_MODEL_CONCURRENT_LIMIT=4
WEBCHESS_MODEL_LEASE_SECONDS=180
```

The default Wilbur admission envelope is 500 total durable Wilbur rows and
250,000 exact UTF-8 bytes across stored action/observation text. Rows include
actions, observations, Wilbur lifecycle events, mutation-ledger rows, and
pending reservations for future rows. A fresh claim adds its ledger row and
reserves two future rows for create/observation (the artifact and event) or one
for an update (the event). Commit atomically substitutes the real rows for that
reservation; terminal ledger rows remain counted and release their future/text
reservations. Let `B` be
`WEBCHESS_ACCOUNT_EXPORT_MAX_BYTES`: the effective row maximum cannot exceed
`max(1, floor(B / 5120))`, and the effective text maximum cannot exceed
`max(1, floor(B / 12))`. Unset defaults are clamped to those caps; explicit
Wilbur limits above them fail configuration validation.

These are admission limits, not destructive retention limits. Existing rows,
including a pre-`0013` account already over an envelope, remain preserved and
readable; exact existing pending claims can finish by substituting their reserved
capacity, and committed results remain replayable even if configuration is later
lowered below usage. WebChess never deletes or rewrites history to regain
capacity. A fresh status update still needs capacity for its ledger row and
event. The envelope bounds Wilbur's contribution to a synchronous export but
does not guarantee that an account with large games, model records, research,
or provenance will fit in one export.

Limits and expiring leases are enforced transactionally in Neon. The defaults
permit 200 model operations per UTC day and four concurrent model requests
across the deployment, while each user remains limited to one concurrent
request. A new division and a replay both consume the same daily game-start
allowance and hourly per-user/IP game-start limits. Replay idempotency,
source-state validation, field cloning, current-game activation, rate counts,
and the daily debit commit in one atomic database transaction; WebChess never
debits first and attempts to clone afterward. Move limits protect durable move
routes. Wilbur actions and observations have independent hourly user/IP limits;
each action created under the current contract is version-bound to the exact
Charlotte suggestion index, and the database permits no second current-bound
action for the same suggestion in one lifecycle run. Pre-`0012` rows remain
preserved, explicitly null-bound history, even when their legacy suggestion
indexes duplicate one another.

Every Wilbur create, update, and observation mutation is claimed durably by
owner plus idempotency key. An exact retry replays its stored committed result
or denial; changing the operation or request digest conflicts. Rate admission
is charged once, pending claims abandoned for 24 hours expire durably, and
future durable-row and exact-text capacity is reserved against the lifetime
envelope.
The artifact mutation, lifecycle revision/activity, and mutation-ledger result
commit atomically.

Account export format `webchess-account-export/4` has separate hourly user/IP
limits and defaults to a 3,000,000-byte maximum serialized response; configured
values must remain between 1 and 100,000,000 bytes. It includes owner-scoped
game, request, research, lifecycle, Portia, Gate, Charlotte, Wilbur, and
lifecycle-event records, including `charlotteBindingVersion` and sanitized
Wilbur mutation-ledger rows. Its ten recovery fields are the answer-prompt digest;
Portia's current candidate, active request, failure count, failure limit,
completed-candidate IDs, and assessment drafts; and Charlotte's active request,
failure count, and failure limit. It also includes the owner's user-rate windows
without their HMAC key. Mutation-ledger exports omit private capacity-
reservation fields, the raw owner identifier, IP identifiers, and HMAC
material. The export also excludes shared IP/global
counters, Clerk and vendor records, concurrency leases, deletion tombstones,
and database-restoration metadata. Exports are synchronous single-file
downloads with no pagination or background preparation. An oversized export is
refused, and the account owner is directed to `/support` for the GitHub
Discussions path; that bounded operator fallback does not promise a custom data
handoff or response time. The Wilbur envelope bounds only one contributor to
export size; it does not guarantee that every whole account fits this bounded
single response because games, model records, research, and provenance also
accumulate.

Model retries preserve one provider-call intent. Retrying the same idempotency
key recovers a committed result or reports the existing reserved/in-progress
request as pending; it does not start another provider call. A reservation that
expires before the provider starts becomes terminally failed and is refunded.
If the provider started but its lease expires before a definitive settlement,
the request becomes terminally `indeterminate`; it is never replayed
automatically, and a new user intent with a new idempotency key is required.
Provider responses rejected by WebChess retain only a sanitized provider
response ID, safe failure status, and normalized token usage when present—not
raw provider output, refusal text, or reasoning.

These transactions, event replay, idempotency records, leases, and persisted
model artifacts provide request and lifecycle recovery. They are not disaster
recovery. The repository provides no database backup schedule, point-in-time
recovery proof, restore command, account-import endpoint, recovery-point or
recovery-time objective, or completed restore drill. Configure and test vendor
backups separately; for local mode, preserve the PostgreSQL volume together
with its generated database and HMAC/session secrets.

Use WebChess's durable quotas as the primary cost controls. OpenAI
[spend alerts](https://developers.openai.com/api/docs/guides/spend-limits)
send notifications but do not stop traffic. An enabled OpenAI hard spend limit
is an external backstop, but enforcement is not instantaneous and recorded
spend can slightly exceed the configured amount.

## 5. Set the site origin

For local development:

```dotenv
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

The value must be an exact origin with no trailing slash. Use the exact preview
URL for preview and the approved custom origin for production.

On Vercel Preview, WebChess accepts an explicit `NEXT_PUBLIC_SITE_URL` or
derives the origin as `https://<VERCEL_URL>`. If a stable Vercel branch URL is
assigned to the reviewed branch, prefer setting that exact HTTPS origin
explicitly and open the preview through that URL. Otherwise, register the
deployment URL that Vercel reports with the Preview Clerk instance and redeploy
the same reviewed commit before inspection. Preview URLs do not require a
GoDaddy record.

On Vercel Production, `NEXT_PUBLIC_SITE_URL` is mandatory and must be exactly:

```dotenv
NEXT_PUBLIC_SITE_URL=https://webchess.anansiportia.com
```

The prebuild deployment preflight fails closed on Vercel when the project
identity, origin, Clerk routes, server credentials, release provenance, or HMAC
secrets are missing, conflicting, or malformed. Preview requires `pk_test_...`
and `sk_test_...`; Production requires `pk_live_...` and `sk_live_...`; both
require a `whsec_...` webhook signing secret. It then opens the runtime
`DATABASE_URL` in an explicitly read-only transaction and requires the exact
checked-in migration ledger, table-and-column catalog, critical partial
indexes, and schema/table privilege allowlist described in section 3. Missing,
edited, or unexpected migrations, tables, or columns, invalid indexes, or
missing or excess effective schema/table privileges stop the build. These
checks do not print project IDs, database URLs, role names, or secret values.
Local and ordinary CI builds remain offline and able to use stubbed services.

Configured deployments use Clerk's dynamic provider and nonce-bearing strict
Content Security Policy. The routing layer removes `unsafe-inline` from
`script-src` and restricts token authorized parties to the exact site origin.
The static policy with inline-script compatibility exists only for the
unconfigured offline/local test build.

## 6. Run locally

```bash
npm run dev
```

Open `http://localhost:3000`. Public pages should load without authentication.
`/play` must redirect a signed-out visitor to sign-in. After authentication, a
game should survive a reload because the field and append-only event log are
loaded from Neon.

## 7. Run the release gates

```bash
npm run lint
npm run typecheck
npm run plugin:build
git diff --exit-code -- openclaw-plugin/dist
npm run test
npm run test:coverage
DATABASE_URL='postgresql://...disposable-test-only...' npm run test:integration
npm audit --omit=dev --audit-level=high
npm audit --audit-level=high
npm run build
npm run test:a11y
npm run test:e2e
npm run test:links
npm pack --dry-run
```

The integration database must be a disposable PostgreSQL 17 database created
for the test run, never a local game database, Preview database, or Production
database. `plugin:build` must leave the committed `openclaw-plugin/dist` byte-
for-byte current, and the package dry run must contain the compiled entry and
all documented runtime files without local secrets or test output.

Do not create a preview until all gates pass. Automated tests and CI must use
deterministic OpenAI stubs and must never spend live model tokens. After those
gates pass, the owner's bounded manual Preview inspection may use the dedicated
Preview OpenAI key for one complete v2 game: one division call and, after a
real ending, one successful Portia review and one successful Charlotte review.
Either review has a persisted ceiling of three technical provider attempts; a
failed Gate may add only the bounded Retry work described in
[the operator guide](docs/WEBCHESS_2_0_OPERATIONS.md). Durable application
quotas remain enabled throughout.

## 8. Create the independent Vercel project

Create an empty Vercel project named exactly `webchess` in the separately
approved WebChess scope. Do not use the Git **Import and Deploy** flow: importing
the repository normally creates a deployment before the repository's release
gates can control it. Create or link the empty project through the Vercel
Projects API or `vercel link`, then configure it before any deployment.

Do not link this repository to `madnessbot-site` and do not reuse any
MadnessBot project, environment variables, domains, analytics, billing
configuration, or data stores. Repository `vercel.json` disables Vercel Git
deployments, so neither a branch push nor a `main` push may create a Preview or
Production deployment. Deployments are manual, exact-revision release actions
after the applicable gate.

Configure:

- Framework Preset: Next.js
- Node.js: 22.x
- Install Command: `npm ci`
- Build Command: `npm run build`

Enable Vercel's system environment variables so `VERCEL_PROJECT_ID`,
`VERCEL_ENV`, `VERCEL_URL`, and the Git commit metadata are available to the
deployment preflight and provenance checks. After linking the new independent
project, verify its name is exactly `webchess`, copy its project ID from Vercel
project settings or `.vercel/project.json`, and configure that exact value as
`WEBCHESS_EXPECTED_VERCEL_PROJECT_ID` for both Preview and Production. Do not
hardcode the ID in the repository and do not copy an ID from any MadnessBot
project.

Provision separate Preview resources first:

1. configure the dedicated WebChess Clerk Preview instance with Google, email,
   passkeys, **Allow users to delete their accounts**, the exact Preview
   origin, `pk_test_...` / `sk_test_...` credentials, and a Preview-only
   `whsec_...` webhook signing secret;
2. create a fresh Neon Preview database, external migration owner, and
   dedicated runtime role, but do not give Vercel a database URL yet;
3. use a project-scoped Preview OpenAI key only for the bounded manual smoke
   described above;
4. generate Preview-only general and deletion HMAC secrets;
5. set the quota, rate, lease, and export controls; and
6. configure Vercel Firewall/request throttling for `/api/*`, with a separate
   rule appropriate for the signed Clerk webhook.

Add those values only to the Preview environment without printing them in
logs. Keep every migration-owner credential out of Vercel.

Vercel normally supplies `VERCEL_GIT_COMMIT_SHA`. If the selected deployment
method does not, set `WEBCHESS_RELEASE_SHA` to the exact reviewed 40-character
commit so the source download cannot drift to another revision. If both
variables exist, they must be identical.

Only after the complete local and CI gates pass, run:

```bash
npm run release:verify-source
```

That command refuses every tracked or untracked workspace change, detached
`HEAD`, missing upstream, and local commit that differs from the live
configured remote branch. Record its exact 40-character commit, keep the
checkout unchanged, and use the section 3 guarded command from that exact
source to migrate the Preview database. Apply the reviewed runtime grants,
remove the owner credential, and run `npm run db:schema:check` through the
Preview runtime URL. Only after that passes, give Vercel the pooled runtime URL
and create a **preview** deployment from the verified source without `--prod`.

The prebuild command runs the environment/project preflight first, repeats the
read-only ledger, catalog, index, and effective-privilege check second, and only
then generates downloads and starts the Next.js build. A database outage or
schema/privilege mismatch intentionally blocks deployment. Record the
deployment ID, immutable commit SHA, and URL. Inspect authentication, durable
refresh recovery, quota failures, the complete play-and-answer flow, downloads,
mobile and desktop layouts, keyboard operation, reduced motion, accessibility,
response headers, and logs.

The repository's complete Playwright play fixture uses a loopback-only test
principal and deterministic route responses. That bypass is deliberately
disabled whenever Vercel markers are present. Run the automated suite before
deployment; on Preview, use the dedicated real Clerk test account for the
manual authenticated smoke. Never enable the loopback test principal on
Vercel.

The Preview Clerk smoke is a release gate, not a mocked unit test. Record
sanitized evidence for all of the following against the exact inspected
Preview URL:

1. start signed out, visit `/play`, and complete a real Google sign-in including
   its callback to the exact Preview origin; confirm `/play` and `/account`
   accept the resulting session;
2. create a second disposable user through the complete email verification
   flow and confirm an unverified attempt cannot create an authenticated
   WebChess session;
3. from `/account`, enroll a passkey, sign out, sign back in with that passkey,
   and reload both protected pages;
4. download the account JSON from `/account`; confirm the browser sends an
   origin-bearing `POST /api/account/export`, receives a private attachment,
   and does not expose another user's data;
5. with a fresh disposable account, request account deletion through
   `/account`; confirm WebChess data deletion succeeds, Clerk self-deletion
   succeeds, and Clerk's real `user.deleted` event reaches the Preview webhook
   with a valid signature and a 2xx response; then verify the raw Clerk ID and
   account content are gone, the deletion tombstone exists, and that identity
   cannot return with reset limits; and
6. inspect the response policy and logs: `script-src` has a nonce and
   `strict-dynamic` but no `unsafe-inline`, and no credential, token, callback
   parameter, private content, or raw Clerk identifier is logged.

A dashboard test button, a locally forged webhook request, or a mocked
verification function does not satisfy the deletion/webhook smoke. If any
dashboard method is missing, any callback changes origin, self-deletion returns
403, or the real signed webhook is not acknowledged and durably applied, stop
the release and fix the Clerk configuration before promotion.

Do not promote that deployment to production until the owner explicitly
approves the inspected preview.

## 9. Provision and promote Production only after approval

After the owner explicitly approves the inspected Preview, but before
Production promotion:

1. create the separate Neon Production database and dedicated runtime role;
   from the exact clean, published Preview commit, run the guarded migration,
   apply the reviewed runtime grants, remove the owner credential, and require
   the runtime schema check to pass before putting only its pooled URL in Vercel
   Production;
2. configure the Clerk Production instance for Google, email, passkeys, the
   **Allow users to delete their accounts** setting, the exact
   `https://webchess.anansiportia.com` origin, `pk_live_...` / `sk_live_...`
   credentials, custom Google OAuth credentials, and its Production-only
   `whsec_...` signed deletion webhook secret;
3. configure the Production OpenAI project key and its approved external spend
   controls without changing billing implicitly;
4. generate separate Production HMAC secrets and configure all Production
   quota, rate, concurrency, lease, export, and firewall controls available in
   the already approved plan; do not enable a paid add-on without separate
   approval;
5. set `NEXT_PUBLIC_SITE_URL=https://webchess.anansiportia.com` and the exact
   reviewed release SHA when Vercel does not supply it;
6. record the currently served Production deployment, if one exists, as the
   rollback target; and
7. inspect the selected Preview metadata again and confirm its commit SHA
   matches the reviewed published commit and that every applied migration
   remains compatible with that rollback target.

Promote that exact Preview deployment through Vercel. Current Vercel promotion
creates a new Production build from the same source using Production-scoped
environment variables; it does not reuse Preview secrets or its database.
Wait for the Production build to become ready, re-confirm the commit SHA, scan
its logs, and smoke-test its generated `vercel.app` URL before attaching the
custom hostname. That generated-URL check covers public pages, downloads,
headers, and runtime health only; the Production Clerk instance and canonical
origin are intentionally configured for `webchess.anansiportia.com`, so run
the complete authenticated flow only after that hostname is valid. Never run
`vercel --prod` from an uncommitted or unverified workspace.

If verification fails, do not touch DNS. Use Vercel rollback to restore the
recorded prior Production deployment. A first release with no prior
Production target remains offline until it passes.

Production promotion is an external mutation and still requires the owner's
separate explicit approval; this guide does not grant it.

## 10. Attach `webchess.anansiportia.com` after approval

The authoritative nameservers for `anansiportia.com` are currently GoDaddy's
`domaincontrol.com` nameservers. Keep GoDaddy authoritative and point the
`webchess` subdomain directly to Vercel. Do not move the zone to Cloudflare, do
not enable a Cloudflare proxy, and do not change nameservers. Another proxy
would change the trusted client-address boundary used by the durable IP abuse
controls.

The Content Security Policy permits `challenges.cloudflare.com` only because
Clerk may use that browser challenge service. That allowance does not put
Cloudflare in WebChess's DNS or request path.

After the approved Production build passes its generated-URL checks:

1. in Vercel, open **webchess project → Settings → Domains** and add
   `webchess.anansiportia.com`;
2. record the exact DNS Name, Type, and Value that Vercel shows. The subdomain
   normally uses a project-specific CNAME; domain ownership may also require a
   TXT whose Name is `_vercel...`, not `webchess`;
3. snapshot any existing `webchess` records and their TTLs before changing
   them;
4. in GoDaddy, open **Domain Portfolio → anansiportia.com → DNS**;
5. add or replace only the records Vercel requested. For the CNAME, GoDaddy's
   Name is `webchess`; copy Vercel's Value exactly, including a final period if
   Vercel displays one. For TXT verification, use the exact Name Vercel shows;
6. do not guess a generic Vercel target, add an AAAA record, change the apex,
   or alter mail or unrelated records;
7. verify the answers directly from GoDaddy's authoritative nameservers, then
   wait for Vercel to mark the domain valid and issue TLS; and
8. test HTTPS, redirects, Clerk Google/email/passkey callbacks, signed webhook
   delivery, downloads, durable refresh recovery, the authenticated game,
   security headers, and logs before advertising the address.

Vercel serves the application and manages TLS. GoDaddy remains the DNS host.
Preview deployments use their Vercel preview URLs and require no GoDaddy
change. If domain cutover must be reversed, restore only the saved `webchess`
records in GoDaddy and remove the failed hostname assignment in Vercel; leave
the rest of the zone unchanged.

## Stable downloads

The deployed application reserves:

- `/downloads/webchess-white-paper.md`
- `/downloads/webchess-white-paper.html`
- `/downloads/webchess-white-paper.pdf`
- `/downloads/webchess-installation.md`
- `/downloads/LICENSE`
- `/downloads/webchess-source.zip`

The source ZIP route must resolve to GitHub's immutable archive for the exact
commit reported by `npm run release:verify-source`, never an uncommitted
workspace. The verifier proves the commit is published on the configured
remote branch; the Vercel preflight binds the archive SHA to the deployed Git
SHA when both metadata variables are supplied.

## Troubleshooting

Use [GitHub Discussions](https://github.com/jr4488/webchess/discussions) for
non-sensitive setup help. Include the exact revision, Node/npm versions,
failing command, and redacted output. Never post `.env.local`, cookies, Clerk
tokens, database URLs, OpenAI keys, private questions, or personal data.
