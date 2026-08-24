# Install WebChess 2.2.0-rc.1 for local research

This is the supported public reader-to-running-game path for the WebChess
`2.2.0-rc.1` candidate. It runs a packed WebChess plugin through OpenClaw on
loopback, uses the researcher's OpenAI account/OAuth authentication held by
OpenClaw for both model inference and official Codex Hosted Search, and stores
the case in a dedicated local PostgreSQL 17 database.

This guide does not deploy a hosted service. It does not require a WebChess
account, Clerk, Neon, or Vercel. It permits no WebChess-side, Codex, OpenAI,
alternate-provider API-key, API-token, service-account, or equivalent fallback.
The selected OpenAI account must still have access to the chosen model and
Hosted Search; its allowance, credits, workspace controls, data policies, and
OpenAI billing rules still apply.

The Arachne Method is the whole experimental method. WebChess is its software
instrument. ANANSI is the Anansi/Division field-construction mnemonic inside
that method. Software conformance and successful execution do not validate the
method's efficacy or the truth of an answer.

The command transcript below is the reviewed Linux/bash **x86_64** candidate
path. Publication requires retained evidence that its source, exact packed
plugin, account-OAuth inference and search, PostgreSQL, and connected-Chrome
journey passed together; source/build tests alone do not establish that. The
launcher attests exact Linux x86_64 Codex runtime and native-executable bytes and
fails closed on every other platform/architecture pair. macOS, Windows, Linux
ARM, WSL-on-ARM, and other native paths are therefore not supported by this
candidate, even when their shell and Docker commands appear similar.

Run the transcript in one dedicated Bash session. Its fail-closed shell mode
must remain active, and a nonzero command is a stop condition—not permission to
continue with a guessed or previously installed component.

## 0. Prerequisites

The verified Linux x86_64 path requires Git, curl, GNU `sha256sum`, Node.js
`24.19.0`, npm `11.14.1`, a reachable Docker Engine, and Google Chrome
`150.0.7871.128`. Run this before step 1:

```bash
set -euo pipefail
test "$(uname -s)" = 'Linux'
test "$(uname -m)" = 'x86_64'
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
export WEBCHESS_INSTALL_WORKSPACE="${PWD}/webchess-2.2.0-rc.1-install"
test ! -e "$WEBCHESS_INSTALL_WORKSPACE"
mkdir -- "$WEBCHESS_INSTALL_WORKSPACE"
cd -- "$WEBCHESS_INSTALL_WORKSPACE"
export WEBCHESS_IDENTITY_URL='https://webchess.anansiportia.com/downloads/webchess-release-identity.json'
curl --fail --location --remove-on-error --output webchess-release-identity.json "$WEBCHESS_IDENTITY_URL"
node -e 'const m=require("./webchess-release-identity.json"); if(m.schema!=="webchess-release-identity/1"||m.status!=="resolved") process.exit(1)'
export WEBCHESS_RELEASE_SHA="$(node -e 'const m=require("./webchess-release-identity.json"); process.stdout.write(m.source.commit ?? "")')"
test "${#WEBCHESS_RELEASE_SHA}" -eq 40
```

Verify the published source and paper bytes against the same manifest:

