# The Arachne Method and WebChess

## Edition 3.1 replication companion for WebChess 2.2.0-rc.1

**Paper edition:** 3.1\
**Software candidate:** WebChess `2.2.0-rc.1`\
**Release identity:** `webchess-release-identity/1`\
**Status:** implementation and replication companion; no efficacy claim\
**License:** Apache License 2.0

<!-- WEBCHESS_RELEASE_HANDOFF -->

## Abstract

The Arachne Method is an experimental deliberation architecture for resisting
premature closure on difficult questions. WebChess is the reference software
instrument that implements and records one version of that architecture. It
expands a question into a bounded field, uses a deterministic circular-chess
trajectory to derive a replay-verifiable directional record, subjects terminal
survivors, that record, and the exact prospective Answer prompt to structured
adversarial review, permits a
deterministic Gate to refuse, qualifies any approved Answer, and records a
person-owned action and later observation.

This companion maps those ideas to WebChess `2.2.0-rc.1` and gives an external
researcher a fail-closed path from paper or public site to immutable source,
OpenClaw account authentication, a dedicated local PostgreSQL database, a
complete browser lifecycle, and a redaction-aware case export. It also states
what the implementation and its tests do not establish. A legal game, a valid
schema, a passed Gate, a coherent Answer, a verified event replay, or a green
test suite is not evidence that the method improves decisions. The candidate
has no DOI, and no DOI or archive identifier should be inferred from this
document.

## 1. Three names, three scopes

The names are mnemonic boundaries, not interchangeable brands.

### 1.1 The Arachne Method

**The Arachne Method** names the complete experimental architecture. Its eight
named authorities are Anansi, Chess, Portia, Gate, Retry, Charlotte, Wilbur,
and the Web. The **Answer** is an indispensable generated artifact between a
passed Gate and Charlotte, but it is not a ninth authority. Each authority has
a distinct job and a visible failure state. The method is described as a
research hypothesis, not a validated decision procedure.

### 1.2 WebChess

**WebChess** names the software instrument. It supplies the contracts, board
engine, persistence, local runtime, user interface, provenance, and export
needed to inspect a concrete run of the method. Software conformance can show
that a versioned procedure was followed; it cannot establish that the
procedure was wise, that model content was true, or that an action caused an
observed outcome. The exact current method-version tuple is:

| Boundary | Version |
| --- | --- |
| Lifecycle | `webchess-lifecycle-v2.5` |
| Division prompt | `webchess-division-v5` |
| Portia prompt | `webchess-portia-v6` |
| Portia review contract | `webchess-portia-review-v3` |
| Gate algorithm | `webchess-gate-v5` |
| Answer prompt | `webchess-answer-v5` |
| Charlotte prompt | `webchess-charlotte-v7` |

The dependency-free authority is
[`src/lib/lifecycle/method-versions.mjs`](../src/lib/lifecycle/method-versions.mjs);
application and provider modules re-export its values, and the canonical
release identity binds the same tuple. The major boundaries are summarized in
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md).

### 1.3 The ANANSI subroutine

**ANANSI** is the project-authored English mnemonic for work inside the
initial Anansi/Division subroutine:

- **Analyze** actors, tensions, constraints, evidence, unknowns, and possible
  objectives;
- **Name** concerns as inspectable candidate facets;
- **Associate** facets with unfamiliar lenses without treating association as
  truth;
- **Navigate** a traversable field rather than a flat list;
- **Synthesize** coherent candidate structures, not the final Answer; and
- **Iterate** local field repair, not the later lifecycle-level Retry.

These are interpretive subfunctions, not six agents or six serial model calls.
The implemented Division is one structured generation followed by
deterministic validation and, when necessary, bounded repair. ANANSI is a
backronym, not Akan etymology, and the software's naming conveys no ownership
of Ananse or Anansi traditions. The fuller naming and analogy boundaries are
preserved in the historical edition 3.0 paper,
[`docs/WEBCHESS_WHITE_PAPER_V3.md`](WEBCHESS_WHITE_PAPER_V3.md); that paper is
historical evidence and is not silently relabeled as this edition.

## 2. One complete lifecycle

