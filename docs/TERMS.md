# WebChess terms of use

**Effective date:** August 1, 2026

These plain-language terms describe the intended production WebChess service.
Using a deployed WebChess service means agreeing to these terms and the
[Acceptable Use Policy](ACCEPTABLE_USE.md).

## What the service is

WebChess is an experimental reflection and problem-framing tool. It generates a
64-facet field and uses a circular-chess game to produce board-derived weights,
values, and terminal survivors. Those results become the concrete prompt for a
possible answer. Portia evaluates that exact prompt before generation, while an
internal deterministic Gate and bounded Retry policy decide whether it may
proceed. Only an approved prompt generates an Answer. Charlotte then qualifies
that exact generated answer and proposes reversible next actions. Wilbur
records what the user reports happened afterward, and Web retains the resulting
provenance.

WebChess is not divination, prediction, factual verification, professional
advice, an emergency service, or an autonomous decision maker. A capture,
attention weight, model statement, or winning side is not evidence that a claim
is true or that an action is safe.

## Eligibility and accounts

Users must be at least 18 and able to agree to these terms. Keep authentication
methods secure and do not share an account or attempt to use another person's
account. Users are responsible for activity performed through their account
until it is secured or deleted.

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

WebChess may enforce per-user and global quotas, rate limits, concurrency
limits, input bounds, and temporary or permanent suspensions. Users may not
evade controls by automating requests, creating duplicate accounts, sharing
accounts, or manipulating clients or network identities.

New divisions and replays are counted game starts and may share daily and
hourly limits. Account exports have independent user/IP limits and a maximum
response size. An oversized synchronous export is refused; WebChess does not
paginate it or prepare it later. The [support path](../SUPPORT.md) can help
troubleshoot general behavior but does not promise a custom data handoff or
response time. Retrying an already-recorded idempotent request does not create
a new operation. Portia may make a new fenced attempt after a failed or
indeterminate provider-started request, but the persisted three-attempt limit
prevents an unbounded automatic cycle.

Limits may change to protect availability, security, and cost. The interface
should disclose the limits that apply to an authenticated user.

## Availability and changes

The service may be changed, interrupted, limited, or discontinued. Games are
stored durably by design, but uninterrupted access, permanent retention, and
perfect recovery are not guaranteed. Preview deployments are test
environments, not production service commitments.

Deleting WebChess data may leave a suspended deletion-pending account marker
until Clerk confirms identity deletion. After that signed confirmation,
WebChess retains only an HMAC deletion marker needed to prevent quota-reset
recreation, subject to the privacy notice and applicable law.

## Open-source materials

Repository source and documentation are licensed under Apache-2.0. That license
governs copying and modification of the open-source materials. These terms
govern use of the hosted service and do not replace the Apache license.

## Enforcement

The project may reject content, limit requests, suspend access, or delete an
account to enforce these terms, the Acceptable Use Policy, law, security, or
service integrity. Security vulnerabilities must be reported through the
private flow in [SECURITY.md](../SECURITY.md).

## Disclaimer

To the extent permitted by applicable law, the service and model output are
provided as-is and as-available, without a promise that they are accurate,
complete, suitable for a particular purpose, uninterrupted, or error-free.

Nothing in these terms excludes rights or liabilities that applicable law does
not permit excluding.

## Changes and questions

Material changes will update the effective date and repository history.
Non-sensitive questions belong in
[GitHub Discussions](https://github.com/jr4488/webchess/discussions).
