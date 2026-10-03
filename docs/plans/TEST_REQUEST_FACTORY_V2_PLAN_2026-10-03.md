---
title: Factory v2 recovery and operations proposal
domain: test-request-factory
kind: plan
status: draft
summary: "Plan-only proposal for clearer run recovery and separately gated Factory operations; retain Request 1003308."
canonical: false
owner: product-engineering
related:
  - docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md
  - docs/atlas/postgres-test-request-runs.md
  - docs/audits/OPEN_ITEMS_FOLLOWUP_2026-10-03.md
---

# Factory v2 proposal — October 3, 2026

[VERIFIED via owner instruction] Prepare a separate v2 plan and leave Request
1003308 as a partly built marked test record. This proposal does not authorize
implementation, production promotion, retirement, artifact deletion, or recovery
of that retained record.

## Current contract

[VERIFIED via source] Admin source lookup reads production documents and checks
metadata before and after download plus byte length before saving a source bundle
(`admin-preview-service.js`, `hydrateSelectedDocument`). Confirm reserves an
actor-owned run; each advance calls the shared runner once. Managed Postgres is
the run/receipt authority; Dataverse and SharePoint remain the record/file
authorities. Private Blob holds bundles/manifests. The form uses the `basic`
recipe. Source modules in this paragraph are under `lib/services/test-requests/`.

[VERIFIED via source] `run-ledger.js` claims only prepared/creating/needs_attention
runs by expected version and expired lease, then fences writes with token,
generation, version and expiry. `run-runner.js` reads the reserved Request before
creating; a previous dispatch plus an absent Request refuses a second POST.
`file_journal_unverified` is terminal for the current copy implementation; another
advance cannot make that file verified. There is no generic run abandon/reset
command in `scripts/rehearse-test-request-sandbox.mjs`.

[VERIFIED via source] The CLI has separate status recheck/abandon, status `rerun`,
suggestion binding and reviewer-slot binding. Status abandon closes a dispatched
status-change journal only; it neither abandons the Factory run nor proves that a
Dataverse write did not happen. The slot command requires a separately confirmed
exact Request GUID. Existing CLI commands are prerequisites to inspect, not proof
that exposing them through the admin service is safe.

## Recommended order [PLANNED]

1. **Explain and diagnose a stopped run.** Add a read-only diagnosis showing the
   stopped step, whether a write was attempted, the existing receipt/readback,
   lease state, bundle expiry, and permitted next action. Distinguish “retry reads
   first,” “wait for current attempt,” and “start a new run.” Derive the decision
   server-side from the actual runner guards; unknown combinations stay blocked.
   Keep the existing retry semantics. No new recovery writer or schema is needed
   for this first slice, subject to implementation-time payload/privacy review.
2. **Expose existing status recheck and status-change closure carefully.** Recheck
   already exists in the form. Make its result clearer and, separately, consider
   the CLI's dispatched-change closure as an explicit admin operation. Require
   current actor ownership, exact change ID, current state, and evidence no
   dispatcher is still running; expiry of the run lease alone is not that proof.
   Keep compare-and-set closure and never resend the old PATCH. If that evidence
   cannot be established in the web process, retain the owner-run CLI boundary.
3. **Classify readback-only file recovery before designing a writer.** Investigate
   whether a journaled destination item can be verified against the original
   pinned manifest, bundle and allowed package transformation without uploading
   again. Missing provenance, expired/missing bundle, changed copy policy,
   ambiguous item identity or failed comparison must remain blocked. A successful
   readback would need its own fenced receipt transition and consumer coverage;
   it must not reset the step or manufacture a verified receipt. Feasibility is
   unproven. Do not use 1003308 as a mutation rehearsal.
4. **Separate “stop work” from retirement.** If an operator needs to hide/close a
   stuck run, first decide whether that means a display disposition or a new
   terminal run state. Recommend retaining all evidence initially. Do not reuse
   `retired` to mean “abandoned,” because readers and artifact cleanup could
   interpret it differently. Inventory all status readers, SQL constraints,
   receipt rules, schema fingerprints and sweep behavior before a migration.
5. **Additional operations, one small release each.** Consider status `rerun`,
   suggested-reviewer binding, then reviewer-slot PATCH, in that order. Each needs
   its own target/effect preview, current authority check and independent
   confirmation. Preserve the distinction between suggestion creation and the
   slot write. Status rerun must explain possible repeated payment/tracking
   effects. Retirement/deletion remains a separate future proposal.

## Contract and acceptance requirements

| Surface | Required behavior | Evidence before promotion |
|---|---|---|
| UI → route | Superuser and actor ownership; exact run/change/target; stale selection cannot update a newly selected run | Route denial tests; delayed-response and changed-selection UI tests |
| Route → runner | Server re-reads authority and derives permitted actions; no client force/reset bypass | Negative tests for forged identity, stale version and unknown state |
| Runner → ledger | Existing lease/CAS fences; journal before side effect; no second dispatch | Concurrent attempts, expired lease and response-loss tests against Postgres |
| Ledger → Dataverse/SharePoint | Exact owned target; readback does not resend a create or upload | Realistic duplicate/late/missing-target fixtures and bounded rehearsal |
| Ledger → UI/sweep | Every new disposition handled explicitly; retained artifacts remain retained | Full status-reader census; sweep regression tests; no blanket deletion branch |
| Docs/schema | Additive managed-ledger migration if needed, matching fresh shape, fingerprint, Atlas, route matrix and runbook | Relevant gates and self-tests, sequentially |

[PLANNED] Start with slice 1. Its implementation is the smallest useful v2
increment. Slices 3–4 need a reviewed design after feasibility/semantics are
settled. No new migration, route, prompt, environment setting or recovery
operation has been provisioned by this plan. Existing actor isolation remains;
a cross-admin operations console would be a separate access decision.

## Review limits and disconfirming checks

- Checked the CLI dispatch list to falsify the claim that a generic run-abandon
  command already exists; only the narrower status-change command was found.
- Checked the create dispatch marker to falsify “retry can safely POST again”; it
  explicitly refuses. Any v2 design allowing that needs rework.
- Checked ledger claim/update predicates to falsify “expired lease lets an old
  worker finish”; later writes remain token/generation/version fenced.
- Recovery feasibility, a web-safe proof that a status dispatcher has stopped,
  and new terminal-state retention semantics remain UNKNOWN. This is a scoped
  proposal, not a READY TO IMPLEMENT verdict for all five slices.
