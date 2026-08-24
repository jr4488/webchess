# Contributing to WebChess

WebChess welcomes code, documentation, accessibility work, reproducible
evaluations, and technically precise criticism.

## Before opening a change

- Read [the method](README.md), [architecture](docs/ARCHITECTURE.md), and
  [security boundaries](SECURITY.md).
- Search existing issues and
  [Discussions](https://github.com/jr4488/webchess/discussions).
- Use Discussions for support, design exploration, and research criticism.
- Use issues for a bounded, reproducible defect or an accepted task.
- Never include API keys, Clerk tokens, cookies, database credentials, private
  prompts, generated personal data, or environment files.

For a material design change, open a Discussion first and explain the problem,
the smallest proposed change, its security and cost implications, and how its
effect could be evaluated.

## Local setup

Follow the account-authenticated OpenClaw path in [INSTALL.md](INSTALL.md).
Install the reviewed packed plugin into a dedicated OpenClaw profile, use one
ordered OpenAI account/OAuth profile for both inference and official Codex
Hosted Search, and use a dedicated loopback PostgreSQL database. A WebChess,
Codex, OpenAI, or alternate-provider API key/token is not an accepted substitute.
Never point an unreviewed branch at production data or secrets.

## Verification

Run:

```bash
npm ci
npm run verify:openclaw
npm run lint
npm run typecheck
npm run plugin:build
npm run plugin:verify
npm run test
DATABASE_URL='postgresql://...disposable-test-only...' npm run test:coverage
DATABASE_URL='postgresql://...disposable-test-only...' npm run test:integration
npm audit --omit=dev --audit-level=high
npm audit --audit-level=high
npm run build
npm run test:a11y
npm run test:e2e
npm run test:links
```

`verify:openclaw` builds the source plugin entry and runs application, UI, and
browser checks; it does not install a packed archive or prove a live provider
round trip. `plugin:build` must leave the committed generated entry unchanged.
The separate integration command exercises a disposable PostgreSQL 17 database
used only to validate hosted and local durable lifecycle behavior. Never use a
local game, Preview, or Production database for that command.

Changes to circular movement, replay, ending precedence, model prompts,
structured schemas, authentication, ownership, quota accounting, rate limits,
or deletion must include focused positive and negative tests.

Engine changes require canonical perft, tactical, search, worker, deterministic
replay, and paired-color arena regression evidence. Arena results are
regression evidence, not an Elo estimate.

Interface changes require keyboard, screen-reader naming, WCAG AA contrast,
reduced-motion, mobile, and desktop checks.

## Pull requests

Keep each pull request focused. Include:

1. the user-visible outcome and rationale;
2. behavior before and after;
3. verification commands and results;
4. screenshots for interface changes;
5. security, privacy, accessibility, persistence, and model-cost implications;
6. migration and rollback notes when durable state changes; and
7. documentation updates when behavior changes.

Do not describe resonance, model output, or board events as evidence. Preserve
the distinction between generated salience and real-world evidence in copy,
code, and tests.

Do not deploy, promote production, attach a domain, enable billing, publish a
secret, or change repository visibility as part of a pull request unless that
external action is separately and explicitly approved.

By contributing, you agree that your contribution is licensed under
Apache-2.0.
