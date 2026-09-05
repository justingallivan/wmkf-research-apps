---
title: Reviewer Lifecycle Stage 1B — Version-safe Post-send Bookkeeping
kind: audit
domain: reviewer-workbench
status: complete
canonical: false
owner: product-engineering
last_verified: 2026-09-05
---

# Reviewer lifecycle Stage 1B receipt

Branch: `codex/reviewer-lifecycle-stage1b`. Base: `4839444c` (published Stage 1A).
Owner: Codex orchestrator with separate contract investigation, service/unit-test
build, and composed-race build agents. The invariants below were recorded before
source changes. Implementation is frozen at
`087523643d27d0896efb16f374920417bde515b4`; focused/full tests, gates, build and
independent review passed. No production release is claimed.

## Contract-reconcile scope and invariants

Change surface: non-invitation post-send bookkeeping in
`lib/services/review-manager/send-emails-service.js`. Entry points: reviewer
email dialogs, authenticated `POST /api/review-manager/send-emails`, and its
trusted DAL service call. Persistence: existing Dataverse reviewer suggestions.
Consumers: SSE progress/delivery/result/complete events, reviewer DTOs, and
existing delivery/status/count displays. Prior finding: F4, stale pre-send
snapshots can regress receipt status or lose concurrent reminder increments.
Schema, enum, route authorization and client-state changes are N/A.

| Invariant | Files likely touched | Verification |
|---|---|---|
| Derive status/count from a fresh suggestion and condition on that exact version | Send service; unit and composed race tests | Real HTTP If-Match, receipt races, missing/malformed ETags |
| Each successful concurrent reminder increments the fresh count | Same | Same-version contention, numeric 412, fresh reevaluation and bounded retry |
| Receipt evidence suppresses status advancement; closed/unknown lifecycle state blocks non-courtesy bookkeeping | Same | Raw receipt status or timestamp, every closed status, completion timestamp, unknown status |
| The fresh engagement still belongs to the originally selected Request and person | Same | Reparent/rebind between dispatch and bookkeeping, including after conflict |
| Thank-you stays an independent stamp, including after Complete | Same | No status/count or new accepted/receipt gate |
| Transport success survives recording failure; bookkeeping never resends email | Same | Missing version, operational error, exhausted conflict; sent identifiers and terminal SSE preserved |
| Invitation inline ordering, capture, markAsSent and unrelated findings remain intact | Same | Existing unit/route/race complements |

## Policy boundary

[VERIFIED via service and regression tests] At most three bookkeeping attempts.
Only numeric HTTP 412 returned by `updateLifecycle` permits another fresh read
and reevaluation. Missing
rows, excluded rows, absent/malformed versions, changed Request/person bindings,
explicit fresh-read errors and non-412 adapter errors use the existing warning path. The delivered
recipient remains in `sent[]`; no new response field or email retry is introduced.

[VERIFIED via service and regression tests] Materials/follow-up accept historical
null or known open/received
statuses. A receipt timestamp or raw `review_received` prevents advancement.
Complete, withdrew, released, unknown nonnull status or an independent completion
timestamp block these non-courtesy writes. This makes the closed-state guard
consistent even for metadata-only writes, which the generic adapter historically
allowed. Thank-you bypasses those lifecycle predicates and remains stamp-only.
No new selected, accepted, response-type or token policy is added. Reminder counts
must be nullish or a nonnegative integer with room for a Dataverse Int32 increment.
An existing later delivery timestamp is retained while the current reminder is
counted; a conflict retry cannot move that last-delivery timestamp backwards.

## Investigation and baseline evidence

[VERIFIED via source] `updateLifecycle` accepts explicit `ifMatch`, which takes
precedence over its own later guard read. Dynamics forwards it as HTTP If-Match
and reports numeric status 412. Existing raw reads expose `_etag`; no adapter
change is necessary. Original suggestion lookups identify the selected Request
and person even when optional parent hydration fails.

[VERIFIED via agent baseline tests] Before runtime edits, the expanded unit
regressions failed for receipt status and concurrent count/version behavior.
The initial composed F4 run had five failures: two receipt regressions, lost
concurrent increment, missing If-Match and an unconditional missing-version write.
The baseline is `4839444c`. Final focused results: 131 service unit tests and
81 composed race tests passed. The unit command was `npm test -- --runInBand
tests/unit/send-emails-service.test.js --silent`; the composed command was
`npx jest tests/integration/reviewer-engagement-races.test.js --runInBand
--silent --json --outputFile=/tmp/reviewer-stage1b-race.json`. Unit evidence in
`/tmp/reviewer-stage1b-unit.{log,json}` is a captured tool-output summary, not
Jest-native JSON; the race JSON is Jest-native. The full-suite JSON will provide
the independent complete count. Changed-file ESLint and diff checks passed.

