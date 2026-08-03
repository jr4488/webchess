# WebChess 2.0

## The Eight-Part Spider Lifecycle for AI-Assisted Problem Solving

### Anansi, Chess, Portia, Gate, Retry, Charlotte, Wilbur, and the Web

**A research and technical white paper on divergent generation, constrained conflict, adversarial selection, value-governed action, real-world feedback, and durable provenance**

**Version:** 2.0  
**Date:** August 1, 2026  
**Status:** Proposed architecture, implementation specification, and falsifiable research agenda  
**Current implementation reviewed:** WebChess 0.1.0, repository `jr4488/webchess`, `main` at commit `6d3c7fa0f86d9ec09dd25f899a9fbc12c5b33c67`  
**Prepared for:** The WebChess Project  
**Project lead:** Jack Reynolds

---

## Abstract

WebChess is an AI-assisted problem-solving system that expands a difficult question into sixty-four problem-specific perspectives, independently pairs those perspectives with sixty-four I Ching-inspired lenses, casts the pairs onto a circular chessboard, and plays a complete variant of chess whose captures create an inspectable trail of attention. The present implementation then asks a language model to synthesize that trail into a direct answer and three reversible next actions. Its strongest epistemic safeguard is also its most important admission: the board creates **salience**, not evidence. A strategically selected square may deserve inspection; it does not thereby become true, important, or causally relevant.

This paper proposes WebChess 2.0 as an eight-part lifecycle: **Anansi, Chess, Portia, Gate, Retry, Charlotte, Wilbur, and the Web**. Anansi constructs a plural field of possible interpretations. Chess forces that field through constrained conflict. When a King is captured, the surviving pieces become a terminal ecology rather than an answer. Portia, conceived from the web-invading jumping-spider genus, traverses the surviving network and subjects each candidate to assumption attacks, counterevidence, adversarial stakeholder models, redundancy tests, seed sensitivity, counterfactual removal, and actionability tests. The Gate determines whether enough independent, evidence-bearing, risk-aware, and actionable meaning remains. If not, Retry launches another game with the same field or returns Portia's autopsy to Anansi for semantic regeneration. If the Gate passes, Charlotte converts the defensible survivors into a truthful, value-constrained, audience-aware recommendation. Wilbur represents the person, project, organization, or vulnerable outcome that encounters the recommendation in reality. The Web preserves the entire genealogy: what was generated, what fought, what died, what survived, what was chosen, what was done, and what happened afterward.

The architecture separates functions that ordinary one-pass AI systems routinely blur: imagination from adjudication, adjudication from valuation, valuation from persuasion, recommendation from consequence, and memory from mere transcript storage. The proposed framework is not presented as a scientific revolution, a divination system, or a validated decision engine. It is a conceptual and engineering hypothesis. Its significance depends on whether the explicit separation of generative, adversarial, sufficiency, communicative, empirical, and provenance functions produces measurable gains over direct language-model answers, the current WebChess pipeline, generic self-critique, debate, tree search, and human-only baselines.

---

## Claim discipline

This paper makes four bounded claims.

1. The current WebChess repository implements a coherent, inspectable pipeline for semantic expansion, randomized symbolic casting, complete circular-chess play, server-authoritative replay, and post-game synthesis.
2. The current system already contains recognizable **Anansi-like** and **Web-like** functions: structured multiplicity and durable provenance.
3. The proposed Portia, Gate, Retry, Charlotte, and Wilbur stages would materially alter the architecture rather than merely rename existing components.
4. The resulting eight-part lifecycle is testable through ablation, comparative evaluation, cross-seed analysis, human review, and real-world follow-up.

It does **not** claim that:

- random casting discovers hidden truth;
- chess strength is equivalent to reasoning quality;
- a surviving Portia candidate is proven true;
- Charlotte's recommendation is morally correct because it is eloquent;
- Wilbur's observed outcome establishes causality without an appropriate design;
- the eight-stage system is effective before controlled evaluation;
- Anansi, the Yijing, *Charlotte's Web*, Portia biology, Jung, Turing, Fischer, or Zoroastrian thought somehow anticipated or endorsed this software.

The mythology is a mnemonic architecture. The science begins where the metaphors are converted into explicit contracts, failure states, and experiments.

---

## Contents

1. The problem WebChess is trying to solve  
2. The current WebChess implementation  
3. The eight-part lifecycle  
4. Anansi: imagination and structured plurality  
5. Chess: constrained conflict and terminal ecology  
6. Portia: adversarial traversal and selective consumption  
7. Gate: interpretive sufficiency  
8. Retry: controlled recursion  
9. Charlotte: value-governed synthesis and truthful persuasion  
10. Wilbur: consequence in the world  
11. The Web: provenance, memory, and inheritance  
12. Formal model and reference algorithm  
13. Proposed data contracts  
14. Current implementation versus WebChess 2.0  
15. Theoretical foundations  
16. Cultural and intellectual lineage  
17. Failure modes, risks, and safeguards  
18. Falsifiable evaluation program  
19. Engineering roadmap  
20. Worked example  
21. Conclusion  
Appendices and references

---

# 1. The problem WebChess is trying to solve

## 1.1 Premature semantic collapse

Most AI-assisted problem solving collapses too quickly. A user supplies an ambiguous question; a model infers a likely interpretation; the first coherent frame becomes the organizing frame; and the answer arrives before the problem has been adequately constructed. The result can be polished and useful, but the architecture favors early compression. It rewards the model for making uncertainty disappear in language rather than for preserving unresolved structure long enough to examine it.

Human reasoning suffers analogous pathologies. Problem representation determines which operations seem available. Familiar examples induce fixation. Goal shielding suppresses competing concerns. Confirmation bias recruits contrary information into the preferred story. Creative idea generation and idea selection are separable capacities, and the capacity to produce many candidates does not guarantee the capacity to select well among them (Newell, Shaw, & Simon, 1958; Reiter-Palmon et al., 1997; Jansson & Smith, 1991; Rietzschel, Nijstad, & Stroebe, 2010; Nickerson, 1998).

WebChess begins from a different assumption: before asking a model for an answer, construct a field large enough to make the first answer lose its monopoly.

## 1.2 The central design thesis

The revised thesis is:

> A difficult problem may be handled more responsibly when imagination, conflict, adversarial examination, sufficiency judgment, retry, value-based synthesis, real-world consequence, and memory are implemented as distinct stages with distinct authorities.

This is not the usual generator-critic loop. A critic often inherits the generator's framing, uses the same model, and grades the same fluent artifact. The eight-part lifecycle introduces several separations:

- **Anansi** is rewarded for coverage and distinctness, not final correctness.
- **Chess** is rewarded for coherent constrained conflict, not semantic truth.
- **Portia** is rewarded for finding reasons to reject or qualify survivors, not for producing a recommendation.
- **Gate** is authorized to refuse synthesis when the remaining material is inadequate.
- **Retry** changes the sampled path or the semantic field rather than demanding prose from intellectual wreckage.
- **Charlotte** is rewarded for value fidelity, audience understanding, truthful communication, and reversible action.
- **Wilbur** supplies consequences that no language model can manufacture from rhetoric alone.
- **The Web** preserves lineage, including failure and dissent, so future cycles do not awaken with the memory of a goldfish and the confidence of an emperor.

## 1.3 Why a game at all?

A game supplies bounded rules, role asymmetry, temporal order, visible conflict, and forced termination. It makes selection inspectable. In ordinary model generation, the path from possibilities to final wording is largely hidden and ephemeral. WebChess externalizes a portion of that path as a durable sequence of moves and captures.

The game is not justified because chess is mystical, universal, or inherently wise. It is justified only if its constrained traversal produces useful diversity, attention allocation, or defixation at acceptable cost. That proposition is empirical.

## 1.4 Why spiders?

The spider figures identify functions that are otherwise easy to blur:

- Anansi represents generative cunning, multiplicity, indirection, and the construction of possible worlds.
- Portia represents active testing inside another system's information environment.
- Charlotte represents language used in service of a protected life, audience modeling, and responsibility for downstream consequences.
- Wilbur represents the vulnerable reality for whose sake the architecture exists.
- The Web represents the relational substrate and historical memory that outlasts any single intervention.

The metaphors are useful only while they discipline engineering. The instant they become immunity from measurement, they have become incense in the server room.

---

# 2. The current WebChess implementation

The current repository is not a vaporware sketch. It contains a complete product architecture, a purpose-built circular-chess engine, server-authoritative game replay, structured model calls, durable state design, tests, and documentation. WebChess 2.0 should therefore be designed as an extension of a working epistemic instrument, not as a mythological rewrite that discards the machinery already earned.

## 2.1 Question normalization

The current application accepts an authenticated user's problem as normalized text between 12 and 240 characters. The original problem is retained as the governing reference. This matters because every transformation must remain auditable against the wording that initiated it.

## 2.2 The first model pass: sixty-four facets

The first server-side model request produces exactly sixty-four problem-specific facets. Each facet is assigned to one intersection of eight practical dimensions and eight movements of change.

| Practical dimensions | Movements of change |
|---|---|
| Purpose | Begin |
| People | Receive |
| Resources | Clarify |
| Timing | Connect |
| Risks | Challenge |
| Values | Adapt |
| Evidence | Consolidate |
| Possibilities | Release |

Each facet contains a stable ID, title, concrete focus, practical question, and compact keyword. Application checks reject missing or duplicate IDs, normalized duplicate titles and focuses, obvious numbered scaffolds, dominant substitution templates, and widespread lexical near-duplication. Those checks establish schema integrity and eliminate several cheap failure modes. They cannot prove that the facets are correct, complete, relevant, culturally appropriate, or genuinely independent.

This is the current Anansi-like function: one compressed question becomes a structured plurality.

## 2.3 Independent casting

The server creates a fresh random seed and derives three domain-separated deterministic permutations:

1. a permutation of the sixty-four facets;
2. a permutation of sixty-four I Ching-inspired change lenses; and
3. a permutation of the completed facet-lens pairs onto the sixty-four board locations.

The independence matters. A facet's hexagram lens is not inferred from its meaning, and its location is not a causal map of the problem. The cast is reproducible from the saved seed but not evidentially privileged. It is a mechanism for bounded recombination.

## 2.4 Circular chess

The board contains eight bounded concentric rings and eight angular sectors. Sectors wrap from 7 to 0; rings terminate at the inner and outer edges. Black begins in the center and advances outward, representing **inside-out intent**. White begins outside and advances inward, representing **outside-in evidence**. White moves first.

The variant intentionally differs from orthodox chess:

- Kings are captured directly; there is no check or checkmate.
- Castling and en passant are absent.
- Pawns may make an initial two-ring move when clear.
- Pawns promote to Queens at the far ring.
- A side with no legal move passes if the other side can move.
- A King capture wins.
- Mutual immobility, 100 quiet plies, or 256 total plies produces a draw.
- A King capture on ply 256 takes precedence over the move-limit draw.

The game can be played manually, one guided turn at a time, or through autoplay.

## 2.5 Engine V2

The guided player is a purpose-built engine for WebChess's cylindrical, direct-capture, pass-enabled rules. It uses iterative deepening, principal-variation alpha-beta search, aspiration windows, a dual-word hashed transposition table, rules-aware quiescence, static exchange evaluation, move-ordering heuristics, promotion-race evaluation, King-danger evaluation, and a deterministic seeded root tie-break. Search runs in a worker and uses a deterministic default budget of 150,000 nodes.

The engine is strategically sophisticated and semantically blind. It does not read the facet on a square, assess external evidence, understand the user's domain, or decide that one perspective is intellectually superior. It selects moves according to the game evaluation.

That distinction is foundational:

> Better chess under WebChess rules is not the same thing as better reasoning about the user's problem.

## 2.6 Captures as salience records

When a piece captures another piece, the destination square's facet-lens pair enters the chronological capture trail. The active piece and captured piece supply role metaphors. The current attention weight is calculated from the value of the challenged piece, the value of the active piece, and a middle-ring meeting bonus.

This score is not probability, confidence, evidence quality, moral weight, or objective importance. It is a designed display measure that helps organize attention.

## 2.7 Server-authoritative replay

The browser proposes only a piece ID, destination, and expected game revision. The server loads the persisted division and append-only event stream, reconstructs the board from the canonical initial position, validates every move, derives captures and promotions, inserts forced passes, applies ending precedence, and commits the next event atomically with an idempotency key and compare-and-swap revision.

This is the present Web-like function. The system retains a replayable genealogy rather than trusting client state or preserving only a final answer.

## 2.8 The current final model pass

Only after canonical replay proves a terminal position does the second model call occur. The answer model receives:

- the original question;
- the outcome and completed-ply count;
- the meaning of the White and Black polarities;
- grouped captured facets with recurrence counts and peak attention weights; and
- the chronological capture trail.

It must produce a direct answer, what the conflicts emphasized, the central tension, exactly three next actions, and conditions that could change the recommendation.

This is a proto-Charlotte function, but it is not yet Charlotte in the stronger architectural sense. The model synthesizes a sample selected by the game. It does not receive a separate Portia adjudication, a formal sufficiency decision, an explicit protected outcome, a stakeholder model, or evidence from real-world action.

## 2.9 Current production architecture

The repository's production design uses Next.js App Router on Vercel, Clerk authentication, Neon Postgres for durable games and accounting, and server-only OpenAI Responses API calls. The model is fixed in server code as `gpt-5.6-sol`; structured outputs and application-level validation bound both model operations (OpenAI, 2026; WebChess Project, 2026). Model calls use `store: false`. Visitor credentials are never accepted. Ownership, quota, rate limits, idempotency, concurrency leases, deletion barriers, and event integrity are durable rather than process-local.

These are engineering facts about the repository reviewed for this paper. They do not establish that a production deployment has been promoted, nor that the cognitive method is effective.

## 2.10 The architectural gap

The current pipeline is approximately:

> Anansi-like expansion -> randomized cast -> semantically blind chess traversal -> proto-Charlotte synthesis -> Web-like storage.

The missing functions are not cosmetic:

- no semantic hunter attacks the terminal survivors;
- no independent Gate can declare the surviving material insufficient;
- no explicit Retry policy distinguishes bad traversal from bad decomposition;
- no Charlotte stage is formally constrained by values, stakeholders, and Portia's rejections;
- no Wilbur stage records execution and consequences;
- no cross-game memory converts provenance into cumulative learning.

WebChess 2.0 is the proposed repair.

---

# 3. The eight-part lifecycle

The complete lifecycle has eight parts, deliberately echoing the eight-legged creature that supplies its governing imagery.

| Part | Core function | Governing question |
|---|---|---|
| **Anansi** | Create sixty-four possible perspectives | What else could this problem mean? |
| **Chess** | Force the perspectives through constrained conflict | What path emerges under stable rules? |
| **Portia** | Hunt the terminal survivors and consume the weak | What cannot survive serious examination? |
| **Gate** | Determine whether enough independent meaning remains | Is there a sufficient basis for synthesis? |
| **Retry** | Replay the game or regenerate the field | Was the failure in traversal or representation? |
| **Charlotte** | Turn defensible survivors into responsible action | What should be done, for whom, and how should it be said? |
| **Wilbur** | Encounter reality and bear consequences | What happened when the recommendation met the world? |
| **Web** | Preserve the complete genealogy | What must the next cycle remember? |

The canonical formulation is:

> **Anansi imagines. Chess creates conflict. Portia hunts. The Gate judges sufficiency. Retry renews the search. Charlotte chooses and communicates. Wilbur encounters reality. The Web remembers.**

## 3.1 Control flow

The lifecycle is not a simple one-way conveyor belt.

```text
Question
   |
   v
Anansi -> Chess -> Portia -> Gate
                           /    \
                        fail    pass
                         |        |
                         v        v
                       Retry   Charlotte -> Wilbur -> Web
                       /   \                         |
                 new game  revise field             +--> later Anansi cycle
```

Retry has two levels:

1. **Game retry:** preserve the same semantic field but create a new cast or independent game trajectory.
2. **Field retry:** after repeated collapse, return Portia's autopsy to Anansi and regenerate or repair the sixty-four facets.

The process must also terminate. After a versioned retry budget is exhausted, the system should return an explicit insufficiency result rather than force Charlotte to manufacture meaning from carrion.

## 3.2 Not eight chatbots in costume

The stages should not be implemented as eight free-form personalities exchanging essays. That design would generate a mythological committee meeting and then bill the user for the minutes.

Each stage requires:

- a typed input contract;
- a typed output contract;
- an explicit authority boundary;
- deterministic validation where possible;
- a defined failure state;
- versioned parameters and prompts;
- provenance linking inputs to outputs; and
- an ablation test showing whether the stage contributes measurable value.

