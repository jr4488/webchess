# WebChess

WebChess is a circular problem-solving game inspired by ideas of change and polarity in the I Ching. Before play, the configured reasoning model proposes a bounded 64-cell perspective map of the player's actual question. Deterministic quality checks reject obvious numbered scaffolds and widespread near-duplicate wording; they do not prove that every facet is relevant, correct, or semantically distinct. The accepted facets are placed across an eight-ring by eight-sector board. White moves from outside evidence inward; Black moves from inner intention outward. Captures identify the facets that deserve closer attention, while each piece contributes a different metaphor.

Each new division uses independent random permutations for the problem facets, the 64 I Ching hexagrams, and the completed facet–hexagram pairs' board positions. A replay preserves the current field so different moves can be compared against the same material; submitting the problem for a new division creates a new field.

The game plays to a real ending: capturing a King (the opposing Core Purpose) wins. A no-move position, 100 moves without a capture, or a 256-move limit supplies a finite draw fallback. Seven captured signals mark reflection depth; they are not evidence and do not stop the game.

After the ending, the server turns the original question, outcome, turn and conflict totals, side polarities, grouped captured facets with recurrence counts and peak attention weights, and the chronological capture trail into an inspectable prompt. Uncaptured facets and ordinary non-capture moves are not sent to the final synthesis. The selected model provider runs that prompt with the configured model (`gpt-5.6-sol` by default), and WebChess displays the answer. The board reading remains visible as an explanation of how the prompt was formed. WebChess is a reflective problem-solving tool, not divination or prediction.

## Run locally

1. Install the locked dependencies:

   ```bash
   npm ci
   ```

2. Copy `.env.example` to `.env`. Set a private `WEBCHESS_ACCESS_CODE` of at
   least 12 characters and a random `WEBCHESS_SESSION_SECRET` of at least
   32 bytes. Select and configure exactly one model provider as described
   below. Keep secrets server-side; never put them in a `VITE_*` variable.

3. Start WebChess:

   ```bash
   npm run dev
   ```

4. Open `http://localhost:5173` for the public explainer or
   `http://localhost:5173/play` to go directly to the game.

