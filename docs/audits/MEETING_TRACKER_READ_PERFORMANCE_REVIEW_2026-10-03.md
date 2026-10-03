---
title: Meeting Tracker Read Performance Review Receipt
domain: meeting-tracker
kind: audit
status: complete
summary: "Sol, root and OAuth-authenticated Claude Fable approved the targeted source change; seven pre-existing failing Jest suites remain a release limitation."
canonical: false
owner: product-engineering
related:
  - docs/plans/MEETING_TRACKER_READ_PERFORMANCE_EXECUTION_2026-10-03.md
---

# Meeting Tracker read-performance review receipt

Scope: source approval for two targeted read optimizations on
`codex/tracker-read-performance`, based on
`fb5d39fc907f80d294a55157f81726c6671f0204`. No production promotion is claimed.

## Sol and root

Fresh-context Sol (`gpt-6.1-sol`, agent `/root/tracker_review_sol`) reviewed
current source, consumers and tests, without edits or competing test/build runs.
Its tracked runtime/test diff SHA-256 was
`3f693b13462bdc206c22efc3dab19962a359cbd18f39b6a9883ea0722c3d73a4`.
The new composition test hash was
`e9c013e231f28e83ff372f30d8ab07870a4fe2cd488b9e19bb661ecaa77f70fc`;
the new paged-summary test hash was
`f82b3eba03b460f5433a4e041fab45a80a754ef3ddc9328b513072203c25a253`.

Luna corrected Sol's three findings: accept the explicit full-response alias,
exercise an actual later-page winning visit, and use letter-containing GUIDs to
prove case-insensitive deduplication. Sol re-read those corrections and returned
READY with no unresolved correctness findings. Root then independently reviewed
the final runtime diff, actual pagination implementation, composed service tests,
route validation and both client consumers; no additional runtime correction was
needed. No new runtime/test changes followed Fable dispatch.

## Claude Fable method

`claude auth status` was checked outside the Codex sandbox and reported
`authMethod: claude.ai`, subscription `max`. Both reviews used Claude Code
`--model fable --effort high --permission-mode plan --tools Read,Grep,Glob`,
with no MCP servers and no session persistence. Provider API-key/auth override
variables were removed from the subprocess environment. No API keys, agent API
calls, Ultrareview, or other metered review product was used. The normal Claude
Code model requests used the existing subscription OAuth session.

Both result envelopes reported model `claude-fable-5-1`, success, and no permission
denials. The initial frozen patch SHA-256 was
`ba547da9ee2e72994e231ae00621e4053077bbe306d5d44b6f985744facbc0f5`.
Only verification documentation/local worktree setup changed afterwards. Fable
requested no runtime changes. A second bounded evidence check addressed its
initial pending-gates caveat; this was not another design or implementation round.

The execution record contains durable command/result summaries. Raw local logs
are ephemeral. Root independently checked the baseline archive against all 4,467
tracked blobs from the starting Git tree: zero differences. The baseline Jest
comparison ran only the seven failing suites, not a second whole-repository run.

## Initial Fable review — verbatim

# Review: Meeting Tracker read-performance change (baseline `fb5d39fc9`)

**Verdict: APPROVE.** I found no material correctness findings. The approval covers the source as read; the receipt says full Jest, lint, types, and the canonical build are still pending, and I ran nothing.

Method: I read the patch and receipt, then the current runtime files, `queryAllRecords`, `selectActiveSiteVisit`, both UI consumers, and the tests.

## 1. Material findings

None blocking. What I checked at each attack boundary:

