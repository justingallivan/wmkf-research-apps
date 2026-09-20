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

Stage 0 (baseline, helper, census) was ACCEPTED 2026-09-20 at `e65b03a0` (see
Stage 0 acceptance below); Stage 1 has not started. Owner decision D3 (plan §9)
was accepted 2026-09-20: public default `preferParseError: false`; `parseError`
is still always recorded on `ApiRequestError`.

## Census baseline

Run: `node scripts/census-client-fetch-sites.js --out <scratch-dir>`, 2026-09-20,
against the working tree at branch `feature/client-request-layer` (HEAD
`1c0cc671` or later, round-1 review corrections).

Round 1 correction: the scanner previously matched only the FIRST `fetch(` on
a line (`line.match`, non-global). `shared/components/meeting-tracker/
SessionEditor.js:321` has two calls on one line
(`fetch('/api/meeting-tracker/recipients')`, `fetch('/api/meeting-tracker/
sessions')`), so the true count is one higher than the prior run reported.
The scanner now finds every `fetch(` occurrence per line (global match), one
row per occurrence, with a `col` column added to `sites.csv`.

| Fact | Plan §2.1 | This run | Delta |
|---|---|---|---|
| `shared/components/**` sites / files | 215 / 70 | 216 / 70 | +1 site (SessionEditor.js:321 double call) |
| `pages/**` (non-api) sites / files | 93 / 27 | 93 / 27 | none |
| Total sites / files | 308 / 97 | 309 / 97 | +1 |
| Body kind | json 248, unknown 41, stream 14, blob 3, none 2 | json 248, unknown 42, stream 14, blob 3, none 2 | +1 unknown (the added occurrence) |
| Method | GET 127, POST 130, PUT 21, PATCH 20, DELETE 10 | GET 128, POST 130, PUT 21, PATCH 20, DELETE 10 | +1 GET |
| `response.ok` checked | 254 yes, 54 no | 254 yes, 55 no | +1 no (the added occurrence has no `.ok` check in its own window) |
| Error surface | setError-state 190, swallowed 45, throw 36, unknown 27, toast/alert 8, console 2 | setError-state 190, swallowed 45, throw 36, unknown 28, toast/alert 8, console 2 | +1 unknown |
| Abort signal passed | 35 | 35 | none |
| Retry/poll wrapper | 19 | 19 | none |
| Explicit status branches | 409(13), 403(11), 401(4), 413(4), 503(3), 400(3), 412(2), 202(2), 404(1) | same, plus `200: 1` | **new**: `200: 1` — `shared/components/reviewers/ReviewerManagePanel.js:743` (PATCH `/api/review-manager/reviewers`), a real `response.status === 200` branch at line 779, inside the site's 40-line census window; not a false positive. §2.1 predates this branch's inclusion in the window or undercounted it. |

Two real deltas vs §2.1, both verified against source, not scanner artifacts:
the one-per-occurrence fix (+1 site) and the `status_branch` `200: 1`
(confirmed real code, not a window false positive — see above).

New dimension not in §2.1 (added for this plan's release-tier rule, §1, now
amended to include `email`):
`campaign_critical` (endpoint matches `/api/review-manager/*`, `/api/external/*`,
`/api/scheduled-emails*`, `/api/upload*`, or contains `send`/`invite`/
`reminder`/`release`/`close`/`email`) — **71 sites across 31 files** (up from
65/28 before the `email` keyword was added; `pages/test-email.js:26`
`/api/test-email` now flags true).

