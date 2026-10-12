---
title: Admin page decomposition — staged plan
domain: architecture
kind: plan
status: draft
summary: "Finish the half-done extraction of pages/admin.js (3,649 lines, 27 inline components) into shared/components/admin/, one workspace per stage, no behavior change, build and tests green between stages; written so a cheaper model can execute it stage by stage."
canonical: false
owner: product-engineering
related:
  - docs/plans/LARGEST_UNPLANNED_REFACTOR_SCOPE_2026-10-11.md
  - docs/plans/EMAIL_DEFAULTS_ADMIN_GROUPING_BUILD_BRIEF_2026-09-10.md
  - docs/plans/MESSAGES_POLICIES_ADMIN_REFINEMENT_BUILD_BRIEF_2026-09-10.md
---

# Admin page decomposition — staged plan

Candidate **C** from `LARGEST_UNPLANNED_REFACTOR_SCOPE_2026-10-11.md`. Source baseline `origin/main`
`b3135037c`. Status: **draft — not authorized**. Tier 0/1 (no runtime behavior change, no schema,
no API change); still lands by branch + PR per `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`.

## 0. Executor instructions (read first)

- The plan worktree has no `node_modules`; run `npm ci` in your worktree before Stage 0 (lock is npm-10
  compatible — do not regenerate it; see `project-ci-npm10-lockfile-parity`).
- You are moving code, not changing it. Every stage is "same JSX, same hooks, same fetch calls,
  new file". If a move requires changing behavior to compile, **STOP-AND-ASK**.
- Before every stage: run §4 "Pre-stage re-probe". If any count differs from the previous Stage Log
  entry, update the stage's file list first and log the delta.
- After every stage: run §4 "Green gate", then the §6 fresh-context review. Do not start the next
  stage with an open review finding.
- Never edit files outside the stage's list. Never touch `pages/api/admin/*`.
- Work in a worktree off `main`; one commit per stage; PR at the end (or one PR per stage if the
  owner asks).

## 1. Baseline (probed, not assumed)

All `[VERIFIED via file:line at b3135037c]` unless labeled.

- `pages/admin.js`: 3,649 lines; 99 `useState(`; 18 `useEffect(`; 27 top-level components
  (`grep -nE '^(export )?function [A-Z]'`). No `getServerSideProps`/`config` export.
