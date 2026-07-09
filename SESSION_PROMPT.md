# Session 351 Prompt: Whack-a-mole remediation workstreams, or quota-PD-email build

## Session 350 Summary

Recovered two design docs from a work-computer branch, reconciled both against the
live codebase (one shipped, one verified-not-built), then designed, adversarially
reviewed (3 Codex passes), built, and prod-provisioned **grantee publication-waiver
versioning** end-to-end.

### What Was Completed

1. **Recovered spec-audit design docs + reconciled** (`1420d79c`, `3dfdc76d`, `6baa8d01`,
   `edf9c2f5`). Owner cherry-picked `REVIEWER_ACCEPT_FAST_RESPONSE_DESIGN.md` +
   `REVIEWER_QUOTA_PD_EMAIL_PLAN.md` to main. Verified against source:
   - **accept-fast-response = SHIPPED** (the `reviewer_acceptance_jobs` queue + drain;
     built with the stricter insert-before-PATCH variant). Design doc reconciled to shipped.
   - **quota-PD-email = NOT built** (owner was right). Reconciled the plan to the current
     codebase (quota moved into the drain; campaign-config moved route→service). Build-ready.

2. **SHIPPED: grantee publication-waiver versioning** (stages A–E: `9b327651`, `ec46676e`,
   `e0cbbb56`, `ebbe0e4c`, `8b70fadd`, `552a8574`, `f5fc6cc0`, `9e6547a3`). The waiver is now a
   versioned `grantee-waiver` policy (same machinery + admin Policies section as reviewer
   COI/AI-use); the acknowledged version+timestamp+body-hash persist on the
   `wmkf_granteedeliverable` row. Records "what the grantee saw" via a signed render token;
   atomic Dataverse changeset write (per-op If-Match) with cross-store SharePoint recovery;
   fail-closed. **Schema wave12 applied to prod + slot seeded + probe green (2026-07-09).**
   Full suite 5225 green; 3 adversarial Codex passes cleared. Plan:
   `docs/GRANTEE_WAIVER_VERSIONING_PLAN.md`; memory: `project-grantee-waiver-versioning.md`.

### Commits (12, all on main; PUSH pending at handoff time)
- `9e6547a3` docs(grantee-waiver): mark prod Dataverse provisioning DONE
- `552a8574` feat(grantee-waiver): stage E — persist acknowledged waiver body hash (Codex pass-3)
- `f5fc6cc0` docs(grantee-waiver): mark plan IMPLEMENTED-in-code + recheck artifact refs
- `8b70fadd` test(grantee-waiver): update admin-policies integration for the 3rd slot
- `ebbe0e4c` docs(grantee-waiver): stage D — reconcile spec/matrix/atlas
- `e0cbbb56` feat(grantee-waiver): stage C — submit verification + atomic changeset
- `ec46676e` feat(grantee-waiver): stage B — render token + context + form wiring
- `9b327651` feat(grantee-waiver): stage A — schema + seed + probe + admin slot
- `edf9c2f5` docs(reviewer): reconcile quota-PD-email plan to current codebase
- `6baa8d01` docs(memory): record quota-PD-email plan verified NOT built
- `3dfdc76d` docs(reviewer): reconcile accept-fast-response design to shipped
- `1420d79c` Add reviewer accept-fast-response + quota PD-email design docs (owner cherry-pick)

## Next Items

### Verified Open

1. **Confirm the grantee-waiver code is deployed to prod.** Evidence:
   `project-grantee-waiver-versioning.md`; schema+slot already live (probe green). The only
   remaining step is the `main` code deploy. If `main` auto-deploys to prod, this is DONE —
   just verify. Until deployed, the portal edit view still renders the old hardcoded constant
   (harmless; the versioned path activates on deploy).

2. **Whack-a-mole remediation workstreams.** Evidence: `docs/WHACK_A_MOLE_REMEDIATION_PLAN.md`
   (8 code-verified workstreams from the Fable meta-review, committed `ec43426b`). NOTE: the
   meta-review itself is DONE (S349, `a902c3dd`) — do NOT re-dispatch it. Candidate first fixes:
   carryover-freshness gate, code-level nomenclature rename, Akoya cycle-code fail-loud. Each is
   a recommendation — verify blast radius before building (see Verify Before Acting).

3. **Build the quota-PD-email feature** (now reconciled + build-ready, S350). Evidence:
   `docs/REVIEWER_QUOTA_PD_EMAIL_PLAN.md` (drift note dated 2026-07-09). UI-only Change #1
   (`CampaignConfigModal` desiredCount input — backend already accepts it) + Change #2
   (`reviewer-quota.js`: add `emailAdmins:true`, drop `category`). Small, well-scoped.

