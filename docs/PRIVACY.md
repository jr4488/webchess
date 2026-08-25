# WebChess privacy notice

**Effective date:** August 1, 2026

This notice distinguishes the supported local OpenClaw plugin from retained
historical source-checkout and intended hosted-service code. Those older
runtimes are not authentication or installation alternatives, and this notice
does not claim that a production hosted gameplay deployment is live.

## Local OpenClaw plugin

The plugin launches WebChess on `127.0.0.1` and keeps the question, generated
cast and per-facet cast applications, move history, trajectory-direction
record, lifecycle artifacts, actions, and observations in a dedicated
PostgreSQL 17 database on the same machine. WebChess does not create
a hosted account, upload that history to a WebChess-operated database,
synchronize it, or receive telemetry from the local app. Browser refreshes do
not delete the local game; database retention and deletion remain under the
local installation owner's control.

On the supported public path, model work uses the user's own OpenClaw
installation, an OpenAI model, and the selected OpenAI account/OAuth profile.
OpenClaw sends bounded prompts for cast-directed Division, Portia, the approved
Answer, and Charlotte to OpenAI under that account's terms and data controls.
The supported runtime never sends a pre-v2.5 case for legacy-answer recovery or
any other provider generation. After terminal play, WebChess
locally derives a deterministic record from the complete canonical event stream
(including ordered moves/passes/captures, piece identities, kinds and values,
promotions, survivors/routes, outcome, and all field cast applications).
Portia receives that record with the concrete candidate prompt assembled from
board weights, values, routes, captures, and survivor signals before an answer
exists; Answer and Charlotte receive its verified directional provenance.
OpenClaw resolves and applies the selected account/OAuth auth object inside the
plugin runtime.
WebChess never logs, persists, exports, returns, or places that credential in
the browser, loopback bridge payload, PostgreSQL records, or Next.js child
environment, and adds no WebChess-operated service to the path. Gate, Retry
policy, Wilbur records, and provenance are local deterministic or user-authored
operations.

The cast and trajectory record are required directional inputs in the method,
not factual evidence. They cannot override verified facts, safety constraints,
or consent. Current records and their digests remain inspectable in Portia,
Gate, Answer/Charlotte provenance, **What survived scrutiny**, and case export.
Preserved cases that predate the record are labeled
`legacy_pre_directional_generation`; WebChess does not infer or transmit a
replacement record for them. They are historical read-only evidence, not
supported gameplay, import/replay, Retry, Wilbur, or other mutation inputs.
Board-view preference is not durable case data: every current load/new
game/Retry/restore/import/replay starts in 2D, while a 3D opt-in is limited to
the active UI session.

This candidate supports that path only on Linux x86_64. Before inference or
search, the plugin attests the exact reviewed official Codex package/runtime and
native executable and revalidates the singleton OAuth binding. Other platforms,
modified runtime bytes, and changed auth stores fail closed.

Research search is a separate, case-scoped data flow and is off until the
player gives versioned consent. When enabled and the bounded materiality rule
triggers, the OpenClaw runtime sends the original question and a bounded query
to its configured Codex Search provider under the user's OpenClaw/provider
account. The public installation path pins the official
`@openclaw/codex@2026.7.1-1` provider plugin at npm integrity
`sha512-fRQITjqjC4Q/M6WmkR9XPWPuL+7vcvyVUWIDztB08X2G/mhzSwCYwQp4hugxAtuKmO3yx/7ULMK3nyeKsg5zGw==`,
selects provider `codex`, and uses an exact allowlist of the pinned OpenClaw
runtime's bundled `openai` model provider, the pinned `codex` search provider,
and packed `webchess`. WebChess includes the `openai` entry solely to activate
the bundled provider for the selected account/OAuth model; cached agent
model-catalog discovery remains disabled. This does not make any API-key
credential path supported by WebChess. It uses
the same selected OpenAI account/OAuth profile as model inference. The supported
path permits no WebChess-side, Codex, OpenAI, alternate-provider API-key,
API-token, service-account, or equivalent fallback. Relevant credential
environment variables, including `OPENAI_API_KEY` and `CODEX_API_KEY`, must be
empty or unset and the dedicated OpenClaw auth order must contain only the
selected OAuth profile; readiness fails closed otherwise. The installation gate
reports only offending variable names, never their values. The local broker may
then request at most three public HTTPS pages.
Those page hosts receive an ordinary request from the local machine. Redirects,
private or special-use addresses, credential-bearing URLs, oversized bodies,
unsupported media, and provenance inconsistencies fail closed.

Retained URLs, excerpts, timestamps, failures, and content digests become
case provenance and may be included in Portia, Answer, and Charlotte prompts.
Search synthesis and fetched page text remain untrusted evidence candidates;
filtering and provenance do not prove that a source or claim is true. Opting
out leaves the non-search lifecycle available and must not select another
hosted search service.

