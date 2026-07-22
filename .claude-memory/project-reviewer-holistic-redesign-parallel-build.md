---
name: project-reviewer-holistic-redesign-parallel-build
description: Reviewer identity/finding roadmap: legacy-authoritative runtime; W2 cutover, Wave 13 policy migration, pilot, and cleanup remain gated.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-07-22 via reviewer identity runtime/callers, binding-writer imports, evaluation-only pipeline location, Track B constant, and controlling plans
---

## Recall Rule

Read this before reviewer origination, disambiguation, identity persistence, or
redesign rollout work. Then route by surface:

- current enforced boundaries: `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`;
- W0–W4 disambiguation, affiliation/COI, and email mechanics:
  `docs/REVIEWER_IDENTITY_CONTACT_PLAN.md`;
- Wave 13 binding, evaluation governance, production pilot, and cleanup:
  `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md`.

Source, Atlas, current tests, and fresh deployment probes outrank this routing
memory. Re-probe environment state before claiming which resolver mode is live.

## Current operating contract

1. **Legacy-authoritative by default.** `[VERIFIED via
   lib/services/reviewer-identity-runtime.js, 2026-07-22]`
   `REVIEWER_IDENTITY_RESOLVER_MODE` accepts `legacy`, `shadow`, and `combined`.
   Unset or unknown values select legacy. Shadow runs bounded W2 comparisons and
   returns the exact legacy result; only explicit `combined` may adapt W2 into
   the authoritative result, and that cutover remains owner-gated.
2. **Two production W2 seams exist.** `[VERIFIED via
   lib/services/discovery/verification.js and
   lib/services/contact-enrichment/tiers.js, 2026-07-22]` Non-biomedical/PubMed-
   off Track-A verification evaluates candidate batches through the runtime;
   enrichment can reconcile an already-computed server result. Neither exposes
   a client-selectable resolver mode.
3. **The origination redesign is still evaluation-only.** `[VERIFIED via
   scripts/lib/reviewer-holistic-pipelines.mjs and repo-wide import search,
   2026-07-22]` Applicant-recommendation neighborhood seeds exist under
   `scripts/`; no production route or service imports that pipeline. Claude
   remains the origination spine. Reviewer Track B is dormant behind the
   code-level `TRACK_B_ENABLED = false` switch, but its code is not deleted.
4. **Durable identity binding is only partially adopted.** `[VERIFIED via
   lib/services/reviewer-identity-binding-writer.js and import search,
   2026-07-22]` Wave 13 fields and the fail-closed writer exist. The only
   production-service import is `capture-self-reported-orcid.js`, reached by the
   acceptance drain. Writer results remain `downstreamEligible:false`; there is
   no shared action-policy reader or broad writer/backfill migration yet.
5. **Measurement is real but bounded.** `[VERIFIED via active v2 manifest/tests
   and the implementation plan, 2026-07-22]` The 40-case identity benchmark is
   frozen under a single-reviewer protocol; W2 passed its offline gate. The
   60-slot proposal execution and separate 100-candidate scoring pilot are
   complete, while the original 345-candidate evaluation remains unscored.
   These offline artifacts do not establish production acceptance or review-
   completion effects.

## Open work and owner gates

1. **Wave 13 policy migration:** populate/classify legacy rows conservatively;
   expand binding writers/readers; build and shadow a pure action-policy
   projection; then separately gate render/send enforcement. Null legacy rows
   never become eligible by default.
2. **W2 production cutover:** review durable shadow observations before any
   owner-approved `combined` environment change. Shadow logging and migration
   state do not themselves authorize cutover.
3. **Identity follow-ons:** anchor reuse/re-resolution, union-of-anchors dedup,
   and name-comparator consolidation remain planned and require their named
   evaluation/contract gates.
4. **Finding pilot:** the applicant-neighborhood arm needs an explicit owner
   decision and a server-owned, durable request assignment/attribution boundary
   before any controlled production pilot. Offline success is not a cutover.
5. **Cleanup:** do not delete reviewer Track B, legacy identity readers/writers,
   or heuristics until the applicable promotion decision and one complete
   campaign of observation. Re-check live callers immediately before deletion.

## Guardrails

- Identity confidence is not provenance or action eligibility.
- Unknown binding/version/currency fails closed; client identity payloads do
  not establish server authority.
- Preserve partial-batch identifiers, request-generation guards, self-report-
  before-downstream ordering, and the current no-COI-regating posture.
- Do not revive rejected email experiments or external-vendor work without a
  new bounded experiment/owner decision; use the identity/contact plan for the
  current W3 decisions.
- Run `/contract-reconcile` for cross-layer identity or pilot changes and
  `/sweep` for durable fact changes.
