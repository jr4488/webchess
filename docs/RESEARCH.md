# Research and evaluation

WebChess is a research program, not a validated decision instrument. Its
proposed benefits should be tested against explicit alternatives.

## Candidate constructs

| Construct | Question | Candidate measures |
| --- | --- | --- |
| Perspective diversity | Does the 64-cell field produce materially distinct frames? | Semantic redundancy, expert ratings, frame coverage |
| Decision quality | Does the process improve choices after evidence is gathered? | Blind rubric scores, calibration, later outcome review |
| Action quality | Does the result produce smaller and more reversible next moves? | Specificity, reversibility, completion rate |
| Epistemic discipline | Can users distinguish resonance, interpretation, and evidence? | Claim audits, uncertainty labels, counterpoint retention |
| Lifecycle learning | Do bounded actions and Wilbur observations improve later decisions without inflating confidence? | Action completion, stopping-rule use, assumption reversals, adverse-effect reporting |

## Minimum reporting standard

A useful evaluation:

- identifies the exact commit or release, rules version, engine version, prompt
  version, and model;
- describes the sample, comparison, procedure, and measures;
- preserves or publishes non-sensitive seeds and replay event logs;
- reports null and adverse findings;
- separates observation from interpretation and uncertainty; and
- shares non-sensitive reproduction materials.

Engine arena results are regression evidence, not an Elo estimate. Structured
output and deterministic facet checks establish bounded conformance, not
semantic quality.

## Automatic research is not evaluation evidence

Only the local OpenClaw runtime can run the automatic pre-Portia research
broker. It is off until the player gives case-scoped, versioned consent.
Deterministic policy permits at most one Codex Search invocation and at most
three guarded direct-page requests within the broker's time, redirect,
address, media, and content limits. The original question and bounded query go
to the configured search provider under the researcher's account; requested
public page hosts see an ordinary network request from the local machine.
Retained URLs, excerpts, timestamps, failures, and content digests become
provenance. A search synthesis or fetched page is untrusted material for Portia
to scrutinize—not a verified fact, study result, or validation of WebChess.
Opting out must leave the non-search lifecycle usable.

The reproducible path pins the official
`@openclaw/codex@2026.7.1-1` provider plugin at npm integrity
`sha512-fRQITjqjC4Q/M6WmkR9XPWPuL+7vcvyVUWIDztB08X2G/mhzSwCYwQp4hugxAtuKmO3yx/7ULMK3nyeKsg5zGw==`.
It must be installed with OpenClaw's supported `plugins install ... --pin`
command, selected as `tools.web.search.provider=codex`, and used with an exact
allowlist of the pinned OpenClaw runtime's bundled `openai` model provider, the
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

For reproducible case exchange, use **Export case** and **Import & verify
case** with schema `webchess-case-bundle/1`. Offline verification checks the
bundle's digests, event-log replay, terminal position, and recorded provenance;
it does not rerun a model, establish that a source was correct, or validate the
method. **Start another game on this field** creates a new trajectory and is
not replay verification.

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