The census script (`scripts/census-client-fetch-sites.js`) is committed;
CSV/JSON outputs are **not** committed — they write under a required
`--out <dir>` outside the repo tree (plan §6 governs; §2.1's "committed"
wording is being reconciled by the orchestrator). The source-to-stage map
below is the durable record of the census content the plan asks for (§6
Stage 0: "Write its by-file table into
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

Verified this round against source (file:line cites below). Four adapters
fold into Stage 1, not three — `SessionEditor.js`'s local `readJson` (:22-24)
is **not dead** and is folded as a fourth adapter, not deleted; the file's
raw-fetch sites (4, not 3) flow through `readJson`/`sendJson`, not directly
through the new helper.

| File | Stage | Raw-fetch sites (census) | Campaign-critical | RTL test | Adapter |
|---|---|---|---|---|---|
| `pages/review-panel.js` + `shared/components/workbench/ReviewPanelTab.js` | 1 | 6 | false | yes | shared `readResponse` at `shared/components/review-panel/review-panel-ui.js:62-66`. Consumers: `pages/review-panel.js` :44, :89, :110-111 (the :110-111 pair is `const response = await fetch(...)` then `return readResponse(response);` on the next line — same-statement, not same-line); `shared/components/workbench/ReviewPanelTab.js` :251, :279, :289. |
| `pages/cycle-dossier.js` | 1 | 7 | false | yes | local `readResponse` copy at :72-75 (7 sites: :266, :335, :350, :398, :427, :459, :481) |
| `shared/components/meeting-tracker/SessionEditor.js` | 1 | 4 | false | yes | local `readJson` at :22-24. Raw-fetch sites: :305 (via `readJson` directly), :321 (two calls on one line — `fetch('/api/meeting-tracker/recipients')`, `fetch('/api/meeting-tracker/sessions')`), :322. `sendJson` (:26-27, issues its request through `fetchImpl` at :27) wraps `readJson` and is the fourth adapter in this file; it has 8 callers — `reorderSessionSlots` at :38, plus :380, :381, :385, :426, :514, :515, :516 — and contributes zero *additional* raw-fetch census sites (its own `fetchImpl(...)` call at :27 is not a literal `fetch(` call site the census scanner counts). |

Total raw-fetch sites flowing through Stage 1 adapters: **17** (6 + 7 + 4).

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

Resolved this round per §4's catch-all: `pages/workbench/[requestId].js` and
`shared/components/Layout.js` → **5a** (internal, no reviewer-engagement
endpoint); `pages/test-email.js` → **5b** (email surface, Tier 2, and now
also `campaign_critical: true` under the amended keyword rule — see Census
baseline); `pages/profile-settings.js` → **owner decision (6)**, not
auto-assigned (see below); the two `reviewers/search/*` hooks → **Stage 4**,
marked ASSUMED pending orchestrator confirmation (directory/naming match to
sibling Stage 4 hooks, not an explicit §4 name).

| File | Sites | Campaign-critical | RTL test | Disposition | Note |
|---|---|---|---|---|---|
| `pages/profile-settings.js` | 1 | true | yes | owner decision (6) | Verified this round: the flag fires on `invite`, not `send` — the site's literal endpoint is `/api/email-defaults/grantee-invite` (`pages/profile-settings.js:147`, GET; confirmed in both the census CSV and source). This is a self-service staff email-template-preference read, not a reviewer-engagement send/invite action; still not auto-assigned since it is a campaign-critical file absent from §4 by name (long-tail rule, §1). |
| `pages/test-email.js` | 1 | true (as of this round; `email` keyword added) | no | 5b | Ad hoc Dynamics-email-integration test page; site is `/api/test-email` POST at :26. |
| `pages/workbench/[requestId].js` | 1 | false | yes | 5a | Request Workbench shell (tab strip host for the Stage 2/4/5a tab components); site is `/api/workbench/resolve-request?requestId=...` GET at :127 (verified via census CSV). |
| `shared/components/Layout.js` | 1 | false | no | 5a | App-wide Layout/PageHeader/Card/Button shell imported by most pages; its only site is an internal read, `/api/admin/alerts?summary=true` GET at :35 (verified via census CSV). |
| `shared/components/reviewers/search/useApplicantReviewerEnrichment.js` | 1 | false | no | Stage 4 [ASSUMED] | reviewers/search/* hook, sibling to several Stage 4 hooks, but not individually named in §4's Stage 4 row; pending orchestrator confirmation. |
| `shared/components/reviewers/search/useReviewerRoster.js` | 1 | false | no | Stage 4 [ASSUMED] | reviewers/search/* hook, sibling to several Stage 4 hooks, but not individually named in §4's Stage 4 row; pending orchestrator confirmation. |

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

### Round 1 review corrections — Gate G (full), run by the orchestrator at `1c0cc671`

[ASSUMED — as instructed for this section; not independently re-run by the
Stage 0 corrections pass, which ran its own narrower gate subset (see
Verification log below) against the working tree after `1c0cc671`.]

Every `check:*` gate and its self-test, run sequentially: all green, with one
fact-consistency false positive on plan wording (a count that pattern-matched
the api-route fact gate), reworded in `1c0cc671`. `npm test`: 985 suites /
14533 tests, green. `npm run lint`: 0 errors. `npm run check:types`: clean.
`npm run build`: compiled successfully, with 2 pre-existing Turbopack
warnings on `/auth/error` (not introduced by this work).

### Stage 0 acceptance — 2026-09-20, orchestrator (Fable), at `e65b03a0`

Fresh Opus review of `d169fd63`+`0775005c`: READY WITH NAMED CHANGES (all 8
invariants present with line citations; every T0 row mapped to a test; late-
binding and mutation tests shown discriminating; census reproduces §2.1; named
changes were Stage 1 bookkeeping, census deltas, and T0 pins). One Sonnet
correction round (`e65b03a0`) applied them; the orchestrator applied the plan-
side corrections (`fdbee75a`) and spot-checked `sendJson` callers (8, incl.
`reorderSessionSlots` at :38) and the empty-string message rule.

Full Gate G run by the orchestrator at `e65b03a0` [VERIFIED via this run]:
every defined `check:*` gate and its self-test sequentially, 0 red;
`npm test`: 985 suites / 14548 tests green; `npm run lint`: 0 errors, 13
pre-existing warnings; `npm run check:types`: clean; `npm run build`:
compiled successfully.

Verdict: **Stage 0 ACCEPTED.** Helper landed with zero callers; census
tracked; execution map corrected. Rollback: revert `e65b03a0`, `0775005c`,
`d169fd63` (docs/scripts/tests plus one uncalled module; no runtime effect).

Stage 1 is NOT started. Owner decisions outstanding before later stages:
(1) D1 posture, (2) Stage 4 timing, (4) 5b rehearsal, (5) Stage 4 data mode,
(6) `pages/profile-settings.js` placement. D3 accepted 2026-09-20.

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

### Round 1 review corrections (2026-09-20)

- Read `shared/utils/api-request.js` in full to verify `deriveErrorMessage`
  (:73-84), the `requestEnvelope` "never null" docblock line (:180), and
  `isPlainObjectBody` (:98-104) before editing any of them.
- `npx jest tests/unit/api-request.test.js`: 62 passed, 62 total (up from
  47; 15 new tests for the invariant-8 import pin, `requestJson` signal
  forwarding, 2xx `null`/array/primitive bodies on both `requestJson` and
  `requestEnvelope`, the `deriveErrorMessage` empty-string/non-string-message
  edge cases, and Blob/string/URLSearchParams body passthrough).
- `npm test -- --silent`: 985 suites / 14548 tests, green.
- `npm run lint`: 0 errors (removed two `eslint-disable` comments this round
  added that triggered "unused directive" warnings; re-ran to confirm 0
  problems in the touched test file).
- `npm run check:doc-symbol-refs`: OK, 295 docs / 1756 refs.
- `npm run check:doc-currency`: OK, no drift markers.
- `npm run check:fact-consistency`: OK.
- `npm run check:scaffolding-tokens`: OK, 3886 files scanned.
- Read `scripts/census-client-fetch-sites.js` in full before editing the
  fetch-occurrence scanner (:148-165), the piped-wrapper match (:315-321),
  and the campaign-critical keyword list (:63).
- Verified `shared/components/meeting-tracker/SessionEditor.js:321` has two
  `fetch(` calls on one line (read source directly) — the scanner's prior
  non-global match undercounted this by one site.
- Re-ran the census script against a scratch dir
  (`.../scratchpad/census-r1`): 309 total sites (up from 308), `readResponse`
  wrapper resolved to 6 (`pages/review-panel.js` :44, :89, :110-111;
  `shared/components/workbench/ReviewPanelTab.js` :251, :279, :289) plus
  cycle-dossier's local copy at 7 sites, `campaign_critical` 71 sites / 31
  files with `email` added (`pages/test-email.js:26` now flags true).
- Diffed the re-run's `summary.json` against a checkout of the pre-round-1
  script (`git stash` / re-run / `git stash pop`) to derive each delta in
  the Census baseline table above from an actual before/after comparison,
  not by assumption.
- Read `shared/components/reviewers/ReviewerManagePanel.js:735-782` to
  confirm the `status_branch` `200: 1` at :743 is a real
  `response.status === 200` branch at line 779 inside the site's window, not
  a false positive.
- Read `pages/profile-settings.js:60-150` (relevant slice) to confirm the
  `campaign_critical` flag on that file fires on `invite` via
  `/api/email-defaults/grantee-invite` (:147), not on `send`.
- Read `shared/components/meeting-tracker/SessionEditor.js:1-40` and grepped
  all `sendJson(` call sites in the file: found 8 callers, not 7 — the plan
  round's brief omitted `reorderSessionSlots` at :38. Corrected in the Stage
  1 table above.
- Committed: `fix(client-request): stage 0 review corrections (census
  one-per-occurrence, message rule edge cases, execution log facts)`.
