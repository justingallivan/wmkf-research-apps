---
title: Scheduled grantee reminder defaults — implementation verification
domain: workbench
kind: audit
status: active
summary: "Branch implementation at 2095db013: 290 focused tests, 69 caller/census tests, 32 scratch-Postgres tests and five fixture browser cases passed. Independent implementation review pending; not released."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_SCHEDULED_GRANTEE_DEFAULTS_PLAN_2026-10-25.md
  - docs/atlas/postgres-infra-tables.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Implementation and verification — 2026-10-25

[VERIFIED via source, local mocked tests, disposable local Postgres and fixture-only
Chromium.] Runtime fingerprint: `2095db01322869103540baecc7fe1c164d5e2a6c` on
`codex/scheduled-grantee-defaults`. [Draft PR #531](https://github.com/justingallivan/wmkf-research-apps/pull/531).
Justin authorized implementation of the reviewed plan and expressly selected
hold-until-repaired for PD reassignment. Release is not authorized by this task.
Independent ordinary OAuth Claude implementation review is in progress.

## Invariants and contract trace

| Invariant | Entry → persistence → consumer | Proof |
| --- | --- | --- |
| Exact owner, never remapped to someone else | Authenticated staff session + GUID/profile-map equality → dedicated GET/PUT/DELETE → exact owner/key Dataverse preference | Route/auth tests include bypass/applicant, Origin, inactive/deleted profiles, missing identity, map mismatch/failure; generic keyed/list and single/batch paths exclude the new key |
| Raw future pair only | `scheduled_grantee_reminder_template` → strict validator/readback → independent editor and cron reader | Required name/title/deadline tokens, literal subject, limits, malformed grammar, legacy alias rejection; shared legacy copy retains its separate semantics |
| No false mutation success | Complete exact-key enumeration → Save matching readback / Clear absence confirmation → independent refresh DTO | Duplicate/encrypted/invalid/unavailable, failed writes/readback, actual foreign rows, partial Clear, confirmed mutation with failed refresh covered |
| Future means future | Explicit editor action → preference only; cron promise snapshot → winning INSERT or eligible version-fenced handoff | Existing edits/approval/content remain frozen on repeat create; no selected-row callbacks from defaults editor; actual competing SQL connections freeze one complete pair |
| Concurrent scans share one snapshot | Per-run lowercase-PD Map stores promise before await → per-row results grouped by PD/status | Four observed upstream worker arrivals, blocked read, shared success/failure, fresh next-run read, distinct PD snapshots; broken resolved-value cache fails both concurrency cases |
| A deferred handoff cannot newly send as the former PD | Claimed row → current-PD check before Part B and again before intent → lease-fenced ownership hold | Actual due old-PD row held; forced send also held; missing/read-failed/invalid ownership, mixed case, changed PD during recipient/activity waits; row content/approval/generation preserved |
| Past acceptance remains recoverable | Stored/correlation activity read → accepted receipt/finalization; intent remains read-only | Accepted recovery without SendEmail; unaccepted correlation orphan stays unattached; missing/forbidden classifications preserved; failure/lease-loss never reports hold success |
| Held does not starve ordinary mail | Existing error column → shared reason/actions/digest → CASE-ordered due selection | 101 older held rows plus ordinary NULL-code row; ordinary wins. Approval/lease/time remain authoritative |
| UI async independence | Actor-scoped editor generation + mounted/active guards → raw baseline and uncertainty latch → own defaults only | Pending/malformed/foreign receipts, loading pause, real actor change, unmount, row selection, late response, busy and strict Reload tests |
| Deliberate discard | Editor-only warning hook → Pages router/Back/beforeunload → retained or deliberately discarded raw edits | Five real-browser fixture cases: selection no prompt, cancelled/confirmed departure, Back and pending-write warning |

## Verification actually run

- **13 focused Jest suites / 290 tests passed** at the runtime fingerprint:
  the four new scheduled-grantee-reminder suites; cron, scheduled service/current
  recipients/routes/page/schema, grantee renderer, reserved keys and cleanup.
- **4 caller/census suites / 69 tests passed.** The existing direct cron-service
  characterization fixture was updated to explicitly supply an absent personal
  default; its runtime source did not change after the fingerprint.
- **Disposable Docker PostgreSQL 16: 32 engine tests passed.** A new task-owned
  container bound only to loopback hosted the test's random scratch schema. The
  suite applied existing migrations 036/059 only inside that schema, exercised
  real SQL and mocked Dynamics, and removed its schema. No shared or Claude
  database was used. Coverage includes true separate-connection competing INSERT,
  handoff/lease/version/transport fences, frozen edits and ordinary-mail priority.
- **Fresh production Next/Turbopack build and five fixture-only Playwright cases
  passed.** Every API call and external request was intercepted; no preference,
  preview, activity, token or send route ran live. Chromium required host execution
  because macOS blocked its launch inside the sandbox. A fixture desktop screenshot
  was inspected; the existing inbox density and independent disclosure were retained.
- **Types passed. Full repository ESLint passed: zero errors, 189 warnings.**
  Final scoped editor/service/route lint passed with two hook warnings; no errors.
  Existing React act/log warnings occur in tests; assertions pass.
- Relevant gates and paired self-tests passed sequentially: API inventory, Atlas,
  facts, doc currency/symbol/build claims, DAL/context, route/service and lifecycle
  auth, GUID trust boundary, status enum parity. Docs catalog and whitespace passed.
  Secret scan plus self-test passed after staging all source/tests. Counts derive
  to 315 API files; requireAppAccess endpoint count is unchanged at 196.

The cache red/green experiment temporarily replaced promise caching with a cache
populated only after await. Both four-worker tests failed (four calls, expected
one). Source was restored byte-for-byte in finally; both tests re-passed. No
experimental implementation remains in the branch.

## Scope, complements and limits

No new table/column/constraint/migration, live schema probe, seed, environment edit,
shared setting/preference mutation or email send. Claude's checkout and database
work remain untouched. Only disposable local test schemas were written.

Absent own default alone inherits shared wording. Invalid/encrypted/duplicate/
unreadable states pause producer work rather than send a silent fallback; existing
same-owner frozen rows remain usable. Shared configuration is still the existing
batch prerequisite. A lease/version/transport refusal does not become a rewrite.
A malformed/foreign mutation receipt requires strict Reload before another write.

Current-PD reads cannot atomically lock Dataverse and Postgres. A reassignment
between the final read and persisted send intent remains a documented narrow
race; a test names that limit rather than claiming atomic prevention. A persisted
old-PD activity cannot be automatically rebuilt; Stop is terminal for that
source's automatic reminder and later mail must be manual. Unaccepted
correlation-only drafts can linger under an abandoned generation (existing A5).
Approval-required held rows remain unapproved. Held rows follow ordinary mail;
younger holds may wait behind older holds, with producer repair/manual Retry still
available. If both hold persistence attempts fail, no send occurs, but the row can
remain sending without a reason until the lease expires. No uniqueness or
cross-tab preference transaction was added; duplicate rows require explicit repair.
No live tenant preference mutation, inbox delivery or production acceptance is claimed.

## Bounded sweep / contract-reconcile

Mode A changed fact: slice 5 is branch-built and locally verified, not released.
Producer → existing Dataverse preferences → cron render → existing ledger → guarded
send/hold → projection/attention/digest/editor are traced above. Whole-flow,
partial success, async, helper semantics, durable surfaces, doc restatements and
symbol fan-out were checked. The new error uses existing storage; schema migration
is N/A. Shared renderer, identity mapper and distribution recovery were not extracted.

Current plan, slice table/TODO, route matrix, preference/ledger Atlas, service
catalog and technical-brief count pointer were updated. Plan-review reports and
September inventory counts remain HISTORICAL. Calendar/J27 decisions, other email
families and Claude's corpus/database work remain excluded. Independent review
and hosted CI results will be recorded separately before release readiness.
