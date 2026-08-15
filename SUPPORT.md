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
address, cookies, Clerk tokens, database URL, OpenAI key, environment file, or
other personal or confidential information.

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

In the intended hosted service, `/account` is the self-service path for
exporting WebChess data, deleting WebChess data, and deleting the Clerk account.
Authentication and passkey management are handled through Clerk's controls.
The signed local source runtime exposes export and sign-out but intentionally
withholds Clerk profile and deletion controls. The OpenClaw runtime has no
account API; its local database owner controls backup, export, and deletion.

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

If an export is refused or another self-service account control fails, use
[GitHub Discussions](https://github.com/jr4488/webchess/discussions) and
include only non-sensitive technical details. Do not identify the account or
post private data. Community support can help diagnose the general behavior,
but it does not promise a custom data handoff or response time. The project
does not currently publish a private support email.

## Scope

Community support cannot provide medical, legal, financial, safety, crisis, or
other professional advice. WebChess output is a candidate reflection, not a
professional recommendation or factual finding.
