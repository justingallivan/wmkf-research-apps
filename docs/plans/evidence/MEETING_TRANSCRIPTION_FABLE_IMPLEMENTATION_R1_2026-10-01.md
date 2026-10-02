---
title: Meeting transcription Fable implementation review round 1
domain: transcription
kind: evidence
status: needs-named-changes
summary: "OAuth-only Fable source review identified a publication dead-end blocker; root accepted it for a bounded fix."
owner: product-engineering
---

# Fable implementation review — round 1

Read-only Claude Fable review completed as `claude-fable-5-1` through the verified subscription OAuth session. No permission denials, subagents, web calls, recordings, transcript contents, or credentials were supplied. The CLI reported 38 turns. These are reviewer assertions to be checked against source, not live-release proof.

## Root dispositions

- Accept F1: zero-write failures must not permanently block a request; provide a safely quarantined explicit close-with-files-retained action for unresolved attempts, make verified superseded publication receipts terminal, and expose recovery of crashed publishing attempts in the UI.
- F2's assumed lack of generation-key uniqueness is refuted by the existing Wave 16 Request Document alternate-key schema, also independently read by Sol. Live provisioning remains release proof. Preserving natural lease expiry on ambiguous errors additionally avoids immediate resume and supports safe closure quarantine.
- Accept F3/F4 as part of F1: check mapped actor and bundle readiness before freeze; return the store's actual HTTP status and release a provably zero-write job lease.
- F5 is the intentionally preserved global active-provider-slot behavior, not a new concurrency change. Keep it as an operator/readiness consideration.

## Full reviewer result

## Verdict: NEEDS NAMED CHANGES

One source defect blocks the "ready" label (F1). Everything else I traced holds. Nothing was executed: no tests, no SQL, read-only. I had no write tool, so there is no plan file; this message is the review.

## Findings (ranked)

**F1 — BLOCKER, source defect: a failed Publish permanently locks publishing for the whole request.**
- **Every failure becomes `unknown`.** All three catch blocks do this: `service.js:278-284`, `:429-435`, `:548-553`.
- **Several of those failures write nothing to SharePoint:**
  - Bundle flag off, checked only after the freeze: `material-service.js:1999`. `requireMeetingTranscriptionEnabled` does not cover that flag (`policy.js:32-41`).
  - Expected-current mismatch or a Dataverse read error before the slot is acquired: `material-service.js:2036-2037`.
  - Slot busy: `material-service.js:2044`.
- **The freeze guard is request-wide.** Any receipt in `publishing/retryable/unknown/published_reconcile` makes the next freeze return null (`store.js:1147-1150`), surfaced as `job_changed` 409 (`service.js:239`).
- **There is no exit.**
  - Resume needs a bound fence plus all three verified files (`service.js:495-500`, `store.js:1286-1289`); otherwise reconcile returns `registry_row_not_found` every time.
  - `retryable` is never written. `closed` is written only for expired drafts (`store.js:1387`). There is no close route.
  - `published_reconcile` transitions to itself when the committed row is no longer the winner (`service.js:605-608`).
- **The UI dead-ends.**
  - Publish is disabled (`MeetingTranscriptionPanel.js:660-665`).
  - Reconcile reports "checked the saved publication receipt" (`:633`).
  - A crashed `publishing` receipt gets no Reconcile button (`:709`).
  - Draft delete returns 409 (`store.js:1524-1533`).
- **Why this is not the acknowledged limitation.** That covers retaining partial candidate files for operator attention. This also hits zero-write failures, and the only remedy is manual SQL. Re-transcribing does not help because the lock is per request.
- **Required fix:**
  1. Check bundle readiness and the mapped actor before the freeze in both publish paths.
  2. When no fence is bound and no file is recorded, transition to `closed` and release the job lease instead of `unknown`.
  3. Add an explicit authorized "close, files retained" action for no-row receipts after a quarantine, and make a verified-but-superseded `published_reconcile` terminal.
  4. Show Reconcile for `publishing`, and reload the collection after a failed publish.
