---
title: Shared Prompt Definition Format v1
domain: ai-platform
kind: contract
status: proposed
summary: Normative v1 publication-definition rules for Admin and backend tools, with explicit existing-source differences and local implementation acceptance.
canonical: false
cataloged: 2026-10-29
owner: product-engineering
related:
  - docs/plans/SHARED_PROMPT_LIBRARY_PLAN_2026-10-29.md
  - docs/plans/SHARED_PROMPT_PUBLICATION_CONTRACT_2026-10-29.md
  - docs/EXECUTOR_CONTRACT.md
---

# Shared prompt definition format v1

**[PARTIAL implementation; normative complete contract]** The offline
`lib/prompt-publication/` implements complete structural definition validation,
wire schemas and fingerprint primitives. Consumer restrictions/defaults and live
publication remain incomplete. The executable
[wire specification](SHARED_PROMPT_WIRE_V1_2026-10-29.md) pins memo encoding,
transport/canonicalization and stricter reviewed schema subsets. This defines the
shared stored-definition validator; it does not describe a deployed API or
promise every runtime supports every accepted definition. `definitionFormatVersion`
is 1. Wire contract version and reviewed policy-artifact version/hash are separate
and are all bound into the request fingerprint and receipt. Both clients invoke
the same authoritative publication operation; lifecycle-only publication is
never offered. Catalog metadata remains editorial and separate.

## Definition fields and normalization

The client DTO maps `name`, `systemPrompt`, `body`, `variables`, `outputSchema`,
`model`, `temperature`, `maxTokens` to the existing corresponding prompt columns.
Lifecycle, assigned version, current flags, timestamp and actor are server-owned,
not definition inputs. Do not drop unknown persisted content fields silently;
unsupported extensions remain discoverable and need explicit author reconciliation
before publication. No arbitrary executable code or caller-supplied validator.

| Field | v1 publication rule |
|---|---|
| name | Preserve registered legacy spelling. New keys use lowercase ASCII domain.purpose style and the existing 850-character storage ceiling. Canonical identity must match case-insensitive reader identity; collision audit before cutover. No renaming as a side effect of title changes |
| body | Nonblank string, max 65,536 UTF-16 code units. Reject whitespace-only content. Preserve content bytes/line endings; no implicit rewriting |
| systemPrompt | String, empty allowed, max 65,536 UTF-16 code units; omitted normalizes to empty only in a complete DTO explicitly confirmed by the editor |
| variables | Null/empty normalizes to absent only if no template variable is used; otherwise serialized JSON object containing `variables` array. Unique ASCII names matching `[A-Za-z0-9_]+`. Every used placeholder must be declared and every declaration used across system+body |
| outputSchema | Null is allowed for existing template-only application consumers whose runtime owns its parser. Otherwise JSON object with a nonempty `outputs` array and the rules below. New general-purpose Admin/backend creation uses a declared returned-output definition, not a null schema |
| model | Reviewed concrete Claude ID or the existing tier vocabulary; normalize tier spelling to lowercase. Preserve explicit null only for existing non-native definitions with a policy-declared application default. Validate its effective default/ceiling from the pinned artifact rather than skipping the ceiling check. New creation requires an explicit reviewed model/tier |
| maxTokens | Positive JSON integer; no string-number coercion. Validate against effective concrete model ceiling in the pinned artifact and applicable registered budget. Existing incomplete/null values stay visible but need explicit completion before republish; no invented inheritance/default from a nonexistent row |
| temperature | Explicit null or finite JSON number in [0,1], preserved in the row. New creation supplies an explicit reviewed value. Sending/omitting this parameter is capability-gated by the executing runtime, not forced on models that reject it |

JSON memo fields retain the verified 1,000,000-character per-column storage cap;
draft/save transport must also enforce one bounded whole-DTO UTF-8 byte limit
consistent with its API route and Function limits. The local schema pins a 1,048,576-byte serialized DTO limit, depth 32 and 50,000
value nodes, with malformed Unicode/unsafe numbers rejected before hashing;
no claim that every theoretical maximum-sized combination fits a request.

**[VERIFIED existing-source difference]** `prompt-validators.js:26` defaults to
60,000, while `prompts-publish-service.js:31,394-398` explicitly passes 65,536.
v1 uses the existing publication cap for both clients, without changing unrelated
per-user override caps. Current publish permits null models, numeric coercion
in parts of legacy stored metadata, and weakly checks some output fields.
The explicit v1 rules close these ambiguities; they are not proof that live rows
already pass them. No current row is automatically rewritten or retired.

## Variables, templates and runtime vocabulary

- Placeholder recognition is explicitly ASCII: `{{` + optional ASCII whitespace
  + `[A-Za-z0-9_]+` + optional ASCII whitespace + `}}`. Use identical explicit
  classes in JS/.NET, never their differing default `\w` or `\s`. A placeholder-
  shaped token with unsupported name/whitespace is rejected rather than ignored.
  Plain literal braces are not template variables. Include accented identifiers,
  nonbreaking spaces, CR/LF/tab, dotted names and astral characters in parity cases.
- Reject the existing A7 body/system marker patterns in `prompt-validators.js`:
  sentinel keyword, preamble heading and sentinel-shaped WMKF markers. Export
  the actual rule data and all name-specific contracts into the pinned artifact;
  do not copy only a generic validator and lose per-name rules.
- Supported source kinds for Executor definitions: `override`, `dynamics`,
  `sharepoint`. Dynamics table is absent/default `akoya_request` or explicitly
  `akoya_request`, with a nonempty field; SharePoint requires a nonempty pattern
  and optional preprocess `pdf_to_text`. No `prior_output`, `context_block`,
  native-document or arbitrary new source kind is introduced by v1.
