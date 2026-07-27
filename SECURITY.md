# Security policy

## Reporting a vulnerability

Do not report vulnerabilities in a public issue or Discussion. Use the repository's private **Security → Report a vulnerability** flow:

https://github.com/jr4488/webchess/security/advisories/new

Include the affected revision, environment, reproduction steps, impact, and any safe proof of concept. Remove credentials, private questions, and personal data.

## Credential boundary

WebChess credentials are secrets.

- Never put a provider key, access code, session secret, ChatGPT credential, or token in a `VITE_*` variable, browser bundle, commit, issue, Discussion, log, analytics payload, or screenshot.
- Direct OpenAI API credentials belong in server-side environment variables or a secret manager.
- `codex-chatgpt` and `ollama` are single-owner loopback modes and must not be exposed through a LAN listener or reverse proxy.
- Treat model prompts and generated text as potentially sensitive.
- `store: false` does not override organization, project, abuse-monitoring, retention, or data-sharing policies.

## Supported versions

Security fixes target the current `main` branch. Until tagged releases are published, older revisions are unsupported.

## Scope priorities

Reports involving credential disclosure, authentication or session bypass, cross-origin request abuse, provider-boundary escape, unsafe Codex execution, prompt/log leakage, or cost-control bypass receive priority.
