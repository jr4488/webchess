# WebChess

WebChess is a circular problem-solving game for examining a difficult question
from many angles before acting. It combines:

1. a structured model pass that proposes exactly 64 problem-specific facets;
2. independent, seeded placement of those facets and 64 I Ching-inspired
   change lenses on an eight-ring by eight-sector board;
3. a complete circular-chess game whose captures create an inspectable trail
   of attention; and
4. a second structured model pass that turns the completed game record into a
   candidate answer and three reversible next actions.

WebChess is a thinking aid, not divination, prediction, or evidence. A board
event makes a facet salient; it does not make that facet true. The full method,
limitations, and proposed validation program are documented in the
[technical white paper](docs/WEBCHESS_WHITE_PAPER.md).

## Project status

This repository is the sole canonical WebChess product. It is being rebuilt as
an independent Next.js application for a new Vercel project named `webchess`.
It is not part of MadnessBot.

The public repository and GitHub Discussions are available now. A production
WebChess deployment is **not** claimed by this document. The release process
requires a passing preview deployment, owner inspection, and explicit approval
before production promotion or domain attachment.

## The real method

### 1. Divide the question

The first server-side OpenAI request receives the user's question and proposes
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

The server creates a fresh random seed and derives three domain-separated,
deterministic permutations:

- the 64 facets;
- the 64 I Ching-inspired lenses; and
- the completed facet–lens pairs' board locations.

The resulting field is persisted with its seed and version provenance. A
replay uses the same field; a new division creates a new field.

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

The browser sends only a requested piece and destination plus the expected
game revision. It does not supply authoritative pieces, captures, passes,
outcomes, attention weights, or answers.

The authenticated server loads the persisted division and append-only event
log, reconstructs the board from the canonical initial position, checks every
move, derives forced passes and captures, applies ending precedence, and
commits the next event with an idempotency key and compare-and-swap revision.
This event-sourced record lets an unfinished game survive refresh and lets the
server reject stale or fabricated state.

### 5. Synthesize after a real ending

Only after server replay proves a terminal position does the second OpenAI
request receive:

- the original question;
- the outcome and completed-ply count;
- both side polarities;
- grouped captured facets with recurrence counts and peak attention weights;
- the chronological capture trail.

Ordinary non-capturing moves and uncaptured facets are retained for game
integrity but are not treated as final-answer inputs. Prompt, model, rules,
engine, cast, and software provenance remain with the durable game record
rather than being presented as evidence. The structured answer must include a
direct response, what the conflicts emphasized, the main tension, exactly
three next actions, and conditions that would change the recommendation.

## Production architecture

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
  +--> OpenAI: fixed gpt-5.6-sol model; store: false
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
window. Account exports have separate per-user/IP hourly limits and a
3,000,000-byte default response ceiling. The export is generated synchronously
as one JSON file, with no pagination or background preparation. Oversized
exports are refused; the owner can follow [Support](SUPPORT.md) to ask for
non-sensitive help through GitHub Discussions, without a promise of a custom
data handoff or response time.

A same-key model retry recovers an already committed result or the existing
pending request. If a provider-started lease expires without definitive
settlement, the request is terminally `indeterminate` and a new user intent is
required; WebChess does not silently issue a second provider call. Rejected
provider responses retain only sanitized provider identifiers, safe statuses,
and normalized usage values when available.

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
recreate the account.

No correctness, security, quota, or ownership decision may depend on Vercel
Function memory. See [Architecture](docs/ARCHITECTURE.md) and
[Security](SECURITY.md).

## Run locally

The supported local environment is Node.js 22 and npm 11.

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

The Playwright suite is expected to cover every public route, authentication
redirects, the complete play flow, refresh recovery, downloads, GitHub links,
keyboard operation, accessibility, reduced motion, mobile layout, and desktop
layout. Automated tests must stub OpenAI deterministically, and CI must not
spend live model tokens. After every gate passes, the owner's bounded manual
Preview smoke may use the dedicated Preview key for one complete game—one
division and one post-ending answer—under the normal durable quotas.

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
- [Technical white paper](docs/WEBCHESS_WHITE_PAPER.md)
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
