# WebChess terms of use

**Effective date:** August 1, 2026

These plain-language terms describe the supported WebChess research candidate:
the packed, loopback-only local OpenClaw path. They do not describe a live
hosted WebChess service. By running or using the candidate, the local operator
and user accept these terms and the [Acceptable Use Policy](ACCEPTABLE_USE.md).
Archived source-checkout, Clerk, and key-backed hosted descriptions are retired
snapshot evidence, not supported installation or authentication alternatives.

## What the service is

WebChess is an experimental reflection and problem-framing tool. A cast-directed
Division maps 64 facets to the board before play. After the circular-chess game
ends, a deterministic, versioned directional record binds the complete legal
trajectory: move order, passes, captures, piece identities and values,
survivors, routes, and terminal outcome. That record must materially direct the
Portia criteria and amendments, Gate input, approved Answer prompt, and
Charlotte qualification, and its digest remains visible in provenance and
case export. The deterministic Gate and bounded Retry policy decide whether the
reviewed prompt may proceed. Only an approved prompt generates an Answer.
Charlotte then proposes reversible next actions, Wilbur records what the user
reports happened afterward, and Web retains the resulting provenance. Each
current action is version-bound to one of Charlotte's exact three stored
suggestions. Pre-`0012` and other pre-v2.5 rows may remain preserved as
null-bound historical records. They are not supported gameplay, provider-
generation, browser import/replay, Retry, Wilbur, or mutation paths; a user must
start a new lifecycle-v2.5 game.

WebChess is not divination, prediction, factual verification, professional
advice, an emergency service, or an autonomous decision maker. The cast and
trajectory record are required directional inputs, not external factual
evidence. They cannot override verified facts, consent, safety constraints, or
Gate. A capture, directional weight, model statement, or winning side is not
evidence that a claim is true or that an action is safe.

## Eligibility and accounts

Users must be at least 18 and able to agree to these terms. WebChess does not
create or manage a WebChess account on the supported path. OpenClaw uses the
user's existing OpenAI account/OAuth profile; keep that profile and the local
machine secure, do not use another person's account, and follow the applicable
OpenAI and OpenClaw terms. WebChess must not receive a provider API key or
alternate credential route.

## User content

Users retain their rights in questions and other material they submit. They
permit WebChess and its service providers to process that material only as
needed to operate, secure, troubleshoot, and export the requested service.

Do not submit material the user lacks permission to process. Do not submit
secrets, confidential business information, regulated data, children's data,
or third-party personal information.

## Model output and decisions

AI output can be incomplete, incorrect, biased, inconsistent, or unsafe. A
Portia assessment, Gate pass, generated Answer, or Charlotte qualification is
not factual verification. A Wilbur observation is user-supplied and is not
independently verified. Users must independently verify factual claims and use
qualified professionals for medical, legal, financial, safety, employment,
education, housing, insurance, credit, or other consequential decisions.

Portia saves completed per-signal checks so technical recovery can resume, but
it does not run without limit. After three failed provider-started attempts,
the inquiry ends at `portia_unavailable`; no prompt is approved and no Answer
or Charlotte qualification is generated. This technical stop is distinct from
the Gate's semantic `insufficient_basis` result.

Users remain responsible for decisions and actions. WebChess should be used to
generate questions and tests, not to bypass evidence, consent, law, policy, or
professional obligations.

## Usage limits

WebChess enforces bounded inputs, operation deadlines, persisted retry budgets,
and local concurrency controls. Users may not evade those controls or use the
candidate to automate abusive requests. OpenAI account allowances, model
availability, and provider billing rules remain the user's responsibility; a
retry can consume another allowed model or Hosted Search operation even though
WebChess uses no API key.

Retrying an unresolved idempotent request does not create a second provider
operation. After a durable retryable failure, a visible user retry creates one
new fenced request. Portia has a persisted three-attempt technical limit; Gate
has at most two same-field games and one regenerated field. Answer and Hosted
Search each have a five-minute aggregate operation window. These bounds prevent
unbounded automatic cycles and do not promise that an allowed provider call
will complete.

## Availability and changes

The candidate may be changed, interrupted, limited, or discontinued. Games are
stored in the operator's loopback-only PostgreSQL database by design, but
uninterrupted access, permanent retention, and perfect recovery are not
guaranteed.

Event replay and persisted request/lifecycle state can recover some interrupted
operations. They are not a disaster-recovery guarantee. The local operator is
responsible for PostgreSQL backups, restore testing, retention, and teardown.
Deleting the local database removes WebChess application records but does not
delete or alter the separate OpenAI/OpenClaw account or OAuth profile.

## Open-source materials

Repository source and documentation are licensed under Apache-2.0. That license
governs copying and modification of the open-source materials. These terms
govern use of the runnable research candidate and do not replace the Apache
license or third-party provider terms.

## Enforcement

The local software may reject content or requests that violate its bounds,
security controls, or the Acceptable Use Policy. It does not suspend or delete
a WebChess account because no such account exists on the supported path.
Security vulnerabilities must be reported through the private flow in
[SECURITY.md](../SECURITY.md).

## Disclaimer

To the extent permitted by applicable law, the candidate and model output are
provided as-is and as-available, without a promise that they are accurate,
complete, suitable for a particular purpose, uninterrupted, or error-free.

Nothing in these terms excludes rights or liabilities that applicable law does
not permit excluding.

## Changes and questions

Material changes will update the effective date and repository history.
Non-sensitive questions belong in
[GitHub Discussions](https://github.com/jr4488/webchess/discussions).
