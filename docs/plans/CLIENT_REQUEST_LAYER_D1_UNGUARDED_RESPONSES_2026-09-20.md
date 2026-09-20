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
| `pages/admin.js:212` | GET | `'/api/health'` | none (defaults) | no | **unguarded** — `.then(setHealth)` runs on the raw parsed body; a non-2xx `{error}` body becomes `health`, so `Object.entries(health.services||{})` is empty and the health widget silently shows nothing. No message. |
| `pages/admin.js:1583` | GET | `'/api/dynamics-explorer/roles'` | partial (401/403 only) | no | **unguarded** — checks `r.status===403\|\|401` (sets `callerRole:'denied'`) but any other non-2xx (e.g. 500) falls through to `r.json()` unchecked; `data.callerRole`/`data.roles` are undefined so the section silently shows nothing. |
| `pages/admin.js:1602` | GET | `'/api/user-profiles?all=true'` | swallowed | no | **unguarded** — no ok check; `.catch(()=>{})` only covers network errors. Non-2xx `{error}` body → `data.profiles` undefined → `setUsers([])`, no message. |
| `pages/dynamics-explorer.js:153` | GET | ``/api/dynamics-explorer/roles?userProfileId=${profileId}`` | swallowed | no | **unguarded** — `.then(data=>setUserRole(data.callerRole||data.role||'read_only'))`; a non-2xx `{error}` body silently resolves to the `'read_only'` default. |
| `pages/dynamics-explorer.js:476` | POST | `'/api/dynamics-explorer/feedback'` | console-only | no | **intentional** — no `.json()` call at all; `catch` only `console.error`s network failures. Best-effort feedback submission, same shape as `InviteEmailModal.js:706`, but undocumented by comment (gap noted below). |
| `pages/phase-ii-writeup.js:263` | POST | `'/api/qa'` (not "dynamic" — corrected) | n/a | no | **guarded-elsewhere** — census matched a comment line (`// drives both fetch() above...`), not a fetch call. The real fetch is at :240; `if (!response.ok)` guard is at :253, before any body use. |
| `pages/scheduled-emails.js:59` | GET | `'/api/email-automation-preferences'` | swallowed | yes | **unguarded** — inside `Promise.all([...].then(r=>r.json().catch(()=>({}))))`; no ok check on either response. Non-2xx `{error}` → `preference` object shaped wrong → `setReviewAll(false)` silently (review-all override appears off with no message). |
| `pages/scheduled-emails.js:61` | GET | `'/api/scheduled-emails/vip-flags'` | swallowed | yes | **unguarded** — same `Promise.all` block as :59; non-2xx `{error}` → `flags?.flags` undefined → `setVipContactIds(new Set())`, silently clearing VIP flags in the UI with no message. |
| `pages/virtual-review-panel.js:1030` | GET | `'/api/virtual-review-panel'` | swallowed | no | **unguarded** — no ok check; `.catch(()=>{/* use defaults */})` only covers network errors. Non-2xx `{error}` body → `data.providers` falsy → `if (data.providers)` skips, silently keeping the `useState` defaults. Low-severity (comment shows this fallback is deliberate for the *network* case, but not for a non-2xx JSON error case). |
| `shared/components/admin/DynamicsExplorerRestrictionsSection.js:14` | GET | `'/api/dynamics-explorer/restrictions'` | none | no | **unguarded** — no ok check; `.catch(()=>setLoading(false))` only covers network errors. Non-2xx `{error}` → `data.restrictions` undefined → `setRestrictions([])`, renders empty list, no message. |
| `shared/components/admin/DynamicsExplorerRestrictionsSection.js:25` | POST | `'/api/dynamics-explorer/restrictions'` | none | no | **unguarded** — `if (data.restriction) {...}`; on non-2xx `{error}` the `if` is false and the function silently no-ops — new restriction not added, form not reset, no message. |
| `shared/components/admin/DynamicsExplorerRestrictionsSection.js:38` | DELETE | `'/api/dynamics-explorer/restrictions'` | none | no | **unguarded** — does not even call `.json()`; `setRestrictions(...)` filters the id out **unconditionally** after the `await fetch(...)`, so a failed server-side delete still removes the row from the UI optimistically. Worth flagging separately from "reads an error body" since no body is read at all. |
| `shared/components/admin/PoliciesSection.js:363` | POST | `'/api/admin/policies'` | broken banner | no | **unguarded** — `if (data.status==='completed'\|\|'already_published') onSuccess else onOutcome(data)`; the else path *does* fire, but a non-2xx `{error}` body lacks `status`, so `STATUS_COPY[undefined]` (`:253`) renders `tone:'gray'`, `text: undefined` — the banner appears with no visible message. |
| `shared/components/admin/PromptTemplatesSection.js:93` | GET | `'/api/admin/prompts'` | n/a | no | **guarded-elsewhere** — inside `Promise.all([...]).then(...)`; explicit `if (!promptResponse.ok) throw ...` and `if (!modelResponse.ok) throw ...` at :98-99, before either body is used. |
| `shared/components/admin/PromptTemplatesSection.js:741` | PUT | ``/api/admin/prompts/${encodeURIComponent(prompt.name)}`` | broken banner | no | **unguarded** — same `onOutcome(data)`-always-fires pattern as `PoliciesSection.js:363`; `STATUS_COPY[outcome.status]` (:866) with `outcome.status===undefined` renders a banner with no message. |
| `shared/components/meeting-tracker/MeetingTrackerList.js:133` | GET | ``/api/meeting-tracker/dashboard${query.size?`?${query}`:''}`` | n/a | no | **guarded-elsewhere** — `if (!dashboardResponse.ok) throw new Error(dashboard.error \|\| ...)` at :143, before use. |
| `shared/components/meeting-tracker/MeetingTrackerList.js:134` | GET | `'/api/meeting-tracker/sessions'` | n/a | no | **guarded-elsewhere** — `if (!sessionsResponse.ok) throw new Error(sessionBody.error \|\| ...)` at :144, same block as :133. |
| `shared/components/meeting-tracker/SessionEditor.js:321` | GET | `'/api/meeting-tracker/recipients'` | n/a | no | **guarded-elsewhere** — already documented (§3 intro): `responses.findIndex((r)=>!r.ok)` at :326-327, before the bodies are used. |
| `shared/components/meeting-tracker/SessionEditor.js:321` | GET | `'/api/meeting-tracker/sessions'` | n/a | no | **guarded-elsewhere** — same `findIndex(!ok)` guard as the row above (one `Promise.all` call). |
| `shared/components/meeting-tracker/SiteVisitEditor.js:114` | GET | ``/api/meeting-tracker/visits/${encodeURIComponent(requestId)}`` | n/a | no | **guarded-elsewhere** — routed through the file's local `readJson(response, fallback)` helper (:62-69), which checks `!response.ok` and throws before returning the body. Distinct from the shared `readResponse` the census already excludes. |
| `shared/components/meeting-tracker/SiteVisitEditor.js:115` | GET | `'/api/meeting-tracker/recipients'` | n/a | no | **guarded-elsewhere** — same local `readJson` helper as :114. |
| `shared/components/meeting-tracker/SiteVisitEditor.js:172` | PATCH | ``/api/meeting-tracker/visits/${encodeURIComponent(requestId)}`` | n/a | no | **guarded-elsewhere** — same local `readJson` helper, used in `save()`. |
| `shared/components/reviewers/InviteEmailModal.js:292` | GET | ``/api/user-preferences?key=${encodeURIComponent(PREFERENCE_KEYS.INVITE_TIMING)}`` | swallowed | no | **unguarded** — no ok check; `.catch(()=>({}))`. Non-2xx `{error}` → `data?.value` falsy → `nextTiming` stays `{}`, silently keeping default invite timing, no message. |
| `shared/components/reviewers/InviteEmailModal.js:706` | POST | `'/api/user-preferences'` | none (comment: best-effort) | no | **intentional** — comment: "sticky save is best-effort"; catch is a no-op, no `.json()` call at all. Corrects the table's prior "setError-state" label — there is no `setError` call in `persistTiming`. |
| `shared/components/reviewers/InviteEmailModal.js:735` | POST | `'/api/review-manager/send-emails'` | n/a | yes | **guarded-elsewhere** — body is an SSE stream read via `readSseStream(res, ...)` (`shared/components/reviewers/sse.js:58-60`), which throws `if (!response.ok)` before touching the stream. Failure *within* a 200 stream is reported through `event: error` / `email_failed` frames, which the caller already handles (see §3b). |
| `shared/components/reviewers/ReviewerFindPanel.js:281` | POST | `'/api/workbench/orcid-lookup'` | misleading message | no | **unguarded** — no ok check; `data.found`/`data.ambiguous` both falsy on a non-2xx `{error}` body, so the code falls to the final `else` and shows "No confident ORCID match found. Enter it manually if you have it." — a real server error is presented to staff as "no match," discarding `data.error` entirely. |
| `shared/components/reviewers/ReviewersTab.js:210` | GET | ``/api/reviewer-finder/my-candidates?requestId=${encodeURIComponent(rid)}`` | swallowed | no | **unguarded** — no ok check; `.catch(()=>({}))`. Non-2xx `{error}` → `prop`/`rows` undefined → `setCandidates([])`, silently renders an empty candidate list. |
| `shared/components/reviewers/email-template-store.js:109` | GET | ``/api/user-preferences?key=${encodeURIComponent(PREFERENCE_KEYS.EMAIL_TEMPLATES)}`` | none (comment: best-effort) | no | **intentional** — function doc comment: "Best-effort — never throws; missing layers degrade to blank" (:103-104). Falls through to `mergeTemplates(null, adminDefaults)` on any failure by design. |
| `shared/components/reviewers/search/useApplicantReviewerEnrichment.js:47` | POST | `'/api/workbench/enrich-recommended'` | n/a | no | **guarded-elsewhere** — SSE via `readSseStream(res, ...)`, same `!response.ok` throw as `InviteEmailModal.js:735`. |
| `shared/components/reviewers/search/useReviewerDiscovery.js:74` | POST | `'/api/reviewer-finder/analyze'` | n/a | no | **guarded-elsewhere** — SSE via `readSseStream(aRes, ...)`. |
| `shared/components/reviewers/search/useReviewerDiscovery.js:117` | POST | `'/api/reviewer-finder/discover'` | n/a | no | **guarded-elsewhere** — SSE via `readSseStream(dRes, ...)`. |
| `shared/components/reviewers/search/useReviewerDiscovery.js:187` | POST | `'/api/reviewer-finder/enrich-contacts'` | n/a | no | **guarded-elsewhere** — SSE via `readSseStream(eRes, ...)`. |
| `shared/components/reviewers/search/useReviewerPromotion.js:60` | POST | `'/api/reviewer-finder/enrich-contacts'` | n/a | no | **guarded-elsewhere** — SSE via `readSseStream(enrichmentResponse, ...)`. |
| `shared/components/reviewers/search/useReviewerPromotion.js:188` | POST | `'/api/reviewer-finder/save-candidates'` | n/a | no | **guarded-elsewhere** — `sData` is parsed at :198 without an immediate check, but `if ((!sRes.ok \|\| !sData.success) && saved===0)` at :267 gates the failure path before the function returns; census missed the check because it's several statements later, not adjacent to the body read. |
| `shared/components/workbench/ConsultantFeedbackSection.js:297` | GET | ``/api/workbench/consultant-feedback?requestId=${encodeURIComponent(requestId)}`` | n/a | no | **guarded-elsewhere** — `if (!entriesRes.ok) throw new Error(entriesData.error \|\| ...)` at :302; `consultantsRes.ok ? ... : []` ternary at :304 for the second call. |
| `shared/components/workbench/RequestListPanel.js:125` | GET | ``/api/workbench/dashboard?cycleCode=${...}&scope=${...}&programId=${...}...`` (not "dynamic" — corrected) | n/a | no | **guarded-elsewhere** — `if (!res.ok) {...}` at :137, immediately after the body parse. |
| `shared/components/workbench/ReviewerFollowUpPanel.js:200` | GET | ``/api/workbench/dashboard?cycleCode=${...}&scope=${...}&programId=${...}`` | n/a | yes | **guarded-elsewhere** — `if (!dashboardResponse.ok) throw ...` and `if (!reviewerResponse.ok) throw ...` at :206-210, before either body is used. |
| `shared/components/workbench/useSiteVisitContext.js:34` | GET | ``/api/workbench/site-visit/logistics?requestId=${encodeURIComponent(requestId)}`` | silent no-op | no | **guarded-elsewhere** — `if (cancelled \|\| !logisticsResponse.ok \|\| !directoryResponse.ok) return;` does check both statuses (census false positive), but note: on failure it silently `return`s without setting `context` or any error state — worth a separate UX follow-up, not a D1 unguarded-response defect. |

