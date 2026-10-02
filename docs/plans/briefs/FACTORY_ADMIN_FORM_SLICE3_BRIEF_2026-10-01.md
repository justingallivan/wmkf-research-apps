# Build brief: Test Request Factory admin form, slice 3 (UI)

Date: 2026-10-01 (S562). Orchestrator: Fable. Builder: Sonnet. Reviewers: Opus, then Fable, then Codex (adversarial).

Plan: `docs/plans/TEST_REQUEST_FACTORY_ADMIN_FORM_PLAN_2026-10-01.md`: read the UI paragraph of *Route, service and UI sketch*, the slice 3 row, *Contract-reconcile* item 7, and both build records (*Slice 2*, *Slice 2b*; each ends "For slice 3"). Design rules: `DESIGN.md` and `PRODUCT.md` at the repo root. Where this brief and the plan differ, this brief governs.

## Where

Worktree `/Users/gallivan/Code/WMKF_Apps-factory-form`, branch `claude/factory-admin-form-slice3` (stacked on `claude/factory-admin-form-slice2b`, PR #399, which is stacked on #398; neither is merged). Stay in this directory and on this branch. Commit in small steps; push with `git push -u origin claude/factory-admin-form-slice3`. Never push to `main` or to the slice 2 / 2b branches.

**No live systems.** Unit and component tests with fakes only. Never read `.env*` values. Never run `npm run check:factory-ledger`, `next build` or `next dev` (they load `.env.local`; the orchestrator runs the build). The Preview rehearsal is owner-gated and is not part of this build.

## Scope: two parts, in this order

- **Part 0. Server contract fixes** (small; its own commit before any UI): the UI must not paper over a contract gap.
- **Part 1. UI:** one new section in the admin Test Requests workspace, its status control, a browser-safe config module, a copy map, component tests.

## Facts [VERIFIED S562 on this branch; re-read before relying on them]

- Host: `TestRequestsWorkspace` (`pages/admin.js:3433-3455`) renders two `AdminEditorPanel`s whose bodies live in `shared/components/admin/` (`TestRequestEmailAllowlistSection.js`, `TestRequestPreviewSection.js`), default exports imported at `pages/admin.js:19-20`. Mounted by `WorkspaceContent` case `'test-requests'` (`pages/admin.js:3523-3525`). Nav entry and description: `shared/components/admin/AdminWorkspaceNavigation.js:45-51`; `tests/unit/admin-workspace-navigation.test.js:25` pins the workspace keys.
- Visited workspaces stay mounted with `hidden` (`pages/admin.js:3543`, `:3604-3615`): a section keeps its state and any in-flight loop while the admin looks at another tab.
- API calls: `requestJson` / `requestEnvelope` from `shared/utils/api-request.js`. Raw `fetch` is banned in `shared/components/**` and `pages/**` by ESLint (`eslint.config.mjs:47-56`). `requestJson` throws `ApiRequestError` with `.message`, `.status`, `.payload` (so `.payload.code` is readable); `requestEnvelope` returns `{ ok, status, data }` without throwing (used for 202 vs 200 in `shared/components/workbench/FinalWriteupTab.js`).
- Idioms to match (`TestRequestPreviewSection.js`): Tailwind only; primary button `min-h-11 rounded-lg bg-gray-950 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800`; inputs `min-h-11 rounded-lg border border-gray-300 … focus:border-gray-900 focus:ring-2`; error band `role="alert"` red-50/red-200; tables `overflow-x-auto rounded-xl border border-gray-200`; `<section aria-labelledby>` with `h3`/`h4`; `StatusChip` (tones `green | amber | red | gray`) and `AdminEditorPanel` from `AdminWorkspaceNavigation.js`; `OutcomeBanner` in the same directory.
- Stale-response precedents: `TestRequestPreviewSection.js:33-125` (ref counters and `AbortController`); `FinalWriteupTab.js:282-322` (`activeController` ref compared after every await; abort-aware wait). Typed confirmation: `shared/components/workbench/StaffDeliberationsTab.js:1559-1572`. Client key minting and retention across a lost response: `shared/components/review-panel/review-panel-ui.js:23-26` and `pages/review-panel.js:116-130`. Copy to clipboard: `shared/components/workbench/PreSiteDistributionPanel.js:84-100`.
- Route contracts (read each route and its service method before using it): `runs/source` POST → `{ draftId, summary, defaults }`, where `summary` (`source-bundle.js:968-986`) is `{ dataverseHost, requestNumber, requestId, revision, fiscalYear, meetingDate, hasPurpose, hasRequestedAmount, documents: [{ kind, name, size, sha256Prefix }] }` (no title or applicant) and `defaults` may be `{ fiscalYear: null, meetingDate: null }`; `runs` GET → `{ runs }`; `runs` POST → 201 or 200 `{ run, created }`; `runs/[runId]` GET → `{ run, resources }`; `advance` POST → `{ step, outcome, status, destinationRequestNumber, errorMessage }` with `outcome` ∈ `advanced | ready | needs_attention | lease_unavailable | lease_lost | not_advanced`; `recheck` POST → `{ runId, status, ok, outcome, failures }`; `artifacts` GET → `{ runId, cleanedUp, manifest, bundle }`; `status` GET → `{ runId, runStatus, options: { phase1, phase2 }, changes }`; `status` POST → 200 `{ outcome: 'complete', … }` or 202 `{ outcome: 'jobs_open' | 'unconfirmed' | 'in_progress', code, message, changeId, abandonCommand? }`; `status/recheck` POST → `{ sequence, status, field, after, openJobs, failedJobs, requestStatus, requestStatusChanged, lateEffects, ok }`.
- Run statuses: `prepared, creating, ready, needs_attention, retiring, retired` (`lib/db/migrations/054_test_request_runs.sql:84-87`); the service resumes `prepared | creating | needs_attention` (`admin-run-service.js` `RESUMABLE`). Basic step order: `fence_source, create_request, correct_meeting_date, provision_location, copy_file, observe, verify` (`lib/services/test-requests/run-runner.js:173-177`, exported `STEP_ORDER`); `run-runner.js` is server-only (imports `node:crypto` and the write fence) and must never be imported by a component. `copy_file` copies one file per advance, so an `advanced` outcome can leave the run on the same step.
- Run resources hold identities, digests, counts and timestamps only: every journaled JSON value passes the ledger's allowlisted-key receipt check (`run-ledger.js:264-276`). The Foundation baseline's `capturedAt` is in the `fence_source` resource with `resourceKind === 'foundation_transition'`, at `plannedIdentity.capturedAt` (`foundation-transition.js:200-215`).
- A source Request number that does not exist in production throws a plain `Error('Expected exactly one source Request; found N.')` (`sandbox-clone.js:50-55`), which the route answers as the generic 500. `resolveCloneCycle` failures in Confirm are plain errors too. No read route reports whether `TEST_REQUEST_FACTORY_FORM` is on.
- Component tests: `/** @jest-environment jsdom */`, `@testing-library/react`, `global.fetch` is a jest mock (`jest.setup.js:61`). `tests/unit/test-request-preview-section.test.js` is the closest example; its `jsonResponse` double has **no `status`**, so tests that depend on 201/202 need a double with `status` (as `tests/unit/admin-ai-workspace.test.js` does).

## Part 0 decisions (server; do not reopen)

0.1 **Source not found.** In the export's `readSourceRow` (`admin-run-service.js` `defaultExportBundle`): zero rows → `ServiceHttpError` 404 `factory_source_not_found` "No Request has that number."; more than one, or a next link → 409 `factory_source_ambiguous` "More than one Request has that number." Do not change `requireUniqueSourceRequest` itself (the CLI uses it).

0.2 **Cycle errors in Confirm.** A `resolveCloneCycle` throw becomes 400 `factory_invalid_input` with the message "A fiscal year and a meeting date are required for this source." Nothing else in Confirm changes.

0.3 **`runs` GET returns `{ runs, formEnabled, target }`:** `formEnabled` is `factoryFormEnabled(env)`, `target` is `'production' | 'sandbox'`. Add a small read method (`describe()` or fold it into `listRuns`'s return and adapt the route); it is not behind the write switch. Do not add per-run capability flags: the UI mirrors `status` and `destinationEnvironment`, which are already in the run.

0.4 **`advance` returns the run's position:** add `currentStep` and `stepIndex` (from the run after the step) to every `advance` return, including the `ready` and `not_advanced` short circuits.

0.5 **`inspectRun` returns `foundationCapturedAt`** (ISO string or `null`), lifted from the `fence_source` `foundation_transition` resource. Resources are returned as today.

0.6 **`statusOptions` returns `current: { phase1, phase2 }`** (the Request's two option values, `null` when unset), read with one `$select` GET of `wmkf_phaseistatus,wmkf_phaseiistatus` through the same read client. Export a small reader from `status-change-runner.js` for it; do not widen `readLiveOptions`.

0.7 Tests for each (service and route tests in the existing files); update the affected matrix cells in `docs/API_ROUTE_SECURITY_MATRIX.md` (the `runs/[runId]` row: say "identities, digests and timestamps; no source text", not "Redacted as `--run-inspect`"). No route file is added; the route count stays 249.

## Part 1 decisions (UI; do not reopen)

1.1 **Files.** `shared/components/admin/TestRequestFactorySection.js` (default export; lookup, confirm, run list, run panel), `shared/components/admin/TestRequestStatusControl.js` (the Phase I/II control), `shared/config/testRequestFactory.js` (browser-safe: `BASIC_STEPS` as `[{ key, label }]`, status labels and chip tones, the size limits for copy), `shared/components/admin/test-request-factory-copy.js` (the code → copy map and `messageFor(error)`). Mount as a third `AdminEditorPanel` in `TestRequestsWorkspace`: `id="test-request-factory"`, title "Create a test Request", scope text built from `target` ("Production data · Writes" or "Sandbox data · Writes"). No new nav view. Update the nav description that says "non-writing" so it is true of the workspace. Keep each component file under about 500 lines; split further in the same directory if needed.

1.2 **Step labels** (`BASIC_STEPS`, in order): `fence_source` "Check the source Request"; `create_request` "Create the test Request"; `correct_meeting_date` "Set the meeting date"; `provision_location` "Create the document folder"; `copy_file` "Copy the documents (one per step)"; `observe` "Wait for background jobs (about a minute)"; `verify` "Verify the new Request". A node test asserts the keys equal `STEP_ORDER` from `run-runner.js`.

1.3 **On load:** `GET runs` → run list, `formEnabled`, `target`. When `formEnabled` is false show one banner, "Creating test Requests is switched off on this deployment. Existing runs can still be inspected.", and disable every write control with that reason shown beside it (a disabled control always says why). Read controls stay enabled.

1.4 **Source lookup.** One input (digits, 1–10) and "Look up source". While it runs: "Reading the source Request and checking its documents. This can take a few minutes." On success show the summary (Request number, fiscal year, meeting date, a documents table: kind, name, size) and mint the idempotency key (1.6). A new lookup discards the previous draft and key.

1.5 **Confirm.** Fields: test label (required, 1–120), fiscal year and meeting date (prefilled from `defaults`, both required; the body carries the two visible values and never `null`), and "Type Request number <n> to confirm". The Confirm button is enabled only when the form is on, the label is non-empty, both cycle fields are non-empty, and the typed value equals `summary.requestNumber` exactly; otherwise it shows why. On 201 or 200 select the returned run. State plainly under the button what Confirm does: it reserves the run and creates nothing in Dataverse yet.

1.6 **Idempotency key.** `globalThis.crypto.randomUUID()` minted when a lookup succeeds, held in a ref, reused for every Confirm of that draft, including after a failed or lost response. A new key only on a new lookup or "Create another". Never derived from the label or the number.

1.7 **Run panel** (the selected run): status chip, test label, source number, destination Request number once present, the seven-step progress list, and one action button.
- Progress comes from the run's `stepIndex` and `currentStep` (steps before `stepIndex` are done; `currentStep` is current; a `needs_attention` run marks the current step failed). Never infer completion from the response's `step` alone.
- Button label: "Start" for `prepared`, "Resume" for `creating` and `needs_attention`; hidden for `ready`, `retiring`, `retired` (the same list the service resumes).
- Advancing is one `POST advance` per step, repeated automatically while the outcome is `advanced`. Per outcome: `advanced` → update the run from the response and continue; `ready` → stop, show "The test Request is ready." with its number; `needs_attention` → stop, show the step and `errorMessage` (in memory only, never stored), offer Resume; `lease_unavailable` and `lease_lost` → stop, "Another process is advancing this run. Try again in a few minutes.", **no automatic retry**; `not_advanced` → stop, show the status; a thrown error → stop, show its copy. A "Stop after this step" control ends the loop without cancelling the in-flight request.
- After the loop stops, refresh the run (`GET runs/[runId]`).

1.8 **Stale guard (contract-reconcile item 7).** One `activeController` ref per section. Selecting another run, starting a new lookup, or unmounting aborts it. After **every** await in the advance loop, the status flow and the inspect load, compare the controller (and the run id the request was for) before touching state; a stale response updates nothing visible. An abort is not an error and shows no message.

1.9 **Run list.** Label, source number, destination number, status chip, created date; selecting a row loads `GET runs/[runId]`. For the selected run also show: a resources table (step, kind, outcome, error code); "Recheck Foundation" (`POST recheck`; production runs only, the server's predicate) with its result and the advisory line "A recheck is meaningful after <foundationCapturedAt + 1 hour>" when that timestamp exists (never disable on it; the server does not enforce it); and "Download run files" (`GET artifacts` → two client-side JSON downloads; when `cleanedUp` is true say the files were removed after the run finished).

1.10 **Status control** (`TestRequestStatusControl`), rendered only when `run.status === 'ready' && run.destinationEnvironment === 'production'` (the server's predicate). `GET status` → current values, option lists, journal.
- A field select (Phase I, Phase II) and an option select; the option equal to the current value is disabled ("already set"). "Set status" opens an inline confirmation naming the Request number, the field, the old and new labels, and the sentence "This changes a real status on the test Request and can send emails or create payment and tracking rows." A second click sends `POST status`.
- When the journal has an open change (`planned`, `dispatched`, `applied`), the selects are locked to that change's field and option and the only action is "Check again" (the server refuses a different change).
- 200 `complete` → show the counts (emails, tracking, payments, jobs) and reload the journal. 202 `jobs_open` and `unconfirmed` → show `message` and "Check again", which repeats the **same** POST. 202 `in_progress` → show `message`, no retry control, and `abandonCommand` in a read-only field with a Copy button. 409 `status_change_concurrent` or `status_change_open` → reload the journal. Other 409s → the copy map.
- "Recheck status effects" (`POST status/recheck`) shows late effects and open or failed jobs. No rerun control anywhere.
- The journal table: sequence, field, before → after (labels from the option lists), status, time.

1.11 **Copy** (`test-request-factory-copy.js`; owner's voice per memory `feedback-user-facing-error-copy-voice`: system as subject, plain words, say what did not happen, give the next action; never blame the user's access).
- A map from code to copy for every `factory_*`, `test_request_preview_*` and `status_change_*` code the routes can return (the service's `refuse(...)` calls, `admin-preview-service.js:297-370`, and the 2b mapping). Unknown code with a server message → the server message. No code (the generic 500, a platform timeout, a network failure) → "I'm having trouble reaching the server. This is usually a temporary blip. Please try again, and if the problem doesn't resolve, contact an administrator."
- Size refusals (`test_request_preview_file_too_large`, `_total_size_exceeded`, `_file_count_exceeded`): "This Request's documents are too large to clone here (limit 25 MB per file, 50 MB in total, 7 files). Choose a smaller source Request. Nothing was created." (numbers from the config module).
- `factory_deadline_exceeded` (504 with a code): "There wasn't enough time left to start that safely, so nothing was started. Try again." A 504 with no code is the generic copy.
- `status_change_replay`: "An earlier change to this status created, or may have created, a payment or status-tracking row. Repeating it needs the owner; it can't be done from this form."
- `factory_source_not_found`: "No Request has that number. Check the number and try again."
- Never show a raw code as the only text; never store or log error text in the browser.

1.12 **Design.** Follow `DESIGN.md`: neutral first; blue for action is not used by this workspace's existing sections, so keep its gray-950 primary; green only for confirmed success, amber for attention, red for failure; state is never carried by color alone (chips and the progress list use words and `aria` text); one focus treatment; labels on every input; buttons at least 44 px high. No new shared components, no icons library, no animation beyond what the workspace has.

## Tests

`tests/unit/test-request-factory-section.test.js` and `tests/unit/test-request-status-control.test.js` (jsdom; a `jsonResponse(status, body)` double with `status`), plus `tests/unit/test-request-factory-config.test.js` (node):

- config parity: `BASIC_STEPS` keys equal `STEP_ORDER`; the copy's size numbers equal `TEST_REQUEST_PREVIEW_READ_LIMITS`
- on load: runs listed; `formEnabled: false` shows the banner and disables Look up, Confirm, Start/Resume and Set status, each with its reason; read controls still work
- lookup: success renders the summary and documents; each error code in 1.11 renders its copy; the generic 500 renders the blip copy
- confirm gating: disabled until label, both cycle fields and the exact typed number; the body carries `draftId`, the key, the typed number, the label, and the cycle fields; 201 and 200 both select the run
- key: unchanged across a failed Confirm and a retry; new after a second lookup and after "Create another"
- advance loop: one test per outcome row in 1.7 (`advanced` continues and updates progress from `stepIndex`; `ready`; `needs_attention` shows `errorMessage` and Resume; `lease_unavailable` and `lease_lost` stop with no further POST; `not_advanced`; thrown error); "Stop after this step" sends no further POST
- stale guard: with a controlled promise, select run B while run A's advance is pending; resolve A; B's panel is unchanged and no further advance is sent for A
- error text is not written to `localStorage` or `sessionStorage`
- run list, inspect, recheck (production only; advisory time shown), artifacts (`cleanedUp` message)
- status control: hidden unless `ready` and production; current option disabled; confirmation step required; 200, each 202 outcome (the `in_progress` view has no retry control and shows the command with Copy), 409 concurrent reloads the journal; an open change locks the selects and offers only "Check again", which repeats the same body; no control sends `rerun`
- Part 0: service and route tests for 0.1–0.6

Async assertions use `findBy*` or `waitFor`; no fixed sleeps, no fake timers unless a test controls them explicitly (a workbench modal test flaked in CI today on a synchronous `getBy` after a click).

**Mutation checks (at least four, recorded):** remove the stale-guard comparison → the stale test fails; mint a new key on every Confirm → the retained-key test fails; auto-retry on `lease_unavailable` → its test fails; drop the typed-number gate → the gating test fails; render the status control for a non-production run → its predicate test fails.

## Gates (sequential; a gate, then its self-test)

`npx jest --testPathPatterns "test-request|ledger|maintenance|rehearse|admin"`, `npx eslint shared/components/admin shared/config pages/admin.js tests/unit/test-request-factory-section.test.js tests/unit/test-request-status-control.test.js`, then: `check:api-routes`, `check:route-service-boundary`, `check:trust-boundary-guid`, `check:dataverse-access-layer`, `check:dynamics-context-boundary`, `check:status-enum-parity`, `check:fact-consistency`, `check:doc-currency`, `check:secret-scan` (each with its `:self-test`), then `check:docs-catalog` and `check:types`. Report pass counts and any red output verbatim. If a gate fires on something this brief did not anticipate, stop and report; do not widen exemption or allow lists.

## Not in this slice

The Preview rehearsal; any new route; `rerun`, bind, slot or retire controls; changes to the preview or allowlist sections; a shared component library change; Atlas, runbook and plan prose (the orchestrator writes those).

## Hand-back

Commits pushed on the branch (Part 0 separate from Part 1); a report with: files changed and their line counts; test counts; the mutation checks; each gate's result; anything you had to decide that this brief did not cover (list it, do not bury it).