| Boundary | Result | Evidence |
|---|---|---|
| Route arrays / unknowns / auth order | Holds. Validation runs after `requireAppAccess` and before readiness and service; arrays and unknown values return 400. An empty `projection=` is treated as absent (legacy). | `pages/api/meeting-tracker/dashboard.js:15-20`, `:48` |
| Legacy / full default | Holds. The service branches only on the literal `'schedule'`; `loadDashboard` keeps the same call order (email → 404 → role → program scope) and the same response contents. The only other caller is the Workbench route. | `lib/services/workbench/dashboard-service.js:79-87`, `:217-235`, `:256-269`; `pages/api/workbench/dashboard.js:55` |
| Schedule with no cycle | Holds. It takes the legacy `loadWorkbenchDashboard` → `listCycles` path and only adds `projection`. | `lib/services/meeting-tracker/dashboard-service.js:100-106` |
| Visibility parity | Holds. Both paths share one `selectProposalRecords`: same cycle, program, visibility and `scope=my` filter, same select and order. | `lib/services/workbench/dashboard-service.js:271-300` |
| Reviewer metadata | Dropped, not fabricated. The selection DTO carries only the six fields the Tracker service reads; there is no `rollup`, `reviewers`, or `workRemaining`. | `workbench/dashboard-service.js:239-248`; `meeting-tracker/dashboard-service.js:200-228` |
| Pagination and the 5,000 cap | Holds. Each chunk follows `nextLink`; `capped` is set at ≥5,000, so the exact boundary is conservatively treated as incomplete. The service requires `capped === false` strictly, else 503. | `lib/services/dynamics/read-ops.js:300-326`; `lib/dataverse/adapters/site-visit.js:146-157`; `meeting-tracker/dashboard-service.js:155-163` |
| Later-page winner | Holds. Selection runs over the full accumulated set, earliest end, ties on activity id. | `meeting-tracker/dashboard-service.js:176-188`; `lib/services/deliberation-briefing/site-visit-selection.js:9-21` |
| 25-ID batches | Holds. IDs are deduplicated case-insensitively, then sliced at 25. | `site-visit.js:122-131`, `:146-148` |
| Format / location readiness | Holds. The fields are selected only when the readiness flag is on; when off, the shape gives `null` / `''`, which is what the legacy path gives. | `site-visit.js:134-139`; `meeting-tracker/dashboard-service.js:77-87` |
| Zero / missing rows | Holds. Empty IDs short-circuit with `capped: false`; unresolved requests still get the notice and `requestUnresolved`. | `site-visit.js:132`; `meeting-tracker/dashboard-service.js:120-127` |
| Materials read errors | Unchanged fail-open handling on both paths. | `meeting-tracker/dashboard-service.js:139-153` |
| Client shape | Holds. The list reads `programs`, `cycles`, `programId`, `defaultCycleCode`, `proposals`, `notices`; the Session Editor reads `requestId`, `requestNumber`, `title`, `institution`, `isTestRequest`, `leadPdId`. All are produced on the schedule path. The full-page visit link is untouched. | `MeetingTrackerList.js:153-176`, `:65`; `SessionEditor.js:326`, `:385` |

### Nonblocking caveats

- **Gates not accepted.** Approval is conditional on full Jest, lint, types, and build coming back green.
- **One unused read remains.** The schedule path still calls `getUserRole` and discards the result (`workbench/dashboard-service.js:95`, `:107`). It is harmless and preserves error ordering, so I recommend leaving it.
- **Chunks are sequential.** Summary reads are one Dataverse round trip per 25 requests, the same as the legacy reader. The saving is the removed rollup and the N per-visit `getById` calls, shown only by fixture call counts. No production latency claim is supported, and the docs do not make one.
- **Two decorative assertions.** In `tests/unit/meeting-tracker-dashboard-service.test.js`, `not.toHaveProperty('rollup')` runs against a selection mock that never had a rollup. In `meeting-tracker-read-performance.test.js`, the `siteVisit` parity compares null to null. Both properties are genuinely covered elsewhere: the composed real-service test with a populated `fetchReviewerRollup`, and `site-visit-summary-batch.test.js`.
- **Untested route inputs.** `projection=legacy` and empty `projection=` have no route test; source reading shows both take the legacy path.
- **Doc housekeeping.** The execution record's filename is dated 2026-10-03 and its status is `implementation-in-progress`; set the status when the gates land.

### Pre-existing, out of scope

- `selectProposalRecords` discards `capped` from `queryAllRequests` (`workbench/dashboard-service.js:294`). Both paths inherit this, and the execution record discloses it.
- The legacy `findActiveByRequests` reads `top: 100` per chunk with no cap detection (`site-visit.js:99-103`). Schedule mode is strictly safer here.