The following sequence is the implemented unit of study. Its durable schemas
are defined in
[`src/lib/lifecycle/contracts.ts`](../src/lib/lifecycle/contracts.ts).

| Authority or artifact | Implemented operation | Required boundary |
| --- | --- | --- |
| Question | Preserve one normalized 12-240 character problem | A question may contain error, bias, or unsafe instructions |
| Anansi / Division | Apply one server-derived I Ching cast direction to each facet ID, then generate exactly 64 bounded facets and explanations under a structured contract | Directional influence is required, but structural and lexical checks do not prove relevance, diversity, or truth |
| Field | Independently permute facets, cast-derived lenses, and completed pairs onto 64 cells from recorded seeds | Reproducibility and variation are not factual evidence |
| Chess | Play a semantically blind cylindrical 8-by-8 variant to a terminal state | Capture and survival allocate attention; they do not establish importance or correctness |
| Trajectory direction | Derive one versioned record from all canonical moves, passes, captures, pieces, survivors, outcome, and cast applications | Deterministic direction is inspectable interpretation, not external evidence or mystical truth |
| Research, if consented and material | Perform one bounded search and guarded direct-page retrieval before Portia | Search synthesis and retrieved text remain untrusted candidate material |
| Portia | Apply 13 attack types to each terminal survivor, then assess the set, directional record, and exact forthcoming Answer prompt | Same-provider criticism is not independent adjudication |
| Gate | Deterministically evaluate sufficiency, coverage, contradiction, prompt binding, and directional binding | A pass authorizes generation; it does not certify truth |
| Retry | Permit at most two additional same-field games and one regenerated field | Exhaustion produces explicit insufficiency, not forced prose |
| Answer | Generate from the exact approved prompt and a versioned projection of the complete record: its digest, eight surviving signals with contributions/support IDs, explanation, boundary, and usable Portia amendments | Answer cannot silently substitute a different evidence or direction package; the complete record remains durable for replay/export |
| Charlotte | Apply its review to produce one standalone corrected final answer from the stored Answer and the same directional projection, then produce exactly three reversible actions | The final answer cannot defer edits, resurrect consumed support, or erase uncertainty; the stored Answer remains provenance |
| Wilbur | Let the person own an action, its status, and an observation | Model output cannot declare that reality succeeded |
| Web | Persist genealogy, versions, provenance, feedback, and selected memory | A durable record is not causal proof or permission for surveillance |

### 2.1 Division, cast, and play

Before Division calls the model, the server derives exactly one immutable cast
assignment for each facet ID from the durable Division seed. Each assignment
contains the analytical dimension, movement, I Ching hexagram/name/theme, and a
concrete directional cue. The model cannot choose, swap, or omit assignments:
it receives all 64 immutable assignments and returns a bounded
`castApplication` keyed to each facet ID. The server rejects provider-supplied
copies of its cast fields, validates every ID, and rebinds the exact assignment
after the response, avoiding a redundant provider echo without losing
provenance. Division still requests exactly 64 problem-specific facets. The
implementation rejects wrong counts, missing applications, duplicate
normalized titles or focuses, and several explainable lexical-collapse
patterns. It cannot decide
whether 64 is the right field size or whether a fluent directionally shaped
facet is genuinely useful; those are evaluation questions. The generation and
validation path is in
[`src/server/openai/division.ts`](../src/server/openai/division.ts) and
[`src/server/openai/division-quality.ts`](../src/server/openai/division-quality.ts).

The accepted facets, their 64 fixed cast-derived change lenses, and board
positions are joined by three domain-separated seeded permutations. The cast
assignment and shuffle versions are recorded so the same field can be
reconstructed. The engine has eight bounded
rings and eight wrapping sectors. White moves outside-in; Black moves
inside-out. Kings are captured directly, forced passes are persisted, and
bounded draw rules terminate non-capturing or overlong play. The canonical
rules and replay boundaries are in
[`src/lib/game.ts`](../src/lib/game.ts),
[`src/lib/game-contract.ts`](../src/lib/game-contract.ts), and
[`src/lib/game-replay.ts`](../src/lib/game-replay.ts).

Every accepted move is replayed from the immutable initial state and ordered
event log. The server, not browser animation, derives captures, promotion,
counters, passes, and outcome. A terminal board supplies a replayable history
and a set of signals for closer examination.

