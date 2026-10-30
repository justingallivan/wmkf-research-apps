---
title: PR 553 Fable Findings Validation
domain: ai-platform
kind: audit
status: active
summary: Validates the independent Fable review, defines a local-first foundation, pins format policy to deployment, and retains budget consistency coordination before writer enablement.
canonical: false
cataloged: 2026-10-29
owner: product-engineering
related:
  - docs/plans/SHARED_PROMPT_LIBRARY_PLAN_2026-10-29.md
  - docs/plans/SHARED_PROMPT_FORMAT_V1_2026-10-29.md
  - docs/plans/SHARED_PROMPT_PUBLICATION_PREFLIGHT_2026-10-29.md
---

# PR #553 independent findings validation

## Scope and verdict

**READY TO START LOCAL FOUNDATION IMPLEMENTATION. Not ready to deploy or enable
new writers.** Contract-reconcile Mode A; bounded Sweep Mode A reconciles all
proposal restatements of validated corrections. Entry points: Admin and Connor's
command. Durable target: prompt/settings/head/receipt tables. Consumers:
publication clients and current/history readers. Prior findings: Fable review of
`766b27718`, session `aebedfb3-04ad-4a3b-8091-9866a81ad0c7`, model
`claude-fable-5-1`, invoked through verified Claude OAuth subscription.

This validation used source, public primary documentation, offline tests and
explicit algorithm counterexamples. No new tenant read, live write, model call
or provider request. Existing schema/example evidence stays dated and unchanged.
New format/schema/operation behavior remains PLANNED.

## Findings disposition

| Finding | Disposition / correction | Evidence / residual limit |
|---|---|---|
| Missing written v1 | CONFIRMED; new normative format contract defines cap, null/default model, temperature, enums, per-name rules, ASCII matching and pinned artifact. Executable schema/golden vectors are the first local implementation deliverables | `prompts-publish-service.js:367-453`; `prompt-validators.js:20-173`; runtime kinds in `execute-prompt.js:385-495,989-998`. Stricter v1 checks do not prove live compatibility; cohort scan gates writer enablement |
| Missing table ownership | CONFIRMED gap, but UserOwned does not inherently prevent organization-level read grants. Choose OrganizationOwned heads/receipts with explicit Org Read for authorized publishers and enforced mutation restrictions | [Table ownership](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/entity-metadata): immutable creation-time choice. Actor-bound replay remains required; shared storage does not authorize another actor's UUID reuse |
| Mutable policy equality removes need for fence | NOT CONFIRMED for a commit-time freshness promise: a read of p1 can precede activation of p2 and later p1 commit. Avoid relying on unspecified transaction/isolation behavior | Offline `mutable-policy-equality-read` counterexample. Instead remove mutable activation from v1: package immutable artifact with operation; disable/drain writers for policy deployment. This removes policy-only settings/coordination work without an unfenced activation race |
| Remove/defer all budget coordination because runtime fails closed | PARTLY REFUTED. Current server overrides are CAPPED; only oversized row budgets and strict retry floors throw. Runtime protects the provider limit but does not enforce stored budget/model consistency | `execute-prompt.js:795-824`; actual resolver executed offline, and existing tests passed. Retain a budget-scoped original-revision CAS for token-governed prompts before new writers are enabled; defer its implementation out of the first local schema/mock slice, not out of release guarantees |
| Sandbox/tooling gates all coding | CONFIRMED contradiction; rewrite sequence local contracts/validator/readers/mocks and reusable plug-in source → compile → authorized sandbox import/proof → cutover. Same operation source is used for proof and product | No tenant deployment/atomicity claim before proof. Missing .NET/pac blocks compilation/import, not JS/local source work |
| Required key/null handling | CONFIRMED; application-required metadata is not API uniqueness enforcement. Guard nonempty canonical head key/UUID, Active index state and duplicate-data preflight | Existing schema has no prompt-version alternate key. No uniqueness guarantee before activation and guard deployment |
| Atomic work over-labeled | QUALIFIED; synchronous in-context SDK participation is documented, but exact Custom API registration/IsInTransaction and rollback remain ASSUMED until rehearsal. Blog example is supporting illustration, not tenant proof | [Transactions](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/scalable-customization-design/database-transactions), [Custom API](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/custom-api). Operation fails before first mutation if transaction context is absent |
| Bypass privilege inventory | CONFIRMED; inventory actual identities/roles holding either bypass privilege before activation; do not infer Connor/app holdings from job title | [Bypass custom logic](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/bypass-custom-business-logic). No new role reads/grants performed in this task |
| Bulk guard behavior | Documented pipeline merge VERIFIED, exact registration/guards still need tests | [Bulk message pipelines](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/bulk-operations): individual handlers participate; avoid registering duplicated logic twice. Probe supported messages and reject unguarded paths before enablement |
| Receipt read after head conflict | CONFIRMED clarification; a racing replay may observe no receipt before the winner commits. After conflict/timeout reread receipt using same UUID before surfacing a fresh-edit conflict; unknown/unavailable read stays unknown | Both client contracts updated. No new UUID or automatic mutation based only on an absent pre-commit receipt |
| Shorter head key/group UI simplification | No required change. Keep bounded digest identity rather than narrowing existing 850-character key contract. Keep group manager in complete feature, after foundation; do not call partial delivery complete | Snapshot has short names, not a permanent upper bound. These are optional scope choices, not safety defects |

## Fence validation and selected design