## 2. Tests that would falsify this approval

All NOT RUN; nothing was executed.

- **Workbench parity:** a legacy `loadDashboard` response that differs from baseline `fb5d39fc9` for the same fixture, in cycle or no-cycle mode.
- **Schema gating:** a schedule read with `SITE_VISIT_LOGISTICS_SCHEMA_READY` unset whose `$select` includes `wmkf_visitformat` or `wmkf_locationorlink`. The existing off-flag assertions run against a mocked `queryAllRecords`.
- **Cross-chunk duplicates:** 26 or more requests with duplicate visits for a request in the second chunk, where the reconciliation flag or the earliest-end pick is lost.
- **Cap in a later chunk:** `capped: true` only on the second chunk result that does not surface as 503.
- **Auth order:** an unauthenticated request with `projection=fast` that returns 400 instead of the auth denial.
- **Live shape (owner-run only):** `queryAllRecords` on `wmkf_sitevisits` returning `_regardingobjectid_value` in a different shape than `queryRecords`. Both go through the same `processAnnotations`, so I expect parity.

## 3. Verdict

**APPROVE**, with the nonblocking caveats above. No runtime change is requested. I made no edits and wrote no plan file, since this was a read-only review.

## Final Fable evidence confirmation — verbatim

**APPROVE TARGETED CHANGE**

The targeted source change is approved for a reviewable feature-branch commit, with the 7 failing suites / 9 failing tests recorded as a pre-existing baseline blocker and no green-full-suite or deployment claim. I ran nothing and made no edits; I read both Jest logs, not the build or checks logs.

**Why the baseline evidence is sufficient**
- **Same failures on both sides.** The branch log (`/private/tmp/wmkf-tracker-full-jest.log`) and the baseline log (`/private/tmp/wmkf-tracker-baseline-jest.log`) show the same 7 suites and 9 tests failing, with matching assertion diffs and error text.
- **No failure touches the diff.** Each cause sits outside the changed files:
  - `graph-service-boundary`: `scripts/probe-meeting-transcription-e2e-readiness.js` imports Graph internals.
  - `test-request-visibility-census`: `pages/api/admin/transcription-pilot/evaluation-export.js` is unclassified.
  - `test-request-scheduled-job-census`: `drain-transcriptions` is unrecorded (2 tests).
  - `maintenance-cron-handler`: `res.body.ok` is false in 4 tests.
  - `meeting-transcription-rehearsal-fixture-operator`: `preflight_projection_failed`.
  - `legacy-host-redirect` and `security-headers`: ESM parse failure on `workflow/next` via `next.config.js`.
- **Nothing else failed.** The branch run has no other failing suites (1207 passed), and the meeting-tracker and site-visit suites I spot-checked in the log pass.
- **No causal regression found**, so my earlier source review stands unchanged: no material correctness findings.

**Limits of what I verified**
- The baseline log does not record its commit SHA, so I take from the evidence file, not the log, that it ran at `fb5d39fc9`. The failure causes are consistent with that, since they trace to the transcription work in the baseline's recent commits.
- The baseline run covers only the 7 failing suites (86 other tests pass), not a full baseline suite. That is enough to show these failures pre-exist.
- Build, lint, types and the 69 check scripts are accepted as stated in the evidence file.

**Retained release limitations**
- **Source approval only.** This is not production promotion; promotion needs a green full suite or an explicit owner waiver of the 7 baseline suites, plus the normal deploy verification.
- **No full-suite-green or release-ready claim.** The 7 suites / 9 tests must be named in the commit or execution record as a known baseline blocker.
- **No production latency claim.** The evidence is offline fixture call counts only; no hosted browser, E2E or live Dataverse timing was done.
- **Inherited gap, disclosed.** `selectProposalRecords` still discards `capped`, on both the old and new paths.
- **Doc housekeeping.** The execution record was dated 2026-10-03 and marked `implementation-in-progress` when I reviewed it, and I did not re-read it; its status should reflect the final gate results, including the red baseline.

No plan file was written, because this was a read-only confirmation with nothing to implement.