At the terminal lifecycle transition, WebChess deterministically derives
`webchess-directional-record-v1` from that entire canonical history—not merely
from the initial cast or a prose interpretation. The record includes every
move and forced pass in order; exact mover and captured-piece identities,
original/current kinds and material values; capture order and resonance;
promotions; every survivor, route, value, and final cell; terminal winner,
reason, and ply; and all 64 cast assignments/applications. A versioned scoring
method produces all 64 ranked directions and eight stable
`survivingDirectionKeys`, with a human-readable contribution explanation. Its
weights are method parameters, not empirical probabilities.

The complete record, version, and digest are stored atomically with terminal
state. Replaying identical field and event inputs must reproduce the same
digest; a materially different legal capture path, captured value, survivor
set, or outcome can change the ranked directions. This is required directional
influence, not optional decorative metaphor. It also does not turn chess or the
I Ching into factual evidence, prediction, causal proof, or permission to
override verified facts, safety constraints, or consent. Preserved runs created
before this contract remain explicitly `legacy_pre_directional_generation`;
WebChess does not retroactively claim their Division, Portia, or Gate stages saw
a record that did not exist.

### 2.2 Portia, Gate, and Retry

After a terminal game, WebChess constructs the concrete provider-neutral
Answer prompt package before generating the Answer. Portia receives that
package, its digest, the terminal survivors, the verified trajectory-direction
record and digest, and any permitted research or selected Web-memory evidence.
For each survivor, Portia must cite one or more allowed surviving direction
keys, explain how the full-trajectory direction changed its interpretation,
and record a concrete directional amendment while addressing all 13 versioned
attacks: relevance, unsupported assumption,
evidence grounding, redundancy, contradiction, causal overreach, stakeholder
response, seed or path sensitivity, actionability, reversibility, harm or
exclusion, metaphor overreach, and narrative overfitting. A survivor is
classified as preserved, wounded, consumed, or unresolved. The contracts and
deterministic aggregation checks are in
[`src/lib/lifecycle/portia.ts`](../src/lib/lifecycle/portia.ts) and
[`src/lib/lifecycle/contracts.ts`](../src/lib/lifecycle/contracts.ts).

The Gate then evaluates persisted Portia output in code. It checks, among other
things, usable material, independent clusters, coverage, tensions, severe
objections, fatal contradictions, and the digest binding to the exact Answer
prompt. For current runs it additionally requires every usable assessment and
the Portia summary to bind the exact directional record/version/digest and only
its permitted direction keys. A missing or mismatched direction fails the Gate;
direction cannot satisfy missing factual evidence or erase a safety objection.
Its outcomes are Answer, same-field retry, field retry, or insufficient basis.
The algorithm and bounded semantic retry policy are in
[`src/lib/lifecycle/gate.ts`](../src/lib/lifecycle/gate.ts) and
[`src/lib/lifecycle/retry.ts`](../src/lib/lifecycle/retry.ts). Provider-started
technical attempts are separately bounded and persisted; technical exhaustion
is visible rather than converted into a fabricated review.

### 2.3 Answer and Charlotte

Only a prompt and trajectory-direction binding permitted by Portia and a
persisted Gate pass may generate an Answer. WebChess transports the complete
structured prompt and verified direction through an
authenticated loopback OpenClaw bridge instead of placing a large lifecycle
prompt in one process argument. The bridge preserves prompt bytes up to the
durable bound and fails visibly rather than silently truncating evidence; see
[`openclaw-plugin/src/bridge.ts`](../openclaw-plugin/src/bridge.ts) and
[`src/server/openclaw/cli.ts`](../src/server/openclaw/cli.ts).