The names improve human comprehension. The contracts create an architecture.

---

# 4. Anansi: imagination and structured plurality

## 4.1 Cultural lineage and design responsibility

Anansi is not a generic Western mascot for cleverness. Ananse stories belong to Akan narrative traditions and traveled through the African diaspora, where they acquired new forms and political meanings. Scholarship describes Anansesem as performance, social indirection, collective memory, pedagogy, identity construction, and, in Jamaican history, a resource for cultural resistance (Arthur, 2019; Marshall, 2012).

WebChess should therefore state its borrowing explicitly. It should invite review by Akan, Ghanaian, Caribbean, folklore, and performance scholars. The system uses Anansi as a design archetype of plural generation and strategic indirection; it does not claim ownership of the tradition or reduce a living body of stories to a software logo.

## 4.2 The ANANSI mnemonic

Within WebChess, **ANANSI** stands for:

- **A - Analyze:** identify actors, tensions, constraints, evidence, unknowns, and possible objectives.
- **N - Name:** make latent concerns explicit as distinct candidate facets.
- **A - Associate:** connect each facet to a movement, role, or unfamiliar lens without claiming that the association is true.
- **N - Navigate:** place candidates into a traversable field rather than a flat list.
- **S - Synthesize:** formulate each candidate as a coherent, inspectable proposition or question.
- **I - Iterate:** repair duplicates, gaps, generic wording, and failed candidates before releasing the field.

This mnemonic belongs to the **Anansi subroutine**, not the entire eight-part lifecycle. In particular, Anansi's “Synthesize” does not mean final recommendation; it means coherent candidate construction. Anansi's “Iterate” does not replace the later Retry stage; it refers to local repair while generating the field.

## 4.3 Current implementation

The existing 8 x 8 grid already supplies a disciplined form of divergent generation. It prevents the model from producing sixty-four variations on the same sales pitch because every ID is anchored to a dimension-movement intersection. The deterministic quality checks eliminate several structural failures before the game begins.

## 4.4 Proposed WebChess 2.0 requirements

Anansi 2.0 should produce more than polished facet text. Each candidate should include:

- the literal problem facet;
- the dimension and movement slot;
- the underlying assumption or uncertainty;
- evidence status: observed, sourced, assumed, valued, predicted, or unknown;
- affected stakeholders;
- a possible disconfirming observation;
- an action or question that could reduce uncertainty; and
- provenance showing which user text or supplied evidence motivated it.

The user should be able to inspect, merge, reject, or amend facets before casting. A sixty-four-item schema can create false completeness; user correction is one defense against the model's ability to fill every box with syntactic confidence.

## 4.5 Anansi's optimization target

Anansi should be evaluated on multiple axes rather than a single “quality” score:

- coverage of distinct problem regions;
- semantic independence;
- relevance to the original question;
- diversity of assumptions and stakeholder positions;
- evidence awareness;
- actionability;
- lexical distinctness; and
- calibration about what is unknown.

Novelty without relevance produces decorative noise. Relevance without variation reproduces the user's initial frame. The target is bounded semantic distance.

## 4.6 Failure modes

Anansi can fail by:

- producing generic consulting language;
- hiding duplication beneath different nouns;
- inventing stakeholders or facts;
- treating the grid as exhaustive;
- overrepresenting easy categories and neglecting power, ethics, or evidence;
- generating facets that cannot be tested or acted upon; or
- using culturally loaded metaphors as if they were neutral.

Portia can expose some of these failures, but upstream quality is cheaper than downstream predation. The most elegant hunter cannot extract nutrition from sixty-four papier-mache flies.

---

# 5. Chess: constrained conflict and terminal ecology

## 5.1 The function of Chess

Chess is the lifecycle's conflict engine. It does not determine truth. It forces generated possibilities into a bounded, sequential encounter governed by stable movement rules. The result is a path through the field that is neither a direct semantic ranking nor unconstrained randomness.

The game contributes:

- temporal order;
- role persistence;
- opposition between outside-in evidence and inside-out intent;
- local encounters between pieces and facets;
- path dependence;
- visible captures;
- forced termination; and
- a replayable record.

## 5.2 Why complete play matters

Stopping after seven captures because the interface has “enough insight” would bias the system toward early conflict and discard the strategic consequences of those captures. The current implementation correctly treats seven captures as a reflection-depth indicator rather than an ending. The game continues until a real terminal condition.

A complete game yields a **terminal ecology**:

- captured pieces and the facets activated by their captures;
- surviving pieces and their final locations;
- routes taken through the board;
- conflicts initiated and survived;
- promotions;
- pass events;
- the captured King or draw condition; and
- the entire move sequence.

WebChess 2.0 shifts emphasis from the capture trail alone to this full ecology.

## 5.3 The surviving piece as a candidate package

A terminal survivor should be represented as:

```text
S_i = {
  facet,
  change_lens,
  piece_role,
  side_polarity,
  final_square,
  route_history,
  captures_made,
  threats_or_exchanges_survived,
  game_outcome_context,
  cast_and_engine_provenance
}
```

Not all elements exist explicitly in the present database. Route history can be reconstructed from the event log. Threats survived would require additional derived analysis or engine telemetry and should not be fabricated retroactively.

The surviving piece is not “correct” because it remained on the board. Survival means only that this piece was not captured in this game under this cast, engine, seed, and move history.

## 5.4 The captured King

King capture ends Anansi's conflict phase. It should be interpreted as a termination signal, not as an oracle. The winning polarity has reached the opposing Core purpose under the game rules. It does not prove that external evidence should dominate intention, or that intention should dominate evidence.

The King capture is the bell that wakes Portia.

## 5.5 Chess as selection without semantic authority

The semantically blind engine is both a strength and a weakness.

It is a strength because it prevents the language model from simply ranking its own favorite facets and then pretending the game discovered them. It creates an independent traversal.

It is a weakness because chess coherence may select semantically irrelevant squares. A brilliant tactical sequence can be intellectually useless. The proposed architecture does not conceal this defect; it assigns Portia and the Gate to confront it.

## 5.6 Experimental alternatives

The current engine should remain one condition, not the unquestioned heart of the method. Evaluation should compare:

- Engine V2;
- random legal play;
- human play;
- shallow versus deep engine play;
- a semantic move policy;
- a coverage-maximizing policy;
- a value-of-information policy; and
- mixed policies that alternate strategic and semantic objectives.

If a cheaper random walk produces equal or better downstream results, the engine's tactical grandeur becomes expensive theater. The experiment should be allowed to say so.

---
# 6. Portia: adversarial traversal and selective consumption

## 6.1 The biological source

Portia is a genus of jumping spiders specialized in preying on other spiders. Research describes Portia entering prey webs, using aggressive-mimicry signals, exploiting the resident spider's perceptual system, deriving effective signals through trial-and-error or generate-and-test behavior, and making route decisions that can involve detours (Jackson, 1995; Jackson & Nelson, 2011; Jackson & Cross, 2013; Cross & Jackson, 2019).

The prey web is not merely a trap. It is part of the resident spider's sensory apparatus. Portia succeeds by operating inside another organism's information environment.

The engineering analogy is exact enough to be useful and limited enough to require discipline:

- the terminal WebChess state is an information network;
- surviving candidates are adaptive intellectual prey;
- Portia probes how each candidate responds under pressure;
- the attack changes according to feedback;
- Portia may preserve, wound, consume, or leave unresolved what it encounters.

WebChess does not claim that Portia possesses human-style theory of mind, moral judgment, or abstract logic. Animal-cognition findings motivate a design metaphor; they do not authorize anthropomorphic mythology as evidence.

## 6.2 Portia hidden at the center

During Anansi and Chess, Portia remains hidden at the center of the Web. This separation is architecturally important. If Portia influences facet generation or move choice too early, the system may prune unconventional material before it has had a chance to interact.

When the King is captured, Portia wakes and traverses the terminal board. The surviving pieces are “living food” in the sense that each embodies a still-active interpretive proposition. Portia's task is to determine which propositions are nourishing enough to preserve and which should be consumed before Charlotte sees them.

## 6.3 Portia's input

Portia should receive:

- the original user question;
- user-supplied evidence and source links, when available;
- all sixty-four original facets;
- the cast seed and three permutations;
- the complete move and pass history;
- the terminal board;
- every survivor package;
- the capture trail;
- engine and rules versions;
- prior retries and prior Portia judgments; and
- explicit user constraints on cost, risk, values, and affected parties.

Portia should not receive only Charlotte's polished draft. Hunting the prose after synthesis would be useful red teaming, but it would occur too late and would preserve the generator's compression. Portia's primary prey is the pre-synthesis candidate ecology.

## 6.4 Portia's attack library

For each survivor, Portia should run a versioned battery of attacks. Not every attack will apply to every candidate. “Not applicable” must remain distinct from “passed.”

### 6.4.1 Assumption attack

Identify the candidate's load-bearing assumptions. Ask whether the proposition collapses if any one assumption is false. Distinguish explicit assumptions from those smuggled in by fluent wording.

### 6.4.2 Counterevidence attack

Search the supplied evidence, approved external sources, or structured user observations for facts that contradict or narrow the candidate. When no evidence source exists, Portia should label the candidate unverified rather than hallucinate a rebuttal.

### 6.4.3 Adversarial stakeholder attack

Model the response of a stakeholder whose incentives differ from the user's. This is not generic “devil's advocacy.” The stakeholder must have a named interest, capability, information advantage, and plausible action.

### 6.4.4 Causal relevance attack

Ask whether the candidate concerns a driver, a symptom, a correlate, a constraint, or a rhetorical distraction. A proposition can be true and still irrelevant to the decision.

### 6.4.5 Redundancy and independence attack

Compare the survivor to other survivors. If two candidates depend on the same evidence, assumption, stakeholder, and causal mechanism, they are not independent merely because the model used different adjectives.

### 6.4.6 Seed and cast sensitivity attack

Test whether the candidate's survival depends on one arbitrary cast or path. Recurrent survival across independent games may increase interest, but recurrence is not proof. A popular error can win every election held inside the same flawed constitution.

### 6.4.7 Counterfactual removal attack

Remove the candidate or its highest-weight supporting capture from the evidence package and regenerate a bounded interpretation. If the conclusion remains unchanged, the candidate may be ornamental. If the conclusion reverses completely, the system should examine whether the candidate has genuine support or merely brittle leverage.

### 6.4.8 Actionability attack

Ask what observation, conversation, prototype, or reversible intervention follows from the candidate. A proposition that cannot influence inquiry or action may still be philosophically interesting, but it should not dominate operational advice.

### 6.4.9 Failure-mode simulation

Assume Charlotte acts on the candidate. Identify foreseeable ways the intervention fails, who bears the downside, how failure would be detected, and whether damage is reversible.

### 6.4.10 Unsupported-claim audit

Separate user facts, externally sourced facts, model inferences, symbolic associations, values, and predictions. Any candidate that converts a randomized lens into a factual claim should be consumed immediately.

## 6.5 Four dispositions

Portia should classify each survivor into one of four states.

| Disposition | Meaning | What Charlotte may do |
|---|---|---|
| **Preserved** | Survived meaningful attacks with bounded residual uncertainty | Use as a principal input |
| **Wounded** | Retains value only under explicit qualifications or narrower scope | Use with scars visible |
| **Consumed** | Unsupported, redundant, irrelevant, unstable, or dangerously misleading | Do not resurrect |
| **Unresolved** | Evidence or context is insufficient to adjudicate | Treat as an open question, not a conclusion |

Binary keep/kill logic would be crude. Most serious propositions survive in narrower form. Portia's output should preserve the wound: what failed, what remained, and what new evidence is required.

## 6.6 Survival is not truth

Portia performs attempted falsification, not metaphysical certification.

> A preserved candidate means that the implemented attacks failed to destroy it under the available evidence and budget.

It does not mean that the candidate is objectively true. A weak attack suite, evaluator bias, missing evidence, or correlated model error can preserve nonsense. Portia must report attacks attempted, attack coverage, evaluator identity, source coverage, uncertainty, and known blind spots.

## 6.7 Portia cannot be one model grading itself

Research on model self-refinement shows that iterative feedback can improve outputs in some settings, while other work finds that intrinsic self-correction without external feedback can fail or degrade reasoning (Madaan et al., 2023; Shinn et al., 2023; Huang et al., 2024). Portia should therefore be designed against evaluator monoculture.

Possible safeguards include:

- a model different from Anansi's generator;
- deterministic validators;
- tool-backed factual checks;
- retrieval from user-approved sources;
- multiple adversarial roles with independent prompts;
- cross-model or cross-provider adjudication where justified;
- blind human review for high-impact cases;
- disagreement preservation rather than forced consensus; and
- periodic attack-suite red teaming.

The requirement is not maximal model diversity for its own sake. The requirement is **error independence**. Four copies of the same mistake do not become a jury.

## 6.8 Portia output contract

A minimum Portia record should contain:

```text
candidate_id
attacks_attempted
attack_results
critical_assumptions
supporting_evidence
counterevidence
adversarial_stakeholders
failure_scenarios
sensitivity_results
unsupported_claims
disposition
severity
required_qualifications
required_revisions
open_questions
evaluator_and_prompt_provenance
```

The user interface should let readers open any preserved or consumed candidate and see why it received that disposition.

## 6.9 Portia's own failure modes

Portia can fail through:

- over-pruning unconventional but valuable ideas;
- mistaking lack of evidence for evidence of absence;
- privileging easily measurable concerns over morally important ones;
- rewarding conformity to the evaluator's worldview;
- consuming minority or culturally unfamiliar perspectives;
- inventing counterevidence;
- treating cross-seed recurrence as truth;
- attacking rhetoric instead of the underlying proposition; or
- optimizing for rejection because “critical” systems are often praised for sounding severe.

Portia must therefore be evaluated on false consumption as well as false preservation.

---

# 7. Gate: interpretive sufficiency

## 7.1 Why a separate Gate exists

After Portia hunts, the system may be left with three strong candidates, twelve wounded candidates, one unresolved existential risk, or nothing but bones. A language model will happily synthesize any of these states. That is precisely why it must not control the decision to proceed.

The Gate is a distinct sufficiency authority. It asks whether the surviving ecology contains enough independent and relevant material to support a responsible interpretation.

## 7.2 Sufficiency dimensions

The Gate evaluates at least six positive dimensions and one penalty dimension.

| Symbol | Dimension | Question |
|---|---|---|
| **P** | Purpose coverage | Does anything address the protected outcome or actual decision? |
| **E** | Evidence coverage | Is at least part of the surviving set anchored to observations or credible sources? |
| **R** | Risk coverage | Is a serious failure mode, downside, or affected party represented? |
| **A** | Agency coverage | Is there a plausible action, experiment, or information-gathering step? |
| **T** | Tension coverage | Are at least two non-identical forces or tradeoffs preserved? |
| **I** | Independence | Do survivors rely on distinct assumptions, evidence, or mechanisms? |
| **U** | Unresolved severity | How consequential are the questions Portia could not adjudicate? |

A general score can be written as:

```text
G = wp*P + we*E + wr*R + wa*A + wt*T + wi*I - wu*U
```

The weights and threshold are versioned research parameters. They are not revealed by the number eight, the I Ching, chess, or arachnid anatomy. An initial pilot may use equal positive weights and an explicit unresolved-risk penalty, but those values must be calibrated against human judgments and downstream outcomes.

## 7.3 Hard floors

A weighted score alone can conceal catastrophic gaps. The Gate should also enforce hard floors. A candidate configuration should not pass merely because it scores highly on originality while containing no evidence or action.

Possible pilot floors include:

- at least three substantively independent preserved or wounded candidates;
- at least one evidence-bearing candidate;
- at least one action- or experiment-bearing candidate;
- at least one explicit risk or counterposition;
- no unaddressed high-severity safety or rights issue;
- no Portia finding that the apparent conclusion depends on a fabricated fact; and
- no unresolved conflict between the recommendation and a declared non-negotiable value.

These are proposed defaults, not immutable truths. Every Gate decision should state which floors were applied.

## 7.4 Gate decisions

The Gate returns one of four results:

1. **Pass:** sufficient material exists for Charlotte.
2. **Retry game:** the field appears adequate, but this traversal left an insufficient or unstable survivor set.
3. **Retry field:** the sixty-four-facet representation itself appears shallow, redundant, missing critical coverage, or dependent on false assumptions.

A fourth terminal state is required:

4. **Insufficient basis:** the retry budget is exhausted or critical evidence remains unavailable. The system returns a structured refusal to synthesize, together with the minimum information needed to continue.

