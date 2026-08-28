# Session 466 Prompt: Writeup-Slice Smoke Closed; Quiet-Period Queue Continues

## Session 465 Summary

Session 465 (2026-08-27) closed the top queue commitment — the writeup-slice
signed-in generation smoke — and two small record-keeping items:

1. **Writeup-slice signed-in generation smoke PASSED** (owner-approved,
   Request `1002852`, signed-in production Workbench via Claude-in-Chrome):
   - **Ready-with-warning generation proven live**: a fresh governed
     generation returned Ready with both durable editorial warnings
     (`section_over_target` 720/700 chars; `long_form_over_target` 715/600
     words) and a valid SharePoint Word file with full lineage.
   - **Exact no-duplicate retry proven**: an owner-affirmed second unchanged
     Regenerate left the durable state bit-identical (same
     artifact/run/file/timestamp/version/eTag, no pending row).
   - **Bonus — lost-POST recovery proven live**: the generation POST returned
     a gateway 503 while completing durably; the Workbench recovered Ready
     via bounded status polling without repeating POST.
   - **Hard-failure case SKIPPED by owner decision** (writes a failed AI-run
     row against a real request); remains proven by negative
     service/route tests.
   - Two surprises found and recorded: an **unrecorded owner-run 08-18 v4
     generation** on 1002852, and an **unattributed prompt v5** (sole-current;
     content-identical to the tracked contract per the runtime exact-match
     preflight; owner does not recall publishing it).
   - Evidence + all IDs: `docs/PRE_SITE_VISIT_GENERATION_RESILIENCE_PLAN.md`
     §Status. Reconciled across 12 files (queue row 2, lifecycle plan, schema
     design, file model, near-term execution plan, service catalog, Atlas
     prompt page, strategy-roadmap wiki, project memory).
2. **Phantom co-PI attribution closed as unknown** — owner doesn't know who
   removed the links; recorded in the local incident record; the Owner
   Decision Needed queue is empty.
3. **Process note (for honesty of the record):** the retry proof was briefly
   asserted before the second click actually happened; caught via the tab's
   network log (one POST only), corrected, and the real click + readback
   landed before final docs. Evidence wording in the plan §Status reflects
   exactly what was observed.

### Commits