Answer output is strictly validated. If the first generation returns content
that violates the Answer contract, WebChess may make exactly one corrective
turn using the same approved evidence and bounded disclosure. Provider,
transport, or cancellation failure does not earn that semantic correction.
Portia applies the same bounded principle at candidate granularity: each
structurally or semantically invalid candidate may receive exactly one
corrective turn with a distinct idempotency identity after renewal of the same
durable fence. The rejected response is not copied or persisted, and a second
invalid response fails one run-level attempt under Portia's existing
three-attempt budget. A run with `S` survivors can add at most `S` corrective
generations; across all three attempts the bound is `3S`, in addition to any
repeated nominal candidate and summary calls. The clean `S + 4` topology is the
no-correction accepted path, not a maximum-call claim.
Each lifecycle model request has a 300-second authenticated local bridge
envelope for bounded preflight, one provider turn, and postflight. The provider
turn itself remains capped at 150 seconds. The per-request lease and each
single-generation route reserve 35 additional seconds—335 seconds total: up to
5 seconds to drain the loopback response after the authenticated envelope, then
30 seconds for durable settlement. Neither grace period permits more provider
work; Portia's multi-generation route remains separately bounded.

The complete logical Answer also has a separate hard 300-second deadline across
its initial and possible corrective turns. Each actual provider turn retains
its 150-second ceiling, but a new bridge request does not restart or extend that
aggregate deadline. A hang, lost response, process interruption, or deadline
expiry therefore persists a visible retryable Answer failure and releases the
slot during the drain-and-settlement headroom. If the provider outcome is
unknown, the original request settles `indeterminate`, preventing that durable intent from
being called again or left indefinitely `in_progress`.
The behavior is implemented in
[`src/server/openai/answer.ts`](../src/server/openai/answer.ts) and the local
OpenClaw adapter in
[`src/server/openclaw/v2-generation.ts`](../src/server/openclaw/v2-generation.ts).

Charlotte runs only after the approved Answer is durably stored. It receives
and retains the same directional version/digest and trace, applies its review
against evidence boundaries, values, stakeholders, uncertainty, audience, and
reversal conditions, and returns one standalone corrected final answer plus
exactly three bounded next actions. The earlier Answer remains immutable
provenance. Charlotte's final answer may narrow or correct it but cannot defer
those edits to a nonexistent later stage, substitute unrelated prose, or use a
consumed survivor as support. See
[`src/server/openai/charlotte.ts`](../src/server/openai/charlotte.ts) and
[`src/lib/lifecycle/charlotte.ts`](../src/lib/lifecycle/charlotte.ts).

### 2.4 Wilbur and the Web

Wilbur returns agency to the person who bears consequences. The player chooses
one Charlotte action, names the actor, tested assumption, expected observation,
decision threshold, review horizon, and optional follow-up time, and controls
its status. A later observation distinguishes what was seen, expected and
unexpected effects, stakeholder response, the assumption result, and the next
decision. These fields are human-authored; a model cannot rewrite them.

The Web is both the within-case genealogy and a deliberately bounded feedback
surface. The owner can inspect recent owner-scoped cases and explicitly select
at most eight prior Wilbur observations for a new Division. A durable link
records selection order and consent version. The selected material is labeled
untrusted historical context, not verified fact or permission to repeat an
action. Same-field and field retries inherit the selected evidence so a retry
does not silently change its information basis. No observation is reused
merely because it exists, and this mechanism does not train a global model.
The data types and persistence checks are in
[`src/lib/lifecycle/contracts.ts`](../src/lib/lifecycle/contracts.ts),
[`src/server/lifecycle/repository.ts`](../src/server/lifecycle/repository.ts),
and the owner-scoped API route
[`src/app/api/web-memory/route.ts`](../src/app/api/web-memory/route.ts).

## 3. Optional grounded research

Research search is a separate data flow from lifecycle model generation. It is
off until the player records case-scoped consent. Opting out must leave the
non-search lifecycle usable. When consent is present, a deterministic policy
decides whether external information is material; it does not spend a hidden
model call deciding whether to browse.

One durable broker invocation may request at most five search results and
retain at most five source candidates within a 300-second and 12,000-character
synthesis bound. WebChess may then fetch at most three selected public HTTPS
pages. Each fetch is bounded by time, redirects, raw bytes, accepted media
types, and 6,000 accepted characters. The fetcher rejects credentials in URLs,
non-HTTPS origins, nonstandard ports, IP literals, private or special network
addresses, DNS rebinding, unsafe redirects, ambiguous response headers, and
oversized or unsupported content. It records requested and final URLs,
redirect chain, timestamps, status, raw and accepted-text digests, truncation,
extractor version, and explicit failures.

