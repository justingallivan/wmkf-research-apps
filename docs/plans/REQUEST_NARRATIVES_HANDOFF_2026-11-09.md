# Executive Summary staff editor — current integration handoff

Owner: Codex. Updated 2026-11-16.
Branch: `codex/executive-summary-integration-2026-11-16`.
Worktree: `/private/tmp/wmkf-summary-integration-20261116`.
Status: merged to `main` at `1037d2dbd`, deployed and live-tested 2026-11-16 with owner approval.

## Current scope

The Overview displays **Executive Summary**, using API key `lay_abstract` and
Dataverse column `akoya_request.wmkf_layabstract`. It appears below the J27
handoff guidance and above Request details; the legacy Overview also includes it.
Staff with Workbench access can read. The assigned lead Program Director or a
superuser with a linked Dynamics actor can explicitly save or clear the text.

This slice reuses the narrowed editor from `codex/power-automate-integration-2026-11-11`
at `db00e33ba`, not the original two-field editor. `wmkf_initialassessment` is
not selected or writable here. Existing AI Summary, reviewer matching and governed
Initial Assessment documents are separate and unchanged. No AI call, machine
Summary admission, prompt publication, worker activation or schedule is added.
Connor's Short Title submit/poll test remains independent and pending his results.

## Accepted intake contract — 2026-11-16

Authority: Connor's response supplied by Justin, followed by Justin's explicit
acceptance of exceptional intake reruns overwriting staff edits. This is an agreed
operating contract, not an independent live inspection of the external flow.

- Power Automate orchestrates Executive Summary generation during intake and stores
  the result in `wmkf_layabstract`. The selected input is the project narrative in
  `Submission-Documents`; the combined Narrative–Bibliography PDF remains for
  reviewer matching. Justin does not require another source-document decision.
- `wmkf_readyforreview` is the final step, after documents and AI processing.
  Any failed run halts intake and notifies check-in staff; failed Summary generation
  therefore holds the readiness handoff. [2026-11-20 [REPORTED by Connor 2026-11-20, see `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md`]: the map lists
  `wmkf_readyforreview` as MANUAL, a staff handoff no flow writes; the flow's end state is
  `wmkf_ingeststage` = AI review done, and a failure sets `wmkf_ingeststage` = Failed with the
  message in `wmkf_ingesterror`. Step 3, which writes `wmkf_layabstract`, is PLANNED and not live.]
- Connor intends no later flow to edit the field and offered to hide it from the
  Akoya Request form so this app owns subsequent staff editing. Actual form hiding
  and the working generation flow have not been independently verified.
- An exceptional intake rerun may overwrite a staff edit or intentional clear.
  Justin accepts that risk. A persistent staff-edited marker, external once-only
  receipt and external conditional-write guarantee are not prerequisites for this
  staff-editor release. Do not recreate those requirements from older handoffs.
- Ordinary concurrent saves in our app still use the original concrete ETag and
  refuse conflicts. This decision does not authorize automatic regeneration or a
  new background writer in our app.

Exact intake event identifiers and filename activation belong to the separate
machine-generation implementation if resumed. They do not block the staff editor.
The PA branch's disconnected marker helpers and offline tests remain there as
historical experiments; they are not brought into this release or deleted here.

## Read/edit/save contract

Overview → `RequestNarrativesCard` → GET/PATCH `/api/workbench/request-narratives`
→ `request-narratives-service` → grant-request adapter → `akoya_request`.

GET returns text, a concrete row version and server-computed edit eligibility.
PATCH accepts `{requestId, version, changes: {lay_abstract}}`. Unknown fields,
wrong types, invalid GUIDs, absent/wildcard versions and text over 100,000 characters
are rejected. Empty string or null clears the field. Other text is preserved;
unchanged saves skip the write. Browser textareas may normalize CRLF to LF.

Authorization uses the authenticated session and fresh lead-PD lookup. Writes
require `DYNAMICS_IMPERSONATION_ENABLED=true`, a linked actor, trusted DAL context,
and original row ETag with `noFallback:true`. A stale form or Dataverse 412 returns
409 without retry. Preview against Production remains read-only. The normal target
interlock applies. Unrelated row edits can also cause a legitimate version conflict.

The editor never polls, autosaves or generates. Save errors retain a copyable draft
and require reload before another save. Successful write followed by failed readback
is reported as saved with reload required. A transport error may leave an uncertain
write outcome: reload and compare. Request-keyed mounting and generation guards
fence stale async responses. Dirty reload and navigation require confirmation.

## Schema and provenance