WebChess shows an error instead of silently substituting a fallback provider or
generic template when the selected provider cannot run or its bounded quality
checks fail. One new game normally makes two model runs: the initial structured
division and the final answer. In `ollama` mode each of those is preceded by a
short display-copy run, for four in total; see
[Waiting-room rationale notes](#waiting-room-rationale-notes). Replaying the
current board reuses its existing division.

## Model providers

`WEBCHESS_MODEL_PROVIDER` explicitly selects one of three modes. It defaults to
`openai-api`. Provider selection is fail-closed: WebChess never switches to the
another provider because credentials, allowance, readiness, or a request failed.
Changing providers invalidates existing WebChess sessions and requires a new
access-code sign-in.
Direct API usage is billed, Codex mode is constrained by the signed-in plan's
allowance and credits, and Ollama uses this machine's local compute.

`OPENAI_MODEL` selects the model for all modes and defaults to `gpt-5.6-sol`.
The chosen model must be available to the selected Platform project,
ChatGPT/Codex workspace, or local Ollama server.

The first model run sends the original question so it can generate the 64
facets. The final run sends the original question again, plus the outcome,
turn and conflict totals, side polarities, grouped captured facets with their
recurrence counts and peak attention weights, and the chronological capture
trail. It does not send uncaptured facets or ordinary non-capture moves in the
final run.

### `openai-api` — default

```dotenv
WEBCHESS_MODEL_PROVIDER=openai-api
OPENAI_API_KEY=your-platform-project-key
OPENAI_MODEL=gpt-5.6-sol
```

This mode calls the OpenAI Responses API directly. `OPENAI_API_KEY` is required,
and usage is billed to the associated OpenAI Platform project at current API
rates. Configure a Platform project budget as the durable spend backstop.

WebChess sends both Responses API requests with `store: false`. Platform
organization/project retention, data-sharing, prompt-caching, and abuse-
monitoring policies still apply; `store: false` is not by itself Zero Data
Retention. See the official [Platform data controls](https://developers.openai.com/api/docs/guides/your-data).

### `ollama` — local model mode

```dotenv
WEBCHESS_MODEL_PROVIDER=ollama
OPENAI_MODEL=qwen3.6:27b
WEBCHESS_OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
WEBCHESS_UPSTREAM_TIMEOUT_MS=600000
HOST=127.0.0.1
```

This mode uses Ollama's OpenAI-compatible Responses API on the same machine.
Install Ollama 0.13.3 or newer, pull the selected model before starting
WebChess, and keep the endpoint, WebChess listener, and browser origin on
loopback. WebChess rejects endpoint credentials, non-HTTP schemes, non-loopback
hosts, and paths other than `/v1`. `OPENAI_API_KEY` is ignored.

A local runtime enforces structured output by compiling the JSON Schema into a
GBNF grammar, and llama.cpp refuses to parse a character repetition above 2000.
WebChess therefore keeps every schema length bound below that. Note the failure
mode if you extend the schema: a reasoning model compiles the grammar only after
it stops thinking, so an over-limit bound does not return an error. The response
stream simply ends with no completion event, and WebChess reports that the
provider could not be reached. The runtime logs `failed to parse grammar`.

The initial 64-facet generation is much larger than a normal chat response.
`WEBCHESS_UPSTREAM_TIMEOUT_MS` accepts 1–3600000 milliseconds and defaults to
120000; 600000 is a practical starting point for a 27B local model. Ollama must
have enough context for the trusted instructions, player question, and
structured output. The local provider permits one model request at a time.

Ollama mode has no Platform API charge and WebChess does not enable Internet
search for it, but prompts and generated text are processed by the local model
server. Keep `HOST=127.0.0.1`, leave `WEBCHESS_ALLOWED_ORIGINS` empty, leave
`WEBCHESS_TRUST_PROXY=false`, and never expose this mode through a LAN listener
or reverse proxy. See Ollama's [OpenAI compatibility documentation](https://docs.ollama.com/api/openai-compatibility).

### `codex-chatgpt` — optional, single-owner local mode

```dotenv
WEBCHESS_MODEL_PROVIDER=codex-chatgpt
OPENAI_MODEL=gpt-5.6-sol
WEBCHESS_CODEX_WEB_SEARCH=disabled
WEBCHESS_CODEX_HOME=/home/you/.local/share/webchess/codex-home
WEBCHESS_CODEX_PATH=/absolute/path/to/the/static/codex-payload
# WEBCHESS_CODEX_SHA256=64-lowercase-or-uppercase-hex-characters
# WEBCHESS_BWRAP_PATH=/usr/bin/bwrap
# WEBCHESS_CA_BUNDLE_PATH=/absolute/path/to/ca-certificates.crt
```

This mode invokes an already installed Codex CLI and uses the allowance or
credits attached to its signed-in ChatGPT/Codex workspace. Plan, workspace,
model, credit, and rate limits apply; selecting this mode does not guarantee
free or unlimited usage. `OPENAI_API_KEY` is ignored in this mode, even when it
is present. An unavailable CLI, wrong login method, exhausted allowance, or
unsupported model fails the request; it never falls back to `openai-api`.

#### Optional native web search

`WEBCHESS_CODEX_WEB_SEARCH` controls only Codex's native Responses
`web_search` tool:

- `disabled` (the secure default) provides no web search;
- `cached` uses OpenAI's pre-indexed web-search cache;
- `indexed` permits external retrieval only when the search index gates it;
- `live` fetches current information from the web.

The tracked `.env.example` intentionally remains `disabled`. To opt this
checkout into current search, set
`WEBCHESS_CODEX_WEB_SEARCH=live` in the ignored local `.env` and restart
WebChess. This setting applies only to `codex-chatgpt`; it does not add search
to the direct `openai-api` adapter.

This opt-in is deliberately narrow. It does not enable Codex's separate
`standalone_web_search` feature, browser control, shell tools, project
instructions, skills, plugins, or memories. The native search tool does not
grant model-generated shell commands general internet access.

Workspace policy can still make search unavailable. When it is available,
Codex does not request approval for each native search and may issue more than
one query during either model run.

Any non-disabled mode may send search queries derived from the submitted
question and game context outside the local process. A query can disclose a
sensitive subject even when every result is public. Search results are
untrusted content: they can be wrong, outdated, malicious, or contain prompt
injection intended to redirect the model. Cached or indexed retrieval can
reduce exposure to arbitrary live pages, but neither eliminates these risks.
Do not submit secrets or sensitive regulated information, verify consequential
claims against primary sources, and review the signed-in ChatGPT workspace's
data controls before enabling search. See the official
[Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
for the four search modes.

This mode currently requires Linux, a safely installed Bubblewrap, and the
standalone static Linux ELF payload from the audited Codex CLI `0.145.0`.
Ordinary JavaScript launchers such as `bin/codex.js`, shell wrappers, and
dynamically linked Codex executables are rejected. Bubblewrap must be owned by
root, not writable by group or other users, and located beneath directories
with the same ownership and write restrictions. WebChess places each
non-interactive Codex run inside that required Bubblewrap filesystem boundary
and also applies a root-deny Codex permission profile. These are
defense-in-depth controls for the narrowly scoped local integration, not a
basis for exposing an agent process to other users or a network.

Create a dedicated credential home and authenticate it outside WebChess. The
directory must resolve to an absolute canonical path, be owned by the WebChess
user, and have mode `0700`:

```bash
WEBCHESS_NATIVE_CODEX="$(readlink -f "$(command -v codex)")"
WEBCHESS_NATIVE_BWRAP="$(readlink -f "$(command -v bwrap)")"
WEBCHESS_LOGIN_HOME="$HOME/.local/share/webchess/codex-home"
install -d -m 700 "$WEBCHESS_LOGIN_HOME"
file "$WEBCHESS_NATIVE_CODEX"
"$WEBCHESS_NATIVE_BWRAP" --version
"$WEBCHESS_NATIVE_CODEX" --version
CODEX_HOME="$WEBCHESS_LOGIN_HOME" "$WEBCHESS_NATIVE_CODEX" \
  --config 'cli_auth_credentials_store="file"' \
  --config 'forced_login_method="chatgpt"' \
  login
CODEX_HOME="$WEBCHESS_LOGIN_HOME" "$WEBCHESS_NATIVE_CODEX" \
  --config 'cli_auth_credentials_store="file"' \
  --config 'forced_login_method="chatgpt"' \
  login status
realpath "$WEBCHESS_LOGIN_HOME"
sha256sum "$WEBCHESS_NATIVE_CODEX"
```

The `file` result must say that Codex is a 64-bit static or static-pie ELF
executable. If `command -v codex` resolves to a JavaScript or shell launcher,
locate the native payload supplied by your Codex installation instead; do not
configure the launcher. Put the final Codex path in `WEBCHESS_CODEX_PATH`, its
`sha256sum` digest in `WEBCHESS_CODEX_SHA256`, the Bubblewrap path in
`WEBCHESS_BWRAP_PATH`, and the final login-home `realpath` output in
`WEBCHESS_CODEX_HOME`. The SHA pin is optional but strongly recommended.

Do not use the operator's shared `~/.codex` directory. The dedicated directory
must not contain configuration, hooks, rules, project instruction files,
skills, plugins, or memories. WebChess readiness checks the static executable
and optional digest, Bubblewrap and its ancestor directories, directory
ownership and permissions, supported CLI version, and ChatGPT login without
starting an interactive login. It finds common Linux CA bundles automatically;
set `WEBCHESS_CA_BUNDLE_PATH` to an absolute readable bundle only on a
nonstandard system. A failed preflight remains unavailable until the owner
fixes it out of band and restarts WebChess.

The current adapter is intentionally pinned to the exact audited Codex CLI
`0.145.0`. A different CLI version fails readiness until its arguments and event
contract are reviewed and the provider tests and version gate are updated
together.

WebChess does not provide a Codex login screen, accept ChatGPT tokens, or read or
copy credentials from `~/.codex`. The dedicated Codex process reads its own
file-backed credential store. Treat that directory like a password. See the
official [Codex authentication guide](https://learn.chatgpt.com/docs/auth) and
[Codex plan information](https://learn.chatgpt.com/docs/pricing).

This mode has a broader boundary than the direct API call: WebChess starts a
local agent executable, and Codex has its own process permissions, local
credential store, and configuration. The adapter disables project instructions,
skills, plugins, memories, shell and browser tools, the separate standalone
search feature, and normal session persistence. Native Responses web search is
disabled unless the explicit setting above opts into it, but the subprocess
remains a more complex trust boundary than a direct API request. ChatGPT
sign-in uses the selected workspace's ChatGPT permissions and data controls
rather than the Platform API project's `store: false` and organization
controls. Review the workspace's retention, residency, and data-use settings
before submitting sensitive material. See the official
[ChatGPT data-controls FAQ](https://help.openai.com/en/articles/7730893-data-controls-faq).

**`codex-chatgpt` is strictly for one owner on a loopback-only local machine.**
Keep `HOST=127.0.0.1`. Never expose it to a LAN or the internet, put it behind a
reverse proxy, run it as a shared service, or give other users access. Use
`openai-api` for a properly secured server deployment. Restart WebChess after
changing the provider, Codex path, dedicated login, model, or web-search mode.

## What the interface shows while a model runs

Both model stages stream progress to the browser as newline-delimited JSON.
Alongside phase milestones and elapsed time, the activity panel can show text
the model produced on its way to an answer. What is available depends entirely
on the provider, and the panel always labels which of the two it is showing.

### Reasoning stream

| Provider | Shown | Source |
| --- | --- | --- |
| `openai-api` | Reasoning summaries | The Responses API `summary: 'detailed'` stream |
| `ollama` | Raw thinking | The local model's own reasoning events |
| `codex-chatgpt` | Nothing | The adapter pins `model_reasoning_summary="none"` |

An OpenAI reasoning summary is written for a reader and is not the model's
literal internal state. Ollama's raw thinking is literal, and it is shown only
because a local model runs inside the same trust boundary as the request that
started it: nothing leaves the machine. Neither is evidence that the answer is
correct. Draft output text is never streamed in either mode; only the
schema-validated final result is displayed.

The server caps total streamed reasoning per run and buffers deltas before
flushing them, so a long run cannot grow the response without bound.

### Waiting-room rationale notes

`ollama` mode additionally makes a short preliminary run before each main
stage, which returns six one-sentence notes covering assumptions, tensions,
evidence, people, risks, and alternatives. These are deliberate display copy
generated under a separate instruction set, not chain-of-thought, and the
parser accepts only complete `NOTE:` lines from output text. A failure in this
run is swallowed: it can never prevent the division or the final answer.

This is why `ollama` mode makes four model runs per new game rather than two.
The extra runs are local compute only, but they are serial, so they do add to
the wait before each stage begins.

## Production

```bash
npm run build
npm start
```

The production server serves `dist/`, `/api/divide`, and `/api/answer` from the
same process. `OPENAI_MODEL` can override the default model. WebChess displays
the active model and provider for billing provenance; neither value is a
credential.

Only `openai-api` is suitable for a server exposed through a trusted reverse
proxy. API-mode production sessions use `Secure` cookies, so terminate TLS at
the server or trusted reverse proxy and forward requests over HTTPS. The
loopback-only `codex-chatgpt` and `ollama` modes omit `Secure` so their direct
local HTTP cookies work consistently across browsers; they retain `HttpOnly`
and `SameSite=Strict` and must never leave the loopback boundary.

When an `openai-api` deployment is behind a reverse proxy, set
`WEBCHESS_TRUST_PROXY` to the comma-separated IP addresses or CIDRs of only the
proxies that connect directly to WebChess (for example,
`127.0.0.1/32,::1/128`). It defaults to `false`. Trust-all booleans, hop counts,
hostnames, named ranges, and invalid CIDRs are rejected. This lets login
throttling identify the first untrusted client hop without blindly accepting a
caller-supplied `X-Forwarded-For` address.

Running `npm start` with a local provider may serve optimized local assets, but
it does not make that provider safe for production or remote access. It must
remain single-owner and loopback-only, with no reverse proxy.

Sessions are bound to a random process epoch, so every restart requires a new
access-code sign-in and a logged-out cookie cannot become valid again after a
restart. Per-session request limits, the daily 100-call ceiling, and the
concurrency gate are held in process memory. API mode permits four concurrent
model requests by default; local modes permit one. These controls reset when
the process restarts and do not coordinate across multiple replicas. Run one
WebChess API process unless those controls are moved to shared storage. For
`openai-api`, set an OpenAI Platform project budget as the durable spend
backstop. For `codex-chatgpt`, monitor the signed-in workspace's plan allowance
and credits instead; for `ollama`, monitor local GPU memory, RAM, and disk.

## Verification

```bash
npm run verify
npm audit --audit-level=high
```

`verify` runs the offline test suite with coverage thresholds, lint,
TypeScript and production build checks, plus the production dependency
audit. The second command also audits development tooling.

On Debian or Ubuntu, the real Codex containment/no-orphan regression requires:

```bash
sudo apt-get install --yes --no-install-recommends \
  bubblewrap ca-certificates gcc libc6-dev
WEBCHESS_REQUIRE_BWRAP_INTEGRATION=1 npm run test
```

CI installs these prerequisites and makes that integration test mandatory; a
missing or unusable sandbox cannot silently turn the test into a skip.

The offline division-quality fixtures can be run separately with:

```bash
npx vitest run server/division-quality.test.js
```

These fixtures cover obvious templates and lexical near-duplication. They are a regression check, not a substitute for representative model evaluations and human review.

## Circular movement and players

- The board has eight bounded rings and eight wrapping sectors.
- Rooks travel radially or around a ring; bishops travel along ring-sector diagonals.
- Knights, queens, and kings combine the corresponding polar moves.
- White pawns move inward and Black pawns move outward.
- The guided players search several moves ahead, following every exchange to its end before judging a position, and weigh material, King safety, pawn advance, and the squares each piece commands. Search runs in a worker thread and deepens until it has spent a fixed budget of positions, so it thinks for about two seconds a move without freezing the board. Equal moves use a seeded tie-break, and the budget is counted in positions rather than seconds, so replaying the current board follows the same guided path on any machine.
- Castling and en passant are intentionally omitted in this reflective circular variant.
