---
title: Client Request Layer Migration Plan
domain: platform
kind: plan
status: active
summary: Staged introduction of one shared client-side JSON request helper and migration of the raw fetch call sites in client components and pages onto it, preserving each call site's visible error behavior except owner decision D3 on non-2xx non-JSON bodies.
canonical: false
owner: product-engineering
related:
  - docs/plans/REVIEWER_SEARCH_WORKSPACE_DECOMPOSITION_PLAN_2026-09-18.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/CI_GATES_REFERENCE.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Client Request Layer Migration

Planning baseline: `main` at `e269756a` (2026-09-19). Test baseline: 984 suites /
14,486 tests green in 32 s and every `check:*` gate and self-test green
[VERIFIED via this session's own runs; the P-A reviewer re-confirmed the suite
count only].

## 1. Decision, scope, and authorization

**Chosen refactor:** introduce one shared client-side request helper and migrate
the raw `fetch(` call sites in `shared/components/**` and `pages/**` (excluding
`pages/api/**`) onto it, one bounded group of files per stage, with each call
site keeping the visible error behavior it has today, except two deliberate
deviations: D3 (§9, an owner decision, not a plan default) and D4 (the
abort-during-body defect fix, §3 invariant 4).

**Why this one.** Two independent surveys on 2026-09-19 ranked the repo's large
unplanned refactors. Every large backend service already has a decomposition plan
or a recorded deferral (`docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md`,
`docs/plans/GRAPH_SERVICE_DECOMPOSITION_PLAN_2026-09-19.md`,
`docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md`, the send-emails file
header). On the client, no shared request helper exists at all
[VERIFIED §2.1]: 308 call sites across 97 files each hand-roll fetch, JSON parse,
`ok` check, error-message extraction, and error surfacing, and they do it
inconsistently (see §2.3). That is the largest cross-cutting debt with no plan on
file, and it is the debt whose removal most directly slims the code the user
touches every day.

**Owner intent (2026-09-19):** "slim the code and make things more efficient for
the user when possible." Build if the plan is solid; stop and discuss if iffy.
Deployment timing is a separate later decision.

**In scope**
- One helper module with a plain-function API (§3). No hook in v1.
- Migration of the JSON call sites (248 confirmed JSON, 41 classified unknown
  and resolved per site during its stage) onto the helper, preserving per-site
  behavior.
- Folding the two existing partial helpers (`readResponse`, `sendJson`; §2.4)
  into the shared one while keeping their exports.
- Characterization tests before each stage (§5), Gate G between stages (§7),
  fresh-context review at every checkpoint (§8).
- A lint ratchet at closeout so raw `fetch(` cannot creep back into client code
  outside an explicit allowlist (§6 Stage 6).

**Out of scope, sequenced after (each is its own plan if the owner wants it)**
- Shared `<Modal>` primitive. 28 files hand-roll a `fixed inset-0` backdrop;
  11 of them carry `role="dialog"`/`aria-modal`. Separable refactor with its own
  accessibility contract.
- `pages/admin.js` decomposition and per-workspace `next/dynamic` loading. The
  2026-09-18 decomposition survey evaluated and deferred it. It moves files and
  trips `check:doc-symbol-refs`; this plan moves none.
- SSE client consolidation. Two parsers already exist (`shared/utils/sse-stream.js`
  with one importer, `shared/components/reviewers/sse.js`) while 15 client files
  still hand-roll `getReader()` loops, each re-implementing partial-frame carry
  and mid-stream error handling. Sibling refactor, higher defect risk per site,
  fewer sites; deferred to its own plan and named here so it is not mistaken for
  "already solved" (P-A finding).
- A `useApiRequest` hook wrapping loading/error state. Reconsider only if Stage 2
  shows the same `setLoading/setError` choreography repeated verbatim across
  migrated sites; presented then as an owner choice, not assumed.

**Rejected**
- A shared `pages/api` route wrapper for the auth/method/try-catch scaffold.
  `check:api-routes` and `check:route-lifecycle-auth` parse each route's literal
  `requireAppAccess` call; a wrapper hides those from the gates or forces a gate
  rewrite, and it is auth-touching (Tier 2). Not reopened by this plan.

**Release tier, per stage** (`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`
§4, lines 112-131). The strategy classifies invitation/reminder behavior,
external reviewer flows, email, and uploads as Tier 2 regardless of whether
request bytes change, so the tier follows the surface, not the diff:
- Stages 0-3 and 5a: **Tier 1** (internal refactor, stable contract). Feature
  branch, automated tests, final-diff review, deliberate owner merge.
- Stage 4 (reviewer engagement: invite, reminder, release, closeout,
  due-date, send) and Stage 5b (external token pages and upload-adjacent
  forms): **Tier 2**. Adds: characterization coverage before change (T4/T5),
  an integrated preview deployment of the branch, a staff click-through of each
  migrated flow in the preview using capture mode (§7 of the strategy: capture
  is an email control), a recorded production deployment and rollback id, and
  an explicit owner decision to merge. External-flow rehearsal is owner
  decision (4) in §9.
Stage 0's census tags every file whose endpoints match
`/api/review-manager/*`, `/api/external/*`, `/api/scheduled-emails*`,
`/api/upload*`, or contain `send`, `invite`, `reminder`, `release`, `close`,
`email` as campaign-critical; those files belong to Stage 4 or 5b, never a
Tier 1 stage (Codex cycle 2 finding). The tag is a URL-literal heuristic, not a
guarantee: 8 census sites have a dynamic endpoint and cannot be tagged, and
the rule can misfire (Stage 0 review: `pages/profile-settings.js` flagged on a
GET of `/api/email-defaults/grantee-invite`). Tier placement is therefore
confirmed per file at each stage's start against the endpoints actually
called, and the census column is the starting list, not the verdict.

## 2. Verified contract and preserved differences

All items below were checked against `e269756a` on 2026-09-19.