[HISTORICAL LIVE EVIDENCE, 2026-11-09] The owner-approved wave
`36-request-narratives` created optional plain-text Memo columns `wmkf_layabstract`
and `wmkf_initialassessment` in Production, both 100,000 characters. The independent
`probe-request-narrative-fields.js --target=prod --verify` checked typed metadata
and a zero-row projection without reading Request content. Metadata IDs:
Lay Abstract `b96d22b9-bcdc-f111-84e8-000d3a31b218`; Initial Assessment
`0f0c69cc-bcdc-f111-84e8-000d3a361d0a`. No schema operation is needed for this integration.

Original two-field implementation: `7b5305a7c`, `06e1ba6a4` on
`codex/request-narratives-2026-11-09`. The November 13 PA branch narrowed it to
Executive Summary, improved conflict-draft copying and permission handling, and
recorded separate Sandbox Lay Abstract provisioning. Those older deployment and
probe receipts are historical, not fresh production verification.

## Verification and release boundary

[VERIFIED via local tests, 2026-11-16] 104 focused and existing Overview/J27/page
regression tests passed. Independent read-only review found no material issue and
independently ran the three narrative suites (39 tests passed). The production
webpack fallback build passed using the locally installed dependencies; the
worktree shares node_modules with main. This is not a fresh lockfile installation
or a deployed Turbopack build.

[VERIFIED via Chromium, 2026-11-16] The real J27 Workbench page passed the
route-mocked browser rehearsal: intake text display, explicit save/reload,
intentional clear/reload, stale-save rejection, copyable retained draft, cancelled
tab navigation and deliberate reload. No page errors or unexpected network requests
remained. All APIs were browser fixtures; the server used a scrubbed environment
with no external service credentials. This proves UI behavior, not live persistence.
The browser fixture initially lacked the required Azure identity and two navigation
API responses; those fixture omissions were corrected before the passing run.

All 30 scoped gate/self-test commands passed (the new worktree memory symlink was
created after the first local invariant check failed, then that gate passed).
Scoped ESLint and `git diff --check` passed. No runtime source fix was needed after
the independent review. The schema probe was recovered from its original verified
commit rather than the PA branch's older census-only copy; only syntax was checked.
The checked-in schema descriptions are retained historical metadata; no metadata
update or external overwrite protection is implied.

Browser reproduction: build with `npm run build -- --webpack` in this isolated
checkout, using `NEXTAUTH_SECRET=e2e-throwaway-nextauth-secret-32-chars` and
`NEXTAUTH_URL=http://localhost:3116` in both build and server. Start on port 3116
with the synthetic target `DYNAMICS_URL=https://orgd9e66399.crm.dynamics.com`,
`INITIAL_RATIONALE_SCHEMA_READY=on` and `MEETING_ROSTER_SCHEMA_READY=on`, but no
service credentials or env files. Run
`E2E_PORT=3116 npx playwright test tests/e2e/executive-summary.spec.js --project=chromium`.
The default E2E server also covers the legacy Overview; J27 assertions apply when
its phase tabs are present. Never reuse a live authenticated session for this test.

[VERIFIED via Vercel CLI, 2026-11-16] Owner explicitly authorized merge/deploy and
Production testing on Request 1003518 with restoration. Commit `1037d2dbd` was
fast-forwarded and pushed to main; deployment `dpl_HNvYavFYLae3VDZcJ9jZMoa8uJvE`
reached Ready and received the `applications.wmkeck.org` alias.

[VERIFIED via authenticated Safari UI, 2026-11-16] Marked TEST Request **1003518**
(`cc80114d-85b7-5c5d-b53f-4da202644c64`) passed temporary text save/server reload,
stale-tab save refusal with draft retention, explicit conflict reload, and intentional
clear/save/server reload. Its original Summary was blank. The blank Summary was
restored and confirmed by server reload in both tabs; the extra test tab was closed.
No other request fields were edited. Chrome and direct custom-domain HTTP checks
on this Mac timed out; Safari worked after owner-completed Microsoft sign-in.
This proves the staff-editor persistence/conflict path, not the intake AI flow.

Rollback is the prior app deployment; it does not undo saved text.

## Changed-fact reconciliation

Sweep Mode A scope: Summary field identity, app integration and the accepted
intake-only writer contract. Authority: current owner/Connor statements plus source
and tests. Searched docs, memory, wiki, session instructions and runtime for
`wmkf_layabstract`, `request-narratives`, and the old initialization requirements.
Updated this handoff, the Request Atlas, route inventory, canonical route counts and
Stream C of the session handoff. Other streams and separate PA branch code are not
modified; their current Summary requirements must be read with this explicit owner
supersession when that branch is resumed. Repeat scoped searches found zero remaining live stale initialization requirements
in this checkout; historical schema descriptions are retained for parity.
Deployment/live-test follow-up reconciled this handoff, SESSION_PROMPT.md and the
Request Atlas against the Vercel result and authenticated Safari observations above.
No tenant-wide overwrite guarantee, completed generation flow or Akoya form change
is claimed. The original blank Summary was restored; no test text remains.
