# WebChess

## A research and technical white paper on problem decomposition, constrained play, symbolic reframing, and AI-assisted synthesis

**Version:** 1.1  
**Date:** July 24, 2026  
**Status:** Design description and research agenda  
**Project:** WebChess 0.1.0

## Contents

1. [Executive summary](#1-executive-summary)
2. [Claims and evidence standard](#2-claims-and-evidence-standard)
3. [The design problem](#3-the-design-problem-reasoning-about-ill-structured-questions)
4. [System architecture](#4-system-architecture)
5. [Genuine 64-facet division](#5-stage-one-genuinely-dividing-the-problem-into-64-facets)
6. [Randomization and casting](#6-stage-two-randomization-and-the-casting-of-the-field)
7. [Circular chess](#7-stage-three-the-circular-chess-system)
8. [Semantic grammar of conflict](#8-stage-four-the-semantic-grammar-of-conflict)
9. [I Ching-inspired lenses](#9-stage-five-i-ching-inspired-change-lenses)
10. [Final AI synthesis](#10-stage-six-final-ai-synthesis)
11. [Why the method might work](#11-why-the-method-might-work)
12. [Intellectual lineage](#12-intellectual-lineage)
13. [Integrated theory of operation](#13-integrated-theory-of-operation)
14. [Evidence map](#14-evidence-map)
15. [Failure modes and mitigations](#15-failure-modes-risks-and-mitigations)
16. [Appropriate and inappropriate use](#16-appropriate-and-inappropriate-use)
17. [Validation program](#17-a-falsifiable-validation-program)
18. [Development roadmap](#18-development-roadmap)
19. [Worked example](#19-worked-example)
20. [Conclusion](#20-conclusion)
21. [Current implementation specification](#appendix-a-current-implementation-specification)
22. [Glossary](#appendix-b-glossary)
23. [References and further reading](#references-and-further-reading)

---

## Abstract

WebChess is an experimental problem-solving system that converts an open-ended question into a completed game with an inspectable capture trail. A reasoning model is instructed to analyze the actual question into exactly 64 problem-specific facets intended to be semantically distinct. The application verifies their count, IDs, field lengths, exact normalized title/focus uniqueness, and several explainable failure patterns such as numbered scaffolds, dominant number-substitution templates, and widespread high lexical overlap. Those checks cannot prove conceptual distinctness, relevance, or correct analysis. The accepted facets are independently shuffled, paired with independently shuffled I Ching-inspired change lenses, and cast onto the 64 cells of a circular chessboard. White moves from the outside inward and represents outside-in evidence: facts, constraints, conditions, and feedback pressing inward to test intention. Black moves from the inside outward and represents inside-out intent: purpose, values, commitments, and desired direction moving outward to engage reality. Chess-piece roles add a second interpretive grammar. Captures select particular facet–lens combinations for closer attention; a final model synthesizes the ending and capture trail into a schema-validated candidate answer and three reversible next actions.

The central claim of this paper is deliberately bounded. WebChess does **not** discover truth through chess, calculate a solution in the real-world problem space, or use the I Ching as an oracle. It is best understood as a structured external-representation, perturbation, attention-allocation, and reflection protocol. Research supports several component mechanisms: active problem construction, representational change, analogical transfer, constrained search, productive dissent, external cognition, metacognitive reflection, and iterative experimentation. Research also supplies serious warnings. Random prompts can be useless or harmful; metaphors can anchor judgment; people perceive meaning in noise; and fluent AI output can invite over-reliance. The project is not aware, as of July 19, 2026, of a published controlled study demonstrating that the complete WebChess method improves creativity, innovation, or decision quality; this is an absence-of-known-evidence statement, not the result of a systematic review.

Accordingly, this paper does four things. It documents what the current software actually does; explains the cognitive and computational rationale for each layer; separates evidence-supported mechanisms from WebChess-specific hypotheses; and proposes a falsifiable research program. The governing epistemic rule is:

> **Board events generate salience, not evidence.**

A capture creates a reason to inspect a facet. It does not show that the facet is true, causal, or objectively more important. Evidence enters only when a user connects the highlighted question to observation, data, stakeholder testimony, domain knowledge, or an actual experiment.

---

## 1. Executive summary

WebChess addresses a familiar difficulty in creative problem solving: an important question often arrives as a single compressed sentence, while any useful response depends on many partially hidden considerations. Stakeholders, values, evidence, assumptions, timing, resources, risks, and alternative framings interact. A conventional answer can move too quickly from that compressed statement to a polished recommendation, leaving the original framing largely unexamined.

WebChess inserts a long, visible transformation between question and answer:

    Player's problem
            |
            v
    AI proposes 64 problem-specific facets
            |
            v
    Facets, I Ching lenses, and board positions are separately shuffled
            |
            v
    8-ring x 8-sector polar chess game
      White: evidence moves inward
      Black: intent moves outward
            |
            v
    Captures create an inspectable conflict trail
            |
            v
    AI synthesizes selected tensions into a candidate answer
            |
            v
    Human judges, tests, observes, and revises

The method deliberately separates **divergence** from **convergence**:

1. **Divergence:** attempt to expand one problem into 64 distinct, inspectable questions.
2. **Perturbation:** introduce uncommon facet–hexagram–location combinations.
3. **Selection:** let a complete, rule-governed game create a bounded attention trail.
4. **Interpretation:** combine the literal facet, change lens, side polarity, and piece roles.
5. **Convergence:** produce a direct answer, explicit tension, and three next moves.
6. **Learning:** test those moves against reality and revise the problem representation.

This architecture is plausible because creativity ordinarily requires both novelty and effectiveness, not novelty alone ([Runco & Jaeger, 2012](https://doi.org/10.1080/10400419.2012.650092)). Innovation raises the bar further: an idea becomes innovation only through implementation and realized use or value, a distinction made in organizational research ([Amabile & Pratt, 2016](https://doi.org/10.1016/j.riob.2016.10.001); [Anderson, Potočnik, & Zhou, 2014](https://doi.org/10.1177/0149206314527128)) and the [OECD/Eurostat Oslo Manual](https://doi.org/10.1787/9789264304604-en). WebChess can at most help generate and interrogate a candidate direction. It does not itself implement or validate that direction.

### 1.1 What WebChess is

- A structured method for expanding, reframing, and revisiting an open-ended problem.
- A circular chess variant whose legal moves create a finite sequence of attention events.
- A metaphor system in which evidence and intention meet without either being defined as good or bad.
- An AI-assisted workflow with one structured decomposition call and one grounded synthesis call.
- A visible record of how particular issues entered the final answer.
- A generator of hypotheses and reversible actions for human evaluation.

### 1.2 What WebChess is not

- A formal proof, optimizer, causal model, or exhaustive search of the real problem.
- A claim that 64 is a scientifically optimal number of facets.
- A formal performance of traditional Yijing divination.
- A method in which a capture establishes truth or a winner establishes correctness.
- A chess engine that semantically understands the problem represented on the squares.
- A substitute for evidence, expertise, consent, fiduciary responsibility, or professional judgment.
- A validated medical, legal, financial, safety, or crisis-decision tool.

---

## 2. Claims and evidence standard

A hybrid system can sound more established than it is because familiar terms—chess, I Ching, creativity, reasoning, artificial intelligence—carry cultural authority. This paper therefore uses four explicit evidence levels.

| Level | Meaning | Example |
|---|---|---|
| **Implemented fact** | Directly verifiable in the current WebChess code | A fresh 128-bit seed is generated after a valid 64-facet response |
| **Design rationale** | The intended purpose of a feature | Independent shuffling is intended to disrupt habitual associations |
| **Research-supported analogue** | Prior research supports a related component mechanism | External representations can alter the cognitive work required by a task |
| **Untested WebChess hypothesis** | A measurable proposition about this particular combination | Full WebChess will produce more useful novel options than an AI-only answer |

The fourth level must never be silently promoted to the third. Research on diagrams does not validate this diagram. Research on analogy does not validate a random analogy. Research on chess search does not show that a chess game searches a business or personal problem. Research on reflection does not show that a particular animated interface improves reflection.

The recommended scientific formulation is:

> WebChess is a structured external-representation and reflection protocol. It decomposes a problem, perturbs habitual associations, uses rule-governed interaction to allocate attention, and asks AI to turn the resulting trace into hypotheses and low-cost tests. Research makes the component mechanisms plausible, but the complete method remains experimentally unvalidated.

---

## 3. The design problem: reasoning about ill-structured questions

Many consequential questions are ill structured. Their initial state is incomplete, goals may conflict, important variables may be unknown, stakeholders may disagree about success, and there may be no single correct stopping rule. Work on problem solving has long distinguished the representation of a problem from search within that representation ([Newell, Shaw, & Simon, 1958](https://doi.org/10.1037/h0048495); [Newell & Simon, 1976](https://doi.org/10.1145/360018.360022)). Studies of insight further show that progress can require changing the representation itself—relaxing a tacit constraint or decomposing a familiar chunk—rather than searching harder within the original framing ([Kaplan & Simon, 1990](https://doi.org/10.1016/0010-0285(90)90008-R); [Knoblich et al., 1999](https://doi.org/10.1037/0278-7393.25.6.1534)).

Problem construction is also part of creativity. Reiter-Palmon and colleagues found that active processing and the construction of the problem affect creative performance ([Reiter-Palmon et al., 1997](https://doi.org/10.1207/s15326934crj1001_2)). In design practice, the problem and solution spaces may co-evolve: developing a possible solution changes what the problem is understood to be, and vice versa ([Dorst & Cross, 2001](https://doi.org/10.1016/S0142-694X(01)00009-6)). This matters because a one-pass answer can preserve the user’s first formulation even when the most useful outcome would be to revise it.

Expertise does not mean merely considering more surface details. In classic physics categorization studies, experts organized problems around deeper principles while novices relied more on surface features ([Chi, Feltovich, & Glaser, 1981](https://doi.org/10.1207/s15516709cog0502_2)). That finding cannot be transferred wholesale to open-ended life or organizational questions, which may have no agreed deep structure. It does establish a quality criterion for WebChess: 64 paraphrases are not 64 facets. A useful decomposition should expose actors, mechanisms, constraints, trade-offs, evidence gaps, time horizons, values, and alternatives that can genuinely change the answer.

The number 64 is therefore a **designed coverage constraint**, not a discovered law. It is shared by the 8 × 8 structure of chess and the 64 hexagrams of the received Yijing tradition. Its possible value lies in forcing breadth, comparison, and persistence. Its possible cost is fragmentation, redundancy, cognitive overload, and false completeness. Those competing effects are empirical questions.

---

## 4. System architecture

WebChess has five principal layers:

1. **Semantic decomposition:** a reasoning model proposes 64 problem-specific facets under a strict structural schema and instructions for semantic distinctness.
2. **Independent casting:** three domain-separated shuffles vary facet order, I Ching lens pairing, and board location.
3. **Polar chess:** manual play, one-turn guidance, or autoplay produces a trajectory under circular movement rules; continued play or autoplay reaches a bounded ending.
4. **Capture interpretation:** each conflict combines side direction, two piece metaphors, one literal facet, one change lens, and a heuristic attention weight.
5. **AI synthesis:** a second model receives the bounded game evidence and writes a grounded candidate response.

The server exposes those two model stages through a provider abstraction.
<code>openai-api</code> is the default direct Responses API adapter;
<code>codex-chatgpt</code> is an optional local adapter that uses a dedicated
ChatGPT-authenticated Codex CLI. Selection is explicit and fail-closed: neither
adapter silently substitutes the other when credentials, allowance, model
access, readiness, or a request fails.

The human remains outside and above this pipeline. The system transforms and prioritizes material; the user decides whether a mapping is meaningful, supplies real evidence, rejects false associations, and owns any resulting action.

### 4.1 Formal representation

Let the normalized player problem be \(P\).

Let the eight practical dimensions be:

\[
D = \{\text{Purpose, People, Resources, Timing, Risks, Values, Evidence, Possibilities}\}
\]

Let the eight movements be:

\[
M = \{\text{Begin, Receive, Clarify, Connect, Challenge, Adapt, Consolidate, Release}\}
\]

The first model is instructed to generate one facet for each ordered pair:

\[
F = \{f_{ij} = A(P, d_i, m_j) \mid d_i \in D, m_j \in M\}
\]

where \(A\) is the model-mediated analysis process. The software assigns dimension and movement metadata from each returned ID; the equation describes the requested analytic coverage, not a semantic guarantee that every model-written item actually satisfies its slot. Each facet contains:

\[
f = (\text{id}, \text{title}, \text{focus}, \text{question}, \text{keyword})
\]

The IDs preserve the analytic grid:

\[
\operatorname{id}(f_{ij}) = 8i + j + 1,\quad i,j \in \{0,\ldots,7\}
\]

Let \(H\) be the 64 named hexagram lenses and \(B\) the 64 board cells. The server creates a fresh 16-byte random seed \(s\). The client derives three labeled deterministic shuffles:

\[
F' = \pi_F(s, F), \qquad H' = \pi_H(s, H)
\]

\[
Q_k = (F'_k, H'_k), \qquad C = \pi_B(s, Q)
\]

The labels for the three shuffles are distinct, so facet order, hexagram order, and final board placement do not reuse the same permutation. Given the same validated facets and seed, the deterministic composition functions reproduce the field exactly. The current interface does not yet expose that capability as a saved-replay control. A new analysis obtains a new field.

This is **constrained randomness**. It changes associations and positions while preserving the analytic grid, the complete hexagram set, the board grammar, and the one-to-one pairing. The seed is cryptographically generated, but the presentation shuffle itself uses a compact deterministic pseudorandom generator; it is intended for reproducibility and variation, not cryptographic security.

### 4.2 Event representation

A capture event can be represented as:

\[
e_t = (t, c, a, z, f, h, w)
\]

where:

- \(t\) is the turn/ply index, including a forced pass if one occurred earlier in the count;
- \(c\) is the destination cell;
- \(a\) is the attacking piece and side;
- \(z\) is the captured piece and side;
- \(f\) is the facet assigned to \(c\);
- \(h\) is the independently paired I Ching lens;
- \(w\) is the heuristic attention weight.

The final synthesis receives the original question, outcome, turn/ply and conflict totals, definitions of both side polarities, grouped captured facets with recurrence counts and peak attention weights, and the chronological capture trail. It does not receive ordinary non-capturing moves, full piece trajectories, uncaptured facets, or hidden model reasoning.

### 4.3 Visible work, progress, and animation

WebChess treats animation as a state-communication layer. During division, the interface advances through six named milestones:

1. configured model analyzing 64 candidate facets;
2. 64 model facets received;
3. problem facets independently shuffled;
4. I Ching lenses independently shuffled;
5. facets paired with hexagrams;
6. pairs cast onto 64 board cells.

The mapping view uses a 64-cell progress measure during the final cast. The board then awakens cell by cell, pieces enter, moves show direction, capture targets pulse, and a capture flare marks the activated facet. During play, a persistent process graphic reports turn/ply count, captured signals, and a seven-capture reflection-depth marker that is neither evidence nor an ending condition. During final synthesis, the graphic changes to an answering state, and the resolved answer enters as visible sections.

These displays communicate public process state. An elapsed timer or moving graphic proves only that a request or transition is active, not that the model has reached a particular insight.

The activity panel can also stream reasoning text, and what it shows is provider-dependent and explicitly labelled. Direct API mode shows OpenAI reasoning summaries, which are generated descriptions written for a reader rather than the literal internal state. Local Ollama mode shows the model's raw thinking events, which are literal but stay on the operator's machine. Local Codex mode shows none, because the adapter pins reasoning summaries off. Displayed reasoning is process evidence, not a correctness argument: a fluent account of an approach can accompany a wrong answer, so the evaluation targets in section 4 still apply to the final output rather than to the narration of it.

---

## 5. Stage one: genuinely dividing the problem into 64 facets

### 5.1 Input contract

The server collapses whitespace and accepts a problem statement from 12 to 240 characters. This short input is not treated as a complete specification. It is the object of analysis, and the original question is sent to the selected model provider in this first run. The provider abstraction keeps trusted policy separate from serialized user data: API mode uses the Responses API <code>instructions</code> and <code>input</code> fields, while local Codex mode uses a trusted instruction file and passes the delimited user payload on standard input. That role separation and data delimiting reduce instruction confusion; they do not make arbitrary user text intrinsically safe or eliminate the need to validate output.

### 5.2 The 8 × 8 analytic matrix

The dimensions and movements are WebChess analytic categories. They are **not** claimed to be traditional I Ching categories.

| Dimension | What it asks the model to cover |
|---|---|
| Purpose | The result that truly matters |
| People | People affected and perspectives they hold |
| Resources | Time, energy, knowledge, and material capacity |
| Timing | What is ready now and what may require patience |
| Risks | Uncertainty, trade-offs, and unintended effects |
| Values | Principles and boundaries worth honoring |
| Evidence | What is known, assumed, missing, or contradicted |
| Possibilities | Alternatives not yet explored |

Each is crossed with eight movements:

| Movement | Cognitive operation |
|---|---|
| Begin | Identify a first revealing step |
| Receive | Learn through listening and observation |
| Clarify | Make a distinction that sharpens understanding |
| Connect | Find a relationship that changes the situation |
| Challenge | Test a potentially distorting assumption |
| Adapt | Identify a change that improves alignment |
| Consolidate | Protect or stabilize what should endure |
| Release | Loosen or remove what blocks movement |

This design produces systematic coverage without prescribing the content. “Evidence × Challenge,” for example, must become a concrete facet of the submitted problem, not a generic sentence about challenging evidence.

### 5.3 Model and structured output

The current configurable default is the model ID **gpt-5.6-sol**. The division call uses medium reasoning effort and the same JSON Schema across providers. Direct API mode uses Structured Outputs through the Responses API with a maximum of 20,000 output tokens. Local Codex mode runs non-interactively with the schema, but its CLI adapter cannot enforce the Responses API token-ceiling field; WebChess instead bounds the run with strict event parsing, a 2 MiB standard-output cap, and a 120-second timeout. OpenAI’s documentation describes [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) as a reasoning model for complex professional work, and its [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs) explains that schema-constrained responses can adhere to a supplied JSON Schema.

The schema requires exactly 64 objects, each with an integer ID from 1 through 64 and bounded strings for title, focus, question, and keyword. Application validation then adds invariants that schema shape alone cannot express:

- every ID from 1 through 64 appears exactly once;
- titles are unique after normalization;
- focuses are unique after normalization;
- all strings remain within their length bounds;
- no extra commentary or symbolic assignment is accepted;
- incomplete, refused, missing, or malformed structured responses are rejected;
- deterministic quality checks reject obvious numbered scaffolds, dominant
  number-substitution templates, and widespread high-overlap wording.

These checks catch bounded structural and lexical failure patterns, not semantic truth. OpenAI’s own Structured Outputs guidance warns that schema adherence does not prevent substantive mistakes. A list can contain 64 validly shaped yet shallow, misleading, or false items. WebChess therefore instructs the model to make titles and focuses meaningfully distinct and to derive them from the actors, tensions, constraints, evidence, or possibilities in the actual problem. The offline fixtures are regression checks, not proof of quality; representative model evaluation and human review remain necessary.

### 5.4 Why decomposition might help

Decomposition can:

- make assumptions explicit;
- separate goals from means;
- distinguish observation from interpretation;
- reveal neglected stakeholders;
- expose dependencies and contradictions;
- create multiple entry points for reframing;
- reduce the burden of holding an entire problem in working memory.

It can also harm:

- relationships may be lost when a system is split into parts;
- 64 slots may manufacture distinctions that do not matter;
- the model may create an illusion of comprehensive analysis;
- a long list may overwhelm the user;
- early framing errors may be replicated 64 times.

The appropriate interpretation is therefore not “the problem has 64 natural parts.” It is “the system has generated 64 inspectable hypotheses about how the problem may be examined.”

---

## 6. Stage two: randomization and the casting of the field

After validation, WebChess creates three separately derived permutations.

1. **Problem-facet permutation.** The 64 generated facets are shuffled.
2. **Hexagram permutation.** The 64 I Ching-inspired lenses are shuffled independently of the facets.
3. **Board permutation.** The completed facet–hexagram pairs are shuffled again before assignment to cells.

Each facet retains its original dimension and movement based on its ID. Each hexagram remains intact as a name and reflective theme. What changes is which facet receives which change lens and where that pair appears on the board.

### 6.1 Why randomize?

Randomization is intended to reduce the dominance of expected associations and create a wider search through possible interpretations. Turing made the design intuition succinctly in 1950:

> “A random element is rather useful when we are searching for a solution of some problem.”

In context, [Turing](https://doi.org/10.1093/mind/LIX.236.433) was discussing search when many satisfactory solutions may exist. He did not establish that arbitrary random stimuli improve judgment. The distinction is decisive. Randomness can diversify the material that receives attention; it cannot certify that a particular association is relevant.

Creativity theories have long emphasized remote association and variation ([Mednick, 1962](https://doi.org/10.1037/h0048850); [Campbell, 1960](https://doi.org/10.1037/h0040373); [Simonton, 2010](https://doi.org/10.1016/j.plrev.2010.02.002)). Studies of invention and scientific impact likewise suggest that unusual combinations can produce high-variance outcomes, including occasional breakthroughs, while familiar structure remains important ([Fleming, 2001](https://doi.org/10.1287/mnsc.47.1.117.10671); [Uzzi et al., 2013](https://doi.org/10.1126/science.1240474)).

But direct counterevidence prevents a simple “randomness causes creativity” claim. In a preregistered experiment with 592 participants, unrelated random Wikipedia stimuli did not improve and often impaired creative problem solving ([Malthouse et al., 2022](https://doi.org/10.1016/j.cognition.2021.104937)). Across eight studies, Toubia and Netzer linked semantic-network prototypicality to judged creativity; in their final study, prototypicality-optimized recommendations were the only condition that both increased modification and improved judged creativity, while random words did not increase modification propensity ([Toubia & Netzer, 2017](https://doi.org/10.1287/mksc.2016.0994)). WebChess’s hypothesis is narrower: **bounded random association, followed by explicit evaluation against the literal problem, may help some users escape fixation.** That proposition needs direct testing.

### 6.2 Reproducibility and seed sensitivity

Randomness introduces a scientific requirement: conclusions should be tested for seed sensitivity. If small changes in pairing produce incompatible recommendations, no single reading should be treated as authoritative. A stronger future workflow would run several seeds, compare stable and unstable themes, and label:

- **robust signals:** recur across materially different casts;
- **seed-dependent provocations:** useful ideas that appear only in some runs;
- **contradictions:** recommendations that reverse across runs;
- **coverage gaps:** important facets never selected by play.

This would turn variability from a hidden weakness into inspectable information.

---

## 7. Stage three: the circular chess system

### 7.1 Board geometry

The WebChess board contains eight bounded concentric rings and eight angular sectors. The sectors wrap: sector 7 is adjacent to sector 0. Rings do not wrap: ring 0 is the inner boundary and ring 7 is the outer boundary. Together they form 64 cells.

Black’s back rank begins on ring 0 and its pawns on ring 1. Black advances outward. White’s back rank begins on ring 7 and its pawns on ring 6. White advances inward. The conventional back-rank order is retained around each side:

    Rook, Knight, Bishop, Queen, King, Bishop, Knight, Rook

Movement is adapted to polar coordinates:

- rooks move radially or around a ring;
- bishops move along ring-sector diagonals;
- queens combine rook and bishop movement;
- kings move one ring/sector step;
- knights use polar versions of the familiar 2-by-1 offsets;
- pawns advance in their side’s radial direction and capture diagonally; an unmoved pawn on its starting ring may advance two clear rings;
- a pawn promotes to a queen on reaching the opposite radial edge.

White takes the first turn. The engine intentionally omits check, castling, and en passant. Kings can be captured directly. These are pseudo-legal chess moves designed for a reflective variant, not FIDE tournament chess.

### 7.2 Why chess?

Chess contributes a stable grammar of alternating action, constraint, reply, sacrifice, pressure, protection, and closure. Shannon’s foundational account of computer chess framed play in terms of legal transformations, alternating branches, terminal outcomes, and heuristic evaluation ([Shannon, 1950](https://doi.org/10.1080/14786445008521796)). Minimax formalizes the need to consider capable opposition in two-person zero-sum games ([von Neumann, 1928](https://doi.org/10.1007/BF01448847)); alpha-beta analysis shows why selective evaluation matters when exhaustive search is expensive ([Knuth & Moore, 1975](https://doi.org/10.1016/0004-3702(75)90019-3)). AlphaZero is a modern example of coupling candidate selection and evaluation with search under an exact game objective ([Silver et al., 2018](https://doi.org/10.1126/science.aar6404)); WebChess has no comparable validated objective for the user’s real-world problem.

WebChess borrows this **discipline of reply**, not the mathematical guarantees. Most human problems are not two-person, zero-sum, deterministic, fully observable, or equipped with an objective utility function. The chess tree is not the problem’s state space. A better chess move is not automatically a better business, ethical, personal, or scientific move.

The more accurate description is:

> WebChess uses chess as a rule-constrained attention scheduler over an AI-generated representation of a problem.

Captures identify items for inspection. The game provides a coherent path and stopping condition. It does not optimize the external situation.

### 7.3 Play modes and guided move selection

The interface supports three modes: the user may move pieces manually, request one guided turn, or enable autoplay. Autoplay begins disabled; once enabled, it repeatedly chooses guided moves until an ending. A manual session therefore reaches the end only if the user continues play or turns autoplay on.

For each guided turn, the player evaluates every currently legal move and chooses the highest-scoring candidate. Equal scores are broken by a deterministic hash derived from the normalized problem, turn number, side, piece, and destination. The cast’s random division seed does **not** affect move choice. Consequently, different casts of the same problem place different semantic material under what is otherwise the same guided trajectory, unless the player makes a move or another part of the board state differs.

The current heuristic rewards:

- capturing material, with overwhelming priority for a King capture;
- radial progress in the side’s assigned direction;
- pawn momentum and promotion;
- convergence toward opposing pieces;
- direct pressure on the opposing King.

It penalizes:

- moving a piece where it can be captured immediately;
- exposing the side’s own King.

The heuristic is **designed** to reduce aimless orbiting, value safety, pursue conflict, and move toward an ending more purposefully than uniform random legal play. The repository does not yet contain a comparative simulation demonstrating that advantage, so it remains a testable engineering claim. The policy also remains semantically blind. The move evaluator does not read the facet, its evidence quality, the hexagram theme, or the user’s domain. “Better move” means “higher under the game heuristic,” not “better analysis of the real problem.”

For reference, non-King capture value begins at 12,000 plus 1,000 times the WebChess base piece value; a King capture receives 1,000,000. Radial progress is worth 40 per ring. Enemy-King pressure, hanging-piece risk, own-King exposure, promotion, pawn momentum, and distance to the opposition add secondary terms. These numbers are design choices, not learned or experimentally calibrated parameters.

### 7.4 Completion

The game is designed to play to an actual ending. It terminates when:

- a King is captured;
- neither side has a legal move;
- 100 consecutive plies occur without a capture;
- or 256 total plies are reached.

If the current side has no legal move while the other side does, the current turn is passed and play continues. That forced pass increments both the turn counter and the quiet-ply counter. Accordingly, the payload field named <code>total_moves</code> is more precisely a count of turns or plies and can include passes.

A King capture names a game winner. Other endings are draws. The winner is narrative state, not epistemic verdict. If White captures Black’s King, outside-in evidence has reached the opposing expression of core purpose; that does not prove evidence should always defeat intention. If Black captures White’s King, inside-out intent has reached the opposing expression of core purpose; that does not prove will should override facts.

Bounded completion is important because Simon’s work on bounded rationality rejects the assumption that real decision makers can enumerate and optimize every alternative ([Simon, 1955](https://doi.org/10.2307/1884852)). As he later put it, organisms often “satisfice”; they do not generally optimize ([Simon, 1956](https://doi.org/10.1037/h0042769)). Fast-and-frugal heuristic research likewise formalizes decisions made with limited information and computation while emphasizing that a heuristic’s success depends on its environment ([Gigerenzer & Goldstein, 1996](https://doi.org/10.1037/0033-295X.103.4.650)). WebChess similarly creates a stopping rule and an actionable candidate. Closure is useful; it is not proof of optimality.

---

## 8. Stage four: the semantic grammar of conflict

Every capture combines four different layers. Keeping them separate before combining them is essential.

1. **Literal layer:** the actual facet—title, concrete focus, question, dimension, and movement.
2. **Change layer:** the independently paired hexagram name and reflective theme.
3. **Directional layer:** outside-in evidence or inside-out intent.
4. **Role layer:** the active and challenged chess-piece metaphors.

### 8.1 White and Black

| Side | Direction | Meaning |
|---|---|---|
| White | Outside in | Facts, conditions, constraints, stakeholder feedback, and observed results pressing inward to test intention |
| Black | Inside out | Purpose, values, commitments, desired direction, and chosen agency moving outward to engage reality |

Neither side is truth, goodness, rationality, masculinity, femininity, light, darkness, or moral superiority. Both are necessary modes.

A **White capture** means outside-in evidence is actively pressing into and challenging an expression of inside-out intent. The question is: what does contact with conditions force purpose, values, or plans to reconsider?

A **Black capture** means inside-out intent is actively pressing into and challenging an expression of outside-in evidence. The question is: what purpose, commitment, or chosen direction changes how facts, constraints, or feedback should be acted upon?

This is a designed polarity, not a claim about the colors in traditional chess or the yin–yang structure of the Yijing.

### 8.2 Piece metaphors

| Piece | WebChess role | Interpretive question |
|---|---|---|
| King | **Core purpose** — the outcome that must remain protected | What is genuinely non-negotiable, and is it protected for the right reason? |
| Queen | **Agency** — options, influence, and resources | Which levers exist, who controls them, and what do they cost? |
| Rook | **Structure** — rules, boundaries, and systems | What constraint, institution, or operating rule shapes the situation? |
| Bishop | **Perspective** — values and assumptions | Which viewpoint interprets the facts, and how could it be wrong? |
| Knight | **Reframing** — an indirect route or changed viewpoint | What non-obvious frame or path escapes the current line? |
| Pawn | **Practice** — facts, effort, and small steps close to the work | What can be observed or tried at the smallest useful scale? |

The attacking piece supplies the mode of attention applying pressure. The captured piece identifies the concern, capacity, or assumption placed under review.

For example, a White Knight capturing a Black Rook does not mean “reframing defeats structure.” It means outside-in evidence is arriving through an indirect or changed viewpoint, placing an intended rule, boundary, or system under review. The literal facet then determines what that statement is about; the I Ching lens suggests a possible kind of change. The interpretation becomes useful only if the user can map it to real observations and consequences.

### 8.3 Attention weight

Each capture receives an explainable display weight:

\[
w = \operatorname{round}\left(52 + 2.5V_z + V_a + 2\max(0, 3.5 - |3.5-r|)\right)
\]

where:

- \(V_z\) is the WebChess base value of the captured piece;
- \(V_a\) is the WebChess base value of the attacking piece;
- \(r\) is the destination ring.

The base values are Pawn 1, Knight 3, Bishop 3, Rook 5, Queen 9, and King 10. The formula multiplies the captured piece’s base value by 2.5 and the attacker’s by 1.0; because the piece types may differ, the captured term is not necessarily larger in every event. Conflicts near the middle rings receive more weight because that is where outside-in evidence and inside-out intent most visibly meet. The term is called “attention weight” or “resonance” in the interface.

It is **not** a probability, confidence score, causal estimate, evidence grade, or empirical importance measure. Its constants are hand-designed. Repeated visits to a facet receive a small recurrence lift in the local reading: up to three additional occurrences add eight percent each to the facet’s ranking score. The local reading shows at most three leading signals. These parameters should eventually be calibrated or replaced through evaluation.

### 8.4 The key correlation rule

The complete correlation can be written:

\[
\text{Interpretation}(e_t)
=
\text{literal facet}
+ \text{change lens}
+ \text{side direction}
+ \text{active role}
+ \text{challenged role}
\]

The operators here mean “read together,” not mathematical addition. No individual layer should stand alone:

- a facet without the game is ordinary problem analysis;
- a hexagram without the facet is unconstrained symbolism;
- a piece without the facet is a generic metaphor;
- a capture without evidence is merely a game event;
- a coherent synthesis without a test is still a hypothesis.

---

## 9. Stage five: I Ching-inspired change lenses

### 9.1 Historical and philosophical background

The Yijing, or Book of Changes, is a composite Chinese classic with a long textual and interpretive history. Its received system organizes six-line figures into 64 hexagrams, alongside judgments, line statements, commentarial layers, and later philosophical traditions. Tze-Ki Hon’s [Stanford Encyclopedia of Philosophy overview](https://plato.stanford.edu/archives/sum2024/entries/chinese-change/) emphasizes process, continuity, transformation, and multiple schools of interpretation rather than a single timeless doctrine. For a contemporary scholarly introduction to the text’s history, structure, and uses, see Joseph A. Adler’s [The Yijing: A Guide](https://academic.oup.com/book/41418).

Richard Wilhelm’s German translation and Cary F. Baynes’s English rendering profoundly shaped twentieth-century Anglophone reception. Wilhelm’s introduction describes a process-oriented emphasis:

> “Attention centers not on things in their state of being … but upon their movements in change.”

The quotation appears in Richard Wilhelm’s introduction as rendered by Cary F. Baynes ([Wilhelm & Baynes, 1967, p. xlix](https://lawcat.berkeley.edu/record/541043)). WebChess draws from this orientation toward changing relations. It does not claim that one translation exhausts the Yijing or that a modern Western software system can stand in for its linguistic, ritual, historical, and philosophical contexts. Recent scholarship on the Wilhelm–Jung–Baynes reception also underscores that what many English readers call “the I Ching” has been mediated through a complex cross-cultural collaboration ([Hon, 2026](https://doi.org/10.1515/cwl-2025-2013)).

### 9.2 What WebChess borrows

WebChess borrows:

- a 64-fold field;
- attention to change rather than static labeling;
- complementary polarity rather than simple moral opposition;
- reflection through an encounter between a question and an unfamiliar pattern;
- the idea that uncertainty can provoke inquiry rather than merely block it.

The short themes attached to the 64 named hexagrams are deliberately reflective and non-predictive: beginning under difficulty, waiting, conflict, approach, obstruction, retreat, return, limitation, duration, completion, and so on. They are perspective prompts.

### 9.3 What WebChess does not do

WebChess does not:

- cast traditional lines by coin, yarrow stalk, or another received procedure;
- distinguish changing and unchanging lines;
- derive relating or transformed hexagrams;
- interpret line texts, trigrams, nuclear trigrams, or commentarial schools;
- claim synchronicity, fate, prophecy, or supernatural causation;
- treat a randomly paired theme as evidence about the player.

It is therefore most accurate to say **I Ching-inspired change lens**, not “I Ching reading” in the traditional sense.

### 9.4 Correlative thought and its boundary

Hall and Ames describe strands of classical Chinese thought in terms of “correlative thinking,” in which meaning can arise through patterned association rather than only through linear efficient causation ([Hall & Ames, 1998](https://doi.org/10.4324/9780415249126-G001-1)). This helps explain the intended use of a symbolic lens: it proposes a relationship worth examining.

But meaningful association is not physical causation. Psychology shows that diminished perceived control can increase illusory pattern perception in random or unrelated stimuli ([Whitson & Galinsky, 2008](https://doi.org/10.1126/science.1159845)). The safeguard is not to forbid metaphor; it is to mark the transition from metaphor to claim. A valid WebChess interpretation should state:

1. what literal relationship the metaphor suggests;
2. where the analogy breaks;
3. what competing interpretation is possible;
4. what real evidence would discriminate between them.

That makes the hexagram a generator of questions rather than an authority over answers.

---

## 10. Stage six: final AI synthesis

### 10.1 Evidence sent to the model

After the game reaches an ending, the server applies bounded structural validation and copies only allowed fields into the final prompt:

- the original question;
- the game outcome and completion reason;
- the total turn/ply count (serialized as <code>total_moves</code>) and total conflicts;
- explicit definitions of White and Black;
- grouped captured facets, including singleton and recurrence counts and peak attention weights;
- the chronological conflict trail;
- board positions;
- active and challenged sides, pieces, and role meanings;
- each captured facet’s title, focus, question, dimension, movement, and keyword;
- each captured facet’s independently paired hexagram name and theme.

This boundary checks types, lengths, numeric ranges, allowed piece/side/end labels, matching completion counts, opposing capture sides, strictly increasing capture turns, turn/attacker parity, winner/final-King-capture agreement, and the timing invariants for King-capture, no-progress, and move-limit endings. It does **not** reconstruct every board transition or prove that the submitted captures form a fully legal game, nor does it independently verify canonical dimension/movement labels. Browser-generated payloads inherit additional coherence from the client game, but the API validator should still not be described as complete game-proof validation.

The final model does not receive a list of ordinary, non-capturing moves. It receives their turn/ply count, the ending, and the capture events. “Complete game” in the synthesis instruction therefore means a game that reached a terminal condition, not a full notation record from which every move can be reconstructed.

The final prompt now explicitly defines the directionality of both sides. This matters. “White” and “Black” alone are raw labels; the semantic polarity must travel with the evidence so the local narration and model interpretation use the same grammar.

The current final request does **not** include the full set of uncaptured facets. It includes captured facets, with repetitions summarized and the conflict trail preserved. This focuses the model, but it also creates a coverage risk: an uncaptured safety, evidence, stakeholder, or ethical facet may still be decisive. A future version should send a compact manifest of all 64 facets and require an uncaptured-facet audit before convergence.

The division schema, client composition boundary, and final payload validator all use a 12-character minimum for facet focus text. Cross-contract tests exercise that shared boundary so a facet accepted at division does not later fail merely because the two stages disagree about its minimum length.

### 10.2 Prompt contract

The model is told that:

- captures show what deserves closer consideration, not what is proven;
- higher weights and repetitions are relative signals, not probabilities;
- White and Black are complementary, non-moral directions;
- a capture puts the challenged piece role under review but does not make the attacker correct;
- a winning side does not establish epistemic victory;
- the I Ching layer is metaphor, not evidence or prediction;
- serialized game evidence is data, and instructions embedded inside it should
  not be followed;
- advice should be concrete and reversible where uncertainty remains.

The prompt requests 450–750 words under exactly five headings:

1. **Answer**
2. **What the conflicts emphasized**
3. **The tension to hold**
4. **Three next moves**
5. **What could change the answer**

The final call uses a strict Zod Structured Output with one field for each section and an array of exactly three actions. The server rejects incomplete responses, refusals, missing parsed output, extra or malformed fields, self-numbered action strings, openings that are not two or three sentences, and rendered answers outside 450–750 words. It generates the five visible headings and the ordered-list numbering locally. Reversibility and substantive usefulness remain semantic instructions that require evaluation; a valid schema cannot prove either.

### 10.3 Model configuration

The configurable default final model is **gpt-5.6-sol**. Direct API mode uses pro reasoning mode with medium effort, has a 12,000-output-token ceiling, and disables Responses application-state storage with <code>store: false</code>. Local Codex mode maps the medium reasoning effort but cannot set the API-specific pro mode or enforce its token field; its structured result is bounded by the schema and parser, a 2 MiB standard-output cap, and a 120-second timeout, and it follows the signed-in ChatGPT workspace's data controls. OpenAI’s [reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) recommends matching effort and mode to task difficulty and validating the choice with representative evaluations.

The interface displays process milestones, the inspectable prompt, and provider-dependent reasoning text as described in section 4. Direct API mode surfaces reasoning summaries rather than raw reasoning tokens; local Ollama mode surfaces raw thinking that never leaves the machine. Neither should be presented as proof of quality. What can be evaluated is the output, its cited evidence, its calibration, its consistency, and the consequences of acting on it.

### 10.4 Privacy and security boundary

WebChess has an explicit, fail-closed provider abstraction. <code>openai-api</code> is the default and sends requests directly to the Responses API with a server-side project key. <code>codex-chatgpt</code> is an optional, single-owner local mode that invokes the exact audited Codex CLI 0.145.0 with a dedicated ChatGPT login. Credentials must never be exposed in a browser variable, and a provider failure never triggers fallback to the other provider.

The Codex mode requires Linux, a safely root-owned Bubblewrap installation, the standalone static Linux ELF payload from Codex CLI 0.145.0, a separate absolute canonical <code>WEBCHESS_CODEX_HOME</code> owned by the WebChess user with mode <code>0700</code>, and file-backed credential storage. JavaScript launchers, shell wrappers, and dynamically linked Codex executables are rejected. It refuses the operator's shared <code>~/.codex</code> home and forbids configuration, hooks, rules, project instructions, skills, plugins, and memories in the dedicated home. Each non-interactive run is placed inside a required Bubblewrap filesystem boundary and a root-deny Codex permission profile; shell and browser tools, the separate <code>standalone_web_search</code> feature, collaboration, and normal session persistence are disabled. Native Responses <code>web_search</code> is a separate, explicit opt-in and defaults to disabled. <code>WEBCHESS_CODEX_SHA256</code> can pin the audited executable digest, while <code>WEBCHESS_BWRAP_PATH</code> and <code>WEBCHESS_CA_BUNDLE_PATH</code> support explicit safe system paths. WebChess neither reads nor copies the shared Codex credential. These controls narrow the local subprocess, but they do not make an agent runtime suitable for a public, remote, reverse-proxied, or multi-user service. Codex mode is restricted to one owner and loopback requests; replacement by another process running as that same owner is outside this threat model.

<code>WEBCHESS_CODEX_WEB_SEARCH</code> accepts <code>disabled</code>, <code>cached</code>, <code>indexed</code>, or <code>live</code>. The tracked example and application default are <code>disabled</code>; a local ignored <code>.env</code> can opt this checkout into another mode. Cached mode uses an OpenAI-maintained pre-indexed cache, indexed mode gates external retrieval through the search index, and live mode fetches current web information. This native search tool does not enable browser control, shell tools, or general internet access for model-generated commands. OpenAI's [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) documents the four modes, while its [web-search guidance](https://learn.chatgpt.com/docs/web-search) says to treat every web result as untrusted input and notes that cached mode lowers but does not remove prompt-injection risk.

Enabling search also expands the data boundary: queries derived from the original question and game context may leave the local process, and the query itself may reveal a sensitive subject even when all results are public. Workspace policy can still make search unavailable; when it is available, the native tool does not request approval for each search and may issue multiple queries during either model run. Retrieved pages or snippets can be false, stale, malicious, or crafted to redirect the model. Cached and indexed modes can reduce exposure to arbitrary live pages but cannot remove query-disclosure, misinformation, or prompt-injection risk. Consequential claims still require independent verification against primary sources, and users should avoid secrets or sensitive regulated information.

Paid routes fail closed unless a private access code and session-signing secret meet their minimum lengths. A successful login creates a signed, bounded-lifetime, <code>HttpOnly</code>, <code>SameSite=Strict</code> cookie scoped to <code>/api</code>. API-mode production cookies are also <code>Secure</code>. Direct loopback HTTP in local Codex mode omits <code>Secure</code> for cross-browser compatibility and therefore must never leave its enforced single-owner loopback boundary. Paid requests require an allowed origin, a valid provider-bound session, and the matching in-memory CSRF token. Login attempts and per-session model calls are rate-limited, while a process-global daily call ceiling and provider-specific concurrency gate bound aggregate work: four simultaneous model requests in API mode and one in local Codex mode. Upstream requests have a 120-second timeout, retries are disabled, and client disconnects propagate cancellation. JSON bodies are limited to 256 KB and errors remain JSON.

In direct API mode, trusted policy and serialized user data use separate Responses API fields, payloads and parsed output are bounded, and both model calls use <code>store: false</code>. That setting disables normal storage of Responses application state; it does not by itself mean that no service-side retention of any kind can occur. OpenAI’s current [API data-controls documentation](https://developers.openai.com/api/docs/guides/your-data) distinguishes model-training use, abuse-monitoring logs, application state, and Zero Data Retention eligibility; abuse-monitoring logs may be retained for up to 30 days by default unless different approved controls apply.

Local Codex mode does not use the API project's <code>store: false</code> setting. Its requests are governed by the signed-in ChatGPT workspace's plan, permissions, retention, residency, and data-use controls. ChatGPT/Codex allowance and credits, workspace limits, rate limits, and model availability apply; the mode is not free or unlimited. The question form identifies the active provider and links to its applicable data controls before play. The official [Codex authentication guide](https://learn.chatgpt.com/docs/auth) describes ChatGPT sign-in, and the [ChatGPT data-controls FAQ](https://help.openai.com/en/articles/7730893-data-controls-faq) describes user-facing controls. Users should not submit secrets or sensitive regulated information unless the selected provider's contractual, organizational, and retention controls have been independently reviewed.

Sessions are bound to a random process epoch, so every restart invalidates all prior cookies and requires a new access-code sign-in; a logged-out cookie cannot become valid again after restart. Rate limits, the daily ceiling, and the concurrency gate are process-local. They reset on restart and do not coordinate multiple replicas. A single-process deployment and an OpenAI project budget are therefore the current API-mode operational backstops unless those controls are moved to shared storage. Local Codex mode must remain a single loopback process, and its owner must monitor the signed-in workspace allowance and credits.

---

## 11. Why the method might work

WebChess combines mechanisms that are usually studied separately. This section explains each connection and, equally importantly, where the inference stops.

### 11.1 External representation: making a compressed problem inspectable

External representations do more than store information. They can change the operations a thinker must perform. Larkin and Simon showed that diagrams can be computationally useful when they colocate related information and make relations perceptually available ([Larkin & Simon, 1987](https://doi.org/10.1111/j.1551-6708.1987.tb00863.x)). Zhang and Norman showed experimentally that behavior changes when the same abstract task is distributed differently between internal memory and external representation ([Zhang & Norman, 1994](https://doi.org/10.1207/s15516709cog1801_3)). Kirsh surveys how external representations can alter inferential cost and support persistent, shareable objects of thought ([Kirsh, 2010](https://doi.org/10.1007/s00146-010-0272-8)). Research on cognitive offloading similarly treats action on external media as a way of changing processing demands, while warning that offloading can have costs ([Risko & Gilbert, 2016](https://doi.org/10.1016/j.tics.2016.07.002)).

The WebChess board may help because it turns one sentence into persistent, named objects. A user can inspect a particular evidence gap, value conflict, timing issue, or possibility rather than trying to hold the whole problem mentally. Capture history preserves intermediate states. Repetition makes the path to the answer reviewable.

The limitation is structural fidelity. A random spatial arrangement does not encode the true causal or organizational topology of the problem. The board externalizes **candidate facets**, not a verified model. Every representation makes some relations easy to see and hides others.

### 11.2 Epistemic action: movement that changes what can be thought

Kirsh and Maglio distinguished pragmatic actions, which directly advance a task, from epistemic actions, which make thinking, perception, or choice easier ([Kirsh & Maglio, 1994](https://doi.org/10.1207/s15516709cog1804_1)). A Tetris rotation can reveal fit without being the final placement. In WebChess, a move can be epistemic when it creates a legible encounter between evidence, intention, a literal facet, and two roles.

Animation is valuable only to the extent that it exposes that transformation. A moving arc should show origin, destination, direction, active role, challenged role, and the facet activated at contact. A progress graphic should show which analytic stage is running. Scaife and Rogers caution that graphics, interactivity, and animation are not inherently cognitively beneficial ([Scaife & Rogers, 1996](https://doi.org/10.1006/ijhc.1996.0048)). Decorative motion can split attention, conceal provenance, or create an undeserved feeling of depth. WebChess animations should answer “what changed, why did it matter, and what happens next?”

### 11.3 Distributed cognition: a coordinated thinking system

Hutchins’s account of navigation treats cognition as distributed across people, instruments, procedures, and culturally organized representations ([Hutchins, 1995](https://mitpress.mit.edu/9780262581462/cognition-in-the-wild/)). WebChess can likewise be analyzed as a system:

- the user supplies purpose, context, judgment, and real-world evidence;
- the first model generates a broad representation;
- the facet grid enforces coverage;
- randomness introduces variation;
- the board and move rules create a sequence;
- piece roles supply stable questions;
- the capture log preserves provenance;
- the final model compares and articulates;
- real-world action supplies feedback.

No component is sufficient. The model lacks lived context; the board lacks semantics; randomness lacks relevance; the user has limited attention; and the final prose lacks validation. Coordination can extend cognition, but it can also distribute and amplify error. The quality of the whole system depends on boundaries and feedback between parts.

### 11.4 Defixation: interrupting the first plausible frame

People often become anchored to examples and familiar solution patterns. Jansson and Smith demonstrated design fixation experimentally ([Jansson & Smith, 1991](https://doi.org/10.1016/0142-694X(91)90003-F)); later experiments found that people incorporated example features even after delays and instructions not to copy ([Smith, Ward, & Schumacher, 1993](https://doi.org/10.3758/BF03202751)). A meta-analysis found a genuine trade-off: examples can improve novelty or quality while also narrowing category variety and increasing copying ([Sio, Kotovsky, & Cagan, 2015](https://doi.org/10.1016/j.destud.2015.04.004)).

Chess itself supplies a vivid fixation result. Expert players can remain visually attracted to features supporting a familiar but inferior solution even while consciously looking for a better one—the Einstellung effect ([Bilalić, McLeod, & Gobet, 2008](https://doi.org/10.1016/j.cognition.2008.05.005)). Eye-movement research adds an important boundary: experts disengage more readily when the familiar move is plainly bad than when it is merely suboptimal ([Sheridan & Reingold, 2013](https://doi.org/10.1371/journal.pone.0075796)).

WebChess’s shuffled lenses may redirect attention away from a first plausible frame. The benefit is not guaranteed. A chess metaphor or hexagram can become a new fixation. The remedy is comparative interpretation: ask for the proposed mapping, its failure point, a rival mapping, and discriminating evidence.

### 11.5 Divergence and convergence: generate, explore, evaluate

The Geneplore framework describes creativity as interaction between generative processes that create preinventive structures and exploratory processes that interpret and refine them ([Finke, Ward, & Smith, 1992](https://mitpress.mit.edu/9780262061506/creative-cognition/)). WebChess instantiates a comparable sequence:

- facet generation creates candidate structures;
- random pairing makes remote interpretations available;
- play selects encounters;
- final synthesis explores and evaluates those encounters;
- next actions test selected hypotheses.

Generation and evaluation should not be conflated. A meta-analysis found only a small positive association between divergent thinking and evaluative skill, suggesting they are related but distinct capacities ([Guo et al., 2022](https://doi.org/10.1002/jocb.539)). People also struggle to select their most creative ideas and may trade originality against feasibility or satisfaction ([Rietzschel, Nijstad, & Stroebe, 2010](https://doi.org/10.1348/000712609X414204)). Cropley argues that convergent evaluation against usefulness and reality is an integral part of creativity, not its enemy ([Cropley, 2006](https://doi.org/10.1207/s15326934crj1803_13)).

The final answer should therefore evaluate candidate directions on separate axes:

- originality;
- usefulness;
- feasibility;
- strength of evidence;
- reversibility;
- downside and affected parties;
- time to obtain informative feedback.

A graceful synthesis that collapses those axes into one confident recommendation is weaker than a calibrated comparison.

### 11.6 Analogy: transferring relations rather than labels

Gentner’s structure-mapping theory proposes that useful analogy transfers systems of relations rather than isolated surface attributes ([Gentner, 1983](https://doi.org/10.1207/s15516709cog0702_3)). “A Knight means surprise” is therefore a weak interpretation. A stronger interpretation describes a relational match: an indirect move changes which constraint can be approached; in the literal problem, a different stakeholder, time scale, distribution channel, or test could similarly reach around the current barrier.

Analogical transfer often fails unless the deep relation is noticed. In classic work, people frequently failed to apply an analogous solution without a hint ([Gick & Holyoak, 1980](https://doi.org/10.1016/0010-0285(80)90013-4)). Comparing multiple source analogues can support schema abstraction ([Gick & Holyoak, 1983](https://doi.org/10.1016/0010-0285(83)90002-6)), and analogical encoding has improved transfer in negotiation studies ([Loewenstein, Thompson, & Gentner, 1999](https://doi.org/10.3758/BF03212967)). Product-design studies find that distant or uncommon examples can increase novelty, but quality and transfer vary ([Dahl & Moreau, 2002](https://doi.org/10.1509/jmkr.39.1.47.18930); [Chan et al., 2011](https://doi.org/10.1115/1.4004396)).

The final model’s job is thus not to celebrate a symbol. It must articulate a relational mapping and return to the literal facet. If it cannot do so, the association should be discarded.

### 11.7 Productive opposition: evidence and intention as counterpositions

WebChess does not assign one side to “the answer.” It creates a standing counterpoint between conditions and commitment. Research on dissent and structured conflict suggests why this may help. A meta-analysis found that devil’s advocacy generally outperformed a simpler expert-only approach, although dialectical inquiry was not shown superior for relatively ill-structured tasks ([Schwenk, 1990](https://doi.org/10.1016/0749-5978(90)90051-A)). In experimental work, exposure to a minority position increased the diversity of strategies used to solve problems ([Nemeth & Kwan, 1987](https://doi.org/10.1111/j.1559-1816.1987.tb00339.x)).

The inference is modest. A game side is not a genuine dissenter with independent knowledge. Stylized opposition can be co-opted by confirmation bias, with both sides interpreted to support the preferred answer. Nickerson’s review shows how pervasive that tendency is ([Nickerson, 1998](https://doi.org/10.1037/1089-2680.2.2.175)).

A responsible synthesis should ask:

- What observation would weaken the currently favored intention?
- What value or purpose would make a seemingly negative fact acceptable?
- Which constraint is real, and which is merely inherited?
- What stakeholder could credibly disagree?
- What result would cause the recommendation to reverse?

### 11.8 Attention allocation: reducing 64 facets to a workable agenda

Human and organizational attention is limited. Ocasio’s attention-based view describes how rules, resources, relationships, and procedures channel decision makers toward some issues and answers rather than others ([Ocasio, 1997](https://sms.onlinelibrary.wiley.com/doi/10.1002/%28SICI%291097-0266%28199707%2918%3A1%2B%3C187%3A%3AAID-SMJ936%3E3.0.CO%3B2-K)). Captures create such a procedure. They turn a 64-facet field into a chronological inspection queue.

Selection is useful because equal attention to everything is impossible. It is dangerous because focus shields competing goals and can create tunnel vision ([Shah, Friedman, & Kruglanski, 2002](https://doi.org/10.1037/0022-3514.83.6.1261)). The present capture trail is therefore best considered a **sample**, not a ranking of all facets. A mandatory “what did the game miss?” step would reduce the risk.

### 11.9 Incubation and temporal distance

A complete game inserts time and activity between initial problem statement and final answer. Meta-analytic evidence finds an overall incubation benefit, particularly for divergent-thinking tasks, although effects depend on task, preparation, misleading cues, and the activity performed during the interval ([Sio & Ormerod, 2009](https://doi.org/10.1037/a0014212)). WebChess may create useful distance from the initial frame.

This is only an analogy to incubation. Guided chess is cognitively demanding and may continue to prime the same material; it is not equivalent to a low-demand break. A study should compare immediate AI synthesis, delayed synthesis without chess, and delayed synthesis with chess to isolate any incubation effect.

### 11.10 Metacognition and reflective revision

Metacognition involves knowledge and monitoring of one’s own cognition ([Flavell, 1979](https://doi.org/10.1037/0003-066X.34.10.906)). WebChess separates stages visibly, which may let users notice how a compressed question became facets, how selection occurred, and where interpretation entered.

Guided reflection improved diagnostic decisions in a medical-education meta-analysis, with methodological limitations and no basis for generalizing the result beyond diagnostic decision-making ([Prakash, Sladek, & Schuwirth, 2019](https://doi.org/10.1080/0142159X.2018.1497786)). In a smaller experiment, structured reflection helped residents reconsider availability-biased diagnoses ([Mamede et al., 2010](https://doi.org/10.1001/jama.2010.1276)). These results support explicit reconsideration, not the WebChess interface itself.

The final section “What could change the answer” is therefore central. It should identify uncertainty, missing evidence, and reversal conditions—not function as a disclaimer after a predetermined conclusion.

### 11.11 From idea to experiment

Creativity is commonly operationalized through originality and effectiveness or usefulness; innovation additionally requires implementation. WebChess closes with reversible actions because uncertain recommendations should become tests.

Sitkin’s “strategy of small losses” argues that bounded, intelligible failures can support learning ([Sitkin, 1992](https://scholars.duke.edu/publication/913886)). Thomke showed, in integrated-circuit design, that switching efficiently among experimentation modes could reduce development cost and time ([Thomke, 1998](https://doi.org/10.1287/mnsc.44.6.743)). Four randomized trials involving 759 firms found that scientific-method training changed entrepreneurial idea termination and pivot patterns, though effects were nuanced rather than uniformly positive ([Camuffo et al., 2024](https://doi.org/10.1002/smj.3580)).

A strong WebChess next move should therefore specify:

1. the assumption being tested;
2. the smallest ethical action that can test it;
3. the observation to record;
4. the threshold for support or rejection;
5. the deadline;
6. who could be harmed or excluded;
7. the rule for continue, revise, or stop.

The output becomes valuable through this feedback loop, not through symbolic coherence alone.

---

## 12. Intellectual lineage

The figures in this section offer useful design concepts. None evaluated or endorsed WebChess.

### 12.1 Richard Wilhelm: attention to movement in change

Wilhelm’s process-oriented phrasing—attention to “movements in change”—captures the reason WebChess uses a trajectory rather than a static label. A facet is encountered under pressure, from a direction, by a role, at a particular time. Meaning is sought in the transition.

The limitation is cultural and historical. Wilhelm was an influential interpreter and translator, not the origin or sole authority of the Yijing. Cary F. Baynes rendered his German translation into English, and later Anglophone reception was further shaped by C. G. Jung. WebChess should make this lineage visible and invite engagement with Chinese scholarship rather than treating one twentieth-century reception as universal.

### 12.2 Bobby Fischer: constrained variation

Fischer’s proposal for what became Chess960 altered initial positions while preserving the game’s basic grammar:

> “I want to keep the old chess game, but just make a change so the starting positions are mixed.”

The quotation comes from a 1999 interview in an independently compiled [transcript](https://richardbean.id.au/chess/bf.pdf), chapter 8 at timestamp 02:15. [FIDE’s Chess960 rules](https://rcc.fide.com/guidelinesii/) formalize constrained randomization: the back rank varies, but bishops occupy opposite colors, the King remains between the Rooks, and Black mirrors White.

WebChess applies a related design principle. Facet, lens, and location vary; legal movement and semantic roles remain stable. The citation is limited to chess-design history and is not an endorsement of Fischer’s other views or conduct. His design intuition is not scientific evidence that randomization improves creativity.

### 12.3 Alan Turing: random exploration under many acceptable solutions

Turing’s observation about a random element in problem search anticipates a basic exploration problem: a systematic order can spend too long in an unproductive region when many acceptable answers exist. WebChess uses randomization to sample associations that a linear outline might never reach.

Turing’s statement is a rationale, not a result from a controlled creativity experiment. Modern evidence indicates that relevance and evaluation matter more than randomness alone. WebChess therefore combines random casting with literal problem facets, stable roles, complete play, and a convergent model pass.

### 12.4 Yann LeCun: representation and generate–evaluate separation

LeCun’s position paper on autonomous machine intelligence separates world models, costs, actors, and hierarchical representations ([LeCun, 2022](https://openreview.net/forum?id=BZ5a1r-kVsf)). In a later conversation, he emphasizes planning through distinct candidate generation and evaluation:

> “You need a component to generate candidate branches and a second component to evaluate them…”

The [2026 Dædalus conversation](https://doi.org/10.1162/DAED.a.972) provides a useful comparison:

- WebChess’s first model call generates a representation;
- casting and play produce a candidate attention path;
- the final model evaluates and synthesizes that path.

The comparison also clarifies what WebChess lacks. It does not have a learned causal world model. It does not predict the next real state under a proposed intervention, learn from observed consequences, or optimize against a validated cost function. It is inspired by generate–evaluate organization, not an implementation of LeCun’s proposed architecture.

### 12.5 Chess expertise: recognition plus selective search

De Groot’s studies made chess a canonical environment for examining candidate generation, evaluation, and progressive deepening ([de Groot, 1978](https://doi.org/10.1515/9783110800647)). Chase and Simon’s work emphasized memory for meaningful configurations rather than isolated pieces ([Chase & Simon, 1973](https://doi.org/10.1016/0010-0285(73)90004-2)); later template theory described richer long-term retrieval structures ([Gobet & Simon, 1996a](https://doi.org/10.1006/cogp.1996.0011)). Replication and later analysis support a balanced view in which expertise combines learned recognition with faster selective search ([Connors, Burns, & Campitelli, 2011](https://doi.org/10.1111/j.1551-6709.2011.01196.x)).

This research does not establish generalized transfer from chess to open-ended reasoning. It suggests a long-term design hypothesis: if users learn stable piece roles through repeated, meaningful use, those roles might become efficient conceptual cues. First-time users cannot be assumed to possess such chunks. Moreover, random positions reduce much of the expert memory advantage seen in meaningful chess positions ([Gobet & Simon, 1996b](https://doi.org/10.3758/BF03212414)). Randomization disrupts habit, but it also destroys structure.

---

## 13. Integrated theory of operation

The most defensible causal chain is a sequence of hypotheses:

| Step | System operation | Proposed cognitive function | Necessary safeguard |
|---|---|---|---|
| 1 | Normalize the question | Establish a bounded object of analysis | Preserve the original wording |
| 2 | Generate 64 facets | Expand problem representation and expose omissions | Enforce distinctness; allow user correction |
| 3 | Pair facets with change lenses | Introduce remote but bounded associations | Label metaphor as non-evidence |
| 4 | Cast pairs onto the board | Externalize and spatialize the field | Preserve provenance and inspectability |
| 5 | Alternate polar moves | Force sequential encounter between evidence and intent | Do not equate chess quality with decision quality |
| 6 | Record captures | Build a finite attention sample | Call it salience, not importance or truth |
| 7 | Combine role metaphors | Ask stable questions about purpose, agency, structure, perspective, reframing, and practice | State where each analogy breaks |
| 8 | Synthesize with AI | Compare, articulate, and converge | Require uncertainty and reversal conditions |
| 9 | Produce reversible actions | Convert interpretation into learnable behavior | Define observation and stopping rules |
| 10 | Feed results back | Revise the problem and recommendation | Retain human ownership and real evidence |

Failure at any link breaks the stronger claim. If facets are generic, randomization combines noise. If capture selection is uninformative, synthesis starts from a biased sample. If the model treats metaphor as fact, the answer can become apophenic. If no action is tested, a creative narrative never becomes learning.

---

## 14. Evidence map

The following matrix summarizes the research basis without treating component evidence as system validation.

| WebChess feature | Closest evidence | What the evidence supports | What remains unproven |
|---|---|---|---|
| Active 64-facet construction | [Reiter-Palmon et al.](https://doi.org/10.1207/s15326934crj1001_2); [Dorst & Cross](https://doi.org/10.1016/S0142-694X(01)00009-6) | Problem framing affects creative work and can co-evolve with solutions | That 64 AI-generated facets are optimal or complete |
| Breaking a fused problem into parts | [Knoblich et al.](https://doi.org/10.1037/0278-7393.25.6.1534) | Insight can involve chunk decomposition and constraint relaxation | Transfer from laboratory puzzles to complex real problems |
| Visual board and history | [Larkin & Simon](https://doi.org/10.1111/j.1551-6708.1987.tb00863.x); [Zhang & Norman](https://doi.org/10.1207/s15516709cog1801_3) | External form can change inferential work | That this random polar layout helps rather than distracts |
| Animated movement | [Kirsh & Maglio](https://doi.org/10.1207/s15516709cog1804_1); [Scaife & Rogers](https://doi.org/10.1006/ijhc.1996.0048) | Action can aid cognition when it reveals task-relevant structure | That more motion improves thought |
| Random pairings | [Mednick](https://doi.org/10.1037/h0048850); [Fleming](https://doi.org/10.1287/mnsc.47.1.117.10671) | Remote and unfamiliar combinations can increase variation | That WebChess randomization improves usefulness |
| Random-prompt caution | [Malthouse et al.](https://doi.org/10.1016/j.cognition.2021.104937); [Toubia & Netzer](https://doi.org/10.1287/mksc.2016.0994) | Arbitrary cues can fail; optimized semantic prompts can outperform random ones | How much semantic distance is best in WebChess |
| Piece and hexagram analogies | [Gentner](https://doi.org/10.1207/s15516709cog0702_3); [Gick & Holyoak](https://doi.org/10.1016/0010-0285(83)90002-6) | Relational comparison can enable transfer | That a random lens contains a valid relation |
| Evidence–intent opposition | [Schwenk](https://doi.org/10.1016/0749-5978(90)90051-A); [Nemeth & Kwan](https://doi.org/10.1111/j.1559-1816.1987.tb00339.x) | Counterpositions can improve some forms of search and judgment | That stylized sides create genuine dissent |
| Capture-based focus | [Ocasio](https://sms.onlinelibrary.wiley.com/doi/10.1002/%28SICI%291097-0266%28199707%2918%3A1%2B%3C187%3A%3AAID-SMJ936%3E3.0.CO%3B2-K) | Procedures channel limited attention | That captures predict objective facet importance |
| Complete-game delay | [Sio & Ormerod](https://doi.org/10.1037/a0014212) | Incubation has an average positive effect under some conditions | That demanding guided play produces that effect |
| Reflective final pass | [Prakash et al.](https://doi.org/10.1080/0142159X.2018.1497786) | Guided reflection can improve decisions in a specific professional domain | General creativity and decision transfer |
| Generate–evaluate architecture | [Finke, Ward, & Smith](https://mitpress.mit.edu/9780262061506/creative-cognition/); [Guo et al.](https://doi.org/10.1002/jocb.539) | Generation and evaluation are distinct and jointly important | That the current two model calls perform either well |
| Serious-game format | [Plass, Homer, & Kinzer](https://doi.org/10.1080/00461520.2015.1122533); [Wouters et al.](https://doi.org/10.1037/a0031311) | Games can support learning under designed conditions; average effects are context-dependent | That WebChess improves motivation, learning, or transfer |
| Reversible next moves | [Thomke](https://doi.org/10.1287/mnsc.44.6.743); [Camuffo et al.](https://doi.org/10.1002/smj.3580) | Structured experimentation can improve learning and selection in studied domains | That users execute or learn from WebChess actions |

The matrix supports a program of research, not a marketing claim of established effectiveness.

---

## 15. Failure modes, risks, and mitigations

### 15.1 Apophenia and narrative overfitting

**Risk:** Humans and models can build compelling stories from random conjunctions. A coherent story may feel discovered because the cast was not chosen consciously.

**Evidence:** Reduced control can increase illusory pattern detection ([Whitson & Galinsky, 2008](https://doi.org/10.1126/science.1159845)).

**Mitigations:**

- label every hexagram assignment and board placement as randomized;
- say “suggests a question,” never “reveals” or “shows” a fact;
- require a rival interpretation and an analogy-break statement;
- require external evidence before elevating a theme;
- compare several seeds;
- let users reject a mapping without penalty.

### 15.2 Randomness without relevance

**Risk:** Remote cues consume attention, impair performance, or produce novelty without usefulness.

**Evidence:** Unrelated stimuli can fail or harm creative performance, while optimized semantic suggestions can outperform random cues ([Malthouse et al., 2022](https://doi.org/10.1016/j.cognition.2021.104937); [Toubia & Netzer, 2017](https://doi.org/10.1287/mksc.2016.0994)).

**Mitigations:**

- score interpretations for literal relevance after generation;
- compare random lenses with semantically selected and fixed lenses;
- discard associations that cannot produce a concrete relational mapping;
- preserve a small number of unusual combinations within a grounded majority.

### 15.3 False completeness

**Risk:** Exactly 64 polished facets can create the impression that the problem has been exhaustively analyzed.

**Mitigations:**

- call facets hypotheses;
- allow user edits, merges, and missing-facet additions;
- ask domain experts to rate coverage;
- show an explicit “unknown or absent” section;
- never display “100% analyzed” when only schema completion has occurred.

### 15.4 Semantic blindness of play

**Risk:** The guided engine chooses coherent chess moves without knowing whether destination facets matter in the real problem.

**Mitigations:**

- state this limitation in the interface;
- compare the current heuristic with random play, human play, and semantic move policies;
- separate chess-quality scores from facet-relevance scores;
- never rename the attention weight “importance” or “confidence.”

### 15.5 Omission of uncaptured facets

**Risk:** The final model currently sees captured facets rather than the complete 64-facet field. A critical safety, ethics, or evidence issue can be absent solely because no capture occurred on its cell.

**Mitigations:**

- send a compact all-facet manifest;
- require a safety and neglected-facet audit;
- reserve one final section for the strongest uncaptured counterpoint;
- measure whether captures predict independent importance ratings.

### 15.6 Metaphor anchoring and framing effects

**Risk:** Metaphors change which interventions feel natural. Across experiments, even brief metaphorical framing influenced proposed solutions and information search, often without participants recognizing the effect ([Thibodeau & Boroditsky, 2011](https://doi.org/10.1371/journal.pone.0016782)).

**Mitigations:**

- show alternative metaphors;
- ask users to restate the issue without symbols;
- preserve literal facet language beside every interpretation;
- test whether the answer changes when metaphors are removed.

### 15.7 Confirmation bias

**Risk:** The final model or user can interpret every capture in favor of a desired conclusion.

**Mitigations:**

- generate disconfirming evidence and rival hypotheses;
- identify a result that would reverse the answer;
- separate observed facts, assumptions, values, and predictions;
- invite an independent reviewer who did not see the preferred answer.

### 15.8 AI hallucination, fluency, and automation bias

**Risk:** A model can invent facts, causal links, or stakeholder views. Polished prose can make the answer seem more reliable than its basis. A healthcare-focused systematic review drawing on multiple research fields found commission and omission errors associated with over-reliance on decision aids ([Goddard, Roudsari, & Wyatt, 2012](https://doi.org/10.1136/amiajnl-2011-000089)). Hallucination remains a documented problem in natural-language generation ([Ji et al., 2023](https://doi.org/10.1145/3571730)).

**Mitigations:**

- require claim-level evidence tags;
- prohibit invented external facts when no retrieval source is present;
- distinguish model inference from user-supplied observation;
- display uncertainty and missing information;
- use representative evals, adversarial tests, and human review;
- in consequential settings, show supporting information rather than an unqualified recommendation.

### 15.9 Homogenization of ideas

**Risk:** Generative AI can improve an individual output while reducing diversity across a population of outputs. In story-writing experiments, access to generative AI increased some individual creativity ratings but reduced collective content diversity ([Doshi & Hauser, 2024](https://doi.org/10.1126/sciadv.adn5290)).

**Mitigations:**

- compare outputs across users and seeds;
- elicit the user’s own candidates before showing the model answer;
- measure semantic diversity, not only average quality;
- include non-AI and human-group conditions in evaluation.

### 15.10 Cultural reduction

**Risk:** A centuries-old Chinese textual and interpretive tradition can be reduced to 64 English labels used as aesthetic content.

**Mitigations:**

- use “I Ching-inspired” consistently;
- document translation and reception history;
- collaborate with scholars and practitioners from relevant traditions;
- avoid claims of authentic divination;
- support alternative translations and interpretive schools with provenance;
- distinguish WebChess’s invented 8 × 8 matrix and side semantics from traditional concepts.

### 15.11 Animation and cognitive load

**Risk:** Constant motion can obscure the logic, disadvantage users with vestibular or attention sensitivities, and create a theatrical impression of unseen “work.”

**Mitigations:**

- animate state transitions, and label streamed reasoning text by its provider-dependent source rather than animating an impression of thought;
- provide reduced-motion and no-motion modes;
- keep text and provenance visible after motion ends;
- never use indeterminate animation when the process has failed;
- test comprehension, not only aesthetic preference.

### 15.12 Privacy, security, and sensitive decisions

**Risk:** Problems may contain personal, strategic, health, legal, or confidential information. Prompt injection may be embedded in user text or retrieved web content. Search queries derived from the problem can disclose its sensitive subject. Credentials may be exposed if placed client-side.

**Mitigations:**

- keep API keys and local credentials server-side;
- bound and validate input and output;
- separate trusted instructions from user and game data;
- require signed sessions, same-origin/CSRF checks, rate limits, a global quota,
  bounded concurrency, timeouts, and disconnect cancellation;
- document retention accurately;
- use an OpenAI project budget in API mode because process-local controls reset
  and do not coordinate replicas;
- restrict ChatGPT/Codex mode to one owner on loopback, use its dedicated
  credential home and required Bubblewrap boundary, and monitor workspace
  allowance and credits;
- keep native Codex web search disabled by default, disclose the selected mode,
  and treat retrieved content as untrusted;
- minimize search-query disclosure and verify consequential web claims against
  primary sources;
- redact or avoid sensitive information;
- obtain appropriate organizational review;
- do not deploy as an autonomous high-stakes decision maker.

### 15.13 Version and model drift

**Risk:** Model behavior, API semantics, prompts, and heuristics change. A “WebChess result” without version provenance may not be reproducible.

**Mitigations:**

- record software version, model ID, prompt version, seed, and timestamp;
- preserve the 64 facets and capture trail;
- rerun regression evals after any model or prompt change;
- distinguish replay of a cast from a new cast.

---

## 16. Appropriate and inappropriate use

### 16.1 Appropriate uses

WebChess is most defensible for exploratory, low- or moderate-stakes questions where multiple satisfactory paths may exist and the user wants new perspectives, such as:

- early product or service concept exploration;
- strategy workshop preparation;
- creative project reframing;
- identification of stakeholder questions;
- design critique;
- personal reflection where the user retains agency;
- generating reversible experiments;
- surfacing assumptions before expert consultation.

### 16.2 Uses requiring strong safeguards

- organizational decisions affecting employment or access;
- public-policy exploration;
- research agenda selection;
- financial planning;
- educational guidance;
- interpersonal conflict.

In these settings, affected stakeholders, domain evidence, and accountable human review must be added. The game should not conceal power differences beneath a balanced-looking board.

### 16.3 Inappropriate uses

WebChess should not be used as:

- medical diagnosis or treatment direction;
- legal advice or rights determination;
- an investment, credit, insurance, or benefits decision engine;
- emergency, crisis, safety, or military command;
- a hiring, firing, sentencing, eligibility, or surveillance system;
- proof of another person’s motives;
- prophecy or a substitute for informed consent;
- a way to justify a decision already made.

---

## 17. A falsifiable validation program

The scientific question is not whether users enjoy the board or find the result meaningful. It is whether WebChess improves defined outcomes relative to credible alternatives, for whom, on which problems, through which components, and at what cost.

### 17.1 Primary research questions

1. Does the 64-facet pass improve problem coverage and distinctness over a single AI analysis?
2. Do random change lenses increase novelty without reducing usefulness or calibration?
3. Does chess-based selection outperform random facet selection or direct semantic ranking?
4. Do stable piece roles improve identification of purpose, agency, structure, assumptions, reframing, and practical tests?
5. Does the evidence–intent polarity increase consideration of counterevidence?
6. Does complete play improve reflection beyond an equivalent delay?
7. Are conclusions stable enough across seeds to support action?
8. Do proposed actions lead to better real-world learning or outcomes?

### 17.2 Experimental conditions

A preregistered factorial or staged trial should include at least:

1. **Unstructured reflection:** user thinks and writes without AI.
2. **Single-pass AI:** the same model answers the original problem directly.
3. **Facet-only AI:** 64-facet decomposition followed by synthesis, without I Ching or chess.
4. **Fixed-lens WebChess:** facets and lenses use a fixed, transparent mapping.
5. **Random-lens, no-chess:** random facet–lens pairs are semantically ranked without play.
6. **Chess, no-I-Ching:** chess selects literal facets with piece and side semantics only.
7. **Full WebChess:** current complete pipeline.
8. **Multi-seed WebChess:** several casts are compared before synthesis.

Useful additional ablations include random legal play versus the guided heuristic, human-selected moves versus autoplay, captured-facet-only versus all-facet audit, and animation versus a static event log.

### 17.3 Tasks and participants

The study should sample more than one problem class:

- open-ended product design;
- organizational strategy;
- personal planning;
- social or ethical trade-offs;
- problems with known hidden constraints;
- problems scored by later real-world outcomes.

Participants should include novices, domain experts, individuals, and groups. Expertise matters because chess notation, symbolic tolerance, domain knowledge, and familiarity with reflective tools may moderate effects. Accessibility and cultural interpretation should be measured rather than assumed.

### 17.4 Outcome measures

Creativity should be evaluated as both originality and effectiveness. The Consensual Assessment Technique provides a classic method for obtaining independent expert judgments without reducing creativity to one mechanical score ([Amabile, 1982](https://doi.org/10.1037/0022-3514.43.5.997)).

Pre-registered outcomes should include:

**Representation quality**

- facet distinctness;
- stakeholder and constraint coverage;
- causal depth versus surface paraphrase;
- missing critical factors;
- user-rated correction burden.

**Idea and answer quality**

- blind-rated originality;
- usefulness;
- feasibility;
- ethical acceptability;
- specificity;
- actionability;
- factual accuracy.

**Reasoning quality**

- number and quality of rival hypotheses;
- disconfirming evidence requested;
- separation of facts, values, and assumptions;
- calibration and appropriate uncertainty;
- quality of reversal conditions.

**Diversity and robustness**

- semantic diversity within and across users;
- seed-to-seed agreement;
- contradiction rate;
- proportion of final claims traceable to facets;
- capture coverage of later expert-rated important facets.

**Behavior and outcomes**

- whether users execute a next move;
- quality of the experiment designed;
- information gained;
- decision revision;
- delayed expert or stakeholder assessment;
- real-world outcome where measurable.

**Costs and harms**

- time;
- cognitive load;
- frustration;
- false confidence;
- inappropriate disclosure;
- motion discomfort;
- negative consequences of acted-on advice.

### 17.5 Analysis and bias control

- Pre-register hypotheses, exclusions, primary outcomes, and analysis.
- Randomize participants and problem order.
- Blind outcome raters to experimental condition.
- Use several independent domain raters and report reliability.
- Preserve all prompts, outputs, seeds, versions, and user edits.
- Model repeated measures and problem-level variance.
- Correct for multiple comparisons.
- Report null and negative results.
- Analyze whether benefits are concentrated in particular users or tasks.
- Include qualitative error analysis rather than averaging away severe failures.

OpenAI’s [evaluation guidance](https://developers.openai.com/api/docs/guides/evals) recommends representative test data and explicit testing criteria. Product-level evals should run continuously, but they do not replace independent human-subject research.

### 17.6 Example hypotheses and falsification criteria

**H1: Decomposition quality.** Facet-only and WebChess conditions will produce greater expert-rated problem coverage than single-pass AI.  
**Falsified if:** coverage does not improve, or critical-error rate increases enough to offset breadth.

**H2: Creative variation.** Random lenses will increase originality relative to fixed lenses.  
**Falsified if:** originality does not rise, or usefulness, feasibility, or calibration falls beyond a preregistered margin.

**H3: Capture validity.** Captured facets will receive higher later importance ratings than uncaptured facets.  
**Falsified if:** captures perform no better than random selection.

**H4: Polarity effect.** Evidence–intent framing will increase explicit treatment of counterevidence and value commitments.  
**Falsified if:** those elements do not increase or if confirmation bias worsens.

**H5: Chess contribution.** Full WebChess will outperform facet-only AI on blind-rated answer quality.  
**Falsified if:** the difference is absent, negative, or explained entirely by increased time-on-task.

**H6: Seed robustness.** Core recommendations will remain directionally stable across several casts.  
**Falsified if:** recommendations commonly reverse without new external evidence.

**H7: Action learning.** WebChess users will design more informative, lower-risk tests and revise more appropriately after feedback.  
**Falsified if:** actions are no more informative than controls or cause greater avoidable harm.

Falsification is not a threat to the project. It is how the project learns which layers contribute value and which are theater.

---

## 18. Development roadmap

### 18.1 Near-term epistemic safeguards

1. **All-facet audit.** Send a compact manifest of all 64 facets to the final synthesis and require one uncaptured counterpoint.
2. **Evidence tagging.** Let users mark each facet statement as observed, sourced, assumed, valued, predicted, or unknown.
3. **Analogy discipline.** Require mapping, break point, rival interpretation, and discriminating evidence.
4. **Seed comparison.** Offer three casts and distinguish recurring from seed-dependent themes.
5. **Provenance.** Save model ID, prompt version, software version, seed, facets, moves, and user edits.
6. **Accessible motion.** Add reduced-motion, pause, replay, and persistent text alternatives.
7. **Full-game proof.** Record the full move history and reconstruct submitted game legality rather than validating only capture and ending invariants.
8. **Shared operational controls.** Move revocations, rate limits, quotas, and concurrency accounting to shared storage before running multiple API replicas.

### 18.2 Better move policies

The phrase “better move” should be decomposed into distinct objectives:

- **chess coherence:** safety, material, progress, pressure, completion;
- **semantic relevance:** relationship of a destination facet to the current conflict;
- **coverage:** avoidance of repeatedly selecting the same analytic region;
- **information value:** likelihood that examining a facet will reduce uncertainty;
- **risk sensitivity:** priority for neglected safety, ethics, and evidence questions.

Future experiments could compare:

- the current semantically blind heuristic;
- random legal moves;
- human-selected moves;
- a semantic policy using facet embeddings;
- a coverage-maximizing policy;
- a value-of-information policy.

A semantic engine might improve relevance but reduce defixation by returning to obvious facets. The best policy may deliberately mix grounded and remote moves rather than maximizing one score.

### 18.3 Stronger AI synthesis

- Retrieve reliable sources for external factual claims.
- Require claim-to-facet and claim-to-evidence traceability.
- Generate two materially different answers before selection.
- Score candidates separately for novelty, usefulness, feasibility, evidence, reversibility, and harm.
- Include a “why this analogy may be wrong” section.
- Refuse or redirect inappropriate high-stakes uses.
- Use outcome feedback to evaluate, not secretly personalize, future recommendations.

### 18.4 Human and group modes

- Allow users to revise facets before casting.
- Let participants annotate why a capture matters.
- Support a facilitator mode where stakeholders separately play evidence and intent.
- Preserve minority interpretations instead of forcing premature consensus.
- Compare individual, nominal-group, and collaborative play.
- Make power, affected parties, and absent voices explicit.

### 18.5 Cultural and scholarly development

- Invite Yijing scholars and Chinese-language experts to review names, themes, and framing.
- Offer multiple documented translations rather than a single flattened vocabulary.
- Clearly label WebChess inventions.
- Study whether symbolic interpretations differ across cultures and whether those differences create value or harm.

### 18.6 Research infrastructure

- Build a versioned benchmark of diverse, consented problems.
- Add structured graders for facet uniqueness and coverage.
- Maintain human expert panels for usefulness and harm.
- Run prompt-injection and adversarial-input suites.
- Track latency, cost, failure rates, retries, and model drift.
- Publish protocols and negative results.

---

## 19. Worked example

Consider the question:

> “Should our small manufacturing company launch a subscription maintenance service for existing customers?”

The actual first model pass would produce 64 facets. A small illustrative subset might include:

- **Purpose × Clarify:** distinguish recurring customer value from recurring revenue desired by the company.
- **People × Receive:** interview maintenance technicians about failure patterns and workload.
- **Resources × Challenge:** test the assumption that current staffing can absorb preventive visits.
- **Timing × Begin:** identify the smallest customer cohort ready for a pilot.
- **Risks × Connect:** map how response-time promises affect spare-parts inventory.
- **Values × Consolidate:** define service promises that protect trust.
- **Evidence × Challenge:** separate observed downtime from sales anecdotes.
- **Possibilities × Adapt:** compare subscription, prepaid hours, and condition-monitoring alternatives.

Suppose “separate observed downtime from sales anecdotes” is independently paired with Hexagram 20, **Contemplation**, whose short lens emphasizes observing the whole before acting. It is then cast onto ring 4, sector 2.

Later, a White Bishop captures a Black Queen on that cell:

- **White / outside-in evidence** applies pressure.
- **Bishop / Perspective** is the active mode.
- **Black / inside-out intent** is challenged.
- **Queen / Agency**—options, influence, and resources—is under review.
- The literal issue is the quality of downtime evidence.
- The change lens asks for fuller observation before commitment.

A responsible interpretation is not “Hexagram 20 says do not launch.” It is:

> External evidence, viewed through a changed assumption, is challenging the company’s confidence that it has the agency to deliver the service. Before choosing a pricing model, measure actual downtime, causes, customer willingness to pay, technician capacity, and parts availability.

The analogy breaks if the company already has high-quality service records; “contemplation” could then become an excuse for delay. A rival interpretation is that existing evidence is adequate and the real constraint is sales execution. A discriminating next move could be a four-week pilot with five customers, predefined service limits, recorded labor and parts consumption, and an explicit go/no-go threshold.

This example shows the full discipline:

1. the facet supplies literal substance;
2. the random lens offers a possible transformation;
3. the capture specifies direction and roles;
4. interpretation produces a testable hypothesis;
5. reality, not the board, decides what survives.

---

## 20. Conclusion

WebChess is an ambitious synthesis of problem analysis, constrained randomness, chess, I Ching-inspired change metaphors, visualization, and reasoning models. Its strongest contribution is not a claim that any one tradition solves problems automatically. It is the architecture of a prolonged encounter with a question:

- expand before answering;
- make the representation visible;
- disturb habitual associations;
- place intention in contact with evidence;
- let stable roles ask different kinds of questions;
- record why some facets became salient;
- converge on reversible actions;
- return to reality for correction.

The method can plausibly support creativity because it combines divergent generation with convergent evaluation, remote association with literal grounding, and symbolic play with practical tests. It can plausibly support innovation only when users carry those tests into implementation and learn from outcomes.

The same architecture can mislead. Randomness can produce noise. Metaphor can create bias. Animation can simulate depth. A chess engine can produce good chess and poor reasoning. A model can convert arbitrary signals into confident prose. These are not peripheral concerns; they define the scientific and ethical work ahead.

The proper claim is therefore neither mystical nor dismissive:

> WebChess is a testable cognitive instrument for generating and interrogating perspectives. Its board is a hypothesis machine, not an oracle; its captures allocate attention, not truth; and its answer begins, rather than ends, responsible inquiry.

---

## Appendix A. Current implementation specification

| Component | Current setting |
|---|---|
| Model provider | <code>openai-api</code> by default; optional <code>ollama</code> and <code>codex-chatgpt</code> for single-owner loopback use |
| Problem length | 12–240 normalized characters |
| Division model | <code>gpt-5.6-sol</code> by default; server-configurable |
| Division reasoning | Medium effort |
| Division output bound | API mode: 20,000 output tokens; local Codex: schema/parser, 2 MiB standard-output cap, and 120-second timeout |
| Division output | Exactly 64 schema-valid facets plus bounded template/overlap checks; semantic distinctness, relevance, and correctness are not proven |
| Analytic grid | 8 dimensions × 8 movements |
| Random seed | 16 cryptographically random bytes, encoded as 32 hexadecimal characters |
| Permutations | Facets, hexagrams, then paired board placement |
| Board | 8 bounded rings × 8 wrapping sectors |
| Black direction | Inner rings outward; inside-out intent |
| White direction | Outer rings inward; outside-in evidence |
| First turn | White |
| Play modes | Manual moves, one guided turn, or autoplay; autoplay initially off |
| Special rules | Direct King capture; initial clear two-ring pawn advance; pawn promotion; no check, castling, or en passant |
| Move policy | Deterministic scored guided move; equal scores use a problem-and-turn-derived hash |
| Attention weight | Captured role, active role, and middle-ring meeting bonus |
| Local leading signals | Up to 3 facet groups, with modest recurrence lift |
| Ending | King capture, mutual immobility, 100 quiet plies, or 256 total plies; a one-sided immobility causes a counted pass |
| Final evidence | Original question, outcome, turn/conflict totals, polarities, grouped captured facets with recurrence counts and peak weights, and the capture trail; no non-capture move log or uncaptured-facet manifest |
| Final model | <code>gpt-5.6-sol</code> by default; server-configurable |
| Final reasoning | API mode: Pro mode with medium effort; local Codex: medium effort mapping only |
| Final output bound | API mode: 12,000 output tokens; local Codex: schema/parser, 2 MiB standard-output cap, and 120-second timeout |
| Final answer request | Strict five-section Structured Output, exactly three actions, two-to-three-sentence opening, and 450–750 rendered words |
| Codex web search | Native Responses <code>web_search</code>; <code>disabled</code> by default, optionally <code>cached</code>, <code>indexed</code>, or <code>live</code>; shell, browser, and standalone search remain disabled |
| Reasoning display | API mode streams labelled reasoning summaries; <code>ollama</code> streams labelled raw thinking; local Codex streams none; draft output text is never streamed |
| Rationale notes | <code>ollama</code> only: one preliminary run per stage returning six bounded <code>NOTE:</code> lines of display copy; failures are swallowed |
| Runs per new game | Two in API and local Codex modes; four in <code>ollama</code> mode |
| Provider data controls | API mode sends both calls with <code>store: false</code>; local Codex mode uses signed-in ChatGPT workspace controls; <code>ollama</code> keeps all traffic on the local machine |
| Paid-route access | Signed HttpOnly session, same-origin and CSRF checks |
| Spend controls | Per-session rate limit and process-global daily quota; concurrency four in API mode and one in local Codex mode; process-local only |

## Appendix B. Glossary

**Attention weight / resonance:** A hand-designed relative display score for a capture. It is not evidence, probability, importance, or confidence.

**Capture:** A chess event that selects the destination cell’s facet–hexagram pair for closer inspection.

**Cast:** One complete seeded assignment of facets, hexagrams, and board cells.

**Facet:** One problem-specific item whose returned ID maps to an exact requested dimension × movement slot; the text is intended, but not mechanically proven, to satisfy that slot.

**I Ching-inspired lens:** A short reflective theme named after one of the 64 hexagrams; metaphorical and non-predictive.

**Inside-out intent:** Black’s direction: purpose, values, commitments, and desired direction moving outward to meet reality.

**Outside-in evidence:** White’s direction: facts, conditions, constraints, and feedback moving inward to test intention.

**Polarity:** A complementary directional tension. It is not a moral hierarchy.

**Problem representation:** The set and organization of concepts through which a problem is examined.

**Salience:** Priority for attention. Salience can arise from a procedure without implying truth.

**Seed sensitivity:** The degree to which conclusions change when randomized assignments change.

**Structured Outputs:** Model output constrained to conform to a supplied JSON Schema. Schema compliance does not guarantee semantic correctness.

---

## References and further reading

The list includes sources cited directly in the paper and additional primary or scholarly background used to delimit its claims.

1. Adler, J. A. (2022). *The Yijing: A Guide*. Oxford University Press. [Oxford Academic](https://academic.oup.com/book/41418)
2. Amabile, T. M. (1982). Social psychology of creativity: A consensual assessment technique. *Journal of Personality and Social Psychology, 43*(5), 997–1013. [DOI](https://doi.org/10.1037/0022-3514.43.5.997)
3. Amabile, T. M., & Pratt, M. G. (2016). The dynamic componential model of creativity and innovation in organizations. *Research in Organizational Behavior, 36*, 157–183. [DOI](https://doi.org/10.1016/j.riob.2016.10.001)
4. Anderson, N., Potočnik, K., & Zhou, J. (2014). Innovation and creativity in organizations: A state-of-the-science review. *Journal of Management, 40*(5), 1297–1333. [DOI](https://doi.org/10.1177/0149206314527128)
5. Bilalić, M., McLeod, P., & Gobet, F. (2008). Why good thoughts block better ones: The mechanism of the pernicious Einstellung effect. *Cognition, 108*(3), 652–661. [DOI](https://doi.org/10.1016/j.cognition.2008.05.005)
6. Campbell, D. T. (1960). Blind variation and selective retention in creative thought. *Psychological Review, 67*(6), 380–400. [DOI](https://doi.org/10.1037/h0040373)
7. Camuffo, A., et al. (2024). A scientific approach to entrepreneurial decision-making: Large-scale replication and extension. *Strategic Management Journal, 45*(6), 1209–1237. [DOI](https://doi.org/10.1002/smj.3580)
8. Chan, J., Fu, K., Schunn, C., Cagan, J., Wood, K., & Kotovsky, K. (2011). On the benefits and pitfalls of analogies for innovative design. *Journal of Mechanical Design, 133*(8). [DOI](https://doi.org/10.1115/1.4004396)
9. Chase, W. G., & Simon, H. A. (1973). Perception in chess. *Cognitive Psychology, 4*(1), 55–81. [DOI](https://doi.org/10.1016/0010-0285(73)90004-2)
10. Chi, M. T. H., Feltovich, P. J., & Glaser, R. (1981). Categorization and representation of physics problems by experts and novices. *Cognitive Science, 5*(2), 121–152. [DOI](https://doi.org/10.1207/s15516709cog0502_2)
11. Connors, M. H., Burns, B. D., & Campitelli, G. (2011). Expertise in complex decision making: The role of search in chess 70 years after de Groot. *Cognitive Science, 35*(8), 1567–1579. [DOI](https://doi.org/10.1111/j.1551-6709.2011.01196.x)
12. Cropley, A. (2006). In praise of convergent thinking. *Creativity Research Journal, 18*(3), 391–404. [DOI](https://doi.org/10.1207/s15326934crj1803_13)
13. Dahl, D. W., & Moreau, C. P. (2002). The influence and value of analogical thinking during new product ideation. *Journal of Marketing Research, 39*(1), 47–60. [DOI](https://doi.org/10.1509/jmkr.39.1.47.18930)
14. de Groot, A. D. (1978). *Thought and Choice in Chess* (2nd ed.). De Gruyter Mouton. [DOI](https://doi.org/10.1515/9783110800647)
15. Dorst, K., & Cross, N. (2001). Creativity in the design process: Co-evolution of problem–solution. *Design Studies, 22*(5), 425–437. [DOI](https://doi.org/10.1016/S0142-694X(01)00009-6)
16. Doshi, A. R., & Hauser, O. P. (2024). Generative AI enhances individual creativity but reduces the collective diversity of novel content. *Science Advances, 10*(28). [DOI](https://doi.org/10.1126/sciadv.adn5290)
17. FIDE Rules Commission. (n.d.). Chess960 rules. Retrieved July 19, 2026. [Official rules](https://rcc.fide.com/guidelinesii/)
18. Finke, R. A., Ward, T. B., & Smith, S. M. (1992). *Creative Cognition: Theory, Research, and Applications*. MIT Press. [Publisher page](https://mitpress.mit.edu/9780262061506/creative-cognition/)
19. Fischer, B. (1999, June 27). Interview with Jun Velasco and Eugene Torre [Radio interview; independently compiled transcript]. In R. Bean (comp.), *Interviews with Bobby Fischer, 1999–2006*, ch. 8. [Transcript](https://richardbean.id.au/chess/bf.pdf)
20. Flavell, J. H. (1979). Metacognition and cognitive monitoring: A new area of cognitive-developmental inquiry. *American Psychologist, 34*(10), 906–911. [DOI](https://doi.org/10.1037/0003-066X.34.10.906)
21. Fleming, L. (2001). Recombinant uncertainty in technological search. *Management Science, 47*(1), 117–132. [DOI](https://doi.org/10.1287/mnsc.47.1.117.10671)
22. Gentner, D. (1983). Structure-mapping: A theoretical framework for analogy. *Cognitive Science, 7*(2), 155–170. [DOI](https://doi.org/10.1207/s15516709cog0702_3)
23. Gick, M. L., & Holyoak, K. J. (1980). Analogical problem solving. *Cognitive Psychology, 12*(3), 306–355. [DOI](https://doi.org/10.1016/0010-0285(80)90013-4)
24. Gick, M. L., & Holyoak, K. J. (1983). Schema induction and analogical transfer. *Cognitive Psychology, 15*(1), 1–38. [DOI](https://doi.org/10.1016/0010-0285(83)90002-6)
25. Gigerenzer, G., & Goldstein, D. G. (1996). Reasoning the fast and frugal way: Models of bounded rationality. *Psychological Review, 103*(4), 650–669. [DOI](https://doi.org/10.1037/0033-295X.103.4.650)
26. Gobet, F., & Simon, H. A. (1996a). Templates in chess memory: A mechanism for recalling several boards. *Cognitive Psychology, 31*(1), 1–40. [DOI](https://doi.org/10.1006/cogp.1996.0011)
27. Gobet, F., & Simon, H. A. (1996b). Recall of rapidly presented random chess positions is a function of skill. *Psychonomic Bulletin & Review, 3*(2), 159–163. [DOI](https://doi.org/10.3758/BF03212414)
28. Goddard, K., Roudsari, A., & Wyatt, J. C. (2012). Automation bias: A systematic review of frequency, effect mediators, and mitigators. *Journal of the American Medical Informatics Association, 19*(1), 121–127. [DOI](https://doi.org/10.1136/amiajnl-2011-000089)
29. Guo, Y., et al. (2022). Divergent thinking and evaluative skill: A meta-analysis. *Journal of Creative Behavior, 56*, 432–448. [DOI](https://doi.org/10.1002/jocb.539)
30. Hall, D. L., & Ames, R. T. (1998). Correlative thinking in Chinese philosophy. *Routledge Encyclopedia of Philosophy*. [DOI](https://doi.org/10.4324/9780415249126-G001-1)
31. Hon, Tze-Ki. (2024). Chinese philosophy of change (Yijing). In E. N. Zalta & U. Nodelman (Eds.), *The Stanford Encyclopedia of Philosophy* (Summer 2024 ed.). [Archived entry](https://plato.stanford.edu/archives/sum2024/entries/chinese-change/)
32. Hon, T. K. (2026). Modern man in search of a soul: The Wilhelm–Jung–Baynes partnership of the I Ching. *Cowrie: Comparative and World Literature*. [DOI](https://doi.org/10.1515/cwl-2025-2013)
33. Hutchins, E. (1995). *Cognition in the Wild*. MIT Press. [Publisher page](https://mitpress.mit.edu/9780262581462/cognition-in-the-wild/)
34. Jansson, D. G., & Smith, S. M. (1991). Design fixation. *Design Studies, 12*(1), 3–11. [DOI](https://doi.org/10.1016/0142-694X(91)90003-F)
35. Ji, Z., et al. (2023). Survey of hallucination in natural language generation. *ACM Computing Surveys, 55*(12). [DOI](https://doi.org/10.1145/3571730)
36. Kaplan, C. A., & Simon, H. A. (1990). In search of insight. *Cognitive Psychology, 22*(3), 374–419. [DOI](https://doi.org/10.1016/0010-0285(90)90008-R)
37. Kirsh, D. (2010). Thinking with external representations. *AI & Society, 25*, 441–454. [DOI](https://doi.org/10.1007/s00146-010-0272-8)
38. Kirsh, D., & Maglio, P. (1994). On distinguishing epistemic from pragmatic action. *Cognitive Science, 18*(4), 513–549. [DOI](https://doi.org/10.1207/s15516709cog1804_1)
39. Knoblich, G., Ohlsson, S., Haider, H., & Rhenius, D. (1999). Constraint relaxation and chunk decomposition in insight problem solving. *Journal of Experimental Psychology: Learning, Memory, and Cognition, 25*(6), 1534–1555. [DOI](https://doi.org/10.1037/0278-7393.25.6.1534)
40. Knuth, D. E., & Moore, R. W. (1975). An analysis of alpha-beta pruning. *Artificial Intelligence, 6*(4), 293–326. [DOI](https://doi.org/10.1016/0004-3702(75)90019-3)
41. Larkin, J. H., & Simon, H. A. (1987). Why a diagram is (sometimes) worth ten thousand words. *Cognitive Science, 11*(1), 65–100. [DOI](https://doi.org/10.1111/j.1551-6708.1987.tb00863.x)
42. LeCun, Y. (2022). A path towards autonomous machine intelligence. *OpenReview*. [Source](https://openreview.net/forum?id=BZ5a1r-kVsf)
43. LeCun, Y., & Manyika, J. M. (2026). Learning abstractions: A conversation with Yann LeCun. *Dædalus, 155*(1–2), 45–60. [DOI](https://doi.org/10.1162/DAED.a.972)
44. Loewenstein, J., Thompson, L., & Gentner, D. (1999). Analogical encoding facilitates knowledge transfer in negotiation. *Psychonomic Bulletin & Review, 6*(4), 586–597. [DOI](https://doi.org/10.3758/BF03212967)
45. Malthouse, E., Liang, Y., Russell, S., & Hills, T. T. (2022). The influence of exposure to randomness on lateral thinking in divergent, convergent, and creative search. *Cognition, 218*, 104937. [DOI](https://doi.org/10.1016/j.cognition.2021.104937)
46. Mamede, S., et al. (2010). Effect of availability bias and reflective reasoning on diagnostic accuracy among internal medicine residents. *JAMA, 304*(11), 1198–1203. [DOI](https://doi.org/10.1001/jama.2010.1276)
47. Mednick, S. A. (1962). The associative basis of the creative process. *Psychological Review, 69*(3), 220–232. [DOI](https://doi.org/10.1037/h0048850)
48. Nemeth, C. J., & Kwan, J. L. (1987). Minority influence, divergent thinking and detection of correct solutions. *Journal of Applied Social Psychology, 17*(9), 788–799. [DOI](https://doi.org/10.1111/j.1559-1816.1987.tb00339.x)
49. Newell, A., Shaw, J. C., & Simon, H. A. (1958). Elements of a theory of human problem solving. *Psychological Review, 65*(3), 151–166. [DOI](https://doi.org/10.1037/h0048495)
50. Newell, A., & Simon, H. A. (1976). Computer science as empirical inquiry: Symbols and search. *Communications of the ACM, 19*(3), 113–126. [DOI](https://doi.org/10.1145/360018.360022)
51. Nickerson, R. S. (1998). Confirmation bias: A ubiquitous phenomenon in many guises. *Review of General Psychology, 2*(2), 175–220. [DOI](https://doi.org/10.1037/1089-2680.2.2.175)
52. Ocasio, W. (1997). Towards an attention-based view of the firm. *Strategic Management Journal, 18*(S1), 187–206. [Publisher page](https://sms.onlinelibrary.wiley.com/doi/10.1002/%28SICI%291097-0266%28199707%2918%3A1%2B%3C187%3A%3AAID-SMJ936%3E3.0.CO%3B2-K)
53. OECD/Eurostat. (2018). *Oslo Manual 2018: Guidelines for Collecting, Reporting and Using Data on Innovation* (4th ed.). OECD Publishing. [DOI](https://doi.org/10.1787/9789264304604-en)
54. OpenAI. (n.d.). GPT-5.6 Sol model documentation. Retrieved July 19, 2026. [Documentation](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
55. OpenAI. (n.d.). Reasoning models guide. Retrieved July 19, 2026. [Documentation](https://developers.openai.com/api/docs/guides/reasoning)
56. OpenAI. (n.d.). Structured Outputs guide. Retrieved July 19, 2026. [Documentation](https://developers.openai.com/api/docs/guides/structured-outputs)
57. OpenAI. (n.d.). Your data: API data controls. Retrieved July 19, 2026. [Documentation](https://developers.openai.com/api/docs/guides/your-data)
58. OpenAI. (n.d.). Evals guide. Retrieved July 19, 2026. [Documentation](https://developers.openai.com/api/docs/guides/evals)
59. Plass, J. L., Homer, B. D., & Kinzer, C. K. (2015). Foundations of game-based learning. *Educational Psychologist, 50*(4), 258–283. [DOI](https://doi.org/10.1080/00461520.2015.1122533)
60. Prakash, S., Sladek, R. M., & Schuwirth, L. (2019). Interventions to improve diagnostic decision making: A systematic review and meta-analysis on reflective strategies. *Medical Teacher, 41*(5), 517–524. [DOI](https://doi.org/10.1080/0142159X.2018.1497786)
61. Reiter-Palmon, R., Mumford, M. D., O’Connor Boes, J., & Runco, M. A. (1997). Problem construction and creativity: The role of ability, cue consistency, and active processing. *Creativity Research Journal, 10*(1), 9–23. [DOI](https://doi.org/10.1207/s15326934crj1001_2)
62. Rietzschel, E. F., Nijstad, B. A., & Stroebe, W. (2010). The selection of creative ideas after individual idea generation. *British Journal of Psychology, 101*, 47–68. [DOI](https://doi.org/10.1348/000712609X414204)
63. Risko, E. F., & Gilbert, S. J. (2016). Cognitive offloading. *Trends in Cognitive Sciences, 20*(9), 676–688. [DOI](https://doi.org/10.1016/j.tics.2016.07.002)
64. Runco, M. A., & Jaeger, G. J. (2012). The standard definition of creativity. *Creativity Research Journal, 24*(1), 92–96. [DOI](https://doi.org/10.1080/10400419.2012.650092)
65. Scaife, M., & Rogers, Y. (1996). External cognition: How do graphical representations work? *International Journal of Human–Computer Studies, 45*(2), 185–213. [DOI](https://doi.org/10.1006/ijhc.1996.0048)
66. Schwenk, C. R. (1990). Effects of devil’s advocacy and dialectical inquiry on decision making: A meta-analysis. *Organizational Behavior and Human Decision Processes, 47*(1), 161–176. [DOI](https://doi.org/10.1016/0749-5978(90)90051-A)
67. Shah, J. Y., Friedman, R., & Kruglanski, A. W. (2002). Forgetting all else: On the antecedents and consequences of goal shielding. *Journal of Personality and Social Psychology, 83*(6), 1261–1280. [DOI](https://doi.org/10.1037/0022-3514.83.6.1261)
68. Shannon, C. E. (1950). Programming a computer for playing chess. *Philosophical Magazine, 41*(314), 256–275. [DOI](https://doi.org/10.1080/14786445008521796)
69. Sheridan, H., & Reingold, E. M. (2013). The mechanisms and boundary conditions of the Einstellung effect in chess. *PLOS ONE, 8*(10), e75796. [DOI](https://doi.org/10.1371/journal.pone.0075796)
70. Silver, D., et al. (2018). A general reinforcement learning algorithm that masters chess, shogi, and Go through self-play. *Science, 362*(6419), 1140–1144. [DOI](https://doi.org/10.1126/science.aar6404)
71. Simon, H. A. (1955). A behavioral model of rational choice. *Quarterly Journal of Economics, 69*(1), 99–118. [DOI](https://doi.org/10.2307/1884852)
72. Simon, H. A. (1956). Rational choice and the structure of the environment. *Psychological Review, 63*(2), 129–138. [DOI](https://doi.org/10.1037/h0042769)
73. Simonton, D. K. (2010). Creative thought as blind-variation and selective-retention: Combinatorial models of exceptional creativity. *Physics of Life Reviews, 7*(2), 156–179. [DOI](https://doi.org/10.1016/j.plrev.2010.02.002)
74. Sio, U. N., Kotovsky, K., & Cagan, J. (2015). Fixation or inspiration? A meta-analytic review of examples in design processes. *Design Studies, 39*, 70–99. [DOI](https://doi.org/10.1016/j.destud.2015.04.004)
75. Sio, U. N., & Ormerod, T. C. (2009). Does incubation enhance problem solving? A meta-analytic review. *Psychological Bulletin, 135*(1), 94–120. [DOI](https://doi.org/10.1037/a0014212)
76. Sitkin, S. B. (1992). Learning through failure: The strategy of small losses. *Research in Organizational Behavior, 14*, 231–266. [Duke record](https://scholars.duke.edu/publication/913886)
77. Smith, S. M., Ward, T. B., & Schumacher, J. S. (1993). Constraining effects of examples in a creative generation task. *Memory & Cognition, 21*(6), 837–845. [DOI](https://doi.org/10.3758/BF03202751)
78. Thibodeau, P. H., & Boroditsky, L. (2011). Metaphors we think with: The role of metaphor in reasoning. *PLOS ONE, 6*(2), e16782. [DOI](https://doi.org/10.1371/journal.pone.0016782)
79. Thomke, S. H. (1998). Managing experimentation in the design of new products. *Management Science, 44*(6), 743–762. [DOI](https://doi.org/10.1287/mnsc.44.6.743)
80. Toubia, O., & Netzer, O. (2017). Idea generation, creativity, and prototypicality. *Marketing Science, 36*(1), 1–20. [DOI](https://doi.org/10.1287/mksc.2016.0994)
81. Turing, A. M. (1950). Computing machinery and intelligence. *Mind, LIX*(236), 433–460. [DOI](https://doi.org/10.1093/mind/LIX.236.433)
82. Uzzi, B., Mukherjee, S., Stringer, M., & Jones, B. (2013). Atypical combinations and scientific impact. *Science, 342*(6157), 468–472. [DOI](https://doi.org/10.1126/science.1240474)
83. von Neumann, J. (1928). Zur Theorie der Gesellschaftsspiele. *Mathematische Annalen, 100*, 295–320. [DOI](https://doi.org/10.1007/BF01448847)
84. Whitson, J. A., & Galinsky, A. D. (2008). Lacking control increases illusory pattern perception. *Science, 322*(5898), 115–117. [DOI](https://doi.org/10.1126/science.1159845)
85. Wilhelm, R. (Trans.), & Baynes, C. F. (English trans.). (1967). *The I Ching or Book of Changes* (3rd ed.). Princeton University Press. [Berkeley Law Library record](https://lawcat.berkeley.edu/record/541043)
86. Wouters, P., van Nimwegen, C., van Oostendorp, H., & van der Spek, E. D. (2013). A meta-analysis of the cognitive and motivational effects of serious games. *Journal of Educational Psychology, 105*(2), 249–265. [DOI](https://doi.org/10.1037/a0031311)
87. Zhang, J., & Norman, D. A. (1994). Representations in distributed cognitive tasks. *Cognitive Science, 18*(1), 87–122. [DOI](https://doi.org/10.1207/s15516709cog1801_3)
88. OpenAI. (n.d.). Codex authentication. Retrieved July 24, 2026. [Documentation](https://learn.chatgpt.com/docs/auth)
89. OpenAI. (n.d.). Data Controls FAQ. Retrieved July 24, 2026. [Help Center](https://help.openai.com/en/articles/7730893-data-controls-faq)
90. OpenAI. (n.d.). Codex configuration reference. Retrieved July 24, 2026. [Documentation](https://learn.chatgpt.com/docs/config-file/config-reference)
91. OpenAI. (n.d.). Codex web search. Retrieved July 24, 2026. [Documentation](https://learn.chatgpt.com/docs/web-search)
