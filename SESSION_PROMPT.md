# Session 479 Prompt: Reviewer Closeout Implementation Handoff

## Session 477 Summary

Session 477 closed the Final Writeup staff observation, proved the automatic
review-DOCX filing path on a naturally received review, designed and shipped a
read-only historical Workbench request locator, and reconciled the reviewer
closeout/honorarium boundary. It also removed a bounded set of obsolete merged
worktrees and branches without touching unmerged or dirty work.

### What Was Completed

1. **Final Writeup persona lenses shipped**
   - [VERIFIED via source, focused tests, production-data service smoke, and
     Ready Production deployment] Commit `213f6c34` enabled the explicit Program
     Director, Program Coordinator, Leadership, overlap, ineligible, and
     superuser projections.
   - [VERIFIED via Production deployment and durable reconciliation] Commit
     `29aa4b71` recorded the rollout. [OWNER-REPORTED 2026-09-04] Duncan Spore
     subsequently completed the natural signed-in non-superuser History,
     matrix, and Word-link observation on Request `1002788`.

2. **Reviewer Complete-status contract approved**
   - The draft `outputs/codex-prompt-2026-09-03-reviewer-complete-status.md`
     proposed a deeper green Complete badge and automatic Complete transitions
     from the thank-you cron.
   - [VERIFIED via `shared/components/reviewers/reviewer-modes.js`] The color-only
     change is presentation-safe.
   - [VERIFIED via `lib/services/reviewer-thankyou-sweep.js`] The automated sweep
     claims `wmkf_thankyousentat` before sending and does not write Complete.
   - [VERIFIED via current source] Manual and automated thank-you paths record
     thank-you delivery only; neither path marks a reviewer Complete.
   - [OWNER DECISION 2026-09-04] Complete means a lead-PD human closeout of a
     received review and carries `eligible`, `not_eligible`, or
     `not_applicable`; no thank-you path sets it.
   - [OWNER DECISION 2026-09-04] The app never writes
     `wmkf_authorizationtoremitpaymentflag`; Operations/Finance retains final
     remit authority.

3. **Completion/payability implementation brief approved**
   - `docs/REVIEWER_COMPLETION_AND_HONORARIUM_DECISION_BRIEF.md` is now the
     reconciled implementation contract for review receipt, thank-you,
     closeout, eligibility, and final-remit separation.
   - [VERIFIED via repository-wide source search] The application has no writer
     for `wmkf_authorizationtoremitpaymentflag`; marking a reviewer Complete does
     not currently authorize the linked honorarium request.
   - [VERIFIED via read-only Production metadata and runtime select 2026-09-04]
     `wmkf_appreviewersuggestion.wmkf_honorariumeligibility` now exists with the
     approved three local Picklist values. The Ops view exists but is not yet
     published in akoyaGO; that interface work does not block the app writer.
   - [VERIFIED via read-only Production rows 2026-09-04] All 159 exact
     honorarium requests had the final-remit flag explicitly false. A broader
     Research-request scan found 87 true values, so the field remains live
     elsewhere rather than serving as reviewer closeout.

4. **Natural Final Writeups dashboard check completed**
   - [OWNER-REPORTED 2026-09-04] Duncan Spore found Request `1002788` in History,
     saw the review matrix, and opened the Word document successfully. Duncan,
     Allison, and Sarah initially appeared Reviewed and later Updated, consistent
     with the dashboard's version-freshness state.

5. **Historical Workbench locator shipped and Production-smoked**
   - [VERIFIED via source, focused tests, independent review, Ready Production
     deployment, and signed-in browser smoke 2026-09-04] Commits `ebf0b5c5`,
     `1766f6d2`, `41d2f77c`, and `cd2c73d5` added the inline read-only locator,
     fixed the Project Leader lookup gap, and gave saturated Contact searches a
     unique ordering before closeout. Production deployment
     `dpl_D6r4deRuAwe6xCgwGSmc5WTHWa7W` serves
     `https://applications.wmkeck.org/workbench`.
   - Text discovery unions bounded Dataverse Search results with requests joined
     through up to 25 matching Contact rows on authoritative
     `_wmkf_projectleader_value`, puts Project Leader matches first, deduplicates,
     and exposes at most 100 candidates in stable 25-row pages. The secondary
     full-text leg intentionally remains recall-oriented and can include broad
     lexical matches after an exact PI match.
   - Signed-in smoke proved Request `993357` first for PI
     `Cynthia Reinhart-King`, the same request for title `Phenotypic sorting`,
     correct exact-number navigation, an honest no-result state, and stable
     25→50 append with no duplicates. No request data was changed.

