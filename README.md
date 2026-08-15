# WebChess

WebChess is a circular problem-solving game for examining a difficult question
from many angles before acting. It combines:

1. a structured model pass that proposes exactly 64 problem-specific facets;
2. independent, seeded placement of those facets and 64 I Ching-inspired
   change lenses on an eight-ring by eight-sector board;
3. a complete circular-chess game whose captures create an inspectable trail
   of attention;
4. a concrete answer-generation prompt assembled from the board-derived
   weights, values, routes, and terminal survivors;
5. Portia, a pre-generation adversarial validation of that exact prompt, backed
   by a deterministic Gate and bounded internal Retry policy;
6. an Answer generated only after approval, followed by Charlotte's
   audience-aware qualification and exactly three reversible actions; and
7. Wilbur, a human-owned action and observation record that lets the Web learn
   from what actually happened.

WebChess is a thinking aid, not divination, prediction, or evidence. A board
event makes a facet salient; it does not make that facet true. The full method,
limitations, and proposed validation program are documented in the
[WebChess 2.0 technical white paper](docs/WEBCHESS_WHITE_PAPER_V2.md).

## Project status

The latest tagged product release is **WebChess 2.1** (`2.1.0`). This source
tree identifies the next release candidate as `2.2.0`; until that candidate is
verified and tagged, it is not a published release or evidence of a hosted
deployment.

This repository is the sole canonical WebChess product. The same rules and
visual game now have three deliberately separate runtime surfaces:

- an installable, startup-lazy OpenClaw plugin that launches the complete app
  on the user's own machine, uses that user's configured OpenClaw model and
  provider authentication, and keeps games and lifecycle provenance in a
  dedicated local PostgreSQL 17 database;
- a source-checkout runtime that binds the application and a dedicated Docker
  PostgreSQL 17 database to loopback, uses a server-side OpenAI key, and
  selects either a signed machine principal or a complete Clerk development
  identity; and
- the existing account-backed service architecture for a future independent
  Vercel project named `webchess`.

It is not part of MadnessBot. The public repository and GitHub Discussions are
available now. A production hosted deployment is **not** claimed by this
document. The hosted release process still requires a passing preview,
owner inspection, and explicit approval before production promotion or domain
attachment.

## The real method

### 1. Divide the question

The first structured model request receives the user's question and proposes
one facet for each intersection of eight practical dimensions and eight
movements of change:

| Dimensions | Movements |
| --- | --- |
| Purpose, People, Resources, Timing, Risks, Values, Evidence, Possibilities | Begin, Receive, Clarify, Connect, Challenge, Adapt, Consolidate, Release |

The response must contain exactly 64 schema-valid facets. Deterministic checks
reject missing IDs, duplicate normalized titles or focuses, obvious numbered
scaffolds, dominant number-substitution templates, and widespread lexical
near-duplication. Those checks cannot prove relevance, conceptual
distinctness, correctness, or completeness.

### 2. Cast the field

WebChess creates a fresh random seed and derives three domain-separated,
deterministic permutations:

- the 64 facets;
- the 64 I Ching-inspired lenses; and
- the completed facet–lens pairs' board locations.

The resulting field is saved with its seed and version provenance in the
runtime's owner-scoped PostgreSQL database. A replay uses the same field; a new
division creates a new field.

### 3. Play the complete circular game

The board has eight bounded concentric rings and eight wrapping angular
sectors. Black begins at the center and moves outward, representing inside-out
intent. White begins outside and moves inward, representing outside-in
evidence.

The variant deliberately differs from orthodox chess:

- sectors wrap from 7 to 0, while rings stop at the inner and outer edges;
- Kings are captured directly;
- check, castling, and en passant are absent;
- pawns may make their initial two-ring move and promote to Queens;
- a side with no legal move passes if the other side can move;
- a King capture wins;
- mutual immobility, 100 quiet plies, or 256 total plies produces a draw; and
- a King capture on ply 256 takes precedence over the move-limit draw.

Seven captures mark reflection depth in the interface. They do not stop the
game and are not evidence.

Manual moves, one guided turn, and autoplay all use the same rules. The
purpose-built Engine V2 supplies guided play through iterative principal-
variation search, alpha-beta pruning, aspiration windows, a dual-word hashed
transposition table, rules-aware quiescence and static exchange evaluation,
move-ordering heuristics, promotion-race and King-danger evaluation, and a
deterministic seeded root tie-break. Search runs in a worker so the board stays
responsive. The engine is specific to WebChess's cylindrical, direct-capture,
pass-enabled rules; it is not Stockfish and does not claim an Elo rating.