A consented Hosted Search may remain active for at most 300 seconds end to end.
This time headroom does not enlarge the one-query, result, source, page,
redirect, body, citation, injection, or consent bounds.

Each lifecycle model request has a 300-second authenticated local bridge
envelope for preflight, one provider turn, and postflight; the provider turn
itself remains capped at 150 seconds. Its per-request lease and each
single-generation route reserve 35 additional seconds—335 seconds total: up to
5 seconds to drain the loopback response after the authenticated envelope, then
30 seconds for durable settlement. Neither grace period permits more provider
work; Portia's multi-generation route remains separately bounded. Answer also
has a separate hard 300-second logical-operation
deadline across its initial and, only when structurally necessary, corrective
turn; a new bridge request does not extend it. Expiry or interruption settles
visibly, releases the Answer slot, and prevents a duplicate request for the same
durable intent rather than retaining stale `in_progress` state.

## Retired runtime privacy boundaries

Earlier candidates described a source-checkout launcher and a hosted gameplay
service. Those paths are historical and non-instructional in WebChess 2.2: the
`local:*` npm commands have been removed, the legacy launcher fails closed, and
server service selection rejects every non-OpenClaw principal before loading a
hosted adapter. A provider key/token, Clerk identity, or signed-machine session
cannot act as a fallback for model inference or research.

The remainder of this notice records privacy properties of retained hosted
identity and database code for audit purposes. The public deployment is a
brochure and source/paper navigator, not a hosted gameplay or model service.

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
- per-facet cast applications, the random seeds, and
  prompt/model/rules/engine/software provenance;
- the append-only move and forced-pass event log;
- derived captures and outcome;
- for current terminal games, the full replay-verifiable trajectory-direction
  record, its version/digest/explanation and downstream bindings; for older
  games, the explicit `legacy_pre_directional_generation` status;
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
cast- and trajectory-directed answer prompt, generate an approved Answer,
qualify that exact Answer and its direction through Charlotte, preserve
user-authored observations, prevent abuse, enforce quotas, account for model
cost, diagnose failures, support export and deletion, and protect the service.

WebChess does not sell game content or use it for advertising.

## Service providers

- **OpenClaw** runs the installed plugin locally, resolves the sole selected
  OpenAI account/OAuth profile, and transports bounded inference and official
  Codex Hosted Search requests. WebChess does not receive the auth object.
- **OpenAI** processes bounded inputs for Division, Portia, the approved Answer,
  Charlotte, and consented Codex Hosted Search under that account's controls.
  The deterministic Gate, Retry policy, Wilbur record, and local page fetcher do
  not make a model call.
- **Public source-page hosts** receive at most three guarded local retrieval
  requests when the player consents and research is material.
- **Vercel** may host the public brochure and processes its network/runtime data;
  it is not the supported gameplay, inference, research, identity, or database
  runtime.
- **GitHub** processes information a user voluntarily posts for support,
  issues, contributions, or security reporting.

Clerk and Neon appear in retained hosted-design code and historical data-model
text, but they are not providers in the supported WebChess 2.2 player path.
Each actual provider or contacted host handles data under its own terms and
configured account controls.

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
bundle's digests, event-log replay, terminal board, and recorded provenance. A
private full current-case bundle retains the exact trajectory-direction record
and downstream bindings so verification can re-derive it from canonical events;
a redacted profile identifies omitted detail instead of claiming it was
recomputed. The supported browser path rejects pre-v2.5 bundles. A retained
offline parser may label a preserved legacy bundle for historical read-only
inspection rather than fabricating a record; that result cannot make the case
playable, import it into PostgreSQL, authorize provider work, or enable replay
or mutation. Verification does not rerun provider calls or prove that a
direction, source, or answer is true. The UI action
**Start another game on this field** creates a new trajectory and is not replay
verification. A case bundle is not a PostgreSQL backup, an OpenAI
subject-access export, or a substitute for retaining a tested database dump.

Model/auth status and provider inventory alone are not live account proof. Once
per launcher process, before a game, the packed bridge requires the exact
prepared `openai/*` model to answer `Reply with exactly this ASCII token and
nothing else: WEBCHESS_READY` with exactly `WEBCHESS_READY`, then sends the
fixed query `OpenAI official website` through the official `codex` provider.
Neither bounded request contains user/case content, repeats during status
polling, triggers a WebChess direct-page fetch, or enters game/research rows or
a case export. Both reach OpenAI/the provider under the account's data policies
and consume account/network allowance. Launch fails closed unless both results
validate. A person who does not accept those readiness transmissions must not
launch; later case-scoped opt-out does not disable them.

A consented lifecycle search is a separate request and may still fail. The
packed bridge validates capability `web.search`, provider `codex`, local
transport, and an empty fallback-attempt array. Durable case research records
retain provider, transport, bounded attempt count, planned and executed query
data, evidence and provenance, and a visible failure/refusal status and code
when applicable. Any later guarded retrieval of up to three public HTTPS pages
is performed separately by local WebChess.

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