6. **Natural review-DOCX filing proof completed**
   - [VERIFIED via Production `maintenance_runs` and Dataverse pointer readback
     2026-09-04] Hourly run `70820` scanned and created exactly one file:
     `Reviews/Review-1002959-Manuel Müller.docx` for the newly received review
     on Request `1002959`; the result recorded SharePoint item identity, version
     `1.0`, 43,498 bytes, and no error.
   - Dataverse independently held the matching complete folder/filename pointer
     on suggestion `f99cb803-f791-f111-8076-70a8a59cded0`. The owner also saw
     the generated DOCX in the signed-in Workbench. This closes the final Wave 5
     natural automatic-filing proof; no manufactured review was needed.

7. **Merged branch/worktree clutter reduced safely**
   - [VERIFIED via Git ancestry and clean-worktree checks 2026-09-04] Removed
     seven clean, fully merged obsolete worktrees; preserved the dirty
     `claude/grantee-submit-visibility-spec` worktree and every unmerged branch.
   - Deleted eight corresponding merged local branches and five corresponding
     remote branches, including `codex/workbench-request-locator-release`.
     Counts after cleanup: 213 local branches (170 merged, 43 unmerged), 184
     remote branches excluding `origin/main`/`origin/HEAD` (141 merged), and
     seven worktrees including the current temporary `main` worktree.

### Commits

- `213f6c34` — Enable Final Writeup persona lenses
- `29aa4b71` — Record Final Writeup persona rollout
- `ebf0b5c5` — Add historical Workbench request locator
- `1766f6d2` — Harden request locator review findings
- `41d2f77c` — Search historical requests by Project Leader
- `cd2c73d5` — Stabilize Project Leader search pagination
- `d525911e` — Record request locator rollout

## Session 478 Implementation Update

- [VERIFIED via source and focused tests] Commit `2631c914` on branch
  `codex/reviewer-closeout-eligibility-app` adds a dedicated lead-PD/superuser
  closeout action for one Review Received engagement. The ETag-bound write sets
  Complete, the immutable first-completion timestamp, and exactly one honorarium
  eligibility disposition on the reviewer suggestion row.
- [VERIFIED via source and adversarial contract review] Complete is durable:
  generic status PATCH, removal, and reviewer merge cannot reopen, erase, or
  discard closeout state. Authorization is bound to the same request ownership
  observed by the fresh closeout read.
- [VERIFIED via source] Eligibility can be corrected later without restamping
  completion. Repeating the same closeout is a no-write success.
- [VERIFIED via source] The app does not write
  `wmkf_authorizationtoremitpaymentflag`; Operations/Finance retains remit
  authority. Thank-you templates and sends no longer infer payment or Complete.
- [VERIFIED via `npm run build -- --webpack`, focused Jest, and relevant gates]
  The implementation is source-complete. It has not been merged, promoted, or
  deployed; the colleague's akoyaGO view publishing remains separate follow-up.

## Next Items

### Verified Open

Promote `codex/reviewer-closeout-eligibility-app` deliberately after reviewing
the commit and deployment posture. Then run a signed-in Review Manager smoke on
a safe received-review row before treating the workflow as Production-proven.

### Owner Decision Needed

None currently.

### Verify Before Acting

1. **Do not backfill Review Received rows from `wmkf_thankyousentat` alone.** The
   sweep claims that marker before send and retains it after a post-claim
   failure. It proves neither PD approval nor guaranteed delivery.

2. **Reviewer-receipt probe branch location.** The formerly untracked
   `scripts/probe-request-review-receipts.mjs` was preserved and committed as
   `65e212ed` on `codex/final-writeup-personas-enable`; it is not on `main`.

3. **Branch cleanup.** Forty-three local branches remain unmerged. Do not
   bulk-delete them. Audit exact ancestry, open worktrees/PRs, and dirtiness
   first. The merged `claude/grantee-submit-visibility-spec` worktree contains
   untracked `CLAUDE_BUG_FIX_PROMPT.md` and `before.txt` and was deliberately
   preserved.