```bash
export WEBCHESS_SOURCE_ARCHIVE_URL="$(node -e 'const m=require("./webchess-release-identity.json"); process.stdout.write(new URL(m.source.archive.downloadPath, process.env.WEBCHESS_IDENTITY_URL).href)')"
export WEBCHESS_SOURCE_ARCHIVE_SHA256="$(node -e 'const m=require("./webchess-release-identity.json"); process.stdout.write(m.source.archive.sha256)')"
curl --fail --location --remove-on-error --output webchess-source.zip "$WEBCHESS_SOURCE_ARCHIVE_URL"
printf '%s  %s\n' "$WEBCHESS_SOURCE_ARCHIVE_SHA256" webchess-source.zip | sha256sum --check
export WEBCHESS_PAPER_URL="$(node -e 'const m=require("./webchess-release-identity.json"); process.stdout.write(new URL(m.paper.candidate.pdf.downloadPath, process.env.WEBCHESS_IDENTITY_URL).href)')"
export WEBCHESS_PAPER_SHA256="$(node -e 'const m=require("./webchess-release-identity.json"); process.stdout.write(m.paper.candidate.pdf.sha256)')"
curl --fail --location --remove-on-error --output webchess-paper-3.1.pdf "$WEBCHESS_PAPER_URL"
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
through the 24.x line. Codex Hosted Search additionally requires the official
`@openclaw/codex@2026.7.1-1` provider plugin; its exact installation is pinned
in step 4. Install OpenClaw into a dedicated tool directory and use an isolated
profile instead of replacing an existing global OpenClaw setup:

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
  local webchess_env_name webchess_env_name_normalized webchess_env_value
  local -a webchess_forbidden_provider_env=()
  while IFS= read -r webchess_env_name; do
    webchess_env_name_normalized="${webchess_env_name^^}"
    webchess_env_value="${!webchess_env_name}"
    test -n "$webchess_env_value" || continue
    case "$webchess_env_name_normalized" in
      CLERK_PUBLISHABLE_KEY|NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY|OPENCLAW_VAPID_PUBLIC_KEY|TELNYX_PUBLIC_KEY|WEBCHESS_OPENCLAW_BRIDGE_TOKEN)
        continue
        ;;
    esac
    case "$webchess_env_name_normalized" in
      *_API_KEY|*_API_KEYS|*_API_KEY_*|*_API_TOKEN|*_ACCESS_TOKEN|*_AUTH_TOKEN|*_OAUTH_TOKEN|OPENCLAW_LIVE_*_KEY|OPENCLAW_LIVE_*_KEYS|AMQP_URL|ANTHROPIC_ADMIN_KEY|AWS_ACCESS_KEY_ID|AWS_BEARER_TOKEN_BEDROCK|AWS_CONFIG_FILE|AWS_CONTAINER_AUTHORIZATION_TOKEN|AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE|AWS_CONTAINER_CREDENTIALS_FULL_URI|AWS_CONTAINER_CREDENTIALS_RELATIVE_URI|AWS_PROFILE|AWS_SECURITY_TOKEN|AWS_SECRET_ACCESS_KEY|AWS_SHARED_CREDENTIALS_FILE|AWS_SESSION_TOKEN|AWS_WEB_IDENTITY_TOKEN_FILE|AZURE_AUTH_LOCATION|AZURE_CLIENT_SECRET|AZURE_SPEECH_KEY|CODEX_TOKEN|CODEX_INTERNAL_ORIGINATOR_OVERRIDE|CODEX_EXEC_SERVER_NOISE_CHATGPT_ACCOUNT_ID|CODEX_ROLLOUT_TRACE_ROOT|CODEX_SANDBOX|COPILOT_GITHUB_TOKEN|FAL_KEY|GH_TOKEN|GITHUB_TOKEN|GOOGLE_APPLICATION_CREDENTIALS|HF_TOKEN|HUGGINGFACE_HUB_TOKEN|KUBECONFIG|MINIMAX_CODE_PLAN_KEY|MONGODB_URI|OPENAI_ADMIN_KEY|OPENAI_TOKEN|OPENAI_WEBHOOK_SECRET|REDIS_URL|RUNWAYML_API_SECRET|SPEECH_KEY|SYNOLOGY_CHAT_INCOMING_URL|VOLCENGINE_TTS_TOKEN|OPENAI_BASE_URL|OPENAI_API_BASE|OPENAI_CUSTOM_HEADERS|OPENAI_LOG|OPENAI_ORGANIZATION|OPENAI_ORG_ID|OPENAI_PROJECT|OPENAI_PROJECT_ID|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|http_proxy|https_proxy|all_proxy|BUN_OPTIONS|CODEX_CA_CERTIFICATE|DYLD_INSERT_LIBRARIES|LD_PRELOAD|NODE_DEBUG|NODE_DEBUG_NATIVE|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|OPENCLAW_CONFIG_PATH|OPENCLAW_NODE_EXTRA_CA_CERTS_READY|OPENCLAW_OAUTH_DIR|OPENCLAW_SECRET_SENTINELS|OPENCLAW_STATE_DIR|OPENCLAW_LOG_LEVEL|OPENSSL_CONF|RUST_LOG|SSLKEYLOGFILE|SSL_CERT_FILE|SSL_CERT_DIR|OPENCLAW_BUILD_PRIVATE_QA|OPENCLAW_ENABLE_PRIVATE_QA_CLI|OPENCLAW_QA_FORCE_RUNTIME|OPENCLAW_DEBUG_MODEL_PAYLOAD|OPENCLAW_DEBUG_PROXY_ENABLED|OPENCLAW_DEBUG_PROXY_REQUIRE|OPENCLAW_DEBUG_PROXY_URL|OPENCLAW_DEBUG_PROXY_DB_PATH|OPENCLAW_DEBUG_PROXY_BLOB_DIR|OPENCLAW_DEBUG_SSE|WEBCHESS_OPENCLAW_OWNER_ID)
        webchess_forbidden_provider_env+=("$webchess_env_name")
        ;;
      *_KEY|*_KEYS|*_ACCESS_TOKENS|*_API_TOKENS|*_AUTH_TOKENS|*_BEARER_TOKEN|*_BEARER_TOKENS|*_BOT_TOKEN|*_BOT_TOKENS|*_OAUTH_TOKENS|*_TOKEN|*_TOKENS|*_AUTHTOKEN|*_SESSION_KEY|*_SESSION_KEYS|*_TOKEN_FILE|*_TOKEN_PATH|*_TOKEN_FILE_DESCRIPTOR|*_TOKEN_FD|*_TOKENS_FILE|*_TOKENS_PATH|*_TOKENS_FILE_DESCRIPTOR|*_TOKENS_FD|*_COOKIE|*_COOKIES|*_CREDENTIAL|*_CREDENTIALS|*_CREDENTIAL_FILE|*_CREDENTIALS_FILE|*_KEY_FILE|*_PRIVATE_KEY_PATH|*_PRIVATE_KEY_FILE|*_PRIVATE_KEY_FILE_DESCRIPTOR|*_PRIVATE_KEY_FD|*_PRIVATE_KEY_P8|*_PRIVATE_KEY_PEM|*_PRIVATE_KEY_P12|*_PRIVATE_KEY_PFX|*_PRIVATE_KEY_B64|*_PRIVATE_KEY_BASE64|*_PRIVATE_KEY_JSON|*_CERTIFICATE_PATH|*_CERTIFICATE_FILE|*_CERTIFICATE_FILE_DESCRIPTOR|*_CERTIFICATE_FD|*_CERTIFICATE_P8|*_CERTIFICATE_PEM|*_CERTIFICATE_P12|*_CERTIFICATE_PFX|*_CERTIFICATE_B64|*_CERTIFICATE_BASE64|*_CERTIFICATE_JSON|*_PASSWORD|*_PRIVATE_KEY|*_SECRET|*_SECRETS|NODE_USE_ENV_PROXY|NODE_USE_SYSTEM_CA|NODE_USE_OPENSSL_CA|NODE_USE_BUNDLED_CA|NO_PROXY|YARN_HTTP_PROXY|YARN_NO_PROXY|NPM_CONFIG_HTTP_PROXY|NPM_CONFIG_HTTPS_PROXY|NPM_CONFIG_PROXY|NPM_CONFIG_NOPROXY|BUNDLE_HTTP_PROXY|BUNDLE_HTTPS_PROXY|BUNDLE_NO_PROXY|PIP_PROXY|DOCKER_HTTP_PROXY|DOCKER_HTTPS_PROXY|WSS_PROXY|FTP_PROXY|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE|GIT_SSL_CAINFO|BUNDLE_SSL_CA_CERT|NPM_CONFIG_CAFILE|ELECTRON_GET_USE_PROXY|__CODEX_SNAPSHOT_OVERRIDE|__CODEX_SNAPSHOT_PROXY_OVERRIDE|CODEX_NETWORK_ALLOW_LOCAL_BINDING|CODEX_NETWORK_PROXY_*|OPENCLAW_CODEX_APP_SERVER_BIN|OPENCLAW_CODEX_APP_SERVER_ARGS|OPENCLAW_DEBUG_PROXY_*|OPENCLAW_QA_*)
        webchess_forbidden_provider_env+=("$webchess_env_name")
        ;;
      NODE_TLS_REJECT_UNAUTHORIZED)
        if [[ "$webchess_env_value" != '1' ]]; then
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
```

