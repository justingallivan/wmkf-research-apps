# C0.4 reviewer send-eligibility audit — 2026-07-14

**Mode:** read-only contract review  
**Branch:** `codex/m1-evaluation-foundation`  
**Runtime changes:** none  
**Verdict:** **NEEDS REWORK before runtime implementation**

## Surface

- **Change surface:** enforce current durable identity and proposal-COI currency
  before reviewer email or token actions.
- **Entry points:** `InviteEmailModal`, `ReviewerManagePanel`,
  `POST /api/review-manager/render-emails`, and
  `POST /api/review-manager/send-emails`.
- **Persistence:** reads `wmkf_potentialreviewers`,
  `wmkf_appreviewersuggestion`, and `akoya_request`; render may replace the
  external-token hash; send may create/send a Dynamics email, promote a contact,
  back-propagate ORCID, stamp suggestion lifecycle, and seed request campaign
  settings.
- **Consumers:** external reviewers, both staff email modals, suggestion
  lifecycle readers, reminder jobs, contact/honorarium follow-up, and audit/docs.
- **Prior finding:** C0.4 in
  `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` requires stale or
  invalidated identity state to be non-actionable at send.

## Findings

1. **BLOCKER — The send path cannot observe durable current-state eligibility.**

   Evidence: `send-emails-service.js:195-216` re-reads the person immediately
   before send, but its person projection ends at legacy
   `wmkf_identitystatus`/`wmkf_emailsource`; it does not load the Wave 13
   binding tuple or derived version. `reviewer-suggestion.findById` uses the
   primary projection in `entity-registry.js:101-177`, which contains none of
   the four Wave 13 identity-COI fields. A raw-symbol census found no runtime
   reader for those four suggestion fields.

   Reasoning: the service cannot distinguish current, stale, invalidated,
   malformed, or proposal-context-mismatched identity state. Adding a branch
   without first adding the authoritative projections and policy contract would
   be assertion-only safety.

2. **BLOCKER — The durable fields are not populated broadly enough to enforce
   fail-closed behavior.**

   Evidence: the explicit-target read-only command
   `node scripts/preflight-reviewer-identity-binding-fields.mjs --target=prod
   --include-population` reported 0 absent / 10 exact / 0 divergent, but only
   **1** potential-reviewer row and **0** suggestion rows with any Wave 13 field
   populated on 2026-07-14.

   Reasoning: treating null as ineligible today would block essentially all
   reviewer outreach. Treating null as eligible would preserve the exact legacy
   hole C0.4 is intended to close. Enforcement therefore depends on an explicit
   classification/population and shadow-verification phase; it is not a
   standalone send-service patch.

3. **BLOCKER — Legacy email confidence is not an identity-action policy.**

   Evidence: `reviewer-invite.js:94-112` classifies ORCID, PubMed, and
   institution-page email sources as high regardless of legacy identity status;
   `reviewer-invite.test.js:69-85` intentionally freezes that behavior. For
   invitations, `send-emails-service.js:399-417` lets staff acknowledge a low
   confidence address by suggestion id and continue. Neither path checks durable
   binding generation, lineage currency, or proposal COI currency.

   Reasoning: the staff checkbox may override address-confidence uncertainty;
   it must never override an invalid/stale person binding or stale/conflicting
   proposal COI. `emailConfidence` should remain a separate address-provenance
   helper rather than being silently redefined as the action gate.

4. **HIGH — Render mutates token state before the send boundary.**

   Evidence: `render-emails-service.js:137-163` mints and stores a replacement
   external token whenever the template references the external link. The
   render projection at `:74-90` also lacks all durable binding/COI fields.

   Reasoning: placing C0.4 only immediately before Dynamics dispatch still
   allows an ineligible preview to rotate durable token state and invalidate a
   previously copied link. The same policy must guard token minting, or token
   minting must move behind an eligible send operation. The send service must
   still re-read and re-check after preview because the state can change between
   the two requests.

5. **HIGH — The post-engagement exemption is an unenforced assumption.**

   Evidence: `send-emails-service.js:376-397` exempts materials, follow-up, and
   thank-you mail from the invitation confidence gate; only `materials` checks
   `wmkf_accepted === true`. The authenticated route is staff-shared
   (`send-emails.js:54-93`) and accepts any known template type. No server guard
   proves engagement for follow-up or thank-you, and none checks the current
   binding for any post-engagement template.

   Reasoning: UI placement is not an action-policy precondition. Any legitimate
   post-engagement exception must be expressed as a server-derived allowlist
   with a durable signal and must still define what happens after an identity
   correction.

6. **MEDIUM — Existing result shapes can carry an eligibility skip, but one UI
   mislabels every skip as “no email.”**

   Evidence: `send-emails-service.js:760-777` returns per-recipient `sent`,
   `failed`, `skipped`, and `unconfirmed` arrays with exact counts. The invite
   modal renders the server reason (`InviteEmailModal.js:658-664`), while
   `ReviewerManagePanel.js:980-985` hard-codes every skipped row as “no email.”

   Required change: introduce an explicit `identity_ineligible` reason (with a
   non-sensitive reason code) and render it honestly in both modals. An all-skip
   result must not be presented as a successful send.

## Whole-flow trace