4. **Honorarium schema names.** Use display name **App Reviewer Suggestion**
   and logical table `wmkf_appreviewersuggestion`. Do not search for Honorarium
   Eligibility on the Request table; the planned field belongs to the reviewer
   suggestion row and is shown on Request only through the related subgrid.

### Parked

1. **akoyaGO Ops view publication — app implementation is not blocked.** The
   field and system view exist, and the source writer is complete on the feature
   branch. A colleague plans to surface the view in akoyaGO next week; that is an
   Ops-interface follow-up, not an application write dependency.

   Saved Power Apps instruction:

   > Could you add a reviewer-engagement view showing Honorarium Request,
   > Reviewer, Reviewed Grant Request, Cycle, Review Status, and Honorarium
   > Eligibility, then place it as a related subgrid on the Request
   > (Accounting) form? The reverse relationship is
   > `wmkf_appreviewersuggestion_HonorariumRequest_akoya_request`.

2. One-click PDF conversion of canonical review DOCX files.
3. Automatic review-due reminder scheduling; the cron-registry hold remains in
   force.

### Do Not Reopen Without New Decision

1. **BILL API reviewer onboarding.** The BILL integration remains tabled; the PD
   approval/payability discussion does not authorize reviving it.
2. **Automatically mark reviewers Complete from any thank-you path.** The owner
   explicitly rejected that coupling on 2026-09-04.
3. **Do not write `wmkf_authorizationtoremitpaymentflag`.** Operations/Finance
   retains final remit authority.

## Key Files Reference

| File | Purpose |
| --- | --- |
| `docs/REVIEWER_COMPLETION_AND_HONORARIUM_DECISION_BRIEF.md` | Approved implementation contract and invariant table. |
| `outputs/codex-prompt-2026-09-03-reviewer-complete-status.md` | Ignored historical working prompt; superseded by the tracked brief. |
| `shared/components/reviewers/reviewer-modes.js` | Reviewer status labels, ordering, and badge colors. |
| `lib/services/reviewer-thankyou-sweep.js` | Automated thank-you eligibility, claim, attachment, and send behavior. |
| `lib/services/review-manager/send-emails-service.js` | Retained manual thank-you compatibility behavior. |
| `lib/dataverse/adapters/reviewer-suggestion.js` | Complete transition semantics and honorarium lookup. |
| `shared/components/workbench/RequestLocator.js` | Historical request-search UI and browser-session state. |
| `pages/api/workbench/search-requests.js` | Guarded read-only request-search endpoint. |
| `lib/services/workbench/request-search-service.js` | Bounded Search + Project Leader union and pagination. |
| `lib/dataverse/adapters/contact.js` | Uniquely ordered bounded Contact directory lookup. |
| `docs/REVIEW_DOCX_SHAREPOINT_RETENTION_PLAN.md` | Completed review-DOCX retention rollout and proof. |
| `.claude-memory/project-reviewer-closeout-payability.md` | Prior payability-disposition direction and current unbuilt state. |
| `.claude-memory/project-honorarium-payment-landscape.md` | Current honorarium creation, BILL deferral, and payment-control posture. |

## Testing

Locator verification and documentation gates:

```bash
npx jest tests/unit/reviewer-manual-add-dedup-adapters.test.js tests/unit/workbench-request-number-lookup.test.js tests/unit/workbench-request-preview-safety.test.js tests/unit/workbench-request-search-route.test.js tests/unit/workbench-request-search-service.test.js --runInBand
npm run check:dataverse-access-layer
npm run check:dataverse-access-layer:self-test
npm run check:route-service-boundary
npm run check:route-service-boundary:self-test
npm run check:api-routes
npm run check:api-routes:self-test
npm run check:fact-consistency
npm run check:fact-consistency:self-test
npm run check:doc-currency
npm run check:doc-currency:self-test
npm run check:doc-symbol-refs
npm run check:build-claim-freshness
npm run check:docs-catalog
npm run build -- --webpack
```

## Prior Session 476 Context (Historical Reference)

The owner approved the recommended review-DOCX design. The complete implementation
is Production-live on `main` at `3101f067` in Ready deployment
`dpl_AjT5FeDh5wkdeFSoZWJsVDM5oBqs`.