## 7.5 Why survivor count is not enough

Five pawns repeating the same proposition are not five independent perspectives. A single wounded rook grounded in decisive evidence may matter more than ten ornate but unsupported survivors. The Gate must therefore assess semantic independence and evidence relation, not count tokens wearing different hats.

## 7.6 Gate provenance

The Gate record should include:

- the survivor set evaluated;
- dimension scores and calculation method;
- hard-floor results;
- the threshold and configuration version;
- disagreements among evaluators;
- the decision and reasons;
- the retry target; and
- the evidence or context whose arrival would change the decision.

The Gate should be auditable and deliberately boring. Judgment gates that perform like oracles eventually acquire priests.

---

# 8. Retry: controlled recursion

## 8.1 Retry is a lifecycle stage

Retry is not a parenthetical arrow. It consumes compute, changes provenance, introduces multiple-comparison risks, and determines whether the system learns from failure or merely rerolls until a desired answer appears. It therefore deserves explicit status.

## 8.2 Level one: another game

When the Gate judges the semantic field adequate but the terminal ecology insufficient, Retry should preserve the original division and launch a new independent game condition.

Depending on the experiment, this may involve:

- a new board permutation while retaining the same facet-lens pairings;
- a new complete cast with independently derived permutations;
- a different root tie-break seed;
- a different move policy; or
- a human-guided game.

The exact variation must be recorded. “New game” is not a reproducible method unless the changed variables are explicit.

## 8.3 Cross-game recurrence

Portia should compare survivors across retries. A candidate that survives several independent casts and attack suites becomes more interesting because its persistence is less likely to be an artifact of one path. However, recurrence can also reflect repeated model bias, repeated evidence gaps, or a structural advantage in the game.

Cross-game statistics should therefore distinguish:

- same facet recurring under different lenses;
- same literal proposition expressed by different facets;
- same piece role surviving;
- same polarity dominating;
- same evidence source supporting all occurrences; and
- recurrence under genuinely independent evaluator configurations.

## 8.4 Level two: return to Anansi

If several games collapse for the same reason, the problem is probably upstream. Retry should compile Portia's autopsy and return it to Anansi.

The autopsy may say:

- Evidence facets were generic and unsupported.
- Risk coverage collapsed into one repeated regulatory concern.
- The field omitted the payer or affected third party.
- Most candidates depended on the same unverified growth assumption.
- No candidate produced a reversible test.
- The user question fused two decisions that require separate games.

Anansi then revises the field under explicit constraints. It should not simply generate another sixty-four facets from scratch and erase the failure history.

## 8.5 Retry budget and stopping rules

The reference architecture needs versioned limits such as:

- maximum games per field;
- maximum field revisions;
- maximum model calls;
- maximum wall-clock time;
- maximum user-approved cost;
- minimum expected information gain; and
- mandatory stop on unresolved high-severity risk.

The system should display the budget before execution. Infinite recursion is not perseverance; it is a denial-of-service attack wearing the mask of introspection.

## 8.6 Retry abuse

Retry can become a mechanism for answer shopping. A user or model may rerun until the system produces a preferred conclusion. Defenses include:

- showing all prior runs;
- preserving failed Gate records;
- preventing deletion of inconvenient outcomes inside an active case;
- preregistering retry limits for research;
- reporting answer variability; and
- requiring a reason for manual retries.

---

# 9. Charlotte: value-governed synthesis and truthful persuasion

## 9.1 Why Charlotte

In E. B. White's *Charlotte's Web*, Charlotte does not save Wilbur by overpowering the humans. She changes the symbolic environment through language. The humans' model of Wilbur changes, and their behavior changes with it. Literary scholarship has examined the web's role in community, narrativity, ethics, edibility, friendship, and the transformation of Wilbur's social status (White, 1952; Rushdy, 1991; Ratelle, 2014).

This is the modern AI connection: language can reorganize attention, classification, status, and action without directly changing the underlying object. Search summaries, diagnostic labels, recommendations, rankings, political slogans, and model-generated explanations all operate at this symbolic layer.

Charlotte therefore represents **aligned communicative intelligence**:

- a protected outcome;
- responsibility to affected beings;
- audience modeling;
- semantic compression;
- truthful persuasion;
- practical action; and
- accountability for downstream consequences.

## 9.2 Charlotte comes after Portia

The order matters:

> Anansi -> Chess -> Portia -> Gate -> Charlotte

Reality-testing should precede recommendation. Otherwise Charlotte will produce morally polished nonsense and Portia will be asked to inspect a story already compressed around a preferred conclusion.

Portia determines what is defensible. Charlotte determines what is worth doing and how it should be communicated.

## 9.3 Charlotte's input

Charlotte should receive:

- the original question;
- the protected outcome as confirmed by the user;
- affected stakeholders and power asymmetries;
- non-negotiable values and constraints;
- preserved candidates;
- wounded candidates with mandatory qualifications;
- consumed candidates and rejection reasons;
- unresolved questions;
- Gate scores and floors;
- cross-game recurrence and instability;
- the relevant capture and route history; and
- the user's intended audience and decision horizon.

Charlotte must not receive only the clean survivors. If consumed candidates disappear, the final model may unconsciously reconstruct them from the original question and resurrect precisely what Portia killed.

## 9.4 Charlotte's output

A strong Charlotte result should contain:

- **Direct recommendation:** the proposed course, stated without symbolic fog.
- **Protected outcome:** whose welfare, purpose, or capability the recommendation serves.
- **Rationale:** which preserved and wounded candidates support it.
- **Central tension:** the tradeoff that must remain visible.
- **Value constraints:** what the recommendation refuses to sacrifice.
- **Uncertainty:** what remains unknown and how severe it is.
- **Reversible actions:** bounded steps that generate information.
- **Audience strategy:** how the recommendation should be communicated to different stakeholders.
- **Reversal conditions:** observations that would change or stop the plan.
- **Portia compliance:** confirmation that no consumed candidate was used as support.

## 9.5 Persuasion is not neutral

Charlotte's mechanism is ethically attractive because she saves Wilbur. The same mechanism can manufacture prestige, obscure uncertainty, manipulate institutions, or convert weak evidence into social fact. The difference is not linguistic capability. It is purpose, truthfulness, consent, and accountability.

Charlotte should therefore be constrained by principles such as:

- do not state a symbolic association as evidence;
- do not conceal material uncertainty for rhetorical force;
- do not exploit a stakeholder's cognitive vulnerability;
- distinguish explanation from influence strategy;
- disclose conflicts of interest;
- preserve dissent where it is decision-relevant;
- prefer reversible actions under uncertainty; and
- never claim that Portia survival or Gate passage establishes truth.

## 9.6 Audience-specific communication

One recommendation may require different explanations for operators, executives, regulators, affected communities, technical reviewers, and payers. Charlotte should adapt vocabulary and emphasis without changing the factual core.

This is not permission to tell each audience what it wants to hear. Audience modeling without semantic invariance is merely lying with better typography.

## 9.7 Charlotte and action

Charlotte's final task is not to end with an essay. It is to define an intervention that Wilbur can encounter.

A recommended action should specify:

- the assumption tested;
- the actor;
- the smallest ethical and reversible step;
- the expected observation;
- the decision threshold;
- the deadline;
- the downside and affected parties;
- the stopping rule; and
- the evidence to record.

---

# 10. Wilbur: consequence in the world

## 10.1 The missing object of concern

A reasoning architecture can become intoxicated by its own internal structure. Anansi generates, Chess dramatizes, Portia criticizes, Charlotte writes, and the system congratulates itself for intellectual depth. Wilbur prevents this closed loop.

Wilbur represents:

- the person whose life is affected;
- the project being protected;
- the organization that must act;
- the community bearing the downside;
- the concrete objective at stake; or
- the vulnerable reality beneath the language.

Without Wilbur, the system is a magnificent web suspended over an empty barn.

## 10.2 Wilbur is not necessarily autonomous execution

In many cases, WebChess should not execute anything. The Wilbur stage may be a human-controlled action record, a scheduled experiment, a stakeholder conversation, or a later observation. The system's role is to make the intervention and outcome legible, not to seize agency.

For high-impact decisions, Wilbur must remain under accountable human and institutional authority.

## 10.3 Wilbur's record

A minimum intervention record includes:

```text
protected_outcome
chosen_action
responsible_actor
approval_authority
execution_date
expected_result
measurement_plan
observed_result
unexpected_effects
stakeholder_response
evidence_collected
follow_up_date
status
```

The record should distinguish “not executed,” “executed but not observed,” “observed,” “abandoned,” and “inconclusive.” Absence of follow-up must not be silently coded as success.

## 10.4 Consequence is not causal proof

Suppose Charlotte recommends a small pricing experiment and revenue rises. That does not prove the recommendation caused the increase. Seasonality, selection, concurrent changes, measurement error, and luck remain possible.

Wilbur adds empirical contact, not automatic causal identification. Where causality matters, the action should use an appropriate experimental or quasi-experimental design.

## 10.5 Protecting Wilbur

The system should ask before action:

- Who can be harmed?
- Who consented?
- Who has authority?
- Is the action reversible?
- What information is private?
- What would constitute unacceptable downside?
- Who can stop the experiment?
- How will dissent be recorded?

Charlotte may speak for a protected outcome; she must not appropriate the voice of the affected person.

---

# 11. The Web: provenance, memory, and inheritance

## 11.1 The Web is more than storage

The present repository already preserves the question, division, seed, game events, outcome, model provenance, and answer. That is a strong audit foundation.

WebChess 2.0 expands the Web into a provenance graph spanning the entire lifecycle:

- entities: questions, facets, lenses, pieces, candidates, evidence, recommendations, actions, outcomes;
- activities: division, casting, play, Portia attacks, Gate decisions, retries, Charlotte synthesis, Wilbur intervention;
- agents: user, models, engines, tools, reviewers, stakeholders, and accountable actors; and
- derivations: which output came from which inputs, under which versions and parameters.

This maps naturally onto the entity-activity-agent distinctions of the W3C PROV family.

## 11.2 What the Web must remember

The Web should retain:

- the original and revised questions;
- every Anansi field and repair instruction;
- all cast seeds and permutations;
- every move, pass, capture, promotion, and outcome;
- terminal survivor packages;
- every Portia attack and disposition;
- Gate calculations and decisions;
- all retries, including failures;
- Charlotte's recommendation and cited survivor IDs;
- user edits and approvals;
- Wilbur actions and observations;
- later evidence and reversal events; and
- software, rules, engine, model, prompt, evaluator, and schema versions.

The final answer is not the authoritative object. The genealogy is.

## 11.3 Memory layers

The Web should separate at least four layers.

1. **Case memory:** full private record for one user problem.
2. **Operational memory:** quotas, idempotency, concurrency, integrity, and system events.
3. **Learning memory:** abstracted patterns across cases, only with explicit consent and privacy controls.
4. **Research memory:** de-identified, versioned evaluation datasets with documented inclusion criteria.

The current system implements much of the first two. The latter two are proposals and should not be inferred from the existing code.

## 11.4 Controlled forgetting

Perfect memory is not automatically virtuous. It can become surveillance, liability, inherited error, and permanent stigma. The Web needs:

- retention periods;
- user-controlled deletion subject to integrity and legal constraints;
- separation of identity from de-identified research data;
- access controls;
- data minimization;
- redaction and export;
- tombstones that prevent quota abuse without retaining content; and
- a documented policy for what cannot be learned from deleted cases.

## 11.5 Learning across cycles

A future Web may inform later Anansi cycles by retrieving:

- recurring failure patterns;
- Portia attacks that repeatedly expose weak facets;
- Gate dimensions that predict later success;
- Charlotte actions that generated useful evidence;
- Wilbur outcomes under similar conditions; and
- known domains where the entire method performs poorly.

This learning must not turn prior cases into unquestioned precedent. Retrieval should expose provenance, similarity limits, and contradictory outcomes.

## 11.6 The Web remembers death

Most systems store accepted answers and discard rejected alternatives. WebChess should preserve what died and why. That makes the architecture capable of answering:

- Was this idea never generated, killed by Chess, consumed by Portia, blocked by the Gate, rejected by Charlotte, or falsified by Wilbur?
- Did a later cycle resurrect it because new evidence arrived?
- Did Portia repeatedly consume a culturally unfamiliar perspective that later proved valuable?

A system that remembers only winners trains itself to confuse survival with wisdom.

---
# 12. Formal model and reference algorithm

## 12.1 Objects

Let the user question be `q` and the user-approved evidence set be `E`.

Anansi constructs a field of sixty-four facets:

```text
F = {f1, f2, ..., f64}
```

Each facet includes semantic content and metadata tied to one dimension-movement coordinate.

Let `H` be the set of sixty-four I Ching-inspired lenses. The current cast applies independent domain-separated permutations:

```text
F' = pi_F(F)
H' = pi_H(H)
P  = pair(F', H')
B0 = pi_B(P)
```

where `B0` is the initial semantic board assignment. The chess pieces are placed in the canonical initial position independent of the semantic cast.

A game under rules version `r`, engine or move policy `m`, and game seed `s` produces:

```text
Game(B0, r, m, s) -> (BT, L, C, O)
```

where:

- `BT` is the terminal board;
- `L` is the complete event log;
- `C` is the capture trail; and
- `O` is the terminal outcome.

The terminal survivor set is:

```text
S = Survivors(BT, L, C, O)
```

Portia applies an attack set `A` using evidence `E` and prior retry history `R`:

```text
Portia(S, A, E, R) -> J
```

where `J` is a set of judgments containing dispositions, scars, unresolved questions, and attack provenance.

The Gate computes a sufficiency decision:

```text
Gate(J, q, E, theta) -> D
```

where `theta` contains versioned weights, floors, thresholds, and budget constraints. `D` is one of `pass`, `retry_game`, `retry_field`, or `insufficient_basis`.

If `D = pass`, Charlotte produces a recommendation `K` from defensible candidates and explicit values `V`, stakeholders `Z`, and audience `Y`:

```text
Charlotte(J, V, Z, Y) -> K
```

Wilbur records the intervention and observed consequences:

```text
Wilbur(K, world_t0) -> (action, observation, world_t1)
```

The Web stores the provenance graph `W`:

```text
W_t+1 = Record(W_t, q, F, B0, L, S, J, D, K, action, observation)
```

A later cycle may retrieve bounded, consented context from `W_t+1` for a new Anansi field.

## 12.2 Reference algorithm

```text
function WEBCHESS_2(question, evidence, user_constraints, budget):
    case = Web.create_case(question, evidence, user_constraints)
    field = Anansi.divide_and_validate(question, evidence)
    Web.record(field)

    for field_epoch in 1..budget.max_field_revisions:
        portia_autopsies = []

        for game_attempt in 1..budget.max_games_per_field:
            cast = Chess.cast(field, fresh_domain_separated_seed())
            terminal = Chess.play_to_terminal(cast, rules_version, move_policy)
            survivors = Chess.derive_survivor_packages(terminal)
            Web.record(cast, terminal, survivors)

            adjudication = Portia.hunt(
                survivors,
                terminal.full_history,
                evidence,
                previous_attempts=portia_autopsies
            )
            Web.record(adjudication)

            gate = Gate.assess(adjudication, question, user_constraints)
            Web.record(gate)

            if gate.decision == PASS:
                recommendation = Charlotte.synthesize(
                    original_question=question,
                    protected_outcome=user_constraints.protected_outcome,
                    stakeholders=user_constraints.stakeholders,
                    preserved=adjudication.preserved,
                    wounded=adjudication.wounded,
                    consumed=adjudication.consumed,
                    unresolved=adjudication.unresolved,
                    gate=gate
                )
                Web.record(recommendation)

                intervention = Wilbur.prepare(recommendation)
                Web.record(intervention)
                return case_with_pending_or_completed_intervention

            if gate.decision == INSUFFICIENT_BASIS:
                return explicit_insufficiency_report(case, gate)

            portia_autopsies.append(adjudication.autopsy)

            if gate.decision == RETRY_FIELD:
                break

        if field_epoch == budget.max_field_revisions:
            return explicit_insufficiency_report(case, aggregate_failures())

        field = Anansi.revise(
            previous_field=field,
            portia_autopsies=portia_autopsies,
            gate_failures=case.gate_failures
        )
        Web.record(field)

    return explicit_insufficiency_report(case, "budget exhausted")
```

## 12.3 Determinism and variation

Reproducibility requires separating variables that should remain fixed from variables intentionally changed.

A replay of the same game should preserve:

- question;
- facet field;
- cast seed;
- board assignment;
- rules version;
- engine version;
- move policy;
- root tie-break seed;
- model and prompt versions; and
- Gate and Portia configurations.