Search synthesis and page text remain segregated provenance classes. Both are
untrusted. Injection-like lines and tokens are detected and excluded or
quarantined rather than treated as model instructions. Retrieval proves only
what bytes a host returned at a recorded time; it does not prove the host was
correct, independent, current, or representative. The original question and
bounded query may go only to the official pinned Codex Hosted Search provider
under the same selected OpenAI account/OAuth profile as model inference, and
contacted page hosts receive requests from the researcher's local machine. No
WebChess, Codex, OpenAI, cloud-provider, or alternate-provider API key/token is
an accepted fallback. The exact contracts, policy, broker, and network guard are in
[`src/lib/research/contracts.ts`](../src/lib/research/contracts.ts),
[`src/server/research/policy.ts`](../src/server/research/policy.ts),
[`src/server/research/broker.ts`](../src/server/research/broker.ts), and
[`src/server/research/direct-page-fetch.ts`](../src/server/research/direct-page-fetch.ts).
The user-facing boundary is summarized in
[`docs/RESEARCH.md`](RESEARCH.md) and
[`docs/PRIVACY.md`](PRIVACY.md).

The five-minute allowance is coherent across the Hosted Search bridge request,
response parser, requester, durable record, and stale-request watchdog; an older
150-second layer cannot silently win. It adds time headroom only. Query count,
result/source/page counts, redirect/address/body/citation/injection rules, and
consent remain unchanged. Exceeding 300 seconds persists a visible retryable
failure, closes the durable claim, and does not duplicate the same provider
request or leave stale `in_progress` state.

## 4. Provenance, export, and replay

WebChess persists game, event, lifecycle, model-request, Portia, Gate,
Charlotte, Wilbur, research, retry, and selected-memory records in PostgreSQL.
The event stream is append-only, ownership is resolved by the runtime rather
than accepted from a client-supplied user ID, and exact retries use durable
idempotency records. Reloading the browser must reconstruct the same current
case from the database rather than from animation state.

The player can export one lifecycle as `webchess-case-bundle/1` under three
allowlist profiles:

- `private-full-v1` retains the case narrative, model-result artifacts, exact
  current trajectory-direction record, and downstream bindings and should be
  treated as private;
- `research-redacted-v1` omits case narrative while retaining structural
  provenance, seeds, move history, versions, directional digest or an explicit
  omission marker, and other permitted digests; and
- `metadata-only-v1` narrows the retained evidence further.

All profiles can contain linkable timestamps, stable case identifiers,
hostnames, seeds, and unsalted digests. None is guaranteed anonymous. The
offline command `npm run case:verify -- /path/to/bundle.json` checks schema,
section digests, integrity root, internal references, supported versions, and
canonical move legality by reconstructing the initial board and replaying the
event log. For a private full current record it also deterministically re-derives
the trajectory direction and rejects a content, version, or digest mismatch.
Redacted profiles do not claim an omitted record was recomputed, and preserved
legacy cases retain `legacy_pre_directional_generation`. The verifier checks
local artifact compatibility when the necessary identity evidence is present.
It does not call OpenClaw or OpenAI, prove remote
publication, authenticate an author, validate source claims, or establish
efficacy. Its SHA-256 manifest is not a signature.

The UI operation **Start another game on this field** creates a newly counted
trajectory with the same Division; it is useful for cross-path comparison but
is not imported replay verification. The format, omissions, verifier, and
known provenance gaps are documented in
[`docs/CASE_BUNDLES.md`](CASE_BUNDLES.md) and implemented in
[`src/server/case-bundle.ts`](../src/server/case-bundle.ts) and
[`scripts/verify-case-bundle.mjs`](../scripts/verify-case-bundle.mjs). In this
candidate, per-ply policy version, engine-request ID, and fallback-mode columns
are not persisted; exports report those fields as unavailable rather than
inventing `none`.

## 5. The public reader-to-running-game path

The authoritative command transcript is
[`INSTALL.md`](../INSTALL.md). The shorter sequence below explains its
acceptance logic; it is not a substitute for the checked commands and teardown
instructions in that guide.

### 5.1 Resolve the exact source before cloning

At publication, the paper and public site must expose the same generated
`/downloads/webchess-release-identity.json`. A reader should require:

