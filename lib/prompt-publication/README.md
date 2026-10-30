# PR553 local foundation

This directory is **not wired to a route, command or Dataverse writer**. Its first
milestone supplies only template and model-policy primitives. A valid template
or model result is never permission to publish or a complete v1 definition check.

`template-policy.js` is synchronous and browser-safe. It reads only the checked-in
`policy-v1.json`; no live model discovery, service import or persistence occurs.
`validateTemplate` requires a complete template DTO and returns content-free
path/code errors. It preserves body/system strings. Names with surrounding whitespace are rejected, and registered-name lookups use
ASCII case folding. Declaration names are ASCII;
reviewer placeholders must stay in the body, while the pre-site template contract
uses combined system/body placeholders. It does not yet validate canonical key
identity or unknown definition fields: the full definition schema must do that.

`resolvePinnedModel` uses exact reviewed IDs or case-insensitive tier names,
resolving tiers to the artifact's explicit tracked fallback snapshot. It accepts
only explicitly extracted dated IDs, not arbitrary prefix matches. No per-name
null-model defaults have been registered yet, so null fails closed. The later
consumer audit must supply defaults before affected definitions can publish.
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
array order. This initial artifact uses ASCII property names; its exact bytes and
hash must be included in .NET golden tests before claiming cross-language parity.
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

Whole-flow trace: local caller/test → complete template DTO → pure validator →
structured result → caller/test. Persistence, routes, UI state, async writes,
partial batch success and durable schema changes are N/A for this milestone.
The new helpers do not replace or change any existing validator/caller. Unknown
models reject; unknown template names get generic validation only, not a claim
that an existing application's consumer requirements have been met. Policy hash
comparison is fail-closed. Full definition/source/output schemas, whole-DTO UTF-8
transport limit, consumer-specific restrictions/defaults, request/receipt schema,
publication fingerprint vectors, read paging/status, both clients, solution
manifest/plugin and budget coordination remain subsequent local work. No .NET
parity or tenant transaction behavior has been verified.
