# Research and evaluation

WebChess is a research program, not a validated decision instrument. Its
proposed benefits should be tested against explicit alternatives.

## Candidate constructs

| Construct | Question | Candidate measures |
| --- | --- | --- |
| Perspective diversity | Does the 64-cell field produce materially distinct frames? | Semantic redundancy, expert ratings, frame coverage |
| Directional traceability | Does the assigned cast and complete chess trajectory produce a reproducible, inspectable change in what is scrutinized and retained? | Record replay agreement, digest agreement, path/seed sensitivity, Portia amendment traceability |
| Decision quality | Does the process improve choices after evidence is gathered? | Blind rubric scores, calibration, later outcome review |
| Action quality | Does the result produce smaller and more reversible next moves? | Specificity, reversibility, completion rate |
| Epistemic discipline | Can users distinguish resonance, interpretation, and evidence? | Claim audits, uncertainty labels, counterpoint retention |
| Lifecycle learning | Do bounded actions and Wilbur observations improve later decisions without inflating confidence? | Action completion, stopping-rule use, assumption reversals, adverse-effect reporting |

## Minimum reporting standard

A useful evaluation:

- identifies the exact commit or release, rules version, engine version, prompt
  version, directional-record version/digest, and model;
- describes the sample, comparison, procedure, and measures;
- preserves or publishes non-sensitive seeds and replay event logs;
- uses current lifecycle-v2.5 cases for executable evaluation; any preserved
  `legacy_pre_directional_generation` artifact is identified as historical,
  inspected read-only, and never pooled with current semantics;
- reports null and adverse findings;
- separates observation from interpretation and uncertainty; and
- shares non-sensitive reproduction materials.

Engine arena results are regression evidence, not an Elo estimate. Structured
output and deterministic facet checks establish bounded conformance, not
semantic quality.

## Direction is inspectable, not factual evidence

Current Division receives a deterministic I Ching cast direction for every
facet ID, and each accepted facet records how that direction shaped it. At the
provider boundary, the model returns that `castApplication` keyed by facet ID;
WebChess retains and rebinds the immutable server-derived assignment instead
of asking the model to echo trusted cast fields. At the
terminal transition, WebChess derives `webchess-directional-record-v1` from the
complete canonical game: ordered moves and forced passes, capture sequence,
exact moving and captured-piece identities, original/current kinds and values,
promotions, survivor routes and material, terminal outcome, and all field cast
applications. Identical inputs must reproduce the record digest; materially
different legal capture paths or captured values should change it.

The record is required in Portia interpretations/amendments, Gate inputs,
Answer and Charlotte prompts/provenance, **What survived scrutiny**, and full
case export. This makes influence testable; it does not make the cast or chess
trajectory a source of external facts, probability, causation, authority, or
efficacy. Verified facts, safety constraints, and consent remain higher-order
boundaries. Historical runs without this contract stay explicitly
`legacy_pre_directional_generation`; retroactive derivation would falsely claim
that their earlier Division, Portia, or Gate stages used information they did
not receive. They are archival evidence only, not supported inputs to provider
generation, gameplay, browser import, replay, Retry, Wilbur, or mutation.

Directional evaluation should compare same-question/model conditions across
recorded field and trajectory seeds, plus legal trajectories that differ in
capture order or material. Useful ablations remove cast direction from
Division, remove trajectory direction from Portia/Gate, or replace chess with a
predeclared allocator. Report both deterministic replay agreement and human or
task outcomes; the first is implementation conformance, not evidence of the
second.

## Automatic research is not evaluation evidence

Only the local OpenClaw runtime can run the automatic pre-Portia research
broker. It is off until the player gives case-scoped, versioned consent.
Deterministic policy permits at most one Codex Search invocation and at most
three guarded direct-page requests. The Hosted Search request has a coherent
300-second ceiling across its bridge, parser, requester, durable record, and
stale-request watchdog; there is no shorter 150-second compatibility cap. The
increase is time headroom only and leaves the broker's result, source, page,
redirect, address, media, and content limits. The original question and bounded
query go
to the configured search provider under the researcher's account; requested
public page hosts see an ordinary network request from the local machine.
Retained URLs, excerpts, timestamps, failures, and content digests become
provenance. A search synthesis or fetched page is untrusted material for Portia
to scrutinize—not a verified fact, study result, or validation of WebChess.
Opting out must leave the non-search lifecycle usable.

If Search exceeds its 300-second end-to-end limit or its process/response is
lost, the case must show a retryable terminal failure and close the durable
claim. It must not retain stale `in_progress` state or duplicate the same
provider request.

