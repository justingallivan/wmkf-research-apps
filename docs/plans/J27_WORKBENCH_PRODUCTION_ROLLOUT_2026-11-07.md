---
title: J27 Workbench Production Rollout and Rollback
domain: workbench
kind: plan
status: planned
summary: Rehearsal evidence, a default-off J27 production cohort, additive Dataverse preparation, and rollback steps for the Workbench redesign.
cataloged: 2026-11-07
owner: product-engineering
related:
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/plans/J27_WORKBENCH_DEVELOPMENT_BRIEF_2026-11-06.md
  - docs/atlas/dataverse-akoya-request.md
---

# J27 Workbench production rollout and rollback

**[PLANNED]** Prepare the production path behind an off switch, then seek a separate owner decision for any production schema apply, merge to `main`, or activation. Treat this as Tier 2 under the campaign release strategy. The branch and the current Preview are the review candidate. This plan authorizes no production changes.

## Evidence at preparation

| Surface | Evidence | Release implication |
|---|---|---|
| Code and deployment | **[VERIFIED 2026-11-07 via git and Vercel inspect]** `codex/j27-workbench-reports` at `84199d437` is based on remote `main` at `53066edc1`. The sandbox Preview alias serves `dpl_9DensD9svL55mH3b1bnXBvquJhP6`. The production hostname currently serves `dpl_8xoqHAWhtJUmgKVNwbTb4rzccjmg`. | Record the signed-in last-known-good deployment again just before release. Today’s deployment ID is evidence, not a standing rollback target. |
| Staff workflows | **[VERIFIED via signed-in Preview]** On #1000369, opened the proposal PDF, saved and reopened the rationale, saved First Cut by selection, and verified the review summary, manual attendance, visit assessment, and Overview link into Final Assessment. On #1000370, two reports and a saved summary led Overview back to Reports with no presentation. | Rehearsed in sandbox. Re-run both on the final release candidate and record ordinary staff access separately from superuser access. |
| Word | **[VERIFIED via signed-in Preview and owner readback]** On #1000369, the authorized link opened the synthetic draft in Word for the web before group review. Reloading Final Assessment showed the pre-review state. | Keep the existing draft visibility rules and Word workflow. Retest that opening the link does not transition review or send email. |
| Production fields | **[VERIFIED via read-only Dataverse metadata]** The five fields below matched the sandbox specs by type and length. A production metadata query for those five logical names returned none. | Provision and verify them before admission. Do not assume sandbox data or permissions transfer. |
| Current admission | **[VERIFIED via source]** The phase layout and new field routes are sandbox-gated. The visit route shares the summary gate. Rationale and roster have additional readiness switches. The shared First Cut control autosaves in J27 even under the legacy layout, and the shared Final Writeup component can show the new draft link outside J27 if this branch is merged as-is. | A merge alone would neither enable the J27 layout nor fully isolate visible changes. Gate the two shared UI changes as well as the layout and APIs before release. |

Source checks: [Workbench shell](../../pages/workbench/%5BrequestId%5D.js), [summary admission and save](../../lib/services/workbench/staff-review-summary-service.js), [rationale readiness](../../lib/utils/initial-assessment-rationale-readiness.js), [roster readiness](../../lib/utils/meeting-roster-readiness.js), [Word draft visibility](../../lib/services/final-writeup/transition-state.js), [First Cut control](../../shared/components/workbench/FirstCutCard.js), and [Final Writeup UI](../../shared/components/workbench/FinalWriteupTab.js).

## Admission to implement

**[PLANNED]** Use a single server policy shared by the request context and all four new Workbench field endpoints. The production branch of the policy requires a production deployment, the registered production Dataverse target, the proposed `J27_WORKBENCH_PRODUCTION_SCHEMA_READY` switch set to literal `on`, and a fresh, authoritative linked Grant Cycle code of `J27`. The existing isolated sandbox admission remains available for rehearsal. Other deployment and target pairings cannot qualify for the production branch.

Use a dedicated, non-secret Dataverse application setting such as `workbench.j27_rollout` for the cohort. Reuse the existing strict setting read and revision-checked write contract. The operator write path is a prerequisite to build and rehearse, with a superuser-only, single-key allowlist and an auditable actor. Store the setting as a JSON object and accept exactly these forms.

| Setting | Admission |
|---|---|
| `{"mode":"off"}` | Existing UI. New field GET and POST routes deny access before selecting the new columns or attempting a write. |
| `{"mode":"pilot","requestIds":[...]}` with a nonempty list of valid request GUIDs | Only the named requests whose linked cycle is J27. All Workbench staff authorized for the request can use the new staff fields. |
| `{"mode":"on"}` | All requests whose linked cycle is J27. |

