# Contributing to WebChess

WebChess welcomes code, documentation, accessibility work, reproducible evaluations, and technically precise criticism.

## Before opening a change

- Search existing issues and Discussions.
- Use Discussions for support, design exploration, and research criticism.
- Use issues for a bounded, reproducible defect or an accepted implementation task.
- Never include API keys, ChatGPT credentials, access codes, private prompts, or personal data.

For a material design change, open a Discussion first and explain the problem, the proposed change, and how its effect could be evaluated.

## Local verification

Install the locked dependencies and run the complete verification suite:

```bash
npm ci
npm run verify
npm audit --audit-level=high
```

Changes to the circular movement engine, division-quality checks, provider boundary, session controls, or final-prompt provenance require tests.

## Pull requests

Keep each pull request focused. Include:

1. the outcome and rationale;
2. the behavior before and after;
3. verification commands and results;
4. screenshots for interface changes;
5. security, privacy, accessibility, and model-cost implications;
6. documentation updates when behavior changes.

Do not present resonance, model output, or board events as evidence. Preserve the distinction between generated salience and real-world evidence in user-facing language and tests.

By contributing, you agree that your contribution is licensed under Apache-2.0.