### 2.1 Census [VERIFIED via scripted scan, spot-checked 8/8]
| Fact | Value |
|---|---|
| Raw `fetch(` sites in `shared/components/**` | 215 across 70 files |
| Raw `fetch(` sites in `pages/**` (non-api) | 93 across 27 files |
| Sites inside `getServerSideProps`/`getStaticProps` | 0 |
| Body kind | json 248, unknown 41, stream 14, blob 3, none 2 |
| Method | GET 127, POST 130, PUT 21, PATCH 20, DELETE 10 |
| `response.ok` checked | 254 yes, 54 no |
| Error surface | setError-state 190, swallowed 45, throw 36, unknown 27, toast/alert 8, console 2 |
| Abort signal passed | 35 |
| Retry/poll wrapper around the call | 19 |
| Explicit status branches | 409 (13), 403 (11), 401 (4), 413 (4), 503 (3), 400 (3), 412 (2), 202 (2), 404 (1) |
| Custom request headers | `If-Match` (2), `lock` (2); no auth headers client-side |
| Body parsed with bare `.json()` (no catch) | 67 sites [VERIFIED P-B] |
| Non-standard fetch init options | `keepalive: true` at one site (`shared/components/external/GranteeDeliverableForm.js:152-163`, a fire-and-forget beacon); no `credentials`/`cache`/`redirect`/`mode` anywhere |

The census script is committed in Stage 0 (§6); its CSV outputs are written
to a caller-supplied directory and are NOT committed. The tracked baseline is
the by-file table in the execution doc. Stage 0's run found 309 sites, not
308: `shared/components/meeting-tracker/SessionEditor.js:321` holds two
`fetch(` calls on one line and the planning scan counted one per line
[VERIFIED by reading the line]. Stage 0's numbers supersede this table.

### 2.2 Server error shape [VERIFIED via grep over `pages/api`]
- 716 sites return `res.status(n).json({ error: <string> })`; 3 return
  `{ message }`. One route returns a nested object,
  `pages/api/bill/onboard-reviewer.js:107-110` `{ ok: false, error: { code, message } }`
  [VERIFIED by reading it]; no client file in this plan's census calls that
  route, but the helper tolerates the shape anyway (§3 message rule).
- `lib/utils/auth.js:162-245` returns 401/403 as `{ error: 'Authentication required' }`,
  `{ error: 'Forbidden' }`, `{ error: 'No profile linked to this account' }`, etc.
- Body-level failure flags exist and are NOT equivalent to HTTP status:
  `pages/api/review-manager/materials-preflight.js:55` returns HTTP 200 with
  `{ ok: false, reason: 'materials_unavailable' }` on a sanitized lookup failure
  [VERIFIED via that file, lines 45-58]; 9 sites in 5 handlers under `pages/api` return `{ success: false, ... }`
  (some with 409, e.g. `pages/api/workbench/reviewer-roster.js:502`). Clients
  read body-level `.ok` at 22 sites and `.success` at 28 sites (8 in
  `shared/components/reviewers/search/useReviewerContactActions.js`).
  **Contract consequence:** the helper keys success on HTTP status only and
  returns the parsed body untouched. It never interprets body-level `ok` or
  `success`. Call sites keep those checks.

### 2.3 Client error-extraction variance [VERIFIED via census]
Collapsing local variable names, call sites read `.message` (202), `.error`
(187), `.details` (9), and 78 read nothing and throw/show a generic string.
Five client sites throw exactly `'Admin access required'` on 403
(`pages/admin.js:940,1251`, `shared/components/admin/PoliciesSection.js:77`,
`shared/components/admin/ReviewQuestionsSection.js:101`,
`shared/components/admin/PromptTemplatesSection.js:98`) and one throws
`'Admin access required for Executor budgets'`
(`shared/components/admin/PromptTemplatesSection.js:117`) [VERIFIED via grep,
P-C corrected an earlier repo-wide count];
`shared/components/workbench/ReviewsTab.js:911` sets `error.denial` on 401/403.
Each of these is a preserved difference: the migration carries the site's
message and branch, it does not unify them.

### 2.4 Existing partial helpers [VERIFIED by reading source]
- `readResponse(response)` at `shared/components/review-panel/review-panel-ui.js:62-66`:
  `json().catch(() => ({}))`, throw `new Error(body.error || \`Request failed (${status})\`)`
  when `!ok`, return body. Imported by `pages/review-panel.js` (3 sites) and
  `shared/components/workbench/ReviewPanelTab.js` (3 sites). A byte-identical
  LOCAL copy lives at `pages/cycle-dossier.js:72-75` with 7 sites
  (`:266,335,350,398,427,459,481`) [VERIFIED; Codex cycle 3 caught the earlier
  claim that cycle-dossier imported the shared one]. Stage 1 folds both copies.
- `sendJson(url, method, body, fetchImpl = fetch)` at
  `shared/components/meeting-tracker/SessionEditor.js:26-35`: JSON POST/PATCH,
  ok-check-then-throw with a site-specific fallback message, injectable
  `fetchImpl` for tests. `sendJson` issues its request through `fetchImpl`, so
  it contributes no raw `fetch(` census site; it has 7 callers. It parses
  through a file-local `readJson(response)` (`:22-24`,
  `response.json().catch(() => ({}))`) which is ALSO called directly at `:306`
  and `:324` on the file's four raw fetch sites (`:305`, `:321` twice, `:322`)
  [VERIFIED; the Stage 0 review caught the earlier "dead after Stage 1" claim].
  `readJson` is therefore a fourth Stage 1 adapter, folded, not deleted.
- Several single-endpoint local wrappers (`readStatus`/`readBriefStatus` in
  `shared/components/workbench/StaffDeliberationsTab.js`,
  `fetchStatus`/`fetchAcknowledgementState` in
  `shared/components/workbench/FinalWriteupTab.js`) are migrated as ordinary
  call sites.

### 2.5 Test mocking convention [VERIFIED]
`jest.setup.js:61` assigns `global.fetch = jest.fn()` and clears it per test;
118 test files reassign `global.fetch` locally and 20 use `jest.spyOn(global, 'fetch')`.
No fetch-mock or msw. **Contract consequence:** the helper resolves
`globalThis.fetch` at call time (or takes `fetchImpl`), never captures `fetch`
at module load.

