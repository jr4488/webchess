# WebChess case bundles

`webchess-case-bundle/1` is a portable, single-lifecycle evidence package. It
is separate from the account-wide `webchess-account-export/4` format and does
not replace that privacy export.

When a lifecycle record exists, open **Export this lifecycle for inspection**,
choose one of three allowlist profiles, and select **Download case bundle**. An
export is a point-in-time snapshot, so
its recorded lifecycle state may be in progress, failed, or complete:

- `private-full-v1` retains the stored question, mapped field, model result
  payloads, Portia/Gate/Charlotte records, and Wilbur text. Treat this as
  private data.
- `research-redacted-v1` retains versions, digests, seeds, provider/model
  metadata, lifecycle links, per-move request digests, and the complete move
  log while omitting case narrative and move idempotency keys. Review it before
  sharing.
- `metadata-only-v1` is the narrowest profile. It retains the structural
  lifecycle and move metadata needed for integrity and board-event checks, but
  omits case narrative, move request digests, and move idempotency keys.

Every bundle newly exported by the current implementation retains the
case-scoped research-consent tuple and bounded request metadata:
policy/materiality, status, official provider/transport/model, limits,
attempts, source count, content digest, failure code, and timestamps.
`private-full-v1` additionally retains the query, synthesis, discovered source
URLs, guarded direct-page facts/excerpts, fetch failures, injection signals,
and other case text. The two redacted profiles omit that narrative and retain
only source host/trust/discovery metadata; the omission ledger names what was
removed. A successful provider label is provenance, not proof that a source or
claim is correct.

Earlier `/1` bundles used the same format identifier before the consent tuple
and fetch-failure ledger were added. They remain importable for compatibility,
but verification emits a prominent legacy-provenance warning and lists those
missing fields under **Not verified**. Do not interpret a successfully imported
legacy bundle as containing current consent or direct-fetch provenance.

Every profile is assembled with explicit field allowlists. The bundle records
the selected policy and a field-level omission ledger. For each redacted
profile, the exporter checks that the ledger has exactly one canonical row for
every field excluded from the private profile, plus the deterministic neutral
replay-parts substitution. This includes the stored game outcome, lifecycle
retry reason/survivors/Portia drafts, model-request idempotency and provider
response identifiers, and provider result payloads. `omittedCount` is the
number of non-null scalar/object values or array elements observed in that
field at export time; export fails if a required omission source field was not
queried rather than reporting a false zero. Owner identifiers, credentials,
cookies, tokens, request headers, private model reasoning, and account-wide
rate/usage controls are never queried as case evidence, so their unavailable
counts remain `null`.

No case-bundle profile is anonymous. Stable case/entity IDs, exact timestamps,
source hostnames, seeds, and unsalted content digests can link records across
bundles; a digest can also confirm a guessed low-entropy input. Even the two
redacted profiles are pseudonymous evidence. Inspect a bundle before sharing
it and use `metadata-only-v1` when its narrower evidence is sufficient. Field
allowlists prevent unlisted database columns from being emitted, but they
cannot prove that every retained provider/model/hostname/seed value is
non-sensitive in a particular case.

## Offline, read-only verification

The local OpenClaw interface also offers **Import & verify case bundle** for files up
to the default 3,000,000-byte local export ceiling. The browser sends the file
only to the authenticated loopback WebChess process, which verifies it in
memory without persistence or provider calls. That convenience check does not
receive checkout, runtime-payload, or migration context. It verifies the
bundle's canonical section digests and integrity root for internal
self-consistency, not equality with the installed bytes. Because those internal
digests are recomputable, that result is neither authorship proof nor a local
artifact match. Use the CLI below for exact local source, runtime-payload, and
migration equality checks and for a larger deliberately configured export.

From a WebChess checkout with `npm ci` completed, run:

```bash
npm run case:verify -- /path/to/webchess-case-....json
```

The command does not start PostgreSQL, write an imported namespace, launch a
game, or call OpenClaw/OpenAI. It exits nonzero when verification fails. It
checks:

- the `/1` structural schema, selected high-value metadata types/patterns, and
  selected redaction profile;
- every canonical section SHA-256 and the integrity root for internal
  self-consistency;
- bounded JSON shape and internal lifecycle references;
- the supported rules, cast, engine, and event versions;
- every move/pass by reconstructing the canonical initial board and replaying
  the event log;
- event source/type and persisted revision-group consistency; private bundles
  additionally verify unique move idempotency keys, and private/research
  bundles recompute the canonical move-request digests retained by those
  profiles;
- the terminal outcome summary, when present;
- package, immutable commit, staged runtime-payload digest, and
  applied-migration compatibility against the current checkout when that
  evidence is available.

The CLI reports a matching Git commit as exact local source evidence only when
the checkout is clean, including untracked files. A dirty checkout receives a
warning because matching `HEAD` alone does not describe the files being run.
When building the packed plugin from this checkout, use
`npm pack --pack-destination ..` so the resulting `.tgz` does not itself make
the checkout dirty before this CLI comparison.

Redacted profiles use deterministic neutral 64-square problem parts. That
preserves canonical chess geometry and move legality, but it cannot verify the
omitted problem-to-square wording or capture narration.

Offline verification applies the same pure canonical public-HTTPS URL policy
as the live direct-page fetcher and checks retained route/source consistency.
It cannot reconstruct historical DNS resolution, prove which pinned peer
accepted the connection, verify the historical TLS negotiation, or establish
that a recorded retrieval actually occurred. Those network-history limits are
reported under **Not verified** rather than inferred from a URL or digest.

The OpenClaw launcher hashes the exact staged application payload. A clean
source-link installation also contributes its Git commit. A packed installation
uses the build identity generated by `prepack` and refuses to launch if that
identity no longer matches the staged payload. If neither the launcher nor a
deployment can establish a commit, the bundle records it as unavailable rather
than inventing an identity. The runtime-payload digest is not the SHA-256 of the
outer `.tgz`; record that archive checksum separately when preserving or
publishing a packed artifact.

The exporter labels a syntactically valid runtime digest as configured, not as
independently verified. The offline verifier reports artifact equality only
after recomputing the local payload and matching it. Omission counts for data
that a profile does not contain are exporter declarations; their canonical
paths and explanations are verified, but the absent source values cannot be
recounted offline. A retry bundle also verifies its current parent/root IDs and
single-run invariants, not the unexported ancestor history.

Verification is evidence hygiene, not efficacy validation. It does not prove
that Arachne works, that a model response is truthful, that persisted seeds
were consumed historically, that a provider account was authenticated, or
that an immutable commit remains published remotely. The recomputable SHA-256
manifest is not a signature and does not prove who authored or exported the
bundle. Current persistence also does not contain per-ply policy version,
engine-request ID, or fallback-mode columns; the bundle records those fields as
unavailable rather than `none`.
