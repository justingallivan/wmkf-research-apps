---
title: Client Request Layer Migration Plan
domain: platform
kind: plan
status: draft
summary: Staged introduction of one shared client-side JSON request helper and migration of the 308 raw fetch call sites in client components and pages onto it, preserving every call site's visible error behavior.
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
site keeping exactly the visible error behavior it has today.

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

**Release tier:** Tier 1 per `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`
§4 (internal refactor, stable public contract, no Dataverse/auth/email semantics
change). Feature branch, automated tests, review of the final diff, deliberate
owner merge. If any stage would change what a client sends to an email, invite,
reminder, or upload route, that stage is re-tiered to Tier 2 before it starts.

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

The census script and its CSV outputs are regenerated and committed in Stage 0
(§6) so later stages diff against a tracked baseline, not a scratch file.

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
  [VERIFIED via that file, lines 45-58]; 9 routes return `{ success: false, ... }`
  (some with 409, e.g. `pages/api/workbench/reviewer-roster.js:502`). Clients
  read body-level `.ok` at 22 sites and `.success` at 28 sites (8 in
  `shared/components/reviewers/search/useReviewerContactActions.js`).
  **Contract consequence:** the helper keys success on HTTP status only and
  returns the parsed body untouched. It never interprets body-level `ok` or
  `success`. Call sites keep those checks.

### 2.3 Client error-extraction variance [VERIFIED via census]
Collapsing local variable names, call sites read `.message` (202), `.error`
(187), `.details` (9), and 78 read nothing and throw/show a generic string.
Eleven sites throw `'Admin access required'` on 403 (`pages/admin.js:940,1251`,
`shared/components/admin/PoliciesSection.js:77`,
`shared/components/admin/ReviewQuestionsSection.js:101`,
`shared/components/admin/PromptTemplatesSection.js:97,117`);
`shared/components/workbench/ReviewsTab.js:911` sets `error.denial` on 401/403.
Each of these is a preserved difference: the migration carries the site's
message and branch, it does not unify them.

### 2.4 Existing partial helpers [VERIFIED by reading source]
- `readResponse(response)` at `shared/components/review-panel/review-panel-ui.js:62-66`:
  `json().catch(() => ({}))`, throw `new Error(body.error || \`Request failed (${status})\`)`
  when `!ok`, return body. 14 call sites: `pages/cycle-dossier.js` (8),
  `pages/review-panel.js` (3), `shared/components/workbench/ReviewPanelTab.js` (3). This is the model for the shared helper's default
  behavior.
- `sendJson(url, method, body, fetchImpl = fetch)` at
  `shared/components/meeting-tracker/SessionEditor.js:26-35`: JSON POST/PATCH,
  ok-check-then-throw with a site-specific fallback message, injectable
  `fetchImpl` for tests.
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
  // message = (typeof payload.error === 'string' ? payload.error : payload.error?.message)
  //        || payload.message || fallbackMessage || `Request failed (${status})`
}

// Throwing form. Default for the 254 sites that already check `ok` and throw/set.
export async function requestJson(url, {
  method = 'GET', body, headers, signal, fallbackMessage, fetchImpl,
} = {})
// -> parsed body on 2xx. Throws ApiRequestError on non-2xx. Network/abort
//    errors propagate unchanged (AbortError stays AbortError).

// Non-throwing form. For the 54 sites that do not check `ok`, for sites that
// branch on 409/412/413/202 etc. before deciding whether it is an error, and
// for sites that read `status` on success.
export async function requestEnvelope(url, opts)
// -> { ok, status, data, error }  where error is an ApiRequestError or null.
//    Same body/header/signal handling. Never throws on HTTP status.