A retry should record exactly which of those variables changed. Otherwise, differences between runs cannot be interpreted.

## 12.4 Computational budget

A full eight-stage cycle can be expensive. The architecture should expose a budget object before execution:

```text
max_division_calls
max_games_per_field
max_field_revisions
max_portia_calls
max_external_searches
max_total_tokens
max_wall_clock_seconds
max_estimated_cost
human_review_required_above_risk_level
```

Budget exhaustion is a valid outcome. The system should never silently downgrade Portia or the Gate and then present a full-confidence Charlotte answer.

---

# 13. Proposed data contracts

The following schemas are conceptual. Exact field types should be implemented in versioned JSON Schema or Zod contracts and validated both at model boundaries and persistence boundaries.

## 13.1 Anansi facet

```json
{
  "id": 1,
  "dimension": "Purpose",
  "movement": "Begin",
  "title": "Specific facet title",
  "focus": "Concrete aspect of the user's problem",
  "question": "A practical question that can reduce uncertainty",
  "keyword": "compact handle",
  "assumptions": ["..."],
  "evidence_status": "observed|sourced|assumed|valued|predicted|unknown",
  "stakeholders": ["..."],
  "disconfirming_observation": "...",
  "possible_test": "...",
  "source_spans": ["user-text-span-or-source-id"]
}
```

## 13.2 Survivor package

```json
{
  "survivor_id": "game-id:piece-id",
  "piece": {
    "id": "white-bishop-1",
    "side": "white",
    "kind": "bishop",
    "role": "Perspective"
  },
  "facet_id": 17,
  "lens_id": 42,
  "final_square": { "ring": 3, "sector": 6 },
  "route": [
    { "ply": 1, "from": [7, 2], "to": [6, 3] }
  ],
  "captures_made": ["capture-id"],
  "promotion": null,
  "game_context": {
    "outcome": "king-captured",
    "winner": "white",
    "completed_plies": 83
  },
  "provenance": {
    "cast_seed": "...",
    "rules_version": "...",
    "engine_version": "..."
  }
}
```

## 13.3 Portia judgment

```json
{
  "survivor_id": "...",
  "attacks_attempted": [
    "assumption",
    "counterevidence",
    "stakeholder",
    "redundancy",
    "seed_sensitivity",
    "counterfactual_removal",
    "actionability",
    "failure_mode"
  ],
  "critical_assumptions": ["..."],
  "supporting_evidence_ids": ["..."],
  "counterevidence_ids": ["..."],
  "adversarial_stakeholders": ["..."],
  "failure_scenarios": ["..."],
  "sensitivity": {
    "cross_game_recurrence": 0.5,
    "removal_effect": "low|medium|high|unknown"
  },
  "unsupported_claims": ["..."],
  "disposition": "preserved|wounded|consumed|unresolved",
  "severity": "low|medium|high|critical",
  "required_qualifications": ["..."],
  "required_revisions": ["..."],
  "open_questions": ["..."],
  "evaluator_provenance": {
    "model": "...",
    "prompt_version": "...",
    "tools": ["..."],
    "human_review": null
  }
}
```

## 13.4 Gate record

```json
{
  "coverage": {
    "purpose": 0.0,
    "evidence": 0.0,
    "risk": 0.0,
    "agency": 0.0,
    "tension": 0.0,
    "independence": 0.0,
    "unresolved_severity": 0.0
  },
  "weights": { "version": "gate-0.1", "values": {} },
  "score": 0.0,
  "hard_floors": [
    { "name": "evidence-bearing survivor", "passed": false }
  ],
  "decision": "pass|retry_game|retry_field|insufficient_basis",
  "reasons": ["..."],
  "missing_information": ["..."],
  "retry_target": "game|field|null"
}
```

## 13.5 Charlotte recommendation

```json
{
  "direct_recommendation": "...",
  "protected_outcome": "...",
  "stakeholders": ["..."],
  "value_constraints": ["..."],
  "supporting_survivor_ids": ["..."],
  "wounded_survivor_ids": ["..."],
  "central_tension": "...",
  "uncertainties": ["..."],
  "reversible_actions": [
    {
      "action": "...",
      "actor": "...",
      "assumption_tested": "...",
      "expected_observation": "...",
      "decision_threshold": "...",
      "deadline": "...",
      "stopping_rule": "..."
    }
  ],
  "communication_strategy": [
    { "audience": "...", "message": "...", "facts_unchanged": true }
  ],
  "reversal_conditions": ["..."],
  "portia_compliance": {
    "consumed_candidates_used_as_support": false
  }
}
```

## 13.6 Wilbur intervention

```json
{
  "recommendation_id": "...",
  "protected_outcome": "...",
  "chosen_action": "...",
  "responsible_actor": "...",
  "approval_authority": "...",
  "status": "planned|approved|executed|observed|abandoned|inconclusive",
  "execution_date": null,
  "expected_result": "...",
  "measurement_plan": "...",
  "observed_result": null,
  "unexpected_effects": [],
  "stakeholder_response": [],
  "evidence_collected": [],
  "follow_up_date": "..."
}
```

## 13.7 Provenance event

Every lifecycle mutation should create a provenance event with:

```text
event_id
case_id
stage
activity_type
input_entity_ids
output_entity_ids
responsible_agent_ids
software_version
model_or_engine_version
prompt_or_rules_version
configuration_digest
started_at
completed_at
status
error_class
```

Private model reasoning traces are neither required nor desirable. The Web should preserve inspectable inputs, outputs, transformations, and decisions, not hidden chain-of-thought.

---

# 14. Current implementation versus WebChess 2.0

| Capability | Current WebChess 0.1.0 | Proposed WebChess 2.0 |
|---|---|---|
| Question preservation | Implemented | Preserve revisions and protected-outcome confirmation |
| Sixty-four-facet division | Implemented | Add assumptions, evidence status, stakeholders, tests, source spans |
| Independent cast | Implemented | Keep; expose retry variation modes |
| Complete circular chess | Implemented | Keep; derive terminal survivor packages |
| Engine V2 | Implemented | Retain as one move-policy condition |
| Capture trail | Implemented | Expand to terminal ecology and route histories |
| Server-authoritative replay | Implemented | Extend through all lifecycle stages |
| Portia adversarial hunt | Not implemented | New attack engine and judgment ledger |
| Sufficiency Gate | Not implemented | New deterministic/model-assisted authority |
| Retry policy | Replay exists, but not Gate-driven | Two-level game and field recursion with budgets |
| Charlotte | Current final synthesis only | New value, stakeholder, audience, and Portia-constrained synthesis |
| Wilbur | Three suggested actions, no outcome loop | New intervention and observation lifecycle |
| Web | Durable game and usage provenance | Full lifecycle provenance and consented cross-case learning |
| Cross-seed stability | Research proposal only | Operational metric and Gate input |
| External evidence checking | Not intrinsic to pipeline | Optional tool-backed Portia capability |
| Explicit insufficiency | Provider and validation failures exist | Epistemic refusal after Gate/retry exhaustion |

The proposed paper must not be used to claim that these features already exist. Marketing a roadmap as a shipped system would be the first candidate Portia should eat.

---

# 15. Theoretical foundations

## 15.1 Problem construction

Research on creative problem solving and design shows that problem representation and problem construction affect the quality and originality of solutions. Problem and solution spaces can co-evolve rather than unfold in a simple linear sequence (Newell, Shaw, & Simon, 1958; Reiter-Palmon et al., 1997; Dorst & Cross, 2001).

Anansi operationalizes this insight by delaying convergence and forcing explicit representation of multiple aspects of the problem. The claim is not that sixty-four is cognitively optimal. Sixty-four is a design constraint inherited from the board and Yijing lens set. Its value must be tested against smaller, larger, adaptive, and human-curated fields.

## 15.2 Variation, selection, and retention

Campbell's evolutionary account of creative thought emphasized blind variation and selective retention. Modern creative-cognition work likewise separates generative and evaluative phases (Campbell, 1960; Finke, Ward, & Smith, 1992).

The eight-part lifecycle extends this pattern:

```text
Anansi       -> variation
Chess        -> constrained interaction
Portia       -> adversarial selection
Gate         -> sufficiency control
Retry        -> renewed variation or traversal
Charlotte    -> value-governed commitment
Wilbur       -> environmental consequence
Web          -> retention and inheritance
```

The analogy to evolution breaks at Charlotte. Natural selection does not care whether a surviving strategy is humane, truthful, or just. Charlotte inserts explicit valuation after epistemic attack.

## 15.3 External and distributed cognition

External representations can alter the computational work required for reasoning, and cognitive tasks may be distributed across people, artifacts, and environments (Larkin & Simon, 1987; Zhang & Norman, 1994; Hutchins, 1995; Risko & Gilbert, 2016).

WebChess externalizes a problem as a board, role system, move history, survivor ecology, and provenance graph. The “AI” is therefore not just the language model. It is the coupled system of user, models, game engine, database, interfaces, evidence sources, reviewers, actions, and memory.

This distributed view also identifies failure. A reliable model inside a corrupt provenance system is not a reliable system. A perfect database storing invented claims is merely an immortal lie.

## 15.4 Analogy and metaphor

Analogy can support transfer when relational structure is mapped rather than surface resemblance alone (Gentner, 1983; Gick & Holyoak, 1983). WebChess uses several analogical structures:

- piece roles as modes of attention;
- White and Black as directional polarities;
- hexagram themes as change metaphors;
- Chess as constrained conflict;
- Portia as adversarial testing;
- Charlotte as responsible communication;
- Wilbur as protected consequence; and
- the Web as provenance.

Each analogy requires an “analogy break” statement. For example, Portia in nature seeks food, while Portia in WebChess should seek epistemic robustness. Charlotte in the novel acts from friendship, while a software system requires explicit values, consent, and accountable operators.

## 15.5 Randomization and bounded association

Turing observed that random search can be useful when many satisfactory solutions exist and systematic search may encounter large barren regions. Chess960 provides a design precedent for randomizing an initial configuration while preserving stable movement rules (Turing, 1950; FIDE Rules Commission, n.d.).

Neither source validates WebChess. Randomness can break fixation, but irrelevant prompts can also reduce performance. The system therefore needs comparisons among random, semantically selected, fixed, and human-curated casts (Malthouse et al., 2022).

## 15.6 Search, branching, and iterative refinement in AI

Tree of Thoughts explores multiple coherent reasoning paths with evaluation and backtracking. Reflexion uses verbal feedback and episodic memory. Self-Refine iterates generation, feedback, and revision. Language-model red teaming uses models to generate adversarial test cases (Yao et al., 2023; Shinn et al., 2023; Madaan et al., 2023; Perez et al., 2022).

WebChess 2.0 belongs to this broad family but differs in several ways:

- the candidate field is fixed at sixty-four structured perspectives;
- the chess path is an external game process rather than a hidden text tree;
- Portia judges terminal survivors before final synthesis;
- the Gate has explicit authority to refuse synthesis;
- Retry distinguishes traversal failure from representation failure;
- Charlotte incorporates values and audience consequences; and
- Wilbur closes the loop with real-world observation.

The negative evidence on intrinsic self-correction is equally relevant. If the same model generates, critiques, gates, and synthesizes, the architecture may merely circulate correlated errors with increasingly ceremonial titles (Huang et al., 2024).

## 15.7 Attention is not importance

Procedures allocate attention. The fact that a process causes an item to become salient does not establish that the item is objectively important. WebChess must preserve this distinction at every layer:

- cast assignment is not evidence;
- chess contact is not relevance;
- capture is not truth;
- Portia survival is not proof;
- Gate passage is not certainty;
- Charlotte eloquence is not correctness; and
- Wilbur success is not causality.

The architecture is a sequence of filters, not a sacrament.

## 15.8 Reversible experimentation

Under uncertainty, recommendations should often become bounded tests. Research on experimentation and entrepreneurial decision processes supports the value of structured learning, though effects vary by context and method (Thomke, 1998; Camuffo et al., 2024).

Charlotte and Wilbur should therefore favor actions with explicit observations and stopping rules rather than irreversible commitments justified by symbolic coherence.

---

# 16. Cultural and intellectual lineage

The figures in this section supply design concepts and warnings. None evaluated or endorsed WebChess.

## 16.1 Anansi: story, indirection, and resistance

Akan Ananse stories are not reducible to “creative thinking.” They are performed, social, pedagogical, humorous, morally ambiguous, and historically mobile. In the Caribbean, Anansi became a figure of continuity and resistance under radically different conditions (Arthur, 2019; Marshall, 2012).

WebChess borrows three design lessons:

1. intelligence can operate through indirection;
2. a small agent can reorganize a field controlled by stronger actors; and
3. stories are communal cognitive technologies, not merely containers for propositions.

The safeguard is attribution and collaboration. The system should not strip Anansi from Akan and diasporic histories and present him as a patented productivity framework.

## 16.2 Portia: the web as an information system

Portia research supplies the most operational biological analogy in the architecture. A prey web is part of the prey's perceptual system; Portia's signals exploit that interface. Trial-and-error signal derivation and route selection illustrate active probing rather than passive classification (Jackson, 1995; Jackson & Nelson, 2011; Jackson & Cross, 2013; Cross & Jackson, 2019).

The warning is equally strong. Portia demonstrates that communication, adaptation, and opponent modeling can serve predation. The same architecture that detects manipulation can optimize it. Portia's tools should therefore be restricted to adjudication, robustness testing, and evidence gathering, with explicit controls against automated social engineering.

## 16.3 Charlotte: language as intervention

Charlotte changes material reality by changing human interpretation. The web becomes a publishing medium; short phrases reorganize status, attention, and institutional behavior. Scholarship has read the novel through community, narrativity, ethics, edibility, friendship, humility, and spirituality (Rushdy, 1991; Ratelle, 2014; Boonpromkul, 2022; Thomas, 2016).

For AI, the lesson is not sentimental. Language systems exert power by framing salience and classification. A system does not need physical force if it can alter the symbolic layer through which institutions act.

Charlotte's place after Portia is therefore essential. Persuasion must be constrained by what survived examination.

## 16.4 Wilbur: the protected life

Wilbur gives the architecture a concrete object of concern. The system exists for a life, project, community, or outcome that can be helped or harmed. That prevents “alignment” from becoming an abstract property asserted by the same institution deploying the model.

Wilbur also corrects a common failure in AI systems: outputs are evaluated against text benchmarks while consequences are borne elsewhere by people who never consented to the experiment.

## 16.5 The Yijing: change, symbols, and humility

The Yijing is a composite Chinese classic with long histories of divination, philosophy, commentary, state canonization, and cultural reinterpretation. Its sixty-four hexagrams cannot responsibly be reduced to a set of English creativity prompts. The Stanford Encyclopedia of Philosophy emphasizes human finitude, symbolic interpretation, contingency, and the multiple layers through which the text has been read (Hon, 2023).

WebChess uses sixty-four **I Ching-inspired** lenses as bounded metaphors of change. It does not claim authentic divination, prediction, or access to hidden causal order. The lens assignment is randomized and must be displayed as such.

Richard Wilhelm's German translation, Cary F. Baynes's English rendering, and C. G. Jung's foreword profoundly shaped twentieth-century Anglophone reception (Wilhelm, Baynes, & Jung, 1967). They represent one influential transmission, not the sole authority on the Yijing.

## 16.6 Jung and synchronicity

Jung's synchronicity is historically relevant because it frames meaningful coincidence as an acausal connecting principle (Jung, 1952/2010). WebChess does not adopt that claim as scientific mechanism. A random pairing can provoke a useful interpretation because human and model cognition can construct relations; that does not show that the pairing was cosmically selected.

The appropriate connection to Turing is contrast, not synthesis:

- Turing discusses random search as a practical exploration strategy.
- Jung discusses meaningful coincidence as a psychological and metaphysical concept.
- WebChess uses pseudorandom variation as an engineering intervention and then requires Portia, Gate, evidence, and Wilbur feedback precisely because meaningfulness can be overproduced.

## 16.7 Fischer and Chess960

Chess960 randomizes the starting back rank under restrictions while retaining ordinary piece movement and the objective of checkmate. It demonstrates a clean design pattern: vary initial conditions while preserving grammar (FIDE Rules Commission, n.d.).

WebChess similarly varies facet, lens, and location assignments while preserving movement roles. The analogy is limited. Chess960 was designed to reduce opening preparation and create fresh chess positions; it is not evidence that randomization improves real-world problem solving. This paper therefore omits the fragile, unofficial Fischer transcript quotation used in earlier drafts and relies on official FIDE rules for the constrained-randomization claim.

