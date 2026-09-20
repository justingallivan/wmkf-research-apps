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
Stage 0 acceptance below). Owner decision D3 (plan §9)
was accepted 2026-09-20: public default `preferParseError: false`; `parseError`
is still always recorded on `ApiRequestError`. Stage 1 (fold existing
helpers) implemented 2026-09-20; see Stage 1 section below. Fresh review:
pending.

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

Owner decisions outstanding before later stages: (1) D1 posture, (2) Stage 4
timing, (4) 5b rehearsal, (5) Stage 4 data mode, (6)
`pages/profile-settings.js` placement. D3 accepted 2026-09-20.

## Stage 1 — fold adapters

Implemented 2026-09-20. Four adapters reimplemented over
`readJsonBody(response, { tolerantBody: true })`; no call site edited; no
export/signature/message-string change; thrown values stay plain `Error`.

| Adapter | File | Before | After |
|---|---|---|---|
| `readResponse` | `shared/components/review-panel/review-panel-ui.js:64-68` (was :62-66; +2 for the added import and blank line) | `const body = await response.json().catch(() => ({}));` | `const body = await readJsonBody(response, { tolerantBody: true });` |
| `readResponse` (local copy) | `pages/cycle-dossier.js:73-77` (was :72-75; +1 line for the added import elsewhere in the file, no adapter body change) | `const body = await response.json().catch(() => ({}));` | `const body = await readJsonBody(response, { tolerantBody: true });` |
| `readJson` | `shared/components/meeting-tracker/SessionEditor.js:23-25` (was :22-24; +1 line for the added import elsewhere in the file) | `return response.json().catch(() => ({}));` | `return readJsonBody(response, { tolerantBody: true });` |
| `sendJson` | `shared/components/meeting-tracker/SessionEditor.js:27-36` (was :26-35; +1 line, same shift) | unchanged — still calls the file-local `readJson`, which now folds over `readJsonBody` | unchanged expression; behavior folds through `readJson`'s new body |

`pages/cycle-dossier.js`'s local `readResponse` and `SessionEditor.js`'s
`readJson`/`sendJson` gained `export` (additive only, no signature/behavior
change) so `tests/unit/client-request-stage1-adapters.test.js` (T1) can
import them directly, matching each file's existing convention of exporting
its other pure helpers (e.g. `groupedCandidates`, `reorderSessionSlots`).