### 4. Replay and validate

Across all three runtimes, the browser sends only a requested piece and
destination plus the expected game revision. The shared server handler
reconstructs the board from the durable event log, validates the move, and
commits the derived event. The OpenClaw plugin replaces Clerk with a
loopback-only installation principal, Neon with dedicated local PostgreSQL, and
hosted OpenAI calls with OpenClaw. The source-checkout runtime instead uses its
loopback database, the server-side OpenAI path, and either its signed machine
principal or Clerk development identity. The game and lifecycle authority are
unchanged.

No runtime trusts supplied pieces, captures, passes, outcomes, attention
weights, or answers. Each reconstructs the board from the canonical initial
position, checks moves, derives forced passes and captures, applies ending
precedence, and rejects stale or fabricated state.

### 5. Test what survives, then act

Only after server replay proves a terminal position does WebChess derive the
terminal survivor set. The original question and the board's weights, values,
routes, captures, and survivor ecology are assembled into one concrete
answer-generation prompt package. Portia receives that exact package before any
answer exists. It performs all thirteen versioned attack types against every
survivor and classifies each as `preserved`, `wounded`, `consumed`, or
`unresolved`. Survival is explicitly not treated as truth.

Only the OpenClaw runtime can insert automatic external research before
Portia. Its deterministic broker makes at most one Codex Search invocation,
accepts at most five result links and five stored citation candidates, and runs
inside a 150-second envelope. It does not fetch cited pages, and a candidate
link is not proof that WebChess read or verified the source. Hosted and local
source-checkout runtimes do not inject this broker.

Each validated per-signal assessment is persisted as Portia advances, so a
recovered attempt resumes from saved work instead of starting a decorative or
random traversal. Provider-started technical failures are bounded to three
attempts for the run. If the third cannot complete prompt validation, the
lifecycle ends visibly as `portia_unavailable`, preserves completed checks, and
generates no answer.

After a complete Portia review, the internal deterministic Gate requires enough
usable, independent, covered material, a non-redundant tension, and no fatal
unaddressed contradiction. A failed Gate can authorize no more than two
same-field replays and one fresh field generation. Semantic exhaustion ends as
`insufficient_basis`; it never silently reaches Answer or Charlotte.

Only Portia's permission and a persisted Gate pass authorize the Answer model
to receive the exact reviewed board prompt. The generated answer is saved with
that prompt and Gate provenance. Charlotte then reviews and qualifies that
exact answer for truthfulness, uncertainty, stakeholder impact, and audience
fit; it does not replace the approved answer with an unrelated synthesis.
Charlotte cites only the smallest material subset of Portia-approved signals,
retains every cited wound exactly once, and has its own durable three-attempt
technical budget so a provider or contract failure cannot leave the web
spinning forever. The already generated Answer remains visible if that budget
is exhausted, clearly marked as not Charlotte-qualified.
Wilbur lets the authenticated player select one of exactly three bounded,
reversible Charlotte suggestions, mark it in progress, and append a real-world
observation. The stored action is bound to that exact suggestion index, and the
database permits at most one current-bound action for each suggestion in a
lifecycle run; upgrade-preserved legacy actions remain explicitly unbound. Each
create, update, or observation is durably claimed by owner and idempotency key,
so exact retries replay a committed result or denial, changed requests conflict,
and rate admission occurs once. Claims abandoned for 24 hours expire, future
durable-row and exact-text capacity is reserved against a lifetime admission
envelope, and the
artifact, lifecycle activity, and ledger result commit atomically. Action and
observation mutations have independent per-user/IP hourly limits.
The lifecycle, retry ancestry, artifacts, versions, actions, and observations
remain in an owner-scoped provenance record.

## Local OpenClaw plugin

The OpenClaw package is the installation and launch layer for the full visual
WebChess application. It is not a headless game tool. The command starts a
foreground Next.js process bound only to `127.0.0.1`, opens the animated board
in the user's browser, and stops when the user presses Ctrl-C:

```text
openclaw webchess
  |
  +--> local Next.js process at http://127.0.0.1:3210/openclaw
         |-- visual Anansi → Chess → Portia → Answer → Charlotte → Wilbur → Web lifecycle
         |-- shared durable game, replay, usage, and lifecycle handlers
         |
         +--> dedicated PostgreSQL 17 on loopback
         |      +--> question, cast, events, Portia progress, Gate, Answer, Charlotte, Wilbur
         |
         +--> openclaw infer model run --local
                +--> the user's configured model, provider, and authentication
```