## 16.8 Zoroastrian dualism and the danger of moral coloring

Ancient Iranian religious dualism is historically complex and should not be flattened into a cartoon opposition of white good and black evil (Gnoli, 1996/2017). WebChess's colors are explicitly nonmoral:

- White is outside-in evidence.
- Black is inside-out intent.

Evidence can be incomplete, weaponized, or irrelevant. Intention can be wise, delusional, or humane. The game represents directional tension, not cosmic morality.

## 16.9 Turing: random search under plural solutions

Turing's 1950 paper notes that random exploration can be useful where many satisfactory solutions exist and systematic search may traverse a long region with none. That supports a rationale for variation, not an empirical claim about WebChess. The current design therefore treats the cast as a hypothesis generator and records every seed.

---
# 17. Failure modes, risks, and safeguards

The eight-part lifecycle does not eliminate error. It redistributes error across more inspectable boundaries. That is useful only if every boundary has an explicit failure model. Otherwise the new stages merely give one hallucination eight ceremonial offices.

## 17.1 Apophenia and narrative overfitting

**Failure:** A random facet-lens-location conjunction feels meaningful because the final explanation is coherent. Humans detect patterns in noise, especially under uncertainty or reduced control; language models can intensify the effect by converting weak associations into fluent causal stories (Whitson & Galinsky, 2008).

**Indicators:**

- symbolic language is presented as observation;
- a recommendation depends on the hexagram label rather than the literal facet;
- rival mappings are not considered;
- the same cast supports opposite conclusions when prompted differently; or
- users rate explanations as profound while failing to identify any testable implication.

**Safeguards:**

- display seed, cast, and randomization status beside every symbolic mapping;
- require Portia to state the analogy, its break point, and a rival interpretation;
- forbid symbolic assignments from appearing in `supporting_evidence`;
- compare the interpretation with a symbol-stripped version; and
- evaluate whether independent reviewers can recover the same literal claim without seeing the metaphor.

## 17.2 Garbage multiplication in Anansi

**Failure:** The first model produces sixty-four polished variants of a shallow frame. Chess, Portia, and Charlotte then operate on semantic mulch. The system looks comprehensive because every square is occupied.

**Indicators:**

- high embedding similarity among facets;
- repeated actors, mechanisms, or assumptions under different titles;
- absent affected parties or missing decision criteria;
- facets that cannot be distinguished by blinded reviewers;
- low user recognition of the actual problem; or
- repeated Retry-field decisions for the same structural omissions.

**Safeguards:**

- expand current lexical checks into semantic cluster and coverage checks;
- require a compact ontology of actors, mechanisms, evidence, values, and uncertainties;
- let the user merge, reject, or add facets before casting;
- preserve an explicit “missing or unknown” register outside the sixty-four slots;
- score field quality separately from downstream answer quality; and
- treat Portia autopsies as structured regeneration constraints.

## 17.3 Randomness without useful distance

**Failure:** Random casting produces irrelevant associations that consume attention without creating useful novelty. Experimental work on randomness and ideation shows that arbitrary cues can help in some conditions and harm in others; semantic distance must be treated as a variable, not a sacrament (Malthouse et al., 2022).

**Indicators:**

- Portia consumes most candidates for irrelevance;
- high retry rates are driven by cast noise rather than field quality;
- users spend more time decoding symbols than examining the problem;
- random and semantically selected lenses produce indistinguishable novelty but different usability; or
- the full system underperforms a direct structured-analysis baseline.

**Safeguards:**

- compare random, semantically matched, distance-controlled, and no-lens conditions;
- estimate a useful range of semantic distance by task type;
- allow Portia to discard a lens while preserving the literal facet;
- report how much of Charlotte's recommendation derives from symbolic versus literal material; and
- preserve the possibility that the lens layer should be reduced or removed.

## 17.4 Chess theater

**Failure:** Engine V2 produces impressive tactical play that contributes no measurable reasoning value. Search depth, animated movement, and technical vocabulary generate an aura of cognition while a cheaper selection procedure would work as well.

**Indicators:**

- downstream quality does not improve with engine strength;
- random legal play performs equally or better;
- terminal survivors are insensitive to the original problem;
- users mistake engine evaluation for semantic evaluation; or
- latency and cost increase without information gain.

**Safeguards:**

- maintain random, shallow, semantic, human, and coverage policies as permanent baselines;
- report chess metrics and reasoning metrics separately;
- hide engine depth from evaluators during comparative studies;
- measure marginal value per second, node, token, and dollar; and
- retire tactical complexity that fails ablation.

## 17.5 Survivor worship

**Failure:** A surviving piece is treated as superior because it remained on the board. This converts a path-dependent game result into evolutionary mythology.

**Indicators:**

- Portia attack intensity is lower for survivors than for captured facets;
- users describe survival as proof;
- the terminal board is interpreted without comparison to uncaptured or captured counterpoints; or
- recurring survivors are promoted without checking whether recurrence arises from positional advantage.

**Safeguards:**

- state in the interface that survival is eligibility for attack, not evidence;
- include a sampled audit of captured and never-occupied facets;
- compare survivor relevance against blinded human importance ratings;
- normalize for piece type, starting position, and policy advantages; and
- allow Portia to resurrect a captured facet as a counterexample without treating it as preserved prey.

## 17.6 Portia monoculture and over-pruning

**Failure:** The adversarial evaluator shares the generator's blind spots, rewards conventionality, or consumes unfamiliar but valuable candidates. Iterative self-feedback can improve outputs, but intrinsic self-correction without independent feedback can fail or degrade reasoning (Madaan et al., 2023; Shinn et al., 2023; Huang et al., 2024).

**Indicators:**

- evaluator agreement is high despite shared model and prompt lineage;
- minority or culturally unfamiliar perspectives are consumed disproportionately;
- Portia labels lack supporting attack traces;
- human experts frequently reverse consumed judgments;
- false-evidence attacks cite nonexistent sources; or
- Portia rejects novelty because it cannot immediately operationalize it.

**Safeguards:**

- separate deterministic, retrieval-backed, model, and human attack channels;
- measure false-consumption and false-preservation rates;
- preserve disagreement and unresolved states;
- blind Portia to Charlotte's preferred answer;
- include novelty-protection rules that distinguish “unsupported” from “impossible”;
- audit outcomes across demographic, cultural, and domain groups; and
- require source identifiers for every factual attack.

## 17.7 Gate numerology and metric gaming

**Failure:** A weighted sufficiency score becomes an ersatz oracle. Teams tune weights until preferred cases pass, or candidates are rewritten to satisfy checklist language without increasing substance.

**Indicators:**

- thresholds change after seeing outcomes;
- small wording changes flip decisions without changing evidence;
- high aggregate scores conceal missing safety floors;
- evaluators cannot explain score differences; or
- systems optimize for Gate passage rather than downstream quality.

**Safeguards:**

- preregister Gate configurations in experiments;
- version and publish every weight, floor, and decision rule;
- calibrate against blinded human sufficiency judgments and real outcomes;
- run sensitivity analysis around every threshold;
- separate descriptive scores from the final categorical decision; and
- preserve an `insufficient_basis` state that cannot be overridden by rhetoric.

## 17.8 Retry as answer shopping

**Failure:** The system reruns games or fields until it produces the desired recommendation. Multiple attempts increase the chance of finding an apparently compelling but accidental pattern.

**Indicators:**

- manual retries cluster after disfavored answers;
- only the final run is shown;
- cross-run variance is suppressed;
- retry reasons are empty or post hoc; or
- the chosen run is an outlier relative to the full case history.

**Safeguards:**

- preserve and display all runs;
- require a machine-readable retry reason;
- cap game and field retries;
- report stability and outlier status;
- use preregistered selection rules in research; and
- prohibit deletion of inconvenient runs from an active provenance bundle.

## 17.9 Charlotte as benevolent propaganda

**Failure:** Charlotte converts weak survivors into language that is emotionally persuasive beyond the warranted evidence. Metaphorical framing can change proposed solutions and information search without readers recognizing the influence (Thibodeau & Boroditsky, 2011).

**Indicators:**

- emotionally charged wording exceeds the evidence grade;
- stakeholder-specific messages contain inconsistent factual claims;
- uncertainty disappears between Portia and Charlotte;
- consumed candidates return in paraphrase;
- calls to action exploit fear, shame, identity, or dependency; or
- users remember the recommendation but not its reversal conditions.

**Safeguards:**

- require claim-to-survivor and claim-to-evidence links;
- preserve wounds and uncertainty in the rendered recommendation;
- compare persuasive and neutral versions in safety testing;
- enforce audience consistency on factual content;
- prohibit dark-pattern objectives such as engagement or compliance maximization;
- require explicit consent for personalized persuasive framing; and
- make the strongest contrary case visible beside the recommendation.

## 17.10 Wilbur without authority, consent, or protection

**Failure:** A recommendation is executed on people who did not authorize it, or the system treats a vulnerable party as experimental material. “Reversible” for the decision maker may be irreversible for the person bearing the consequence.

**Indicators:**

- the actor lacks authority;
- affected parties are absent from the stakeholder model;
- no stopping rule protects them;
- harms are described only in aggregate;
- the intervention changes rights, employment, access, health, or safety without independent review; or
- outcome capture privileges organizational metrics over lived effects.

**Safeguards:**

- require explicit actor authority and affected-party analysis;
- distinguish decision reversibility from harm reversibility;
- prohibit autonomous execution in consequential domains;
- use independent legal, ethical, safety, or domain review where required;
- record consent, objections, and exclusion criteria;
- define immediate stop conditions; and
- allow Wilbur to be a community or ecosystem rather than only the paying user.

## 17.11 Causal overclaim from outcome feedback

**Failure:** A favorable outcome after Charlotte's action is attributed to the recommendation even when other causes changed. A failed outcome is likewise blamed on the idea without checking execution, context, or measurement.

**Indicators:**

- no pre-intervention baseline;
- no counterfactual or comparison condition;
- outcome metrics were chosen after results appeared;
- implementation fidelity is unknown;
- multiple simultaneous interventions occurred; or
- users convert narrative sequence into causal certainty.

**Safeguards:**

- record predictions and metrics before action;
- use comparison groups, staggered rollouts, interrupted time series, or randomized trials where feasible;
- distinguish mechanism failure from implementation failure;
- retain contextual events and confounders;
- label causal confidence explicitly; and
- let inconclusive outcomes remain inconclusive.

## 17.12 The Web as surveillance infrastructure

**Failure:** Durable memory becomes a permanent dossier of private problems, dissent, vulnerabilities, and failed decisions. Provenance can improve accountability while simultaneously improving institutional capacity to monitor people.

**Indicators:**

- memory is retained without a purpose or deletion horizon;
- cross-case learning occurs without consent;
- raw personal data are copied into model traces;
- access expands beyond the original case participants;
- “what died and why” becomes a disciplinary record; or
- users cannot export, correct, or delete their data.

**Safeguards:**

- separate case memory from research and learning memory;
- minimize raw personal and third-party data;
- use purpose-specific access controls and encryption;
- support export, correction, deletion, and retention schedules;
- retain derived research data only under explicit consent and de-identification;
- avoid training on private cases by default; and
- make forgetting a first-class provenance event rather than a silent deletion.

## 17.13 Model error, hallucination, and source laundering

**Failure:** Anansi invents facts, Portia invents counterevidence, or Charlotte cites a model-generated claim as if it came from a user or source. Hallucination is a documented failure mode of natural-language generation, and schema validity does not establish factual validity (Ji et al., 2023).

**Safeguards:**

- assign every statement an epistemic type: user observation, retrieved source, model inference, value, prediction, or symbol;
- store source identifiers and retrieval timestamps;
- prevent model inference from being promoted automatically to evidence;
- use domain-appropriate retrieval and verification;
- refuse factual adjudication when evidence access is absent; and
- include fabricated-source tests in continuous evaluation.

## 17.14 Cultural extraction

**Failure:** Anansi, the Yijing, Charlotte, Portia, and Zoroastrian thought are stripped of context and converted into proprietary decorative labels. The architecture gains charisma by borrowing cultural authority while returning nothing to the traditions it mines.

**Safeguards:**

- maintain accurate cultural and scholarly notes;
- use “I Ching-inspired” rather than claiming traditional practice;
- commission review from Akan, African-diasporic, Chinese, literary, and relevant religious-studies scholars;
- compensate contributors;
- document which meanings are WebChess inventions;
- support alternative translations and naming schemes; and
- remain willing to rename or remove elements that cannot be used responsibly.

## 17.15 High-stakes misuse

WebChess 2.0 should not be deployed as an autonomous system for diagnosis, treatment, legal rights, credit, insurance, benefits, hiring, firing, sentencing, military action, emergency response, or surveillance. In those domains, the architecture may be useful as a research or deliberation scaffold only under qualified human authority, domain-specific controls, and independent review.

The eight stages do not alchemize a reflective instrument into a licensed profession.

---
# 18. Falsifiable evaluation program

WebChess should be evaluated as a system of separable hypotheses. User fascination, narrative coherence, time spent, and willingness to share are product signals; they are not evidence that the method improves reasoning. The research question is whether the lifecycle produces better-defined outcomes than credible alternatives, for which users and tasks, through which components, at what cost, and with what new risks.

## 18.1 Primary hypotheses

The first research program should preregister hypotheses such as:

- **H1 — Field quality:** Anansi produces broader and more independent problem representations than a direct-answer model or an unconstrained brainstorming prompt.
- **H2 — Conflict value:** Chess traversal produces a more useful and diverse terminal candidate set than random subset selection at equal token and time budgets.
- **H3 — Portia precision:** Portia removes unsupported and redundant candidates more accurately than generic self-critique while preserving unconventional but defensible candidates.
- **H4 — Gate calibration:** Gate passage predicts blinded human judgments of interpretive sufficiency and downstream recommendation quality.
- **H5 — Retry value:** Controlled Retry improves adequacy more than it increases answer shopping, cost, and variance.
- **H6 — Charlotte discipline:** Charlotte produces more actionable and value-consistent recommendations, with fewer unsupported claims, than the current post-game synthesis.
- **H7 — Wilbur learning:** Cases with explicit predictions, interventions, measurements, and stopping rules generate more decision-relevant learning than cases ending at prose.
- **H8 — Web inheritance:** Provenance from prior cases reduces repeated failure without causing unacceptable privacy leakage, conformity, or stale-pattern transfer.

A result can support one hypothesis and reject another. The architecture should not be graded as one indivisible mythic artifact.

## 18.2 Baseline conditions

At minimum, comparative studies should include:

| Condition | Description |
|---|---|
| **Human-only** | Participant analyzes and responds without an AI aid |
| **Direct model** | One model call answers the original question |
| **Structured direct model** | Model uses the eight dimensions and movements but no game |
| **Current WebChess** | Existing sixty-four facets, cast, complete game, capture-trail synthesis |
| **Random subset** | Same field; select an equal number of facets randomly |
| **Semantic ranking** | Same field; select facets by model-rated relevance |
| **Generic self-refine** | Draft, self-critique, and revision without the spider lifecycle |
| **Tree/search baseline** | Explore and score multiple reasoning branches, such as a Tree-of-Thoughts-style implementation |
| **WebChess 2.0** | Full Anansi–Chess–Portia–Gate–Retry–Charlotte–Wilbur–Web lifecycle |

Where cost permits, add human-facilitated devil's advocacy, cross-model debate, and expert-panel deliberation. A weak baseline proves little.

## 18.3 Required ablations

The full system should be dismantled experimentally.

1. Remove I Ching-inspired lenses while preserving facets and chess.
2. Remove Chess and give all sixty-four facets directly to Portia.
3. Replace Engine V2 with random legal play.
4. Remove Portia and send terminal survivors directly to Charlotte.
5. Replace Portia with same-model self-critique.
6. Remove the Gate and force Charlotte to answer every case.
7. Disable Retry.
8. Remove Charlotte and provide Portia survivors to a generic answer model.
9. Remove Wilbur follow-up and measure only immediate answer ratings.
10. Remove cross-case memory while preserving within-case provenance.

The full architecture earns credit only for improvements that disappear when the relevant component is removed.

## 18.4 Task portfolio

No single benchmark can validate WebChess. The evaluation portfolio should contain distinct task classes.

### 18.4.1 Controlled synthetic tasks

Create cases with known hidden structure, planted assumptions, redundant facets, decisive counterevidence, and measurable optimal actions. These enable precision and recall estimates for Portia and Gate.

### 18.4.2 Expert-authored open-ended cases