- `fe2801d9` — Close phantom co-PI attribution question (owner doesn't know)
- `b1e89edc` — Record writeup-slice smoke PASSED; reconcile 12 files
- `85bfa403` — Refine smoke evidence: retry proof basis + 503 lost-POST
  recovery proof

## Next Items

### Verified Open

1. **PD onboarding / posture seeding — before the NEXT solicitation cycle,
   no current deadline.** Evidence:
   `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` rollout checklist;
   `approval_required` freezes once at row creation
   (`grantee-deliverable-reminders-service.js`). If the preference matrix
   ships first, one onboarding pass seeds both (plan §Rollout).
2. **Async PD approval for staff-triggered "sent as me" mail** — the
   remaining unplanned Broader-effort item (inventory #1/#7/#8/#11/#12
   consent axis). Evidence: plan doc Broader effort;
   `docs/OUTBOUND_EMAIL_INVENTORY_2026-08-26.md` cross-cutting finding.
   Plannable; forward-compatible with the matrix.
3. **WAITING on Connor (out until ~2026-09-10): `wmkf_requestdocument`
   staff-role privilege grant** so Workbench document writes attribute to
   the acting staff member instead of the service principal. Brief prepared
   for him (ask + evidence + admin-center steps):
   https://claude.ai/code/artifact/f8877f90-8559-482f-8fbc-ce00e239f947 —
   owner shares it on his return. After the grant, owner re-runs
   `scripts/probe-write-attribution-census.js` (read-only) to confirm new
   rows carry staff names. Context:
   `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md` §Status (S466 census:
   impersonation live in prod, this table is the gap).

### Owner Decision Needed

(None.)

### Parked

1. **Reviewer cron-reminders ledger slice — BUILT, HELD on
   `feature/reviewer-cron-reminders-ledger` until the review cycle ends.**
   Commits `7c29fac7`..`059e51f9`; migration 038 UNAPPLIED everywhere.
   Promotion sequence: (a) owner applies 038, (b) seed PD posture
   (review-all on for all PDs is the safe default), (c) capture-mode local
   smoke, (d) merge, (e) PD onboarding + tutorial. Mid-cycle merge without
   (a) = reminder OUTAGE; without (b) = backlog freezes
   `approval_required=false`. NOTE (S464): the apply→merge window no longer
   emails drift alerts (warning-only), so don't rely on the alert as a
   promotion reminder. Details: SESSION_PROMPT history +
   `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` items 7–10 (branch copy).
2. **Preference-matrix slice BUILD — owner-settled design, blocked by
   ordering invariant.** Evidence: plan doc "Preference-matrix slice"
   section (owner decisions 2026-08-27). Build only after Parked 1 merges;
   both consumers must adopt `effectiveReviewAll` in the same change. Ask
   the owner for UI label wording at build time.
3. **PD tutorial refresh + distribution** — wait until the reminder slice is
   finished/promoted (owner decision S463). Re-open trigger: promotion step
   (e) of Parked 1. Artifact: "Email Autopilot for PDs"
   (https://claude.ai/code/artifact/11586fac-9e0f-4784-833c-58bb4d0e118f).
4. **Post-cycle invitation-link strictness (tighten vs ratify).** Evidence:
   `docs/CURRENT_WORK_QUEUE.md` Audit follow-ups;
   `project-invitation-link-strictness-open-decision.md`. Re-open trigger:
   cycle end. Do not tighten or ratify silently.
5. **Public git history rewrite** — owner-gated destructive step
   (`docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md`); pending scope includes
   the phantom incident record's 08-12→08-27 revisions and the stabilization
   assessment's pre-redaction revisions (added S464). Content remains
   visible in public history until executed.

### Verify Before Acting

1. **Phantom co-PI residuals (CRM-side cleanups)**: the `ab@ab.com` test
   contact on request `1001931`, the corrupted-email duplicate contact pair,
   the 1002788 test-byline trio across five requests, and 18/8 cross-store
   drift rows. Evidence: local `outputs/phantom-copi-incident-2026-08-12.md`
   §Update 2026-08-27. All are prod Dataverse writes — owner confirmation +
   preflight re-probe first; Connor's importer fix remains the only
   recurrence prevention.

### Do Not Reopen Without New Decision

1. **Blanket per-PD review of all automated mail.** Plan doc owner
   decision 10.
2. **Reviewer flags keyed on contact.** S389 + Atlas; person-keying is
   deliberate.
3. **Write-permission asymmetry between flag stores.** Owner decision
   2026-08-26 (route header + plan doc).
4. **Merging the parked slice mid-cycle.** Owner decision S463; hazards in
   Parked 1.
5. **Throwaway smoke-candidate cleanup (Test Homer, Francesco Cisco, Justin
   Test2 on Request `1002788`)** — owner-held S464: the owner removes them
   personally via the app's "Remove entirely" flow. Do not track or
   resurface.
6. **A third "always auto, even for VIPs" preference level.** Owner decision
   S464 (plan doc): two-state per type.
7. **Re-running the 1002852 hard-failure smoke.** Owner decision S465: skip;
   it stays proven by negative service/route tests. Reopen only if the owner
   asks or the failure contract changes.
8. **Optional owner-run Dataverse probe for the two smoke soft spots** (v5
   publish attribution via `wmkf_ai_prompt` modifiedby/createdon; raw
   envelope-v3 readback beyond the app-level status projection). Owner
   decision S466 (2026-08-27): don't pursue. The resilience plan §Status
   caveats remain accurate as recorded; reopen only if attribution ever
   matters or the owner asks.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/PRE_SITE_VISIT_GENERATION_RESILIENCE_PLAN.md` | Canonical smoke evidence (§Status: IDs, v5 discovery, 503 recovery proof, caveats) |
| `docs/CURRENT_WORK_QUEUE.md` | Queue row 2 updated: smoke PASSED; partial-failure recovery + Editor Dashboard remain later |
| `docs/atlas/dataverse-wmkf-ai-run-and-prompt.md` | Prompt v4→v5 history, smoke run IDs |
| `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` | Canonical reminder/preference-matrix plan |
| `outputs/phantom-copi-incident-2026-08-12.md` | LOCAL-ONLY incident record; attribution closed as unknown S465 |
| `lib/services/pre-site-visit/artifact-service.js` | Generation dedup key + runtime prompt exact-match preflight (smoke's verification anchors) |

## Testing

```bash
# Parked-slice suites (run on the branch):
npx jest tests/unit/reviewer-reminder-workflows.test.js \
  tests/unit/reviewer-reminder-sweep.test.js \
  tests/unit/reviewer-manual-reminder.test.js \
  tests/unit/scheduled-email-service.test.js \
  tests/unit/scheduled-email-schema-parity.test.js
# Migration-drift severity split:
npx jest tests/unit/migration-drift.test.js
```
