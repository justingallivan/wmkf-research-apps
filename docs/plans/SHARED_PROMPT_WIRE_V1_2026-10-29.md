---
title: Shared Prompt Local Definition and Wire v1
domain: ai-platform
kind: contract
status: active
summary: Executable local definition and publication request/receipt schemas with bounded JSON, deterministic fingerprints and portable vectors; not a deployed publication operation.
canonical: false
cataloged: 2026-10-29
owner: product-engineering
related:
  - docs/plans/SHARED_PROMPT_FORMAT_V1_2026-10-29.md
  - docs/plans/SHARED_PROMPT_PUBLICATION_CONTRACT_2026-10-29.md
---

# Local definition, request/receipt and fingerprint v1

**[VERIFIED via source and local tests; NOT deployed]** Implementation:
`lib/prompt-publication/{json-contract,definition-schema,publication-contract,fingerprint}.js`.
Both future clients use these contracts; .NET must match the portable vectors
before writer enablement. No route, live database/schema or client wiring has changed. The subsequent
budget milestone adds an unused strict changeset adapter. The [consumer compatibility milestone](SHARED_PROMPT_CONSUMER_COMPATIBILITY_2026-10-30.md)
audits 39 names; `phase-i.checkin` stays held for a common definition. The unused
strict budget adapter remains unwired. Initial Assessment and Pre-Site changes
are local runtime changes that require deliberate coordinated promotion.

## Invariants and boundary

| Invariant | Enforcement | Verification |
|---|---|---|
| Unknown fields and enum complements reject | Exact object allowlists, recursive source/output/schema checks | Missing/extra/type/enum negative tests |
| No ambiguous or lossy JSON | Duplicate-key parser, Unicode/number checks, depth/node/byte bounds | Duplicate escaped keys, surrogates, unsafe numbers, cycles/accessors negatives |
| Preserve exact content | Wire definition carries original memo strings, not parsed replacements | CRLF, Unicode and memo-whitespace hash differences |
| Complete submitted snapshot/request bound | Domain-separated snapshot hash and request fingerprint plus trusted actor/organization | Portable goldens and per-field mutation tests |
| Historical receipts survive policy upgrades | Structural schemas accept historical positive policy revision/hash; replay hashing never checks installed artifact | Old-policy receipt binds while fresh request fails policy check |
| Template/format success never authorizes a write | No live callers; separate fresh data checks versus receipt binding | Source dependency inspection; no auth/transaction claim |

## Definition DTO

All eight fields are required, with no extra fields: `name`, `systemPrompt`,
`body`, `variables`, `outputSchema`, `model`, `temperature`, `maxTokens`.
`variables`/`outputSchema` are original serialized JSON memo strings or explicit
null (empty memo is legacy absent). Object-valued memos reject rather than being
silently reserialized. Strings preserve all bytes/line endings; duplicate JSON
keys reject, including differently escaped spellings of the same key.

New keys use lowercase ASCII segments separated by dot/underscore/hyphen, at
least two segments and at most 850 UTF-16 units. Unsupported legacy spelling
needs explicit mapping before publication; no rename/normalization occurs.
Body/system caps remain 65,536 UTF-16 units. Variable names and placeholders use
the earlier explicit full-match ASCII rules. Fields are selector-safe ASCII;
prototype-reserved names reject at variable/output/schema/JSON-path sinks.

Source/target/guard/parse/native/retention grammar implements the normative format
v1. Unknown nested extensions remain visible in storage but reject publication,
never silently drop. Supported source kinds are override/dynamics/sharepoint;
Generic override defaults must be strings; object/array/null defaults reject.
Exact audited consumer memos may retain their existing finite scalar numeric or
boolean defaults; altered memos still reject. Dynamics table is only akoya_request. SharePoint glob and optional pdf_to_text
remain declarative. Types, booleans, bounds and paired A7 classifications validate.
Output names are unique. Duplicate write destinations and mixed direct/path
writes to the same field reject; distinct paths in the same memo remain valid.
Raw mode has one output, and raw schemas that runtime
would ignore reject. JSON output schema roots match named output objects.