- [VERIFIED via source, focused tests, and signed-in Production export] The Review Manager's existing combined
  Word export now calls a guarded server route, rereads the proposal and submitted
  reviews from Dataverse, and renders the approved combined template. The browser
  supplies only a validated proposal GUID.
- [VERIFIED via deployed source, focused tests, and rendered-page inspection] The thank-you sweep renders
  the submitted review through the approved individual template and attaches it
  when generation succeeds. Per-review render failure remains nonfatal to the
  thank-you send and is reported separately.
- [VERIFIED via Production apply and independent metadata readback 2026-09-03]
  Wave 25 created `wmkf_appreviewanswer.wmkf_questionoptions` as the exact
  nullable Memo field declared by the schema, with `MaxLength=20000`.
- [VERIFIED via source] New categorical answer rows snapshot the complete ordered
  `{value,label}` option set. Legacy rows with no option snapshot regenerate with
  an explicit selected-only note; corrupt snapshots render an explicit unavailable
  state rather than silently substituting today's question definition.
- [OWNER DECISION] This phase does not upload generated review DOCX files to
  SharePoint. Dataverse remains authoritative. The existing combined export stays
  an on-demand download, and the individual document is a courtesy attachment.

## Release Boundary

The release is complete. Wave 25 is exact in Production, the six reviewed commits
were fast-forwarded to `main`, and deployment
`dpl_AjT5FeDh5wkdeFSoZWJsVDM5oBqs` reached Ready at 2026-09-03 09:07 PDT.
The pre-release evidence remains: 306/306 affected-workflow tests, all relevant
structural gates and self-tests, TypeScript, lint with 0 errors/76 existing
warnings, a production build, and both template bundle traces.

[VERIFIED via signed-in Production Workbench export] Request `1002903` exposed
the Word action for its submitted review and generated a valid 60,586-byte DOCX
named `reviews-1002903-20260903.docx`. ZIP integrity passed and the package title
and header read **Aggregated Proposal Reviews**. Focused Vercel logs recorded
three export requests with successful 2xx Dataverse dependencies; the bounded
post-deploy error-level scan returned no logs. No review data was altered and no
thank-you email was sent during verification, so the courtesy-send path remains
deployed/source/test/render verified rather than transport-smoked in Production.

## Implementation Surfaces

- `lib/dataverse/schema/wave25-review-answer-question-options/`
- `scripts/preflight-review-answer-question-options-schema.mjs`
- `lib/dataverse/adapters/review-answer.js`
- `lib/external/build-review-submission.js`
- `lib/external/review-answer-snapshot.js`
- `shared/utils/review-matrix.js`
- `shared/utils/review-report.js`
- `lib/services/review-documents/docx-renderer.js`
- `shared/templates/reviews/individual-review-v1.docx`
- `shared/templates/reviews/combined-review-v1.docx`
- `shared/templates/reviews/individual-review-v2.docx`
- `shared/templates/reviews/combined-review-v2.docx`
- `shared/templates/reviews/individual-review-v3.docx`
- `shared/templates/reviews/combined-review-v3.docx`
- `shared/templates/reviews/individual-review-v4.docx`
- `shared/templates/reviews/combined-review-v4.docx`
- `lib/services/review-manager/export-reviews-service.js`
- `pages/api/review-manager/export-reviews.js`
- `lib/services/reviewer-thankyou-sweep.js`
- `shared/components/workbench/ReviewsTab.js`

## Following Priority

