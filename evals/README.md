# Division quality evaluations

`division-quality-fixtures.mjs` is a small, deterministic offline dataset for the
bounded checks in `server/division-quality.mjs`. It contains:

- a varied workshop-expansion map expected to pass;
- a map with one deliberately similar pair, which protects against an overly
  aggressive detector;
- an obvious numbered scaffold expected to fail; and
- 64 cosmetic rewrites of one idea expected to fail.

Run the evaluator tests with:

```bash
npx vitest run server/division-quality.test.js
```

The checks expose their thresholds, metrics, issue codes, and example pairs.
They detect only obvious templates and widespread lexical near-duplication.
Passing does **not** prove relevance, factual correctness, exhaustiveness, or
semantic distinctness. Model-quality review still needs representative
real-world prompts and human judgment.
