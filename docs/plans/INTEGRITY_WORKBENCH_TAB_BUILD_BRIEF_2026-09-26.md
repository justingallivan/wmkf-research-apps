---
title: Integrity Screener as a Workbench tab — build brief
status: active
date: 2026-09-26
owner: Codex (build), Claude (review)
---

# Integrity Screener as a Workbench tab — build brief (Codex)

> **Current owner-approved extension:** add screening history, recorded PD
> approval, and a visible Integrity review complete status. Applications are
> normally screened after staff recommend funding. The hard board-readiness
> gate is **deferred** until that application workflow exists; do not invent a
> readiness action or gate earlier review steps. The extension is source-built;
> final review closure is recorded below. Migrations 056–057 remain unapplied.

## Where you are

You are in `../WMKF_Apps-codex` on branch `codex/integrity-workbench-tab` (from `origin/main` at `d9311b754`). Run `/start` first. **Stay on this branch and in this directory**: other agents are working in the main checkout and on other branches. Do not check out other branches, and do not touch the main checkout. Commit to this branch in small, descriptive commits and push it (`git push -u origin codex/integrity-workbench-tab`). Pushing a feature branch does not deploy. **Never push to `main`, and never merge.**

Read `CLAUDE.md`, then `docs/agent-wiki/topics/integrity-screener.md`.

## Goal (owner decisions, 2026-09-26)

Bring the Integrity Screener into the Workbench so a request's people are screened **without typing their names**.

1. **Who is screened:** the request's **PI and Co-PIs**, with their institutions, read **server-side** from Dataverse. Never take names, institutions or person IDs from the request body; the client sends only the request GUID.
2. **Where:** a new **Integrity tab** on the Workbench request page (`pages/workbench/[requestId].js`, `TABS` at ~:49–60). It has a "Run screen" action, per-person results, and when the run happened.
3. **Persistence:** the **latest run per request** is saved and shown again on reload. Earlier runs may remain in the table, but the tab shows the latest.
4. **The standalone `/integrity-screener` page stays** for ad-hoc manual names. Its behavior must not change.

## Original pre-build baseline (historical; implementation and extension below supersede it)

- **Screening engine:** `IntegrityService.screenApplicants(applicants, claudeApiKey, serpApiKey, userProfileId)` is an async generator (`lib/services/integrity-service.js:35`) that yields progress and results. The existing route `pages/api/integrity-screener/screen.js` shows how it is called, streamed, authorized, and given its keys. Reuse the service; don't fork its logic. Read what shape `applicants` must have from the service and the standalone page.
- **History store:** Postgres `integrity_screenings` (fresh-install shape in `scripts/setup-database.js:151-163`; writer `saveScreening` at `integrity-service.js:579`; readers ~:607-626). It has **no request column today**.
- **People:**
  - The PI/Co-PI junction is Dataverse `wmkf_apprequestperson`, read through `lib/dataverse/adapters/app-request-person.js` (`queryCoPIs`, `queryPersons`, `queryAllPersons`).
  - The documented read strategy is the **UNION** of the junction (roles PI=100000000 and Co-PI=100000001) with `akoya_request._wmkf_projectleader_value`. See `docs/atlas/dataverse-wmkf-apprequestperson.md` "Source of truth" and the header of `pages/api/reviewer-finder/contact-history.js`.
  - Deduplicate by contact. Find how existing Workbench code resolves a contact's name and institution (the Proposal/Overview tab readers and the external review context route) and reuse that path.
- **Tab gating:** tabs are filtered by `visibleTabsFor(hasAccess)` via an optional `gate` app key (`[requestId].js:62-63`). Gate the new tab on the Integrity Screener's app key from `shared/config/appRegistry.js` (`integrity-screener`), and gate the server routes on the same key with `requireAppAccess`, so the UI gate mirrors the server guard.

## Required work

1. **Migration:** add a nullable `request_id` (UUID) to `integrity_screenings` with an index for "latest by request". **Number it 056**, because 055 is claimed by the unmerged `codex/feature-request` (`055_post_presentation_materials.sql`); whoever merges second renumbers if needed. Update the migrations manifest (`npm run prebuild` / `check:migrations-manifest`), the fresh-install mirror in `scripts/setup-database.js`, and the Atlas (`docs/APPLICATION_STATE_ATLAS.md` rows for `integrity_screenings`, plus any Postgres atlas page that covers it). Do not apply the migration anywhere; the owner applies it at release. `node scripts/apply-migrations.js` is the existing-database path.
2. **Service:**
   - A request-scoped entry point that loads the PI/Co-PIs server-side, calls `screenApplicants`, and saves the run with its `request_id`.
   - A reader returning the latest saved run for a request.
   - Keep routes thin (`check:route-service-boundary`). Dataverse reads go through adapters inside `withDalContext` (`lib/dataverse/core/context.js`).