### 2.6 Streaming is out of scope for a JSON helper, and is NOT consolidated [VERIFIED]
Two SSE parsers exist (`shared/utils/sse-stream.js`, one importer;
`shared/components/reviewers/sse.js`) and 15 client files still hand-roll
`getReader()` loops. The 14 stream sites (the Executor tool pages and
`shared/components/reviewers/ReleaseMaterialsModal.js:725`), 3 blob download
sites (`shared/components/reviewers/ReviewerInvitePanel.js:357`,
`shared/components/workbench/ReviewsTab.js:318`,
`shared/components/reviewers/search/useReviewerExport.js:58`; all three read
`Content-Disposition` from `response.headers`), and 2 fire-and-forget sites
(`shared/components/workbench/AwardeeTab.js:660`,
`shared/components/external/GranteeDeliverableForm.js:152` with `keepalive`)
stay on raw `fetch` under this plan and form the closeout allowlist. The
allowlist is site-level (§6 Stage 6), because `ReviewerInvitePanel.js` and
`ReleaseMaterialsModal.js` mix allowlisted and migrated sites. SSE consolidation is the named sibling plan
in §1.

### 2.7 Precedent
`docs/plans/REVIEWER_SEARCH_WORKSPACE_DECOMPOSITION_PLAN_2026-09-18.md`
(status complete) is the format and method precedent: stage cards, tests before
movement, Gate G, fresh-context checkpoints, correction-round limits. Its
execution sibling shows the receipt format. This plan reuses both.

## 3. Helper design

Location: `shared/utils/api-request.js` (plain JavaScript, no React import, so
it is usable from hooks, components, pages, and the non-component stores such as
`shared/components/reviewers/email-template-store.js`). Tests:
`tests/unit/api-request.test.js`.

```js
export class ApiRequestError extends Error {
  // name = 'ApiRequestError'; status: number; payload: any (parsed body or {});
  // parseError: Error | null — the native error when a non-2xx body could not
  //   be parsed, taken from parseJsonBody's result (always recorded).
  // message is computed by an exported pure function
  //   deriveErrorMessage(payload, parseError, fallbackMessage, status, { preferParseError })
  //   so T0 pins BOTH D3 policies; the public default for `preferParseError`
  //   is the owner's decision (3) in §9.
  // message = (typeof payload.error === 'string' ? payload.error : payload.error?.message)
  //        || payload.message || fallbackMessage || `Request failed (${status})`
}

// Throwing form. Default for the 254 sites that already check `ok` and throw/set.
export async function requestJson(url, {
  method = 'GET', body, headers, signal, fallbackMessage, fetchImpl, tolerantBody,
} = {})
// -> parsed body on 2xx. Throws ApiRequestError on non-2xx. Network/abort
//    errors propagate unchanged (AbortError stays AbortError).

// Non-throwing form. For the 52 migrated sites that do not check `ok` (54 in
// the census minus the 2 allowlisted beacons), for sites that
// branch on 409/412/413/202 etc. before deciding whether it is an error, and
// for sites that read `status` on success.
export async function requestEnvelope(url, opts)
// -> { ok: response.ok, status: response.status, data, error }
//    `data` is ALWAYS the parsed body from readJsonBody (so {} on a tolerant
//    non-2xx), never null; `error` is an ApiRequestError when !ok, else null.
//    Same body/header/signal handling. Never throws on HTTP status.

// Internal parse step used by both request forms; returns the body AND the
// parse outcome so ApiRequestError.parseError can be populated.
async function parseJsonBody(response, { signal, tolerantBody = false } = {})
// -> { data, parseError }  (parseError is the native error or null)

// Public data-only adapter over parseJsonBody, for the Stage 1 adapters (which
// receive a Response, not a URL). Same options, returns `data` only.
export async function readJsonBody(response, { signal, tolerantBody = false } = {})
// tolerantBody: false | true | (parseError, response) => fallbackValue
// Non-2xx: always tolerant — empty or unparseable body -> {} (error bodies are
//   only ever read for a message). 2xx: STRICT by default — an empty or
//   unparseable body rejects with the native parse error, exactly like a bare
//   `response.json()` does today. `tolerantBody: true` makes 2xx return {} on
//   empty/unparseable, for callers whose current code is
//   `response.json().catch(() => ({}))`. A function form returns that
//   function's value, for the three sites whose current fallback is not {}:
//   `pages/external/briefing/[token].js:75` and
//   `pages/external/materials/[token].js:214,227`, all
//   `.catch(() => ({ ok: false, reason: 'server_error' }))` [VERIFIED; the
//   repo has exactly these three non-{} JSON fallbacks in client code]. In every mode, a rejection whose
//   `name` is 'AbortError', or any rejection while `signal?.aborted` is true,
//   is rethrown unchanged.
// Mechanics: it calls ONLY `response.json()` and reads `response.ok` /
//   `response.status`. It never touches `response.headers`, `text()`, or
//   `body`, so the repo's `{ ok, status, json }` test doubles keep working. An
//   "empty body" is simply a `json()` rejection: strict rethrows it, tolerant
//   returns {}. A 2xx body that parses to null, a primitive, or an array is
//   returned as-is; the message rule guards `typeof payload` before reading
//   `.error`/`.message`. Both request forms forward `signal` into readJsonBody.
```

`requestJson` and `requestEnvelope` take the same `tolerantBody` option and
pass it through. The per-site rule is mechanical: a site whose code has
`.catch(() => ({}))` on its body read migrates with `tolerantBody: true`; a
site whose catch returns anything else migrates with the function form
returning exactly that value; a site with a bare `.json()` migrates strict. The
execution doc records the choice per site.

Invariants (each pinned by a unit test in Stage 0):
1. `fetch` is resolved as `fetchImpl ?? globalThis.fetch` at call time (§2.5).
2. A plain-object `body` is `JSON.stringify`'d and `Content-Type: application/json`
   is added unless the caller set one; `FormData`, `Blob`, `string`, and
   `URLSearchParams` bodies pass through with no content-type added. No live
   client site sends a non-JSON body today [VERIFIED P-B: zero `new FormData`],
   so this clause is a T0 pin, not a served case. The option list is closed
   (`method, body, headers, signal, fallbackMessage, fetchImpl, tolerantBody`);
   the one `keepalive` site is allowlisted (§2.6), not served.