| Hop | Current behavior | C0.4 requirement |
|---|---|---|
| UI selection | Invite and Manage modals select suggestion ids | Advisory only; never establish eligibility |
| Preview request | Authenticated JSON request with ids/template | Load authoritative action-policy fields |
| Preview service | Reads legacy identity; may mint token | Refuse/skip ineligible token mint; return reason |
| Send request | Draft text plus suggestion ids; invite may carry low-address acknowledgements | Acknowledgement may affect address confidence only |
| Route | POST, `requireAppAccess`, rate limit, trusted DAL context | Existing boundary is sufficient |
| Send service | Fresh Dataverse reads, legacy confidence gate, per-row send | Recompute durable policy immediately before every external action |
| Side effects | Email, contact promotion, ORCID back-prop, lifecycle, campaign config | No side effect for an ineligible row |
| SSE/UI | Per-row result arrays | Preserve exact ids and display the real skip reason |
| Docs/tests | Legacy gates and projections | Add policy, projection, complement, and UI coverage |

## Seven-audit result

1. **Whole-flow:** traced above. Render-time token mutation is part of the
   action boundary and cannot be omitted.
2. **Partial success:** the existing per-recipient arrays are suitable. The
   eligibility decision must be per row; eligible siblings may continue while
   ineligible rows remain explicit and retryable after correction.
3. **Async/stale state:** preview and send are separate requests. A preview-time
   decision cannot authorize a later send; send must re-read. Policy evaluation
   must occur before token/email/contact/lifecycle writes.
4. **Helper semantics:** keep address confidence, attachment eligibility,
   engagement stage, person-binding currency, and proposal-COI currency as
   distinct inputs. Do not collapse them into `wmkf_identitystatus`.
5. **Durable surfaces:** no new database field is required. Existing Wave 13
   fields require writers/population, projections, Atlas updates, and shadow
   evidence before they can become authoritative.
6. **Doc reconciliation:** this audit, the implementation plan, both affected
   Atlas pages, and reviewer-holistic memory are reconciled in this branch.
7. **Symbol fan-out:** the raw Wave 13 field census confirms the person fields
   are read only by the narrow writer/smoke paths and the suggestion fields have
   no runtime reader/writer. Send/render projections are therefore known gaps,
   not hidden consumers.

## Implementation-ready staged scope

### Stage A — inert contract and characterization tests — BUILT 2026-07-14

- Added a pure `reviewer-action-policy` helper with the closed result set
  `eligible | legacy_unclassified | binding_invalid | derived_stale |
  coi_unknown | coi_conflict | coi_stale`.
- Unknown/malformed values take a named ineligible path. No client field can
  manufacture an eligible result.
- `emailConfidence` remains unchanged and outside the helper.
- Added specialized read-only projections for both person and suggestion; the
  suggestion projection preserves the applicant-excluded refusal.
- The helper and both projections have no runtime caller. Render and send remain
  unchanged.

### Stage B — population and shadow proof

- Implement/activate the missing binding and proposal-COI writers under their
  existing owner gates.
- Classify legacy rows explicitly; never infer human attestation from
  `wmkf_identitystatus=confirmed`.
- Run read-only/shadow evaluation and report exact eligible/ineligible reason
  counts. Unknown/read-error cases remain ineligible in the proposed policy.
- Do not activate blocking while nearly all rows remain null.

### Stage C — owner-gated enforcement

- Apply the pure policy before render token minting and re-apply it from fresh
  reads immediately before send.
- Put `identity_ineligible` rows in `skipped` before any external or persistence
  side effect; do not honor `confirmedLowConfidenceIds` for them.
- Define explicit server-side stage rules for invitation, materials, follow-up,
  and thank-you. No fall-through template behavior.
- Update both UIs to show the policy reason and distinguish an all-skipped run
  from a successful send.

## Test matrix for the implementation branch

| Layer | Required test |
|---|---|
| Pure policy | complete/current tuple + current clear COI is eligible |
| Pure policy | null, malformed, unknown source, missing anchor, or version mismatch is ineligible |
| Pure policy | `coi_conflict`, `coi_unknown`, missing hash, and binding-version mismatch are ineligible |
| Pure policy | low-address acknowledgement cannot change an identity-ineligible result |
| Projection | specialized reads fetch every required raw Wave 13 field and preserve excluded-row refusal |
| Render service | a fully populated stale fixture is present; no token mint occurs and the row is skipped |
| Render service | mixed eligible/stale rows mint only for the eligible row |
| Send service | stale fixture has a sendable email and dangerous attachments; no email, contact, ORCID, lifecycle, or campaign write occurs |
| Send service | mixed batch sends eligible ids only and reports exact skipped ids/counts |
| Send service | read failure and unknown policy result fail closed before dispatch |
| Send service | capture mode applies the identical gate and does not stamp skipped rows |
| Route | auth/DAL/SSE contract preserves per-row policy reason without accepting client eligibility |
| Invite UI | `identity_ineligible` cannot be overridden by the low-confidence checkbox |
| Manage UI | identity skip is labeled correctly; zero-sent/all-skipped is not shown as success |
| Complement | every known template has an explicit stage rule; unknown template remains rejected |

## Final verdict

**NEEDS REWORK FOR RUNTIME ENFORCEMENT.** The inert Stage A contract,
specialized projections, and characterization tests are built, but C0.4 runtime
enforcement is not ready as a standalone send patch. Remaining named changes
are binding/COI population plus shadow proof, render-time token gating, explicit
post-engagement semantics, and honest UI handling. No production behavior was
changed by the audit or Stage A foundation.