[VERIFIED via route/UI source] The route authorizes the draft batch before SSE,
derives sender/actor from authenticated context and wraps the service in trusted
DAL context. `ReleaseMaterialsModal` keeps a modal-session epoch across async
work, consumes existing progress and per-recipient events, replaces results on
`result`, and refreshes on `complete`. This change retains that event vocabulary.

## Consumer fan-out and partial-success audit

[VERIFIED via source] Raw-field searches covered `lib`, `pages`, `shared`,
`scripts` and tests for the materials/reminder/thank-you timestamps, reminder
count, review status, receipt and completion. The canonical suggestion selection
already contains these fields and both lookup bindings (`entity-registry.js`).
`reviewers-service.js` projects count/timestamps independently and maps all seven
existing statuses. Activity history and Workbench Reviews display the same
fields without requiring status advancement. Reminder candidates exclude receipt
and existing reminder stamps; thank-you candidates use receipt and no thank-you
stamp regardless of status. Portal finality and synthesis also recognize receipt
independently. No enum, DTO, selector, migration or security-matrix change is needed.

The only two runtime SSE callers found were `ReviewerManagePanel.js` and
`InviteEmailModal.js`. The latter explicitly uses invitations and retains its
`inviteRecorded` handling. Failed non-invitation bookkeeping remains an existing
progress warning plus log, while `sent[]` contains delivered identifiers and the
stream terminates `result` then `complete`. It is not a durable repair queue or a
new per-recipient recovery field. A regression proves a failed first stamp does
not prevent a later recipient's successful stamp. No email transport retry is
performed on missing versions, read/write errors or exhausted conflicts.

[VERIFIED via read-only census] `node scripts/inventory-reviewer-lifecycle-writers.js`
at the frozen implementation scans 1,282 tracked files, recognizes 174 calls and
reports zero recognized unresolved bindings or parse errors. Compared with Stage
1A, three local post-send adapter call sites became one and one fresh read was
added. This is a file-local static census, not proof about every dynamic writer
or external automation. Output: `/tmp/reviewer-stage1b-census.json`.

## Full verification

[VERIFIED via saved gate outputs] All 59 distinct `check:*` scripts passed
sequentially, including each self-test. Duplicate aliases
`check:agent-invariants:ci` and `check:memory-drift:no-write` were omitted; their
normal counterparts ran. Exact commands/statuses are saved in
`/tmp/reviewer-stage1b-gates.json`; full log: `/tmp/reviewer-stage1b-gates.log`.
ESLint passed for all three changed source/test files; `git diff --check` passed.

[VERIFIED via build output and generated diff] `npm run build -- --webpack`
passed in the normal sandbox at `08752364`. Prebuild regenerated the migration
manifest byte-identically, and no generated tracked file changed. Existing
esmExternals, dynamic-dependency and Node localStorage warnings remain.
Log: `/tmp/reviewer-stage1b-build.log`; summary: `/tmp/reviewer-stage1b-build.json`.

[VERIFIED via full Jest JSON] `npm test -- --runInBand --watch=false --json
--outputFile=/tmp/reviewer-stage1b-full.json` passed: **770 suites / 10,018 tests**,
zero failed, pending/skipped or TODO tests; zero runtime-error suites. Full log:
`/tmp/reviewer-stage1b-full.log`. Existing diagnostics outside the composed
harness remain prior test-isolation debt, not proof of live I/O or new failures.

[VERIFIED via independent review] `/root/stage1b_fresh_review` returned **PASS**
for frozen `08752364`, with no required runtime correction. It independently
passed five focused suites / 313 tests; seven in-memory mutations each produced
the expected assertion failures; five additional composed probes passed.
Checked-out runtime/tests were not mutated. The reviewer inspected full-suite,
gate and build evidence without repeating those global runs. It identified one
wording correction about the adapter's internal guard-GET 412, now recorded in
the policy/limits here and verified by rereading. See
[the complete review](REVIEWER_LIFECYCLE_STAGE1B_REVIEW_2026-09-04.md).

## Limits and subsequent policy decisions

No live Dataverse calls, email, cron, migration, main merge or production promotion
are part of this stage. Cross-record parent ownership locking and ambiguous
transport outcomes remain outside a single-row conditional bookkeeping repair.

[VERIFIED via source and independent probe] `updateLifecycle` includes a guard
GET before its PATCH and does not attach HTTP-method provenance to errors. A
synthetic 412 from that internal GET also permits a bounded retry; a 412 from
the service's explicit fresh read does not. The guard-GET case occurs before
any write and still leads to fresh reevaluation and an exact conditional PATCH.
This is an adapter-operation retry boundary, not a claim to distinguish all
underlying HTTP error origins.