Regenerate this table from the census after any migration stage lands; line
numbers drift.

### 3a. Confirmed set

Verdict counts (38 rows, all confirmed this pass): **unguarded 15, guarded-elsewhere
20, intentional 3**.

Unguarded sites, grouped by the migration stage their file belongs to (stage
assignments from the execution log's source-to-stage map):

- **Stage 3 (Admin surface)** — 8 sites:
  - `pages/admin.js:212` (`/api/health`)
  - `pages/admin.js:1583` (`/api/dynamics-explorer/roles`)
  - `pages/admin.js:1602` (`/api/user-profiles?all=true`)
  - `shared/components/admin/DynamicsExplorerRestrictionsSection.js:14` (GET restrictions)
  - `shared/components/admin/DynamicsExplorerRestrictionsSection.js:25` (POST restrictions)
  - `shared/components/admin/DynamicsExplorerRestrictionsSection.js:38` (DELETE restrictions)
  - `shared/components/admin/PoliciesSection.js:363` (POST policies)
  - `shared/components/admin/PromptTemplatesSection.js:741` (PUT prompt)
- **Stage 4 (Reviewer engagement surface, Tier 2)** — 3 sites:
  - `shared/components/reviewers/InviteEmailModal.js:292` (GET invite timing)
  - `shared/components/reviewers/ReviewerFindPanel.js:281` (POST orcid-lookup)
  - `shared/components/reviewers/ReviewersTab.js:210` (GET my-candidates)
- **Stage 5a (Long tail, internal, Tier 1)** — 2 sites:
  - `pages/dynamics-explorer.js:153` (GET roles by profileId)
  - `pages/virtual-review-panel.js:1030` (GET providers)
- **Stage 5b (Long tail, external/email, Tier 2)** — 2 sites:
  - `pages/scheduled-emails.js:59` (GET email-automation-preferences, campaign-critical)
  - `pages/scheduled-emails.js:61` (GET vip-flags, campaign-critical)

8 + 3 + 2 + 2 = 15, matching the unguarded verdict count above.

Guarded-elsewhere (20) and intentional (3) sites need no D1 fix; §4 only
applies to the 15 unguarded sites above.

### 3b. Campaign-critical route shapes

- **`pages/api/email-automation-preferences.js`** (GET/PUT): 200 `{configured, preference}` on success, 400 `{error}` (invalid preference body), 405 `{error}` (wrong method), 500 `{error}` (save failed, PUT only). No 2xx body carries partial failure — it is a single boolean preference, success or nothing (`pages/api/email-automation-preferences.js:34-56`).
- **`pages/api/scheduled-emails/vip-flags.js`** (GET/PUT): 200 `{flags:[...]}` (GET) or `{contactId, flagged}` (PUT), 400 `{error}` (bad contactId/flagged), 403 `{error}` (profile not linked to a Dynamics user), 405 `{error}` (wrong method). No 2xx body carries partial failure — single-flag operations (`pages/api/scheduled-emails/vip-flags.js:32-53`).
- **`pages/api/review-manager/send-emails.js`** (POST, SSE): pre-stream JSON errors are 405 `{error}` (wrong method), 400 `{error}` (no sender email), or the authorization service's `ServiceHttpError` status/body (`pages/api/review-manager/send-emails.js:58-98`). Once SSE headers are sent (`:101-103`) the route always resolves 200; "failure" is expressed inside the stream via `event: error {message}` (terminal, no `result`/`complete` follows), or via the `result`/`complete` frames' `failed`/`skipped`/`unconfirmed` arrays alongside `sent` (`pages/api/review-manager/send-emails.js:26-30`, per the route's header comment). So **a 2xx response absolutely can carry partial failure** — per-recipient outcomes inside `result`/`complete`, not the HTTP status. `InviteEmailModal.js:735`'s client already branches on `event==='error'`, `email_failed`, and the `result` frame's arrays, so this site's guard is adequate for that shape — no D1 fix needed here, but it is why the row is tagged Tier 2 in §4 point 4.

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

## 7. Confirmation pass log

2026-09-20 confirmation pass: read 26 files (22 client call-site files, `shared/components/reviewers/sse.js`, and the 3 campaign-critical route handlers) to confirm all 38 §3 rows. Most surprising findings: (1) two rows (`PoliciesSection.js:363`, `PromptTemplatesSection.js:741`) look guarded — they always call `onOutcome(data)` on failure — but a non-2xx `{error}` body has no `status` field, so `STATUS_COPY[undefined]` renders an outcome banner with no visible text; the "guard" exists but the message is lost, so these are still `unguarded`. (2) Two files (`SiteVisitEditor.js`, `SessionEditor.js`) each define their own local, unshared `readJson`/`sendJson` helper that does check `.ok` and throw — the census's "13 sites pass through `readResponse`" exclusion missed these because they're not the shared helper, accounting for 5 of the 20 `guarded-elsewhere` sites. (3) `DynamicsExplorerRestrictionsSection.js:38` (DELETE) doesn't read a response body at all — it removes the row from the UI unconditionally after the `fetch`, regardless of whether the delete succeeded server-side — a distinct defect from the "misread error body" pattern this plan targets.

## 8. Sibling defect D9: `ErrorAlert` prop mismatch (found Stage 2, 2026-09-20)

`shared/components/ErrorAlert.js:45` is `function ErrorAlert({ error, onDismiss, className })`.
Six client call sites render `<ErrorAlert message={error} ... />`, so the
component receives `error: undefined` and shows nothing [VERIFIED via grep,
2026-09-20]: `pages/expertise-finder.js:250,388,851`,
`pages/dataverse-bulk-export.js:471`, `pages/virtual-review-panel.js:1296`,
`pages/phase-i-dynamics.js:152`.
Fix: rename the prop at each call site to `error=`; add one render assertion
per site that the message text appears. Tier 1. Same user-facing family as D1
(an error that never reaches the user); ship it with the D1 fixes.

## 9. D1 fixes — admin batch (built 2026-09-20; fresh review pending)

Trailing lane, run after Stage 3 acceptance on files disjoint from Stage 4.
Tests committed first (red against the accepted Stage 3 code by design), fix
second (green). Each site routes `envelope.error.message` to the surface the
file already had; the 2xx path is unchanged.

| Site | Old on non-2xx | New | Commits |
|---|---|---|---|
| `pages/admin.js` HealthSection (~:215) | non-2xx body rendered as health data | thrown into the existing network-failure catch → `overall:'error'`; `health.error` now rendered beside the timestamp (was set, never shown) | `c72e72ce` / `4d9a5fd9` |
| `pages/admin.js` RoleManagement roles (~:1586) | only 401/403 handled | 401/403 verbatim; other `!ok` → existing `message` banner; banner relocated so the section no longer vanishes for non-superusers on load failure | same |
| `pages/admin.js` user-profiles (~:1609) | body used as list | `!ok` → existing `message` banner | same |
| `DynamicsExplorerRestrictionsSection.js` GET/POST | silent | `setError(envelope.error.message)` via a minimal new `error` state + inline `<p>` (the section had no surface; sibling PoliciesSection pattern) | `5f85a0ef` / `47456bf8` |
| `DynamicsExplorerRestrictionsSection.js` DELETE | row removed optimistically | row stays; error shown | same |
| `PoliciesSection.js` POST | `onOutcome(data)` with `status` undefined → blank banner | structured `data.status` outcomes unchanged; no-`status` non-2xx → `onOutcome({ status:'failed', warnings:[message] })` (the existing catch shape); `parseError` rethrow removed per D3 | `e4e220bc` / `16719450` |
| `PromptTemplatesSection.js` PUT | same as above | same as above | `aae33102` / `a03160e8` |
| D9 `pages/expertise-finder.js` :250/:388/:851 | `message=` prop ignored → blank | `error=`; new `tests/unit/expertise-finder-error-alert.test.js` renders the real `ErrorAlert` | `b9ae8f47` / `0bd8d81d` |

Two previously passing Stage 3 pins (raw parse text on an unparseable non-2xx
at the policies and prompts sites) were updated to `Request failed (502)`,
consistent with owner decision D3. Gates at `0bd8d81d`: `npm test` 1001 suites /
14986 tests green; lint 0 errors; `check:types` clean.

Remaining D1 sites by stage: Stage 4 (InviteEmailModal :292, ReviewerFindPanel
:281, ReviewersTab :210, useReviewerPromotion :188 per census) after Stage 4
acceptance; Stage 5a (dynamics-explorer :153, virtual-review-panel :1030) and
5b (scheduled-emails :59, :61, campaign-critical, Tier 2) after theirs. D9's
other three sites ride with Stage 5a.