A missing, invalid, unreadable, or timed-out setting resolves to off. Keep the read bounded and avoid a cross-request cache for the setting used to authorize writes. Return only the effective admission in request context. Resolve it again on each direct GET or POST. A client tab, a query parameter, a cached page, or an apparent request number cannot authorize entry. Preserve the existing authenticated staff checks, session-derived Dataverse actor, impersonation with no fallback on new saves, and the request ETag. The rollout setting should be rechecked before issuing the conditional write. A write already dispatched at disable time can still complete and must be accounted for in rollback.

Apply the same effective admission to the five-phase layout, Overview, Reports summary, Deliberations fields, and Final Assessment handoffs. Preserve the existing First Cut explicit-save UI when admission is off. Keep existing Word actions in other cycles and gate only the added pre-review draft link. The new link must respect the server-projected draft visibility. A user may be able to open an authorized draft without being allowed to start group review. Preserve old bookmarks and access gates. On disable, verify that new phase bookmarks have a safe landing and that the legacy sections remain reachable.

**[PLANNED]** Manual attendance is the release path. Gate Zoom suggestions separately and leave the production suggestion branch off, including the direct `suggest=yes` GET. Show manual entry and confirmation without a Zoom action. Verify that no Zoom request is issued when a client asks for suggestions directly. Keep the formal offramp outcome and any new status mapping out of this release. Overview continues to distinguish the recorded Dataverse status from a suggested next step. Keep the parked Semi-finalist status changes separate. Existing First Cut still writes only Scored or Not Scored, subject to the existing lead PD or superuser rule. Before enabling autosave in production, verify the exact choices against live Dataverse and check workflows on those values. The new prose and roster saves must not trigger unrelated flows or email.

## Production schema preparation

**[PLANNED]** Add optional fields to `akoya_request` using the reviewed schema waves. There is no new data backfill, data copying from rehearsal, or retirement of the existing Word assessment in this release.

| Wave | Field | Type and limit |
|---|---|---|
| 37 | `wmkf_staffreviewsummary` | Memo, 10,000 characters |
| 37 | `wmkf_staffreviewevidencehash` | String, 64 characters |
| 38 | `wmkf_staffvisitassessment` | Memo, 10,000 characters |
| 39 | `wmkf_confirmedmeetingroster` | Memo, 100,000 characters on Request |
| 40 | `wmkf_initialassessmentrationale` | Memo, 10,000 characters |

After separate approval, dry-run each wave with the exact production target and compare metadata before applying. The operator must use the production target guard, explicit `--target=prod --execute`, and the approved same-UTC-day production write acknowledgement. Apply waves 37 through 40 in order. If publishing is needed for the runtime read, publish only the Request entity through the approved Dataverse procedure after checking pending customizations on it. Verify exact metadata and select all five fields in a real read before marking the schema ready. Keep access off during schema work. Wave 39 targets the Request row. The unused sandbox-only Site Visit memo is outside the production rollout.

Dry-run form, to run when preparing the separately approved schema change:

```bash
for wave in 37-j27-staff-review-summary 38-j27-staff-visit-assessment \
  39-j27-meeting-roster 40-j27-initial-assessment-rationale; do
  DATAVERSE_TARGET_INTERLOCK=on DATAVERSE_ALLOW_PROD_READS=yes \
    node scripts/apply-dataverse-schema.js --target=prod --wave="$wave" || exit
done
```

## Postgres preparation

**[PLANNED; added 2026-11-10]** Apply migration `096_j27_integrity_jobs.sql` to the Production database with `node scripts/apply-migrations.js` before the J27 code serves there. The J27 read model reads the latest Integrity Screen for every J27 Research row through a query that joins `j27_integrity_jobs`, whether or not the automatic screen is switched on. Without the table that read fails and every J27 row shows "Some details could not be read." [VERIFIED via a throwaway local Postgres, 2026-11-10; read-model plan section 11]. The Production database does not have the table: an owner-run `apply-migrations.js` pass from the main checkout on 2026-11-10 skipped 002 through 095 and applied nothing, and the main checkout has no 096. The table is additive and empty until the automatic screen is enabled.

**Sandbox Preview database (2026-11-10).** Until this date the `claude/j27-read-model` Preview used the shared Production database, so it read (and wrote) Production Postgres and lacked the J27 table. The owner created a Neon branch `j27-preview` of the Production database (project `expert-reviewers-neon-db`, branched from `main` with data, auto-delete Never), scoped `POSTGRES_URL` and `DATABASE_URL` to Preview for the git branch `claude/j27-read-model`, and applied 096 there (`1 applied, 94 skipped, 95 total`). The branch is a copy of Production data taken at that moment; treat its connection string as a Production secret. **Remove the Neon branch and the two branch-scoped variables when the J27 line is promoted or retired**, together with the branch-scoped sandbox `DYNAMICS_URL`.