- Component inventory with line spans (start line, length):

  | Component | Start | Lines | Kind | Fetches | Used by |
  |---|---|---|---|---|---|
  | `StatusBadge` | 54 | (169 incl. consts 71–222) | helper | — | Health, HealthHistory |
  | `HealthSection` | 223 | 119 | section | `/api/health` | Operations:health |
  | `HealthHistorySection` | 342 | 175 | section | `/api/admin/health-history` | Operations:health |
  | `SystemAlertsSection` | 517 | 141 | section | `/api/admin/alerts` | Operations:incidents |
  | `MaintenanceSection` | 658 | 122 | section | `/api/admin/maintenance` | Operations:jobs |
  | `SecretExpirationSection` | 780 | 173 | section | `/api/admin/secrets` | Operations:credentials |
  | `UsageSection` | 953 | 239 | section | `/api/admin/stats` | Ai:usage |
  | `SummaryCard` | 1192 | 55 | helper | — | Usage |
  | `RegistryStatusPills` | 1247 | 26 | helper | — | ModelConfig |
  | `ModelConfigSection` | 1273 | 334 | section | `/api/admin/models` | Ai:models |
  | `RoleManagementSection` | 1607 | 223 | section | `/api/dynamics-explorer/roles`, `/api/user-profiles?all=true` (1622–1707) | People:roles |
  | `AppAccessSection` (exported) | 1830 | 343 | section | `/api/app-access`, `/api/admin/users?id=` (DELETE) (1853–2018) | People:app-access |
  | `DynamicsFeedbackSection` (exported) | 2173 | 233 | section | `/api/dynamics-explorer/feedback` (2196, 2219) | Operations:feedback |
  | `DynamicsIdentitySection` | 2406 | 124 | section | `/api/admin/reconcile-identities`, `/api/user-profiles` | People |
  | `AlertRecipientsSection` | 2530 | 226 | section | `/api/admin/alert-recipients` | Operations:notifications |
  | `HonorariumAmountSection` | 2756 | 95 | section | `/api/admin/honorarium-amount` | Workflows |
  | `ReviewerReleaseAttachmentsSection` | 2851 | 71 | section | `/api/review-manager/release-settings` | Workflows |
  | `ReviewerCampaignTimelineSection` | 2922 | 183 | section | `/api/review-manager/campaign-timeline-defaults` | Workflows |
  | `ReviewerTimeBudgetSection` | 3105 | 99 | section | `/api/admin/reviewer-time-budget` | Workflows |
  | `OperationsWorkspace` (exported) | 3204 | 59 | workspace | — | `WorkspaceContent` |
  | `WorkflowsWorkspace` (exported) | 3263 | 148 | workspace | — | `WorkspaceContent` |
  | `AiWorkspace` (exported) | 3411 | 40 | workspace | — | `WorkspaceContent` |
  | `TestRequestsWorkspace` | 3451 | 35 | workspace (owns `factoryTarget` state) | — | `WorkspaceContent` |
  | `PeopleWorkspace` (exported) | 3486 | 39 | workspace | — | `WorkspaceContent` |
  | `ResourceLinks` | 3525 | 22 | helper | — | Operations (3219), Ai (3425) |
  | `WorkspaceContent` | 3547 | 19 | router | — | `AdminDashboard` |
  | `AdminDashboard` (default) | 3566 | 84 | page | — | Next.js |

- Every inline section is **prop-less and self-contained** (`grep -nE '^function [A-Z][A-Za-z]*\(\{'`
  returns only the four helpers and `WorkspaceContent`). `AdminDashboard` passes no state down;
  the only cross-component state is `TestRequestsWorkspace`'s local `factoryTarget`.
- Module-level constants and helpers and who uses them (line numbers of use):
  `SERVICE_LABELS` (71) → 301, 314 (HealthSection), 339 (inside `getFailingServices`), 490 (HealthHistorySection) — `StatusBadge` itself does not use it;
  `getFailingServices` (335) → 446; `PERIOD_OPTIONS` (35), `formatCost` (42), `formatTokens` (47)
  → UsageSection only (990–1177); `MODEL_TYPE_LABELS` (1202), `APP_MODEL_NAMES` (1211),
  `shortModelLabel` (1237), `formatPriceDollars` (1242) → RegistryStatusPills/ModelConfig only
  (1258, 1402, 1450–1461); `ROLE_OPTIONS` (1601) → 1812, inside `RoleManagementSection` (1607–1829; the comment at 1600 reads
  "Section C: Role Management"); the sixteen `*_DATAVERSE_FIELDS` arrays (80–222) are
  passed as `dataverseFields=` by the **workspaces** (`AdminEditorPanel` wrappers at 3234–3462),
  except `SECRET_EXPIRATION_DATAVERSE_FIELDS`, used inside `SecretExpirationSection` (863).
- Already-extracted convention: `shared/components/admin/*Section.js` (14 files), default-export,
  prop-less, own `useState`/`useEffect`, fetch via `shared/utils/api-request` (`requestJson`),
  e.g. `MeetingTrackerDefaultsSection.js:1-40`. Workspace registry and panel chrome live in
  `shared/components/admin/AdminWorkspaceNavigation.js` (`ADMIN_WORKSPACES`:6,
  `resolveAdminLocation`:87, `adminLocationForHash`:95, `AdminEditorPanel`:217).
- `AdminDashboard` keeps every visited location mounted and toggles `hidden` (`visitedLocations`,
  3572, 3626–3642), so section state survives view switches — the Stage 0 coverage test must render
  one view at a time and must not assert on unmount behavior.