1. schema `webchess-release-identity/1` and status `resolved`;
2. the repository `https://github.com/jr4488/webchess` and a full 40-character
   source commit;
3. the retained source archive path and its SHA-256;
4. this edition 3.1 repository path and the exact published PDF SHA-256; and
5. the exact seven-field method-version tuple in section 1.2; and
6. the pinned OpenClaw, official Codex Search plugin, and toolchain identities.

The reader verifies the downloaded source archive and PDF bytes, clones the
repository, checks out the full commit in detached state, and confirms `HEAD`
matches. An unavailable manifest, null or placeholder field, inaccessible Git
object, or digest mismatch is a release failure. A mutable `main`, `main.zip`,
short SHA, or unverified mirror is not a substitute.

The tracked template intentionally remains unresolved at
[`docs/releases/webchess-release-identity.template.json`](releases/webchess-release-identity.template.json).
Only after this paper is committed and code is frozen can
[`scripts/release-identity.mjs`](../scripts/release-identity.mjs) bind the final
commit, retained source-archive digest, paper path, and PDF digest. Publication
status is therefore manifest-dependent: the candidate is resolved only when
the canonical public manifest reports `resolved`, names the same full commit,
and verifies the named archive and PDF digests. Otherwise the public source
route must fail closed. The tracked document does not contain an invented
future SHA or DOI; the configured download generator adds an exact release
handoff to the published Markdown, HTML, and PDF only after the commit exists.

### 5.2 Use the reviewed local runtime

The candidate replication pins Node.js `24.19.0`, npm `11.14.1`, OpenClaw
`2026.7.1-2` at source commit
`0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`, PostgreSQL `17.10` from the image
digest recorded in the release manifest, and Google Chrome `150.0.7871.128` on
Linux x86_64. That is the only platform/architecture pair whose official Codex
plugin, reviewed runtime modules, wrapper, and native executable this candidate
attests; every other platform fails closed rather than selecting an unattested
binary.
WebGL 2 is optional. Initial load, a new question/game, bounded Retry,
restore/reload, import/verification, and replay all start in accessible 2D; 3D
is an explicit choice for the active UI session. Missing WebGL, renderer
failure, or a new reduced-motion preference returns the interface to 2D.
Browser storage is not used to restore a prior 3D choice.

OpenClaw is installed in a dedicated tool directory and uses a dedicated
profile. The researcher runs OpenClaw's official OpenAI provider login, chooses
an eligible **OAuth/account-authenticated** profile, makes that profile the
only OpenAI auth-order entry for the run, selects a model actually available to
the account, and performs a profile-specific readiness probe. Browser OAuth or
device-code confirmation is a human action; tokens must never be pasted into
WebChess, a case export, the repository, or test output.

On this path, WebChess rejects nonempty provider credential environment
variables and permits no API-key profile or token fallback. Both inference and
official Codex Hosted Search must use the one selected OpenAI account/OAuth
profile. A different authentication or billing path does not satisfy this
replication criterion. Account allowance, workspace controls, credits, OpenAI
policy, and any applicable billing still apply. A readiness probe, a consented
search, and a lifecycle make real provider requests.

At launch and each search boundary, the packed plugin revalidates the exact
official global plugin record, package/lock integrity, reviewed bytes and real
paths, and binds a private official search client to the singleton selected
OAuth store and profile. Any drift is a visible failure, not permission to use
another credential, provider, executable, or transport.

Before accepting a game, each launcher process performs two bounded readiness
requests. The exact prepared `openai/*` model must answer `Reply with exactly
this ASCII token and nothing else: WEBCHESS_READY` with exactly
`WEBCHESS_READY`; the official `codex` provider must complete the fixed query
`OpenAI official website`. Neither contains user/case content, repeats during
status polling, triggers a WebChess direct-page fetch, or is persisted as case
research. Both consume account/network allowance and remain subject to the
provider's data policies. Launch fails closed unless both validate; case-scoped
search consent governs later case content, not these launch gates.

### 5.3 Isolate persistence and install the packed plugin

