---
title: Semantic Documentation Inspection — 2026-07-22
domain: docs-governance
kind: audit
status: historical
summary: Code-grounded semantic inspection that identified 14 documentation findings; the targeted reconciliation was completed on 2026-07-22.
canonical: false
owner: product-engineering
last_verified: 2026-07-22
related:
  - docs/DOCS_CATALOG.md
  - docs/CI_GATES_REFERENCE.md
  - docs/audits/claude-sonnet-documentation-code-audit-2026-07-22.md
---

# Semantic Documentation Inspection — 2026-07-22

## Verdict

**TARGETED RECONCILIATION COMPLETED 2026-07-22.** The inspection found two P1
documentation-contract failures, nine P2 current-state or status defects, and three P3
navigation/precision defects. No runtime defect was found. All 14 findings were reconciled in the
subsequent documentation pass; the findings below remain as the audit record.

The right response is a narrow documentation repair pass, not a broad rewrite.
Most drift is concentrated in older active/canonical documents that predate shipped
work. Mechanical gates remained green because the paths and symbols still exist;
the prose around them is what became false.

## Remediation record

- Reconciled the grantee spec/build plan to the signed waiver-token flow, two-row Dataverse
  ownership, and deployed logical field names.
- Refreshed the System Model, Reviewer Finder, Reviewer Data Model, Executor contract, AI data-flow
  matrix, Atlas route-count pointer, and current session handoff.
- Marked the March security report, cancelled intake-pilot design, and BILL chunk-6 pre-implementation
  design historical, with current-authority routing in the agent wiki and root instructions.
- Corrected the interlock unset behavior, Dynamics email-helper source path, and resolved-page email
  deployment language.
- Regenerated the documentation catalog. Relevant documentation, symbol, build-claim, fact,
  canonical-pointer, wiki, instruction, Atlas, and API-matrix gates and their self-tests passed.
  Five focused grantee-waiver/current-invitation suites passed 29/29.

## Method and coverage

Three agents independently owned non-overlapping top-level catalog domains:

1. architecture/data/platform/security;
2. reviewer identity, workbench, email, and honoraria;
3. agent harness, prompts/Executor, intake, and grantee portals.

Every top-level document represented by the 24 `DOCS_CATALOG` domains was assigned.
The generated catalog reports 231 top-level Markdown documents (230 table entries
plus the catalog itself). Matching Atlas pages, agent-wiki topics, memory leaves,
and `MEMORY.md` routes were included in the applicable domain. Canonical, active,
and draft documents were inspected for current semantic claims. Historical
documents were checked for truthful status/routing rather than revalidated as
current specifications.

Each material finding required source, caller/consumer, and test/gate evidence;
another agent then tried to refute it. Cross-review downgraded several severities
and mostly refuted one proposed OpenAlex finding. Documents and other audit reports
were treated as leads, not as proof.

This was a corpus-wide semantic inspection, not a claim that every sentence in all
671 files under `docs/` and `.claude-memory/` was independently re-derived. Dynamic
production configuration, Dataverse row counts, and external provider state remain
outside static-repository proof.

## P1 findings

### P1.1 — Grantee portal consent and persistence contract contradicts live code

`docs/GRANTEE_PORTAL_SPEC.md:52-59,149-155` correctly says the signed waiver render
token is verified and the acknowledged version is persisted. The same live spec at
`:175-177` then says the waiver is only a UI gate, is not persisted, and is not
rechecked. `docs/GRANTEE_PORTAL_BUILD_PLAN.md:232-251` likewise says the waiver is
never sent and omits `waiverToken` from the multipart contract.

[VERIFIED] `pages/api/external/grantee/[token]/submit.js:105-128` fails closed unless
the signed waiver token is valid, request-bound, and carries a GUID version.
`lib/services/grantee-upload.js:75,124-146` requires and atomically persists the
policy-version binding, acknowledgement timestamp, and optional body hash. The
three focused waiver suites passed 36/36 during adversarial cross-review.

The same documents also retain pre-deployment field and ownership instructions:
`wmkf_abstract_formatted` / `wmkf_abstract_approved` and flat request lifecycle
fields. The deployed logical names are `wmkf_abstractformatted` /
`wmkf_abstractapproved`, while package lifecycle and waiver state live on
`wmkf_granteedeliverable` (`lib/dataverse/schema/wave2-grantee-deliverables/`,
`lib/services/grantee-deliverable-record.js`, and `lib/services/grantee-upload.js`).

