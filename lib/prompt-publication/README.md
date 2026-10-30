# PR553 local foundation

This directory is **not wired to live publication routes or the existing budget writer**. It supplies template/model primitives, complete structural definition validation,
versioned request/receipt schemas and publication hashes. Schema success is never
permission to publish, proof of existing-consumer compatibility, or a committed write.
The executable wire specification is
`docs/plans/SHARED_PROMPT_WIRE_V1_2026-10-29.md`.

`template-policy.js` is synchronous and browser-safe. It reads only the checked-in
`policy-v1.json`; no live model discovery, service import or persistence occurs.
`validateTemplate` requires a complete template DTO and returns content-free
path/code errors. It preserves body/system strings. Names with surrounding whitespace are rejected, and registered-name lookups use
ASCII case folding. Declaration names are ASCII;
reviewer placeholders must stay in the body, while the pre-site template contract
uses combined system/body placeholders. `definition-schema.js` additionally checks canonical key
identity, exact fields, serialized memos, variable/source/output grammar,
validation/native schemas, model ceilings and temperature. Named checks now preserve 39 audited source contracts; all can pass local
validation with explicit reviewed models. `phase-i.checkin` remains held until
its draft has a common execution definition. Initial Assessment captures active
version identity and executes the captured snapshot; Pre-Site native schema
retains local length validation. See
`docs/plans/SHARED_PROMPT_CONSUMER_COMPATIBILITY_2026-10-30.md`.

`resolvePinnedModel` uses exact reviewed IDs or case-insensitive tier names,
resolving tiers to the artifact's explicit tracked fallback snapshot. It accepts
only explicitly extracted dated IDs, not arbitrary prefix matches. No per-name
null-model defaults have been registered yet, so null fails closed. Affected rows need explicit reviewed models or a separately reviewed
default contract before publication.
`validateModelBudget` checks the pinned model ceiling only, not registered app
budgets or any concurrent-state guarantee. `matchesPolicy` compares new-request
version/hash only; it must run **after** authorized completed-receipt replay in
the future operation, never invalidate historical successful requests.

Artifact generation is offline:

```
node scripts/build-prompt-publication-policy.cjs --check
node scripts/build-prompt-publication-policy.cjs
```

Generation extracts literal rule/model data from tracked source using its AST.
`--check` detects source drift without rewriting. Regeneration is a reviewed
policy change, not a startup/runtime refresh. The envelope hash is SHA-256 over
UTF-8 `JSON.stringify(policy)` with recursively sorted object keys and preserved
array order. The artifact uses ASCII property names; its exact bytes and
hash must be included in .NET golden tests before claiming cross-language parity.
Revision 4 pins schema/transport source digests, named consumer contracts and
the existing budget registry. Control policy identity is last-writer provenance,
not an activation row; old provenance never resets the original CAS revision.
`--check` is required after schema changes; regenerate only as a reviewed policy
update, then explicitly refresh fingerprint vectors if the identity changed.
The envelope is trusted packaged code, not caller-supplied policy. It is deeply
frozen when loaded. No runtime network lookup can alter it.

Every placeholder pattern is applied as a **full-string** match (artifact
`matchMode`); do not use a bare .NET `Regex.IsMatch` with `$`. Check match index
zero and matched UTF-16 length equal to input, or wrap the unanchored pattern in
.NET `\A(?:...)\z`. Tier case folding applies only to ASCII letters.

The inherited A7 `forbiddenPatterns` retain ECMAScript regex/case semantics,
including its whitespace vocabulary; a .NET port must use the shared Unicode
marker vectors rather than assume identical defaults. This does not expand the
existing A7 runtime policy. A7 wrapping remains an independent runtime defense.
Errors are emitted in field order systemPrompt → body → declarations → contracts;
within fields they follow rule order, with repeated codes retained. The shared
fixtures pin the observable multi-error order.

Portable template vectors are in
`tests/fixtures/prompt-publication/templates-v1.json`; model, token and stale-policy
vectors are in `tests/fixtures/prompt-publication/models-v1.json`. The unit suite also checks
actual shipped templates, extracted source rules, limits and model policies.

## Invariants and audit boundary

| Invariant | Enforcement | Verification |
|---|---|---|
| No live writes/provider calls | Pure module and offline AST extractor; no route wiring | Import/dependency inspection and unit tests |
| Preserve exact editable content | No normalization/writeback | CRLF/astral/unchanged-input tests |
| Unsupported placeholder names never disappear | Scan paired double braces and reject unmatched grammar | Unicode/dotted/ASCII golden vectors |
| Preserve per-name parser contracts | Extract complete rule tables; body vs combined checks | Real shipped templates and removed-label/placeholder negatives |
| No mutable model resolution | Exact frozen artifact lookup | Tier snapshots, unknown ID and ceiling negatives |
| No null-default exemption | Empty default registry fails closed | Null/default negative tests |
| No content in errors | Fixed paths/codes only | Sensitive fixture actually present in rejected template |

Whole-flow trace: local caller/test → bounded complete DTO → structural schema →
canonical preimage/hash → validated request/receipt → caller/test. Routes/UI wiring and live schema changes remain absent. The unused budget
preparation/adapter adds strict reads and one atomic-write seam, tested offline;
actual tenant rollback and actor behavior remain deployment gates. `json-contract.js` provides strict duplicate-key parsing,
Unicode/number/object inspection and tagged canonicalization with a 1MiB UTF8
DTO cap. Never generic-parse incoming text before duplicate-key checks.

`publication-contract.js` validates exact versioned requests, baselines, snapshots
and receipts. `fingerprint.js` is SERVER ONLY (node:crypto): hashSnapshot binds
complete raw definition/catalog, publicationFingerprint binds complete request
and separately trusted actor/organization, verifyReceiptBinding checks historical
request equality, and validateFreshPublication checks fresh content/hash/policy.
Use historical replay after authorization and durable lookup BEFORE fresh checks.
Neither a matching hash nor valid receipt shape authenticates a supplied receipt.

Portable fingerprint vectors live in
`tests/fixtures/prompt-publication/fingerprints-v1.json`. Reproduce/check with
`node scripts/build-prompt-publication-vectors.cjs --check` and independently with
`python3 scripts/check-prompt-publication-vectors.py`. Canonical tags/numeric bits/
Unicode escaping are specified in the wire document; this hash algorithm differs
from the policy envelope hash. No .NET parity is claimed from Python success.

`budget-coordination.js` uses pinned models and the closed registry in both
directions. Fresh governed prompt validation requires server budget state and
returns a CAS fence; timeout/generic names cannot select that exemption through
metadata. Budget preparation captures original control before any history/model
read, freezes copies, and preserves the existing immutable envelope/history.
`lib/dataverse/adapters/prompt-budget.js` accepts only a real prepared plan under
trusted DAL context, performs control-first conditional update plus immutable
revision create in ONE changeset, and requires strict actor/noFallback transport.
It does not perform request-ID replay or automatic retries; route integration
must retain the existing durable replay path and handle unknown outcomes. All
new adapter reads/writes use the same target, not the legacy settings client's
sandbox preference. Nothing invokes this adapter from a live route yet.

Remaining mandatory work: the `phase-i.checkin` draft definition, explicit governed models, one-target read/replay/writer
cutover, read paging/status, real clients, solution/plugin/guards and sandbox
proof. Policy deployment must disable/drain old writers and reject unsupported
artifact stamps at the Dataverse boundary; CAS alone is not policy freshness. No .NET parity or tenant transaction behavior is proved.
New helpers do not replace existing runtime validators or callers.
