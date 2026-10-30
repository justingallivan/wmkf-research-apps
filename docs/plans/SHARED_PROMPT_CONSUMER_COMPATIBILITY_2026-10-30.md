---
title: Shared Prompt Consumer Compatibility Milestone
domain: ai-platform
kind: implementation-record
status: active
summary: Local contracts for 39 known prompt names and Initial Assessment and Pre-Site compatibility changes; no live cutover.
canonical: false
cataloged: 2026-10-30
owner: product-engineering
related:
  - docs/plans/SHARED_PROMPT_LIBRARY_PLAN_2026-10-29.md
  - docs/plans/SHARED_PROMPT_CONSUMERS_BUDGETS_2026-10-29.md
---

# PR553 consumer compatibility milestone

[PARTIAL / local only] Policy revision 4 captures 39 of the 40 known prompt names.
The remaining `phase-i.checkin` is an observed draft without a common execution
contract or application caller; publication remains held pending its explicit
common-format definition. This is a classified compatibility hold, not an
unfinished search for its PowerAutomate flow. No live row/provider was probed.

| Invariant | Implementation | Verification |
|---|---|---|
| Identity and execution use the same active Initial Assessment version | Capture current row once before identity/reuse, verify exact variables/output before claim, resolve Anthropic model, frozen snapshot into Executor | Concurrent republish, version3, corrupt memo, identity separation tests |
| Existing v2 identities remain stable and Factory follows active version | Explicit runtime version; legacy offline helper fallback remains2; Factory supplies captured version | Default identity equals explicit2; version3 differs |
| Pre-Site retains length enforcement | Native schema omits unsupported maxLength; local validation retains30000 sink cap | Source config and existing consumer tests |
| Legacy routes keep their own execution semantics | Fixed source contracts; tool-only names reject output memos and preserve exact body/system | Independent imported exports and mutation tests |
| Exceptions cannot become generic bypasses | Audited name and exact memo checks, fixed unused declaration list, scalar defaults only for audited consumers | Generic/default and memo mutation negatives |

## Audited consumer families

[VERIFIED via source extraction and unit tests] Ten previous source contracts
plus grantee title/abstract, meeting alignment/fragment review, fourteen tool
rows, Phase I summary, Field Primer, four Phase II rows, two peer-review rows,
two reviewer-finder rows and Echo cover39 names. Tracked seed declarations are
extracted as selected AST slices, never executed as scripts; env loading, bypass
calls and write loops are excluded. Missing initializer dependencies fail.
Tool source imports of runtime boundary helpers are throwing stubs during
extraction, never live imports. Module exports are separately imported in tests.

Tool consumers use tool-prompt-resolver then route-owned parsing/composition;
output memos are absent and cannot be added as an execution bypass. Their body
and system text are initially exact source locks, preserving parser instructions
and A7 placeholders; this is intentionally conservative and does not claim
arbitrary prose edits are safe. Existing source-variable metadata is retained.
Phase II's bundled direct/streaming routes are not switched to Dataverse by this
work. Reviewer Finder still honors per-user overrides; publication does not
silently remove those. Its legacy excluded_names_block declaration is unused
in the current source body; the exact name-bound source contract permits that
one slot while generic unused declarations still fail.

Initial Assessment now checks exact variable/output contracts before durable
claims or paid execution and rejects corrupt/missing identity. It captures the
active version before reuse, so a new publication produces a new generation key
without changing the authoritative proposal fingerprint. The same copied row,
with concrete reviewed Anthropic model, is passed as Executor promptSnapshot;
result name/id/version must match it before rendering/upload. Existing Ready
artifacts retain the existing lineage/recovery rules. The shared config's v2
constant is a legacy offline identity fallback, not a requirement for active
publication. The Factory reads its bound sandbox current prompt, uses the SAME
exact memo validator and supplies that version for its key and both provenance
stamps. Prompt id/version are journaled before creation; changed prompt identity
on resume refuses further writes for operator reconciliation. It never uses the
ambient production prompt store. Exact memo ordering is deliberately conservative and enforced by publication
and runtime for Initial Assessment as well as Pre-Site. Memo/model preflight
errors occur before a claim exists, so they do not create a Failed registry row.

