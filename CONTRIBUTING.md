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

Follow [INSTALL.md](INSTALL.md). Use development Clerk, Neon, and stub OpenAI
resources; never point an unreviewed branch at production data or secrets.

## Verification

Run:

```bash
npm ci
npm run verify:openclaw
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run test:integration
npm audit --omit=dev --audit-level=high
npm audit --audit-level=high
npm run build
npm run test:a11y
npm run test:e2e
npm run test:links
```

`verify:openclaw` is the source, plugin, UI, and browser gate for the local
runtime. The separate integration command exercises the disposable PostgreSQL
database used to validate both hosted and local durable lifecycle behavior.

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