The owner-approved D26 retention backfill is complete. Waves 1–4 are
Production-live on `main` at `3ba2a6ad` in Ready deployment
`dpl_22wUzC1cCi4nhKTSFQftfaycucSh`. The exact v4 manifest executed 22 files
with zero failures, and a fresh post-write Production dry run found zero
eligible missing files, zero reconcile candidates, zero blockers, and only the
explicit Request `1003223` test exclusion. Wave 5 is now activated with exact
Production `REVIEW_DOCX_SHAREPOINT_WRITE=on` and
`REVIEW_DOCX_SHAREPOINT_CYCLE=D26` in Ready activation-proof deployment
`dpl_E6VKW5Wi8zDTfU1ZRhNsbH9yg9oM`. The first authenticated enabled run returned
HTTP 200, attempted no filing, and found only test Request `1003223` as
`invalid_snapshot`; bounded logs showed no Graph mutation, Dataverse PATCH, or
runtime error. Test-row disposition is now resolved: on 2026-09-04 UTC the sole
suggestion for test
Request `1003223` was ETag-conditionally changed only from
`wmkf_selected=true` to `false`, preserving its received-review history and
empty SharePoint pointers. A follow-up authenticated enabled sweep returned
HTTP 200 with zero candidates and zero attempts. The later owner cleanup of
Request `1002874` is independently verified complete; the work queue otherwise
returns to Final Writeup persona rollout. That rollout is now Production-live
on `main` at `213f6c34` in Ready deployment
`dpl_HGrbWUNPJMJunVevYLVEmtn7He6a`. A read-only production-data smoke using
the deployed source verified Program Director, Program Coordinator,
Leadership, PD + Leadership overlap, ineligible/unassigned, and superuser
projections; no data was written. The isolated browser reached the expected
sign-in boundary; Duncan's later owner-reported signed-in non-superuser check
completed the natural dashboard observation.
The active plan is `docs/REVIEW_DOCX_SHAREPOINT_RETENTION_PLAN.md`. Claude's
read-only adversarial review of the plan returned
APPROVE WITH CONDITIONS; the plan now incorporates the verified eligibility,
SharePoint target, dedicated-cron, pointer-consumer, 412, cycle, and helper-scope
corrections. Claude's reviewer thank-you honorarium-copy change is Production-live
on `main` at `41326cf5`, and this branch is rebased onto that baseline.

[VERIFIED via source, focused tests, governed-hash characterization, rendered
page inspection, and the Ready Production deployment] Wave 1 is complete on
`main` and included in current runtime `3ba2a6ad`: the shared
`review-documents/individual-review-builder.js` now owns answer loading,
composition, filename/content type, and template rendering. The thank-you sweep
still supplies send time, builds before its If-Match claim, and preserves the
honorarium projection/pass-through. No SharePoint call, pointer write, route,
cron, or rollout flag was added by Wave 1.