3. Caller headers are merged over defaults, so `If-Match` and `lock` survive.
4. Body parse is `readJsonBody` with the strict-on-success policy above. Two
   review findings fix the policy: (a) P-B: the incumbent
   `response.json().catch(() => ({}))` swallows abort-during-body, and
   `pollForArtifact` at `shared/components/workbench/StaffDeliberationsTab.js:354-378`
   would keep polling on a `{}` pseudo-status, so aborts are rethrown; (b) Codex
   cycle 1: a tolerant `{}` on a malformed 2xx would turn
   `shared/components/workbench/AwardeeTab.js:547-572`'s send-invite outcome
   from `uncertain` (today: bare `.json()` throws, the `catch` sets
   `uncertain`) into `sent` (`statusPersisted` undefined → `'sent'`), hiding a
   possibly lost email receipt. Strict-on-success preserves the `uncertain`
   path at every bare-`.json()` site. The only remaining deviation is on
   non-2xx bodies (D3).
5. Success is `response.ok` only. Body-level `ok`/`success` are never read (§2.2).
6. No retry, no redirect on 401/403, no toast, no global error handler. Those
   belong to call sites, and centralizing them is a behavior change this plan
   does not make. `AbortError` identity is load-bearing at 19 sites that branch
   on `err?.name !== 'AbortError'` (`StaffDeliberationsTab.js`,
   `PreSiteDistributionPanel.js`, `SessionAgendaPanel.js`,
   `ReviewerRepairAlertDetails.js`, `AdminOverviewSection.js`) and
   `StaffDeliberationsTab.js:88-96` synthesizes errors with that name; the
   helper never wraps or renames a rejection from `fetch` or the body read.
7. `ApiRequestError.payload` exposes the raw body so sites that read `.details`,
   `.reason`, or `promotionAuthority` fields keep working.
8. Module has no React dependency and no side effects at import.

**Stage 1 adapters keep their legacy expressions verbatim.** Both
`readResponse` copies (shared and the local one in `pages/cycle-dossier.js`)
become `const body = await readJsonBody(response, { tolerantBody: true }); if
(!response.ok) throw new Error(body.error || \`Request failed (${response.status})\`);
return body;` and `sendJson` keeps `throw new Error(result.error || 'The
schedule change could not be saved.')` over `readJsonBody(response, {
tolerantBody: true })`. The abort rethrow (invariant 4) is unobservable in
Stage 1: none of the four consumer files (`pages/review-panel.js`,
`ReviewPanelTab.js`, `pages/cycle-dossier.js`, `SessionEditor.js`) passes a
`signal` or creates an `AbortController` [VERIFIED via grep, 0 hits each], so
no body read there can abort. T1 pins that fact. They throw plain `Error`, not
`ApiRequestError`, and compute the message from the body with the legacy
expression, so `{ message: 'x' }`, `{ error: { code, message } }`, and
`{ error: 5 }` produce exactly the strings they produce today (P-B finding 7).
Only later stages, which edit call sites deliberately, adopt the §3 message
rule.

## 4. Migration order (the "file order" for this refactor)

No production file moves in this plan. The order below is the order in which
files are migrated. Group membership is fixed by the Stage 0 census; a file is
migrated whole (all its JSON sites) in one stage so its test can pin the whole
surface.