Each lifecycle model request uses a 300-second authenticated local bridge
envelope for bounded preflight, one provider turn, and postflight; the provider
turn itself remains capped at 150 seconds. The per-request lease and each
single-generation route provide 35 additional seconds—335 seconds total: up to
5 seconds to drain the loopback response after the authenticated envelope, then
30 seconds for durable settlement. Neither grace period permits more provider
work. Portia's multi-generation route remains separately bounded; each
contract-invalid candidate may receive one corrective provider turn after the
same durable fence is renewed, without copying or persisting the rejected
output. A run with `S` survivors can add at most `S` corrective turns, and the
existing three-attempt budget bounds the total at `3S`. If a correction also
fails, the run-level attempt fails once.
Answer
separately has a hard 300-second logical-operation
deadline across its initial and at most one contract-corrective turn, and no
bridge request restarts that deadline. These operational bounds are not study
outcome measures.

The reproducible path pins the official
`@openclaw/codex@2026.7.1-1` provider plugin at npm integrity
`sha512-fRQITjqjC4Q/M6WmkR9XPWPuL+7vcvyVUWIDztB08X2G/mhzSwCYwQp4hugxAtuKmO3yx/7ULMK3nyeKsg5zGw==`.
It must be installed with OpenClaw's supported `plugins install ... --pin`
command, selected as `tools.web.search.provider=codex`, configured with the
required `tools.web.search.timeoutSeconds=300` inner provider bound, and used
with an exact allowlist of the pinned OpenClaw runtime's bundled `openai` model provider, the
pinned `codex` search provider, and packed `webchess`. WebChess includes the
`openai` entry solely to activate the bundled provider for the selected
account/OAuth model; cached agent model-catalog discovery remains disabled.
This does not make any API-key credential path supported by WebChess.
The exact commands are in
[Installation](../INSTALL.md#4-build-and-inspect-the-exact-packed-plugin).
Inspecting all three plugins and running `capability web providers --json` verifies
local registration without sending a query. A missing `codex` provider is a
setup failure, not permission to substitute another search service or an API
key. The only supported authenticated route uses the same selected OpenAI
account/OAuth profile for model inference and official Codex Hosted Search.
There is no WebChess-side, Codex, OpenAI, alternate-provider API-key, API-token,
service-account, or equivalent fallback. All provider-key environment variables
identified by the installation gate, including `OPENAI_API_KEY` and
`CODEX_API_KEY`, must be empty or unset, and the dedicated OpenClaw auth order
must contain only the chosen OAuth profile; readiness fails closed otherwise.
The non-secret environment check and profile-specific probe are documented in
[Installation](../INSTALL.md#2-install-and-authenticate-the-reviewed-openclaw-version).
This candidate attests the official provider's exact reviewed runtime modules,
wrapper, and native executable only on Linux x86_64. It revalidates those bytes
and binds a private search client to the one selected OAuth profile at the
request boundary; unsupported or changed components fail closed.

Model/auth status and provider inventory alone are not live account proof. Once
per launcher process, the packed bridge requires the exact prepared `openai/*`
model to answer `Reply with exactly this ASCII token and nothing else:
WEBCHESS_READY` with exactly `WEBCHESS_READY`, then sends the fixed non-case
query `OpenAI official website` through the official `codex` provider. Neither
bounded request contains case content, repeats during status polling, triggers
a WebChess direct-page fetch, or enters case research rows or exports. Both
reach the provider and consume account/network allowance; launch fails closed
unless both results validate. Case-scoped consent does not disable these launch
gates. A lifecycle search is a separate request and may still fail. Its durable
request and source records retain provider, transport, bounded attempt count,
planned and executed query data, evidence and provenance, and any explicit
failure/refusal status and code.

That operational search path is distinct from the evaluation program above.
Method claims require preregistered or otherwise explicit comparisons, outcome
measures, adverse findings, and reproducible release identity; automatic search
cannot supply that evidence by itself.

Do not submit confidential questions, credentials, personal data, or regulated
information.

For reproducible exchange of current lifecycle-v2.5 cases, use **Export case**
and **Import & verify case** with schema `webchess-case-bundle/1`. Offline
verification checks the bundle's digests, event-log replay, terminal position,
recorded provenance and, for a private full current-case profile, the re-derived
trajectory-direction record. The retained CLI parser may report a redacted
omission or legacy marker for historical read-only inspection, but a pre-v2.5
artifact is not a supported browser import or runtime/replay source.
Verification does not rerun a model, establish that a source or direction was
correct, or validate the method.
**Start another game on this field** creates a new trajectory and is not replay
verification. Every normal current-case load, new game, Retry, restore, import,
and replay starts in 2D; the optional 3D view is an active-session choice, not a
saved research condition unless a study records it separately.

Read the preserved historical paper,
[The First Answer Is Not Enough](WEBCHESS_WHITE_PAPER_V3.md).
Portia dispositions, Gate passes, and completed software tests are conformance
evidence—not proof that a recommendation is true or effective. The deployed
site reserves:

- `/downloads/webchess-white-paper.pdf` for the code-freeze-mapped edition 3.1
  PDF only; and
- `/downloads/webchess-white-paper-v3-historical.md`,
  `/downloads/webchess-white-paper-v3-historical.html`, and
  `/downloads/webchess-white-paper-v3-historical.pdf` for preserved edition 3.0.