**Impact:** an implementer following the active docs could weaken the consent gate
or write the wrong Dataverse fields/entity.

**Minimal repair:** reconcile both documents around the signed-token, server-
verified, persisted consent path and the deployed child-entity ownership model.
Remove the obsolete UI-only and flat-field instructions rather than adding another
exception note.

### P1.2 — Canonical System Model treats shipped Workbench behavior and tabled BILL work as future/core

`docs/SYSTEM_MODEL.md:53-55,147-149,199-207,318-321` calls the per-request Workbench
planned/missing and makes BILL setup part of the first-class reviewer lifecycle.

[VERIFIED] the per-request Workbench reviewer flow is live in
`shared/components/workbench/ReviewersTab.js`, including Find, Invite, and Track.
The request-agnostic Reviewer Pool may remain future work and must be described
separately. BILL code still exists, but
`lib/bill/onboard-reviewer-service.js:82-96` returns the deferred outcome before
any BILL call; the current owner decision is the no-BILL honorarium path with BILL
tabled.

**Impact:** the canonical architecture can send future work toward already-shipped
surfaces and explicitly tabled integration scope.

**Minimal repair:** distinguish the live per-request Workbench from the future
request-agnostic pool, and describe BILL as dormant/tabled with the no-BILL path as
current.

## P2 findings

### P2.1 — `SESSION_PROMPT.md` routes work to already-fixed findings and an already-merged branch

`SESSION_PROMPT.md:45-62,80-83,156-162` leaves evaluation findings F1/F2 open,
claims the branch is 19 commits ahead, and says the default validator still uses
the v1 fixture.

[VERIFIED] commit `89401759` is in current history. The validator derives the
fixture from the manifest at
`scripts/validate-reviewer-holistic-m1-assets.js:38-42,79,93-109`, with unit tests.
`origin/main..codex/m1-evaluation-foundation` is now zero; the branch was merged.

**Repair:** replace the stale handoff rather than incrementally annotating its old
queue.

### P2.2 — Canonical Reviewer Finder documentation describes the legacy `.eml` UI as current

`docs/REVIEWER_FINDER.md:24-30,45-78,120-158,171-213` presents `.eml` generation,
`SettingsModal`, and `EmailGeneratorModal` as the primary staff workflow and
Dynamics sending as future work.

[VERIFIED] the current Workbench path is `ReviewerInvitePanel` →
`InviteEmailModal` → `/api/review-manager/render-emails` →
`/api/review-manager/send-emails`. The legacy generate-emails route/service and
tests still exist, so this is not a deletion claim; it is a current-UI claim.

**Repair:** document Workbench preview/direct send as current and label `.eml` as a
retained legacy/API path pending a separate caller-based retirement decision.

### P2.3 — Canonical reviewer data-model diagrams still render a dropped sidecar as live

`docs/REVIEWER_DATA_MODEL.md:64-86,131-158` draws `APPRESEARCHER` twice as a live
1:1 sidecar. A late caveat at `:269` says it was dropped and should be mentally
folded into `POTENTIALREVIEWER`.

[VERIFIED] `lib/dataverse/adapters/researcher.js` targets
`wmkf_potentialreviewerses`; bibliometric fields now live on the person. The caveat
prevents a P1 classification, but canonical diagrams should not require readers to
invert the model after reading it.

**Repair:** redraw both diagrams and entity tables without the sidecar.

### P2.4 — Executor contract states unbuilt Power Automate parity in the present tense

`docs/EXECUTOR_CONTRACT.md:29-34` says both implementations perform the same nine
steps and produce byte-identical cache prefixes and structurally identical run
rows. `:363-381` says the Power Automate child flow is deferred.

[VERIFIED] the Vercel implementation exists in
`lib/services/execute-prompt.js`; no repository implementation or conformance probe
establishes the claimed PA parity.

**Repair:** state this as the intended cross-platform acceptance contract; label
Vercel implemented and PA deferred.

### P2.5 — AI data-flow matrix calls shipped Executor controls the next step

`docs/AI_DATA_FLOW_MATRIX.md:70,144-145,160-165` records declarative
`dataClass`, `maxChars`, and raw-output retention as shipped, while `:78` says the
Executor remains the next place to formalize those same controls.

[VERIFIED] the controls are implemented in
`lib/services/execute-prompt.js:183-221,752-807`.

**Repair:** make the remaining work incremental adoption by prompt rows/callers,
not implementation of the already-shipped Executor mechanism.

### P2.6 — Atlas freezes an obsolete API-route count