It needs no Clerk account, hosted Neon database, Vercel deployment, hosted
WebChess service, or operator-owned API key. It does require a dedicated
PostgreSQL 17 database exposed only on loopback through
`WEBCHESS_OPENCLAW_DATABASE_URL`. The launcher disables hosted identity and
database settings for this process, disables Next.js telemetry, and never puts
a provider credential in the browser. OpenClaw's configured provider may
itself be remote, so model prompts may leave the machine under that provider's
own settings. WebChess does not add a hosted proxy, account, or sync service.
For managed installs, the launcher stages the bundled application in an
operating-system temporary directory, links the plugin's installed
dependencies, and removes that working directory when the command exits. Game
data is never stored there; it remains in the dedicated local database.

The board shows piece movement, the understandable public lifecycle, and the
status of each model request. During Portia it shows the actual persisted
current signal and completed-signal count, moves the spider only when that
durable progress advances, and settles into a stable `portia_unavailable` stop
if the technical budget is exhausted. Answer generation and Charlotte
qualification have their own visible states. Every animation has a text
equivalent and reduced-motion behavior. The interface displays validated facets,
model attribution, elapsed
status, and the final structured reading; it does not request or expose private
chain-of-thought.

From a source checkout:

```bash
npm ci
npm run plugin:build
npm run verify:openclaw
openclaw plugins install --link .
openclaw plugins inspect webchess --runtime --json
openclaw config set tools.web.search.timeoutSeconds 120
export WEBCHESS_OPENCLAW_DATABASE_URL=postgresql://webchess:password@127.0.0.1:55432/webchess
openclaw webchess
```

Use `openclaw webchess --no-open` to print the URL without opening a browser,
or `--port 4312` to choose another loopback port. See
[Installation](INSTALL.md) for source-link and packed-plugin workflows.
`verify:openclaw` builds the plugin entry and exercises the application and UI
checks, but it does not install a packed archive or prove a live OpenClaw
provider/database round trip. A release also rebuilds the committed entry,
requires `git diff --exit-code -- openclaw-plugin/dist`, inspects the `npm pack`
contents, installs that exact archive, and manually exercises the configured
provider, database, and research path. Run `npm run test:integration` with
`DATABASE_URL` pointed at a disposable PostgreSQL 17 database to verify the
shared persistence contract.

## Hosted architecture

```text
Browser
  |
  | Clerk session; no model credential
  v
Next.js on Vercel
  |-- public pages and static downloads
  |-- authenticated game route handlers
  |-- server-only OpenAI Responses API calls
  |
  +--> Clerk: Google, email, and passkey authentication
  +--> Neon Postgres: games, events, usage, quotas, rate limits, leases
  +--> OpenAI: fixed gpt-5.6-sol Division, Portia, Answer, and Charlotte calls; store: false
```

The OpenAI key is a Vercel server secret owned by WebChess. Visitors never
enter, store, or transmit an API key. Clerk sign-in establishes identity only;
it does not use a person's ChatGPT plan or spend that person's ChatGPT tokens.
The WebChess operator pays OpenAI API usage and controls it with durable
per-user and global accounting, rate limits, daily quotas, one active model
request per user, four globally by default, bounded inputs and outputs,
idempotency, and application-owned cost controls. OpenAI spend alerts notify
but do not cap usage. If the operator explicitly enables an OpenAI hard spend
limit, it is a backstop rather than the primary quota and can lag slightly
while tracked spend propagates.

New divisions and replays share the daily game-start allowance and hourly
per-user/IP game-start limits. A replay validates its source, clones the saved
field, records its idempotency intent, activates the child, and consumes the
rate/quota counts in one atomic database transaction—there is no debit-before-clone
window. Wilbur actions and observations have their own per-user/IP hourly
limits. Account export format `webchess-account-export/4` has separate
per-user/IP hourly limits and a 3,000,000-byte default response ceiling. It adds
the owner's pseudonymous user-rate windows and all ten lifecycle recovery fields
to the owner-scoped game, request, research, lifecycle, and artifact data. It
also includes `charlotteBindingVersion` and sanitized Wilbur mutation-ledger
rows, but omits the ledger's private capacity reservations, owner/IP identifiers,
and HMAC material. It does not include shared IP/global counters, Clerk or
vendor data, or a database-restorable backup. The export is generated
synchronously as one JSON file, with no pagination or background preparation.
Oversized exports are refused; Wilbur's admission envelope preserves existing
history and does not guarantee that all other accumulated account data fits. The
owner can follow [Support](SUPPORT.md) to ask for non-sensitive help through GitHub Discussions,
without a promise of a custom data handoff or response time.