[VERIFIED via source/tests and flag-off Production route proof; SCHEDULED WRITES
NOT PRODUCTION-PROVED] Wave 2 is included in current `main` commit `3ba2a6ad` and
Ready deployment `dpl_22wUzC1cCi4nhKTSFQftfaycucSh`: a dedicated CRON-secret
route and filing
service enforce exact-stamped-cycle/fresh-snapshot eligibility, newest-first
scheduled discovery, create-only canonical
SharePoint writes, governed semantic reconciliation, ETag pointer commit with one
bounded retry, exact safe cleanup, structured per-row results, and deduplicated
operational events. External reviewer context hides only generated filenames;
the Workbench distinguishes generated staff entry from uploaded staff files via
one shared server classifier. `vercel.json` schedules the route hourly
with a 300-second function duration; flag-off requests return before a
maintenance row or data read. Claude's Wave 2 build review returned APPROVE WITH
NON-BLOCKING SUGGESTIONS, and the accepted hardening is incorporated. The
non-sensitive write/cycle flags are absent from the Production environment. An
authenticated Production GET returned
`{ok:true,enabled:false,status:"disabled",scanCap:7,attemptCap:2}`; the
`file-review-docx` maintenance-run count was zero immediately before and after.
No Graph mutation, Dataverse pointer write, or candidate read was authorized or
performed by the Wave 2 release. Wave 3 is now source-built on
`codex/review-docx-wave3-backfill`: the operator CLI defaults to a read-only
Production dry run, records no answer/document content, binds its ordered
unfinished population and exact Production Dataverse plus SharePoint target into
a hashed manifest, rechecks all source/ETag/semantic hashes before writes, and
uses the existing create-only ensure service under the local same-day Production
acknowledgement. Focused tests and Dataverse/context/type gates pass. Claude's
Wave 3 adversarial review returned APPROVE WITH NON-BLOCKING NOTES; the accepted
contract, target-binding, deterministic-ordering, create-only result-artifact,
and discriminating-test hardening is incorporated. The first read-only
Production dry run completed on 2026-09-03 and created the redacted manifest
`outputs/review-docx-backfill/review-docx-D26-2026-09-03T21-26-05-683Z.json`.
It found 24 unfinished reviews: 23 eligible and one `invalid_snapshot` on owner-
confirmed test Request `1003223`. A second read-only run used the new explicit,
hash-bound `--exclude-test-request 1003223` contract and created clean schema-v2
manifest `outputs/review-docx-backfill/review-docx-D26-2026-09-03T21-35-11-024Z.json`:
23 eligible, one visible `excluded_test_request`, zero blockers, and zero
existing generated items. No SharePoint or Dataverse mutation occurred. The
owner then selected Request `1002874` for the one-file proof. A fresh scoped
read-only run created validated schema-v2 manifest
`outputs/review-docx-backfill/review-docx-D26-2026-09-03T21-53-38-014Z.json`
with hash `8cc5c7821fa515828a2426cde6e800de131a4ab826c240881a97001899e41711`:
one eligible missing file, zero blockers, zero existing item, and exact request
GUID `e2639251-9644-f111-88b4-000d3a306d0c`. A separate metadata-only
Production read confirmed suggestion `1a0fb28f-0f9b-f111-b8db-6045bd008868`
belongs to Agnes Karasik. No write flag, acknowledgement, `--execute`,
SharePoint mutation, or Dataverse pointer write was used at dry-run time. The
owner then explicitly approved that exact manifest. Execution result
`outputs/review-docx-backfill/review-docx-D26-2026-09-03T21-53-38-014Z.execute-result-2026-09-03T22-03-52-432Z.json`
reports one created, zero failed: SharePoint item
`01G4GVMSZ3RAXEKILFYRCISR6CGKHFVCQI`, `Review-1002874.docx`, 69,761 bytes,
version `1.0`, with the exact generated folder committed to both Dataverse
pointer fields. Independent readback classified the row `already_filed` and
proved downloaded semantic hash
`gdc1:O7QmzK_dojK9xwRvpFNXObuKCbKddrRpSc25P3gj5-A` equals the reviewed hash.
The signed-in Production Workbench exposes the exact Agnes Karasik download
link, and the owner confirmed the browser download succeeds and the downloaded
document looks correct. Opening the retained item through akoyaGO/Word for the
web exposed a first-page compatibility defect: the tab-positioned `Proposal
Review` title split after its first character. The branch now preserves the
Production-used v1 templates and selects new v2 templates that remove the two
out-of-bounds positioning tabs and directly right-aligns both individual and
combined first-page titles. Focused tests, structural package checks, and
one-page renders for both templates passed; at that stage the fix had not yet
been deployed and the existing SharePoint item was unchanged. The owner then simplified the retained
file contract: generated documents now target the request-level `Reviews/`
folder with filename `Review-<request>-<reviewer name>.docx`; no
`Reviewer_Uploads/Generated` or suggestion-GUID layer remains in the current
target. The old Request `1002874` item was initially retained for compatibility
and was owner-deleted after the repair was verified. Because the governed hash
and target identity changed, the prior
22-row manifest is superseded. Fresh v4 read-only manifest
`outputs/review-docx-backfill/review-docx-D26-2026-09-04T01-18-31-489Z.json`
has hash `9254df9e5e504c79007391efc85d189e89e8b8b2ff80b8e4f11990baca08f4f8`,
22 eligible missing files, one visible Request `1003223` test exclusion, zero
blockers, 22 unique destinations, and no Request `1002874` candidate. No
suggestion IDs were added or removed versus the prior survey; the apparent new
reviews were already included. At that stage no additional population write had
been approved. The owner then authorized an exact
Request `1002874` repair that initially retained the old file; its separately
approved cleanup is now complete. Hash-bound
manifest
`outputs/review-docx-repair/review-docx-repair-1002874-2026-09-03T23-21-31-299Z.json`
(`c30c76e47281208b8b4cc25976360453eebbdc65ba3d4b203c19a6e0f1a5692d`)
had zero blockers and proved the new target absent. Execution created
SharePoint item `01G4GVMSZZ25YPTP3RGFEK6LCT64W3JPX2`,
`Reviews/Review-1002874-Agnes Karasik.docx`, 69,733 bytes, version `1.0`, then
ETag-conditionally repointed Dataverse. Independent readback matched semantic
hash `gdc1:IjQ_lTPljr-Hz3msRORXRuMNm2SwZfPffHjlE3fO52o` and confirmed the old
item still exists. The owner then confirmed that v2 kept the title on one line
but Word Online still pushed it below the logo. OOXML inspection identified the
remaining cross-renderer ambiguity: the behind-text floating logo still declared
`wrapTight`, allowing Word Online to wrap the title around its shape. New v3
individual and combined templates change only that first-page header geometry
to explicit `wrapNone`; both render as clean one-page fixtures locally and the
focused repair suite passes. The owner approved replacing the exact current
Agnes file while initially retaining the separate legacy item; that item was
later owner-deleted and its absence independently verified. Repair manifest
`outputs/review-docx-repair/review-docx-repair-1002874-2026-09-03T23-45-44-078Z.json`
(`ab98b779b660c77719c317f73b8f1004b08a898f7159971d6f5c97f9bfb2295d`)
bound the current item ID, ETag, version `1.0`, prior semantic hash, new v3
semantic hash, Dataverse ETag/source fingerprint, and exact target. The first
write attempt failed safely with HTTP 423 while Word Online held the item lock;
no bytes or pointers changed. The retry replaced the same stable SharePoint item
`01G4GVMSZZ25YPTP3RGFEK6LCT64W3JPX2` and filename in place as version `2.0`,
retaining and verifying version `1.0`. Independent read-only regeneration and
download now classify the row `already_filed` and match v3 semantic hash
`gdc1:E3KvF7rvlOaGoxps6DHihILCQlyDlSheguneB0F0ojw`; Dataverse pointers did not
change. Owner inspection showed that the v3 floating-logo header was still not
the desired alignment. The owner then edited and returned a header-only Word
file; new v4 individual and combined templates preserve that exact fixed
9360-DXA two-column Times New Roman text header, with no image, drawing, anchor,
tab, or first-page header relationship. Both full generated fixtures render
cleanly and the focused 92-test suite passes. Exact content-repair manifest
`outputs/review-docx-repair/review-docx-repair-1002874-2026-09-04T00-37-00-977Z.json`
(`18007d495f52ab7abb88c03e6d3099eadb953157e69051b0c4c96898881ef09e`)
versioned the same stable SharePoint item/name from `2.0` to `3.0`, retaining its
prior versions. At the owner's explicit request, a second guarded generation
and in-place upload wrote the same real v4 output as version `4.0` at
`2026-09-04T00:59:51Z`, retaining versions `1.0`–`3.0`. Independent read-only
regeneration/download now returns
`already_filed`, matches v4 governed hash
`gdc1:fbIC8o5aWoe_rOjXNK6mAKR6kbNRQ_I6MU60R28Chi4`, and confirms unchanged
Dataverse pointers. The owner visually confirmed version `4.0` in Word Online
and approved the v4 header on 2026-09-03. The reviewed runtime was subsequently
promoted at `3ba2a6ad` / `dpl_22wUzC1cCi4nhKTSFQftfaycucSh`. Exact execution
artifact
`outputs/review-docx-backfill/review-docx-D26-2026-09-04T01-18-31-489Z.execute-result-2026-09-04T01-32-42-926Z.json`
reports 22 created and zero failed; row-by-row reconciliation matched every
reviewed identity, destination, semantic hash, and unique SharePoint item.
Fresh post-write manifest
`outputs/review-docx-backfill/review-docx-D26-2026-09-04T01-33-20-264Z.json`
has no eligible or reconcile rows and no blockers. Wave 5 activation is complete
at `dpl_E6VKW5Wi8zDTfU1ZRhNsbH9yg9oM`; an authenticated enabled run resolved
`D26`, attempted zero filings, and made no SharePoint document or Dataverse
pointer mutation. It surfaced only known test Request `1003223` as
`invalid_snapshot`. The row was subsequently removed from the filing population
by changing only its suggestion's `wmkf_selected` value to `false`; the exact
follow-up enabled sweep returned zero candidates and zero attempts. The owner
then deleted Request `1002874`'s obsolete `Reviewer_Uploads/Generated` tree;
read-only Graph verification returned `404 itemNotFound` for that path and 200
for the current Agnes file, while Dataverse still pointed to the `Reviews`
folder and reviewer-named file. Production maintenance run `70820` subsequently
created `Reviews/Review-1002959-Manuel Müller.docx` for the naturally received
review and Dataverse stored the complete pointer, closing Wave 5 proof.

## Parked

- One-click PDF remains a possible future conversion of the canonical DOCX.
- Automatic review-due reminder scheduling remains held.