- **Refuting test:** fail the first Publish at `material-service.js:2037` or with the bundle flag off, then assert a second publish for the same request freezes successfully. No current test does this: `service-gates.test.js:43-45` covers only the disabled gate, and `recovery.test.js:93-97` asserts attention only.

**F2 — MEDIUM, narrow source race: resume has no cool-down after an ambiguous registry create.**
- The error transition clears the receipt lease immediately (`store.js:1473`).
- An immediate Reconcile that sees no row resumes (`service.js:491-501`) and creates a row (`material-service.js:2139-2150`).
- If the first create lands late, there are two rows with one generation key, which is permanent `ambiguous_registry_binding` plus the F1 lock.
- I did not verify whether Dataverse has an alternate key on `wmkf_generationkey`; that needs release proof.
- **Fix:** keep the lease to natural expiry (or require a minimum age) when the failure is at or after the create call.
- **Refute:** show the alternate key, or a test where immediate resume returns busy.

**F3 — LOW: the job Publish route mishandles unmapped staff and store errors.**
- `publish.js:29` reads `error.status`, but store errors carry `httpStatus` (`store.js:22-27`).
- `publishMeetingTranscription` lacks the actor check that Start (`service.js:153`) and correction (`:375`) have.
- Result is a generic 500 for unmapped staff. There are no side effects, because `store.js:1129` throws before the transaction.

**F4 — LOW: a failed job publish leaves the job lease held for up to 7 minutes.** Name saves then return `job_changed` (`store.js:261`). Fix it with F1 step 2.

**F5 — NOTE, release consideration: one unresolved `submission_uncertain` job stalls every request's queue.**
- It counts as globally active (`store.js:565-568`, `:595-598`) and survives expiry (`store.js:1697`).
- Other requests sit in "Queued" with no explanation (`MeetingTranscriptionPanel.js:719`).
- This is the intended global concurrency, but now exposed to many users.

## Verified by reading

- **Auth:** the six routes I read all require the `meeting-tracker` grant, a positive profile, GUID checks, DAL context and body allowlists. The binding is re-verified per operation (`binding.js:27-50`), and store queries are bound to request and visit.
- **Pilot isolation:** owner queries use the `to_jsonb` projection. Both claim callers are gated (`worker.js:398`, `:481-484`).
- **Draft privacy:** the manifest field appears in only three `lib` files. The default select excludes it (`request-document.js:129`), and the DTOs are minimal.
- **Recovery:** resume reuses the exact token and fence (`slot-lease-store.js:47-61`, `material-service.js:2039-2047`). Expected-current is checked under the lease (`:2055`, `:2131`), descriptors must match exactly (`:2123`), and TXT hash is bound to `contenthash` (`bundle.js:100-101`).
- **Maintenance:** it never resumes publishing (`service.js:495`) and runs in DAL context (`maintenance.js:252`).
- **Graph cap:** enforced while streaming (`downloads.js:116-138`); the default is unchanged.
- **Schema:** 063 is in the manifest; the Memo field is 32,000.
- **Spend:** publish, correct and resume make no provider calls.

## Recommendation evidence

| Recommendation | Prerequisite | Tested | Disconfirming check | Status |
|---|---|---|---|---|
| F1 fix | `closed` already in CHECK (`063:51`) and in the transition allowlist (`store.js:1463`) | Not run | Second freeze succeeds after a zero-write failure | VERIFIED by source |
| F2 cool-down | Lease cleared at `store.js:1473` | Not run | Alternate key on generation key exists | ASSUMED absent |
| F3 mapping | `publish.js:29` vs `store.js:22-27` | Not run | Route test returns 403/400 | VERIFIED by source |

## Not covered

- `SiteVisitEditor.js`
- Routes: start, download, speakers, abandon, uncertain-job reconcile, correction create/update
- `material-model` / `presentation-page-service` internals, and `acquireMaterialSlot`
- Test files beyond targeted greps
- Atlas and other docs