Domain experts should author strategy, product design, operations, research planning, organizational, and creative problems with scoring rubrics. Experts must not write the cases to flatter WebChess's categories.

### 18.4.3 Naturalistic user cases

With informed consent, recruit users bringing real but low- or moderate-stakes questions. Record original framing, prior beliefs, chosen actions, and follow-up outcomes.

### 18.4.4 Creativity batteries

AGC-Bench, introduced as a July 2026 preprint, assembles seventy-eight datasets across six creativity domains and reports a broad comparative study across eighty-three language models (Beaty et al., 2026). It is relevant for testing Anansi's generative breadth, Charlotte's idea quality, and sensitivity to prompting. It cannot validate the complete WebChess lifecycle because it does not measure this system's provenance, Portia judgments, Gate calibration, real-world action, or privacy costs.

WebChess evaluation should therefore use AGC-Bench as one external battery, not as a coronation ceremony.

### 18.4.5 Longitudinal field cases

Organizations or research teams can pilot the method on bounded decisions with predeclared metrics and follow-up windows. Early field work should exclude decisions whose errors can materially damage rights, health, safety, employment, or access.

## 18.5 Measurement framework

### 18.5.1 Anansi metrics

- actor, mechanism, evidence, value, temporal, risk, and option coverage;
- semantic independence and cluster diversity;
- hidden-structure recall on synthetic tasks;
- user-rated recognition of the actual problem;
- expert-rated omission severity;
- proportion of generic or template-driven facets;
- novelty and usefulness scored separately; and
- cost, latency, and failure rate.

### 18.5.2 Chess metrics

- survivor diversity;
- capture and route coverage;
- sensitivity to seed, policy, search depth, and node budget;
- semantic relevance of terminal survivors;
- information gain relative to random selection;
- recurrence adjusted for positional advantage;
- marginal downstream quality per unit of compute; and
- user comprehension of what the game did and did not establish.

### 18.5.3 Portia metrics

On controlled cases where candidate status is independently adjudicated:

- false preservation rate;
- false consumption rate;
- qualification accuracy for wounded candidates;
- calibration of severity and uncertainty;
- factual-source precision;
- attack coverage;
- novelty retention;
- inter-evaluator agreement and disagreement quality;
- susceptibility to prompt framing; and
- error correlation with Anansi and Charlotte.

Portia should be penalized for indiscriminate severity. A spider that eats everything is not discerning; it is hungry.

### 18.5.4 Gate metrics

- pass/retry/refusal accuracy against blinded panels;
- calibration curves for the Gate score;
- sensitivity to threshold and weight changes;
- false-pass cost and false-retry cost;
- stability across paraphrases;
- rate of hard-floor violations;
- prediction of downstream answer quality;
- prediction of Wilbur learning or outcome quality; and
- ability to refuse when evidence is genuinely insufficient.

### 18.5.5 Retry metrics

- adequacy gained per retry;
- field versus game retry diagnostic accuracy;
- cross-run stability;
- cost and latency inflation;
- frequency of answer shopping;
- percentage of cases exhausting budget;
- diversity gained versus noise introduced; and
- whether Portia autopsies improve the next Anansi field.

### 18.5.6 Charlotte metrics

- directness;
- claim-to-source traceability;
- fidelity to preserved and wounded candidates;
- absence of consumed-candidate resurrection;
- stakeholder coverage;
- value-constraint compliance;
- uncertainty retention;
- action specificity and reversibility;
- factual consistency across audience variants;
- persuasion-to-evidence ratio; and
- blinded usefulness ratings.

### 18.5.7 Wilbur metrics

- action adoption and completion;
- implementation fidelity;
- time to informative feedback;
- evidence generated;
- stop-rule compliance;
- unexpected harms and affected-party reports;
- decision reversal when thresholds are met;
- learning value even when the action fails; and
- causal confidence appropriate to the design.

### 18.5.8 Web metrics

- completeness of provenance reconstruction;
- ability to reproduce a cast and replay a game;
- traceability from final claim to source and event;
- retention-policy compliance;
- access-control violations;
- deletion and export reliability;
- cross-case benefit under consent;
- stale-memory transfer errors;
- privacy leakage; and
- storage and governance cost.

## 18.6 Human evaluation design

Human judges are not ground truth by divine appointment. They carry domain expertise, taste, ideology, fatigue, and framing effects. The evaluation design should therefore:

- use multiple judges with recorded qualifications;
- blind judges to condition labels and visual theatrics;
- randomize output order;
- score originality, usefulness, evidence, feasibility, risk, and communication separately;
- calibrate judge severity where possible;
- preserve disagreement rather than averaging it out immediately;
- include affected-party perspectives, not only experts and product owners; and
- report inter-rater reliability with its limitations.

Judge Response Theory, used in AGC-Bench to model judge leniency and severity, is one candidate method for creativity scoring. It should not be imported mechanically into domains where disagreement expresses legitimate value conflict rather than measurement noise.

## 18.7 Cross-seed and cross-policy analysis

Every case should be treated as a distribution, not a single blessed run. For a subset of cases, generate multiple independent casts and policies. Report:

- survivor overlap;
- semantic theme overlap;
- Portia disposition stability;
- Gate decision stability;
- recommendation direction stability;
- action overlap;
- uncertainty overlap; and
- outlier runs.

A method that produces a different strategic recommendation from every seed may be useful for ideation and dangerous for decision support. The acceptable stability range depends on the intended use and must be specified before deployment.

## 18.8 Cost, latency, and ecological validity

The full lifecycle may require multiple model calls, game searches, evidence retrievals, human checks, retries, and later follow-up. Quality must therefore be analyzed against:

- token use;
- provider spend;
- elapsed time;
- user attention;
- evaluator labor;
- storage;
- energy and infrastructure footprint; and
- opportunity cost relative to simpler methods.

A system that improves rubric scores by two percent while multiplying cost and abandonment by twenty is not automatically progress.

## 18.9 Preregistration and reproducibility

Before confirmatory studies:

- freeze the repository commit, model snapshot or alias, prompts, schemas, rules, engine configuration, Portia attacks, Gate weights, retry limits, and analysis plan;
- preregister primary and secondary outcomes;
- define exclusion and stopping rules;
- preserve failed model calls and protocol deviations;
- publish de-identified fixtures where consent permits;
- release evaluation code and negative results; and
- distinguish exploratory tuning from confirmatory testing.

The current repository already preserves many implementation and game versions. WebChess 2.0 should extend that discipline to every cognitive stage.

## 18.10 Success and failure criteria

A defensible first success claim would require evidence that, on representative low- or moderate-stakes tasks, the full lifecycle:

1. improves independently judged problem coverage or recommendation quality over strong baselines;
2. reduces unsupported claims or unexamined assumptions;
3. produces actions that generate useful evidence;
4. maintains acceptable cross-seed stability;
5. does not cause excessive false consumption, manipulation, or privacy harm; and
6. delivers those gains at a cost users or organizations can justify.

The project should weaken, redesign, or abandon components if:

- Portia cannot outperform generic critique;
- the Gate cannot be calibrated;
- Retry mainly enables answer shopping;
- Chess does not beat random or semantic selection;
- Charlotte increases persuasion more than warrant;
- Wilbur follow-up produces no measurable learning; or
- the Web's privacy burden exceeds its memory value.

A falsifiable architecture must include a dignified path to discovering that its favorite spider is decorative.

---
# 19. Engineering roadmap

The implementation sequence should preserve the current product as a measured baseline. WebChess 2.0 should not be merged as one immense rewrite whose failures cannot be localized.

## Phase 0 — Freeze and instrument the current baseline

Before adding new cognition:

- tag the current rules, engine, prompts, schemas, database migrations, and test fixtures;
- add exportable research records for facets, casts, complete event logs, captures, outcomes, and final answers;
- record engine telemetry required for later route analysis without exposing hidden model reasoning;
- create deterministic replay fixtures across representative games;
- establish cost, latency, abandonment, error, and answer-quality baselines; and
- preserve the existing user experience as a selectable research condition.

**Exit criterion:** a full current-game run can be reproduced, scored, and compared against later versions from one immutable case bundle.

## Phase 1 — Terminal ecology and survivor representation

Add explicit survivor derivation after terminal replay.

Required work:

- reconstruct each surviving piece's route from the append-only event stream;
- attach final facet, lens, role, polarity, position, captures made, and game context;
- calculate only those “survival” features that can be derived reliably;
- distinguish observed route events from engine-estimated threats;
- add survivor schemas, database fields or derived views, and export support;
- build a terminal-ecology interface; and
- test reconstruction against hand-verified fixtures.

**Exit criterion:** the system can produce a deterministic, inspectable survivor package for every completed historical game without changing the current answer.

## Phase 2 — Portia offline prototype

Build Portia first as an offline evaluator over saved case bundles. Do not immediately put it in the user-facing critical path.

Prototype components:

- versioned attack definitions;
- same-model, cross-model, deterministic, retrieval-backed, and human attack adapters;
- evidence typing and source references;
- four-disposition output schema;
- attack coverage and disagreement records;
- false-source and prompt-injection tests;
- a reviewer interface showing candidate, attacks, disposition, and scars; and
- synthetic fixtures with known preserved, wounded, consumed, and unresolved outcomes.

**Exit criterion:** Portia beats generic self-critique on a preregistered synthetic and expert-authored evaluation without excessive false consumption.

## Phase 3 — Gate and controlled Retry

Implement the Gate as a separate service or module whose contract cannot be bypassed accidentally by Charlotte.

Required work:

- dimension scoring and hard floors;
- configuration versioning;
- pass, retry-game, retry-field, and insufficient-basis states;
- game- and field-retry ledgers;
- explicit retry budgets;
- cross-run comparison;
- Portia autopsy packaging for Anansi;
- user controls and cost disclosure; and
- answer-shopping detection.

**Exit criterion:** Gate decisions are reproducible, auditable, and calibrated well enough to predict blinded sufficiency judgments better than a simple survivor-count rule.

## Phase 4 — Charlotte as a distinct stage

Replace the current one-pass post-game synthesis with a Charlotte contract that consumes only Gate-approved material.

Required work:

- explicit protected outcome;
- stakeholder and affected-party map;
- value constraints;
- claim-to-candidate and claim-to-evidence traceability;
- wounds and uncertainty preserved in output;
- exactly bounded reversible actions with observations and stop rules;
- audience-specific variants with factual consistency checks;
- no resurrection of consumed candidates; and
- neutral-language and persuasion-safety evals.

**Exit criterion:** Charlotte outperforms the current final model on traceability, action quality, and uncertainty retention without increasing unsupported persuasion.

## Phase 5 — Wilbur follow-up

Add an optional, human-controlled intervention and outcome layer.

Required work:

- actor authority and consent fields;
- prediction and metric registration;
- action, deadline, threshold, and stopping-rule records;
- follow-up reminders without autonomous execution;
- observation and affected-party reports;
- implementation-fidelity notes;
- outcome uncertainty and causal-confidence fields;
- withdrawal, deletion, and privacy controls; and
- case closure states.

**Exit criterion:** users can convert a recommendation into a bounded intervention, record what happened, and close the case without the application claiming causality it did not establish.

## Phase 6 — The Web as a provenance graph

The present relational schema already stores durable games and events. WebChess 2.0 should extend it into an explicit provenance graph while retaining transactional integrity.

A practical implementation can map:

- questions, facets, casts, survivors, Portia judgments, recommendations, interventions, and observations to **entities**;
- model calls, games, attacks, Gate decisions, retries, communications, and actions to **activities**; and
- users, models, reviewers, organizations, and tools to **agents**.

W3C PROV-DM supplies a domain-neutral vocabulary for entities, activities, agents, derivations, responsibility, bundles, and collections. WebChess need not adopt RDF or every PROV relation, but it should preserve compatible concepts so provenance can be exported and reasoned about (W3C, 2013).

Required work:

- immutable stage IDs and derivation links;
- provenance bundles per case and per retry;
- redaction-aware exports;
- access-control and retention policies by memory layer;
- consented cross-case retrieval;
- stale-memory and contamination tests;
- deletion tombstones that preserve integrity without retaining forbidden content; and
- research snapshots.

**Exit criterion:** an authorized reviewer can reconstruct why every final claim exists, what it depended on, what was rejected, who acted, and what was later observed.

## Phase 7 — Evaluation release

Only after the previous stages have bounded contracts should the project run a public research program.

Deliverables:

- benchmark fixtures and scoring code;
- blinded evaluation harness;
- ablation configurations;
- cross-seed runner;
- AGC-Bench adapter for relevant generation tests;
- cost and latency reporting;
- cultural and domain-review reports;
- preregistered protocols;
- safety incident process; and
- publication of negative and null results.

## 19.1 Migration and backward compatibility

Existing games should remain valid under their original rules, engine, cast, prompt, and event versions. WebChess 2.0 must not reinterpret old records silently.

Recommended rules:

- historical games retain the current post-game answer as an immutable artifact;
- survivor packages may be derived later if the old event record supports them;
- Portia judgments added retrospectively are labeled retrospective and versioned;
- old cases do not enter cross-case learning without renewed consent;
- schema changes follow the repository's existing append-only migration discipline; and
- production rollback never rewrites provenance history.

## 19.2 User experience

The eight stages should not appear as eight walls of text. The interface can remain legible by showing:

1. a compact lifecycle rail;
2. stage-specific artifacts rather than hidden “thinking” animation;
3. an expandable terminal board and survivor ecology;
4. Portia dispositions with plain-language reasons;
5. the Gate decision and retry budget;
6. Charlotte's recommendation beside its evidence and wounds;
7. Wilbur's action card and follow-up record; and
8. a Web view for provenance, not a decorative network animation.

Every animation must explain a state transition. A spider wandering across the screen while a model call stalls would be theatrical fraud with eight legs.

## 19.3 Security boundaries

The current repository's server-authoritative principles should continue:

- model and retrieval credentials remain server-side;
- browser input never becomes authoritative game, attack, Gate, or provenance state;
- user and model text are untrusted data, not instructions;
- model calls are idempotent and durably accounted;
- retries cannot duplicate provider spending silently;
- source retrieval is allowlisted or user-approved;
- Portia cannot execute tools beyond its adjudication scope;
- Charlotte cannot trigger Wilbur action directly;
- Wilbur action requires an authenticated human actor; and
- cross-case memory obeys explicit consent and access controls.

## 19.4 Cost architecture

The full lifecycle can become expensive. The design should support graduated modes:

| Mode | Stages | Intended use |
|---|---|---|
| **Reflection** | Anansi → Chess → current synthesis | Fast, low-cost legacy experience |
| **Review** | Anansi → Chess → Portia → Gate → Charlotte | Serious one-session analysis |
| **Experiment** | Review mode + Wilbur follow-up | Action and learning over time |
| **Research** | Multi-seed, multi-policy, human review, full Web export | Evaluation and institutional study |

Users should see expected model calls, retry limits, and maximum authorized cost before beginning.

---
# 20. Worked example

The following example is illustrative. It demonstrates the proposed contracts and control flow; it is not a completed experiment or evidence that WebChess improves this decision.

## 20.1 The question

> **Should a mid-sized manufacturing company deploy an AI maintenance copilot across all three plants this year?**

The user supplies initial context:

- three plants with different equipment ages and maintenance practices;
- an experienced but understaffed maintenance workforce;
- fragmented manuals, work orders, and tribal knowledge;
- concern about downtime, safety, data quality, cybersecurity, and worker acceptance;
- an executive desire for a visible AI initiative; and
- no completed pilot.

The protected outcome is not “deploy AI.” It is:

> Improve maintenance reliability and knowledge access without degrading safety, worker authority, security, or operational continuity.

## 20.2 Anansi creates the field

Anansi generates sixty-four facets. A small sample:

| Grid location | Facet |
|---|---|
| Purpose × Clarify | Distinguish a reliability objective from an executive visibility objective |
| People × Receive | Learn how technicians currently verify uncertain procedures |
| Resources × Challenge | Test whether historical work orders are clean enough to ground recommendations |
| Timing × Begin | Identify one bounded asset class suitable for a sixty-day pilot |
| Risks × Connect | Map how wrong instructions could travel from generated text into physical work |
| Values × Consolidate | Preserve technician stop-work authority and source visibility |
| Evidence × Challenge | Separate vendor benchmark claims from plant-specific failure data |
| Possibilities × Adapt | Compare an answer copilot with retrieval-only search, document cleanup, and scheduling support |

Anansi also labels uncertainty. Several facets contain user assertions that have not been verified, such as the amount of preventable downtime and the completeness of manuals.

## 20.3 The first cast and game