The reader creates a dedicated PostgreSQL 17 database bound only to
`127.0.0.1`, verifies its exact server version and health, and never substitutes
a production, hosted, Neon, or unrelated local database. The exact official
`@openclaw/codex@2026.7.1-1` provider plugin and the packed WebChess plugin are
integrity-checked, installed into the dedicated OpenClaw profile, inspected,
and launched in the foreground. The launcher stages
the application, binds it only to loopback, applies a checksum-matching
migration prefix, and fails closed when source identity, OpenClaw readiness,
model/auth configuration, PostgreSQL, or local-mode isolation is not ready.
It must not silently fall through to Clerk, Vercel, a hosted or alternate
provider, a cloud database, or any provider key/token. The launcher boundary is in
[`openclaw-plugin/src/launcher.ts`](../openclaw-plugin/src/launcher.ts).

### 5.4 Complete the observable lifecycle

In connected Chrome, the researcher should:

1. confirm the visible `webchess@2.2.0-rc.1` identity and full source commit;
2. enter a non-secret question for which current external evidence is material,
   give separate research consent, and inspect the persisted Codex Search and
   direct-page provenance or an explicit visible failure before Portia;
3. confirm the default accessible 2D view, or explicitly opt in to 3D for the
   current board, and start Division;
4. play manually, use guided moves, or autoplay until the canonical initial
   game reaches a real terminal state;
5. inspect the trajectory-direction version/digest and explanation, verify how
   **What survived scrutiny** and every usable Portia interpretation/amendment
   retain it, then inspect the Gate decision, any Retry ancestry, the approved
   Answer retained as provenance and Charlotte's standalone corrected final
   answer with its directional qualifications already applied;
6. choose and update one Wilbur action and record an observation;
7. reload and confirm that PostgreSQL restores the same case and lifecycle;
8. export a chosen redaction profile, inspect its omission summary, and run the
   offline verifier so it replays the complete event log and, when the full
   current record is present, re-derives its directional digest; and
9. preserve the case digest and, if studying path sensitivity, start a clearly
   identified new game on the same field rather than calling it the same run.

For `S` terminal survivors, the nominal accepted lifecycle uses `S + 4` model
generations: Division, `S` Portia candidate calls, one Portia summary, Answer,
and Charlotte. For the allowed 1-32 survivors this is 5-36 generations, plus at
most one separately disclosed material research search. A contract-invalid
first Answer can add one corrective generation. Contract-invalid Portia
candidates can add up to `S` corrective generations per attempt and `3S` across
the three-attempt budget. Technical attempts, a repeated Portia summary,
Gate-authorized same-field retries, and one fresh-field retry
can amplify model calls, context, runtime, and account allowance. WebChess
makes no fixed-duration or unmetered-use promise.

## 6. Verification evidence and its boundary

Four evidence levels must be reported separately:

1. **Source, unit, and contract tests** exercise pure rules, schemas,
   validation, redaction, and deterministic boundaries.
2. **Database integration tests** exercise selected migrations, ownership,
   idempotency, recovery, export, and transactions in disposable PostgreSQL.
3. **HTTP and browser tests with deterministic provider stubs** exercise a
   complete game and lifecycle without consuming a real account. The strongest
   in-repository system test is
   [`tests/integration/full-lifecycle-http.integration.ts`](../tests/integration/full-lifecycle-http.integration.ts).
4. **A separately gated credentialed acceptance run** uses the exact packed
   plugin, disposable PostgreSQL, real loopback HTTP, an authenticated OpenClaw
   OpenAI account, and connected Chrome through terminal play, postgame stages,
   reload, export, and replay verification.

Passing level 3 does not imply level 4. Passing level 4 demonstrates that one
account and environment completed one execution path; it does not show that
every account, model, operating system, or question will work. Neither level
validates the Arachne Method's efficacy. Reports should state exact test counts
and rerun subsets rather than adding overlapping runs into an inflated total.

## 7. Research status and falsifiable next work

This candidate provides an instrument and protocols, not positive results. No
claim is made that Arachne improves answer accuracy, decision quality,
calibration, creativity, safety, reversibility, or outcomes. No evidence yet
establishes that a 64-cell field is superior to a smaller field, that chess is
better than another attention allocator, that same-model Portia reliably finds
errors, that the cast/trajectory directions improve the result, that Gate
thresholds are well calibrated, or that selected Web memory helps more than it
anchors or leaks. Deterministic record replay demonstrates implementation
conformance and traceability only; it does not validate an I Ching
interpretation or its efficacy.