- Tests that import `pages/admin` (6 files, 106 tests): `admin-operations-workspace` (39, renders
  `<OperationsWorkspace view=…>`), `admin-people-workspace` (29), `admin-ai-workspace` (17),
  `admin-workflows-workspace` (11), `app-access-admin-partial-refresh` (8, renders
  `<AppAccessSection/>`), `admin-dynamics-feedback-filters` (2, renders
  `<DynamicsFeedbackSection/>`). They mock `global.fetch` by URL (`mockFetchRouter`,
  `admin-operations-workspace.test.js:34-35`). 14 more test files import extracted sections
  directly from `shared/components/admin/`. **A seventh coupling:** `tests/unit/admin-models.test.js:216-232`
  reads `pages/admin.js` as source text (`readFileSync`) and asserts six strings that all sit inside
  `ModelConfigSection` (1323, 1456, 1537, 1563, 1567, 1573). It is not found by the import grep.
- Docs/memory naming `pages/admin.js`: 39 files, including `.claude-memory/project-admin-dashboard.md`
  and `docs/agent-wiki/topics/dataverse-dynamics.md`. The path keeps existing, so
  `check:doc-symbol-refs` stays green; prose that says a section "lives in pages/admin.js" is
  reconciled in Stage 5.

## 2. Decisions (pre-made — do not relitigate)

1. **Target layout.** Sections → `shared/components/admin/<Name>Section.js` (default export, matching
   the 14 existing). Workspaces → `shared/components/admin/workspaces/<Name>Workspace.js` (named
   export, same signature `({ view })`). Shared helpers → `shared/components/admin/health-status.js`
   (`StatusBadge`, `SERVICE_LABELS`, `getFailingServices`), `shared/components/admin/ResourceLinks.js`.
   Single-consumer helpers move **into** their consumer file (`SummaryCard`, `formatCost`,
   `formatTokens`, `PERIOD_OPTIONS` → `UsageSection.js`; `RegistryStatusPills`,
   `MODEL_TYPE_LABELS`, `APP_MODEL_NAMES`, `shortModelLabel`, `formatPriceDollars` →
   `ModelConfigSection.js`). `*_DATAVERSE_FIELDS` arrays move to the **workspace** that passes
   them; `SECRET_EXPIRATION_DATAVERSE_FIELDS` moves into `SecretExpirationSection.js`.
2. **Transitional re-exports.** `pages/admin.js` keeps `export { X } from '…'` for every name a
   test imports today (`OperationsWorkspace`, `WorkflowsWorkspace`, `AiWorkspace`,
   `PeopleWorkspace`, `AppAccessSection`, `DynamicsFeedbackSection`) until Stage 5 re-points the
   tests; then the re-exports are deleted in the same commit. Named exports from a Pages Router page
   are already the status quo, so this is not new.
3. **No behavior change.** Same component names, same JSX, same hook order, same fetch URLs, same
   `aria`/text content. Tests must pass **unchanged** at Stages 1–4, with one named exception: the
   source-text path in `tests/unit/admin-models.test.js:216-232` changes from `pages/admin.js` to
   `shared/components/admin/ModelConfigSection.js` in Stage 2 (path only; the six asserted strings
   stay identical). Import paths change at Stage 5. Any other test change → STOP-AND-ASK.
4. **No new abstractions.** No shared "useAdminResource" hook, no section registry, no context. If
   duplication is noticed, note it in the Stage Log; do not fix it here.
5. **Code splitting is Stage 6, conditional, measured.** Same rule the Workbench used
   (`WORKBENCH_RESPONSIVENESS_EXECUTION_2026-09-18.md:37`): a production bundle measurement first,
   a predeclared ≥ 5 % first-load reduction gate for `/admin`, or Stage 6 is recorded as omitted.

## 3. Non-goals

Any change to `pages/api/admin/*`; renaming sections or views; `ADMIN_WORKSPACES` changes;
styling; the Test Requests workspace internals (already extracted); `pages/admin/transcription-pilot.js`.

## 4. Verification protocol