The existing seven-node declarative validationSchema grammar is checked
recursively. Invalid bounds/defaults/children reject. Nonempty aggregate defaults and
new arbitrary regex patterns require consumer review because runtime defaults
bypass child checks (empty arrays have no children) and regex semantics cannot be safely invented by a port.
Native JSON Schema uses a conservative subset: basic single types, object
properties/required/additionalProperties, array items, scalar enums and text
annotations. Objects must be closed; generic native output names must be declared and
required. Exact audited pass-through root consumers retain their actual output
semantics instead of requiring a new named wrapper. Unsupported native numeric/string bounds and array constraints reject
(minItems only 0/1). No external refs, executable patterns or recursive schemas.
This narrower reviewed subset preserves definitions for explicit reconciliation,
not automatic schema rewriting. Nonnative guidance schemas additionally accept nullable type arrays and recursive
typed additionalProperties for existing record consumers. These do not widen the
native provider subset. Provider behavior is not proved by offline tests.
Provider constraints checked against [Anthropic's structured-output documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

Model values must already be canonical: lowercase tier or exact reviewed ID.
New definitions require an explicit finite temperature in [0,1] and positive
integer tokens within pinned model ceiling. Null model defaults remain blocked;
template-only exceptions are registered only for the fourteen audited tool rows,
with exact body/system and variable contracts and absent output memos;
audited Executor consumers may preserve null temperature, while first publication
still requires an explicit value. Artifact revision 5 includes source/transport
hashes, 39 named contracts, budget registry and a pending consumer-key union from tracked observed names plus source
catalog names. This is a temporary fail-closed audit hold, not metadata-based
permission or a new execution profile. Removing a hold needs actual consumer
checks/defaults and reviewed artifact update, not changing an editorial label.
Fresh governed checks now require separate server budget/control state and return
an internal budgetFence. The future operation must conditionally consume it; the
unused budget adapter prepares/commits the matching original-revision control
changeset. This is not yet a live stored-state guarantee.

## Bounded JSON and canonical preimages

Maximum serialized DTO size: **1,048,576 UTF-8 bytes** including JSON escaping.
Maximum JSON depth 32 and 50,000 value nodes. Memo strings additionally retain
the 1,000,000 UTF-16 storage cap. Each object value and memo parse is inspected;
non-JSON types, accessors, hidden/symbol properties, cycles, sparse/extended
arrays, nonfinite numbers, unsafe integral doubles, negative zero and unpaired
UTF-16 surrogates reject before encoding. Wire adapters must use the strict
parser before a generic parser discards duplicate keys. These bounded rules also
apply to historical v1 replay; retain this canonicalizer for future upgrades.

Canonicalization v1 is **tagged ASCII JSON**, not ordinary sorted JSON. This
avoids serializer/culture/number formatting differences in JavaScript and .NET:

- null → `["null"]`; bool → `["b",true]` / false.
- string → `["s","..."]`: quote/backslash escaped, code units below U+0020 or
  at/above U+007F use lowercase `\uXXXX`, including each surrogate of a valid
  pair. Other ASCII is literal. No Unicode normalization or newline conversion.
- number → `["n","<16 lowercase hex digits>"]`: exact big-endian IEEE754 binary64.
- array → `["a",[<encoded values in original order>]]`.
- object → `["o",[["key",<encoded value>],...]]`: keys sorted by ordinal UTF-16
  code units, including numeric-looking keys. Object insertion order is ignored.

Hash UTF-8 bytes of `domain + LF + canonicalPreimage(value)` with SHA-256.
Snapshot domain is `wmkf.prompt.snapshot.v1`; payload is exactly
`{definitionFormatVersion:1,definition,catalog}`. It binds original memo strings
and all six staged catalog values. No lifecycle stamps or generated time included.
Request domain is `wmkf.prompt.publication.v1`; payload is exactly
`{fingerprintVersion:1,request,actor,canonicalKey:request.promptKey}`.
Canonical keys are already lowercase; no second independent identity is accepted.
Request ID is included. Missing and null differ: missing required fields reject;
optional nested fields remain absent rather than invented. The earlier artifact
hash uses its separately named sorted-JSON algorithm; do not mix these algorithms.

## Request v1

Exact fields: `contractVersion:1`, `definitionFormatVersion:1`, positive
`policyRevision`, lowercase 64-hex `policyArtifactHash`, nonzero lowercase GUID
`requestId`, `operation:"publish"`, `promptKey`, `draftId`, `draftEtag`,
`expectedHeadRevision`, `expectedCurrent`, `metadataBaseline`, `snapshotHash`.
No actor, target URL, force flag, inline content, executable validator or budget
bypass input. GUIDs use full hyphenated lowercase spelling to avoid alias hashes.
ETags use exact Dataverse weak `W/"positive-decimal"` spelling; no wildcard.

Head revision is an unsigned decimal **string** in signed Int64 range, no leading
zeros, so JavaScript never loses precision. Expected max Int64 rejects because
there is no next revision. Published versions remain positive Int32 integers.
Expected current is explicit null or exact `{id,version,etag}`. Draft ID differs
from current ID. Baseline is exact `{schemaVersion:1,current,catalog,headRevision}`:
current is null or `{id,etag}`, must match expected current, and head revisions
must match. First-name baseline catalog is all-null. Baseline is capped at 16,000
UTF-16 units AND 16,000 UTF-8 bytes; the stricter byte bound is intentional.

Catalog has six explicit keys: `title` (200), `description` (4000), `groupKey`
(80), `sectionKey` (80), `usedBy` (4000), `usageCategory` (40). Existing values may
be null; section needs group. Group/section keys use lowercase ASCII bounded keys.
For new-name fresh publication, title/description/group/usedBy/category must be
nonblank; section remains optional. Mutable catalog membership, exact draft ETag,
lifecycle, existing-key identity and head state are future transaction checks.

## Receipt v1 and replay

Exact receipt: `{receiptVersion:1,fingerprintVersion:1,request,actor,
requestFingerprint,published,headRevision,publishedAt}`. The request is the
original complete envelope including snapshot hash, baseline and policy identity.
Actor is server-derived `{organizationId,initiatingUserId,effectiveUserId}` with
nonzero lowercase GUIDs, never read from the request. Published is the promoted
draft's exact `{id,version,etag}`; ID equals draft ID, version exceeds prior active
version, head revision is exactly expected+1. Version must additionally exceed
ALL history inside the future transaction. Time is real UTC ISO milliseconds;
replay returns it unchanged, never restamps. Refreshed active state stays outside
the receipt, not added to this immutable contract.

`verifyReceiptBinding` verifies structural/request fingerprint binding for the
same authenticated actor/organization and original request. It does not prove a
receipt came from Dataverse or committed. The operation must first authorize,
read the durable receipt, and return it before policy/freshness validation.
`validateFreshPublication` then checks definition, snapshot identity/hash,
installed policy and new-name catalog completeness for fresh requests only.
The unwired `transaction-core.js` now checks the server-port head/draft/current/
catalog/inventory and coordinates lifecycle/receipt writes. The port must supply
real authorization, strict target/actor enforcement and atomic SDK transactions;
no Dataverse implementation or tenant guarantee is inferred from local tests.

## Portable evidence

`tests/fixtures/prompt-publication/fingerprints-v1.json` contains exact primitive,
Unicode/IEEE754/key-order, snapshot and first/later-request preimages/hashes plus a
receipt. The later revision exceeds JavaScript safe integer range as a string.
Generate/check explicitly with `scripts/build-prompt-publication-vectors.cjs`;
never refresh goldens at runtime or silently before tests. JavaScript tests and
an independent Python canonicalizer/hash check verify these vectors locally;
The .NET8 SDK harness now runs these primitive canonical/snapshot/request
fingerprint goldens. Complete .NET request/receipt/definition validation and
actual .NET Framework runtime/tenant parity remain unproved; see the SDK milestone.

## Historical schema/hash milestone review (commit 1187caf17)

Contract-reconcile Mode B. Change surface: offline definition/wire/hash modules;
entry points: local tests and explicit fixture scripts. Persistence: versioned
local policy/golden files only. Consumers: tests/checkers, no routes or writers.

| Audit | Disposition |
|---|---|
| Whole flow | Strict bounded DTO/memo parsing → structural definition/request/snapshot → tagged preimage/SHA256 → original request/actor receipt binding. Fresh-only policy/content validation is separate |
| Partial success | N/A: no batches or writes; any validation error makes valid false |
| Async/stale state | N/A: synchronous helpers/scripts; no client state or background write |
| Helper semantics | Raw memo text and line endings preserved. Existing consumer holds cannot be removed by editorial metadata. Receipt shape/binding is not authenticity or committed state |
| Durable surface | No database/schema/route/status changes. Headers/README document bounds and ownership; versioned fixtures/checkers and source hashes catch drift |
| Documentation | Bounded Sweep Mode A updates main plan/format/README/current review statement. First milestone is explicitly historical; old probes remain dated |
| Symbol fan-out | New request/receipt fields and fixed error codes are local test/checker inputs only. Existing readers/UI do not consume them; no persisted status added |

Independent Claude Fable review used OAuth `claude.ai` / WMKF Team, actual model
`claude-fable-5-1`, session `e1b327a7-a169-4c01-ac5d-6274e219a0ff`.
Concrete findings were reproduced and fixed:

1. Override defaults now require text; non-string coercion cannot silently render
   `[object Object]`. Regression cases include object/array/null/number/bool.
2. Duplicate direct destinations, duplicate field+path destinations and mixed
   direct/path writes to a field now reject. Distinct paths remain supported.
3. Jest invokes the fingerprint-vector builder's read-only `--check`; policy
   changes cannot leave stale embedded policy identities in unchecked goldens.
4. Policy negatives isolate string-vs-number version and stale hash at the actual
   current revision, not an already-obsolete version.

Self-review additionally fixed non-string enum selectors being coerced into map
keys; regression tests cover arrays/objects and all request field substitutions.
Fable's targeted recheck ran 221 tests and all three policy/vector/Python checkers,
confirmed all four fixes and selector complements, and reported no remaining
concrete defect in those fixes. Final malformed-input testing also fixed
non-string name lookup and object-valued bound/default comparisons. Fable verified
those fixes and identified the same relational-coercion issue in receipt version
comparison; both versions now must pass positive Int32 checks before comparing.
A strict-parsed regression tests prior/published/both malformed versions and
proves invalid results/no throwing through receipt binding. Final Fable confirmation
ran 232 local schema tests and all checkers, verified normal/equal/invalid version
cases, and reported no remaining concern for this milestone.
No runtime/provider/tenant correctness
claim was inferred from that review. Review made no deployment recommendation.

Final local verification: six suites / 318 tests passed, TypeScript, ESLint,
script syntax, artifact/golden drift checks, independent Python verification and
whitespace checks passed. All 19 relevant policy/document/security gate commands
passed, including sequential paired self-tests. That milestone's revision-2 policy hash:
`cc5def0076a89e6ab9fa912c96de13c8b2bf31c19524223baf2ddc1075540bae`.