**17 raw sites confirmed** (line numbers are pre-edit, Stage 0 census; each is +1 in the migrated files after the added import) [VERIFIED via grep against each file, this
session]:
- `shared/components/review-panel/review-panel-ui.js` `readResponse` (6
  sites): `pages/review-panel.js:44,89,111` (the pair at :110-111 is
  `readResponse(response)` called at :111 on the previous line's `response`)
  and `shared/components/workbench/ReviewPanelTab.js:251,279,289`.
- `pages/cycle-dossier.js` local `readResponse` (7 sites): :266, :335, :350,
  :398, :427, :459, :481.
- `shared/components/meeting-tracker/SessionEditor.js` `readJson`/`sendJson`
  (4 raw-fetch sites): :305 (`fetch` feeding `readJson` at :306), :321 (two
  `fetch(` calls on one line), :322 (`fetch` feeding `readJson` at :324, via
  `responses.map(readJson)`). `sendJson` itself has 8 callers
  (`reorderSessionSlots` at :38, plus :380/:381/:385/:426/:514/:515/:516)
  and contributes no additional raw `fetch(` census site (its request goes
  through `fetchImpl`).

Total: 6 + 7 + 4 = **17**, matching the plan (§2.4) and the Stage 0
source-to-stage map above.

**T1** (`tests/unit/client-request-stage1-adapters.test.js`): 30 tests —
message-text pins for `{error}`, `{message}`-only (falls to fallback),
nested `{error:{message}}` (`[object Object]`), `{error:5}` (`"5"`), a
non-2xx body whose `json()` rejects (empty/non-JSON, falls to fallback), 2xx
return-as-is, thrown `.name === 'Error'`, `sendJson`'s `fetchImpl`/headers/body
assertions, and a static grep-based assertion that none of the four consumer
files (`pages/review-panel.js`, `shared/components/workbench/ReviewPanelTab.js`,
`pages/cycle-dossier.js`, `shared/components/meeting-tracker/SessionEditor.js`)
contains `signal` or `AbortController` — confirmed 0 hits in this session, so
invariant 4's abort rethrow is unobservable here. Ran green against the
UNMIGRATED adapters first (30/30), committed at `45907489`; ran again
UNCHANGED after migration (30/30, same test file, no edits). Existing tests
matching `tests/unit/.*(cycle-dossier|review-panel|session-editor|meeting-tracker)`
(no file matches `session-editor` by that exact name; the pattern is kept
for the plan's stated command shape): 671/671 passed, both before and after
migration.

**Gate G**, run sequentially before the code commit `a38b085f` (this section
was written and gate output captured immediately beforehand, against the
same working tree that commit records): `npm test -- --runInBand --silent`:
986 suites / 14578 tests green; `npm run lint`: 0 errors (114 pre-existing
warnings, none newly introduced); `npm run check:types`: clean;
`check:status-enum-parity` + self-test: OK (8 invariants, 17/17 self-test);
`check:api-routes` + self-test: OK (224 routes); `check:doc-symbol-refs` +
self-test: OK (295 docs / 1756 refs); `check:build-claim-freshness` +
self-test: OK (295 docs / 1607 refs) — updated `shared/utils/api-request.js`'s
header comment, which said "Zero callers until Stage 1", to reflect that
Stage 1 now has callers; `check:doc-currency` + self-test: OK; `check:secret-scan`
+ self-test: OK (3904 files); `check:scaffolding-tokens` + self-test: OK
(3888 files); `npm run build`: compiled successfully.

Fresh review (Opus, no inherited context, at `c3a84a41`): **READY WITH NAMED
CHANGES, doc-only.** Per-adapter thrown expressions byte-identical and plain
`Error`; no consumer line changed (exports landed in the T1 commit `45907489`,
additive; `pages/cycle-dossier.js` already had 7 named exports and the repo has
precedent for tests importing page-module exports); T1's five message pins
shown discriminating against a `deriveErrorMessage` swap; two introduced
semantic differences, both unobservable here (abort-during-body rethrow: 0
`signal`/`AbortController` hits in the four consumer files; the helper's
try/await also tolerates a synchronous `json()` throw, which a real Response
never does). Named changes applied by the orchestrator: this row's line shift,
T1 header refs, census pre-edit label, `\bsignal\b` tripwire. Reviewer's
scope note recorded: Stage 1 adds a seam and removes no duplication; the
slimming payoff is in Stages 2-6.

**Stage 1 ACCEPTED 2026-09-20 by the orchestrator (Fable).** Rollback: revert
`c3a84a41`, `a38b085f`, `45907489` (tests, adapters, log; consumers untouched).

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

## Stage 2 — covered high-count files

Two disjoint groups built concurrently by Sonnet; tests committed before code
per file and run unchanged after migration; the orchestrator fills this log.

### Group B (logged 2026-09-20; fresh review pending with group A)

**B1 `shared/components/workbench/StaffDeliberationsTab.js` — 8/8 sites → `requestEnvelope`, `tolerantBody: true`.**
Every site keeps its own `data.error || "<verb> failed (${status})"` derivation
because the fallback embeds the live status, which a static `fallbackMessage`
cannot reproduce; `submitReopen`/`submitBriefReopen` keep their `status === 202`
branches; `pollForArtifact`'s retry loop stays outside the helper; the file's
synthesized `AbortError`s and `err?.name !== 'AbortError'` branches untouched.
Tests `tests/unit/staff-deliberations-tab.test.js` 60 → 69 (9 T2 cases incl. an
aborted mid-poll case). Commits `6607ba1f` (tests), `231842a9` (migration).

**B2 `pages/expertise-finder.js` — 8/8 sites → `requestEnvelope`, strict body.**
Sites throw `data.error || "HTTP ${status}"` or bare `throw new Error(data.error)`
(no fallback; a missing `error` field still yields the message `"undefined"`,
preserved). `runBatch` stores ok/!ok into per-proposal state without throwing;
`fetchHistory` acts only on the truthy `ok` branch. Fixture `beforeEach` gained
`status: 200`. Tests `tests/unit/expertise-finder-batch-cycle.test.js` 1 → 22.
Commits `6ae896d2` (tests), `8785a9bf` (migration).

**B3 verify-only:** `pages/cycle-dossier.js` (7), `pages/review-panel.js` (3;
one is the two-statement `const response = await fetch(...); return
readResponse(response)`), `ReviewPanelTab.js` (3): every site passes through
the Stage 1 `readResponse` adapter; no raw unwrapped site. No edits.

Group B gates at `8785a9bf`: `npm test` 986 suites / 14639 tests green; lint 0
errors; `check:types` clean.

**Observations for the plan (not defects in this stage):**
- O1. Sixteen of sixteen group B sites chose `requestEnvelope` because their
  fallback message embeds `response.status`. A `fallbackMessage` that accepts
  a function `(status) => string` would let `requestJson` serve them and remove
  the per-site derivation. Candidate helper enhancement; owner call, since it
  widens the closed option contract.
- O2. Pre-existing, user-facing: `shared/components/ErrorAlert.js:45` reads the
  prop `error`, but six call sites pass `message=` (`pages/expertise-finder.js:250,388,851`,
  `pages/dataverse-bulk-export.js:471`, `pages/virtual-review-panel.js:1296`,
  `pages/phase-i-dynamics.js:152`), so those error banners render blank
  [VERIFIED via grep]. Recorded as D9 in the D1 follow-up doc; not fixed here.

### Group A (logged 2026-09-20; fresh review pending)

**A1 `shared/components/workbench/AwardeeTab.js` — 14 sites: 13 migrated, 1 excluded.**
`requestJson`: :238 email-defaults GET (tolerant), :263 recipients GET (strict),
:276 vip-flags GET (tolerant), :322 abstract GET (strict), :381 abstract GET
conflict re-read (tolerant), :458 generate POST (strict; fallback 'Abstract
generation failed.'; catch branches `instanceof ApiRequestError`), :481 abstract
PUT (tolerant; fallback 'Could not save the abstract.'; catch reads
`err.payload?.code === 'stale'`), :583 preview-invite POST, :613 website-html GET
(both tolerant, `instanceof` catch). `requestEnvelope`: :285 vip-flags PUT
(reads `body.flagged` on 2xx), :543 send-invite POST (STRICT body so a
malformed 2xx still yields the `uncertain` receipt, D8; branches on
`outcome==='uncertain'` and `statusPersisted===false`), :662 upload-token POST
(body-level `tokenData.ok` + 413), :705 replace-submission POST (413 + several
`data.code` branches). Excluded: :645 replacement-upload-failure beacon stays raw
`fetch` with the §2.6 allowlist comment. Tests `tests/unit/awardee-tab.test.js`
94 → 115. Commits `fbde13a3` (tests), `ab64f35d` (migration).

**A2 `shared/components/workbench/FinalWriteupTab.js` — 5/5 → `requestEnvelope`, `tolerantBody: true`.**
All sites embed the status in their fallback or branch on status on success:
`fetchStatus` :47 (attaches `.code` to the thrown Error), `fetchAcknowledgementState`
:60 (503 + `schema_not_ready` → `{available:false}`), `start()` :302 (202 or
`inProgress` → poll), `advance()` :353 (artifactId mismatch → "changed"),
`markReviewed()` :399 (503 code check; finalArtifactId mismatch). Retry loop
stays outside the helper. Tests `tests/unit/final-writeup-tab.test.js` 16 → 28
(incl. the previously untested 202 poll branch). Commits `6bc90807`, `d5f7cb6c`.

**A3 `shared/components/workbench/ConsultantFeedbackSection.js` — 8/8, `tolerantBody: true`.**
`requestEnvelope` at :297 entries GET, :298 consultants GET (ternary on `.ok`),
:444 upload-token POST (body-level `ok`), :484 PATCH, :534 POST, :576 DELETE
(`data.reason==='attachment_removal_pending'`; status-embedded fallbacks);
`requestJson` at :501 and :514 finalize POSTs (fallback 'The attachment could
not be saved.'). No import from review-panel-ui.js (comment mention only). This
file had zero failure-path coverage before; tests
`tests/unit/consultant-feedback-section.test.js` 18 → 30. Commits `a3a44129`,
`07470083`.

Group A gates at `07470083`: `npm test` 986 suites / 14652 tests green; lint 0
errors (three pre-existing `react-hooks` warnings on untouched effects);
`check:types` clean.

**Observation O3 (pre-existing, unchanged):** `ConsultantFeedbackSection`
`handleDelete`'s `attachment_removal_pending` branch calls
`setError('Attachment removed, delete again.')` then `await load()`, whose
leading `setError(null)` wins the same batch, so that message never renders.
Documented in the new test; candidate for the D1 follow-up family.

**Stage 2 totals:** 42 sites migrated across 5 files (13+5+8+8+8), 1 excluded
beacon, 3 verify-only files confirmed on the Stage 1 adapters. T2 tests added:
75 (21+12+12+9+21). Form split: `requestJson` 11, `requestEnvelope` 31. Fresh
review and full Gate G by the orchestrator: pending below.

### Stage 2 acceptance — 2026-09-20, orchestrator (Fable), at `3472bcbc`

Fresh Opus review of the ten Stage 2 commits (`4655b937..07470083`): READY WITH
NAMED CHANGES. Tests-before-code order and one-source-file-per-migration-commit
confirmed for all five files; request bytes, `signal` forwarding, status and
body-flag branches, and the `saveAbstract` `stale` handling confirmed
PRESERVED; only the allowlisted beacon remains raw. Material finding: because
the helper parses every non-2xx body tolerantly, bare-`.json()` sites' "non-2xx
with unparseable body" input moved from the catch block to the `!ok` branch,
and at three sites those paths meant different things (send-invite `uncertain`
→ `failed`; four expertise-finder roster sites → empty message hidden by the
`{error && ...}` guard; `runBatch` → empty per-proposal cell). Three T2 gaps
named (body-bytes assertion at send, the plain `failed` pin, fixtures lacking
`status`).

One Sonnet correction round (`7c77d39c` tests, `3472bcbc` fix): six new
axis-(e) tests red before the fix and green after; send-invite maps
`error.parseError` to `uncertain`; roster sites and `runBatch` use
`data.error || error.message`; body-bytes and `failed`-branch pins and fixture
statuses added. `handleMatch`/`loadProposals` already had a non-empty fallback
and were left alone. The orchestrator read the 21-line fix diff in full against
the finding and accepted it without a further fresh cycle. Plan amended
(`597981bf`): T2 axis (e) and the never-silent / `parseError` rules for later
stages.

Full Gate G at `3472bcbc` [VERIFIED via this run]: every `check:*` gate and
self-test 0 red; `npm test` 986 suites / 14662 tests green; lint 0 errors;
`check:types` clean; `npm run build` compiled.

Verdict: **Stage 2 ACCEPTED.** 42 sites migrated across 5 files; T2 tests
added 85 (75 + 10 in the correction round). Rollback: revert `3472bcbc`,
`7c77d39c`, then the five migration commits (`ab64f35d`, `d5f7cb6c`,
`231842a9`, `8785a9bf`, `07470083`) and their test commits in reverse order.
Stage 3 next.

## Stage 3 — admin surface

### Group A: `shared/components/admin/*` sections (logged 2026-09-20; fresh review pending with group B)

29 sites across 11 files, all migrated; census count matched. Forms:
`requestJson` at SiteVisitRecipientsSection (4), EmailDefaultsSection (2),
FinalWriteupMatrixAudiencesSection (2), SiteVisitMaterialsDefaultsSection (2),
MeetingTrackerDefaultsSection (2); `requestEnvelope` at
DynamicsExplorerRestrictionsSection (3), OperationalEventsSection (3),
ReviewQuestionsSection (3), PoliciesSection (2), ReviewerRepairAlertDetails (1),
PromptTemplatesSection (5). The 403 messages are pinned verbatim by test:
'Admin access required' at `PoliciesSection.js:77`, `ReviewQuestionsSection.js:101`,
`PromptTemplatesSection.js:98`; 'Admin access required for Executor budgets' at
`PromptTemplatesSection.js:117`.

D1-preserve sites (unguarded today; fixed later, not here):
`DynamicsExplorerRestrictionsSection.js:14,25,38` → `requestEnvelope`, `data` used
regardless of `ok`; the :38 DELETE never read a body and uses
`tolerantBody: true` with the result ignored so a 2xx empty body adds no new
rejection. `PoliciesSection.js:363` and `PromptTemplatesSection.js:741` (bare
`.json()` parsed before any check) → `requestEnvelope` with
`envelope.error?.parseError` rethrown, so a malformed non-2xx body still routes
to the same catch a bare `.json()` reaches today. The same rethrow was applied
at `PromptTemplatesSection.js:469` (executor-budgets PUT, guarded, but parsed
before its status checks). Generalization of Stage 2 rule (ii); every case has
a pre- and post-migration passing pin.

Tests added 89 (three new test files: dynamics-explorer-restrictions-section,
site-visit-materials-defaults-section, meeting-tracker-defaults-section; eight
existing files extended). Three test files had their fetch-call matchers
adjusted from "no method" to "no method or GET" because the helper always
passes an explicit init (`{ method: 'GET' }`) where the raw code passed none;
the server cannot distinguish these. No behavioral assertion weakened.

Flagged, not fixed (narrow, pre-existing shape): `PromptTemplatesSection`
`Promise.all` over prompts + models: if prompts returns 403 AND models returns a
2xx malformed body simultaneously, the pre-image short-circuited to 'Admin
access required'; post-migration the models parse may reject first. Not an
axis case; recorded for the reviewer.

Group A gates at `1fa9eb46`: `npm test` 993 suites / 14871 tests green (includes
group B's interleaved commits); lint 0 errors; `check:types` clean. Commits
(test → refactor per file): 61448af3→08d934eb, d0db6515→01d7c73a,
f13f9e82→623fa25e, 3b7646ad→1f96a97a, daadfbfb→e1ca3c19, bbb6fdf3→57c821a0,
0566951e→4f1c2275, b7e07d6e→b6d27985, a87fe90b→e22a8dad, cd114413→3a459d54,
cd245a8d→1fa9eb46.

### Group B: `pages/admin.js` (logged 2026-09-20; fresh review pending)

Seam commit `ef605f78`: named `export` added to `OperationsWorkspace`,
`WorkflowsWorkspace`, `AiWorkspace`, `PeopleWorkspace`; each mounts directly
with `view` as a prop (none needs router or session; only `AdminDashboard`
does), so no mocking. `admin-dynamics-feedback-filters.test.js` fixture gained
`status: 200`; its `toHaveBeenNthCalledWith(1, url)` was loosened to read
`fetch.mock.calls[0][0]` because the helper always passes a second init arg
(URL asserted unchanged). Four new test files: admin-operations-workspace (36),
admin-workflows-workspace (44), admin-ai-workspace (16), admin-people-workspace
(23) = 119 tests, green before and after every migration commit.

32 sites migrated, census matched; `grep -n "fetch(" pages/admin.js` is empty.
Operations (11, `df98cc0a`): :212 health (D1 preserve), :323 health-history,
:497/:509 alerts, :640 maintenance (signal), :763/:791 secrets, :2131/:2154
feedback, :2479/:2569 alert-recipients (`.details`-join derivation verbatim).
Workflows (8, `fd30c767`): Honorarium :2703/:2724, ReleaseAttachments
:2796/:2814, CampaignTimeline :2877/:2919, TimeBudget :3054/:3076. AI (3,
`4f66a3dd`): Usage :938 and ModelConfig :1249 (403 → 'Admin access required'
verbatim), ModelConfig PUT loop :1335 (`requestJson`, tolerant, 'Failed to
save'). People (10, `9d61cdb0` RoleManagement :1583 D1 / :1602 D1 / :1619 /
:1642; `4c33c8d5` AppAccess :1788 / :1888 / :1896 / :1953; `6615ef08`
DynamicsIdentity :2349 / :2365). All `requestEnvelope` except the PUT loop.

Parse-error idiom: at ~13 sites whose pre-image parsed with bare `.json()`
before or without an `ok` check, `if (envelope.error?.parseError) throw
envelope.error.parseError;` reproduces today's native parse-error text on a
malformed non-2xx body. Deliberately NOT applied at AppAccess grant :1888 and
revoke :1896, which now show 'Grant failed' / 'Revoke failed' on a 502 HTML
body instead of the raw parse-error text (D3-permitted; flagged for review).

Group B gates at `6615ef08`: `npm test` 993 suites / 14871 tests green; lint 0
errors; `check:types` clean; `npm run build` compiled with the new page exports.

**Observation O4 (for the owner).** Across Stage 3 both groups reproduced
today's native `SyntaxError` text at ~16 sites via the parse-error rethrow,
which is more conservative than accepted decision D3 permits and adds a line
per site. Options: (a) keep as is; (b) in the D1 follow-up, drop the rethrow
where the site's fallback message is acceptable (recommended: the raw parse
text is never useful to a user); (c) add a helper option so the choice is one
flag, not a hand-written line. No change made in Stage 3.

### Stage 3 fresh review (Opus, no inherited context, at `d5340f7e`) — READY WITH NAMED CHANGES

Confirmed: tests-before-code order for all 12 files (four group-A refactor
commits also carried a GET-shape matcher edit, call-shape only); the seam
commit `ef605f78` is exactly four `export` keywords, four test files, and one
fixture `status`; 20 sampled sites PRESERVED incl. all 8 D1-preserve sites
(no guard added), the four 403 messages verbatim, the `.details` join at
`pages/admin.js:2577-2584`, `signal` at `ReviewerRepairAlertDetails.js:57` and
`pages/admin.js:645`; request bytes unchanged; 255 admin tests green; wrong-form
mutations caught at PromptTemplates :469 and AlertRecipients :2577.

Named changes and dispositions:
1. Four `pages/admin.js` sites show the fallback text instead of the raw parse
   text on a non-2xx unparseable body: ModelConfig PUT :1339 ('Failed to
   save'), Role assign :1629 ('Failed to assign role'), AppAccess grant :1895
   ('Grant failed'), revoke :1903 ('Revoke failed'). All user-visible, never
   silent. **Disposition: keep. This is exactly owner decision D3.** The
   reviewer's own premise challenge reaches the same conclusion. (e) pins added
   at all four in the correction round recording the D3 text. The
   intra-component inconsistency with Role DELETE :1649 (which rethrows the
   parse error) is documented here and resolved globally by O4, not by adding
   more rethrows now.
2. `shared/components/admin/AdminOverviewSection.js:29` was a census row but not
   in the plan's Stage 3 table (the "61 sites" exit count omitted it), so the
   admin grep was not empty. **Disposition: migrate now** (correction round);
   plan §4/§6 corrected to 62 sites.
3. Discrimination gaps: (d) pins at `PromptTemplatesSection.js:469` and
   `pages/admin.js:2577`, a 2xx-empty pin at `ReviewQuestionsSection.js:202`,
   an (e) pin for AlertRecipients load :2486. **Disposition: added** in the
   correction round with mutation evidence.
4. `PromptTemplatesSection` `Promise.all` prompts/models race (403 on one +
   malformed 2xx on the other): pre-existing shape confirmed; **accepted narrow
   deviation, no fix** (both outcomes are error states; the obvious fix would
   perturb the pinned single-endpoint case).

### Stage 3 acceptance — 2026-09-20, orchestrator (Fable), at `a1aaec80`

Correction round (`513d5025` tests, `a0066729` migration of
`AdminOverviewSection.js:29` → `requestJson` tolerant with the site's own
fallback; `a1aaec80` pins): D3 axis-(e) pins at the four `pages/admin.js`
fallback sites; (d) pins at `PromptTemplatesSection.js:469` and the
AlertRecipients PUT; 2xx-empty pin at `ReviewQuestionsSection.js:202`; (e) pin
for AlertRecipients load. Each new discriminating pin was shown red under its
mutation (flip `tolerantBody`, drop the rethrow) and green restored. The admin
grep for raw `fetch(` is empty. The orchestrator read the AdminOverviewSection
diff in full; accepted without a further fresh cycle.

Full Gate G at `a1aaec80` [VERIFIED via this run]: every `check:*` gate and
self-test 0 red; `npm test` 993 suites / 14885 tests green; lint 0 errors;
`check:types` clean; `npm run build` compiled.

Verdict: **Stage 3 ACCEPTED.** 62 admin sites migrated (30 sections + 32
page); 4 workspace seams exported; tests added 215 (89 + 119 + 7). Stage 4
(Tier 2) and the D1 trailing lane (admin batch) start next.

## Stage 4 — reviewer engagement surface (Tier 2)

### Group B: tabs, stores, search hooks (logged 2026-09-20; fresh review pending with group A)

12 files, 37 sites migrated; 5 SSE sites confirmed by reading (response passed
to `readSseStream`) and left raw with the §2.6 allowlist comment:
`useReviewerPromotion.js` enrich-contacts (:62), `useReviewerDiscovery.js`
analyze/discover/enrich-contacts (:76/:120/:191), `useApplicantReviewerEnrichment.js`
enrich-recommended (:48).

| File | Sites | Form | Tests added | Notes |
|---|---|---|---|---|
| `ReviewersTab.js` | 5 | envelope, tolerant | 9 (`reviewers-tab-t4-matrix.test.js`) | 409 + `data.lookup` and 200 + `{success:false}` pinned |
| `ReviewerFindPanel.js` | 5 | envelope, tolerant | 6 | :281 orcid-lookup D1-preserved |
| `CandidateEditModal.js` | 3 | envelope, tolerant | 4 | save PATCH now parses a body it never read; `{}` on malformed, unused on success |
| `CampaignConfigModal.js` | 3 | envelope, tolerant | 6 | defaults GET best-effort swallow preserved |
| `email-template-store.js` | 3 | envelope, tolerant | 8 | :109 best-effort preserved |
| `prompt-override-store.js` | 3 | json strict (load/delete), envelope (save) | 10 | bare-`.json()` sites keep native parse rejection |
| `search/useReviewerContactActions.js` | 8 | envelope, tolerant | 10 (new harness) | 409 + `{success:false, code, promotionAuthority}`, 200 + `{success:false}`, partial-success apply-before-throw pinned |
| `search/useReviewerRosterActions.js` | 4 | json tolerant (exclude ×2, body discarded), envelope (promote, removePrevious) | 9 (new harness) | 409 `data.code` allowlist and `{success:false}` rollback pinned |
| `search/useReviewerPromotion.js` | 3 of 4 | envelope, tolerant | 2 | :188 save-candidates D1-preserved |
| `search/useReviewerDiscovery.js` | 1 of 4 | json, tolerant | 3 | roster-persist POST only |
| `search/useApplicantReviewerEnrichment.js` | 0 of 1 | — | 0 | SSE, comment only |
| `search/useReviewerRoster.js` | 1 | envelope, tolerant | 1 | |

Parse-error policy: every migrated site was already `.json().catch(() => ({}))`
pre-migration, so `tolerantBody: true` is identical on both 2xx and non-2xx;
no axis-(e) change in this group. Two call-shape-only matcher fixes
(`campaign-config-modal.test.js`, `reviewer-search-context-lifecycle.test.js`)
for the explicit GET init, same precedent as Stage 3. Body assertion at
`confirmIdentityContact` uses `toMatchObject` because `pruneCandidateForRoster`
expands the candidate (pre-existing normalizer).

Gates at `b917cc550`: `npm test` 1006 suites / 15043 tests green; lint 0
errors; `check:types` clean; `check:reviewer-engagement-boundary` + self-test
pass. Commits (test/refactor): 65fd3b4a/83a74502, a9eeb5de8/55c3cf166,
7030631ce/81dd31ec9, 246b8e792/dfd7719b7, e4cf8a08b/811cb2a26,
dba965df3/55a64325b, 9cbfdd367/1ba67d6da, d5671d940/959abd521,
b5dd79218/b18cb2981, 5de279a62/a8b072848, 5d7c3bd79 (SSE comments),
3bbc98282/86477449b, b917cc550 (test fix).

### Group A: modals and panels (logged 2026-09-20; fresh review pending)

11 files, 27 JSON sites migrated (all `requestEnvelope`, `tolerantBody: true`,
except `ReviewerInvitePanel.js:249` VIP GET → `requestJson` strict, matching its
bare `.json()`, and `ReviewerManagePanel.js:~743` updateStatus PATCH, see below).
Allowlisted raw sites with the §2.6 comment: `InviteEmailModal.js` send-emails
(SSE via `reviewers/sse.js`), `ReviewerInvitePanel.js:357` (blob export),
`ReleaseMaterialsModal.js` send-emails (SSE `getReader`). D1-preserve:
`InviteEmailModal.js:292` invite-timing GET untouched; :706 sticky save kept
best-effort.

One-site files (AcceptedReviewerReleaseModal preview POST, ReviewerCloseoutModal
close-review, ReviewReminderAction send-review-reminder, ReviewerDueDateEditor
review-due-extension): status-interpolated fallbacks kept via `envelope.status`.
RespondReminderModal (preview, send; `send_unconfirmed` → `uncertain` and catch
→ `uncertain` preserved), RemoveEntirelyModal (preflight GET, DELETE),
ReleaseEmailModal (render-withdraw-emails, withdraw-sufficient), ReleaseMaterialsModal
(4), ReviewerInvitePanel (VIP PUT/DELETE/PATCH tolerant), InviteEmailModal (7
tolerant), ReviewerManagePanel (regenerate/revoke-token, my-candidates DELETE,
reviewers PATCH, 2× terminal-transition).

`ReviewerManagePanel.js` updateStatus PATCH: pre-image was a bare `.json()`
whose own catch shows "Invalid response from the server (HTTP {status})." for a
malformed body at ANY status, reading `response.status` inside the catch.
Reproduced with a function-form `tolerantBody: () => MALFORMED_BODY` sentinel
(keeps `envelope.status` on a malformed 2xx) plus rule (ii) mapping of
`envelope.error?.parseError` for the non-2xx case. The axis-(e) T4 test caught
the missing non-2xx half in the first draft.

Tests added ≈112: extensions to the existing modal/action tests
(reviewer-action-lifetimes, reviewer-status-mutation-characterization,
reviewer-invite-panel-vip-toggle, reviewer-manage-proposal-attachment, and the
one-site files' tests); new `reviewer-invite-panel-remove-restore.test.js` and
`invite-email-modal-t4-matrix.test.js` (markManualInviteSent,
requestAddressRepair, handleSaveAbstract had no coverage). Two first-draft
pins were corrected against source before commit (malformed 2xx VIP PUT and
render-emails bodies are NOT error states: those sites read the body only on
`!ok`).

Process notes: a shared-index race let group B's `a9eeb5de` sweep four of
group A's staged test files into its commit (content correct; attribution off;
history not rewritten). The orchestrator's stash misfire (see the memory note)
briefly blocked a commit with an unrelated conflict; cleaned up.

Gates at `6ac0e51c`: `npm test` 1007 suites / 15070 tests green; lint 0
errors; `check:types` clean; `check:reviewer-engagement-boundary` + self-test
pass; `npm run build` compiled. Commits: a9eeb5de (shared), 435ba78a, 0a6d65d2,
ab29913c, d11647ae, 856a135e, fe293a62, 3aa7b84b, f878d44d, 6ac0e51c.

**Stage 4 totals:** 64 JSON sites migrated across 23 files; 8 SSE/blob sites
allowlisted; 4 D1-preserve sites carried; T4 tests added ≈180. Fresh review,
full Gate G, and the Tier 2 preview rehearsal (owner authorized the branch push
2026-09-20) pending below.

### Stage 4 fresh review (Opus, no inherited context, at `6ac0e51c6`) — READY WITH NAMED CHANGES

No behavior change found at any migrated site. Confirmed: request bytes
PRESERVED at every non-GET invite/reminder/release/closeout/send site (group B
kept literal `JSON.stringify` + headers; group A's object bodies stringify in
the same key order with the same `Content-Type` casing); receipt semantics
PRESERVED (RespondReminderModal `send_unconfirmed` → `uncertain`, catch →
`uncertain`; ReviewReminderAction; InviteEmailModal markManualInviteSent and
requestAddressRepair; ReviewerManagePanel updateStatus sentinel + `parseError`
mapping both halves correct); body-level `.success`/`data.code`/`data.lookup`
branches intact with 200 and 409 fixtures; the a9eeb5de sweep held tests only.

Named changes (hygiene, blocking before merge), applied in the correction round:
1. `InviteEmailModal.js:293` invite-timing GET was left raw instead of migrated
   ungated (the D1-preserve rule is migrate-without-guard, as
   `email-template-store.js:109` was). Migrated.
2. Five group-B §2.6 annotations used a bare `// raw fetch:` form that the
   Stage 6 ratchet will not exempt; normalized to
   `// eslint-disable-next-line no-restricted-syntax -- <reason>`.
3. `useReviewerExport.js:58` blob site had no annotation; added.
4. `ReviewerManagePanel.releaseReviewer` terminal-transition POST had no
   request-bytes pin; added. The withdraw-sufficient body assertion upgraded to
   exact bytes (Tier 2 release write). Other order-insensitive body assertions
   left as is (non-blocking).

Process deviations recorded: four Stage 4 commits combined tests and refactor
(fe293a624, 3aa7b84b3, f878d44d3, 6ac0e51c6), so the "green against unmigrated
code" run is unrecorded for those files though the implementer reports doing
it; 435ba78ad migrated four one-site files in one commit. Three refactor commits
carry call-shape-only test matcher edits (explicit GET init), same precedent as
Stage 3.

Premise challenge accepted as a follow-up, not a Stage 4 change: on the send
routes a malformed/unparseable 2xx most likely means the email DID go out, yet
`RespondReminderModal.js:122`, `ReviewReminderAction.js:114`, and
`ReviewerDueDateEditor.js:129` render `failed` and invite a resend. Faithfully
preserved here; recorded as D10 in the D1 follow-up doc.

### Stage 4 acceptance (code) — 2026-09-20, orchestrator (Fable), at `d82f24df4`; Tier 2 rehearsal pending

Correction round (`c6b47178f`/`4e7238bd8` invite-timing GET migrated ungated;
`7d0abb13d` annotations normalized to the eslint-disable form, `useReviewerExport.js:58`
annotated; `d82f24df4` exact request-bytes pins for the terminal-transition
release POST and withdraw-sufficient). All nine remaining raw `fetch(` sites in
`shared/components/reviewers/**` carry the ratchet-compatible annotation
[VERIFIED by the implementer's grep]. Transient: those annotations register as
"unused eslint-disable directive" warnings until Stage 6 wires the rule (lint
0 errors, 123 warnings vs 114 baseline; returns to baseline at Stage 6).

Full Gate G at `d82f24df4` [VERIFIED via this run]: every `check:*` gate and
self-test 0 red; `npm test` 1007 suites / 15077 tests green; lint 0 errors;
`check:types` clean; `npm run build` compiled.

Branch pushed to `origin/feature/client-request-layer` at `d82f24df4` for the
Vercel preview (owner authorized 2026-09-20). **Tier 2 rehearsal (owner
decision 2/4/5): the owner's click-through of invite preview, reminder
preview, release, closeout, and due-date flows in the preview, Mode A
(route-mocked data). Record the result here when done.** Code is accepted;
Stage 4 closes when the rehearsal is recorded.

Stage 4 totals: 65 JSON sites migrated across 23 files (64 + the invite-timing
GET); 9 SSE/blob sites allowlisted; 3 D1-preserve sites carried to the D1 lane
(ReviewerFindPanel :281, ReviewersTab :210, useReviewerPromotion :188) plus
D10's three send sites. Stages 5a, 5b, and the D1 Stage-4 batch start next.

### Stage 4 rehearsal setup — 2026-09-20 (owner-authorized preview)

- Push: `origin/feature/client-request-layer` at `d82f24df4`; Vercel preview
  `wmkfresearchapps-dpe11n60z` built Ready.
- Entra rejected the immutable deployment host (AADSTS50011), as
  `docs/AUTHENTICATION_SETUP.md` §1.5 predicts. Applied the documented method:
  the registered stable alias `wmkfresearchapps-preview.vercel.app` (previously
  unassigned; `vercel alias ls` showed no target, `vercel inspect` found none)
  was pointed at the deployment.
- The open queue item "Preview CSRF origin check rejects alias-hosted POSTs"
  applies: `lib/utils/auth.js validateOrigin` derives the Preview origin from
  `VERCEL_URL`. Applied the queue's documented workaround: branch-scoped Preview
  env `NEXTAUTH_URL=https://wmkfresearchapps-preview.vercel.app` for
  `feature/client-request-layer` (`vercel env add`, verified via `vercel env ls`),
  then `vercel redeploy` → `wmkfresearchapps-gp0rk903t` (Ready), alias re-pointed
  to it. First redirect from the alias is Vercel deployment protection
  (`vercel.com/sso-api`), expected for previews.
- NOT set by the orchestrator: `DATAVERSE_ALLOW_PROD_READS` for this branch's
  previews (a production-data read decision the owner makes; prior smoke
  branches set it branch-scoped). Without it the Reviewers roster will not load
  from production Dataverse.
- Rollback of the setup: `vercel alias rm wmkfresearchapps-preview.vercel.app`
  (returns the alias to unassigned) and `vercel env rm NEXTAUTH_URL preview
  feature/client-request-layer`. Neither touches production.