Reproducer: `node scripts/check-shared-prompt-publication-fence.cjs`.
Sanitized deterministic results:
[evidence/shared-prompt-fence-validation-2026-10-29.json](evidence/shared-prompt-fence-validation-2026-10-29.json).
It extracts the actual exported pure runtime resolver by AST and executes it
without importing services/env/network. Other cases model proposed algorithms,
not a database transaction or platform isolation guarantee.

Counterexample: budget 16k/model ceiling 64k. One writer validates a budget raise
to 48k against 64k; another validates a ceiling reduction to 32k against 16k.
Without coordination both can commit, leaving 48k > 32k. Actual runtime caps
the override to 32k; it cannot make that stored pair consistent. A strict retry
floor of 32k fails, and a stored row budget of 48k without override also fails.
Thus deleting coordination would weaken the planned stored-state guarantee even
though it is stronger than today's implementation. The user did not request
silently removing that guarantee.

**Selected simplification (PLANNED):**

- Policy: immutable deployment-pinned artifact/version/hash shared by JS/.NET;
  no runtime policy activation, policy-only setting revisions or global writes.
  Disable BOTH publication routes server-side, drain in-flight operations and
  verify version/hash before policy deployment/re-enable. Completed replay keeps
  old receipt semantics; fresh mismatched clients cannot publish. This release
  does not offer live mutable policy administration.
- Budget: retain ONE shared settings coordination row for the existing token-
  governed budget subset. Prompt publications in that subset conditionally
  advance it before reading current budgets, then acquire the per-name head.
  New generic/PA names and timeout-only prompts do not take this budget fence.
  Membership is the reviewed code/artifact budget contract, never caller input.
- JS budget writer: capture original coordination revision BEFORE reading models
  and history/validating; create immutable budget revision plus original-revision
  control CAS in one strict-actor/no-fallback changeset. Every input-changing
  budget-governed model publication participates. Never refresh ETag after
  validation; stale second commit aborts. No mutable-policy writers to coordinate.
- Build this budget adaptation after foundation/mocks, but before enabling new
  governed publishers. Preserve budget UI/schema/history and runtime caps. The
  operation's declared lock order is budget coordination (if required) → head.
  A modeled CAS rejects the stale second commit in both orderings; sandbox must
  prove the implementation's actual rollback/fault behavior.

## Recommendation evidence

| Recommendation | Current prerequisite | At execution point? | Tested / disconfirming check | Status |
|---|---|---|---|---|
| Pinned policy instead of mutable policy fence | One versioned artifact; no live activation path; server writer disable/drain during replacement | Must be implemented in operation/deploy runbook, not a client flag | Offline version/hash mismatch model passes; counterexample refutes equality-only mutable activation. Attempt publication during deployment in sandbox | PLANNED; local-first safe design constraint, not tenant proof |
| Retain budget consistency coordination | Both budget and token-governed prompt writers participate; exact original revision binds validation | Operation and JS changeset before enabling new writers | Actual runtime cap/throw cases and both modeled CAS orders passed. Disconfirm with budget-up/model-down concurrent commits and receipt/state readback in sandbox | VERIFIED need; PLANNED mechanism |
| OrganizationOwned operational tables | Creation metadata and narrow explicit role grants | Solution manifest before provisioning | Official immutable-ownership docs; actual cross-client read/replay role checks NOT TESTED | PLANNED |
| Begin local foundation | Written v1 and explicit no-live-write boundary | Checkout/local tests now | Source findings and offline checks; disconfirm readiness with a missing decision in normative contract/review | READY for local work only |

## Whole-flow / durable reconciliation

Shared Action → exact-state/format checks → per-name CAS plus budget CAS when
applicable → draft/prior/head/receipt commit → both clients' receipt readback.
No durable partial-success outcome is accepted. Client stale-generation/abort
handling and reader structural-error fan-out remain implementation requirements.
No shared helper may replace caller-specific auth or runtime capability checks.
New tables/roles/guards need the Atlas/security/catalog/schema references during
build; no schema migration or runtime cutover is claimed by this planning edit.

Sweep terms: policy/control/fence/activation, ownership, first slice/spike/tooling,
v1/format/null model/temperature/cap, receipt conflict, bypass and bulk. All four
existing proposal documents are structurally reconciled with this disposition
and the new v1 contract. Old source/Atlas/memory describe the current runtime and
remain current; retained probe/test evidence is historical within its date/scope.
Concurrent main handoff files remain outside this branch's edit ownership.
No new Production cohort scan was authorized/performed: it remains an explicit
pre-enable task. No new owner product decision is outstanding.

Independent source review found two additional corrections, now incorporated: authorize and replay matching receipts before applying current policy checks; pin budget validation to the same artifact and freeze/drain/revalidate governed budget writes during policy deployment. No additional blocker to local foundation was found.

Validation: four existing unit suites passed (86 tests); seven offline fence/runtime checks passed. All 15 documentation/security gate commands passed (including sequential paired self-tests), as did script syntax, ESLint and whitespace checks. Independent targeted recheck confirmed both corrections and reported no remaining actionable issue.

**[PLANNED budget-policy parity]** The budget publisher must replace its current
dynamic tier/model resolution with the SAME pinned tier/default/capability
artifact used by prompt publication. Coordination alone cannot protect a pair
validated against different model ceilings. Policy deployment disables and drains
governed budget writes as well as both prompt publication routes, then revalidates
all governed active budget/model pairs against the new artifact before re-enabling
writers. Reject incompatible pairs for explicit remediation. Shared golden cases
cover differing dynamic versus pinned tier ceilings and policy upgrades.