The facets, I Ching-inspired lenses, and board positions are independently permuted. White outside-in evidence moves inward; Black inside-out intent moves outward. Engine V2 plays the complete game.

Suppose Black captures the White King on ply 83. The first terminal board contains five surviving pieces:

| Survivor | Polarity and role | Literal facet at final square |
|---|---|---|
| Black Queen | Intent / Agency | Executive sponsorship and available budget |
| Black Pawn | Intent / Practice | Initial pilot staffing |
| White Bishop | Evidence / Perspective | Technician verification habits |
| White Knight | Evidence / Reframing | Retrieval-only alternative |
| White Pawn | Evidence / Practice | Work-order data quality sample |

The capture trail contains additional salient conflicts, including a Black Bishop challenging the distinction between vendor claims and local evidence. Nothing in this result proves that the five survivors are the right five considerations. They are Portia's prey.

## 20.4 Portia hunts the first ecology

### Candidate A — Executive sponsorship and budget

**Attack:** Causal relevance and adversarial stakeholder.

Portia finds that sponsorship is necessary for procurement but does not establish operational readiness. The CFO may support deployment because the budget is available, while maintenance supervisors bear the failure cost.

**Disposition:** **Wounded.** Preserve as an enabling condition; prohibit it from functioning as evidence of readiness.

### Candidate B — Initial pilot staffing

**Attack:** Evidence and actionability.

The user has no staffing baseline. Portia cannot determine whether a pilot can be supported without overtime or delayed repairs.

**Disposition:** **Unresolved.** Requires a workload sample and a named pilot owner.

### Candidate C — Technician verification habits

**Attack:** Counterevidence and adversarial stakeholder.

Interviews described in the user's context suggest that experienced technicians rely on visual inspection, peer confirmation, and manual cross-checking when procedures are ambiguous, but the claim has not yet been measured locally. A copilot that hides sources would conflict with the hypothesized practice.

**Disposition:** **Wounded.** Retain as a design constraint requiring observation rather than as an established fact.

### Candidate D — Retrieval-only alternative

**Attack:** Redundancy, actionability, and counterfactual removal.

The candidate survives and materially changes the decision. A retrieval-only system could test document access and adoption before allowing generative procedural synthesis.

**Disposition:** **Preserved.** Strong lower-risk comparator.

### Candidate E — Work-order data quality

**Attack:** Evidence and seed sensitivity.

No direct sample has yet been inspected. Portia cannot tell whether the presumed data-quality problem is real, severe, or merely conventional anxiety about industrial records.

**Disposition:** **Unresolved.** Requires direct sampling.

Portia has not disproved the field. It has consumed or narrowed enough of the first ecology that only one preserved candidate remains, supported by several wounded or unresolved strands. The surviving set lacks explicit purpose protection, implementation structure, and a high-severity safety or cybersecurity counterposition.

## 20.5 The first Gate decision

The Gate evaluates:

- Purpose coverage: low;
- Evidence coverage: low;
- Risk coverage: low;
- Agency coverage: moderate;
- Tension coverage: moderate;
- Independence: moderate; and
- Unresolved severity: high.

The hard floors fail. There is no independent risk-bearing survivor and no adequate evidence-bearing candidate.

**Decision:** `retry_game`.

The field itself contains purpose, safety, cybersecurity, governance, data, workforce, and alternative-design facets. The failure appears to lie in this traversal and terminal ecology rather than in Anansi's representation. The Web preserves the failed run; Retry does not erase it or reroll in secret.

## 20.6 Retry launches a second game

Retry retains the same sixty-four facets but creates an independently recorded cast and game seed. The second game ends with White capturing the Black King on ply 97. Its terminal ecology includes:

| Survivor | Polarity and role | Literal facet at final square |
|---|---|---|
| White King | Evidence / Core purpose | Maintenance reliability rather than executive visibility |
| Black Rook | Intent / Structure | Standard operating procedure ownership |
| Black Pawn | Intent / Practice | Plant-specific pilot staffing |
| White Bishop | Evidence / Perspective | Technician verification habits |
| White Knight | Evidence / Reframing | Retrieval-only alternative |
| White Rook | Evidence / Structure | Cybersecurity and network segmentation |
| White Pawn | Evidence / Practice | Work-order and manual data quality |

Portia now attacks the new survivor packages and compares them with the first run.

- **Reliability objective — Preserved.** It survives purpose and causal-relevance attacks. The executive desire for a visible AI initiative is demoted to context, not objective.
- **Procedure ownership — Preserved.** No operational answer can be trusted if source approval, versioning, and withdrawal of obsolete content have no owner.
- **Pilot staffing — Wounded.** A Plant 2 pilot appears plausible, but it must begin with a measured workload baseline and an explicit support ceiling.
- **Technician verification habits — Wounded.** The requirement for source visibility persists across games, but local observation is still required.
- **Retrieval-only alternative — Preserved.** It recurs across independent casts and remains the necessary comparator.
- **Cybersecurity and segmentation — Preserved as a blocking constraint.** The architecture must be reviewed before any pilot connects to operational technology; read-only isolation and no control-system write access are mandatory preconditions.
- **Data quality — Wounded.** A bounded corpus audit must precede any generative use; work-order learning remains excluded until evidence improves.

The recurrence of retrieval-only comparison across both games is informative but not proof. The second ecology is stronger because it adds independent purpose, governance, risk, and implementation strands that survived explicit attacks.

## 20.7 The second Gate decision

The survivor set now contains:

- a protected reliability objective;
- a governance and procedure-ownership requirement;
- an explicit safety and cybersecurity blocking condition;
- a feasible but bounded pilot path;
- a retrieval-only comparator;
- a data-quality limitation; and
- independent tensions among speed, control, worker trust, executive visibility, and operational continuity.

The Gate passes **for a staged, conditional experiment**, not for enterprise deployment. It records a hard constraint: Charlotte may not recommend plant-wide deployment and may not authorize a pilot until the security and staffing preconditions are satisfied.

## 20.8 Charlotte chooses and communicates

Charlotte's recommendation:

> Do not deploy a generative maintenance copilot across all three plants this year. First complete an operational-technology security review and a Plant 2 staffing baseline. If those preconditions pass, run a sixty-day, read-only pilot at Plant 2 that compares source-linked retrieval with a tightly bounded generative assistant on one non-safety-critical asset class. Preserve technician stop-work authority, display every source and document version, prohibit unsourced procedural instructions, and keep the system disconnected from control functions. Enterprise expansion should depend on predefined evidence: reduced search time without increased error, verified user adoption, no security exceptions, acceptable staffing load, and correction of known document-quality defects.

The recommendation is accompanied by three reversible actions:

1. **Establish the boundary:** complete the security architecture review, staffing baseline, and source-governance assignments; stop if any blocking condition fails.
2. **Curate and compare:** approve the corpus for one asset class and run retrieval-only and bounded-generation conditions under the same users and tasks.
3. **Review at day sixty:** continue, narrow, revise, or stop using predeclared thresholds for search time, task accuracy, source verification, technician trust, security events, and workload.

Charlotte also produces audience variants:

- executives receive a decision memo emphasizing staged evidence, capital discipline, and conditions for expansion;
- technicians receive operating boundaries, source visibility, and stop-work authority; and
- security receives architecture, logging, access, and incident controls.

The factual claims and conditions remain identical across versions. Charlotte changes rhetoric, not reality.

## 20.9 Wilbur encounters reality

Wilbur is the Plant 2 maintenance operation, including the technicians, supervisors, production assets, and safety obligations affected by the intervention. The human organization completes the preconditions and authorizes the pilot.

The registered expectations are:

- retrieval time decreases by at least 25 percent;
- no increase in procedural errors;
- at least 70 percent of participating technicians judge source display adequate;
- no high-severity security incident;
- pilot support consumes no more than eight maintenance hours per week; and
- every generated answer can be traced to approved documents.

Suppose the observed result is mixed:

- retrieval time improves by 31 percent;
- retrieval-only and generative conditions perform similarly on routine questions;
- the generative condition helps with terminology variation but occasionally synthesizes across two procedures in an unsafe way;
- technicians strongly prefer source-linked retrieval for high-consequence tasks;
- no security incident occurs; and
- support load is twelve hours per week, above threshold.

The consequence does not prove that generative copilots are bad or that retrieval is universally superior. It supports a narrower conclusion in this setting: document curation and retrieval produce most of the value, while cross-procedure synthesis and support burden remain uncontrolled.

## 20.10 The Web remembers

The Web preserves:

- the original question and protected outcome;
- all sixty-four facets and their provenance;
- both casts and complete game histories;
- every survivor package;
- Portia's dispositions and attack evidence from both ecologies;
- the failed and passed Gate records;
- Charlotte's recommendation and audience variants;
- the security and staffing precondition records;
- the pilot protocol and registered thresholds;
- observed outcomes and incidents;
- the decision not to expand; and
- the new question generated by the case:

> Can a curated retrieval system with narrow terminology normalization deliver the useful behavior without cross-procedure synthesis?

That question becomes the next Anansi input. The lifecycle does not end with an answer. It ends with a better inherited problem.

---
# 21. Conclusion

WebChess began as a way to make one difficult question encounter sixty-four perspectives before receiving an answer. The current implementation already accomplishes more than an ordinary prompt: it preserves the question, constructs a structured field, introduces bounded recombination, forces a complete conflict trajectory, records the events, and grounds a final synthesis in an inspectable trail.

Its limitation is now visible. The present game selects salience and then hands that salience directly to a persuasive language model. It lacks an independent semantic predator, a sufficiency authority, controlled recursion, a formally protected object of concern, and memory of real consequences.

The proposed lifecycle supplies those missing organs:

> **Anansi imagines. Chess creates conflict. Portia hunts. The Gate judges sufficiency. Retry renews the search. Charlotte chooses and communicates. Wilbur encounters reality. The Web remembers.**

This sequence is intellectually interesting because each stage has a different failure objective:

- Anansi may omit or repeat.
- Chess may select irrelevant material.
- Portia may preserve nonsense or destroy novelty.
- The Gate may pass too easily or refuse too often.
- Retry may learn or merely shop for answers.
- Charlotte may communicate responsibly or manipulate.
- Wilbur may generate evidence or absorb harm.
- The Web may preserve learning or become surveillance.

The architecture becomes serious only when these failures are measured independently. Myth supplies the names. Biology, literature, cognitive science, AI research, software engineering, and provenance theory supply analogies and tools. None supplies validation of the whole.

WebChess 2.0 should therefore be built as an instrument that can refuse its own performance. It must be able to say that the field was shallow, the game uninformative, Portia uncertain, the Gate closed, the retry budget exhausted, Charlotte unauthorized, Wilbur unprotected, or the Web forbidden to remember.

The web's value is not that it catches an answer. It is that it preserves the struggle by which an answer earns a provisional right to act.

---

# Appendix A. Current circular-chess rules and engine specification

This appendix records the implementation reviewed at repository commit `6d3c7fa0f86d9ec09dd25f899a9fbc12c5b33c67`. It is descriptive, not a claim about a promoted production deployment.

| Component | Current implementation |
|---|---|
| Board | Eight bounded concentric rings × eight wrapping sectors |
| Initial Black position | Back rank on ring 0; pawns on ring 1 |
| Initial White position | Back rank on ring 7; pawns on ring 6 |
| First move | White |
| Black polarity | Inside-out intent; moves generally outward |
| White polarity | Outside-in evidence; moves generally inward |
| Sector geometry | Wraps modulo eight |
| Ring geometry | Stops at inner and outer boundaries |
| Rook | Radial or same-ring sector movement |
| Bishop | Ring-sector diagonals |
| Queen | Rook plus Bishop movement |
| Knight | Polar-grid knight movement implemented by canonical move generator |
| King | One-step Queen movement; captured directly |
| Pawn | One ring forward; initial clear two-ring advance; diagonal capture; Queen promotion |
| Check/checkmate | Absent |
| Castling | Absent |
| En passant | Absent |
| Forced pass | Server inserts pass when active side has no legal move and opponent can move |
| Win | Direct opposing King capture |
| Draw | Mutual immobility, 100 quiet plies, or 256 total plies |
| Ending precedence | King capture first, then mutual immobility, quiet limit, total-ply limit |
| Ply 256 | Legal; King capture wins before move-limit draw |
| Play modes | Manual, one guided move, autoplay |
| Guided engine | Purpose-built WebChess Engine V2 |
| Search | Iterative deepening principal-variation alpha-beta search |
| Search support | Aspiration windows, transposition table, quiescence, static exchange evaluation, move ordering |
| Evaluation | Material, promotion race, activity, King danger, edge pressure, tempo |
| Default budget | 150,000 deterministic nodes per move |
| Determinism | Fixed-node search plus seeded root tie-break |
| Execution | Worker-backed with bounded fallback |
| Semantic access | None; engine does not read facets or lenses |
| Browser authority | Proposes piece, destination, expected revision |
| Server authority | Replays events, validates moves, derives passes, captures, promotions, counters, and outcome |

# Appendix B. Portia attack and Gate reference tables

## B.1 Portia attack matrix

| Attack | Primary target | Evidence required | Typical kill condition | Typical wound condition |
|---|---|---|---|---|
| Assumption | Hidden premise | Candidate text, user context | Load-bearing premise contradicted | Premise plausible but unverified |
| Counterevidence | Factual support | Approved sources or observations | Credible contradiction destroys claim | Evidence narrows scope |
| Stakeholder | Strategic robustness | Named actor and incentives | Actor can predictably defeat proposal | Mitigation or negotiation required |
| Causal relevance | Decision mechanism | Causal map or domain judgment | True but irrelevant to decision | Secondary rather than primary driver |
| Redundancy | Independence | Survivor comparison | No substantive distinction | Partial overlap remains |
| Seed sensitivity | Path dependence | Multiple independent runs | Candidate appears only as unstable artifact | Candidate recurs but with variable support |
| Counterfactual removal | Leverage | Bounded regenerated interpretation | Removal changes nothing; candidate ornamental | Candidate matters only to one subclaim |
| Actionability | Operational value | Test or observation design | No inquiry or action follows | Requires additional information |
| Failure simulation | Downside | Scenario and affected parties | Foreseeable irreversible harm dominates | Controls or limits required |
| Unsupported-claim audit | Epistemic type | Source and provenance graph | Symbol or inference presented as fact | Claim retained as hypothesis |

## B.2 Gate pilot template

| Dimension | Pilot scoring question | Example evidence |
|---|---|---|
| Purpose | Does the set address the protected outcome? | Direct mapping to decision objective |
| Evidence | Are some claims grounded beyond model inference? | User observation, source, measurement |
| Risk | Is a serious downside or affected party represented? | Failure scenario and severity |
| Agency | Can the user learn or act? | Reversible experiment or information step |
| Tension | Does the set preserve a genuine tradeoff? | Independent forces that cannot be collapsed |
| Independence | Are candidates substantively distinct? | Different assumptions, mechanisms, or sources |
| Unresolved severity | What remains unknown and how dangerous is it? | Open high-impact questions |

Recommended pilot decisions:

```text
PASS
RETRY_GAME
RETRY_FIELD
INSUFFICIENT_BASIS
```

No numerical configuration should be deployed without a version ID, sensitivity analysis, and calibration record.

# Appendix C. Reference audit

## C.1 Audit method

The reference list was rebuilt rather than inherited mechanically from the previous paper. Each retained item was checked against at least one of the following:

- the publisher or proceedings record;
- the DOI landing page;
- an official university or institutional repository;
- an official standards or documentation site;
- the current WebChess repository; or
- the original book or a reputable library/publisher record.

The audit checked title, author, year, publication venue, volume or proceedings where available, pages or article number where available, and DOI or stable URL. References were retained only when they support a specific claim in the paper. A long bibliography is not an epistemic achievement; it is a larger attack surface.

## C.2 Sources deliberately removed or narrowed

The revised paper does not rely on:

- the unofficially compiled Bobby Fischer interview transcript previously used for a memorable quotation;
- claims that nobody else has ever connected *Charlotte's Web* with AI;
- unsourced statements that a historical figure “anticipated” modern AI;
- future-dated publication claims without a publisher or authoritative record;
- citation counts or popularity metrics as evidence of truth;
- marketing pages as scientific support;
- model-generated quotations; or
- the WebChess white paper itself as proof that WebChess works.

Fischer remains relevant through official FIDE Chess960 rules. Jung remains historical context, not a causal authority. AGC-Bench is labeled a 2026 preprint rather than established validation. Current OpenAI model and API facts are linked to official OpenAI documentation and should be rechecked whenever the implementation changes.

## C.3 Repository audit boundary