**Pre-stage re-probe** (paste results into the Stage Log):
```bash
wc -l pages/admin.js
grep -cE '^(export )?function [A-Z]' pages/admin.js
grep -nE '^(export )?function [A-Z][A-Za-z]*\(' pages/admin.js | sed 's/(.*//'
ls shared/components/admin | wc -l
grep -rl "pages/admin'" tests/unit | sort
grep -rln "pages/admin" tests | grep -v "pages/admin'"      # source-text couplings (admin-models.test.js today)
```

**Green gate** (every stage; all must exit 0):
```bash
npx jest tests/unit/admin-operations-workspace.test.js tests/unit/admin-people-workspace.test.js tests/unit/admin-ai-workspace.test.js tests/unit/admin-workflows-workspace.test.js tests/unit/app-access-admin-partial-refresh.test.js tests/unit/admin-dynamics-feedback-filters.test.js tests/unit/admin-view-coverage.test.js
npx jest --testPathPatterns 'admin|Section' --silent          # Jest 30 flag name (package.json pins ^30.5.2)
npm run lint
npm run check:types
npm run build
```
`check:types` covers only `// @ts-check` files listed in `tsconfig.check.json` (not `pages/admin.js`); it
is in the gate as a regression guard, not as proof for this page. `npm run build` is the compile proof for the page (the admin page has no SSR data path, so a
successful build plus the render tests is the behavioral proof). Full `npm test` runs at Stage 5.

**Stage acceptance** also requires: `git diff --stat` touches only the stage's listed files; moved
code is byte-identical except import lines and `export` keywords (`git diff --color-moved=zebra`
shows pure moves — reviewer checks this).

## 5. Stages

### Stage 0 — Characterization test and baseline (no production code changes)

Prerequisite test that must exist before Stage 1: `tests/unit/admin-view-coverage.test.js`.
It iterates `ADMIN_WORKSPACES` from `shared/components/admin/AdminWorkspaceNavigation.js` (6 workspaces,
21 views at baseline), and for every `(workspace.key, view.key)` renders `<WorkspaceContent workspace=… view=…>` (exported from
`pages/admin.js` for this purpose — add `export` to `WorkspaceContent`, the one allowed edit) with
`global.fetch` mocked to resolve `200 {}` for any URL, asserting: no throw, and for each view the
set of URLs fetched during first render equals a snapshot recorded in the test file (so a move that
drops or duplicates a fetch fails). Also snapshot the list of `aria-label`s / headings per view.
Record baseline counts from §4 in the Stage Log. Commit.

### Stage 1 — Operations workspace sections

Move, in this order (lowest coupling first), each to `shared/components/admin/<Name>.js`:
1. `health-status.js` ← `StatusBadge`, `SERVICE_LABELS`, `getFailingServices` (named exports).
2. `HealthSection.js`, `HealthHistorySection.js` (import from `./health-status`).
3. `SystemAlertsSection.js`, `MaintenanceSection.js`.
4. `SecretExpirationSection.js` (+ `SECRET_EXPIRATION_DATAVERSE_FIELDS` inside it).
5. `AlertRecipientsSection.js`.
6. `DynamicsFeedbackSection.js` (keep the re-export in `pages/admin.js`).
`pages/admin.js` imports them; nothing else changes. Expected `wc -l pages/admin.js` after:
≈ 3,649 − (119+175+141+122+173+226+233+~60 helper) ≈ 2,400 — log the actual number.

### Stage 2 — AI workspace sections

1. `ModelConfigSection.js` ← `ModelConfigSection` + `RegistryStatusPills`, `MODEL_TYPE_LABELS`,
   `APP_MODEL_NAMES`, `shortModelLabel`, `formatPriceDollars`.
