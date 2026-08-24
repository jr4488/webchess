# Install WebChess 2.2.0-rc.1 for local research

This is the supported public reader-to-running-game path for the WebChess
`2.2.0-rc.1` candidate. It runs a packed WebChess plugin through OpenClaw on
loopback, uses the researcher's OpenAI/ChatGPT account authentication held by
OpenClaw, and stores the case in a dedicated local PostgreSQL 17 database.

This guide does not deploy a hosted service. It does not require a WebChess
account, Clerk, Neon, Vercel, or a WebChess-side `OPENAI_API_KEY`. The selected
OpenAI account must still have access to the chosen model, and its allowance,
credits, workspace controls, data policies, and provider billing rules still
apply.

The Arachne Method is the whole experimental method. WebChess is its software
instrument. ANANSI is the Anansi/Division field-construction mnemonic inside
that method. Software conformance and successful execution do not validate the
method's efficacy or the truth of an answer.

The command transcript below is the reviewed Linux/bash candidate path. Its
source, contract, build, and deterministic-browser pieces are tested; the
packed-plugin, account-OAuth, PostgreSQL, and connected-Chrome journey must
still pass together before publication. On macOS,
`shasum -a 256 <file>` is the built-in digest equivalent to `sha256sum`; the
candidate does not yet claim a completed macOS acceptance pass. Windows users
should use a Linux environment with equivalent loopback and Docker semantics
until a native Windows path is separately verified.

Run the transcript in one dedicated Bash session. Its fail-closed shell mode
must remain active, and a nonzero command is a stop condition—not permission to
continue with a guessed or previously installed component.

## 0. Prerequisites

The verified Linux path requires Git, curl, GNU `sha256sum`, Node.js `24.19.0`,
npm `11.14.1`, a reachable Docker Engine, and Google Chrome
`150.0.7871.128`. Run this before step 1:

```bash
set -euo pipefail
for command_name in git curl sha256sum node npm docker; do
  command -v "$command_name" >/dev/null
done
test "$(node --version)" = 'v24.19.0'
test "$(npm --version)" = '11.14.1'
docker info >/dev/null
export WEBCHESS_CHROME_BIN="$(command -v google-chrome-stable || command -v google-chrome)"
test -x "$WEBCHESS_CHROME_BIN"
"$WEBCHESS_CHROME_BIN" --version | grep -Eq '^Google Chrome 150\.0\.7871\.128\b'
```

JavaScript, cookies/local storage, and access to loopback HTTP must be enabled.
WebGL 2 is optional because the accessible 2D board is the required fallback.
If a prerequisite is unavailable, stop and install it through the operating
system's supported channel; this guide does not ask for `sudo` or silently
replace a system component.

## 1. Verify the immutable release identity and clone it

Do not begin from `main`, `main.zip`, or a short SHA. At publication, the public
site and paper must link to the generated
`/downloads/webchess-release-identity.json` file. Until its source commit and
artifact digests are resolved, this candidate is not publication-ready.

```bash
set -euo pipefail
export WEBCHESS_IDENTITY_URL='https://webchess.anansiportia.com/downloads/webchess-release-identity.json'
curl --fail --location --output webchess-release-identity.json "$WEBCHESS_IDENTITY_URL"
node -e 'const m=require("./webchess-release-identity.json"); if(m.schema!=="webchess-release-identity/1"||m.status!=="resolved") process.exit(1)'
export WEBCHESS_RELEASE_SHA="$(node -e 'const m=require("./webchess-release-identity.json"); process.stdout.write(m.source.commit ?? "")')"
test "${#WEBCHESS_RELEASE_SHA}" -eq 40
```

Verify the published source and paper bytes against the same manifest:

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

An unavailable manifest, unresolved value, inaccessible commit, or digest
mismatch is a release failure. Do not silently fall back to a branch.

## 2. Install and authenticate the reviewed OpenClaw version

The candidate gate is pinned to Node.js `24.19.0`, npm `11.14.1`, and OpenClaw
`2026.7.1-2`. The pinned OpenClaw package supports Node 24 from `24.15.0`
through the 24.x line. Install it into a dedicated tool directory and use an
isolated profile instead of replacing an existing global OpenClaw setup:

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
```

Run the official narrow OpenAI account-login flow. The
browser OAuth or device-code interaction is a user-only step; never copy its
tokens into WebChess, a shell transcript, an issue, or a case export.

```bash
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