Implementation statements were checked against `jr4488/webchess` on `main` at commit `6d3c7fa0f86d9ec09dd25f899a9fbc12c5b33c67`, including:

- `README.md`;
- `docs/ARCHITECTURE.md`;
- `src/lib/problem.ts`;
- `src/lib/division.ts`;
- `src/lib/game.ts`;
- `src/lib/game-replay.ts`;
- `src/lib/engine/index.ts`;
- `src/server/openai/division.ts`;
- `src/server/openai/answer.ts`; and
- the server HTTP and service-adapter layers.

Later repository changes may make implementation claims stale. The commit is therefore part of the citation.

# Appendix D. Glossary

**ANANSI:** The Anansi subroutine: **Analyze, Name, Associate, Navigate, Synthesize, Iterate**. “Synthesize” means build candidate structures, not issue the final recommendation. “Iterate” means repair the generative field locally; lifecycle-level Retry remains a separate authority.

**Anansi:** The stage responsible for structured plurality, perspective generation, and field repair.

**Attention weight:** A hand-designed relative display score attached to a capture. It is not probability, evidence, confidence, or objective importance.

**Cast:** The reproducible seeded assignment of facets, I Ching-inspired lenses, and board positions.

**Charlotte:** The stage that converts Gate-approved survivors into a value-constrained, truthful, audience-aware recommendation and reversible actions.

**Chess:** The semantically blind constrained-conflict stage operating on the circular board.

**Consumed:** Portia disposition for a candidate that should not enter Charlotte's recommendation because it is unsupported, redundant, irrelevant, unstable, or dangerously misleading.

**Facet:** One problem-specific title, focus, question, and keyword assigned to an exact dimension × movement slot.

**Gate:** The independent sufficiency authority deciding Pass, Retry Game, Retry Field, or Insufficient Basis.

**I Ching-inspired lens:** A short, randomized change metaphor named after one of sixty-four hexagrams. It is not evidence, prophecy, or a claim of traditional divination.

**Inside-out intent:** Black's polarity: purpose, commitment, values, and desired direction moving outward to engage conditions.

**Outside-in evidence:** White's polarity: facts, constraints, feedback, and conditions moving inward to test intention.

**Portia:** The adversarial stage that hunts terminal survivors through versioned attacks.

**Preserved:** Portia disposition for a candidate that survived meaningful attack with bounded uncertainty.

**Provenance:** Information about the entities, activities, agents, derivations, and responsibility involved in producing an artifact or decision.

**Retry:** The controlled recursion stage that launches another game, revises the field through Anansi, or terminates with insufficient basis.

**Salience:** Procedurally generated priority for inspection. Salience does not imply truth.

**Survivor package:** The structured terminal representation of a living piece, including its facet, lens, role, polarity, final position, route, conflicts, outcome context, and provenance.

**The Web:** The provenance and memory substrate that preserves births, conflicts, deaths, judgments, recommendations, interventions, observations, and forgetting events.

**Unresolved:** Portia disposition used when available evidence cannot adjudicate the candidate.

**Wilbur:** The person, project, organization, community, ecosystem, or protected outcome that bears the consequences of action and supplies real-world feedback.

**Wounded:** Portia disposition for a candidate that remains useful only under explicit qualification or narrower scope.

---

# References

1. Arthur, P. (2019). Man, know thyself: The role of Ananse stories in Ghanaian pedagogy. *Journal of Mother-Tongue Biblical Hermeneutics and Theology, 1*(2), 8–24. [https://doi.org/10.32051/12301902](https://doi.org/10.32051/12301902)

2. Beaty, R., Deshpande, V., Lai, C. K. Y., Attuch, A., Shivagunde, N., Roy, S., Pujari, R., DiStefano, P. V., Muckatira, S., Stevenson, C. E., Gronas, M., & Rumshisky, A. (2026). AGC-Bench: Measuring artificial general creativity. *arXiv preprint arXiv:2607.01152*. [https://arxiv.org/abs/2607.01152](https://arxiv.org/abs/2607.01152)

3. Boonpromkul, P. (2022). Friendship, humility, and the complicated morality of E. B. White's *Charlotte's Web*. *MANUSYA: Journal of Humanities, 25*(1), 1–18. [https://doi.org/10.1163/26659077-25010019](https://doi.org/10.1163/26659077-25010019)

4. Campbell, D. T. (1960). Blind variation and selective retention in creative thought. *Psychological Review, 67*(6), 380–400. [https://doi.org/10.1037/h0040373](https://doi.org/10.1037/h0040373)

5. Camuffo, A., Gambardella, A., Messinese, D., Novelli, E., Paolucci, E., & Spina, C. (2024). A scientific approach to entrepreneurial decision-making: Large-scale replication and extension. *Strategic Management Journal, 45*(6), 1209–1237. [https://doi.org/10.1002/smj.3580](https://doi.org/10.1002/smj.3580)

6. Cross, F. R., & Jackson, R. R. (2019). Portia's capacity to decide whether a detour is necessary. *Journal of Experimental Biology, 222*(15), jeb203463. [https://doi.org/10.1242/jeb.203463](https://doi.org/10.1242/jeb.203463)

7. Dorst, K., & Cross, N. (2001). Creativity in the design process: Co-evolution of problem–solution. *Design Studies, 22*(5), 425–437. [https://doi.org/10.1016/S0142-694X(01)00009-6](https://doi.org/10.1016/S0142-694X%2801%2900009-6)

8. FIDE Rules Commission. (n.d.). *Guidelines II: Chess960 rules*. Retrieved August 1, 2026. [https://rcc.fide.com/guidelinesii/](https://rcc.fide.com/guidelinesii/)

9. Finke, R. A., Ward, T. B., & Smith, S. M. (1992). *Creative cognition: Theory, research, and applications*. MIT Press. [https://mitpress.mit.edu/9780262061506/creative-cognition/](https://mitpress.mit.edu/9780262061506/creative-cognition/)

10. Gentner, D. (1983). Structure-mapping: A theoretical framework for analogy. *Cognitive Science, 7*(2), 155–170. [https://doi.org/10.1207/s15516709cog0702_3](https://doi.org/10.1207/s15516709cog0702_3)

11. Gick, M. L., & Holyoak, K. J. (1983). Schema induction and analogical transfer. *Cognitive Psychology, 15*(1), 1–38. [https://doi.org/10.1016/0010-0285(83)90002-6](https://doi.org/10.1016/0010-0285%2883%2990002-6)

12. Gnoli, G. (1996; updated 2017). Dualism. *Encyclopaedia Iranica, VII*(6), 576–582. [https://www.iranicaonline.org/articles/dualism/](https://www.iranicaonline.org/articles/dualism/)

13. Hon, T.-K. (2023). Chinese philosophy of change (Yijing). In E. N. Zalta & U. Nodelman (Eds.), *The Stanford Encyclopedia of Philosophy*. [https://plato.stanford.edu/entries/chinese-change/](https://plato.stanford.edu/entries/chinese-change/)

14. Huang, J., Chen, X., Mishra, S., Zheng, H. S., Yu, A. W., Song, X., & Zhou, D. (2024). Large language models cannot self-correct reasoning yet. *International Conference on Learning Representations*. [https://proceedings.iclr.cc/paper_files/paper/2024/hash/8b4add8b0aa8749d80a34ca5d941c355-Abstract-Conference.html](https://proceedings.iclr.cc/paper_files/paper/2024/hash/8b4add8b0aa8749d80a34ca5d941c355-Abstract-Conference.html)

15. Hutchins, E. (1995). *Cognition in the wild*. MIT Press. [https://mitpress.mit.edu/9780262581462/cognition-in-the-wild/](https://mitpress.mit.edu/9780262581462/cognition-in-the-wild/)

16. Jackson, R. R. (1995). Cues for web invasion and aggressive mimicry signalling in *Portia* (Araneae, Salticidae). *Journal of Zoology, 236*(1), 131–149. [https://doi.org/10.1111/j.1469-7998.1995.tb01789.x](https://doi.org/10.1111/j.1469-7998.1995.tb01789.x)

17. Jackson, R. R., & Cross, F. R. (2013). A cognitive perspective on aggressive mimicry. *Journal of Zoology, 290*(3), 161–171. [https://doi.org/10.1111/jzo.12036](https://doi.org/10.1111/jzo.12036)

18. Jackson, R. R., & Nelson, X. J. (2011). Reliance on trial and error signal derivation by *Portia africana*, an araneophagic jumping spider from East Africa. *Journal of Ethology, 29*(2), 301–307. [https://doi.org/10.1007/s10164-010-0258-5](https://doi.org/10.1007/s10164-010-0258-5)

19. Jansson, D. G., & Smith, S. M. (1991). Design fixation. *Design Studies, 12*(1), 3–11. [https://doi.org/10.1016/0142-694X(91)90003-F](https://doi.org/10.1016/0142-694X%2891%2990003-F)

20. Ji, Z., Lee, N., Frieske, R., Yu, T., Su, D., Xu, Y., Ishii, E., Bang, Y. J., Madotto, A., & Fung, P. (2023). Survey of hallucination in natural language generation. *ACM Computing Surveys, 55*(12), Article 248, 1–38. [https://doi.org/10.1145/3571730](https://doi.org/10.1145/3571730)

21. Jung, C. G. (2010). *Synchronicity: An acausal connecting principle* (R. F. C. Hull, Trans.). Princeton University Press. (Original work published 1952.) [https://doi.org/10.2307/j.ctt7s94k](https://doi.org/10.2307/j.ctt7s94k)

22. Kirsh, D., & Maglio, P. (1994). On distinguishing epistemic from pragmatic action. *Cognitive Science, 18*(4), 513–549. [https://doi.org/10.1207/s15516709cog1804_1](https://doi.org/10.1207/s15516709cog1804_1)

23. Larkin, J. H., & Simon, H. A. (1987). Why a diagram is (sometimes) worth ten thousand words. *Cognitive Science, 11*(1), 65–100. [https://doi.org/10.1111/j.1551-6708.1987.tb00863.x](https://doi.org/10.1111/j.1551-6708.1987.tb00863.x)

24. Madaan, A., Tandon, N., Gupta, P., Hallinan, S., Gao, L., Wiegreffe, S., Alon, U., Dziri, N., Prabhumoye, S., Yang, Y., Gupta, S., Majumder, B. P., Hermann, K., Welleck, S., Yazdanbakhsh, A., & Clark, P. (2023). Self-Refine: Iterative refinement with self-feedback. *Advances in Neural Information Processing Systems, 36*. [https://doi.org/10.52202/075280-2019](https://doi.org/10.52202/075280-2019)

25. Malthouse, E., Liang, Y., Russell, S., & Hills, T. T. (2022). The influence of exposure to randomness on lateral thinking in divergent, convergent, and creative search. *Cognition, 218*, 104937. [https://doi.org/10.1016/j.cognition.2021.104937](https://doi.org/10.1016/j.cognition.2021.104937)

26. Marshall, E. Z. (2012). *Anansi's journey: A story of Jamaican cultural resistance*. University of the West Indies Press. [https://www.uwipress.com/9789766402617/anansis-journey/](https://www.uwipress.com/9789766402617/anansis-journey/)

27. Newell, A., Shaw, J. C., & Simon, H. A. (1958). Elements of a theory of human problem solving. *Psychological Review, 65*(3), 151–166. [https://doi.org/10.1037/h0048495](https://doi.org/10.1037/h0048495)

28. Nickerson, R. S. (1998). Confirmation bias: A ubiquitous phenomenon in many guises. *Review of General Psychology, 2*(2), 175–220. [https://doi.org/10.1037/1089-2680.2.2.175](https://doi.org/10.1037/1089-2680.2.2.175)

29. OpenAI. (2026). *GPT-5.6 Sol model documentation*. Retrieved August 1, 2026. [https://developers.openai.com/api/docs/models/gpt-5.6-sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)

30. Perez, E., Huang, S., Song, F., Cai, T., Ring, R., Aslanides, J., Glaese, A., McAleese, N., & Irving, G. (2022). Red teaming language models with language models. *arXiv preprint arXiv:2202.03286*. [https://arxiv.org/abs/2202.03286](https://arxiv.org/abs/2202.03286)

31. Ratelle, A. (2014). Ethics and edibility in *Charlotte's Web*. *The Lion and the Unicorn, 38*(3), 327–341. [https://doi.org/10.1353/uni.2014.0026](https://doi.org/10.1353/uni.2014.0026)

32. Reiter-Palmon, R., Mumford, M. D., O'Connor Boes, J., & Runco, M. A. (1997). Problem construction and creativity: The role of ability, cue consistency, and active processing. *Creativity Research Journal, 10*(1), 9–23. [https://doi.org/10.1207/s15326934crj1001_2](https://doi.org/10.1207/s15326934crj1001_2)

33. Rietzschel, E. F., Nijstad, B. A., & Stroebe, W. (2010). The selection of creative ideas after individual idea generation: Choosing between creativity and impact. *British Journal of Psychology, 101*(1), 47–68. [https://doi.org/10.1348/000712609X414204](https://doi.org/10.1348/000712609X414204)

34. Risko, E. F., & Gilbert, S. J. (2016). Cognitive offloading. *Trends in Cognitive Sciences, 20*(9), 676–688. [https://doi.org/10.1016/j.tics.2016.07.002](https://doi.org/10.1016/j.tics.2016.07.002)

35. Rushdy, A. H. A. (1991). “The miracle of the web”: Community, desire, and narrativity in *Charlotte's Web*. *The Lion and the Unicorn, 15*(2), 35–60.

36. Shinn, N., Cassano, F., Gopinath, A., Narasimhan, K., & Yao, S. (2023). Reflexion: Language agents with verbal reinforcement learning. *Advances in Neural Information Processing Systems, 36*. [https://doi.org/10.52202/075280-0377](https://doi.org/10.52202/075280-0377)

37. Thibodeau, P. H., & Boroditsky, L. (2011). Metaphors we think with: The role of metaphor in reasoning. *PLOS ONE, 6*(2), e16782. [https://doi.org/10.1371/journal.pone.0016782](https://doi.org/10.1371/journal.pone.0016782)

38. Thomas, T. H. (2016). The arc of the rope swing: Humour, poetry, and spirituality in *Charlotte's Web* by E. B. White. *International Journal of Children's Spirituality, 21*(3–4), 201–215. [https://doi.org/10.1080/1364436X.2016.1228618](https://doi.org/10.1080/1364436X.2016.1228618)

39. Thomke, S. H. (1998). Managing experimentation in the design of new products. *Management Science, 44*(6), 743–762. [https://doi.org/10.1287/mnsc.44.6.743](https://doi.org/10.1287/mnsc.44.6.743)

40. Turing, A. M. (1950). Computing machinery and intelligence. *Mind, 59*(236), 433–460. [https://doi.org/10.1093/mind/LIX.236.433](https://doi.org/10.1093/mind/LIX.236.433)

41. WebChess Project. (2026). *WebChess repository*, `main` commit `6d3c7fa0f86d9ec09dd25f899a9fbc12c5b33c67`. GitHub. [https://github.com/jr4488/webchess](https://github.com/jr4488/webchess)

42. White, E. B. (1952). *Charlotte's Web*. Harper & Brothers.

43. Whitson, J. A., & Galinsky, A. D. (2008). Lacking control increases illusory pattern perception. *Science, 322*(5898), 115–117. [https://doi.org/10.1126/science.1159845](https://doi.org/10.1126/science.1159845)

44. Wilhelm, R. (Trans.), Baynes, C. F. (English Trans.), & Jung, C. G. (Foreword). (1967). *The I Ching or Book of Changes* (3rd ed.). Princeton University Press.

45. World Wide Web Consortium. (2013). *PROV-DM: The PROV data model*. W3C Recommendation. [https://www.w3.org/TR/prov-dm/](https://www.w3.org/TR/prov-dm/)

46. Yao, S., Yu, D., Zhao, J., Shafran, I., Griffiths, T. L., Cao, Y., & Narasimhan, K. (2023). Tree of Thoughts: Deliberate problem solving with large language models. *Advances in Neural Information Processing Systems, 36*. [https://proceedings.neurips.cc/paper_files/paper/2023/hash/271db9922b8d1f4dd7aaef84ed5ac703-Abstract.html](https://proceedings.neurips.cc/paper_files/paper/2023/hash/271db9922b8d1f4dd7aaef84ed5ac703-Abstract.html)

47. Zhang, J., & Norman, D. A. (1994). Representations in distributed cognitive tasks. *Cognitive Science, 18*(1), 87–122. [https://doi.org/10.1207/s15516709cog1801_3](https://doi.org/10.1207/s15516709cog1801_3)
