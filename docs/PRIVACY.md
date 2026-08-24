# WebChess privacy notice

**Effective date:** August 1, 2026

This notice distinguishes the local OpenClaw plugin, the loopback source-
checkout runtime, and the intended hosted WebChess service. It does not claim
that a production hosted deployment is currently live.

## Local OpenClaw plugin

The plugin launches WebChess on `127.0.0.1` and keeps the question, generated
cast, move history, lifecycle artifacts, actions, and observations in a
dedicated PostgreSQL 17 database on the same machine. WebChess does not create
a hosted account, upload that history to a WebChess-operated database,
synchronize it, or receive telemetry from the local app. Browser refreshes do
not delete the local game; database retention and deletion remain under the
local installation owner's control.

Model work uses the user's own OpenClaw installation, configured default model,
and existing provider authentication. The provider may be remote. In that case,
OpenClaw sends bounded prompts for Division, Portia, the approved board-derived
Answer, Charlotte, and legacy-v1 answer recovery where applicable, according to
that provider's terms and data controls.
Portia receives the concrete candidate prompt assembled from board weights,
values, routes, captures, and survivor signals before an answer exists;
Charlotte receives the exact generated answer afterward. The plugin does not
receive or proxy the credential and does not add a WebChess-operated service to
that path. Gate, Retry policy, Wilbur records, and provenance are local
deterministic or user-authored operations.

Research search is a separate, case-scoped data flow and is off until the
player gives versioned consent. When enabled and the bounded materiality rule
triggers, the OpenClaw runtime sends the original question and a bounded query
to its configured Codex Search provider under the user's OpenClaw/provider
account. The local broker may then request at most three public HTTPS pages.
Those page hosts receive an ordinary request from the local machine. Redirects,
private or special-use addresses, credential-bearing URLs, oversized bodies,
unsupported media, and provenance inconsistencies fail closed.

Retained URLs, excerpts, timestamps, failures, and content digests become
case provenance and may be included in Portia, Answer, and Charlotte prompts.
Search synthesis and fetched page text remain untrusted evidence candidates;
filtering and provenance do not prove that a source or claim is true. Opting
out leaves the non-search lifecycle available and must not select another
hosted search service.

## Local source-checkout runtime

`npm run local:dev` keeps application data in a dedicated Docker PostgreSQL 17
database on loopback and sends model work through the operator's server-side
OpenAI Platform key. It does not launch OpenClaw and does not use Codex Search.
With neither Clerk key it uses one signed machine principal; with a complete
Clerk development pair, Clerk handles identity. Those owners are separate and
their records are not merged. Preserve the generated
`WEBCHESS_LOCAL_SESSION_SECRET` with the database, because losing it makes the
prior signed owner's rows inaccessible. There is no WebChess cloud sync or
backup for this runtime.

The remainder of this notice describes the separate hosted-service
architecture.

## What WebChess processes

### Account data

Clerk processes authentication and provides WebChess with an account identifier
and the profile data the user chooses to make available through the selected
Google, email, or passkey sign-in method. WebChess does not receive or store a
Google password, email password, passkey private key, or ChatGPT credential.

During self-service deletion, WebChess temporarily retains the raw Clerk
account identifier only in a suspended deletion-pending control record until
Clerk confirms identity deletion. Forced cleanup from Clerk's signed webhook
removes that raw identifier and retains only a purpose-separated HMAC deletion
marker. The deployed Clerk instance must enable **Allow users to delete their
accounts**; if Clerk identity deletion fails, WebChess keeps the account
suspended and offers a retry rather than describing deletion as complete.

### Game content

WebChess stores:

- the question submitted for a game;
- the 64 generated facets and composed facet–lens field;
- the random seed and prompt/model/rules/engine/software provenance;
- the append-only move and forced-pass event log;
- derived captures and outcome;
- terminal survivors, the reviewed answer-prompt digest, resumable per-signal
  Portia assessments, technical-attempt counters, final Portia reviews,
  deterministic Gate decisions, semantic retry ancestry, generated answers and
  their approval provenance, Charlotte qualifications, Wilbur actions and
  append-only observations, lifecycle events, and their version provenance;
- legacy v1 answers and timestamps; and
- replay relationships and the current-game marker.

Questions, facets, lifecycle artifacts, observations, and answers may contain
personal or sensitive information.
Do not submit confidential, regulated, safety-critical, or third-party personal
data.

### Operations and abuse prevention

WebChess stores model-request status, sanitized provider response identifiers,
normalized bounded token counts, quota use, replay-start idempotency records,
rate-limit counters, suspensions, and timestamps. It also stores durable Wilbur
mutation claims: the owner/key operation and request digest, rate-admission and
denial state, private capacity reservations, result references, and timestamps.
An abandoned pending claim expires after 24 hours; committed and denied claims
remain exact-replay authorities while the account exists. For provider responses
that WebChess rejects, it does not retain raw output, refusal text, or reasoning.
Client addresses may be processed transiently to enforce abuse controls; stored
rate-limit identifiers are purpose-separated HMAC digests, not raw IP addresses.

Application logs must exclude prompts, answers, secrets, authentication
artifacts, database URLs, and raw request bodies.

## Why the data is used

Data is used to authenticate the user, preserve games across refreshes, replay
and validate moves, produce the requested division, assemble and validate the
board-derived answer prompt, generate an approved Answer, qualify that exact
Answer through Charlotte, preserve user-authored observations, prevent abuse,
enforce quotas, account for model cost, diagnose failures, support export and
deletion, and protect the service.

