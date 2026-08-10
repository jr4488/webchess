# WebChess journal manuscript audit v2.1

This record fixes the implementation object and documents the publication audit performed for the manuscript **WebChess: A Rule-Governed Deliberative Layer for Foundation Models**.

## Fixed implementation object

- Method: WebChess 2.0
- Software release: WebChess 2.1.0
- Evaluated commit: `9980328581ba3e6fed6f2c4fc99b555fec4773bc`
- Fixed archive branch: `archive/webchess-2.1.0-evaluated-9980328`
- License: Apache-2.0
- Correspondence: `AnansiPortia@gmail.com`
- Project site: `AnansiPortia.com` (forthcoming)
- DOI: pending external archival deposit; no DOI is claimed before deposit

The moving `main` branch is not the evidentiary object for implementation-specific statements in the paper.

## Material correction: deterministic Gate

A previous manuscript equation incorrectly treated the independent-cluster ratio as part of the Gate-pass predicate. The implementation does not do that.

The Gate passes only when all of the following are true:

1. Portia's prompt decision is `permit`.
2. At least three candidates are usable (`preserved` or `wounded`).
3. At least three independent candidate clusters remain.
4. Required coverage includes `protected_outcome`, `evidence_or_reality`, `risk_or_countercase`, and `agency_or_action`.
5. At least one explicit tension remains between independent usable candidates.
6. No unaddressed severe or fatal cross-candidate contradiction remains.
7. No severe or fatal failed or unresolved Portia objection remains on a usable candidate.
8. Portia supplied no field-repair reason.
9. Every wounded usable candidate carries its exact qualification.

The ratio `independentClusterCount / usableCandidateCount < 0.60` is calculated only after a Gate failure. It is a **retry-routing heuristic** (`duplicateHeavy`), not an admission condition.

## Implementation claims audited

The publication artifact includes a machine-readable ledger covering the following implementation claims:

- release and lifecycle versions;
- 64-facet requirement and 8 x 8 analytic grid;
- domain-separated facet, hexagram, and board permutations;
- circular-board geometry and direct-capture rules;
- 100 quiet-ply and 256 total-ply bounds;
- 150,000-node default engine budget and deterministic seeded tie-breaking;
- exact capture-attention formula;
- 13 Portia attack types and four dispositions;
- prompt-digest binding before Answer;
- Gate thresholds and corrected ratio semantics;
- two same-field replays and one field regeneration;
- Charlotte's answer-digest binding, four-candidate support ceiling, and exactly three reversible actions;
- human-owned Wilbur actions and observations;
- explicit, fail-closed lifecycle transitions.

Source inspection establishes contract conformance. It does not establish that WebChess improves reasoning or resists an adaptive adversary.

## Bibliographic audit

Every retained reference in manuscript v2.1 was checked against at least one authoritative source: DOI/Crossref, publisher or institutional primary pages, arXiv metadata, ISBN/library catalog records, or an equivalent first-party record. Metadata discrepancies were corrected. Uncited entries were removed. Entries without an authoritative bibliographic resolution were excluded rather than laundered through fluent prose.

## Safety and control additions

The revised manuscript adds primary literature on:

- AI control under intentional subversion;
- Deliberative Alignment;
- Constitutional AI and AI debate;
- indirect prompt injection;
- sleeper-agent and deceptive-behavior evaluations;
- NIST AI RMF 1.0 and the Generative AI Profile;
- recent work on monitor evasion, agent control-flow integrity, and persistent-memory poisoning, described as provisional where the source is a recent preprint.

It also adds an explicit adversarial threat model covering prompt injection, correlated model failure, monitor evasion, seed grinding, provenance tampering, persistent-memory poisoning, privilege and rollback failures, denial of service, and persuasion-induced overconfidence.

## Figure policy

The journal edition replaces the character-style Portia illustration with a technical diagram of ordered survivor traversal, the 13-part attack battery, candidate dispositions, cross-candidate summary, and deterministic Gate. Character artwork remains suitable for project outreach or supplementary material, not as the primary scientific representation.

## Archival package

The audited distribution contains:

- PDF and editable Word manuscript;
- Markdown source and audited BibTeX library;
- implementation-claim ledger;
- reference-verification ledger;
- replacement Portia figure in PNG and SVG;
- `CITATION.cff`, `codemeta.json`, and `.zenodo.json`;
- fixed-commit source archive;
- SHA-256 checksums;
- DOI deposit instructions.