A same-key model retry recovers an already committed result or the existing
pending request; WebChess never silently replays the same provider intent. If a
provider-started Portia lease expires without definitive settlement, that
request becomes `indeterminate`. A distinct fenced Portia attempt may resume
from persisted per-signal work, but only within the run's three-attempt
technical budget; exhaustion becomes `portia_unavailable` and blocks Answer.
Rejected provider responses retain only sanitized provider identifiers, safe
statuses, and normalized usage values when available.

The previous Express prototype kept access sessions, CSRF state, revocations,
rate counters, daily quotas, and concurrency in one Node process. That state
would reset or diverge across Vercel Functions. The production replacement is:

| Process-local prototype state | Durable replacement |
| --- | --- |
| Shared access code and signed process session | Clerk user session verified on every protected route |
| Session revocation, deletion pending, and user blocking | Clerk plus `user_controls` in Neon |
| Deleted raw identity used to reset controls | lifetime-stable HMAC marker in `deleted_user_tombstones` |
| Current board and answer | `games` plus append-only `game_events` |
| Per-session and global request counters | `usage_buckets` |
| User/IP request throttles | `rate_buckets` with purpose-separated HMAC identifiers |
| Replay debit followed by an interruptible clone | atomic `game_start_requests`, clone, activation, and counter mutation |
| Model concurrency boolean/counter | leased `model_concurrency_slots` |
| Provider request status and token counts | durable, auditable `model_requests` lifecycle ledger |

Self-service deletion removes content but leaves a suspended raw-ID
`user_controls` marker until Clerk confirms identity deletion; it cancels
reserved work but waits for a provider call already in progress. The signed
`user.deleted` webhook installs the stable HMAC barrier first, wins even over
active work, and then removes raw identifiers and content. Late calls cannot
recreate the account. Artifact-bearing games are deleted through the tested
foreign-key-safe order, including Portia and Charlotte model requests; shared
IP rate windows and vendor backups remain subject to their separate expiry and
retention policies.

No correctness, security, quota, or ownership decision may depend on Vercel
Function memory. See [Architecture](docs/ARCHITECTURE.md) and
[Security](SECURITY.md).

## Local source-checkout development

To run the hosted-service architecture on this machine without OpenClaw:

```bash
npm ci
npm run local:setup
npm run local:dev
```

