---
title: Reviewer Lifecycle Stage 1A — Conditional Stale-invite Expiry
kind: audit
domain: reviewer-workbench
status: complete
canonical: false
owner: product-engineering
last_verified: 2026-09-04
---

# Reviewer lifecycle Stage 1A receipt

Branch: `codex/reviewer-lifecycle-stage1a`. Base: `a18f219b` (completed Stage 0).
Owner: Codex orchestrator with separate contract investigation, service/unit-test
build, and composed-race build agents. Status: Stage 1A complete in source/tests; no production release.

## Contract-reconcile scope and invariants

Change surface: conditional expiry in `reviewer-suggestion-sweep.js` and its
regression tests. Entry point: cron `sweep-stale-invites`, which authenticates
with `verifyCronSecret`, clamps options, and establishes trusted DAL context.
Persistence: existing Dataverse reviewer suggestions; parent Request meeting
dates are read. The cron also records an existing Postgres maintenance run,
including when the service is called with dry-run. Consumers: cron JSON,
maintenance-run details/counters, and existing reviewer status projections.
Prior finding: F2, stale invitation discovery can overwrite newer responses.
UI state/request payload changes: N/A. No schema, enum, route, or email changes.

| Invariant | Files likely touched | Verification |
|---|---|---|
| Expiry uses a freshly read, still-eligible suggestion | Sweep service; unit and race tests | Acceptance, exclusion/removal and lifecycle complements cannot be overwritten |
| The exact eligibility version reaches the PATCH | Sweep service; unit and race tests | Inspect actual HTTP If-Match; missing version and 412 skip without retry |
| Parent date evidence belongs to the current parent | Sweep service; unit and race tests | Missing/changed parent and date cases; explicitly retain the separate-Request race limit |
| Batch limits, discovery-only dry-run, and fail-soft counters remain usable | Sweep service; unit and race tests | Bounded work, no dry-run writes, per-row skip/error/success accounting |
| Other lifecycle findings retain their prior behavior | Composed race suite | F3/F4/F5 characterizations and receipt/closeout suites stay green |

## Implementation and whole-flow evidence

[VERIFIED via source and focused tests] The only application file changed is
`lib/services/reviewer-suggestion-sweep.js`. Existing adapters already supply
`getByIdWithSelect`, `queryRequests` and `patchFields`; the latter forwards the
caller ETag unchanged to the real Dynamics PATCH transport. No adapter or route
contract changed.

The fresh suggestion must remain selected, have invitation email evidence,
have false/null accepted and declined flags, and have no response type, review
status, response timestamp, receipt timestamp, completion timestamp or
sufficient-reviews withdrawal timestamp. Applicant-excluded rows and unknown
review/response statuses skip. The current Request link must equal discovery's
link. The service rejects missing, wildcard, malformed and control-byte ETags
and uses the accepted ETag unchanged. A separate fresh parent query must still
find that Request with a finite meeting date strictly before the original
cutoff. A later suggestion change causes a 412 and is never blindly retried.

The public result remains `{scanned, eligible, swept, skipped, errors, dryRun}`.
`eligible` is the discovery shortlist, not a promise to write. `skipped` includes
batch overflow and safe no-write outcomes. Operational failures keep their
suggestion identifier and bounded message in `errors`, and later rows still
run. The initial slice bounds attempted work even when an early row skips.
Dry-run retains discovery accounting without fresh per-row reads or writes.
Invalid discovery dates now remain ineligible instead of aborting the run.

The sole runtime caller found by `rg` across `lib/pages/shared/scripts` is
`pages/api/cron/sweep-stale-invites.js`. Its existing auth and DAL context precede
service invocation; it consumes counts/errors, stores the complete result in
maintenance details, and returns it as JSON. It labels the maintenance run
failed when `errors` is nonempty. Service dry-run does not prevent the route's
existing maintenance writes; no cron endpoint was invoked here.

The persisted output stays `wmkf_responsetype=no_response` plus
`wmkf_responsereceivedat`. Existing `RESPONSE_TYPE_BY_VALUE` consumers in
`my-candidates-service.js` and `reviewers-service.js` still project those fields.
The raw-column fan-out search covered `lib`, `pages`, `shared`, `scripts`, and
tests. The static census now reports 1,282 tracked files and 175 recognized
calls, with zero recognized unresolved aliases/parse errors: the two added
calls are the fresh suggestion read and exclusion predicate, not writers.
The Stage 0 writer inventory remains a visibly historical comparison baseline.

## Verification and complement audit

- [VERIFIED via baseline regression run] Before application edits, three F2
  composed regressions failed against `a18f219b`: acceptance, removal and
  exclusion were overwritten. Command: `./node_modules/.bin/jest --runInBand
  --no-cache --watch=false --runTestsByPath
  tests/integration/reviewer-engagement-races.test.js --testNamePattern='F2 regression'`.
- [VERIFIED via builder red/green runs] The initial expanded unit suite had
  58 failures / 5 passes before the fix. The final unit suite passes 66 tests.
  It covers all mapped review/response states plus unknown values, each sibling
  timestamp independently, malformed flags/versions, structured missing-record
  errors versus generic 404/operational failures, actor/version forwarding,
  continuation, batch limits, grace cutoff and dry-run.
- [VERIFIED via composed run] Four focused suites pass 159 tests: sweep unit,
  race integration, transport helper, and receipt/closeout integration. Tests
  assert final stored winners, actual HTTP If-Match and 412, no restamp on
  repeat, missing/reparented suggestions, parent deletion/rescheduling, and
  no unexpected SQL or unsupported transport calls in the composed harness.