3. **API routes**, e.g. `pages/api/workbench/integrity/` for run and latest:
   - `requireAppAccess('integrity-screener')`;
   - GUID-validate the request id (`check:trust-boundary-guid`);
   - call `loadModelOverrides()` before resolving any LLM model (`check:model-override-warming`);
   - register each route in `docs/API_ROUTE_SECURITY_MATRIX.md` and update `CANONICAL_COUNTS` (route-file and `requireAppAccess` counts; `check:fact-consistency`).
   
   Use the actor from the authenticated context, never from the request.
4. **UI:**
   - A new tab component under `shared/components/workbench/` (follow neighboring tab components' structure and loading/error states).
   - The tab entry in `TABS`.
   - It shows the people to be screened before a run.
   
   Do **not** modify shared primitives (`shared/components/Layout.js` etc.). The current Dismiss placeholder and PDF/JSON/Markdown exports are out of scope unless reusing them is trivial.
5. **Cost guard:** a run spends Claude and SerpAPI credits per person. The UI should confirm before running, and the server must refuse an empty or unexpectedly large person list. Choose a sane cap and say why in the service header.
6. **Docs:**
   - Update `docs/agent-wiki/topics/integrity-screener.md` ("Current UI boundaries") and run `check:agent-wiki`.
   - Add a service catalog entry if you add a service module (`docs/SERVICE_AND_UTILITY_CATALOG.md`).

## Tests and gates

- Unit tests with fakes for:
  - people loading (UNION, dedupe, a PI who is also a Co-PI, no people);
  - the route (auth refusal, bad GUID, request body names ignored);
  - persistence (the latest run by request);
  - the tab (gated hidden, empty, results).
- **Never run a live screen:** it spends paid credits. No live Dataverse writes. Local read-only runs against the app are fine if you need them.
- Run gates for surfaces you touched, **each gate then its `:self-test`, sequentially**: `check:migrations-manifest`, `check:api-routes`, `check:route-service-boundary`, `check:route-lifecycle-auth`, `check:trust-boundary-guid`, `check:model-override-warming`, `check:prompt-injection-tagging`, `check:dataverse-access-layer`, `check:atlas`, `check:fact-consistency`, `check:doc-currency`, `check:agent-wiki`, `check:secret-scan`, `check:types`.
- Then `npm run lint` and `npm run build`. Run the full unit suite: `npx jest tests/unit`.

## Hand-back

When done, leave a short summary at the end of this file covering:
- commits;
- files changed;
- the migration number used;
- routes added;
- test and gate results;
- anything you decided differently from this brief, and why.

Claude reviews the branch read-only before the owner decides on merge.

## Original tab build hand-back — 2026-09-26

**Owner/branch:** Codex orchestrated and reviewed; Luna built the backend, UI,
tests, and documentation; Sol reviewed the implementation and accepted the
corrected source with no remaining material finding. Work stayed in
`WMKF_Apps-codex` on `codex/integrity-workbench-tab`, starting at `a09a75932`.
This is branch implementation evidence, not a production deployment claim.

**Commits:**
- `7cf4c2ec5` — request-scoped service, GET/POST routes, migration 056, schema
  mirror, and backend tests.
- `95358498b` — gated Integrity tab, UI/browser tests, Atlas, route matrix,
  canonical counts, service catalog, and Integrity Screener wiki updates.
- `8a7e6b8a8` — Opus-driven evidence rendering and error-path corrections.

**Changed surfaces:** `lib/services/workbench/integrity-service.js` resolves the
UNION roster, deduplicates contacts, caps it at ten, reuses the existing engine,
and awaits a request-linked insert. `shared/components/workbench/IntegrityTab.js`
shows the current roster, credit confirmation, latest saved results, source
status/errors, and evidence links. `pages/workbench/[requestId].js` gates the tab
on `integrity-screener`. The standalone engine, page, and routes are unchanged.

**Migration/routes:** `056_integrity_screenings_request_id.sql` adds nullable
UUID linkage and a partial `(request_id, created_at DESC, id DESC)` index. The
manifest and fresh-install schema match. New endpoints are GET
`/api/workbench/integrity/[requestId]` and POST
`/api/workbench/integrity/[requestId]/run`; both require the Integrity Screener
grant and a scalar valid request GUID. POST uses the authenticated profile and
ignores client-supplied identities.

**Verification [VERIFIED via local commands, source review, and fixture browser]:**
- All required gates and available paired self-tests passed sequentially;
  OData escaping and Dynamics context boundary checks also passed.
- Full unit suite: **1,091 suites / 16,318 tests passed**, one snapshot passed.
  The old migration-054 test now verifies its ordering after 053 instead of
  forbidding all later migrations.
- Lint passed with zero errors (122 warnings repository-wide, including two
  hook-pattern warnings in the new tab); final touched-file lint also passed.
- Final production build passed. The fixture-only Chromium test passed,
  including loading, cancel/confirm, body shape, incomplete-source rendering,
  evidence links, desktop, and 390px mobile with no horizontal overflow. Every
  API request was mocked; unexpected API requests were blocked and none occurred.
- Builder mutation checks demonstrated red tests when dedupe, the person cap,
  save-error propagation, stale-response protection, or incomplete-source
  detection were removed, then passed after restoration. Root inspected the
  implementation and desktop/mobile renders; the design detector reported no
  findings.

**Implementation decisions:** the defensive cap is ten people, not a business
rule. Request affiliation fallback applies only to the current Project Leader;
unknown contact affiliations remain blank. A schema read precedes paid calls,
and a Workbench-owned `INSERT RETURNING` makes persistence failure visible while
leaving the standalone engine's existing save behavior unchanged. GET carries
the model-warming gate's documented read-only annotation because its shared
module also exports the POST runner; GET never resolves a model. Run failures
preserve previous results and ambiguous server failures advise reloading before
another run.

**Release boundary:** migration 056 was not applied; no live screen, Dataverse
write, merge, or production deployment was performed. The owner must coordinate
migration numbering with the parallel 055 branch, apply the existing-database
migration through `scripts/apply-migrations.js`, and deliberately promote the
feature. No production milestone entry is required for this unmerged build.

### Opus adversarial review and adjudication

Two read-only Claude Opus reviews ran through the host OAuth session after the
owner explicitly approved source egress and subscription/credit usage. The
backend review accepted the core authorization, roster, and persistence
contracts with no high-severity finding. The UI review found a real source-shape
bug: Retraction Watch URLs are semicolon-separated text, not arrays. Its related
findings identified hidden concern labels on incomplete screens and missing
per-source flags when result counts were present. These findings were accepted
for a bounded correction batch, along with disabling screens for nameless
contacts, clearer uncertain-outcome recovery, and mapping real Dataverse 404
errors before any Postgres or screening work.

The following concerns were retained for the original tab scope. The new
PD-approval contract below changes the treatment of source failures:

- **Existing engine error semantics:** some SerpAPI and Retraction Watch failures
  are swallowed as empty results by the unchanged shared engine. The Workbench
  cannot distinguish these from successful empty searches using its existing
  result contract. The UI marks exposed errors/unsearched sources incomplete;
  it does not prove source health. This behavior already affected manual screens
  and their saved history. The PD-approval extension must address this contract before accepting a
  screen as complete; valid empty searches must remain distinguishable from
  failures. Legacy standalone behavior remains the default.
- **Synchronous runtime:** screening remains sequential within the existing
  300-second route budget. Ten people is a spend ceiling, not a proven runtime
  guarantee; provider latency was not live-tested. A timeout can consume credits
  without saving a complete run. Streaming or durable per-person jobs are outside
  this brief. Reload saved history before retrying an uncertain run.
- **Explicit repeat/concurrent runs:** the server does not serialize runs across
  tabs or staff sessions. Leaving the tab and confirming a second run can spend
  again. The cap, confirmation, and rate limiter are not an idempotency guarantee;
  a recent completed-run check would not prevent concurrent in-flight calls.
- **Access and history scope:** the exact `integrity-screener` grant is retained
  as the owner's explicit contract, including direct route access. Request
  history is shared with authorized Integrity users. Existing actor-scoped manual
  history APIs also see the new `workbench` rows because they share the table;
  the standalone page does not call that history API and remains unchanged.
- **Release order:** apply migration 056 before promoting the runtime. Before
  migration, GET fails safely rather than showing partial history; POST's schema
  preflight prevents paid calls. Over-cap rosters also fail closed on GET.

**Original tab closure [VERIFIED]:** the accepted corrections landed in `8a7e6b8a8`.
Sol's narrow follow-up review found no material blocker, and root reviewed the
final source and desktop/mobile renders. After those corrections, all listed
gates/self-tests, the production build, touched-file lint (zero errors), and the
updated fixture-only browser check passed again. Focused final tests passed
15/15 for service/routes and 15/15 for the tab/gate; the full-suite result above
preceded this last correction batch. No further Opus round was run; Codex
adjudicated the findings and Sol verified their closure as authorized.

This brief is the scoped branch handoff; unrelated Factory session instructions
and production milestone history were left unchanged. The original tab closure
above does not certify the PD-approval extension below.

## Current extension — screening history and PD approval

**Owner decisions [VERIFIED via this task's owner replies]:**
- Normal sequence: staff recommend funding, then run the integrity screen, then
  record PD approval, before marking the application ready for the board.
- Staff ordinarily do not screen applicants they have not recommended for funding.
- The recommendation/board-readiness checkpoint is not yet built. Build the audit
  and approval capability now; defer the hard progression gate until that
  workflow exists. Do not create a disconnected readiness action.
- A saved screening run alone is not PD approval. Expose a distinct visible
  **Integrity review complete** status.

**Implementation contract [SOURCE-BUILT on this branch; not deployed]:**
- Keep request-linked screening evidence in `integrity_screenings`; expose paged
  historical runs and their decisions, while retaining the latest result view.
- Add an append-only `integrity_screening_reviews` audit table in migration 057,
  after 056. Each event records the exact screening/request, authenticated
  reviewer profile and Dynamics identity, decision (`approved` or `hold`), notes,
  and time. Hold requires notes. This operational audit does not set a Dataverse
  funding recommendation, final decision, or board-readiness field.
- Require the Integrity Screener grant plus the request's current lead PD or a
  superuser with an attributable staff identity to record a disposition. Use the
  existing Workbench lead-PD authorization convention; other authorized readers
  can inspect evidence/history but cannot approve it.
- Permit approval only for the latest request-linked run, with the same current
  contact IDs, names, roles, and institutions, and a result for every screened
  person with all three sources successfully searched. Retain old approvals as
  history, but a new run or changed roster requires review again. A hold can be
  recorded for the latest incomplete run, but is never a completion signal.
- Workbench calls opt into explicit strict source-error reporting in the shared
  engine. Each result records `sourceCoverageVersion: 1`; older unversioned
  results remain visible but require rerunning before approval. Strict handling
  must expose Retraction Watch SQL errors, SerpAPI transport/API/parse failures,
  and summary failures. Valid empty searches remain valid. Standalone callers
  keep existing default behavior. SerpAPI's documented successful-empty response
  is distinguished from operational errors using metadata and empty-result state
  ([provider reference](https://serpapi.com/blog/fix-serpapi-errors-guide/)).
  Strict mode also rejects unusable result items and retains articles from
  documented News highlight/story groups before validation. A once-per-screen
  check rejects an empty or unavailable Retraction Watch corpus; it does not
  establish corpus completeness or freshness.
- Show reviewer/time/notes and historical findings. Historical run panels are
  read-only. Refresh review state after a new screen; never retain an old green
  completion indicator when refreshed context is unknown. All asynchronous
  screen/review/history operations must remain request-generation guarded.
- No automatic screening, live screen, Dataverse write, schema apply, funding
  decision, or readiness gate is part of this extension. Failed/aborted attempts
  without persisted results are not a durable attempt ledger in this scope;
  persisted partial-source runs remain inspectable and cannot be approved.

| Invariant | Changed surfaces | Verification |
|---|---|---|
| A run is not a human approval | Service, review table, tab | No event means needs review even with zero findings |
| Review actor and authority are server-owned | Review route/service | Spoofed body, non-lead PD, missing identity rejected |
| Approval cannot bless different or incomplete evidence | Service + strict engine | Wrong request/run, new run, roster drift, source failures, old marker rejected |
| Review events preserve prior decisions | Migration/service/history | Append-only writer, latest-event derivation, old events remain visible |
| Stale UI cannot confer apparent completion | Tab and pagination | Deferred responses across request changes ignored; refresh failure not green |
| Standalone default behavior is preserved | Optional engine argument | Legacy failure behavior tests plus strict-mode mutation check |
| No disconnected progression gate | Routes/services/docs | No changes to triage, leadership transitions, lifecycle status, or snapshot writers |

**Enforcement boundary [VERIFIED via source search]:**
`shared/components/workbench/StatusTab.js` is read-only for the Dynamics lifecycle
status. Final Writeup group/leadership review and document-level Board Ready
snapshots are different contracts. The eventual application-readiness writer
must be identified and integrated in its own scoped work; this extension makes
no claim that recording a funding or board decision is blocked.

## Extension validation and handoff — 2026-09-27

**Changed surfaces [VERIFIED via source and tests]:** request-scoped history and
review service/GET, new POST `/api/workbench/integrity/[requestId]/review`,
migration 057 and fresh-install mirror/manifest, opt-in strict source reporting,
Integrity tab history/decision UI, tests, route matrix, Atlas, service catalog,
canonical counts, and Integrity wiki. Codex orchestrated; Luna built the
backend/UI/docs; Sol reviewed; Codex tightened strict provider parsing and
reviewed desktop/mobile renders. Strict source reporting is committed in
`ef7b9cca6`; history, PD decisions, migration 057, and extension documentation
are committed in `74e783b0e`.

**Validation [VERIFIED via local commands, offline fixtures]:**
- Production build passed; repository lint passed with zero errors and 122
  existing warnings. All 31 scoped gate/self-test invocations passed, each gate
  preceding its self-test.
- All 1,094 unit suites passed as part of the broader Jest run. That run had
  1,118 passing suites and nine failing integration suites (27 tests). Running
  those nine suites against the pre-extension `e3d17710f` snapshot reproduced
  the same 27 failures; they are baseline failures, not an all-green suite claim.
- Strict engine tests passed 20/20, including transport/parse/provider/SQL/summary
  failures, successful empty searches, malformed items, grouped News articles,
  and legacy defaults. Removing the strict failure propagation made its test
  fail; restoring the guard restored green.
- UI tests passed 24/24. The Chromium fixture test passed at desktop and 390px
  mobile width; root inspected both renders. All application API requests were
  intercepted; unexpected requests abort. No live screen or database write ran.
- Backend tests exercised exact actor/run/request binding, roster and coverage
  rejection, hold notes, history cursor scoping, and post-write refresh. Removing
  each authorization, roster, or coverage guard made its corresponding test fail.

**Sol/root review closure [VERIFIED]:** Sol found an append-time latest-run race.
The review INSERT now conditionally checks the latest request run within the
write statement and returns 409 if a newer run was saved before that statement.
A new run saved afterward is handled by the post-write context refresh; its
completion is not inherited from the previous run. The final review service and
route tests passed 11/11. Removing the SQL predicate made the regression test
fail, and restoring it restored green. Sol then reported no remaining material
blocker. Root verified the correction. No production database probe is claimed.

**Supplemental Opus review and adjudication [VERIFIED]:** after separate owner
approval, one read-only Claude Opus review ran through host OAuth against
`74e783b0e`. It reported one Medium finding and nothing High: a successful query
against an empty Retraction Watch table could be recorded as complete coverage.
It also identified a concrete history-pagination risk from round-tripping a
microsecond database timestamp through a JavaScript Date. Codex accepted both
for one bounded Luna correction batch:
- Strict screening checks corpus availability once for the whole screen. An
  empty/missing/error response becomes a sanitized per-person source error,
  making approval unavailable. Standalone behavior remains unchanged.
- History pagination compares against the cursor row inside Postgres, scoped to
  the request. The page query no longer interpolates a JavaScript timestamp.
- Root's final focused run passed 51/51 tests across five suites. Tests cover
  successful zero matches with an available corpus, unavailable corpus cases,
  one availability check for multiple people, and database-side cursor bindings.
  Removing the corpus guard made its tests fail, then passed after restoration.
  Sol reviewed both corrections and found no remaining material blocker.

**Residual review limits:** the corpus check proves nonempty, not a full or
current import. `scripts/import-retraction-watch.js --clear` deletes then imports
in batches without an atomic swap; screening must not overlap a destructive
reload, and corpus initialization/completeness must be verified at release.
Changing that importer is outside this extension. Conditional INSERT typing,
array binding, and cursor SQL were source-reviewed and mock-tested, not exercised
against a real Postgres instance; retain a database integration check before
release. No second supplemental Opus call was made: Codex adjudicated and Sol
verified the bounded fixes as the owner requested.

**Release boundary:** apply both 056 and 057 through `scripts/apply-migrations.js`
only as part of an owner-authorized release. Confirm migration numbering against
other unmerged branches first. No merge, schema apply, live screening, or
deployment occurred. Hard application progression enforcement and a durable log
of failed/aborted attempts remain outside this extension. No production milestone
entry is required; this brief is the scoped branch handoff.