That command starts loopback PostgreSQL 17, binds Next.js to
`127.0.0.1:3005`, and uses the server-side OpenAI Platform key. With neither
Clerk key, it offers one signed local machine principal. To use Clerk instead,
put a complete development `pk_test_` / `sk_test_` pair in `.env.local`; a
partial pair or live keys fail closed. The launcher identifies this source
candidate as `2.2.0-local` and generates a dedicated
`WEBCHESS_LOCAL_SESSION_SECRET`; preserve that secret with the local database or
the signed principal will no longer address its prior rows. See
[INSTALL.md](INSTALL.md#local-source-checkout-development-without-openclaw).
Only this launcher can auto-migrate the dedicated local database, and it refuses
unrelated pre-existing relations. If it refuses a legacy same-name container
that lacks the ownership label, follow the data-preserving volume-adoption
procedure in the installation guide; never remove the named volume.

## Hosted-service development

The hosted-service development environment remains Node.js 22 and npm 11.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Local play requires development Clerk credentials, a Neon Postgres database,
and a server-side OpenAI Platform project key. Apply every ordered file in
[`db/migrations`](db/migrations) with `npm run db:migrate` and a separate
`MIGRATION_DATABASE_URL` owner credential before using authenticated routes.
The command records canonical checksums and never falls back to `DATABASE_URL`.
The runtime `DATABASE_URL` must use a least-privileged role; do not put the
migration-owner URL in `.env.local`, CI, or Vercel.

Do not place any secret in a `NEXT_PUBLIC_*` variable. The exact site origin,
Clerk publishable key, custom sign-in/sign-up paths, and Clerk fallback
redirects in `.env.example` are intentionally available to the browser.

Detailed setup, Clerk configuration, database migration, preview deployment,
and DNS instructions are in [INSTALL.md](INSTALL.md).

## Verification

Install exactly from the lockfile, then run:

```bash
npm run lint
npm run typecheck
npm run plugin:build
git diff --exit-code -- openclaw-plugin/dist
npm run test
npm run test:coverage
DATABASE_URL='postgresql://...disposable-test-only...' npm run test:integration
npm audit --omit=dev --audit-level=high
npm audit --audit-level=high
npm run build
npm run test:a11y
npm run test:e2e
npm run test:links
npm pack --dry-run
```

The integration URL must name a disposable PostgreSQL 17 database. The plugin
build must leave committed `openclaw-plugin/dist` unchanged, and the package dry
run must contain the intended runtime files without local secrets or test
output.

The Playwright suite is expected to cover every public route, authentication
redirects, the complete play flow, refresh recovery, downloads, GitHub links,
keyboard operation, accessibility, reduced motion, mobile layout, and desktop
layout. Automated tests must stub OpenAI deterministically, and CI must not
spend live model tokens. After every gate passes, the owner's bounded manual
Preview smoke may use the dedicated Preview key for one complete game and its
approved Portia → Answer → Charlotte ending under the normal durable quotas.

The complete Playwright play fixture uses a loopback-only test principal and
stubbed API responses. That principal is disabled on Vercel by design. Preview
inspection therefore uses a dedicated real Clerk test account; a test bypass
must never be enabled in a Vercel environment.

A Vercel preview may be created only after the local and CI gates pass.
Vercel Git auto-deployments are disabled, so Preview and Production releases
are manual exact-revision operations. Production promotion remains separate
and explicitly approved. It rebuilds the inspected source with separately
provisioned Production environment values and is followed by production smoke
checks before the custom domain is attached. Vercel prebuild fails unless the
system project ID exactly matches the separately configured expected WebChess
project ID and the runtime database contains exactly the checked-in migration
IDs and checksums.

## Documentation and downloads

Repository documents:

- [Installation](INSTALL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security policy](SECURITY.md)
- [Privacy notice](docs/PRIVACY.md)
- [Terms](docs/TERMS.md)
- [Acceptable use](docs/ACCEPTABLE_USE.md)
- [Research and evaluation](docs/RESEARCH.md)
- [WebChess 2.0 technical white paper](docs/WEBCHESS_WHITE_PAPER_V2.md)
- [Archived WebChess 1.3 white paper](docs/archive/WEBCHESS_WHITE_PAPER_V1.3.md)
- [WebChess 2.0 operator guide](docs/WEBCHESS_2_0_OPERATIONS.md)
- [Contributing](CONTRIBUTING.md)
- [Support](SUPPORT.md)
- [Apache-2.0 license](LICENSE)

The deployed site reserves these stable download paths:

- `/downloads/webchess-white-paper.md`
- `/downloads/webchess-white-paper.html`
- `/downloads/webchess-white-paper.pdf`
- `/downloads/webchess-installation.md`
- `/downloads/LICENSE`
- `/downloads/webchess-source.zip`

`npm run downloads:generate` creates the document artifacts from their
repository sources. It runs automatically before `npm run dev` and
`npm run build`, so the copies served from `public/downloads` cannot become a
second canonical document set. The generated directory is intentionally not
tracked.

Before a manual deployment, `npm run release:verify-source` refuses tracked or
untracked changes and proves that local `HEAD` exactly matches its live
configured remote branch. Record the verified commit. The source-archive URL
then redirects to GitHub's ZIP for that exact published commit through
`WEBCHESS_RELEASE_SHA` or `VERCEL_GIT_COMMIT_SHA`; when both variables exist,
the prebuild requires them to match. Outside Vercel the route falls back to the
public `main` branch. WebChess never writes or tracks a source ZIP inside its
own source tree.

## Support and community

Use [GitHub Discussions](https://github.com/jr4488/webchess/discussions) for
installation help, usage questions, design proposals, and research criticism.
Use [GitHub Issues](https://github.com/jr4488/webchess/issues) for bounded,
reproducible defects.

Do not post private questions, personal data, credentials, or authentication
artifacts. Report only security vulnerabilities through
[GitHub's private vulnerability-reporting flow](https://github.com/jr4488/webchess/security/advisories/new).

## License

WebChess source and documentation are licensed under
[Apache License 2.0](LICENSE).