2. `UsageSection.js` ← `UsageSection` + `SummaryCard`, `PERIOD_OPTIONS`, `formatCost`, `formatTokens`.
Pre-check (STOP if false): `grep -n 'ROLE_OPTIONS' pages/admin.js` shows its only use at 1812 inside
`RoleManagementSection`; it moves with that section in Stage 4, not here. In this stage also change the
`readFileSync` path in `tests/unit/admin-models.test.js:216-232` to the new `ModelConfigSection.js`
(Decision 3 exception) and confirm all six asserted strings are present in the moved file.

### Stage 3 — Workflows workspace sections

`HonorariumAmountSection.js`, `ReviewerReleaseAttachmentsSection.js`,
`ReviewerCampaignTimelineSection.js`, `ReviewerTimeBudgetSection.js`. Their `*_DATAVERSE_FIELDS`
stay in `pages/admin.js` until Stage 5 (they are referenced by `WorkflowsWorkspace`).

### Stage 4 — People workspace sections

`RoleManagementSection.js` (+ `ROLE_OPTIONS`), `AppAccessSection.js`, `DynamicsIdentitySection.js`. Keep the `AppAccessSection` re-export.

### Stage 5 — Workspaces, helpers, constants; re-point tests; reconcile docs

1. `shared/components/admin/ResourceLinks.js`.
2. `shared/components/admin/workspaces/{Operations,Workflows,Ai,TestRequests,People}Workspace.js`,
   each taking its `*_DATAVERSE_FIELDS` constants with it.
3. `pages/admin.js` keeps only imports, `WorkspaceContent`, `AdminDashboard` (target ≈ 130 lines).
4. Update the 6 test files' imports to the new module paths; delete the transitional re-exports;
   `grep -rl "pages/admin'" tests/unit` must return only tests that render `AdminDashboard`
   (today: none — confirm).
5. Reconcile prose that states current layout: `.claude-memory/project-dynamics-feedback-admin-shipped.md:17,23,29`
   (names `DynamicsFeedbackSection` in `pages/admin.js`) and `.claude-memory/project-admin-dashboard.md:10,29`.
   Dated plans/briefs/audits that cite `pages/admin.js:<line>` are historical records — leave them.
   `docs/agent-wiki/topics/dataverse-dynamics.md:153` already points at the extracted file. Run
   `npm run check:doc-symbol-refs && npm run check:memory-drift:no-write`.
6. Full `npm test`, `npm run build`, all §4 gates. Commit; open PR.

### Stage 6 — Conditional: per-workspace lazy import (default: omitted)

Only if the owner asks. Prerequisite: `ANALYZE=1`-style production build measurement of `/admin`
first-load JS before/after one `next/dynamic` import of the heaviest workspace; proceed only if the
reduction is ≥ 5 % of first-load gzip (predeclare the number in the Stage Log). Otherwise write
"Stage 6 omitted — below gate" and stop. Deep-link, back/forward, and first-view tests must exist
before trying it (`admin-view-coverage` covers first render only).

## 6. Self-checking method (interval rule)

- **Planning checkpoint (before Stage 0):** a fresh-context agent (no conversation history; given
  only this file and the SHA) re-verifies every `[VERIFIED]` claim in §1 against the current tree
  and lists mismatches with file:line. Fix the plan, log the verdict in §7. Repeat if `main` has
  moved more than 20 commits since the SHA.
- **Per-stage review (after each stage merges to the branch):** a fresh-context agent reads only
  this plan + `git diff <prev-stage>..<stage>` and answers: (a) is every hunk a pure move
  (`--color-moved`), (b) does `pages/admin.js` still render every view (run the coverage test),
  (c) did any file outside the stage list change, (d) any new abstraction. Findings → Stage Log;
  any (a)–(d) failure blocks the next stage. Codex adversarial review is the repo-standard
  alternative; never a metered product (CLAUDE.md rule 12).
- **Cadence guard:** if a stage takes more than two commits or ~30 minutes beyond its estimate,
  stop and report (CLAUDE.md rule 3).

## 7. Stage Log (append-only)