4. **Build the staff "manual review rescue" tool.** (Carried from S347/S348, not started.)
   Evidence: `project-staff-review-rescue-tool.md`. Mirror `ReviewAuthoringForm`, route through
   `lib/external/build-review-submission.js`. Backends exist. **Blocked on placement decision.**

### Owner Decision Needed

1. **Green-light the reviewer holistic redesign branch build?** Evidence:
   `project-reviewer-holistic-redesign-parallel-build.md`; `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md`.
   PARKED pending explicit go. The `confirmed`-sentinel downgrade is now P0/P1 of that plan.
2. **Staff rescue tool placement.** Admin/superuser page vs. Reviews tab — decide before Verified Open #4.
3. **Reviewer closeout-payability design.** Evidence: `project-reviewer-closeout-payability.md` (S343).
4. **How far to push the TS `check:types` gate.** Evidence: `docs/TYPESCRIPT_OPTION_ASSESSMENT.md`.

### Parked

1. Reviewer holistic redesign branch build (owner go pending — Owner Decision #1).
2. "No longer needed" stand-down flow for ACCEPTED reviewers (S347; `withdraw-sufficient` only targets invited-pending).
3. Product/UX asks: review-output formatting (`project-review-output-formatting.md`), campaign-settings UX (`project-campaign-settings-ux-revisit.md`).
4. Project-wide prompt-cache-hit audit (`project-cache-hit-rate-review.md`).
5. Dependabot #53 merge once real tests green (`gh pr checks 53`).

### Verify Before Acting

1. **Whack-a-mole workstreams are recommendations, not confirmed worklists.** Before building each:
   nomenclature rename → grep live route/authz usage to scope blast radius; carryover gate → confirm
   no existing guard covers it; cycle-code → read `akoya-temporal-axis-encodings.md` for the exact
   silent-drop shape. Follow `docs/WHACK_A_MOLE_REMEDIATION_PLAN.md` ordering.

### Do Not Reopen Without New Decision

1. **Grantee publication waiver is VERSIONED + SHIPPED (S350).** Evidence:
   `project-grantee-waiver-versioning.md`; `docs/GRANTEE_WAIVER_VERSIONING_PLAN.md`. Schema (wave12)
   applied to prod, `grantee-waiver` slot seeded + active. This REVERSES the old
   `GRANTEE_PORTAL_SPEC` "no consent fields persisted" decision — do NOT restore the hardcoded-only
   waiver. Staff edit the text in admin → Policies. Consent recorded on `wmkf_granteedeliverable`
   (`wmkf_WaiverPolicyVersion`/`wmkf_waiverackedat`/`wmkf_waiverbodyhash`).
2. **accept-fast-response is SHIPPED; quota-PD-email is NOT built (both verified S350).** Evidence:
   `project-spec-audit-docs-recovery-parked.md` (now `closed`). Don't re-verify; don't "rebuild"
   the accept drain.
3. **spec-audit docs recovered to main (`1420d79c`) — recovery is closed.** Do NOT re-search the
   work computer or push `370f3867`.
4. **Whack-a-mole meta-review is DONE (S349).** Evidence: `a902c3dd`, `ec43426b`,
   `docs/WHACK_A_MOLE_REMEDIATION_PLAN.md`. Don't re-run the Fable meta-review; execute the plan.
5. **Decline-referral SHIPPED (S349); `ReviewFormFields.js` deleted (S347); DynamicsService
   decomposition (S345) / peer-review Executor migration (S344) / 4 PDF-app sunset (S344) COMPLETE.**
   Don't revert or re-inline.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/GRANTEE_WAIVER_VERSIONING_PLAN.md` | Grantee-waiver plan-of-record (as-built; 3 Codex passes logged) |
| `lib/external/grantee-waiver-policy.js` | Fail-closed waiver resolver + reason classification |
| `lib/services/external-token.js` | `mintWaiverRenderToken`/`verifyWaiverRenderToken` (render token) |
| `lib/services/grantee-upload.js` | Atomic changeset write + cross-store SharePoint recovery |
| `lib/dataverse/schema/wave12-grantee-waiver-consent/` | Waiver consent columns + lookup (applied to prod) |
| `scripts/seed-grantee-waiver-policy.mjs` / `scripts/probe-grantee-waiver-slot.mjs` | Seed + rollout-gate probe |
| `docs/WHACK_A_MOLE_REMEDIATION_PLAN.md` | 8 remediation workstreams (Verified Open #2) |
| `docs/REVIEWER_QUOTA_PD_EMAIL_PLAN.md` | Reconciled, build-ready quota-PD-email plan (Verified Open #3) |

## Testing

```bash
npm run lint && npm run check:types
npm test                                   # full suite (5225 at S350)
node scripts/probe-grantee-waiver-slot.mjs # re-confirm the grantee-waiver slot resolves in prod
```