WebChess does not sell game content or use it for advertising.

## Service providers

- **Clerk** processes authentication and account controls.
- **Neon** stores durable application data.
- **OpenAI** processes bounded inputs for Division, Portia, the approved Answer,
  and Charlotte. The deterministic Gate, Retry policy, and Wilbur record do not
  call a model. Calls use `store: false`; OpenAI's organization, project, abuse-
  monitoring, retention, and data-sharing policies still apply.
- **Vercel** hosts the application and processes network and runtime data.
- **Google** participates only if the user chooses Google sign-in.
- **GitHub** processes information a user voluntarily posts for support,
  issues, contributions, or security reporting.

Each provider handles data under its own terms and configured account controls.

## Retention

Game and account-linked operational data are retained while the WebChess
account remains active so games can survive refresh and be replayed. Short-
window rate buckets and expired leases are eligible for routine deletion.

An account deletion request removes active WebChess content and detailed
account-linked application records. Until Clerk confirms identity deletion,
WebChess retains a minimal suspended `user_controls` record containing the
Clerk ID so the still-valid identity cannot return with reset quotas or bypass
an abuse control. Self-service deletion cancels unstarted reservations but
waits for genuinely in-progress provider work. Clerk's signed `user.deleted`
webhook installs the deletion barrier first and then performs forced cleanup
even when provider work is active, deletes raw identifiers and remaining
content, and retains only a lifetime-stable HMAC marker in
`deleted_user_tombstones`. Because the raw ID is
then unavailable, the deletion HMAC secret cannot be rotated while those
tombstones remain. The tested deletion order includes games with Portia and
Charlotte artifact rows. Limited security, abuse, billing, or legal records may
otherwise be retained when reasonably necessary. Vendor backups may persist
for their configured backup-retention period before aging out.

WebChess does not promise a retention period that the deployed vendor
configuration cannot enforce. The production operator must publish any
material retention change before it takes effect.

## Export, verification, correction, and deletion

The local plugin exposes **Export case** and **Import & verify case** for a
redaction-aware `webchess-case-bundle/1` artifact. Verification checks the
bundle's digests, event-log replay, terminal board, and recorded provenance;
it does not rerun provider calls or prove that the answer is true. The UI action
**Start another game on this field** creates a new trajectory and is not replay
verification. A case bundle is not a PostgreSQL backup, an OpenAI
subject-access export, or a substitute for retaining a tested database dump.

The local OpenClaw model/auth status check is not a Codex Hosted Search probe.
There is no separate no-data search probe in the reviewed path. Only a
case-consented, material search attempt can establish search behavior, and its
durable record must preserve the hosted search activity or visible
failure/refusal. Any subsequent guarded retrieval of up to three public HTTPS
pages is performed separately by local WebChess.

The deployed `/account` page is the self-service path to:

- export the user's WebChess data;
- delete WebChess data; and
- delete the account.

Export format `webchess-account-export/4` is subject to separate per-user and
pseudonymous-IP hourly limits and a configurable serialized-response ceiling
that defaults to 3,000,000 bytes. It includes owner-scoped application records,
all ten lifecycle recovery fields, `charlotteBindingVersion`, sanitized Wilbur
mutation-ledger rows, and the owner's pseudonymous user-rate windows without the
HMAC key. It omits the ledger's private capacity-reservation fields, owner/IP
identifiers, and HMAC material, and excludes shared IP/global counters, Clerk and
vendor data, deletion tombstones, concurrency leases, and database-restore
metadata. Each export is generated synchronously as one JSON file; WebChess does
not paginate it or prepare it later in the background. The download is requested
with an authenticated, same-origin POST so generating the rate-counted export
cannot be triggered by a cross-origin link. An oversized export is refused
rather than partially returned. If that happens, follow
[SUPPORT.md](../SUPPORT.md) to ask for non-sensitive assistance through GitHub
Discussions. Support does not promise a custom data handoff or response time.
The Wilbur row/text admission envelope preserves existing history while bounding
future Wilbur growth, but it does not guarantee whole-account exportability
because games, model records, research, and provenance also accumulate.

Event replay, request ledgers, leases, and persisted lifecycle artifacts provide
transactional recovery, not disaster recovery. WebChess does not publish an
account-import route, backup schedule, restore command, point-in-time recovery
proof, recovery objective, or completed restore drill. Vendor backup retention
and restore behavior remain subject to the configured provider service; local
operators must separately preserve and test their database volume and secrets.

Clerk handles authentication-method and profile controls. A signed Clerk
`user.deleted` webhook performs durable application cleanup.

The project does not publish a private support email. If other self-service
controls fail, follow [SUPPORT.md](../SUPPORT.md) and post only non-sensitive
technical details.

## Children

WebChess is intended for adults and is not directed to children under 18. Do
not create an account or submit a child's personal information for use in the
service.

## Security and limits

WebChess uses authenticated server routes, owner-scoped database access,
canonical replay, bounded structured model calls, encryption supplied by its
service providers, durable quotas, and pseudonymous rate identifiers. No
Internet service can guarantee absolute security.

See [SECURITY.md](../SECURITY.md) for technical boundaries.

## Changes

Material changes will update the effective date and repository history. Use
[GitHub Discussions](https://github.com/jr4488/webchess/discussions) for
non-sensitive questions about this notice.
