---
title: Meeting transcription Fable implementation review round 2
domain: transcription
kind: evidence
status: source-review-passed
summary: "OAuth-only Fable returned READY FOR DISABLED SOURCE. Requested catch-path tests and two narrow Sol/root retry fixes are tracked below; release proof remains separate."
owner: product-engineering
---

# Fable implementation review — round 2

Read-only review completed as `claude-fable-5-1` using the verified subscription
OAuth session. No permission denials, subagents, web requests, live data,
recordings, transcripts or credentials were supplied. The CLI reported 39 turns.
This is source review, not an external-runtime or database concurrency test.

## Root disposition

Accept **READY FOR DISABLED SOURCE**. Root added the requested service-level catch-path
tests before handoff rather than postponing them to enablement. Sol subsequently
confirmed two narrow retry issues: release the slot only after a proven zero-write
closure, and refresh the selected job detail/version after Publish failure.
Root implemented those corrections and their regression tests in `c8c90af9a`;
they do not add a new workflow or authorize release. Sol's final exact-fix
verification passed and is recorded separately. Root's final twenty-suite run
passed 251 tests; the disabled build and scoped lint/gates also passed.
Optional status-label polish is deferred. A zero-write failed correction closes
that attempt; staff must create a new correction, and should not assume its
unpublished name edits were retained. Retained candidate files and committed but
unverifiable receipts remain explicit operator/readiness considerations.

## Full reviewer result

+## Verdict: READY FOR DISABLED SOURCE

F1 and the accepted F3/F4 are closed by source reading, and I found no material correctness, privacy or recovery defect in the delta. One acceptance case is missing and should land before enablement. Nothing was executed: no tests, no SQL, no edits. I had no write tool, so there is no plan file; this message is the review.

## Closure evidence

| Item | Status | Evidence |
|---|---|---|
| F1.1 actor and bundle gate before freeze | Closed | `service.js:224-225`, `:399-400`; tests `service-gates.test.js:64-96` |
| F1.2 zero-write close | Closed | Catch at `service.js:291-308`, `:454-471`. Store requires `publishing`, the original token, an active lease, no fence and no descriptors (`store.js:1343-1349`), re-asserted on the update (`:1369-1371`). Job release is bound to operation and token in the same transaction; a miss aborts the close (`:1355-1363`). |
| F1.3 explicit close, files retained | Closed | Service checks lease, quarantine and frozen hash (`service.js:662-668`). Any generation-key match delegates to reconcile; only exact zero proceeds (`:670-676`). Store checks request/visit/version/quarantine/lease (`store.js:1388-1391`), slot quarantine (`:1396-1401`), matching job lease and quarantine (`:1410-1412`). No delete call exists; paths and descriptors are untouched (`:1423-1425`). |
| F1.3 superseded receipt terminal | Closed | `service.js:640-645` writes only the Postgres receipt (`published` plus `publication_superseded`); test `recovery.test.js:164` |
| F1.4 UI recovery | Closed | Reconcile shown for `publishing` (`MeetingTranscriptionPanel.js:762,777`); reload after failure (`:370`, `:570`, `:592`, `:686`); close gated on quarantine and acknowledgement (`:763-764`, `:778-783`); copy says "if any, remain" (`:674`) |
| Crash-safe quarantine | Closed | Set at job freeze (`store.js:1179`), both renews (`:1209`, `:1224`), reclaim (`:1288`), correction freeze (`:1549`), and the `unknown` transition, which keeps the lease to natural expiry (`:1576-1580`) |
| F3 real HTTP status | Closed | `publish.js:29`; `materialError` is a `ServiceHttpError` with `httpStatus` (`material-service.js:153-159`); test `routes.test.js:82` |
| F4 job lease release | Closed | Released inside the zero-write close (`store.js:1355-1363`); tests `store.test.js:149,183` |
| F2 alternate key | Present in source | `wmkf_requestdocument.json:328-330`; provisioning is release proof |
| Migration 064 | Present | Nullable FK column; `migrations-manifest.json:63` |

## Disconfirming checks (all failed to break it)

- **Is "no fence, no descriptors" really zero-write?** Yes. Slot acquire (`material-service.js:2044`) precedes fence bind (`:2051`), which precedes folder creation (`:2061`), upload (`:2075`) and registry create (`:2150`). A fence commit with a lost response leaves the fence set, so the close refuses.
- **Can an uppercase id bypass the slot or job match?** No. `assertUuid` lowercases (`store.js:34`) and the slot token is a `UUID` column (`055:141`).
- **Does releasing the slot leave it permanently unclosable?** No. Release keeps the token and sets expiry to now (`slot-lease-store.js:78-89`), so its quarantine passes ten minutes later.
- **Lookup-then-close gap?** The close is pinned to the receipt version read before the lookup; a recovery claim bumps it (`store.js:1289`) and an active lease returns busy.
- **Generation-key parity?** `service.js:524,669` matches `material-service.js:2137` and `PRODUCER` (`:86`). The lookup has no state filter (`request-document.js:162-167`).
- **Null quarantine on correction receipts?** `GREATEST` ignores null at freeze, and the service refuses a null quarantine (`service.js:665`).

## Missing acceptance case (required before enablement)

No service-level test exercises the two catch blocks. `closeMeetingPublicationWithoutWrites` appears only in a mock list (`service-gates.test.js:22`) and in store tests. R1's own refuting test is covered only at the store layer with mocked SQL (`store.test.js:183`). Add, for both job and correction publish:

1. Bundle publish throws and the zero-write close returns a row: assert no `unknown` transition and the original error is rethrown.
2. The close returns null or throws: assert the `unknown` transition carries the original error code and lease token.
3. Slot release is called only when the slot token equals the operation id.

## Uncovered risks

- **Concurrency is unproven.** Explicit close locks receipt, slot, then job; job-lease renew locks job, then receipt (`store.js:1195-1213`). Predicates should keep them apart, but only real PostgreSQL shows this.
- **Migration ordering.** If readiness is switched on before 064, the zero-write close fails on the missing column and the error is swallowed (`service.js:302`, `:465`). The receipt falls to `unknown`, explicit close returns 503, and the F1 lock returns silently.
- **Committed but unverifiable receipts stay locked.** A receipt with one registry row that fails identity or SharePoint checks (`service.js:600-638`), or with two rows, is attention-only and not closable. This is within the contract, but it remains an operator-only exit from the request-wide lock.
- **Zero-write failure closes a correction draft.** A transient slot-busy discards the saved labels and the user must start a new correction. Confirm this is intended.
- **Retained files are orphans.** They are governed transcript content with no registry row, recorded only on the closed receipt.
- **Hosted-duration assumption.** The catch-path slot release assumes the original process is dead before its 7-minute lease expires (300-second function limit).
- **Not read:** the reconcile route, the panel and routes test bodies, atlas docs, every reader of `publication_operation_id`, and whether the selected job version refreshes after a failed publish.

## Optional polish (one)

`MeetingTranscriptionPanel.js:768` labels every `closed` receipt "candidate files retained", including `closed_before_write` and expired drafts where nothing was written.

## Boundary

This is a source-only verdict for code that stays disabled. It is not deployment approval. Mocked `tx.query` tests show SQL text shape, not locking or quarantine behaviour. Real PostgreSQL, 064 provisioning, Dataverse alternate-key enforcement and hosted proof remain release gates.
