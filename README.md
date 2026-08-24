# WebChess

WebChess is the reference software instrument for **The Arachne Method**, an
experimental architecture for slowing down a difficult question before acting.
It constructs a 64-facet field, plays a complete circular-chess trajectory,
attacks what survives, permits a deterministic Gate to refuse, qualifies any
answer, and records human-owned action and observation.

**Research boundary:** the software and its contracts can be inspected and
tested. The method's efficacy has not been established. A board event creates
salience, not evidence, and WebChess is not a validated safety, medical, legal,
financial, or emergency-decision system.

## Candidate and publication status

This tree is being prepared as **WebChess `2.2.0-rc.1`**. It is not a published
release, deployed-service claim, DOI claim, or evidence that a credentialed
OpenAI lifecycle has passed. Publication is blocked until the release identity
generator is given the exact code-freeze commit and artifact digests and the
public site and paper expose that same immutable mapping.

Do not substitute `main`, `main.zip`, a short SHA, or an unverified mirror for
the source named by the paper. If the public identity manifest or exact GitHub
commit is unavailable, the reader-to-source path is incomplete and should fail
closed.

The latest verified released baseline before this candidate is `v2.1.0` at
`9980328581ba3e6fed6f2c4fc99b555fec4773bc`. The historical V3 manuscript in
this tree records the prior local `2.2.0` audit; it is preserved as audit
evidence and is not silently relabeled as the still-unfrozen paper edition 3.1.

## Names that are easy to confuse

| Name | Meaning |
| --- | --- |
| **The Arachne Method** | The whole research method: Division, field construction, chess, Portia, Gate/Retry, Answer, Charlotte, Wilbur, and the Web. |
| **WebChess** | The software and research instrument that implements and records the method. |
| **ANANSI** | The Anansi/Division field-construction mnemonic inside WebChess. It is not the name of the whole lifecycle. |
| **Anansi** | The model-mediated stage that proposes the 64 problem facets. |
| **The Web** | The within-case provenance and feedback record. It is not proof that an outcome is true. |

The project tagline is **Deliberation before decision.** The operational rule
is plainer: explore widely, challenge what remains, act reversibly, and do not
mistake salience for evidence.

## What one complete lifecycle does

1. **Anansi / Division** produces exactly 64 bounded, schema-valid facets for
   the question. Structural validation cannot prove relevance or completeness.
2. **Field construction** independently and deterministically permutes facets,
   I Ching-inspired change lenses, and board locations from recorded seeds.
3. **Chess** plays the cylindrical 8-by-8 variant to a terminal state. Kings
   are captured directly; sectors wrap; rings do not; passes and bounded draw
   rules are part of the variant.
4. **Research, when explicitly enabled**, runs one bounded search and guarded
   direct-page evidence collection before Portia. Failure is visible and the
   source provenance is retained.
5. **Portia** applies all 13 attack types to every surviving signal and then
   produces a cross-signal summary before an Answer is allowed.
6. **Gate and Retry** use deterministic rules to pass, refuse, start another
   game on the same field, or construct one fresh field. Retry is bounded.
7. **Answer** receives the exact prompt Portia reviewed and Gate approved.
8. **Charlotte** qualifies that stored answer and proposes exactly three
   reversible actions without silently replacing it.
9. **Wilbur and the Web** let the person own an action, record observation, and
   preserve the case genealogy for export and later verification.

See [Architecture](docs/ARCHITECTURE.md) for the implementation boundaries and
[The First Answer Is Not Enough](docs/WEBCHESS_WHITE_PAPER_V3.md) for the
historical V3 manuscript and falsifiable research program.

## Reproducible local path: OpenClaw plus OpenAI account authentication

The recommended researcher path is a packed WebChess plugin running on
loopback through **OpenClaw `2026.7.1-2`** and a dedicated PostgreSQL 17
database. OpenClaw authenticates directly with the researcher's ChatGPT/Codex
account. WebChess neither asks for nor receives an `OPENAI_API_KEY` on this
path.

The exact environment used for this candidate's final gate is intended to be:

- Node.js `24.19.0`;
- npm `11.14.1`;
- OpenClaw `2026.7.1-2` (source commit
  `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`);
- PostgreSQL `17.10` from the pinned `postgres:17-alpine` image digest in the
  repository;
- Google Chrome `150.0.7871.128` for the connected interactive acceptance
  pass; and
- WebGL 2 for the optional 3D board. The accessible 2D board must remain
  available when WebGL is absent or motion is reduced.