The memo fields above stay switched off in Production after waves 37 through 40 are applied: each readiness helper also requires a non-production deployment (`lib/utils/initial-assessment-rationale-readiness.js`, `lib/utils/meeting-roster-readiness.js`, `staffReviewSummaryEnabled`). Enabling them in Production is a separate code change. Until then those facts read "not provisioned" and do not mark a row.

## Verification and staged release

1. **Build the admission changes on the development branch.** Recheck remote main and the final diff. Require type checks, focused Workbench and legacy regressions, route/DAL and reviewer boundary checks, and production admission tests. Test both deployment/target pairs, J27 and older/unlinked cycles, off, invalid setting, unavailable settings read, pilot allowed and denied IDs, and on. Hit the four GET/POST routes directly. Off, wrong cycle, wrong target, missing staff access, unmapped actor, or stale versions must fail as applicable. Populate the denied fixtures with data so the test proves exclusion. Test a stale open page across a switch to off.
2. **Rehearse the final release candidate in sandbox Preview.** Keep the Dataverse target interlock and DAL enforcement on. Confirm #1000369 can save and reopen rationale, First Cut, review summary and visit assessment, confirm attendance manually, and open the authorized Word draft before group review. Confirm #1000370 still goes to Reports and carries no formal outcome. Compare a non-J27 request with the existing UI and exercise legacy bookmarks, including the existing Word path. Test an ordinary staff viewer and an authorized editor, the existing First Cut owner rule, and a viewer without draft access. Rehearse settings off → pilot → off, including the legacy path and API denials. Use mock or sandbox tests for external reviewer and email behavior touched by the integration. Record remaining scenarios explicitly.
3. **Prepare the production change record.** Record the exact candidate commit/deployment, auth hostname, approved J27 pilot request GUIDs, owner, operator and backup operator, production schema readback, verified last-known-good production deployment, observation window, rollback controls, and stop conditions. Verify literal `DATAVERSE_TARGET_INTERLOCK=on`, `DATAVERSE_DAL_ENFORCEMENT=on`, `DYNAMICS_IMPERSONATION_ENABLED=true`, and the existing Word readiness state. Check the campaign calendar and obtain the owner’s explicit approval for the window. The merge to `main` is a production deploy action.
4. **Release with admission off, after approval.** Confirm signed-in access and baseline behavior in production with reads only. Verify a J27 request and an older-cycle request still open the existing layout, and verify the new routes deny even when invoked directly. Reconcile any differences before enabling.
5. **Admit the named pilot, after a separate go decision.** Use a small set of approved J27 request GUIDs. Compare a pilot request, a J27 request outside the pilot, and a non-J27 request. Confirm only the first receives the new layout. Check Overview direction, Word link visibility, and the manual roster for staff with normal access. Ordinary staff work in the pilot is the first legitimate production write. Any artificial production write rehearsal needs its own approved dedicated test record and side-effect controls. Check save/readback, actor attribution, route failure rates, timeouts and conflicts, and any unexpected mail or jobs. Review results with the owner before expanding to all linked J27 requests. Retain the old path through the campaign.

**Stop and restore the old path** for any wrong-cycle or wrong-request exposure, save without correct attribution, loss of an existing workflow, misdirected or inaccessible Word drafts for authorized staff, unexplained errors on save or reload, or unintended email, Zoom, status, or background activity. Record expected stale-edit conflicts separately from unexpected failures.

## Rollback

1. **Set the rollout setting to `{"mode":"off"}`.** The release operator uses the authorized settings control and records its revision and time. Reload a pilot J27 request, an older-cycle request, and a former new phase bookmark. Verify the legacy UI, a working existing staff read path, and denial of the four new endpoints. Check that an open editor cannot begin another new-field save after disable.
2. **If off does not restore service, restore the pinned known-good production deployment.** Use the existing Vercel production rollback procedure with the exact deployment recorded immediately before release, and verify the production domain points to it. Recheck sign-in, Workbench, and existing document/reviewer links. Keep the rollout setting off before any subsequent deployment. If rollback is due to an unintended downstream action, stop the specific job or send path with its existing operator control and notify the owner.
3. **Reconcile data separately.** Keep the additive fields and all saved staff work. Review the pilot request audit trail for saves already dispatched, identify any partial or unexpected writes, and assign repair to the owner. Never bulk revert request statuses, remove fields, or delete Word files as part of code rollback. Record the intended old UI’s lack of access to the new saved text and how staff can retrieve it through an authorized Dataverse read if needed. Re-enable only after the fault is fixed and the rollback and regression checks pass again.

The formal offramp outcome remains an open decision. Zoom attendance suggestions remain a separate rehearsal and release decision.
