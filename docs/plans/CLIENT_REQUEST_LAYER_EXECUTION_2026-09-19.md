---
title: Client Request Layer Execution Log
domain: platform
kind: plan
status: active
summary: Execution receipts and the source-to-stage file map for docs/plans/CLIENT_REQUEST_LAYER_PLAN_2026-09-19.md, filled in as each stage runs.
canonical: false
owner: product-engineering
related:
  - docs/plans/CLIENT_REQUEST_LAYER_PLAN_2026-09-19.md
---

# Client Request Layer Execution Log

## Scope and status

Stage 0 (baseline, helper, census) is in progress. Owner decision D3 (plan §9)
was accepted 2026-09-20: public default `preferParseError: false`; `parseError`
is still always recorded on `ApiRequestError`.

## Census baseline

Run: `node scripts/census-client-fetch-sites.js --out <scratch-dir>`, 2026-09-20,
against the working tree at branch `feature/client-request-layer` (HEAD
`e1fe1906`).

| Fact | Plan §2.1 | This run | Delta |
|---|---|---|---|
| `shared/components/**` sites / files | 215 / 70 | 215 / 70 | none |
| `pages/**` (non-api) sites / files | 93 / 27 | 93 / 27 | none |
| Total sites / files | 308 / 97 | 308 / 97 | none |
| Body kind | json 248, unknown 41, stream 14, blob 3, none 2 | json 248, unknown 41, stream 14, blob 3, none 2 | none |
| Method | GET 127, POST 130, PUT 21, PATCH 20, DELETE 10 | GET 127, POST 130, PUT 21, PATCH 20, DELETE 10 | none |
| `response.ok` checked | 254 yes, 54 no | 254 yes, 54 no | none |
| Error surface | setError-state 190, swallowed 45, throw 36, unknown 27, toast/alert 8, console 2 | same | none |
| Abort signal passed | 35 | 35 | none |
| Retry/poll wrapper | 19 | 19 | none |
| Explicit status branches | 409(13), 403(11), 401(4), 413(4), 503(3), 400(3), 412(2), 202(2), 404(1) | identical | none |

No delta against §2.1. All totals reproduce exactly; §2.1 is not edited.

