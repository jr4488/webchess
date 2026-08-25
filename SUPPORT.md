# WebChess support

## Questions and installation help

Use [GitHub Discussions](https://github.com/jr4488/webchess/discussions) for:

- installation and local-development questions;
- help understanding the circular rules or method;
- accessibility feedback;
- design proposals;
- research criticism; and
- questions about published documentation.

Before posting, search existing Discussions and include:

- the exact commit or release;
- operating system, Node.js version, and browser;
- the route or command involved;
- expected and observed behavior; and
- minimal, redacted logs or screenshots.

Do not post your question from the game, generated facets, answers, email
address, cookies, OAuth artifacts, database URL, provider credentials,
environment file, or other personal or confidential information.

## Reproducible bugs

Use [GitHub Issues](https://github.com/jr4488/webchess/issues) for a bounded
defect with reproducible steps. Use Discussions first if the scope is unclear
or the request is a product proposal.

## Security vulnerabilities

Security vulnerabilities must go only through
[GitHub's private vulnerability-reporting flow](https://github.com/jr4488/webchess/security/advisories/new).
Do not use that channel for general support, conduct complaints, account help,
or feature requests.

## Account and privacy actions

The sole supported runnable candidate is the packed local OpenClaw path. It has
no WebChess account API: the local database owner controls PostgreSQL backup,
lifecycle case export, and deletion, while OpenClaw manages the separate OpenAI
account/OAuth profile. The former hosted `/account` path (including Clerk
profile and deletion controls) and the signed local source runtime are retained
only as retired audit/reference implementations; they are not supported
authentication, storage, or privacy-control alternatives.

Account export format `webchess-account-export/4` is generated synchronously as
one JSON file and is limited to 3,000,000 bytes by default. It includes the
owner's application records, lifecycle recovery fields,
`charlotteBindingVersion`, sanitized Wilbur mutation-ledger rows, and
pseudonymous user-rate windows. It omits private mutation capacity reservations,
owner/IP identifiers, HMAC material, shared IP/global counters, Clerk/vendor
data, and database-restoration metadata. WebChess does not paginate the export
or prepare it later in the background. An oversized export is refused rather
than partially returned. Wilbur's admission envelope preserves existing history
and does not guarantee whole-account exportability because other account content
also accumulates.

If a supported local export fails, or a retained account-export contract is
being studied and refuses a request, use
[GitHub Discussions](https://github.com/jr4488/webchess/discussions) and
include only non-sensitive technical details. Do not identify the account or
post private data. Community support can help diagnose the general behavior,
but it does not promise a custom data handoff or response time. The project
does not currently publish a private support email.

## Scope

Community support cannot provide medical, legal, financial, safety, crisis, or
other professional advice. WebChess output is a candidate reflection, not a
professional recommendation or factual finding.
