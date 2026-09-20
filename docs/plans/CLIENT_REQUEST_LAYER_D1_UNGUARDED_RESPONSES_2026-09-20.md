---
title: Client Request Layer D1 Follow-Up — Unguarded Response Handling
domain: platform
kind: plan
status: active
summary: Owner-prioritized follow-up to fix the client call sites that read a response body without checking HTTP status, sequenced after each site is migrated onto the shared request helper.
canonical: false
owner: product-engineering
related:
  - docs/plans/CLIENT_REQUEST_LAYER_PLAN_2026-09-19.md
  - docs/plans/CLIENT_REQUEST_LAYER_EXECUTION_2026-09-19.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
---

# Client Request Layer D1 Follow-Up: Unguarded Response Handling

**Owner decision (2026-09-20):** "Fixing this is a priority." The migration
plan preserves today's behavior at these sites (decision (1) in the plan's §9);
this document is the fix, scheduled as its own work item so a different agent
can pick it up cold.

## 1. What the defect is

Some client call sites read the JSON body of a response and act on it without
first checking `response.ok`. When the server answers with a non-2xx status
and an `{ error: "..." }` body (the repo's universal error shape; plan §2.2),
those sites treat the error object as data: lists render empty, a save appears
to succeed, or a stale value stays on screen, with no message to the user. The
symptom staff see is "the page did nothing" rather than an error.

## 2. What is already true when you start

Read the plan (`docs/plans/CLIENT_REQUEST_LAYER_PLAN_2026-09-19.md`) §3 and the
execution log's stage status before anything else. Two facts change how you work:

- `shared/utils/api-request.js` exists (Stage 0, accepted 2026-09-20). Its
  throwing form `requestJson` raises `ApiRequestError` on non-2xx with the
  server's message; the non-throwing `requestEnvelope` returns `{ ok, status,
  data, error }`. Fixing an unguarded site is therefore a one-line change once
  the site is on the helper: switch it from `requestEnvelope` to `requestJson`
  (or add `if (!envelope.ok)` handling) and route the message to the surface
  the file already uses.
- The migration stages (plan §4) move sites onto the helper WITHOUT changing
  behavior. Do not fix a site before its stage has migrated it: the
  characterization tests for that file pin today's behavior and will fail. Fix
  sites only in files whose stage is marked accepted in the execution log, or
  as a deliberate follow-on stage after Stage 6.

## 3. Candidate sites

The Stage 0 census (`node scripts/census-client-fetch-sites.js --out <dir>`,
column `ok_check=false`, no `wrapper`, body kind json/unknown) lists **38
candidates in 28 files**. The census is a regex heuristic and overcounts:
`shared/components/meeting-tracker/SessionEditor.js:321-327` reads bodies first
and then checks `responses.findIndex((r) => !r.ok)`, which IS a guard the
pattern misses [VERIFIED by reading it]. Excluded already: 13 sites that pass
through `readResponse` (which checks `ok`), 4 stream/fire-and-forget sites.

**Step 1 of the work is to confirm each row by reading the code** and fill the
last column: `unguarded` (fix), `guarded-elsewhere` (drop), or `intentional`
(document why). Expect the confirmed set to be noticeably smaller than 38.

| Site | Method | Endpoint | Error surface today | Campaign-critical | Verdict |
|---|---|---|---|---|---|
| `pages/admin.js:212` | GET | `'/api/health'` | unknown | no | — |
| `pages/admin.js:1583` | GET | `'/api/dynamics-explorer/roles'` | unknown | no | — |
| `pages/admin.js:1602` | GET | `'/api/user-profiles?all=true'` | setError-state | no | — |
| `pages/dynamics-explorer.js:153` | GET | ``/api/dynamics-explorer/roles?userProfileId=${profileId}`` | setError-state | no | — |
| `pages/dynamics-explorer.js:476` | POST | `'/api/dynamics-explorer/feedback'` | console-only | no | — |
| `pages/phase-ii-writeup.js:263` | GET | `dynamic` | setError-state | no | — |
| `pages/scheduled-emails.js:59` | GET | `'/api/email-automation-preferences'` | unknown | yes | — |
| `pages/scheduled-emails.js:61` | GET | `'/api/scheduled-emails/vip-flags'` | setError-state | yes | — |
| `pages/virtual-review-panel.js:1030` | GET | `'/api/virtual-review-panel'` | setError-state | no | — |
| `shared/components/admin/DynamicsExplorerRestrictionsSection.js:14` | GET | `'/api/dynamics-explorer/restrictions'` | unknown | no | — |
| `shared/components/admin/DynamicsExplorerRestrictionsSection.js:25` | POST | `'/api/dynamics-explorer/restrictions'` | unknown | no | — |
| `shared/components/admin/DynamicsExplorerRestrictionsSection.js:38` | DELETE | `'/api/dynamics-explorer/restrictions'` | unknown | no | — |
| `shared/components/admin/PoliciesSection.js:363` | POST | `'/api/admin/policies'` | swallowed | no | — |
| `shared/components/admin/PromptTemplatesSection.js:93` | GET | `'/api/admin/prompts'` | unknown | no | — |
| `shared/components/admin/PromptTemplatesSection.js:741` | PUT | ``/api/admin/prompts/${encodeURIComponent(prompt.name)}`` | swallowed | no | — |
| `shared/components/meeting-tracker/MeetingTrackerList.js:133` | GET | ``/api/meeting-tracker/dashboard${query.size ? `` | unknown | no | — |
| `shared/components/meeting-tracker/MeetingTrackerList.js:134` | GET | `'/api/meeting-tracker/sessions'` | unknown | no | — |
| `shared/components/meeting-tracker/SessionEditor.js:321` | GET | `'/api/meeting-tracker/recipients'` | unknown | no | — |
| `shared/components/meeting-tracker/SessionEditor.js:321` | GET | `'/api/meeting-tracker/sessions'` | unknown | no | — |
| `shared/components/meeting-tracker/SiteVisitEditor.js:114` | GET | ``/api/meeting-tracker/visits/${encodeURIComponent(requestId)` | unknown | no | — |
| `shared/components/meeting-tracker/SiteVisitEditor.js:115` | GET | `'/api/meeting-tracker/recipients'` | setError-state | no | — |
| `shared/components/meeting-tracker/SiteVisitEditor.js:172` | PATCH | ``/api/meeting-tracker/visits/${encodeURIComponent(requestId)` | setError-state | no | — |
| `shared/components/reviewers/InviteEmailModal.js:292` | GET | ``/api/user-preferences?key=${encodeURIComponent(PREFERENCE_K` | swallowed | no | — |
| `shared/components/reviewers/InviteEmailModal.js:706` | POST | `'/api/user-preferences'` | setError-state | no | — |
| `shared/components/reviewers/InviteEmailModal.js:735` | POST | `'/api/review-manager/send-emails'` | unknown | yes | — |
| `shared/components/reviewers/ReviewerFindPanel.js:281` | POST | `'/api/workbench/orcid-lookup'` | unknown | no | — |
| `shared/components/reviewers/ReviewersTab.js:210` | GET | ``/api/reviewer-finder/my-candidates?requestId=${encodeURICom` | swallowed | no | — |
| `shared/components/reviewers/email-template-store.js:109` | GET | ``/api/user-preferences?key=${encodeURIComponent(PREFERENCE_K` | swallowed | no | — |
| `shared/components/reviewers/search/useApplicantReviewerEnrichment.js:47` | POST | `'/api/workbench/enrich-recommended'` | setError-state | no | — |
| `shared/components/reviewers/search/useReviewerDiscovery.js:74` | POST | `'/api/reviewer-finder/analyze'` | throw | no | — |
| `shared/components/reviewers/search/useReviewerDiscovery.js:117` | POST | `'/api/reviewer-finder/discover'` | unknown | no | — |
| `shared/components/reviewers/search/useReviewerDiscovery.js:187` | POST | `'/api/reviewer-finder/enrich-contacts'` | throw | no | — |
| `shared/components/reviewers/search/useReviewerPromotion.js:60` | POST | `'/api/reviewer-finder/enrich-contacts'` | throw | no | — |
| `shared/components/reviewers/search/useReviewerPromotion.js:188` | POST | `'/api/reviewer-finder/save-candidates'` | unknown | no | — |
| `shared/components/workbench/ConsultantFeedbackSection.js:297` | GET | ``/api/workbench/consultant-feedback?requestId=${encodeURICom` | unknown | no | — |
| `shared/components/workbench/RequestListPanel.js:125` | GET | `dynamic` | setError-state | no | — |
| `shared/components/workbench/ReviewerFollowUpPanel.js:200` | GET | ``/api/workbench/dashboard?cycleCode=${encodeURIComponent(sel` | unknown | no | — |
| `shared/components/workbench/useSiteVisitContext.js:34` | GET | ``/api/workbench/site-visit/logistics?requestId=${encodeURICo` | unknown | no | — |

Regenerate this table from the census after any migration stage lands; line
numbers drift.

## 4. Fix pattern per site

For each confirmed `unguarded` site, in the file's existing style:
1. If the file is already on the helper: use `requestJson` with the file's
   fallback message, or check `envelope.ok`, and send `error.message` to the
   surface the file already uses (`setError`, toast, throw to caller). Do not
   introduce a new surface.
2. If the file is not yet migrated: wait for its stage, or migrate the whole
   file per plan §6 first. Never patch a raw `fetch` site with an ad hoc check
   and leave it off the helper.
3. Add one test per fixed site: non-2xx `{ error: 'X' }` now produces the
   visible error, and 2xx behavior is unchanged. Extend the file's existing
   test (the plan's §5 lists them).
4. For the 4 campaign-critical rows (`scheduled-emails.js:59,61`,
   `InviteEmailModal.js:735`, the send-emails POST), treat the fix as Tier 2:
   a wrong guard there could report an email as sent or unsent incorrectly.
   Read the route's response shape before deciding what "failure" means at
   that site; `pages/api/review-manager/send-emails` may return partial
   success in a 2xx body.

## 5. Tiering and release

Tier 1 for internal reads; Tier 2 for the campaign-critical rows and any site
whose new error path changes what a user is told about an email or invite.
Land on the `feature/client-request-layer` branch after the relevant migration
stage, or on a short branch from `main` after the migration ships. Each fix is
its own commit naming the file and the behavior change; the execution log gets
a "D1 fixes" section listing site, old behavior, new behavior, test.

## 6. Where this is tracked

- Plan §9 decision (1) and ledger row D1 point here.
- `docs/CURRENT_WORK_QUEUE.md` current sequence carries the queue entry.
- The next session's `SESSION_PROMPT.md` names this as a priority item.