New dimension not in §2.1 (added for this plan's release-tier rule, §1):
`campaign_critical` (endpoint matches `/api/review-manager/*`, `/api/external/*`,
`/api/scheduled-emails*`, `/api/upload*`, or contains `send`/`invite`/
`reminder`/`release`/`close`) — **65 sites across 28 files**. This is a new
count, not a restatement of an existing §2.1 fact, so there is nothing to
diff it against.

The census script (`scripts/census-client-fetch-sites.js`) is committed and
can be re-run on demand; its CSV/JSON outputs are not checked in (they write
under a required `--out <dir>`, never into the repo tree). The
source-to-stage map below is the durable record of the census content the
plan asks for (§6 Stage 0: "Write its by-file table into
docs/plans/CLIENT_REQUEST_LAYER_EXECUTION_2026-09-19.md as the
source-to-stage map").

## Source-to-stage map

One row per file from the census `by-file.csv`, with the stage assigned by
plan §4. Per-site `form` (`requestJson` / `requestEnvelope` / allowlisted),
`tolerantBody` choice, and a resolved body kind for the sites this scan
could not classify are filled in during each file's own stage — the columns
are reserved here with
"—" so the table shape doesn't change later. File names below are census
output (a mechanical scan), not individually read for this map unless a
row's Note says otherwise: [NOT-READ: <path> — file-list entry from the
census script's output, not opened this session; content claims about it
are limited to what the census counted (site count, campaign_critical
match, RTL-test presence)].

**6 files below are marked `UNASSIGNED`**: they have at least one JSON `fetch(`
site but are not individually named anywhere in plan §4, and do not fall
inside any of §4's named directory groups (`admin/*`, `workbench/*`,
`reviewers/*`, `external/*`, the named Executor tool pages). They need a
Fable/owner disposition (which stage owns them) before that stage runs;
until then treat them as **not yet in scope** for any stage. 15 further files
are marked `ASSUMED`: they fall inside a §4-named directory group or category
(admin/*, workbench/* long tail, external/* long tail, "Executor tool pages'
non-stream sites") but aren't named by filename, so the stage assignment is
inferred from the group, not verified against explicit plan text.

Per-site detail columns (added during migration, not at census time):

| Site line | Form | tolerantBody | Resolved body kind (if the scan could not classify it) |
|---|---|---|---|
| filled in per site during the file's stage | — | — | — |

### Stage 1 — Fold existing helpers

| File | Stage | Sites | Campaign-critical | RTL test | Adapter |
|---|---|---|---|---|---|
| `pages/cycle-dossier.js` | 1 | 7 | false | yes | local `readResponse` copy at :72-75 (7 sites: :266,335,350,398,427,459,481) |
| `pages/review-panel.js` | 1 | 3 | false | yes | `readResponse` import from `shared/components/review-panel/review-panel-ui.js` (3 sites) |
| `shared/components/meeting-tracker/SessionEditor.js` | 1 | 3 | false | yes | `sendJson` (3 sites) |
| `shared/components/workbench/ReviewPanelTab.js` | 1 | 3 | false | yes | `readResponse` import from `shared/components/review-panel/review-panel-ui.js` (3 sites) |

### Stage 2 — Covered high-count files

| File | Stage | Sites | Campaign-critical | RTL test |
|---|---|---|---|---|
| `pages/expertise-finder.js` | 2 | 8 | false | yes |
| `shared/components/workbench/AwardeeTab.js` | 2 | 14 | true | yes |
| `shared/components/workbench/ConsultantFeedbackSection.js` | 2 | 8 | false | yes |
| `shared/components/workbench/FinalWriteupTab.js` | 2 | 5 | false | yes |
| `shared/components/workbench/StaffDeliberationsTab.js` | 2 | 8 | false | yes |

### Stage 3 — Admin surface

| File | Stage | Sites | Campaign-critical | RTL test | Note |
|---|---|---|---|---|---|
| `pages/admin.js` | 3 | 32 | true | yes | [NOT-READ: pages/admin.js — census-derived row, not opened this session] |
| `shared/components/admin/AdminOverviewSection.js` | 3 | 1 | false | no | ASSUMED: admin/* directory. [NOT-READ: shared/components/admin/AdminOverviewSection.js] |
| `shared/components/admin/DynamicsExplorerRestrictionsSection.js` | 3 | 3 | false | no | [NOT-READ: shared/components/admin/DynamicsExplorerRestrictionsSection.js] |
| `shared/components/admin/EmailDefaultsSection.js` | 3 | 2 | false | yes | [NOT-READ: shared/components/admin/EmailDefaultsSection.js] |
| `shared/components/admin/FinalWriteupMatrixAudiencesSection.js` | 3 | 2 | false | yes | [NOT-READ: shared/components/admin/FinalWriteupMatrixAudiencesSection.js] |
| `shared/components/admin/MeetingTrackerDefaultsSection.js` | 3 | 2 | false | no | [NOT-READ: shared/components/admin/MeetingTrackerDefaultsSection.js] |
| `shared/components/admin/OperationalEventsSection.js` | 3 | 3 | false | yes | [NOT-READ: shared/components/admin/OperationalEventsSection.js] |
| `shared/components/admin/PoliciesSection.js` | 3 | 2 | false | yes | [NOT-READ: shared/components/admin/PoliciesSection.js] |
| `shared/components/admin/PromptTemplatesSection.js` | 3 | 5 | false | yes | [NOT-READ: shared/components/admin/PromptTemplatesSection.js] |
| `shared/components/admin/ReviewQuestionsSection.js` | 3 | 3 | false | yes | [NOT-READ: shared/components/admin/ReviewQuestionsSection.js] |
| `shared/components/admin/ReviewerRepairAlertDetails.js` | 3 | 1 | false | yes | [NOT-READ: shared/components/admin/ReviewerRepairAlertDetails.js] |
| `shared/components/admin/SiteVisitMaterialsDefaultsSection.js` | 3 | 2 | false | no | [NOT-READ: shared/components/admin/SiteVisitMaterialsDefaultsSection.js] |
| `shared/components/admin/SiteVisitRecipientsSection.js` | 3 | 4 | false | yes | [NOT-READ: shared/components/admin/SiteVisitRecipientsSection.js] |

### Stage 4 — Reviewer engagement surface (Tier 2)

| File | Stage | Sites | Campaign-critical | RTL test |
|---|---|---|---|---|
| `shared/components/reviewers/AcceptedReviewerReleaseModal.js` | 4 | 1 | true | yes |
| `shared/components/reviewers/CampaignConfigModal.js` | 4 | 3 | true | yes |
| `shared/components/reviewers/CandidateEditModal.js` | 4 | 3 | false | yes |
| `shared/components/reviewers/InviteEmailModal.js` | 4 | 10 | true | yes |
| `shared/components/reviewers/ReleaseEmailModal.js` | 4 | 2 | true | yes |
| `shared/components/reviewers/ReleaseMaterialsModal.js` | 4 | 5 | true | no |
| `shared/components/reviewers/RemoveEntirelyModal.js` | 4 | 2 | false | yes |
| `shared/components/reviewers/RespondReminderModal.js` | 4 | 2 | true | yes |
| `shared/components/reviewers/ReviewReminderAction.js` | 4 | 1 | true | no |
| `shared/components/reviewers/ReviewerCloseoutModal.js` | 4 | 1 | true | yes |
| `shared/components/reviewers/ReviewerDueDateEditor.js` | 4 | 1 | true | yes |
| `shared/components/reviewers/ReviewerFindPanel.js` | 4 | 5 | false | yes |
| `shared/components/reviewers/ReviewerInvitePanel.js` | 4 | 6 | true | yes |
| `shared/components/reviewers/ReviewerManagePanel.js` | 4 | 6 | true | yes |
| `shared/components/reviewers/ReviewersTab.js` | 4 | 5 | true | yes |
| `shared/components/reviewers/email-template-store.js` | 4 | 3 | false | yes |
| `shared/components/reviewers/prompt-override-store.js` | 4 | 3 | false | no |
| `shared/components/reviewers/search/useReviewerContactActions.js` | 4 | 8 | false | no |
| `shared/components/reviewers/search/useReviewerDiscovery.js` | 4 | 4 | false | no |
| `shared/components/reviewers/search/useReviewerExport.js` | 4 | 1 | false | no |
| `shared/components/reviewers/search/useReviewerPromotion.js` | 4 | 4 | false | no |
| `shared/components/reviewers/search/useReviewerRosterActions.js` | 4 | 4 | false | no |

(All Stage 4 file names above are census output; none was opened this
session. [NOT-READ: shared/components/reviewers/* files listed in this
table — census-derived rows only].)

### Stage 5a — Long tail, internal (Tier 1)

| File | Stage | Sites | Campaign-critical | RTL test | Note |
|---|---|---|---|---|---|
| `pages/batch-phase-i-summaries.js` | 5a | 1 | false | no | ASSUMED: Executor tool page. [NOT-READ] |
| `pages/batch-proposal-summaries.js` | 5a | 1 | false | no | ASSUMED: Executor tool page. [NOT-READ] |
| `pages/dataverse-bulk-export.js` | 5a | 3 | false | no | [NOT-READ] |
| `pages/dynamics-explorer.js` | 5a | 3 | false | yes | [NOT-READ] |
| `pages/expense-reporter.js` | 5a | 1 | false | no | ASSUMED: Executor tool page. [NOT-READ] |
| `pages/funding-gap-analyzer.js` | 5a | 1 | false | no | ASSUMED: Executor tool page. [NOT-READ] |
| `pages/grant-reporting.js` | 5a | 4 | false | no | read this session: grant reporting page (Field Set A writeback area) |
| `pages/integrity-screener.js` | 5a | 1 | false | no | ASSUMED: Executor tool page. [NOT-READ] |
| `pages/literature-analyzer.js` | 5a | 1 | false | no | ASSUMED: Executor tool page. [NOT-READ] |
| `pages/multi-perspective-evaluator.js` | 5a | 1 | false | no | ASSUMED: Executor tool page. [NOT-READ] |
| `pages/peer-review-summarizer.js` | 5a | 1 | false | no | ASSUMED: Executor tool page. [NOT-READ] |
| `pages/phase-i-dynamics.js` | 5a | 2 | false | no | read this session: single-request Phase I summarization + Dynamics writeback test page |
| `pages/phase-i-writeup.js` | 5a | 1 | false | no | ASSUMED: Executor tool page. [NOT-READ] |
| `pages/phase-ii-writeup.js` | 5a | 4 | false | no | [NOT-READ] |
| `pages/virtual-review-panel.js` | 5a | 2 | false | no | [NOT-READ] |
| `shared/components/ProfileLinkingDialog.js` | 5a | 3 | false | no | [NOT-READ] |
| `shared/components/expertise-finder/RosterContactField.js` | 5a | 2 | false | yes | [NOT-READ] |
| `shared/components/final-writeups/FinalWriteupsViews.js` | 5a | 3 | false | yes | [NOT-READ] |
| `shared/components/meeting-tracker/MeetingTrackerList.js` | 5a | 3 | false | yes | [NOT-READ] |
| `shared/components/meeting-tracker/SessionAgendaPanel.js` | 5a | 3 | false | yes | [NOT-READ] |
| `shared/components/meeting-tracker/SiteVisitEditor.js` | 5a | 3 | false | yes | [NOT-READ] |
| `shared/components/meeting-tracker/SiteVisitMaterialsCard.js` | 5a | 2 | false | yes | [NOT-READ] |
| `shared/components/workbench/ArtifactVersionHistory.js` | 5a | 2 | false | yes | [NOT-READ] |
| `shared/components/workbench/AwardeesPanel.js` | 5a | 2 | false | yes | [NOT-READ] |
| `shared/components/workbench/CuratedRecipientPicker.js` | 5a | 1 | false | no | ASSUMED: workbench/* long tail. [NOT-READ] |
| `shared/components/workbench/InitialAssessmentTab.js` | 5a | 4 | false | yes | [NOT-READ] |
| `shared/components/workbench/InitialAssessmentsPanel.js` | 5a | 1 | false | no | ASSUMED: workbench/* long tail. [NOT-READ] |
| `shared/components/workbench/ManualReviewEntryForm.js` | 5a | 2 | true | yes | [NOT-READ] |
| `shared/components/workbench/OverviewTab.js` | 5a | 1 | false | yes | [NOT-READ] |
| `shared/components/workbench/PreSiteDistributionPanel.js` | 5a | 4 | true | yes | [NOT-READ] |
| `shared/components/workbench/ProposalTab.js` | 5a | 2 | false | yes | [NOT-READ] |
| `shared/components/workbench/RequestListPanel.js` | 5a | 3 | false | yes | [NOT-READ] |
| `shared/components/workbench/RequestLocator.js` | 5a | 2 | false | yes | [NOT-READ] |
| `shared/components/workbench/ReviewerFollowUpPanel.js` | 5a | 2 | true | no | [NOT-READ] |
| `shared/components/workbench/ReviewsTab.js` | 5a | 4 | true | yes | [NOT-READ] |
| `shared/components/workbench/StaffDeliberationsPanel.js` | 5a | 1 | false | yes | ASSUMED: workbench/* long tail. [NOT-READ] |
| `shared/components/workbench/WorkbenchShell.js` | 5a | 1 | false | yes | ASSUMED: workbench/* long tail. [NOT-READ] |
| `shared/components/workbench/useSiteVisitContext.js` | 5a | 2 | false | yes | [NOT-READ] |

### Stage 5b — Long tail, external and upload-adjacent (Tier 2)

| File | Stage | Sites | Campaign-critical | RTL test | Note |
|---|---|---|---|---|---|
| `pages/external/briefing/[token].js` | 5b | 1 | true | yes | [NOT-READ] |
| `pages/external/grantee/[token].js` | 5b | 1 | true | yes | read this session: scaffold landing page, fetches `/api/external/grantee/[token]/context` |
| `pages/external/materials/[token].js` | 5b | 4 | true | yes | [NOT-READ] |
| `pages/external/review/[token].js` | 5b | 1 | true | yes | read this session: state-driven view dispatcher, fetches `/api/external/review/[token]/context` |
| `pages/scheduled-emails.js` | 5b | 6 | true | no | [NOT-READ] |
| `shared/components/external/DeclineFormView.js` | 5b | 1 | true | yes | ASSUMED: external/* directory. [NOT-READ] |
| `shared/components/external/GranteeDeliverableForm.js` | 5b | 3 | true | yes | [NOT-READ] |
| `shared/components/external/ReviewAuthoringForm.js` | 5b | 3 | true | yes | [NOT-READ] |
| `shared/components/external/Stage2aView.js` | 5b | 1 | true | yes | ASSUMED: external/* directory. [NOT-READ] |

### UNASSIGNED — needs Fable/owner disposition before any stage claims them

| File | Sites | Campaign-critical | RTL test | Note (read this session) |
|---|---|---|---|---|
| `pages/profile-settings.js` | 1 | true | yes | read this session: self-service staff profile page (display name, avatar, email-signature/template prefs); not named in §4, not under an admin/workbench/reviewers/external directory |
| `pages/test-email.js` | 1 | false | no | read this session: ad hoc Dynamics-email-integration test page; not named in §4 |
| `pages/workbench/[requestId].js` | 1 | false | yes | read this session: Request Workbench shell (tab strip host for the Stage 2/4/5a tab components); not itself named in §4 |
| `shared/components/Layout.js` | 1 | false | no | [NOT-READ: shared/components/Layout.js] — census flags one fetch site in this file; app-wide Layout/PageHeader/Card/Button shell imported by most pages; not a §4-named directory |
| `shared/components/reviewers/search/useApplicantReviewerEnrichment.js` | 1 | false | no | [NOT-READ] reviewers/search/* hook, sibling to several Stage 4 hooks, but not individually named in §4's Stage 4 row |
| `shared/components/reviewers/search/useReviewerRoster.js` | 1 | false | no | [NOT-READ] reviewers/search/* hook, sibling to several Stage 4 hooks, but not individually named in §4's Stage 4 row |

`pages/profile-settings.js` is campaign-critical (keyword match) and
UNASSIGNED — flagging explicitly since an unassigned campaign-critical file
must not land in a Tier 1 stage by the §1 long-tail rule. On inspection
(read this session) its sites are self-service profile-preference calls with
no reviewer-engagement endpoint; the `campaign_critical` flag likely fired on
a generic keyword match (e.g. "send") rather than a real reviewer-engagement
endpoint, but this needs confirmation against the actual site lines, not an
assumption, before the file is placed in a stage.

The two `reviewers/search/*` orphans (`useApplicantReviewerEnrichment.js`,
`useReviewerRoster.js`) most plausibly belong in Stage 4 alongside their
sibling hooks, given the directory and naming pattern, but are left
UNASSIGNED rather than silently folded into the Stage 4 table above, since
Stage 4's file list in §4 is enumerated by name and these two are absent from
it — that omission could be intentional (deferred) or an oversight in the
plan.

## Stage 0 acceptance

Gate G commands (plan §7), run sequentially, tests before code, stage-named
tests first:

```bash
npx jest tests/unit/api-request.test.js
npm test -- --runInBand --silent
npm run lint
npm run check:types
npm run check:status-enum-parity && npm run check:status-enum-parity:self-test
npm run check:api-routes && npm run check:api-routes:self-test
npm run check:doc-symbol-refs && npm run check:doc-symbol-refs:self-test
npm run check:build-claim-freshness && npm run check:build-claim-freshness:self-test
npm run check:doc-currency && npm run check:doc-currency:self-test
npm run check:secret-scan && npm run check:secret-scan:self-test
npm run check:scaffolding-tokens && npm run check:scaffolding-tokens:self-test
npm run build
```

Results filled in so far by the Stage 0 implementer (2026-09-20); the
remaining rows (a full-suite run in the orchestrator's own pass,
status-enum-parity, api-routes, build-claim-freshness self-tests, and
`npm run build`) are the orchestrator's responsibility per the plan:

- `npx jest tests/unit/api-request.test.js`: 47 passed, 47 total.
- `npm test -- --runInBand --silent`: 985 suites passed, 14533 tests passed
  (plan baseline: 984 suites, 14486 tests; delta is this session's one new
  test file).
- `npm run lint`: 0 errors, 114 pre-existing warnings, none in the two files
  this session added.
- `npm run check:types`: clean.
- `npm run check:status-enum-parity` (+ self-test): not run this session.
- `npm run check:api-routes` (+ self-test): not run this session.
- `npm run check:doc-symbol-refs` (+ self-test): OK, 295 docs / 1756 refs.
- `npm run check:build-claim-freshness` (+ self-test): not run this session.
- `npm run check:doc-currency` (+ self-test): OK, no drift markers.
- `npm run check:secret-scan` (+ self-test): OK, 3898 files scanned.
- `npm run check:scaffolding-tokens` (+ self-test): OK, 3882 files scanned.
- `npm run check:docs-catalog`: OK, 302 docs cataloged (not in plan §7's
  list, run per this task's own gate checklist).
- `npm run build`: not run this session (orchestrator's responsibility).

Mutation check (invariant 5, `requestEnvelope` keying success on HTTP status
only): temporarily computed `ok` as `data.ok ?? response.ok`; exactly one
test failed — `requestEnvelope › success keys on HTTP status only: body-level
{ok:false}/{success:false} is never interpreted`; reverted immediately and
the suite re-ran green (47/47).

## Verification log

Commands actually run by the Stage 0 implementer (subset of Gate G; full Gate
G above is the orchestrator's responsibility per the plan):

- `node scripts/census-client-fetch-sites.js --out <scratch-dir>` — totals
  reproduced §2.1 exactly (see Census baseline above).
- `npx jest tests/unit/api-request.test.js` — see this session's report for
  the pass count.
- `npm test -- --silent 2>&1 | grep -E '^(Tests|Test Suites):'` — see this
  session's report for the full-suite summary line.
- `npm run lint`, `npm run check:types`, `npm run check:doc-symbol-refs`,
  `npm run check:doc-currency`, `npm run check:docs-catalog`,
  `npm run check:secret-scan`, `npm run check:scaffolding-tokens` — see this
  session's report.
- Mutation check on `requestEnvelope` (`ok` computed from `data.ok ?? response.ok`
  instead of `response.ok` alone): the test file was run, restored, and
  re-run green — failing test names recorded in this session's report, not
  duplicated here to avoid drift between two copies of the same fact.