- Template-only existing app definitions may declare caller-supplied variables
  without an Executor source. Capture their known consumer constraints before
  cutover; changing an existing key to null outputs/missing sources must not
  bypass its known Executor/caller contract. This is preservation of existing
  consumers, not a new general-purpose legacy PA validator.
- `required`, `cacheable`, `untrusted` are booleans when present. Preserve
  `placement` metadata; only `user` and `system` are recognized strings, and
  acceptance of stored placement does not add runtime support for it.
- `untrusted:true` requires a nonempty `dataClass` and positive integer `maxChars`.
  A bounded variable's paired dataClass/maxChars must be complete. `dataClass`
  is a bounded nonempty classification tag, NOT a closed enum: existing runtime
  accepts tags beyond the exported DATA_CLASSES constants (including transcript
  tags). It never grants a security exemption or permission. Keep runtime wrapping
  and post-output validation as independent defenses.

## Output definitions

| Attribute | Allowed values / rule |
|---|---|
| parseMode | `raw` or `json`; omitted means `json`. `raw` requires exactly one output |
| generationMode | Absent/null or `native-json-schema`. Native requires explicit `parseMode:json`, object jsonSchema and a reviewed compatible concrete model, not tier/null |
| outputs | Nonempty array with nonempty unique output names. Preserve existing output type metadata; actual returned values obey runtime parsing and validationSchema |
| target.kind | `none` or `akoya_request`; the latter requires nonempty field and optional single-level ASCII `$.name` jsonPath. New general-purpose creation offers `none`; existing reviewed field-write definitions remain editable |
| guard | `skip-if-populated` or `always-overwrite`; preserve existing runtime default by target kind. No unrecognized guard silently falls through |
| rawOutputRetention | `full`, `hash`, `none`; absent preserves existing `full` behavior. Caller-owned content-free audit constraints can only tighten it at runtime |
| jsonSchema | Object when present; native schema compatibility must pass the pinned supported-schema checks. Do not confuse illustrative prose with machine JSON |
| validationSchema | Existing `ai-output-schema.js` node vocabulary: string, integer, number, boolean, array, object, record with their declared child/bound/enum properties. Shared .NET validation must reject unsupported node types and match the existing accepted shape; it does not execute regular-expression/code supplied as a new runtime capability |

Unknown source/target/guard/parse/generation/retention values are publication
errors in v1. This is stricter than today's partly runtime-only enforcement;
label it a new publication check, not a previously verified invariant.

## Per-name constraints that must survive extraction

These exact source rules belong in the generated artifact and golden corpus:

| Existing key | Required placeholders | Required body labels |
|---|---|---|
| reviewer-finder.analyze | proposal_text | PRIMARY_RESEARCH_AREA:, SECONDARY_AREAS:, KEY_METHODOLOGIES:, KEYWORDS:, REVIEWER:, NAME:, INSTITUTION:, EXPERTISE:, SENIORITY:, REASONING:, SOURCE: |
| reviewer-finder.score-candidates | proposal_summary, candidates_list | RELEVANT:, REASONING:, SENIORITY: |
| pre-site-visit.proposal-core.generate | request_context_json, proposal_text across system+body | No labels from this validator; retain the producer's additional runtime contract checks |

Other existing callers impose stricter source/schema/provenance assertions;
extract and test these at their consumers before enabling their publication,
never replace them with only this three-row table. New generic prompt keys need
no app registration to appear/publish, while new execution wiring remains separate.

## Policy, fixtures and rollout acceptance

The first release packages ONE reviewed immutable artifact with the JS client
validator and .NET operation: exact version/hash, explicit tier→concrete mapping,
default model resolution, concrete model capabilities/ceilings and parse rules.
No provider-list call, mutable policy-activation settings row or policy-only
global write lock. Policy replacement is a code/solution deployment with both
publication routes disabled server-side and all in-flight operations drained;
new operation rejects mismatched client version/hash. Completed receipt replay
uses its original fingerprint and remains available across upgrades. Runtime
model/tier capability checks remain separate because invocation can be later.

The first LOCAL implementation slice turns this contract into executable schema,
artifact extraction and shared golden vectors; .NET packaging/tooling must be
available before compiling/deploying it, not before writing JS/contracts/mocks.
Exercise boundary lengths, null/missing/invalid types, duplicate variables,
unknown enums, all per-name rules, Unicode regex differences, frozen tier limits,
null-default model, unsupported native output and stale artifact hashes.
Do not infer full .NET parity from JS-only success.

Before enabling new writers, run the extracted validator read-only over the
complete current-row cohort under separately authorized Production access (or
owner-run export), reporting content-free IDs/reasons. Existing permission to
find one representative prompt does not authorize that broader content scan.
Retain incompatible rows without auto-editing; resolve them explicitly before
affected publication cutover. Library discovery and local implementation are
not blocked by that deployment-only audit or historical PA-flow discovery.

**[PLANNED budget-policy parity]** The budget publisher must replace its current
dynamic tier/model resolution with the SAME pinned tier/default/capability
artifact used by prompt publication. Coordination alone cannot protect a pair
validated against different model ceilings. Policy deployment disables and drains
governed budget writes as well as both prompt publication routes, then revalidates
all governed active budget/model pairs against the new artifact before re-enabling
writers. Reject incompatible pairs for explicit remediation. Shared golden cases
cover differing dynamic versus pinned tier ceilings and policy upgrades.