- 2026-10-11: Plan drafted at `b3135037c` from read-only probes (§1).
- 2026-10-11: **Planning checkpoint — fresh-context verifier (Explore agent, read-only, no history)**:
  35 claims checked; 5 substantive mismatches, all folded in: `ROLE_OPTIONS` belongs to
  `RoleManagementSection`; `tests/unit/admin-models.test.js` reads `pages/admin.js` as text (new Decision 3
  exception + Stage 2 step); Jest 30 flag is `--testPathPatterns`; `RoleManagementSection`/`AppAccessSection`/
  `DynamicsFeedbackSection` fetch URLs corrected; `ResourceLinks` consumers are Operations and Ai. Minor:
  `SERVICE_LABELS` users, `visitedLocations` mount behavior noted for Stage 0, memory files to reconcile
  named precisely. Verdict after corrections: ready for owner review; not authorized.

- 2026-10-11: **Stage 0 built** on `claude/admin-decomposition` (Sonnet; commit `fad38462a`). Baseline
  re-probe: `pages/admin.js` 3,649 lines; 26 `^(export )?function [A-Z]` matches (+ the default export);
  `shared/components/admin` 25 files; tests importing `pages/admin'`: the 6 listed in §1 plus the new
  `admin-view-coverage.test.js`; source-text couplings: `admin-models.test.js` (and
  `admin-transcription-pilot-page.test.js`, which imports `pages/admin/transcription-pilot` and is out of
  scope). Coverage test: 21 views; two views need a minimal body (`/api/admin/maintenance` → `{jobs:[]}`,
  `/api/admin/models` → `{apps:[]}`). Gates at `fad38462a`: targeted jest 172/172, full jest 22,693 passed,
  lint 0 errors, `check:types`, `npm run build` all green.
- 2026-10-11: **Stage 0 review (Opus, fresh context): REWORK → fixed by the orchestrator** (small,
  deterministic edits; not re-dispatched). Blocking: the capture deduped URLs with a `Set`, so a doubled
  fetch could never fail — now full URLs, duplicates kept (mutation M3 confirmed the gap). Should-fix:
  query strings were stripped although every one is deterministic — now pinned (`?period=7d/30d`,
  `?hours=24`, `?status=open/new`, `?all=true`; 9 expectations updated, no baseline duplicates). Nit: models
  mock trimmed to `{apps:[]}` (verified sufficient). Settling: five 20 ms `act` flushes judged
  deterministic (mock resolves in microtasks; no timer-gated fetch in any rendered view). Note for Stage 5
  step 4: `admin-view-coverage.test.js` legitimately imports `pages/admin` for `WorkspaceContent`.
- 2026-10-11: **Stage 1 built** (Sonnet; six commits `d357edd78`..`899324c6b`, one per move group rather
  than one per stage — each individually green, kept as-is for reviewability). `pages/admin.js` 3,649 →
  2,427 lines; 8 new files under `shared/components/admin/` (`health-status.js` + 7 sections). Tests
  unchanged; 8-file admin suite green at every commit; `check:types`, `npm run build`, full
  `--testPathPatterns 'admin|Section'` run (22,693 passed) green at HEAD. `ALERT_RECIPIENT_DATAVERSE_FIELDS`
  stays in the page (used by `OperationsWorkspace`), per Decision 1.
- 2026-10-11: **Stage 1 review (Opus, fresh context): APPROVE WITH NITS.** Pure-move proof: every moved
  block is a contiguous byte-identical run of the baseline file; removed-vs-added non-import lines are an
  equal 1,161-line multiset. Should-fix applied by the orchestrator: the `DataverseFieldInfoButton` default
  import became unused at commit 4 (its only JSX use moved with `SecretExpirationSection`) — now a
  named-only import. Nits recorded: `Fragment` was stale from commit 2 to 5 (HEAD correct); `useRef` was
  already unused at baseline and is left alone (out of scope). Note: this repo's ESLint config does not
  report unused imports, so "lints clean" is not evidence of import hygiene — reviewers count uses.
  Orchestrator's independent spot check (`MaintenanceSection` vs baseline lines 658–779): identical modulo
  import header and export keyword.