- The helper now returns Dataverse's structured ObjectDoesNotExist code for a
  missing GET-by-id on a known table. Its independent test keeps unknown
  entity/path errors distinct. Production error classification was preserved;
  a generic 404 never becomes a missing-row skip merely because of its status.
- No shared policy/helper extraction, new enum/column/table, schema apply,
  new route/security-matrix row, migration or external integration was needed.
  Helper-extraction and new durable-surface migration audits are N/A. The
  seven audits otherwise cover whole-flow, partial success, async versions,
  preserved helper semantics, unchanged storage, doc reconciliation and raw
  field consumer fan-out.

[VERIFIED via saved final outputs] At implementation commit
`721f4f3d98f9115c5c7382998e014e1e265cf50f`:

- `npm test -- --runInBand --watch=false --json
  --outputFile=/tmp/reviewer-stage1a-full.json`: 770 suites / 9,913 tests passed;
  zero failures or skips. Log: `/tmp/reviewer-stage1a-full.log`.
- All 59 distinct `check:*` scripts passed sequentially. Only duplicate aliases
  `check:agent-invariants:ci` and `check:memory-drift:no-write` were omitted;
  their normal counterparts ran. Exact list/statuses:
  `/tmp/reviewer-stage1a-gates.json`; log: `/tmp/reviewer-stage1a-gates.log`.
- `npm run build -- --webpack` passed in the normal sandbox. Existing
  esmExternals, dynamic-dependency and Node localStorage warnings remain.
  Prebuild regenerated the migration manifest without changing it. No
  generated tracked file changed. Log: `/tmp/reviewer-stage1a-build.log`.
- ESLint passed for the five changed source/test/helper files, and
  `git diff --check` passed.

[VERIFIED via independent review] `/root/stage1a_fresh_review` reviewed frozen
diff `a18f219b..721f4f3d`: **PASS**, no required runtime corrections. It reran
all 159 focused tests independently and used three in-memory mutation checks
to disconfirm vacuous coverage: removing fresh eligibility, exact If-Match or
Request binding each failed its intended composed assertion. Repository source
was not mutated. Full suite, gate and build receipts were inspected rather
than independently repeated. See
[the complete review](REVIEWER_LIFECYCLE_STAGE1A_REVIEW_2026-09-04.md).

## Limits and remaining findings

[VERIFIED via the explicit composed boundary test] A parent-only meeting-date
edit after the final parent read can still allow expiry: a suggestion ETag does
not lock a different Request row. This stage reduces stale parent evidence but
does not establish a multi-record lock or change ownership policy.

F1 remains refuted for successful current receipt producers by the retained
contract suite. F2 is fixed in source and isolated tests. F3, F4 and F5 retain
explicit known-defect characterizations; their implementations are outside
this substage. F6's Stage 0 synthesis test isolation remains intact. No live
Dataverse, production deployment, cron invocation, backfill or email claim
follows from the isolated tests. Existing full-suite isolation debt outside
this harness remains separate.

## Bounded durable-fact reconciliation

Sweep mode A: changed fact is F2's source/test status on this feature branch.
Authoritative evidence is the service/adapters/transport/caller/DTO trace plus
red/green tests; deployment state is excluded because no release was performed.
Searches cover lifecycle-stage/F2/stale-invite terms and raw field symbols in
docs, memory, wiki, session/root instructions, relevant skills/rules and source.

The Stage 0 receipt and writer inventory are historical snapshots, now labeled
as such and linked here. The original refactor report and Stage 0 review are
already pinned to historical commits. SESSION_PROMPT is the live forward
handoff and replaces Stage 1A's open item with the implementation
receipt. Broader calendar/token policy, unrelated F2 findings and dated
archived operational audits are outside this changed-fact scope; their search
collisions are not claims about Stage 1A implementation status.

Final reconciliation denominator: seven lifecycle-stage/handoff documents
(original audit, Stage 0 receipt/inventory/review, Stage 1A receipt/review, and
SESSION_PROMPT). After the structural edits: three AGREE with this source/test
state and four remain HISTORICAL with visible commit boundaries. Four bounded
claims are VERIFIED: conditional suggestion protection, skip/error separation,
preserved batch/dry-run accounting, and the remaining parent-only race limit.
No unresolved policy is promoted to an implemented guarantee.

[VERIFIED via final commands] All 11 final documentation gate/self-test commands
passed sequentially after the review was recorded; the exact list is retained
in `/tmp/reviewer-stage1a-final-doc-gates.json`. The stage/F2/pending-marker
searches were repeated. The independent review preserves its review-time
pending-marker recommendation; SESSION_PROMPT and this receipt now record its
completion. Remaining live stale implementation-status claims within this
seven-document scope: **0**. Verdict: **RECONCILED** for Stage 1A source/test
status only; production and broader policy remain outside the claim.

No DEVELOPMENT_LOG milestone is required because no production capability or
architecture shipped. The claim-evidence pilot report was unavailable; no
observation row was invented.

## Publication boundary

[VERIFIED via successful branch push] After explicit owner approval, the
Stage 1A runtime fix, tests and handoff were published to the public configured
GitHub repository on `codex/reviewer-lifecycle-stage1a`, with its origin
upstream set. Implementation `721f4f3d`, documentation/review `836a3772` and
approval-boundary record `4fddc9a9` are backed up remotely. The earlier
automatic-review publication block is resolved. No merge to main or
production promotion was performed.