A credible evaluation should preregister the exact source identity, model,
prompts, versions, seed policy, sample, exclusions, outcomes, and analysis. At
minimum it should compare the full method with a direct-answer baseline and
with ablations that remove or replace Division, chess, Portia/Gate, research,
and prior Web memory. Directional ablations should separately remove the cast
assignment from Division, remove the terminal trajectory record from
Portia/Gate, and replace chess with a preregistered allocator. Cross-seed runs
should preserve the same question and model conditions while varying recorded
field and trajectory seeds; paired legal trajectories should vary capture
order or captured material while holding the remaining inputs fixed where
possible. Every run must preserve the directional version/digest and must not
pool current records with `legacy_pre_directional_generation`. Blinded
raters should assess factual accuracy, relevant coverage, calibration,
reversibility, stakeholder impact, time, model calls, false consumption, false
Gate passes, retry cost, and adverse outcomes. Null and negative findings must
be retained.

Wilbur observations are especially easy to overread. They are player reports,
not randomized causal estimates. Later improvement could reflect learning,
selection, changed conditions, expectancy, or regression to the mean. Any
cross-case study requires explicit consent, de-identification review, and an
analysis of anchoring, privacy leakage, and stale-pattern transfer. The current
research agenda and minimum reporting standard are in
[`docs/RESEARCH.md`](RESEARCH.md).

## 8. Immutable artifact and citation map

The following historical identities remain distinct from the candidate:

| Artifact | Immutable identity | Interpretation |
| --- | --- | --- |
| Last released baseline | WebChess `v2.1.0` at `9980328581ba3e6fed6f2c4fc99b555fec4773bc` | Historical public release baseline |
| Audited Linux 2.2 input | `7a3749cf7f2c4e4c5ebfeb9b9aa870a11843f3a2` | Historical candidate input, not the integrated RC |
| Historical paper edition 3.0 snapshot | `0384978b2ba709da4c9824f2821c8623d3f84364` | Preserved manuscript and audit evidence |
| This integrated candidate | WebChess `2.2.0-rc.1`, full commit in the canonical release identity | Resolved only when that manifest reports `resolved` and its source evidence verifies; otherwise unresolved |
| This paper | Edition 3.1 repository path and PDF SHA-256 in the same release identity | Resolved only when that manifest reports `resolved` and its paper evidence verifies; otherwise unresolved |
| Provider harness | OpenClaw `2026.7.1-2` at `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c` | Pinned external runtime dependency |
| Research provider | `@openclaw/codex@2026.7.1-1` with npm integrity from the release identity | Official Codex Hosted Search under the same selected OpenAI account/OAuth profile |

The exact citation is therefore a tuple, not a product name alone: paper
edition 3.1, WebChess `2.2.0-rc.1`, the 40-character source commit, retained
source-archive SHA-256, paper PDF SHA-256, case-bundle schema, the exact
seven-field method-version tuple, and provider harness identity from the
resolved manifest. The repository's
[`CITATION.cff`](../CITATION.cff) deliberately directs readers to that mapping
and claims no DOI. If the manifest remains unresolved or the named artifacts
are unavailable, the candidate is not citable as a completed public release.

## 9. Conclusion

The release target is not merely merged code or a green suite. It is a public,
auditable journey: encounter the Arachne paper or site; resolve the same
immutable source and artifact digests; clone without private knowledge; use the
documented OpenClaw OpenAI-account path while rejecting provider keys/tokens;
launch an isolated database and packed plugin; play a terminal game; inspect
Portia, the full-trajectory directional record, Gate, Retry, Answer, Charlotte,
Wilbur, and the Web; reload; export; and replay both the event history and
directional digest under an offline verifier. The ordinary journey starts in
2D and leaves the side-elevated 3D world as an explicit session choice.

If any link in that journey is missing, it should be reported as missing. If
the journey succeeds, it establishes inspectability and operational
reproducibility for that environment. The more consequential question--whether
the Arachne Method helps people deliberate or act better--remains open and must
be answered by comparative, consented, falsifiable research.
