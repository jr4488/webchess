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
OpenAI lifecycle in connected Chrome has passed. Candidate identity is
manifest-dependent: it is resolved only when the generated release identity
names the exact code-freeze commit and digest-matched source ZIP and edition 3.1
PDF. A locally resolved manifest still does not prove that DNS, GitHub, or those
bytes are publicly available.

Do not substitute `main`, `main.zip`, a short SHA, or an unverified mirror for
the source named by the paper. If the public identity manifest or exact GitHub
commit is unavailable, the reader-to-source path is incomplete and should fail
closed.

The latest verified released baseline before this candidate is `v2.1.0` at
`9980328581ba3e6fed6f2c4fc99b555fec4773bc`. The historical V3 manuscript in
this tree records the prior local `2.2.0` audit and remains audit evidence. The
tracked [Arachne Method 3.1 candidate paper](docs/ARACHNE_METHOD_WHITE_PAPER_3_1.md)
is a separate candidate artifact; its immutable software/PDF mapping exists
only when the generated release identity is resolved and passes its byte checks.

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

See [Architecture](docs/ARCHITECTURE.md) for the implementation boundaries,
[The Arachne Method 3.1 candidate paper](docs/ARACHNE_METHOD_WHITE_PAPER_3_1.md)
for the current replication companion, and
[The First Answer Is Not Enough](docs/WEBCHESS_WHITE_PAPER_V3.md) for the
historical V3 manuscript and falsifiable research program.

Archived papers, operations notes, and source snapshots intentionally preserve
earlier key-backed or hosted-runtime descriptions as historical evidence. They
are retired snapshots, not installation instructions or supported alternatives
to the account-OAuth-only OpenClaw path below.

## Reproducible local path: OpenClaw plus OpenAI account authentication

The recommended researcher path is a packed WebChess plugin running on
loopback through **OpenClaw `2026.7.1-2`** and a dedicated PostgreSQL 17
database. OpenClaw uses the researcher's OpenAI account/OAuth authentication
for both model inference and the official Codex Hosted Search plugin. This is
the only supported authentication path: there is no WebChess-side, Codex,
OpenAI, alternate-provider API-key, API-token, service-account, or equivalent
fallback.

The candidate's reproducibility and acceptance environment is pinned to:

- Linux on `x86_64`; this is the only platform whose official Codex plugin,
  wrapper, and native executable bytes are attested by this candidate;
- Node.js `24.19.0`;
- npm `11.14.1`;
- OpenClaw `2026.7.1-2` (source commit
  `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`);
- the official `@openclaw/codex@2026.7.1-1` provider plugin for Codex Hosted
  Search;
- PostgreSQL `17.10` from the pinned `postgres:17-alpine` image digest in the
  repository;
- Google Chrome `150.0.7871.128` for the connected interactive acceptance
  pass; and
- WebGL 2 for the optional 3D board. The accessible 2D board must remain
  available when WebGL is absent or motion is reduced.

These are reproducibility pins, not claims that all newer versions are broken.
Node 24 is the recommended line in the pinned OpenClaw documentation. The
current packed launcher deliberately fails closed on macOS, Windows, Linux ARM,
and other unattested platform/architecture pairs; they are not supported
alternatives until their exact native payloads and end-to-end paths are reviewed.

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
WEBCHESS_OPENAI_MODEL='openai/gpt-5.6-sol'
case "$WEBCHESS_OPENAI_MODEL" in
  openai/?*) ;;
  *)
    echo 'WEBCHESS_OPENAI_MODEL must be an explicit openai/<model-id> reference.' >&2
    exit 1
    ;;
