# WebChess privacy notice

**Effective date:** August 1, 2026

This notice distinguishes the local OpenClaw plugin from the intended hosted
WebChess service. It does not claim that a production hosted deployment is
currently live.

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
rate-limit counters, suspensions, and timestamps. For provider responses that
WebChess rejects, it does not retain raw output, refusal text, or reasoning.
Client addresses may be processed transiently to enforce abuse controls;
stored rate-limit identifiers are purpose-separated HMAC digests, not raw IP
addresses.

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
tombstones remain. Limited security, abuse, billing, or legal records may
otherwise be retained when reasonably necessary. Vendor backups may persist
for their configured backup-retention period before aging out.

WebChess does not promise a retention period that the deployed vendor
configuration cannot enforce. The production operator must publish any
material retention change before it takes effect.

## Export, correction, and deletion

The deployed `/account` page is the self-service path to:

- export the user's WebChess data;
- delete WebChess data; and
- delete the account.

Exports are subject to separate per-user and pseudonymous-IP hourly limits and
a configurable serialized-response ceiling that defaults to 3,000,000 bytes.
Each export is generated synchronously as one JSON file; WebChess does not
paginate it or prepare it later in the background. The download is requested
with an authenticated, same-origin POST so generating the rate-counted export
cannot be triggered by a cross-origin link. An oversized export is refused
rather than partially returned. If that happens, follow
[SUPPORT.md](../SUPPORT.md) to ask for non-sensitive assistance through GitHub
Discussions. Support does not promise a custom data handoff or response time.

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