Do not proceed merely because these commands exit. Confirm that this dedicated
profile shows an eligible `openai` OAuth profile without revealing secret
material, no API-key profile, an auth-order override naming only the selected
OAuth profile ID, the exact selected model, and a successful profile-specific
probe. If an API-key credential appears, stop rather than letting a
provider-wide probe consume it. An API-key profile is a different billing/auth
path and does not prove this guide's ChatGPT-account acceptance criterion.

The intended candidate model is `openai/gpt-5.6-sol`. If that model is not
listed for the account, choose a model that the pinned OpenClaw version actually
reports; its reviewed documentation identifies `openai/gpt-5.5` as the recovery
choice. Do not claim that a model was used unless the case provenance reports
it. A readiness probe is a real provider request and can consume allowance.

Official references:

- [OpenClaw 2026.7.1-2 OpenAI provider and OAuth route](https://github.com/openclaw/openclaw/blob/0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c/docs/providers/openai.md)
- [OpenClaw 2026.7.1-2 installation requirements](https://github.com/openclaw/openclaw/blob/0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c/README.md)
- [OpenAI Codex authentication](https://learn.chatgpt.com/docs/auth)

OpenAI documents ChatGPT subscription sign-in and usage-based API-key
authentication as distinct methods. This guide uses the former through
OpenClaw. WebChess does not request, receive, or need `OPENAI_API_KEY` on this
path.

## 3. Create the dedicated loopback PostgreSQL 17 database

The commands below use PostgreSQL `17.10` from the reviewed image digest, bind
it only to IPv4 loopback, and keep data in a WebChess-specific named volume.
They intentionally do not reuse or delete an existing same-name resource.

First confirm that the names and port are free:

```bash
if docker container inspect webchess-rc1-postgres >/dev/null 2>&1; then
  echo 'webchess-rc1-postgres already exists; inspect it and choose a new name.' >&2
  exit 1
fi
if docker volume inspect webchess-rc1-pgdata >/dev/null 2>&1; then
  echo 'webchess-rc1-pgdata already exists; inspect it and choose a new name.' >&2
  exit 1
fi
```

Create the volume and container:

```bash
set -euo pipefail
docker volume create --label org.webchess.purpose=2.2.0-rc.1 webchess-rc1-pgdata
export WEBCHESS_POSTGRES_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))')"
test -n "$WEBCHESS_POSTGRES_PASSWORD"
docker run --detach \
  --name webchess-rc1-postgres \
  --label org.webchess.purpose=2.2.0-rc.1 \
  --publish 127.0.0.1:55432:5432 \
  --env POSTGRES_USER=webchess \
  --env "POSTGRES_PASSWORD=$WEBCHESS_POSTGRES_PASSWORD" \
  --env POSTGRES_DB=webchess \
  --mount type=volume,source=webchess-rc1-pgdata,target=/var/lib/postgresql/data \
  --health-cmd='pg_isready -U webchess -d webchess' \
  --health-interval=2s \
  --health-timeout=3s \
  --health-retries=30 \
  postgres:17.10-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193
```

Wait for health and verify the exact major version through the same loopback
endpoint WebChess will use:

```bash
for attempt in $(seq 1 30); do
  health="$(docker inspect --format '{{.State.Health.Status}}' webchess-rc1-postgres)"
  test "$health" = healthy && break
  if test "$health" = unhealthy || test "$attempt" -eq 30; then
    docker logs webchess-rc1-postgres
    echo "PostgreSQL did not become healthy (status: $health)." >&2
    exit 1
  fi
  sleep 2
done
export WEBCHESS_OPENCLAW_DATABASE_URL="postgresql://webchess:${WEBCHESS_POSTGRES_PASSWORD}@127.0.0.1:55432/webchess"
docker exec webchess-rc1-postgres \
  psql --set ON_ERROR_STOP=1 --username webchess --dbname webchess \
  --command='SELECT current_setting('"'"'server_version'"'"');'
```

The database must be dedicated to this installation. Never substitute a
production, hosted, Neon, or unrelated local database. The WebChess launcher
checks the loopback URL and applies the bundled canonical migrations before it
reports ready.

**Do not run the rest of this subsection yet.** Continue at step 4 and return
here only after completing the lifecycle in step 7. Then verify migration
ownership and health:

```bash
docker exec webchess-rc1-postgres \
  psql --set ON_ERROR_STOP=1 --username webchess --dbname webchess \
  --command='TABLE webchess_schema_migrations;'
```

### Back up and restore the database

The following custom-format dump remains on the host and contains the complete
local database. Treat it as sensitive:

```bash
umask 077
test ! -e ../webchess-rc1-postgres.dump || {
  echo '../webchess-rc1-postgres.dump already exists; choose a new backup path.' >&2
  exit 1
}
docker exec webchess-rc1-postgres \
  pg_dump --format=custom --no-owner --no-privileges \
  --username webchess --dbname webchess \
  > ../webchess-rc1-postgres.dump
chmod 600 ../webchess-rc1-postgres.dump
sha256sum ../webchess-rc1-postgres.dump
```

Test restoration into a separate database without replacing the live one:

```bash
docker exec webchess-rc1-postgres \
  createdb --username webchess --owner webchess webchess_restore
docker exec --interactive webchess-rc1-postgres \
  pg_restore --exit-on-error --no-owner --no-privileges \
  --username webchess --dbname webchess_restore \
  < ../webchess-rc1-postgres.dump
docker exec webchess-rc1-postgres \
  psql --set ON_ERROR_STOP=1 --username webchess --dbname webchess_restore \
  --command='TABLE webchess_schema_migrations;'
```

Use a distinct loopback URL naming `webchess_restore` only when intentionally
checking that restored copy. A WebChess **Export case** file is a portable,
redaction-aware case artifact; it is not a PostgreSQL backup.

### Teardown after step 8; do not run these commands yet

Keep PostgreSQL running through the build, launch, lifecycle, reload, and case
verification steps below. Only after completing step 8 should you stop or
remove the disposable resources you created.

Stopping or removing the container preserves the named volume:

```bash
docker stop webchess-rc1-postgres
docker rm webchess-rc1-postgres
```

Removing `webchess-rc1-pgdata` destroys the stored games and is not a routine
teardown step. Do it only after verifying the exact volume name and backup, and
only when you intentionally want those data deleted:

```bash
docker volume inspect webchess-rc1-pgdata
# Destructive and not reversible without a verified dump:
docker volume rm webchess-rc1-pgdata
```

## 4. Build and inspect the exact packed plugin

From the detached, verified source checkout:

```bash
set -euo pipefail
npm ci
npm run plugin:build
git diff --exit-code -- openclaw-plugin/dist
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
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" plugins install npm-pack:../webchess-2.2.0-rc.1.tgz
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" config set plugins.allow '["webchess"]' --strict-json
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" config validate
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" plugins inspect webchess --runtime --json
```

Use the packed archive, not a source-link install, for the release acceptance
pass. The launcher stages application code in a disposable directory, listens
only on loopback, and keeps game data in PostgreSQL. Credentials stay in
OpenClaw/provider configuration and must never be returned to the browser or
stored in a WebChess case.

## 5. Launch WebChess

Keep the dedicated PostgreSQL container running and the database URL in the
shell that launches OpenClaw:

```bash
set -euo pipefail
test -n "${WEBCHESS_POSTGRES_PASSWORD:-}" || {
  echo 'Return to the shell that created PostgreSQL; do not guess its password.' >&2
  exit 1
}
export WEBCHESS_OPENCLAW_DATABASE_URL="postgresql://webchess:${WEBCHESS_POSTGRES_PASSWORD}@127.0.0.1:55432/webchess"
export WEBCHESS_RELEASE_SHA="$(node -e 'const m=require("../webchess-release-identity.json"); process.stdout.write(m.source.commit)')"
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" webchess --no-open
```

Open the printed `http://127.0.0.1:<port>/openclaw` address in a browser with
JavaScript, cookies/local browser storage, and loopback access. The connected
candidate acceptance target is Google Chrome `150.0.7871.128`; other evergreen
browsers may work but are not represented by that pass. WebGL 2 is optional:
the accessible 2D board remains available when WebGL is absent, the 3D renderer
fails, or the user requests reduced motion.

The startup must fail closed when the model, auth, OpenClaw runtime, database,
migrations, or local-mode boundary is unavailable. It must not silently call a
WebChess-hosted provider, Clerk, Neon, or a repository `.env` service.

## 6. Choose research-search consent separately

The model lifecycle and research search have distinct data flows. Search is
off until the player gives case-scoped, versioned consent. Opting out must
leave the non-search lifecycle usable.

When search is on and the bounded materiality rule triggers, the original
question and bounded query pass through OpenClaw's Codex Search provider under
the researcher's account. At most three public HTTPS page hosts may then receive
direct HTTP requests from the local machine. The page text, URLs, failures,
timestamps, excerpts, and digests may become provenance supplied to Portia,
Answer, and Charlotte. Private addresses, credential-bearing URLs, unsafe
redirects, oversized bodies, and unsupported media must fail closed.

Search results and pages are untrusted evidence candidates. Source provenance
and prompt-injection filtering do not establish truth. Rejected, unavailable,
filtered, and omitted material must remain visible to the player.

The model/auth status check and `models status --probe` command do not test
Codex Hosted Search. The reviewed integration has no separate search dry run,
and the launcher must not transmit the question just to manufacture one.
Search readiness is established only by the first consented, material research
attempt. Inspect its durable record for capability `web.search`, provider
`codex`, local transport, zero fallback attempts, and retained activity or an
explicit failure/refusal. The subsequent maximum-three page retrieval is a
separate local WebChess operation.

## 7. Exercise the complete lifecycle

Follow the visible interface through the whole case:

1. Confirm it reports `webchess@2.2.0-rc.1` and the same full source SHA as the
   release identity.
2. Enter a non-secret question and make the separate search-consent choice.
3. Choose the 2D or 3D board, start Division, and play manually, request guided
   moves, or use autoplay until the canonical initial position reaches a real
   terminal state.
4. Inspect Portia for every surviving signal, the deterministic Gate decision,
   Retry ancestry if used, the board-derived Answer, and Charlotte's
   qualifications.
5. Choose one reversible Wilbur action, update it, and record an observation.
6. Reload the page and verify that PostgreSQL restores the same case and
   lifecycle.
7. Select **Export case** and retain its redaction summary and digest.
8. Select **Import & verify case** for that file. Confirm schema
   `webchess-case-bundle/1`, internal section digests and integrity root,
   event-log replay, terminal board, and recorded provenance. This browser
   check does not compare the bundle with local checkout, runtime-payload, or
   migration bytes.
9. Use **Start another game on this field** only to create a new game
   trajectory. It is not imported replay verification.

After the browser check, run the checkout-aware verifier against the exported
file. Packing into `..` above keeps the checkout clean so an exact commit match
can be reported instead of a dirty-tree warning:

```bash
npm run case:verify -- /path/to/webchess-case-....json
```

For `S` terminal survivors, the nominal accepted path uses `S + 4` model
generations: Division, `S` Portia candidates, one Portia summary, Answer, and
Charlotte. That is 5 to 36 generations for the allowed 1-to-32 survivors, plus
at most one separately disclosed search invocation. Technical retries, a
repeated Portia summary, or the single allowed corrective Answer turn after a
strictly contract-invalid first Answer can add calls. Provider/transport
failure does not trigger that correction. Two Gate-authorized same-field games
and one fresh field can further amplify model calls, context, runtime, and
allowance use. No duration or unmetered-use promise is made.

## 8. Interpret verification honestly

Source, unit, and contract tests prove bounded software properties. Disposable
PostgreSQL tests prove selected migration and transaction behavior. Browser
tests normally use deterministic provider stubs. None of those establishes
that OpenAI account OAuth was used, that a public site matches a commit, or that
the Arachne Method improves decisions.

The release gate separately requires the exact packed plugin, real loopback
HTTP and PostgreSQL, the connected Chrome browser, an authenticated OpenClaw
OpenAI account, a terminal game, complete postgame stages, reload, and
export/import verification. If OAuth, CAPTCHA, or another user-only action is
required, record that exact blocker; do not substitute a mocked provider and
call the credentialed smoke complete.

See [README.md](README.md) for the immutable version map, lifecycle semantics,
model-call accounting, and publication boundary.
