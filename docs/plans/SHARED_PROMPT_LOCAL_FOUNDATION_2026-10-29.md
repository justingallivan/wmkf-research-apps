---
title: Shared Prompt Local Foundation Milestone
domain: ai-platform
kind: implementation-record
status: active
summary: Historical first implementation milestone and Fable review; subsequent structural schema/wire/fingerprint work is recorded in the linked v1 contract.
canonical: false
cataloged: 2026-10-29
owner: product-engineering
related:
  - docs/plans/SHARED_PROMPT_LIBRARY_PLAN_2026-10-29.md
  - docs/plans/SHARED_PROMPT_FORMAT_V1_2026-10-29.md
---

# PR553 local implementation: template and model-policy milestone

**[HISTORICAL first milestone, commit 564c305a4]** The subsequent
[definition/wire/fingerprint milestone](SHARED_PROMPT_WIRE_V1_2026-10-29.md) now
extends this work. The remainder records the first milestone at its review point.
Local foundation had started, not finished. The implemented boundary
is `lib/prompt-publication/README.md`. Nothing is wired to live routes or writers.
No deployment, schema provisioning, tenant read/write or provider/model execution
was performed. Claude development-agent review used verified subscription OAuth,
with provider API-key authentication removed; no metered review product was used.

## Implemented and verified locally

- `scripts/build-prompt-publication-policy.cjs` extracts literal rule data with
  Babel AST, without loading services/environment files. `--check` detects drift
  without regenerating. The versioned JSON artifact freezes tracked tier fallback
  IDs, exact reviewed Claude capabilities, A7 patterns and all existing template/
  reviewer parse rules. The packaged artifact is deeply frozen on load.
- `lib/prompt-publication/template-policy.js` validates complete template DTOs,
  explicit full-string ASCII declarations/placeholders, combined system/body
  use, and body-only reviewer requirements. It preserves editable strings and
  returns fixed error paths/codes. Whitespace-padded names reject; known-name
  matching uses ASCII case folding. Generic validation is not consumer approval.
- Model helpers use pinned exact model IDs or ASCII tier names; unknown aliases,
  missing defaults, unsupported native models and invalid/oversized token values
  reject. This checks model ceilings, not app budgets or concurrent saved state.
- Portable template/model fixtures pin Unicode whitespace, non-ASCII identifiers,
  parser contracts, multi-error ordering, alias/native/token and stale-policy
  cases. Tests also exercise actual shipped templates and removed requirements.

Current initial artifact hash:
`96257d50032e149748b0b1b451c7dd7bf93a7cbc7cdd1ac5308491e943d215e0`.
It is still a foundation artifact, not the complete release policy. Complete
consumer restrictions/defaults and budget membership must be incorporated before
it can authorize publication; no .NET parity is claimed from JavaScript tests.

## Claude Fable review and corrections

Review session: `3df79922-915f-4110-b50c-5213b5c39efb`, actual model
`claude-fable-5-1`, OAuth `claude.ai` / first-party WMKF Team subscription.
Initial review passed the then-current 57-test suite and found:

| Finding | Disposition and regression evidence |
|---|---|
| Padded name bypasses per-name rules | Reproduced before fix; now rejects surrounding whitespace. Portable padded-contract-name case |
| `$` anchor can accept trailing newline in .NET | Unanchored artifact rule plus explicit full-string match mode; index and UTF-16 length checked in JS. Portable newline-declaration case and documented .NET absolute-anchor/full-length requirement |
| Kelvin sign folds into Haiku tier | Reproduced before fix; tier folding restricted to ASCII letters. Portable Kelvin-model negative |

Added bounded nonblocking improvements from that review: portable model cases,
field/multi-error cases, and vectors/documentation preserving ECMAScript A7 regex
semantics. Lone-surrogate rejection/encoding belongs to the next full-DTO byte
limit and fingerprint milestone before any client ships; this module does not
encode or persist editable content. No new schema/abstraction was added for the
cosmetic null-native error code.

## Contract-reconcile Mode B / bounded Sweep Mode A

Change surface: pure template/model-policy primitives. Entry points: local tests
and offline extraction script. Persistence: checked-in policy/fixture artifacts
only. Consumers: unit tests; no live callers. Prior findings: Fable F1–F3 above.

| Audit | Result / evidence |
|---|---|
| Whole flow | Test/local caller → complete DTO → pure helper → structured result. AST extractor → deterministic JSON → frozen helper policy; source drift/hash tests |
| Partial success | N/A: no batch/persistence operation or partial-save response |
| Async/stale state | N/A: helpers synchronous; no UI or background state |
| Helper semantics | Existing validators remain unchanged. Reviewer placeholders body-only; pre-site combined; exact models and no default fallback. Unit/portable negatives cover complements |
| Durable surface | No database/table/route/column changes. Source headers and directory README define scope; policy/fixture files versioned; relevant checks run |
| Doc reconciliation | Main plan/format/plan-review record now label this partial foundation. Dated probe evidence stays historical. No built/deployed publication claim |
| Symbol fan-out | No persisted enum/status/column introduced. New fixed error codes consumed by tests only; template/model fixture cases cover supported and rejected branches |

**[Historical next-step handoff at first milestone]** Complete full definition/source/output and consumer contracts,
transport byte bound/malformed-Unicode rejection, request/receipt schema and
fingerprint vectors. Then continue the plan's local readers, mocked clients,
solution/plugin and budget coordination. Sandbox transaction/role/uniqueness/
rollback proof and separately authorized current-cohort validation still gate
writer deployment/enablement. Legacy PA-flow discovery remains unnecessary.

## Verification and disposition

**[VERIFIED via local commands]** Final combined run: five suites, 162 tests
passed (76 new foundation tests plus 86 existing validator/publication/budget
tests). Script syntax, ESLint, TypeScript checking, artifact `--check` and
whitespace checks passed. The 19 relevant policy/document/security gate commands
passed, including each paired self-test run sequentially.

**[VERIFIED via Claude recheck]** Same OAuth session, actual model
`claude-fable-5-1`: F1, F2 and F3 resolved; 76-test suite and artifact hash/drift
independently rechecked; no remaining concrete bug in this milestone. Review
accepted this **unwired local milestone only**, without deployment approval or
claims about full definition validation, .NET parity or tenant transactions.