[VERIFIED via reset and caller source] A remove/restore cycle can reuse the same
suggestion ID and Request/person bindings while clearing status/count/timestamps
(`reviewer-suggestion.js`, `ENGAGEMENT_STAMP_RESET_ENTRIES` and restore operation).
The fresh row has no separate engagement-generation identifier to distinguish
that cycle. This stage does not solve that boundary. Later explicit resets and
other internal writers can also change count; this is not a global counter or
exactly-once email protocol. The existing manual-post-send versus automated
claim-before-send duplicate-nudge limit in the suggestion Atlas remains valid.

F2 remains covered by Stage 1A regressions. F4's stale status/count defects are
fixed in this implementation; F3 and F5 remain explicitly characterized at the
frozen Stage 1B commit. F1's successful receipt-producer finding remains refuted
by the existing contract suite. The owner subsequently approved preserving
partial/no-file receipt semantics, blocking closed generic invitation/response
corrections, and returning additive batch outcomes. Their implementation is
tracked separately in
[the approved decisions](REVIEWER_LIFECYCLE_APPROVED_DECISIONS_2026-09-04.md);
it is not part of this frozen Stage 1B receipt.

## Bounded durable-fact reconciliation

Sweep mode A: the changed fact is F4's source/test implementation status on this
feature branch. Authoritative evidence is the frozen service, real adapter/HTTP
transport, route/DTO/UI consumers and red/green/mutation tests. Live deployment,
population/incidence, external automation and historical-row repair are excluded.

Five bounded claims are VERIFIED: exact-version status/count reevaluation;
bounded conditional retry and error handling; receipt/closed/courtesy separation;
preserved delivery/SSE/partial-success outcomes; and the explicit limits above.
The per-claim disconfirming experiments include the seven broken variants in the
independent review, all detected by the tests. No new shared command abstraction,
durable object, schema or enum was introduced; new-surface registration is N/A.

Restatement searches cover lifecycle-stage/F4/post-send/count terms and raw
persisted fields across source, tests, docs, memory, wiki, root/session
instructions and relevant rules/skills. The classified document denominator is
nine lifecycle-stage/handoff documents: original report; Stage 0 receipt,
inventory and review; Stage 1A receipt and review; Stage 1B receipt and review;
and SESSION_PROMPT. Three AGREE with the new implementation and six are
HISTORICAL within visible commit boundaries. The Stage 1A receipt was
structurally labeled historical; SESSION_PROMPT replaces Stage 1B's open item
with its evidence and verified Stage 1E next step. Other F4 identifiers are
unrelated audit findings. The Atlas's distinct duplicate-nudge limitation still
agrees with source and does not claim stale-count repair was unbuilt.

[VERIFIED via final searches and commands] All 11 final documentation
gate/self-test commands passed sequentially; exact results are recorded in
`/tmp/reviewer-stage1b-final-doc-gates.json`. Repeated searches left zero live
stale implementation-status claims in the nine-document scope. Historical
review-time markers remain inside frozen review boundaries. Verdict:
**RECONCILED** for Stage 1B source/test status only; publication and production
are separately stated below. No DEVELOPMENT_LOG milestone is
required because no production capability or architecture shipped. The
claim-evidence pilot report was unavailable; no observation row was invented.

## Publication history and current release status

### Historical block — Stage 1B push attempt (2026-09-04)

Source and verification are complete on `codex/reviewer-lifecycle-stage1b`.
Implementation `08752364` and review/handoff `e24597b7` are committed locally.
Automatic approval review rejected `git push -u origin
codex/reviewer-lifecycle-stage1b` because the owner authorized implementation
but had not explicitly approved publishing this new payload to the public
configured GitHub repository. The prior Stage 1A publication approval does not
cover Stage 1B. No Stage 1B commit has been pushed. Public publication of this
stage's fix, tests and handoff needs explicit owner approval before retrying;
all source, tests, review and local handoff work is complete. No merge to main
or production promotion was performed.

### Current status — public publication approved (2026-09-05)

The owner explicitly approved release/publication after being told the configured
GitHub repository is public. [VERIFIED via orchestrator push, upstream setup and
matching `ls-remote`] This Stage 1B source and handoff were first published within
`origin/codex/reviewer-lifecycle-approved-policies` at `d76b3bb5`.
`origin/main` was `90053d11` at that check; no main merge or production deployment was
performed. The historical publication block above is resolved. Release rehearsal
and CI precede a deliberate production-merge decision; human rehearsal and
production completion are not claimed. See
[the release receipt](REVIEWER_LIFECYCLE_RELEASE_2026-09-05.md) for the exact PR,
preview and deployment evidence.