esac
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
webchess_assert_account_oauth_only() {
  local webchess_env_name
  local -a webchess_forbidden_provider_env=()
  while IFS= read -r webchess_env_name; do
    case "$webchess_env_name" in
      *_API_KEY|*_API_KEYS|*_API_KEY_*|*_API_TOKEN|*_ACCESS_TOKEN|*_AUTH_TOKEN|*_OAUTH_TOKEN|OPENCLAW_LIVE_*_KEY|OPENCLAW_LIVE_*_KEYS|ANTHROPIC_ADMIN_KEY|AWS_ACCESS_KEY_ID|AWS_BEARER_TOKEN_BEDROCK|AWS_CONFIG_FILE|AWS_CONTAINER_AUTHORIZATION_TOKEN|AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE|AWS_CONTAINER_CREDENTIALS_FULL_URI|AWS_CONTAINER_CREDENTIALS_RELATIVE_URI|AWS_PROFILE|AWS_SECURITY_TOKEN|AWS_SECRET_ACCESS_KEY|AWS_SHARED_CREDENTIALS_FILE|AWS_SESSION_TOKEN|AWS_WEB_IDENTITY_TOKEN_FILE|AZURE_CLIENT_SECRET|AZURE_SPEECH_KEY|CODEX_TOKEN|COPILOT_GITHUB_TOKEN|FAL_KEY|GH_TOKEN|GITHUB_TOKEN|GOOGLE_APPLICATION_CREDENTIALS|HF_TOKEN|HUGGINGFACE_HUB_TOKEN|MINIMAX_CODE_PLAN_KEY|OPENAI_ADMIN_KEY|OPENAI_TOKEN|OPENAI_WEBHOOK_SECRET|RUNWAYML_API_SECRET|SPEECH_KEY|VOLCENGINE_TTS_TOKEN|OPENAI_BASE_URL|OPENAI_API_BASE|OPENAI_CUSTOM_HEADERS|OPENAI_LOG|OPENAI_ORG_ID|OPENAI_PROJECT_ID|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|http_proxy|https_proxy|all_proxy|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR|OPENCLAW_BUILD_PRIVATE_QA|OPENCLAW_QA_FORCE_RUNTIME|OPENCLAW_DEBUG_PROXY_ENABLED|OPENCLAW_DEBUG_PROXY_REQUIRE|OPENCLAW_DEBUG_PROXY_URL|OPENCLAW_DEBUG_PROXY_DB_PATH|OPENCLAW_DEBUG_PROXY_BLOB_DIR)
        if [[ -n "${!webchess_env_name}" ]]; then
          webchess_forbidden_provider_env+=("$webchess_env_name")
        fi
        ;;
      NODE_TLS_REJECT_UNAUTHORIZED)
        if [[ "${!webchess_env_name}" = '0' ]]; then
          webchess_forbidden_provider_env+=("$webchess_env_name")
        fi
        ;;
    esac
  done < <(compgen -e)
  if ((${#webchess_forbidden_provider_env[@]})); then
    printf 'Refusing account-OAuth readiness; forbidden provider/runtime environment variable(s): %s\n' \
      "${webchess_forbidden_provider_env[*]}" >&2
    return 1
  fi
}
webchess_assert_account_oauth_only
openclaw --version | grep -Eq '^OpenClaw 2026\.7\.1-2 \('
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models auth login --provider openai --force
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models set "$WEBCHESS_OPENAI_MODEL"
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models fallbacks clear
test "$(openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" config get agents.defaults.model.primary)" = "$WEBCHESS_OPENAI_MODEL"
test -z "$(openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models fallbacks list --plain)"
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" config validate
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" doctor
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models auth list --provider openai
read -r -p 'Eligible OpenAI OAuth profile ID: ' WEBCHESS_OPENAI_PROFILE_ID
test -n "$WEBCHESS_OPENAI_PROFILE_ID"
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models auth order set --provider openai "$WEBCHESS_OPENAI_PROFILE_ID"
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models auth order get --provider openai
WEBCHESS_OPENAI_AUTH_ORDER="$(node -e 'process.stdout.write(JSON.stringify([process.argv[1]]))' "$WEBCHESS_OPENAI_PROFILE_ID")"
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" config set auth.order.openai "$WEBCHESS_OPENAI_AUTH_ORDER" --strict-json
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" config get auth.order.openai
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models list --provider openai
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models status --probe --probe-provider openai --probe-profile "$WEBCHESS_OPENAI_PROFILE_ID"
```

`--force` removes earlier OpenAI auth profiles only inside this newly dedicated
WebChess profile; never point this command at a general-purpose OpenClaw profile.
Confirm that the dedicated profile reports an eligible `openai` OAuth profile
and no API-key profile, both the effective per-agent order and the
`auth.order.openai` config override name only the OAuth profile ID you selected,
the primary is the explicit `openai/*` reference in `WEBCHESS_OPENAI_MODEL`,
the fallback list is empty, the exact selected model appears in the provider
list, and the profile-specific probe succeeds. If an API-key credential appears, stop
rather than letting a provider-wide probe consume it. A successful API-key
profile is a different auth and billing path and does not satisfy this
candidate's OpenAI-account acceptance criterion.
Pinned OpenClaw gives the per-agent stored order precedence; both order commands
above must therefore show the same one-element OAuth profile list.

The Bash gate examines the environment inherited by each subsequent OpenClaw
process. It prints only offending variable names, never credential values. All
matching singular, plural, or embedded API-key variables, OpenClaw live-test
key variables, API-token, access-token, auth-token, and OAuth-token variables,
plus every exact provider, cloud-profile, service-account, and administrative
credential name enumerated in the function, must be empty or unset. The exact OpenAI
endpoint, custom-header, organization/project, webhook, and SDK logging
overrides, ambient proxy/TLS overrides, and OpenClaw debug-proxy
variables named there must also be empty or unset so account OAuth cannot be
redirected or wrapped by an unreviewed transport. The two OpenClaw private-QA
runtime overrides must be empty or unset, and
`NODE_TLS_REJECT_UNAUTHORIZED=0` is rejected because it disables TLS
verification. Rerun the gate immediately
before plugin inspection and launch.
A nonempty variable, any API-key auth profile, or an auth-order entry other than
the chosen OAuth profile is a failed readiness result, not permission to
continue with a fallback.

The browser OAuth or device-code step is a user action. Do not paste tokens into
WebChess, the repository, an issue, or a test log. If the account does not
expose `openai/gpt-5.6-sol`, set `WEBCHESS_OPENAI_MODEL` to an explicitly
available `openai/<model-id>` (the pinned OpenClaw docs name
`openai/gpt-5.5` as the recovery choice), rerun `models set`, `models fallbacks
clear`, and both assertions above, then probe that exact model. Do not use an
alias, another provider, or any fallback. OpenClaw does not silently downgrade.
A live probe can consume account allowance.

Official references:

- [OpenClaw 2026.7.1-2 OpenAI provider and OAuth route](https://github.com/openclaw/openclaw/blob/0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c/docs/providers/openai.md)
- [OpenClaw 2026.7.1-2 web-search and Codex provider configuration](https://github.com/openclaw/openclaw/blob/0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c/docs/tools/web.md)
- [OpenClaw 2026.7.1-2 install requirements](https://github.com/openclaw/openclaw/blob/0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c/README.md)
- [OpenAI Codex authentication options](https://learn.chatgpt.com/docs/auth)

OpenAI's documentation distinguishes ChatGPT subscription sign-in from
usage-based API-key authentication. On this path the account's ChatGPT/Codex
workspace access, allowance windows, credits, and provider policies apply. A
WebChess-side, Codex, OpenAI, or alternate-provider API key is neither required
nor an acceptable substitute for that entitlement.

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
npm run plugin:verify
mkdir -p public/downloads
cp ../webchess-release-identity.json public/downloads/webchess-release-identity.json
export WEBCHESS_SOURCE_ARCHIVE_NAME="$(node -e 'const m=require("../webchess-release-identity.json"); process.stdout.write(m.source.archive.downloadPath.split("/").at(-1))')"
cp ../webchess-source.zip "public/downloads/$WEBCHESS_SOURCE_ARCHIVE_NAME"
export WEBCHESS_RELEASE_SOURCE_SHA="$WEBCHESS_RELEASE_SHA"
npm run downloads:generate
printf '%s  %s\n' "$WEBCHESS_PAPER_SHA256" public/downloads/webchess-white-paper.pdf | sha256sum --check
cmp --silent ../webchess-paper-3.1.pdf public/downloads/webchess-white-paper.pdf
npm run release:identity:check
npm run release:identity:check-public
npm pack --dry-run --pack-destination ..
npm pack --pack-destination ..
test -f ../webchess-2.2.0-rc.1.tgz
npm run pack:verify -- ../webchess-2.2.0-rc.1.tgz
test -z "$(git status --porcelain=v1 --untracked-files=all)"
test "$(npm view @openclaw/codex@2026.7.1-1 dist.integrity)" = \
  'sha512-fRQITjqjC4Q/M6WmkR9XPWPuL+7vcvyVUWIDztB08X2G/mhzSwCYwQp4hugxAtuKmO3yx/7ULMK3nyeKsg5zGw=='
webchess_assert_account_oauth_only
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" plugins install @openclaw/codex@2026.7.1-1 --pin
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" plugins install npm-pack:../webchess-2.2.0-rc.1.tgz
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" config set tools.web.search.provider codex
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" config set plugins.allow '["codex","webchess"]' --strict-json
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" config validate
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" plugins inspect codex --runtime --json
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" plugins inspect webchess --runtime --json
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" capability web providers --json
test -n "${WEBCHESS_POSTGRES_PASSWORD:-}"
export WEBCHESS_OPENCLAW_DATABASE_URL="postgresql://webchess:${WEBCHESS_POSTGRES_PASSWORD}@127.0.0.1:55432/webchess"
export WEBCHESS_RELEASE_SHA="$(node -e 'const m=require("../webchess-release-identity.json"); process.stdout.write(m.source.commit)')"
webchess_assert_account_oauth_only
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" webchess --no-open
```

Open the printed `http://127.0.0.1:<port>/openclaw` URL. The launcher must fail
closed if OpenClaw auth, model capability, PostgreSQL, migration
history, the account-OAuth-only credential boundary, or local mode is not
ready. A provider-key variable or API-key profile is a startup failure. The
launcher must not fall through to Clerk, Neon, Vercel, a hosted WebChess
provider, an alternate model/search provider, or a repository `.env` secret.

The provider inventory is a no-query setup check. Before launch, its `search`
array must include an available, selected `codex` entry, and both plugin
inspections must report loaded runtimes. If the entry or either plugin is
missing, stop. These commands do not send the research question and do not
prove that the researcher's account can execute Hosted Search. The official
Codex provider and model inference both use OpenClaw's selected OpenAI
account/OAuth profile. Neither may use a WebChess-side, Codex, OpenAI, or other
provider API key/token; a missing account capability must fail visibly rather
than select a substitute.

At launch and before each search boundary, the packed plugin attests the exact
official global Codex plugin record, package/lock integrity, reviewed runtime
module bytes, wrapper, and Linux x86_64 native executable. It also binds search
to a private client constructed from the one selected OAuth profile. Missing,
changed, symlink-substituted, differently ordered, or unsupported-platform
components are startup/request failures, not permission to use another binary,
credential, provider, or transport.

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
9. select **Download case bundle** and retain the local redaction summary and digest;
10. select **Import & verify case bundle** for that file and confirm schema
    `webchess-case-bundle/1`, internal section digests and integrity root,
    event-log replay, terminal position, and provenance checks all pass; then
    run `npm run case:verify -- /path/to/the-bundle.json` from this still-clean
    checkout for exact local source, runtime-payload, and migration equality;
    and
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

Model/auth status and provider inventory alone do **not** prove live account
readiness. Once per launcher process, before accepting a game, the packed bridge
runs two bounded requests through the same selected OpenAI account/OAuth
profile: the exact prepared `openai/*` model must answer the fixed prompt
`Reply with exactly this ASCII token and nothing else: WEBCHESS_READY` with
exactly `WEBCHESS_READY`, and the official `codex` provider tool must complete
the fixed query `OpenAI official website`. Neither request contains user or
case content, triggers WebChess direct-page retrieval, is written to
game/research rows or a case export, or is repeated by status polling. Both are
real account/network requests, so OpenAI/provider data policies and account
allowance apply. Launch fails closed unless both bounded results validate. If
either transmission is unacceptable, do not launch; case-scoped search consent
does not disable these readiness gates.

The launch probe proves only that the reviewed authenticated search route
worked at that moment. A consented lifecycle search remains a separate request
and can still fail. At execution time the packed bridge accepts only capability
`web.search`, provider `codex`, local transport, and an empty fallback-attempt
array. Durable case research records retain the provider, transport, bounded
attempt count, planned and executed query data, evidence and provenance, and
any visible failure/refusal status and code. Optional direct-page requests are
a later WebChess-local step.

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
| Integrated candidate | WebChess `2.2.0-rc.1` / full SHA and archive digest in generated release identity | Resolved only when the manifest says `resolved` and its local byte checks pass; that alone is not publication |
| Candidate paper mapped to integrated candidate | [Arachne paper edition 3.1](docs/ARACHNE_METHOD_WHITE_PAPER_3_1.md) / PDF SHA-256 in generated release identity | Manifest-dependent; resolved only when the candidate PDF and source mapping pass together |
| Provider harness | OpenClaw `2026.7.1-2` / `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c` | Pinned external dependency |
| Hosted Search provider | `@openclaw/codex@2026.7.1-1` / npm integrity `sha512-fRQITjqjC4Q/M6WmkR9XPWPuL+7vcvyVUWIDztB08X2G/mhzSwCYwQp4hugxAtuKmO3yx/7ULMK3nyeKsg5zGw==` | Pinned official provider dependency; inventory proves local registration, not account execution |

No DOI or archive identifier is claimed for an artifact that does not exist.
Historical papers remain historical; they are not rewritten to create a false
contemporaneous code mapping.

### Code-freeze identity gate

The tracked template at
`docs/releases/webchess-release-identity.template.json` intentionally contains
nulls for the as-yet nonexistent code-freeze and paper artifacts. A release
operator must first commit edition 3.1, freeze the exact source, create the
retained uncompressed Git archive and deterministic paper PDF, and then bind
their exact bytes from an otherwise clean checkout:

```bash
export WEBCHESS_RELEASE_SOURCE_SHA="$(git rev-parse HEAD)"
export WEBCHESS_RELEASE_SHA="$WEBCHESS_RELEASE_SOURCE_SHA"
npm run --silent release:source-archive > ../webchess-source-archive.json
export WEBCHESS_RELEASE_SOURCE_ARCHIVE_SHA256="$(node -e 'const r=require("../webchess-source-archive.json"); process.stdout.write(r.sha256)')"
export WEBCHESS_RELEASE_PAPER_PATH='docs/ARACHNE_METHOD_WHITE_PAPER_3_1.md'
npm run downloads:generate
export WEBCHESS_RELEASE_PAPER_PDF_SHA256="$(sha256sum public/downloads/webchess-white-paper.pdf | cut -d' ' -f1)"
npm run release:identity:generate
npm run release:identity:check
npm run release:identity:check-public
npm run --silent release:source-archive > ../webchess-source-archive-second.json
test "$(node -e 'const r=require("../webchess-source-archive-second.json"); process.stdout.write(r.sha256)')" = "$WEBCHESS_RELEASE_SOURCE_ARCHIVE_SHA256"
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

`npm run downloads:generate` always preserves paper 3.0 at filenames containing
`v3-historical`. It writes the edition 3.1 Markdown, HTML, and deterministic PDF
only when `WEBCHESS_RELEASE_SOURCE_SHA` is an exact commit. The identity checks
hash both that PDF and the retained commit-addressed source ZIP; an environment
SHA alone cannot make the site advertise release source. This prevents a
historical PDF or a generated GitHub archive from silently occupying a mapped
candidate URL.

## Documentation

- [Installation, PostgreSQL, backup, and teardown](INSTALL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security](SECURITY.md)
- [Privacy and data flow](docs/PRIVACY.md)
- [Research and evaluation](docs/RESEARCH.md)
- [Case export and offline replay verification](docs/CASE_BUNDLES.md)
- [Arachne Method 3.1 candidate paper](docs/ARACHNE_METHOD_WHITE_PAPER_3_1.md)
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