Pre-Site schema generation now excludes only provider-unsupported maxLength;
local schema and proposal-core validation keep bounds. Reader and publication
checks both use the updated exact source contract. Official provider evidence:
[Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
identifies unsupported string constraints. No provider call was made. Deployment
must drain generation and coordinate the new prompt row and reader: old/new
exact schema readers cannot be mixed. No existing live row is rewritten here.

## Whole-flow audits

- Whole flow: tracked seed/config → policy → definition checks → future publisher;
  Initial Assessment current read → validated captured version → identity/claim →
  frozen Executor snapshot → checked run metadata → DOCX → existing lineage.
- Partial success: no publication write path wired; existing artifact finalization
  and failure handling retained. Existing Ready rows are never overwritten.
- Async: copied/frozen prompt snapshot precedes reuse/claim; no second current-row
  read can switch execution after a concurrent publication.
- Helper semantics: tool/direct/Executor paths stay distinct; root record JSON
  schemas allow nonnative nullable types and typed additionalProperties only.
  Native schema remains conservative. Shared schema accepts only audited scalar
  defaults; exact memo checks prevent widening source boundaries.
- Durable surfaces: no new table/column/route/status, no migration or provisioning.
  Existing prompt/version provenance fields remain unchanged.
- Docs: prior milestone is historical; current plan/wire/README point here.
- Symbol fan-out: promptVersion identity input/runtime claim/result check reviewed;
  offline helper default retains v2 identity; Factory and synthetic reuse tests cover active v2/v3. No reader
  starts treating templateVersion as promptVersion.

**MERGE BLOCKER:** main auto-deploys. The drained Pre-Site prompt/reader
transition must be planned and rehearsed before merging this branch; it is not
a post-deployment task. The live current row was not probed by this review.

Deployment remains gated on the shared Dataverse operation/guards, exact
request-ID replay, one-target budget integration, role provisioning, .NET golden
parity and tenant rehearsal. This milestone does not establish tenant atomicity
or enable either publication route. No deployment is authorized by this record.


## Independent review and verification

[VERIFIED via Claude CLI OAuth and review output] Claude Fable
(`claude-fable-5-1` only), session `8a5348d4-4dda-4f84-8512-0608b7c8a130`,
reviewed then rechecked the concrete corrections through WMKF Team subscription
OAuth. No API-key agent authentication or metered review product was used.
The initial minimal-settings launch could not see OAuth; the normal host CLI
succeeded. Both actual review passes report no permission denials.

The first pass identified publication/runtime memo-order mismatch and Factory
version coupling. Both were corrected with a shared validator, exact ordered
publication memos, bound-sandbox current-version reads, journaled prompt identity,
matching keys/stamps and changed-identity resume rejection. The recheck ran14
suites /775 tests, accepted the local feature-branch milestone, and found no new
concrete defect. It retained the Pre-Site MERGE BLOCKER and the requirement to
verify a compatible sole-current Initial Assessment sandbox row before rehearsal.
Its index/worktree warning is addressed by staging and committing the Factory,
extractor and matching policy artifact together.

[VERIFIED via local commands] Final scoped verification:19 suites /1071 tests
passed across publication/budget, Initial Assessment, Pre-Site, tool parity,
resolvers and Factory seed/snapshot/verify. Types, policy/golden drift,
independent Python fingerprints and whitespace checks pass. Lint has zero errors;
one existing unused-disable warning at an untouched Factory line is retained.
The relevant15 gates and14 paired self-tests passed sequentially (29 commands).
Policy revision4 hash:
`868ccaed99306d5ef0a9b1eabf634738590ad3fba9a97b67d3ddcbfc1cb9af60`.
Current restatements in the plan/wire/README/review-validation were reconciled;
the revision3 consumer/budget record is explicitly historical. No live tenant
write, provider call, merge or production deployment occurred.