`docs/APPLICATION_STATE_ATLAS.md:154-158` says the persistence matrix covers all 77
routes.

[VERIFIED] `npm run check:api-routes` reports 147 current route files and the
canonical-count machinery derives the same value.

**Repair:** remove the literal and point to the CI-gated matrix/canonical count.
Do not replace one frozen number with another.

### P2.7 — System Model routes readers to a historical document as the live catalog

`docs/SYSTEM_MODEL.md:21` calls `docs/SYSTEM_OVERVIEW.md` the live feature catalog;
the target has `status: historical` and February-era content.

**Repair:** route to `shared/config/appRegistry.js`, the Atlas, API matrix, and/or
another genuinely maintained current surface.

### P2.8 — Active Security Architecture names the wrong Next.js major

`docs/SECURITY_ARCHITECTURE.md:124` says Next.js 14;
`package.json` uses `next:^16.2.9`.

The first-pass claim that this document omitted OpenAlex was largely refuted:
OpenAlex is named later in the document, and the credential contract belongs in
`docs/CREDENTIALS_RUNBOOK.md`. The actionable defect is the stale active runtime
version/status, not a broad external-service rewrite.

**Repair:** either refresh the active report's runtime facts or explicitly make it
historical and route to maintained security authorities.

### P2.9 — Intake and BILL implementation documents have misleading active/pre-implementation status

`docs/INTAKE_PORTAL_DESIGN.md` says `status: active` while its body says the plan is
superseded/cancelled and the owner-backed intake work is parked.
`docs/BILL_CHUNK_6_ENDPOINT_DESIGN.md:19-23` says draft/pre-implementation and
siblings pending even though the endpoint, service, migration, and tests exist;
the built path is dormant behind the BILL-deferred outcome.

**Repair:** mark intake as parked/historical with its shipped foundation separated
from future UI, and mark BILL Chunk 6 as implemented-but-dormant/owner-tabled.

## P3 findings

1. **Interlock default precision.** `CLAUDE.md:28` accurately says explicit `warn`
   is live and unknown targets fail closed, but omits that unset/empty
   `DATAVERSE_TARGET_INTERLOCK` resolves to `off`
   (`lib/dataverse/core/interlock.js:69-80`). Add that future-deployment caveat;
   this is not evidence that current production configuration is wrong.
2. **Dynamics email navigation.** `docs/agent-wiki/topics/dataverse-dynamics.md`
   points first-statement email DAL assertions at the `dynamics-service.js` facade.
   They now live in `lib/services/dynamics/email.js:76,148,186`; retain the facade
   as the public entry point but fix the enforcement-source path.
3. **Resolved-page email status language.** `docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md:19`
   says production promotion remains deliberate while `:152-157` says it was
   production-enabled. Code proves conditional behavior, not live Vercel env state.
   Reconcile as a dated deployment attestation plus a re-verification requirement.

## Confirmed high-risk contracts

- The Dataverse Atlas and API-matrix gates were healthy at inspection time;
  current machine-derived counts live in `docs/CANONICAL_COUNTS.md`.
- DAL trust establishment and email mutation assertions are implemented and tested.
- Reviewer search history, durable roster, applicant enrichment/promotion, and
  invitation UI paths have dedicated tests and match their current focused docs.
- The resolved-page email tier is conditionally implemented and test-covered.
- BILL API code is present but the current runtime path is deliberately deferred;
  the no-BILL honorarium path remains the current operational model.
- The signed grantee waiver token is server-verified and consent evidence is
  durably persisted.

## Residual and external-state limits

- Live Vercel values for `DATAVERSE_TARGET_INTERLOCK`,
  `REVIEWER_PAGE_EMAIL_TIER_ENABLED`, and `BILL_ONBOARDING_DEFERRED` were not probed.
- Dated Dataverse row counts were not refreshed.
- Archived benchmark metrics and external-provider results were treated as dated
  evidence, not re-executed.
- Historical/audit documents were checked for honest status/routing; their old
  implementation details were not rewritten as current facts.

## Recommended repair order

1. Fix the two grantee portal documents and the canonical System Model.
2. Refresh the stale session handoff and canonical Reviewer Finder/Data Model.
3. Reconcile Executor/AI matrix, Atlas count, Security Architecture, intake, and
   BILL document status.
4. Apply the three small P3 precision/navigation changes.
5. Run a fact sweep for each changed claim, regenerate the catalog, and run the
   relevant doc, instruction, Atlas, API-matrix, and focused feature gates.