Run the official narrow OpenAI account-login flow. The
browser OAuth or device-code interaction is a user-only step; never copy its
tokens into WebChess, a shell transcript, an issue, or a case export.

```bash
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models auth login --provider openai --force
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models set "$WEBCHESS_OPENAI_MODEL"
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models fallbacks clear
test "$(openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" config get agents.defaults.model.primary)" = "$WEBCHESS_OPENAI_MODEL"
test -z "$(openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models fallbacks list --plain)"
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" config validate
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" doctor
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" models auth list
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
Do not proceed merely because these commands exit. Confirm that the first,
unfiltered credential listing reports exactly one profile total and that the
provider-filtered listing identifies the same eligible `openai` OAuth profile,
without revealing secret material. The pinned listing displays neither the
credential's account ID nor its stable OAuth subject. The bridge binds the
exact private account ID and a domain-separated SHA-256 digest of that stable
subject, validates both against the access token before any readiness or case
call, and does not print, return, persist in a case, or export either binding
value. No API-key or additional provider profile may remain. Both
the effective per-agent order and the
`auth.order.openai` config override naming only the selected OAuth profile ID,
the primary as the explicit `openai/*` reference in `WEBCHESS_OPENAI_MODEL`, an
empty fallback list, the exact selected model, and a successful
profile-specific probe. If an
API-key credential appears, stop rather than letting a
provider-wide probe consume it. An API-key profile is a different billing/auth
path and does not satisfy this guide's OpenAI-account acceptance criterion.
The per-agent stored order takes precedence inside pinned OpenClaw; both order
commands above must therefore show the same one-element OAuth profile list.
The bridge freezes the selected profile's exact account ID and stable OAuth
subject digest for its whole lifetime and checks both before and after
readiness, status, inference, and search calls. Every current access token must
resolve to that same account ID and subject digest. Same-identity access,
refresh, and expiry fields may rotate normally; a missing, malformed, or
differently bound token fails closed before a call result is accepted.

The Bash gate checks the process environment inherited by every later
`openclaw` command without printing credential values. It normalizes names to
uppercase, treats every nonempty value (including whitespace) as configured,
and reports only original variable names. Every matching key, token, cookie,
password, secret, private-key,
certificate pointer, credential file, cloud profile, custom Codex command,
loader/debug option, endpoint/header, proxy, or QA override named or patterned
in the function must be empty or unset, except for its explicit public and
WebChess-local allowlist. `CODEX_CA_CERTIFICATE` and any user-supplied custom CA
are forbidden. Pinned OpenClaw may internally add
`OPENCLAW_NODE_EXTRA_CA_CERTS_READY=1` together with exactly the first readable
pinned Linux system CA path; the bridge attests that pair and rejects any other
marker/path combination. A nonempty `NODE_TLS_REJECT_UNAUTHORIZED` value is
accepted only when it is exactly `1`; `0` disables TLS verification. Keep the function in this
dedicated Bash session and rerun it immediately before plugin inspection and
launch. `OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`, and
`OPENCLAW_OAUTH_DIR` must be unset before the first command so `--profile`
selects the dedicated profile rather than ambient OpenClaw state. Local owner
and HMAC identity values are generated and persisted privately by the launcher;
ambient overrides for them are rejected. A nonempty variable, any API-key auth profile, or an auth-order entry
other than the selected OAuth profile is a failed readiness result. Do not
bypass the gate or continue via a key; start a clean environment and use the
account/OAuth flow.

The intended candidate model is `openai/gpt-5.6-sol`. If that model is not
listed for the account, set `WEBCHESS_OPENAI_MODEL` to an explicit
`openai/<model-id>` that the pinned OpenClaw version actually reports; its
reviewed documentation identifies `openai/gpt-5.5` as the recovery choice.
Rerun `models set`, `models fallbacks clear`, and both assertions above. Do not
use an alias, another provider, or any fallback. Do not claim that a model was
used unless the case provenance reports it. The profile-specific `models
status --probe` command above is one additional prelaunch provider request and
allowance event, separate from the packed bridge's two per-launch readiness
requests described below.

Official references:

- [OpenClaw 2026.7.1-2 OpenAI provider and OAuth route](https://github.com/openclaw/openclaw/blob/0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c/docs/providers/openai.md)
- [OpenClaw 2026.7.1-2 web-search and Codex provider configuration](https://github.com/openclaw/openclaw/blob/0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c/docs/tools/web.md)
- [OpenClaw 2026.7.1-2 installation requirements](https://github.com/openclaw/openclaw/blob/0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c/README.md)
- [OpenAI Codex authentication](https://learn.chatgpt.com/docs/auth)

OpenAI documents ChatGPT subscription sign-in and usage-based API-key
authentication as distinct methods. This guide uses only the former through
OpenClaw for model inference and Codex Hosted Search. A WebChess-side, Codex,
OpenAI, or alternate-provider API key/token is not a supported fallback.

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
  --env POSTGRES_PASSWORD \
  --env POSTGRES_DB=webchess \
  --mount type=volume,source=webchess-rc1-pgdata,target=/var/lib/postgresql/data \
  --health-cmd='pg_isready -U webchess -d webchess' \
  --health-interval=2s \
  --health-timeout=3s \
  --health-retries=30 \
  postgres:17.10-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193
```

Wait for health, construct the exact loopback URL, and check the server version
inside the container. The `docker exec ... psql` command below uses the
container's local socket; the launcher later validates and uses the saved host
loopback URL.

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
unset WEBCHESS_POSTGRES_PASSWORD
docker exec webchess-rc1-postgres \
  psql --set ON_ERROR_STOP=1 --username webchess --dbname webchess \
  --command='SELECT current_setting('"'"'server_version'"'"');'
```

Only the dedicated loopback URL remains exported. The temporary standalone
password variable is deliberately unset before any OpenClaw process starts;
the auth-only gate would reject a retained `*_PASSWORD` variable.

The URL must use `postgres` or `postgresql`, numeric `127.0.0.1` or `::1`, an
explicit username, password, port from 1 through 65535, and exactly one database
path. Surrounding whitespace, control characters, a query, or a fragment are
invalid. The launcher strips inherited `PG*`/Postgres transport variables and
passes reviewed connection fields explicitly; do not add SSL, host, options,
application-name, timeout, native-driver, or service-file overrides.

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
checking that restored copy. A WebChess **Download case bundle** file is a portable,
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

Pressing Ctrl-C in the launcher shell stops only the foreground WebChess/OpenClaw
process; it does not delete the named PostgreSQL volume or dedicated OpenClaw
profile. If restart is required, retain the database URL in a user-owned
mode-0600 file outside the checkout, never in `.env` or Git. Load that file into
a fresh dedicated shell, rerun `webchess_assert_account_oauth_only`, and launch
the same verified packed plugin. Deleting the named volume is a separate,
destructive teardown step and is not part of stopping or restarting WebChess.

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
test ! -e ../webchess-2.2.0-rc.1.tgz
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
```

Use the packed archive, not a source-link install, for the release acceptance
pass. The launcher stages application code in a disposable directory, listens
only on loopback, and keeps game data in PostgreSQL. OpenClaw resolves and
applies the selected account/OAuth auth object inside the plugin runtime; it
must never be logged, persisted, exported, sent through the loopback bridge, or
returned to the browser or Next.js child.

Treat `capability web providers --json` as a no-query setup check. Its `search`
array must contain an available, selected `codex` entry, and both plugin
inspections must report loaded runtimes. Stop if any of those conditions is
missing. Provider inventory and plugin loading do not submit the research
question or prove account-level Hosted Search execution; only the later
consented, material request can do that. The Codex provider reuses OpenClaw's
selected OpenAI account/OAuth profile, as does model inference. Neither may use
a WebChess-side, Codex, OpenAI, or other provider API key/token. Missing account
capability must fail visibly rather than select a substitute provider or
credential.

The packed bridge does not trust registration alone. At launch and around each
status, model, and search boundary it attests the exact official global Codex
plugin record,
package and lock integrity, reviewed runtime-module bytes, wrapper, and Linux
x86_64 native executable. It binds official Hosted Search to a private client
constructed from the one selected OAuth profile. A missing or modified file,
symlink substitution, unsupported platform, changed auth order, or different
profile fails closed; do not repair that failure by selecting another binary,
credential, provider, or transport. It freezes live OpenClaw configuration and
accepts only one explicit `openai/*` model with empty fallbacks, the `codex`
search provider, `plugins.allow` containing exactly `codex` and `webchess`, no
custom plugin path or extra plugin entry, and the private agent-scoped stdio
Codex app-server contract. Before native Codex starts, database/PG, SSH, HMAC,
bridge, profile, provider, and other secret-bearing variables are cleared; any
live configuration drift fails the request.

## 5. Launch WebChess

Keep the dedicated PostgreSQL container running and the database URL in the
shell that launches OpenClaw:

```bash
set -euo pipefail
test -n "${WEBCHESS_OPENCLAW_DATABASE_URL:-}" || {
  echo 'Return to the shell that created the dedicated database URL; do not guess its password.' >&2
  exit 1
}
export WEBCHESS_RELEASE_SHA="$(node -e 'const m=require("../webchess-release-identity.json"); process.stdout.write(m.source.commit)')"
webchess_assert_account_oauth_only
openclaw --profile "$WEBCHESS_OPENCLAW_PROFILE" webchess --no-open
```

Open the printed `http://127.0.0.1:<port>/openclaw` address in a browser with
JavaScript, cookies/local browser storage, and loopback access. The connected
candidate acceptance target is Google Chrome `150.0.7871.128`; other evergreen
browsers may work but are not represented by that pass. WebGL 2 is optional:
the accessible 2D board remains available when WebGL is absent, the 3D renderer
fails, or the user requests reduced motion.

The startup must fail closed when the model, selected OAuth profile, provider
credential environment gate, OpenClaw runtime, database, migrations, or
local-mode boundary is unavailable. A provider-key variable or API-key profile
is a startup failure. It must not silently call a WebChess-hosted or alternate
provider, Clerk, Neon, or a repository `.env` service.

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

Model/auth status and provider inventory alone do not prove live account
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

The launch probes prove only that the reviewed authenticated model and search
routes worked at that moment. A consented lifecycle search remains a separate request
and can still fail. The packed bridge validates capability `web.search`,
provider `codex`, local transport, and an empty fallback-attempt array before
accepting a lifecycle response. Durable case research records retain provider,
transport, bounded attempt count, planned and executed query data, evidence and
provenance, and any explicit failure/refusal status and code. The subsequent
maximum-three-page retrieval is a separate local WebChess operation.

A bounded Retry child inherits the saved consent choice and can make its own
single lifecycle search plus bounded direct-page requests; a fresh-field Retry
also repeats Division. Those are new account/network transmissions and are
stored/exported with the child's own query, evidence, and lineage.

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
7. Select **Download case bundle** and retain its redaction summary and digest.
8. Select **Import & verify case bundle** for that file. Confirm schema
   `webchess-case-bundle/1`, internal section digests and integrity root,
   event-log replay, terminal board, and recorded provenance. This browser
   check does not compare the bundle with local checkout, runtime-payload, or
   migration bytes.
9. Use **Start another game on this field** only to create a new game
   trajectory. It is not imported replay verification.

For the maintainer's credentialed release gate, use connected Chrome and the
exact non-secret question **“What is the current stable PostgreSQL 17 minor
release today?”** with **Allow bounded research**. Start from the fresh
canonical 32-piece board, click visible **Auto-play to the end** exactly once,
and do not substitute APIs, fixtures, injected events, or repeated one-turn
controls. Let that browser loop reach a real terminal state uninterrupted;
finish visible Portia, Gate, Retry if invoked, Answer, Charlotte, and one Wilbur
action/observation. Require a saved `completed` research record showing
provider `codex`, transport `local`, executed query data, source provenance,
synthesis/evidence, and visible page-fetch outcomes. Reload and confirm the
case, lifecycle, and research persist. Before starting another trajectory,
download a locally retained `private-full-v1` bundle, import and verify it in
the UI, and run the checkout-aware verifier below. Then choose **Start another
game on this field**, reload, and confirm that the same mapped 64-cell field
persists. The UI does not display the replay's source identifier, so the
maintainer must also inspect the successful replay POST response without
modifying it and confirm that the returned game's `sourceGameId` equals the
prior game ID. This ordinary
replay action does not create Retry parent/root lifecycle lineage. The
deterministic suite cannot be reported as this credentialed gate.

After the browser check, run the checkout-aware verifier against the exported
file. Packing into `..` above keeps the checkout clean so an exact commit match
can be reported instead of a dirty-tree warning:

```bash
npm run case:verify -- /path/to/webchess-case-....json
```

Each launcher process first performs one authenticated model-readiness request
and one authenticated Hosted Search readiness request. For `S` terminal
survivors, an accepted initial or fresh-field game then uses `S + 4` model
generations: Division, `S` Portia candidates, one Portia summary, Answer, and
Charlotte. That is 5 to 36 generations for the allowed 1-to-32 survivors. An
accepted same-field child reuses Division and uses `S + 3` (4 to 35). If Gate
refuses the candidate, Answer and Charlotte are omitted, so a same-field path
can stop at `S + 1` and an initial/fresh-field path at `S + 2`. Each game can
also make up to one separately disclosed lifecycle-search invocation, in
addition to the two per-launch readiness requests.
The explicit profile-specific `models status --probe` in the preflight is a
separate, additional provider request and allowance event. Technical retries, a
repeated Portia summary, or the single allowed corrective Answer turn after a
strictly contract-invalid first Answer can add calls. Provider/transport
failure does not trigger that correction. Two Gate-authorized same-field games
and one fresh field can further amplify model calls, context, runtime, and
allowance use. Each Retry child inherits consent and can repeat its own bounded
search/page transmission; a fresh field also repeats Division. No duration or
unmetered-use promise is made.

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

“Connected Chrome” describes the maintainer's interactive acceptance harness,
not a WebChess browser extension. Ordinary researchers open the printed
loopback URL in normal supported Chrome with JavaScript, cookies/local storage,
and loopback access.

See [README.md](README.md) for the immutable version map, lifecycle semantics,
model-call accounting, and publication boundary.