These are reproducibility pins, not claims that all newer versions are broken.
Node 24 is the recommended line in the pinned OpenClaw documentation.

Before downloading anything, use the full prerequisite gate in
[Installation](INSTALL.md#0-prerequisites). It checks the exact Node, npm, and
Chrome versions plus Git, curl, SHA-256 tooling, and a reachable Docker daemon.

### 1. Verify the public identity before cloning

At publication, the paper and public site must both expose
`/downloads/webchess-release-identity.json`. Its `source.commit` must be a full
40-character SHA, its status must be resolved, and the GitHub link must name
that SHA. If any of those conditions is missing, stop: this candidate has not
completed publication.

```bash
set -euo pipefail
export WEBCHESS_IDENTITY_URL='https://webchess.anansiportia.com/downloads/webchess-release-identity.json'
curl --fail --location --output webchess-release-identity.json "$WEBCHESS_IDENTITY_URL"
node -e 'const m=require("./webchess-release-identity.json"); if(m.schema!=="webchess-release-identity/1"||m.status!=="resolved") process.exit(1)'
export WEBCHESS_RELEASE_SHA="$(node -e 'const m=require("./webchess-release-identity.json"); process.stdout.write(m.source.commit ?? "")')"
test "${#WEBCHESS_RELEASE_SHA}" -eq 40
```

Verify the bytes published beside the manifest as well as the Git object:

```bash
export WEBCHESS_SOURCE_ARCHIVE_URL="$(node -e 'const m=require("./webchess-release-identity.json"); process.stdout.write(new URL(m.source.archive.downloadPath, process.env.WEBCHESS_IDENTITY_URL).href)')"
export WEBCHESS_SOURCE_ARCHIVE_SHA256="$(node -e 'const m=require("./webchess-release-identity.json"); process.stdout.write(m.source.archive.sha256)')"
curl --fail --location --output webchess-source.zip "$WEBCHESS_SOURCE_ARCHIVE_URL"
printf '%s  %s\n' "$WEBCHESS_SOURCE_ARCHIVE_SHA256" webchess-source.zip | sha256sum --check
export WEBCHESS_PAPER_URL="$(node -e 'const m=require("./webchess-release-identity.json"); process.stdout.write(new URL(m.paper.candidate.pdf.downloadPath, process.env.WEBCHESS_IDENTITY_URL).href)')"
export WEBCHESS_PAPER_SHA256="$(node -e 'const m=require("./webchess-release-identity.json"); process.stdout.write(m.paper.candidate.pdf.sha256)')"
curl --fail --location --output webchess-paper-3.1.pdf "$WEBCHESS_PAPER_URL"
printf '%s  %s\n' "$WEBCHESS_PAPER_SHA256" webchess-paper-3.1.pdf | sha256sum --check
```

Then clone and detach at the exact verified Git object:

```bash
git clone https://github.com/jr4488/webchess.git
cd webchess
git checkout --detach "$WEBCHESS_RELEASE_SHA"
test "$(git rev-parse HEAD)" = "$WEBCHESS_RELEASE_SHA"
```

An authentication error or 404 from GitHub is a publication blocker. Do not
work around it by checking out `main` or downloading a mutable archive.

### 2. Install and authenticate pinned OpenClaw

Install the exact reviewed OpenClaw package into a dedicated tool directory,
then use a dedicated OpenClaw profile so this walkthrough does not overwrite a
reader's existing default model, plugins, auth order, or daemon:

```bash
set -euo pipefail
node --version
npm --version
test "$(node --version)" = 'v24.19.0'
test "$(npm --version)" = '11.14.1'
export WEBCHESS_OPENCLAW_RUNTIME="$(pwd)/../webchess-openclaw-2026.7.1-2"
export WEBCHESS_OPENCLAW_PROFILE='webchess-rc1'
test ! -e "$WEBCHESS_OPENCLAW_RUNTIME" || {
  echo "$WEBCHESS_OPENCLAW_RUNTIME already exists; inspect it or choose a new path." >&2
  exit 1
}
test "$(npm view openclaw@2026.7.1-2 dist.integrity)" = \
  'sha512-ycF3yPcbjN6bUPeaUx6Mh6vze1hQWoD3CT/wWcmD7a8xaHHHRUaAlaq+lFxMHf1ssEgODVAwjlzYqp2twkYZ7g=='
mkdir "$WEBCHESS_OPENCLAW_RUNTIME"
npm install --prefix "$WEBCHESS_OPENCLAW_RUNTIME" --save-exact openclaw@2026.7.1-2
export PATH="$WEBCHESS_OPENCLAW_RUNTIME/node_modules/.bin:$PATH"
test "$(command -v openclaw)" = "$WEBCHESS_OPENCLAW_RUNTIME/node_modules/.bin/openclaw"
openclaw --version | grep -Eq '^OpenClaw 2026\.7\.1-2 \('
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models auth login --provider openai
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" config set agents.defaults.model.primary openai/gpt-5.6-sol
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" config validate
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" doctor
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models auth list --provider openai
read -r -p 'Eligible OpenAI OAuth profile ID: ' WEBCHESS_OPENAI_PROFILE_ID
test -n "$WEBCHESS_OPENAI_PROFILE_ID"
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models auth order set --provider openai "$WEBCHESS_OPENAI_PROFILE_ID"
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models auth order get --provider openai
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models list --provider openai
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models status --probe --probe-provider openai --probe-profile "$WEBCHESS_OPENAI_PROFILE_ID"
```

Confirm that this dedicated profile reports an eligible `openai` OAuth profile
and no API-key profile, the stored auth-order override names only the OAuth
profile ID you selected, the exact selected model appears in the provider list,
and the profile-specific probe succeeds. If an API-key credential appears, stop
rather than letting a provider-wide probe consume it. A successful API-key
profile is a different auth and billing path and does not satisfy this
candidate's ChatGPT-account acceptance criterion.

The browser OAuth or device-code step is a user action. Do not paste tokens into
WebChess, the repository, an issue, or a test log. If the account does not expose
`openai/gpt-5.6-sol`, select an explicitly available model (the pinned OpenClaw
docs name `openai/gpt-5.5` as the recovery choice); OpenClaw does not silently
downgrade. A live probe can consume account allowance.

Official references:

- [OpenClaw 2026.7.1-2 OpenAI provider and OAuth route](https://github.com/openclaw/openclaw/blob/0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c/docs/providers/openai.md)
- [OpenClaw 2026.7.1-2 install requirements](https://github.com/openclaw/openclaw/blob/0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c/README.md)
- [OpenAI Codex authentication options](https://learn.chatgpt.com/docs/auth)

OpenAI's documentation distinguishes ChatGPT subscription sign-in from
usage-based API-key authentication. On this path the account's ChatGPT/Codex
workspace access, allowance windows, credits, and provider policies apply. A
WebChess-side API key is neither required nor a substitute for that entitlement.

### 3. Start a dedicated loopback PostgreSQL 17 database

Use the exact Docker commands in [Installation](INSTALL.md#3-create-the-dedicated-loopback-postgresql-17-database).
They bind only `127.0.0.1:55432`, use a WebChess-specific container and volume,
and include health, migration, backup, restore, and teardown checks. Never point
the plugin at production, Neon, or an unrelated local database.

### 4. Pack, inspect, install, and launch this exact source

```bash
set -euo pipefail
npm ci
npm run plugin:build
git diff --exit-code -- openclaw-plugin/dist
mkdir -p public/downloads
cp ../webchess-release-identity.json public/downloads/webchess-release-identity.json
cp ../webchess-paper-3.1.pdf public/downloads/webchess-white-paper.pdf
printf '%s  %s\n' "$WEBCHESS_PAPER_SHA256" public/downloads/webchess-white-paper.pdf | sha256sum --check
npm run downloads:generate
npm run release:identity:check
npm pack --dry-run
npm pack
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" plugins install npm-pack:./webchess-2.2.0-rc.1.tgz
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" plugins inspect webchess --runtime --json
test -n "${WEBCHESS_POSTGRES_PASSWORD:-}"
export WEBCHESS_OPENCLAW_DATABASE_URL="postgresql://webchess:${WEBCHESS_POSTGRES_PASSWORD}@127.0.0.1:55432/webchess"
export WEBCHESS_RELEASE_SHA="$(node -e 'const m=require("../webchess-release-identity.json"); process.stdout.write(m.source.commit)')"
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" webchess --no-open
```

Open the printed `http://127.0.0.1:<port>/openclaw` URL. The launcher must fail
closed if OpenClaw auth, model capability, PostgreSQL, migration
history, or the local-mode boundary is not ready. It must not fall through to
Clerk, Neon, Vercel, a hosted WebChess provider, or a repository `.env` secret.

### 5. Complete and inspect one case

Use the visible interface, not a hidden endpoint:

1. confirm the page identifies the exact source commit and
   `webchess@2.2.0-rc.1`;
2. enter a non-secret research question;
3. choose whether to consent to research search for this case;
4. choose the accessible 2D or 3D board and start Division;
5. play manually, request guided moves, or use autoplay until the canonical
   initial board reaches a real terminal game state;
6. inspect Portia's per-signal progress, Gate decision, Retry ancestry if any,
   the board-derived Answer, and Charlotte's qualifications;
7. choose one reversible Wilbur action, update it, and add an observation;
8. reload the page and confirm the same case and lifecycle return from
   PostgreSQL;
9. select **Export case** and retain the local redaction summary and digest;
10. select **Import & verify case** for that file and confirm schema
    `webchess-case-bundle/1`, artifact digests, event-log replay, terminal
    position, and provenance verification all pass; and
11. use **Start another game on this field** only when you intend a new game
    trajectory. That is not the same operation as verifying an imported replay.

The case bundle is a redaction-aware research artifact, not a database backup,
not an OpenAI subject-access export, and not proof that its answer is correct.

## Research-search disclosure and opt-out

Search is separate from model generation and local storage. It is **off until
the player gives case-scoped, versioned consent**. Leaving it off must not block
the non-search lifecycle or silently select another hosted service.

When it is on and the bounded materiality policy triggers:

1. the original question and a bounded query go through the configured
   OpenClaw Codex Search path;
2. configured search/provider services receive that material under the
   researcher's own account and policies;
3. the local broker may directly request at most three public HTTPS pages;
   those page hosts see an ordinary network request, while redirects, private
   addresses, credentials, oversized bodies, and unsupported content fail
   closed; and
4. retained excerpts, retrieval failures, URLs, timestamps, and content
   digests become provenance and may be included in later Portia, Answer, and
   Charlotte prompts sent to the selected model provider.

Search results and fetched text are untrusted evidence candidates. Prompt
injection filtering and provenance do not make a source true. The interface
must show unavailable, filtered, rejected, redirected, and omitted sources
rather than quietly pretending they were read.

The OpenClaw model/auth status and `models status --probe` checks above do
**not** prove that Codex Hosted Search is ready. The pinned integration has no
separate no-data search probe, and WebChess must not transmit a question merely
to test one. Search is verified only by the first consented, material lifecycle
invocation. Its durable research record must identify capability `web.search`,
provider `codex`, local transport, zero fallback attempts, and either retained
search activity or a visible failure/refusal. The optional direct-page requests
are a later WebChess-local step, not part of the hosted search call.

## Model-call, time, context, and allowance implications

For `S` terminal survivors (`1 <= S <= 32`), the nominal accepted lifecycle
uses **`S + 4` model generations**:

- one Division call;
- `S` Portia candidate calls plus one Portia summary call;
- one Answer call; and
- one Charlotte call.

That is 5 to 36 model generations, plus at most one separately disclosed
research-search invocation when consented and material. Portia's 13 attacks are
evaluated within each candidate call; they are not 13 separate calls per
candidate.

If the first Answer turn returns content that violates the strict structured
contract, WebChess may issue exactly one bounded corrective Answer turn using
the same approved evidence. A successful corrected path therefore uses
`S + 5` generations (6 to 37). Provider failures, transport failures, and
cancellation do not earn a corrective turn, and invalid provider output is not
copied into the corrective prompt.

Failures and Gate decisions can amplify that cost:

- Portia and Charlotte each have a three-attempt technical budget;
- completed Portia candidates are persisted so a recoverable retry resumes,
  but a late failure can repeat the summary;
- Gate may authorize two additional games on the same field and one fresh field,
  so chess, Portia, and later stages can run again; and
- a fresh field requires another Division call.

Large valid prompts can approach the selected model's context budget. The
structured OpenClaw transport preserves the complete prompt; it must refuse a provider or
context limit visibly rather than truncate evidence. Runtime therefore varies
with survivor count, model speed, search latency, retries, and game length and
can be substantial. Check OpenClaw's allowance/quota display before starting.
WebChess cannot promise a duration or convert a ChatGPT subscription into
unmetered use.

## What verification does and does not prove

The repository separates four evidence levels:

- **source/unit/contract tests** check pure rules, schemas, boundaries, and
  deterministic fixtures;
- **database integration tests** check real PostgreSQL transactions and
  migrations in a disposable database;
- **browser tests** check real HTTP and UI behavior, normally with deterministic
  provider stubs; and
- a separately gated **credentialed smoke** checks the packed plugin, real
  OpenClaw runtime, the researcher's authenticated OpenAI account, connected
  Chrome, a complete game, lifecycle persistence, reload, and export/import
  verification.

A green automated suite is not evidence that the credentialed smoke happened,
that a public deployment matches the source, or that the Arachne Method is
effective. Test reports must name the subset and exact pass/skip/fail counts;
reruns must not be added together as if they were new tests.

## Immutable version map

| Artifact | Identity | Status |
| --- | --- | --- |
| Released software baseline | `v2.1.0` / `9980328581ba3e6fed6f2c4fc99b555fec4773bc` | Historical released baseline |
| Audited Linux 2.2 candidate | `7a3749cf7f2c4e4c5ebfeb9b9aa870a11843f3a2` | Historical audit input, not this final RC |
| Historical V3 manuscript/software snapshot | paper 3.0 / `0384978b2ba709da4c9824f2821c8623d3f84364` | Preserved audit evidence |
| Integrated candidate | WebChess `2.2.0-rc.1` / full SHA in generated release identity | Unresolved until code freeze |
| Public paper mapped to integrated candidate | Arachne paper edition 3.1 / SHA-256 in generated release identity | Unresolved until the artifact exists |
| Provider harness | OpenClaw `2026.7.1-2` / `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c` | Pinned external dependency |

No DOI or archive identifier is claimed for an artifact that does not exist.
Historical papers remain historical; they are not rewritten to create a false
contemporaneous code mapping.

### Code-freeze identity gate

The tracked template at
`docs/releases/webchess-release-identity.template.json` intentionally contains
nulls for the as-yet nonexistent code-freeze and paper artifacts. A release
operator must first commit edition 3.1, freeze the exact source, obtain the
SHA-256 digests of the immutable GitHub source ZIP and the exact published PDF,
and then run from an otherwise clean checkout:

```bash
export WEBCHESS_RELEASE_SOURCE_SHA="$(git rev-parse HEAD)"
export WEBCHESS_RELEASE_SOURCE_ARCHIVE_SHA256='<64 lowercase hex characters>'
export WEBCHESS_RELEASE_PAPER_PATH='docs/<committed-edition-3.1-paper>.md'
export WEBCHESS_RELEASE_PAPER_PDF_SHA256='<64 lowercase hex characters>'
test -f public/downloads/webchess-white-paper.pdf
npm run release:identity:generate
npm run release:identity:check
```

The generated `public/downloads/webchess-release-identity.json` is deliberately
ignored because its values cannot exist truthfully before code freeze. The
publication build must generate and retain it from reviewed build inputs, then
verify that its two digests match the exact bytes served at the declared
download paths. Missing inputs, a dirty or different HEAD, the historical 3.0
paper path, an edition mismatch, a placeholder, or an unresolved generated
artifact exits nonzero. Until that gate and the public byte-for-byte checks
pass, the site must continue to display “source identity pending” and the
source ZIP route must return 503.

`npm run downloads:generate` preserves paper 3.0 only at filenames containing
`v3-historical`; it never writes the edition 3.1 path. The exact candidate PDF
must already exist at `public/downloads/webchess-white-paper.pdf`, and the
identity generator/checker verifies those local PDF bytes against the injected
SHA-256. This prevents a historical PDF from silently occupying the candidate
paper URL.

## Documentation

- [Installation, PostgreSQL, backup, and teardown](INSTALL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security](SECURITY.md)
- [Privacy and data flow](docs/PRIVACY.md)
- [Research and evaluation](docs/RESEARCH.md)
- [Case export and offline replay verification](docs/CASE_BUNDLES.md)
- [Historical V3 white paper](docs/WEBCHESS_WHITE_PAPER_V3.md)
- [Archived WebChess 2.0 white paper](docs/WEBCHESS_WHITE_PAPER_V2.md)
- [Archived WebChess 1.3 white paper](docs/archive/WEBCHESS_WHITE_PAPER_V1.3.md)
- [WebChess 2.0 operator guide](docs/WEBCHESS_2_0_OPERATIONS.md)
- [Contributing](CONTRIBUTING.md)
- [Support](SUPPORT.md)
- [Apache License 2.0](LICENSE)

Use GitHub Discussions for non-sensitive installation and research questions
only after the repository is actually public. Do not post private questions,
case bundles containing personal data, credentials, OAuth artifacts, database
dumps, or security reports in public channels.