// Parse step, exported so the Stage 1 adapters (which receive a Response, not a
// URL) share it. Both request forms call it.
export async function readJsonBody(response, { signal } = {})
// -> parsed JSON object; {} for an empty body (204, content-length 0) and for
//    an unparseable body. Rethrows when the read/parse rejection is an
//    AbortError or when `signal?.aborted` is true, so an abort that lands
//    between headers and body is never reported as a successful `{}`.
```

Invariants (each pinned by a unit test in Stage 0):
1. `fetch` is resolved as `fetchImpl ?? globalThis.fetch` at call time (§2.5).
2. A plain-object `body` is `JSON.stringify`'d and `Content-Type: application/json`
   is added unless the caller set one; `FormData`, `Blob`, `string`, and
   `URLSearchParams` bodies pass through with no content-type added. No live
   client site sends a non-JSON body today [VERIFIED P-B: zero `new FormData`],
   so this clause is a T0 pin, not a served case. The option list is closed
   (`method, body, headers, signal, fallbackMessage, fetchImpl`); the one
   `keepalive` site is allowlisted (§2.6), not served.
3. Caller headers are merged over defaults, so `If-Match` and `lock` survive.
4. Body parse is `readJsonBody`: empty body → `{}`, unparseable body → `{}`,
   abort during body read → rethrown (P-B finding: the incumbent
   `response.json().catch(() => ({}))` swallows abort-during-body, and
   `pollForArtifact` at `shared/components/workbench/StaffDeliberationsTab.js:354-378`
   would keep polling on a `{}` pseudo-status). For the 67 bare-`.json()` sites
   this converts a `SyntaxError` on a non-JSON error body into the site's
   fallback message; recorded as accepted deviation D3.
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

**Stage 1 adapters keep their legacy expressions verbatim.** `readResponse`
becomes `const body = await readJsonBody(response); if (!response.ok) throw new
Error(body.error || \`Request failed (${response.status})\`); return body;` and
`sendJson` keeps `throw new Error(result.error || 'The schedule change could not
be saved.')` over `readJsonBody`. They throw plain `Error`, not
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
| 1 | Fold existing helpers, zero behavior change | `review-panel-ui.js` (`readResponse`), `SessionEditor.js` (`sendJson`, 3); the 14 `readResponse` consumer sites are unchanged by construction |
| 2 | Highest-count files that already have an RTL render test and a single dominant error surface | `AwardeeTab.js` (13 json + 1 excluded), `StaffDeliberationsTab.js` (8), `ConsultantFeedbackSection.js` (8), `pages/expertise-finder.js` (8), `FinalWriteupTab.js` (5), `pages/cycle-dossier.js` (already via `readResponse`; verify only) |
| 3 | Admin surface | `shared/components/admin/*` sections with sites (`PromptTemplatesSection` 5, `SiteVisitRecipientsSection` 4, `OperationalEventsSection` 3, `ReviewQuestionsSection` 3, `DynamicsExplorerRestrictionsSection` 3, `PoliciesSection` 2, `EmailDefaultsSection` 2, `FinalWriteupMatrixAudiencesSection` 2, `SiteVisitMaterialsDefaultsSection` 2, `MeetingTrackerDefaultsSection` 2, `ReviewerRepairAlertDetails` 1), then `pages/admin.js` (32) section by section |
| 4 | Reviewer engagement surface (Tier 2 re-check at stage start; see §1) | `InviteEmailModal.js` (10), `ReviewerInvitePanel.js` (5 + 1 blob excluded), `ReviewerManagePanel.js` (6), `ReviewersTab.js` (5), `ReviewerFindPanel.js` (5), `ReleaseMaterialsModal.js` (4 + 1 stream excluded), `search/useReviewerContactActions.js` (8), `search/useReviewerRosterActions.js` (4), `search/useReviewerPromotion.js` (4), `search/useReviewerDiscovery.js` (4), `search/useReviewerExport.js` (0 migrated; its single site is the allowlisted blob download), `CandidateEditModal.js`, `CampaignConfigModal.js`, `RespondReminderModal.js`, `RemoveEntirelyModal.js`, `ReleaseEmailModal.js`, `email-template-store.js`, `prompt-override-store.js` |
| 5 | Long tail | every remaining file in the census with at least one JSON site: workbench (`ReviewsTab`, `PreSiteDistributionPanel`, `InitialAssessmentTab`, `ReviewPanelTab`, `RequestListPanel`, `RequestLocator`, `ProposalTab`, `ManualReviewEntryForm`, `AwardeesPanel`, `ArtifactVersionHistory`, `OverviewTab`, `ReviewerFollowUpPanel`, `useSiteVisitContext`), meeting-tracker (`MeetingTrackerList`, `SiteVisitEditor`, `SessionAgendaPanel`, `SiteVisitMaterialsCard`), external (`ReviewAuthoringForm`, `GranteeDeliverableForm`, `pages/external/**`), `ProfileLinkingDialog`, `RosterContactField`, `FinalWriteupsViews`, and pages (`scheduled-emails`, `grant-reporting`, `phase-ii-writeup`, `dynamics-explorer`, `dataverse-bulk-export`, `virtual-review-panel`, `phase-i-dynamics`, `review-panel`, and the Executor tool pages' non-stream sites) |
| 6 | Closeout ratchet | ESLint `no-restricted-syntax` for raw `fetch(` in a `files: ['shared/components/**/*.js','pages/**/*.js'], ignores: ['pages/api/**']` flat-config block; the §2.6 allowlist is expressed as a per-site `eslint-disable-next-line` with a reason, never a file-level ignore |

Stage 5 is split into 5a (workbench + meeting-tracker) and 5b (external + pages)
at execution time if the diff exceeds roughly 25 files; each half gets its own
Gate G and review.

## 5. Tests that must exist before each stage starts

**Common rule** (from the precedent): commit a stage's characterization tests
separately and run them green against the unmigrated code before touching
production code. Cite existing tests by name rather than duplicating them. Each
critical group must fail under at least one deliberate mutation (restore
immediately; never commit it). No test hits a live provider or store.

| ID | Required before | Content |
|---|---|---|
| T0 | Stage 0 exit | `tests/unit/api-request.test.js`: every §3 invariant, plus: 2xx JSON, 2xx empty body, non-2xx `{error}`, non-2xx `{message}`, non-2xx non-JSON body, network rejection, AbortError passthrough, FormData body, `If-Match` header survival, `fetchImpl` injection, `globalThis.fetch` late binding (reassign after import). |
| T1 | Stage 1 | `readResponse`/`sendJson` behavior pins: same thrown message text for `{error}`, for empty body, for non-JSON body; same return on 2xx. Existing consumers' tests (verified by name in Stage 0) run green. |
| T2 | Stage 2, per file | For each file: with `global.fetch` mocked, three scenarios per distinct endpoint or per distinct error surface in the file, whichever is fewer: (a) 200 JSON renders the success state, (b) non-2xx `{error:'X'}` shows/sets/throws exactly what it does today, (c) network rejection does the same. Existing RTL tests (`tests/unit/awardee-tab.test.js`, `tests/unit/staff-deliberations-tab.test.js`, `tests/unit/consultant-feedback-section.test.js`, `tests/unit/expertise-finder-batch-cycle.test.js`, `tests/unit/final-writeup-tab.test.js`) are extended, not replaced [VERIFIED P-B: each renders the component and mocks `global.fetch` per scenario]. Fixtures that mock `{ ok: true, json }` without a `status` field (e.g. `expertise-finder-batch-cycle.test.js:31`) must gain `status` before any site in that file moves to `requestEnvelope`. |
| T3 | Stage 3 | Same three-scenario pin for each admin section. For `pages/admin.js`: the four workspace functions (`OperationsWorkspace` :3139, `WorkflowsWorkspace` :3198, `AiWorkspace` :3335, `PeopleWorkspace` :3375) are not exported today and `AdminDashboard` (:3453) reads `router.query` and renders `Layout` (which calls `useSession`). T3 therefore first adds named exports for the four workspace functions (the file already exports sections such as `DynamicsFeedbackSection` and `AppAccessSection` for `tests/unit/admin-dynamics-feedback-filters.test.js` and `tests/unit/app-access-admin-partial-refresh.test.js`), then one test file per workspace mounts the exported workspace with `view` as a prop and mocks `global.fetch` per section. No test mounts `AdminDashboard`. `tests/unit/admin-models.test.js` tests the API route, not the page, and is not a T3 anchor. The 403 → `'Admin access required'` message is pinned verbatim at every site that has it. |
| T4 | Stage 4 | Three-scenario pin per file, plus: body-level `.success`/`.ok` branches in `useReviewerContactActions`, `ReviewersTab`, `ReviewerManagePanel`, `ReviewerFindPanel`, `useReviewerRosterActions` pinned with a 200 + `{success:false}` fixture and a 409 + `{success:false, ...promotionAuthority}` fixture (§2.2). `ReleaseMaterialsModal.js` has no render test today; one is added before its migration or the file is deferred to Stage 5 and the execution doc says which. Existing `tests/unit/invite-email-modal-capture.test.js`, `reviewer-manage-*.test.js`, `tests/unit/reviewer-materials-modal-lifetimes.test.js` run green. |
| T5 | Stage 5 | Three-scenario pin for each file lacking an RTL test today (`scheduled-emails`, `grant-reporting`, `phase-ii-writeup`, `dataverse-bulk-export`, `virtual-review-panel`, `phase-i-dynamics`, `ProfileLinkingDialog`, `ReviewerFollowUpPanel`, `SiteVisitMaterialsDefaultsSection`, `MeetingTrackerDefaultsSection`, `useSiteVisitContext`). Files that already have one get the extension only. |
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
`scripts/census-client-fetch-sites.js` (read-only, writes CSV to a path argument)
and its by-file table into `docs/plans/CLIENT_REQUEST_LAYER_EXECUTION_2026-09-19.md`;
add `shared/utils/api-request.js` with zero callers; add T0. Verify: T0 green,
mutation check (flip invariant 5 to read body `ok`; T0 must fail), full Gate G.
Exit: helper landed unused, census tracked, execution doc created with the
source-to-stage map. Rollback: revert the two commits; nothing else changed.

### Stage 1 — Fold existing helpers
Before: T1. Do: reimplement `readResponse` and `sendJson` over the helper,
keeping exports, signatures, and message text. Verify: T1 and all consumer
tests green; diff of every thrown message string is empty. Exit: 17 sites now
route through the helper with no call-site edits. Rollback: revert one commit.

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

### Stage 4 — Reviewer engagement surface
Before: T4; re-tier check (§1): confirm no request body or method changes at
any invite/reminder/release site by diffing the mocked `fetch` call arguments
in T4 before and after. Do: migrate per file. Verify: T4, existing reviewer
tests, Gate G including `check:reviewer-engagement-boundary`. Exit: group
migrated. Rollback: per-commit.

### Stage 5 — Long tail (5a, 5b if split)
Before: T5. Do: migrate remaining JSON sites. Verify: Gate G. Exit: only
allowlisted raw `fetch(` sites remain; the census script reports the count
and it matches the allowlist. Rollback: per-commit.

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

**Release:** Tier 1. Merge to `main` is an explicit owner decision after Stage 6
or after any earlier stage the owner chooses to ship. Before merge: record the
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
| A3 | The 54 no-`ok`-check sites tolerate non-2xx bodies today; migrating them with `requestEnvelope` preserves that | [VERIFIED by census] behavior preserved by construction; each pinned in its stage's tests |
| A4 | 19 retry/poll wrappers wrap the call site rather than living inside it; the helper stays retry-free and the wrapper is untouched | [VERIFIED P-B for `StaffDeliberationsTab.js:354-378` and `FinalWriteupTab.js:283-291`; remaining 17 verified at their stage] |
| D1 | Pre-existing: 54 sites trust the body without checking `ok` | Characterized, not fixed. Fixing is a behavior change outside this plan; listed for the owner |
| D2 | Pre-existing: `materials-preflight` returns 200 with `ok:false` | Preserved; helper does not interpret body flags |
| D3 | 67 client sites parse with bare `.json()`; a non-JSON error body (an HTML 502 page) surfaces a `SyntaxError` message today and the site's fallback message after migration | Accepted deviation, recorded per site in the execution doc; not preserved behavior |
| D4 | `response.json().catch(() => ({}))` swallows an abort raised during the body read; `readStatus`/`pollForArtifact` (`StaffDeliberationsTab.js:78-83, 354-378`) can loop on a `{}` pseudo-status | Pre-existing at `readResponse`-style sites; fixed by `readJsonBody` rethrow (§3 invariant 4) and pinned in T0 |
| D5 | `search/useReviewerExport.js` was in no stage row or allowlist in the first draft | Fixed: allowlisted (§2.6, §4) |
| D6 | A helper that threw `ApiRequestError` from the Stage 1 adapters would change `.name` at 17 sites | Avoided: Stage 1 adapters throw plain `Error` with the legacy expression (§3); T1 pins `.name === 'Error'` |
| D7 | `shared/components/admin/PromptTemplatesSection.js:478` parses a 409 body with bare `.json()` and `shared/components/reviewers/InviteEmailModal.js:660-665` fires a side effect on 409 before throwing | Both must use `requestEnvelope`; listed for their stages |

Owner decisions requested before Stage 2: (1) confirm no-behavior-change posture
for D1 (recommended: preserve now, fix later per site); (2) whether Stage 4
proceeds in this cycle or waits for a quiet window, given it touches invite and
release call sites (recommended: proceed, Tier 1 controls plus the T4 request-
bytes diff).

## 10. Planning review receipts

| Checkpoint | Reviewer | Commit / doc hash | Verdict | Disposition |
|---|---|---|---|---|
| P-A scope census | Opus (fresh) | `e269756a` / census brief | READY WITH NAMED CHANGES | Applied: nested `error.message` tolerance (§3), SSE not-consolidated restatement (§1, §2.6), counts corrected (215 / 14 / 118), baseline provenance noted. Reviewer's premise challenge (SSE consolidation as a sibling) accepted and recorded, not absorbed into scope. |
| P-B design + stages | Opus (fresh) | `e269756a` / `9c122add…` | READY WITH NAMED CHANGES | Applied: `readJsonBody` with abort rethrow (§3 inv. 4, T0), Stage 1 adapters keep legacy expressions and plain `Error` (§3, D6), T3 uses exported workspace seams and drops the `admin-models` miscite, site-level lint allowlist (T6, Stage 6), `keepalive` beacon and `useReviewerExport.js` placed (§2.1, §2.6, §4), census row for bare `.json()`, D3–D7 and A4 upgrade in §9. Premise challenge accepted: the incumbent parse step is not adopted wholesale. |
| P-C final document | Opus (fresh) | — | pending | — |
| Codex adversarial 1 | gpt-5.6-sol | — | pending | — |