| Stage | Group | Files (JSON call sites) |
|---|---|---|
| 1 | Fold existing helpers, zero behavior change | Four adapters: `review-panel-ui.js` `readResponse` (6 consumer sites: `pages/review-panel.js:44,89,110`; `ReviewPanelTab.js:251,279,289`), the local `readResponse` in `pages/cycle-dossier.js:72-75` (7 sites), `SessionEditor.js` `readJson` (:22-24; 4 raw sites at :305, :321 ×2, :322) and `sendJson` (:26-35; 7 callers, no raw sites). 17 raw sites flow through them; none is edited |
| 2 | Highest-count files that already have an RTL render test and a single dominant error surface | `AwardeeTab.js` (13 json + 1 excluded), `StaffDeliberationsTab.js` (8), `ConsultantFeedbackSection.js` (8), `pages/expertise-finder.js` (8), `FinalWriteupTab.js` (5); `pages/cycle-dossier.js`, `pages/review-panel.js`, `ReviewPanelTab.js` (all sites already through the adapters folded in Stage 1; verify only, no edits) |
| 3 | Admin surface | `shared/components/admin/*` sections with sites (`PromptTemplatesSection` 5, `SiteVisitRecipientsSection` 4, `OperationalEventsSection` 3, `ReviewQuestionsSection` 3, `DynamicsExplorerRestrictionsSection` 3, `PoliciesSection` 2, `EmailDefaultsSection` 2, `FinalWriteupMatrixAudiencesSection` 2, `SiteVisitMaterialsDefaultsSection` 2, `MeetingTrackerDefaultsSection` 2, `ReviewerRepairAlertDetails` 1), then `pages/admin.js` (32) section by section |
| 4 | Reviewer engagement surface (Tier 2 re-check at stage start; see §1) | `InviteEmailModal.js` (10), `ReviewerInvitePanel.js` (5 + 1 blob excluded), `ReviewerManagePanel.js` (6), `ReviewersTab.js` (5), `ReviewerFindPanel.js` (5), `ReleaseMaterialsModal.js` (4 + 1 stream excluded), `search/useReviewerContactActions.js` (8), `search/useReviewerRosterActions.js` (4), `search/useReviewerPromotion.js` (4), `search/useReviewerDiscovery.js` (4), `search/useReviewerExport.js` (0 migrated; its single site is the allowlisted blob download), `CandidateEditModal.js`, `CampaignConfigModal.js`, `RespondReminderModal.js`, `RemoveEntirelyModal.js`, `ReleaseEmailModal.js`, `ReviewReminderAction.js` (1, `/api/review-manager/send-review-reminder`), `ReviewerDueDateEditor.js` (1, `review-due-extension`), `AcceptedReviewerReleaseModal.js` (1, `terminal-transition`), `ReviewerCloseoutModal.js` (1, `close-review`), `email-template-store.js`, `prompt-override-store.js`, `search/useApplicantReviewerEnrichment.js` (1), `search/useReviewerRoster.js` (1) [the two hooks placed here by the Stage 0 review; ASSUMED until their endpoints are read at stage start]. Tier 2. |
| 5a (Tier 1) / 5b (Tier 2) | Long tail; 5b is every external-token page, upload-adjacent form, and email-sending page (`pages/external/**`, `ReviewAuthoringForm`, `GranteeDeliverableForm`, `scheduled-emails`, `pages/test-email.js`), 5a is everything else including `shared/components/Layout.js:35` (`/api/admin/alerts?summary=true`) and `pages/workbench/[requestId].js:127` (`resolve-request`); `pages/profile-settings.js:147` is owner decision (6) | every remaining file in the census with at least one JSON site: workbench (`ReviewsTab`, `PreSiteDistributionPanel`, `InitialAssessmentTab`, `RequestListPanel`, `RequestLocator`, `ProposalTab`, `ManualReviewEntryForm`, `AwardeesPanel`, `ArtifactVersionHistory`, `OverviewTab`, `ReviewerFollowUpPanel`, `useSiteVisitContext`), meeting-tracker (`MeetingTrackerList`, `SiteVisitEditor`, `SessionAgendaPanel`, `SiteVisitMaterialsCard`), external (`ReviewAuthoringForm`, `GranteeDeliverableForm`, `pages/external/**`), `ProfileLinkingDialog`, `RosterContactField`, `FinalWriteupsViews`, and pages (`scheduled-emails`, `grant-reporting`, `phase-ii-writeup`, `dynamics-explorer`, `dataverse-bulk-export`, `virtual-review-panel`, `phase-i-dynamics`, and the Executor tool pages' non-stream sites) |
| 6 | Closeout ratchet | ESLint `no-restricted-syntax` for raw `fetch(` in a `files: ['shared/components/**/*.js','pages/**/*.js'], ignores: ['pages/api/**']` flat-config block; the §2.6 allowlist is expressed as a per-site `eslint-disable-next-line` with a reason, never a file-level ignore |

Stage 5 is always two stages: 5a (Tier 1: workbench, meeting-tracker, admin
leftovers, internal pages) and 5b (Tier 2: external token pages, upload-adjacent
forms, scheduled emails). Each has its own Gate G and review.

## 5. Tests that must exist before each stage starts

**Common rule** (from the precedent): commit a stage's characterization tests
separately and run them green against the unmigrated code before touching
production code. Cite existing tests by name rather than duplicating them. Each
critical group must fail under at least one deliberate mutation (restore
immediately; never commit it). No test hits a live provider or store.

| ID | Required before | Content |
|---|---|---|
| T0 | Stage 0 exit | `tests/unit/api-request.test.js`: every §3 invariant, plus: 2xx JSON; 2xx empty body strict (rejects), tolerant (`{}`), and function-form (returns the function's value); `parseError` set on an unparseable non-2xx body and null otherwise; `deriveErrorMessage` pinned under both `preferParseError: false` (D3 accepted) and `true` (D3 declined), with the public default asserted to match the recorded owner decision; 2xx malformed body strict (rejects with the native parse error, `name` preserved) and tolerant (`{}`); non-2xx `{error}`; non-2xx `{message}`; non-2xx nested `{error:{message}}`; non-2xx non-JSON body (`{}` → fallback message); network rejection passthrough; AbortError rejected by `fetch` passthrough; AbortError raised during the body read rethrown in both strict and tolerant modes; `signal.aborted` true after a body-read failure → rethrow; FormData body; `If-Match` header survival; `fetchImpl` injection; `globalThis.fetch` late binding (reassign after import). |
| T1 | Stage 1 | `readResponse`/`sendJson` behavior pins: same thrown message text for `{error}`, `{message}` only, nested `{error:{message}}`, `{error:5}`, empty body, non-JSON body; same return on 2xx; thrown value has `.name === 'Error'` (not `ApiRequestError`); a static assertion that none of the four Stage 1 consumer files contains `signal` or `AbortController` (so the invariant 4 rethrow cannot be observed; if a later change adds one, this test fails and the site is re-characterized). Existing consumers' tests (verified by name in Stage 0) run green. |
| T2 | Stage 2, per file | **Per-call-site contract matrix, not per-endpoint sampling** (Codex cycle 2: `RespondReminderModal.js:52-75` and `:105-140` hit the same endpoint with different failure semantics, preview → `loadError`, send → `uncertain` receipt). For EVERY migrated site: (a) 2xx JSON produces today's visible state, (b) non-2xx `{error:'X'}` produces today's state/throw/toast verbatim, (c) network rejection likewise, (d) for bare-`.json()` sites a malformed 2xx produces today's outcome (for `AwardeeTab.js` send-invite: the `uncertain` receipt and step), and for tolerant sites a malformed and an empty 2xx produce today's fallback value; and for every non-GET site the test also asserts the mocked `fetch` call's URL, method, headers, and exact body string are unchanged before and after migration. Sites that branch on status or body-level flags add one case per branch. Existing RTL tests (`tests/unit/awardee-tab.test.js`, `tests/unit/staff-deliberations-tab.test.js`, `tests/unit/consultant-feedback-section.test.js`, `tests/unit/expertise-finder-batch-cycle.test.js`, `tests/unit/final-writeup-tab.test.js`) are extended, not replaced [VERIFIED P-B: each renders the component and mocks `global.fetch` per scenario]. Fixtures that mock `{ ok: true, json }` without a `status` field (e.g. `expertise-finder-batch-cycle.test.js:31`) must gain `status` before any site in that file moves to `requestEnvelope`. |
| T3 | Stage 3 | The T2 per-site matrix for each admin section. For `pages/admin.js`: the four workspace functions (`OperationsWorkspace` :3139, `WorkflowsWorkspace` :3198, `AiWorkspace` :3335, `PeopleWorkspace` :3375) are not exported today and `AdminDashboard` (:3453) reads `router.query` and renders `Layout` (which calls `useSession`). T3 therefore first adds named exports for the four workspace functions (the file already exports sections such as `DynamicsFeedbackSection` and `AppAccessSection` for `tests/unit/admin-dynamics-feedback-filters.test.js` and `tests/unit/app-access-admin-partial-refresh.test.js`), then one test file per workspace mounts the exported workspace with `view` as a prop and mocks `global.fetch` per section. No test mounts `AdminDashboard`. `tests/unit/admin-models.test.js` tests the API route, not the page, and is not a T3 anchor. The 403 → `'Admin access required'` message is pinned verbatim at every site that has it. |
| T4 | Stage 4 | The T2 per-site matrix for every site in every Stage 4 file (including the four one-site files added by Codex cycle 2), plus: body-level `.success`/`.ok` branches in `useReviewerContactActions`, `ReviewersTab`, `ReviewerManagePanel`, `ReviewerFindPanel`, `useReviewerRosterActions` pinned with a 200 + `{success:false}` fixture and a 409 + `{success:false, ...promotionAuthority}` fixture (§2.2). `ReleaseMaterialsModal.js` has no direct render test; it is exercised through `ReviewerManagePanel` in `tests/unit/reviewer-materials-modal-lifetimes.test.js` (`renderPanel` :163-166, `openReleaseModal` :169), which is extended for its three scenarios. Existing `tests/unit/invite-email-modal-capture.test.js`, `reviewer-manage-*.test.js`, `tests/unit/reviewer-materials-modal-lifetimes.test.js` run green. |
| T5 | Stages 5a/5b | The T2 per-site matrix for every migrated site; for the three function-form tolerant sites, malformed and empty 2xx pinned to `{ ok:false, reason:'server_error' }` → the "retry later" state. Files lacking an RTL test today get one first (`scheduled-emails`, `grant-reporting`, `phase-ii-writeup`, `dataverse-bulk-export`, `virtual-review-panel`, `phase-i-dynamics`, `ProfileLinkingDialog`, `ReviewerFollowUpPanel`, `useSiteVisitContext`; the two admin defaults sections belong to T3). Files that already have one get the extension only. |
| T6 | Stage 6 | A lint fixture proving the rule fires on a raw `fetch(` in a client file, does not fire on `pages/api`, does not fire on a site carrying `// eslint-disable-next-line no-restricted-syntax -- <reason>`, and DOES fire on an un-annotated raw `fetch(` elsewhere in the same file as an annotated one (site-level, not file-level, exemption). |

The 41 "unknown body kind" sites are resolved during their file's stage: the
implementer reads each and records json / excluded in the execution doc before
migrating.

## 6. Stage execution cards

Every stage: branch drift check, Gate G (§7), fresh-context review (§8), one
clean commit per stage (tests commit precedes code commit), rollback reference
recorded in the execution doc.

### Stage 0 — Baseline, helper, census
Before: feature branch `feature/client-request-layer` from `main`; worktree if
another agent is active on `main`. Do: commit the census script as
`scripts/census-client-fetch-sites.js` (read-only; writes CSV to a path
argument; its header documents the classification rules: body kind from the
first `.json()`/`.blob()`/`getReader()`/no-read within the call's own scope,
`ok` check present or not, error surface from the nearest `catch`, "unknown"
when none matches). Stage 0's numbers supersede §2.1 if they differ and the
delta is recorded. Write its by-file table into
`docs/plans/CLIENT_REQUEST_LAYER_EXECUTION_2026-09-19.md` as the
source-to-stage map: one row per file with stage, site count, and per site the
line, form (`requestJson` / `requestEnvelope` / allowlisted), `tolerantBody`
choice, and resolved body kind for any census "unknown";
add `shared/utils/api-request.js` with zero callers; add T0. Verify: T0 green,
mutation check (flip invariant 5 to read body `ok`; T0 must fail), full Gate G.
Exit: helper landed unused, census tracked, execution doc created with the
source-to-stage map. Rollback: revert the two commits; nothing else changed.

### Stage 1 — Fold existing helpers
Before: T1. Do: reimplement both `readResponse` copies, `SessionEditor.js`'s
`readJson`, and `sendJson` over `readJsonBody(response, { tolerantBody: true })`,
keeping exports, signatures, and message text. `readJson` stays (it has two
direct callers at `:306` and `:324`); nothing is deleted in this stage. Do not
replace the cycle-dossier local copy with an import of the shared one here
(that is a call-site edit; Stage 2 may do it). Verify: T1 and all consumer
tests green; diff of every thrown message string is empty. Exit: 17 raw
sites now route through the helper via four adapters with no call-site edits. Rollback: revert one commit.

### Stage 2 — Covered high-count files
Before: T2 for each file. Do: migrate each file whole, in the §4 order, one
commit per file. At each site: keep the site's fallback message
(`fallbackMessage`), keep its status branches (use `requestEnvelope` where the
site branches before deciding it is an error), keep its abort signal, keep its
error surface. Verify: per-file tests, then Gate G after the group. Exit: group
migrated; execution doc lists every site with old → new form and any resolved
"unknown". Rollback: revert per-file commits in reverse order.

### Stage 3 — Admin surface
Before: T3. Do: sections under `shared/components/admin/` first, then
`pages/admin.js` one inline section per commit. Do not split `admin.js` into
files in this plan. Verify: per-workspace tests, Gate G. Exit: 61 admin sites
migrated. Rollback: per-commit.

### Stage 4 — Reviewer engagement surface (Tier 2)
Before: T4 (request-bytes assertions included); production deployment and
rollback ids refreshed and recorded. Do: migrate per file. Verify: T4, existing
reviewer tests, Gate G including `check:reviewer-engagement-boundary`; deploy
the branch to a Vercel preview and record a staff click-through of invite
preview, reminder preview, release, closeout, and due-date flows. Data mode:
Mode A (route-mocked pages, no Dataverse/email side effects) is the default
because a request-layer refactor is proven at the response-handling seam;
capture mode in a preview is an email control, not a sandbox, and would still
persist lifecycle writes, so it is NOT used against real records. If the owner
wants a real-data rehearsal it is Mode D with its written expected-writes and
cleanup list (owner decision (5)). Exit: group migrated, rehearsal recorded.
Rollback: per-commit; production untouched until the owner merges.

### Stage 5a — Long tail, internal (Tier 1)
Before: T5 for its files. Do: migrate. Verify: Gate G. Rollback: per-commit.

### Stage 5b — Long tail, external and upload-adjacent (Tier 2)
Before: T5 for its files; owner decision (4). Do: migrate. Verify: Gate G;
preview deployment; token click-through of the external briefing, materials,
review, and grantee pages per decision (4). Exit: only allowlisted raw
`fetch(` sites remain; the census script reports the count and it matches the
allowlist. Rollback: per-commit.

### Stage 6 — Closeout ratchet
Before: T6. Do: add the flat-config rule block (`eslint.config.mjs` is a 49-line
`defineConfig([...nextVitals, { rules }, globalIgnores([...])])`; append one
scoped block) and the per-site disable comments at exactly the §2.6 sites;
delete any now-dead local wrappers; update `docs/SERVICE_AND_UTILITY_CATALOG.md`, the closest agent-wiki
topic page, and regenerate `docs/DOCS_CATALOG.md`. Verify: `npm run lint`
green, every `check:*` gate and self-test sequentially, `npm run build`. Exit:
plan status → `complete`; release decision handed to the owner with the rollback
deployment recorded. Rollback: revert the lint commit; behavior unchanged.

## 7. Gate G, release, and rollback

At every stage, serially, in the implementation worktree:

```bash
# stage-named tests first, then:
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
Stage 4 adds `check:reviewer-engagement-boundary` (+ self-test). Stages 0 and 6
run every defined `check:*` gate and self-test sequentially. Environment
failures are recorded distinctly from code failures.

**Branch drift check before every stage:** `git fetch origin`, record feature
HEAD and `origin/main`; if `main` advanced, merge it into the feature branch,
rerun Gate G, and re-review before continuing.

**Release:** tiered per stage (§1): Stages 0-3 and 5a Tier 1, Stages 4 and 5b
Tier 2. Merge to `main` is an explicit owner decision after Stage 6 or after
any earlier stage the owner chooses to ship; a merge that includes Stage 4 or
5b carries the Tier 2 controls. Before merge: record the
current production deployment id and the rollback deployment id in the execution
doc (last known: `dpl_6Z3Fv3mYxpkSYiQCjqmUQrbsQvbd` at `7c729379`; refresh
before acting). Rollback is a Vercel redeploy of the recorded prior deployment;
no data rollback exists or is needed.

## 8. Fresh-context review interval and orchestration

**Planning checkpoints:** P-A scope census, P-B design and stage/test plan, P-C
final document. Each is a newly spawned read-only Opus reviewer with no inherited
conversation, given only the repo path, baseline commit, the document (or census
brief for P-A), and the review contract below. A returning agent is not a fresh
review. After P-C, Codex (`gpt-5.6-sol`, OAuth session) performs an adversarial
review of the plan; at most three cycles; non-convergence stops and goes to the
owner.

**Implementation orchestration:** Fable orchestrates. Sonnet performs
reconnaissance, prerequisite tests, and builds for each stage. A fresh Opus
reviewer reviews each stage's diff against this plan and the execution doc and
returns READY / READY WITH NAMED CHANGES / NEEDS REWORK with file:line evidence.
Sonnet gets at most two correction rounds per stage on material findings; Fable
then takes over unresolved items or records a nonblocking disposition. No cycles
on style-only findings. Fable performs the final review of each stage and may
edit directly. Before the next stage, the reviewer rechecks that stage's
prerequisites against the accepted code, not the plan's line numbers.

Reviewer contract:

> Read-only review of CHECKPOINT/STAGE in DOCUMENT at COMMIT. Ignore the
> implementer's confidence. Read CLAUDE.md. Use CodeGraph first, then source,
> callers, and tests. For each migrated site verify: same request method, URL,
> headers, and body bytes as before (compare mocked fetch call args); same
> visible outcome on 2xx, non-2xx, and network failure; abort signal and
> status branches preserved; body-level `ok`/`success` checks untouched. Check
> the helper never reads body-level flags and never retries. Challenge one
> premise explicitly. Separate pre-existing defects from introduced changes.
> Return a verdict with commands actually run and untested limits. Do not edit
> files, call providers, perform live writes, or expand the migration.

Receipts (checkpoint, document SHA-256, commit, reviewer, findings, disposition,
commands, verdict) are recorded in §10 for planning and in the execution doc for
stages.

## 9. Assumption and defect ledger

| # | Item | Status |
|---|---|---|
| A1 | The 41 "unknown body kind" sites are JSON or excluded; none need a new body mode | [ASSUMED] resolved per file in its stage |
| A2 | No client site depends on `fetch` being captured at module load | [VERIFIED §2.5] mocking convention requires late binding |
| A3 | The 52 migrated no-`ok`-check sites (54 minus the 2 allowlisted beacons) tolerate non-2xx bodies today; migrating them with `requestEnvelope` preserves that | [VERIFIED by census] behavior preserved by construction; each pinned in its stage's tests |
| A4 | 19 retry/poll wrappers wrap the call site rather than living inside it; the helper stays retry-free and the wrapper is untouched | [VERIFIED P-B for `StaffDeliberationsTab.js:354-378` and `FinalWriteupTab.js:283-291`; remaining 17 verified at their stage] |
| D1 | Pre-existing: sites trust the body without checking `ok` (census: 38 unwrapped JSON candidates, heuristic, to be confirmed by reading) | Preserved during migration. **Owner priority for the next session**; fix specified in `docs/plans/CLIENT_REQUEST_LAYER_D1_UNGUARDED_RESPONSES_2026-09-20.md` |
| D2 | Pre-existing: `materials-preflight` returns 200 with `ok:false` | Preserved; helper does not interpret body flags |
| D3 (owner accepted 2026-09-20) | Up to 67 client sites parse with bare `.json()`; those that parse BEFORE the `ok` check (e.g. `PromptTemplatesSection.js:478`) surface a `SyntaxError` message today on a non-2xx non-JSON body and would surface the site's fallback message after migration. Sites that parse only after the `ok` check (e.g. `pages/admin.js:938-942`) never see such a body, so the real exposure is smaller [ASSUMED; resolved per site]. On 2xx the strict policy preserves today's rejection exactly | Proposed deviation, limited to non-2xx bodies. Owner decision (3) below, required before Stage 0 exit; `parseError` is recorded in both branches |
| D8 | A tolerant-by-default parser would have converted `AwardeeTab.js:547-572`'s `uncertain` send-invite outcome into `sent` on a malformed 2xx (Codex cycle 1, reproduced) | Fixed by the strict-on-success policy (§3); T0 and T2(d) pin it |
| D9 | Pre-existing, user-facing: `shared/components/ErrorAlert.js:45` reads prop `error`; six client call sites pass `message=` (`pages/expertise-finder.js:250,388,851`, `pages/dataverse-bulk-export.js:471`, `pages/virtual-review-panel.js:1296`, `pages/phase-i-dynamics.js:152`), so those error banners render blank | Found during Stage 2 (group B). Not a migration concern; fix belongs with the D1 follow-up (same family: an error that never reaches the user) |
| D4 | `response.json().catch(() => ({}))` swallows an abort raised during the body read; `readStatus` (`StaffDeliberationsTab.js:66`), `readBriefStatus` (`:76-84`) and `pollForArtifact` (`:354-378`) can loop on a `{}` pseudo-status | Pre-existing at `readResponse`-style sites; fixed by `readJsonBody` rethrow (§3 invariant 4) and pinned in T0 |
| D5 | `search/useReviewerExport.js` was in no stage row or allowlist in the first draft | Fixed: allowlisted (§2.6, §4) |
| D6 | A helper that threw `ApiRequestError` from the Stage 1 adapters would change `.name` at 17 sites | Avoided: Stage 1 adapters throw plain `Error` with the legacy expression (§3); T1 pins `.name === 'Error'` |
| D7 | `shared/components/admin/PromptTemplatesSection.js:478` parses a 409 body with bare `.json()` and `shared/components/reviewers/InviteEmailModal.js:660-665` fires a side effect on 409 before throwing | Both must use `requestEnvelope`; listed for their stages |

Owner decisions, all resolved 2026-09-20:
(1) D1: **preserve during migration; fixing is an owner PRIORITY for the next
session.** The fix is specified for a cold-start agent in
`docs/plans/CLIENT_REQUEST_LAYER_D1_UNGUARDED_RESPONSES_2026-09-20.md` (38
census candidates to confirm by reading, fix pattern, tiering) and queued in
`docs/CURRENT_WORK_QUEUE.md`. (2) Stage 4: **proceed** in this cycle under the
Tier 2 controls in §1 and §6. (3) D3: accept that a non-2xx non-JSON body shows the site's
fallback message instead of a raw `SyntaxError` message. **DECIDED 2026-09-20:
owner accepted** ("1 accept"). The public default is `preferParseError: false`;
`parseError` is still recorded and T0 still pins both policies. Implementable either way: the
helper always records `ApiRequestError.parseError`; under "accept" the message
rule is as written in §3; under "decline" the rule prefers
`parseError.message` when `parseError` is set, and T0 pins whichever policy is
chosen. The decision is required before Stage 0 exit, not Stage 2.
(4) Stage 5b rehearsal: **decided, the owner's own token click-through in
the preview deployment satisfies the naive-user rehearsal** (the owner built
none of it); recorded in the execution doc when run. (5) Stage 4 data mode:
**decided, Mode A** (route-mocked pages); Mode D only by a new owner decision
with the expected-writes and cleanup list first. (6) `pages/profile-settings.js:147`:
**decided, Stage 5a** as an internal read; the census tag fired on `invite` in
`/api/email-defaults/grantee-invite`, a GET of a template default.

## 10. Planning review receipts

| Checkpoint | Reviewer | Commit / doc hash | Verdict | Disposition |
|---|---|---|---|---|
| P-A scope census | Opus (fresh) | `e269756a` / census brief | READY WITH NAMED CHANGES | Applied: nested `error.message` tolerance (§3), SSE not-consolidated restatement (§1, §2.6), counts corrected (215 / 14 / 118), baseline provenance noted. Reviewer's premise challenge (SSE consolidation as a sibling) accepted and recorded, not absorbed into scope. |
| P-B design + stages | Opus (fresh) | `e269756a` / `9c122add…` | READY WITH NAMED CHANGES | Applied: `readJsonBody` with abort rethrow (§3 inv. 4, T0), Stage 1 adapters keep legacy expressions and plain `Error` (§3, D6), T3 uses exported workspace seams and drops the `admin-models` miscite, site-level lint allowlist (T6, Stage 6), `keepalive` beacon and `useReviewerExport.js` placed (§2.1, §2.6, §4), census row for bare `.json()`, D3–D7 and A4 upgrade in §9. Premise challenge accepted: the incumbent parse step is not adopted wholesale. |
| P-C final document | Opus (fresh) | `9efda1b6` / `611ddb63…` | READY WITH NAMED CHANGES | Applied: Stage 1↔5 `readResponse` overlap removed (§4), envelope `data`/`ok`/`status` defined and `readJsonBody` mechanics pinned to `json()`+`status` only (§3), non-object 2xx body and `signal` forwarding stated (§3), census rules and map format specified (§6 Stage 0), `readJson` retirement moved to Stage 1, admin-access count corrected to five + one (§2.3), T1 `.name` pin, T4 `ReleaseMaterialsModal` wording, T5 admin sections removed, D3 reframed as owner decision (3) with narrowed exposure, D4 line numbers, 52-vs-54 counts (§3, A3), summary/§1 qualified "except D3". 27 file:line refs spot-checked, 2 corrected. |
| Codex adversarial 1 | Codex (ran as `gpt-6-astra`: the companion was invoked without `--model`, against the owner directive; recorded, not repeated) | `9efda1b6` / `611ddb63…` | needs-attention (1 high) | Applied: strict-on-success `readJsonBody` policy with per-site `tolerantBody`, T0/T2(d) pins, D3 narrowed, D8 added. |
| Codex adversarial 2 | gpt-5.6-sol | `b9e3548c` / `70adf091…` | needs-attention (2 high, 2 medium) | All four verified against source and applied: Stage 4 and new Stage 5b re-tiered to Tier 2 with the strategy's controls and a census tag that keeps campaign-critical files out of Tier 1 stages; four one-site reminder/release files added to Stage 4; T2-T5 replaced with a per-call-site matrix including request-bytes assertions for non-GET sites; `tolerantBody` gains a function form for the three non-`{}` fallbacks; D3 made implementable in both branches via `parseError`, decision moved before Stage 0 exit, frontmatter corrected. |
| Codex adversarial 3 | gpt-5.6-sol | `7d1505d8` / `df5fa017…` | needs-attention, NOT CONVERGED (3 high on Stage 0/1 bookkeeping; matrix and fallbacks confirmed converged) | Verified and applied: cycle-dossier's local `readResponse` copy folded in Stage 1 (16 sites, not 17); internal `parseJsonBody → { data, parseError }` with `readJsonBody` as the public data-only adapter, `tolerantBody` added to the closed option list and `requestJson` signature, `deriveErrorMessage` pinned under both D3 policies; Stage 1 abort rethrow shown unobservable (no consumer passes a signal) and pinned by T1. Non-blocking notes applied: §7 per-stage tier wording, decision (2) wording, Stage 4 data mode (Mode A default, Mode D as decision (5)), 5b rehearsal wording. **Three-cycle limit reached without Codex's formal CONVERGED: per the owner's rule, planning stops here for owner review before Stage 0.** |
