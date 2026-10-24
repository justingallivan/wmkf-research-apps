---
title: Durable meeting preparation — Opus review and verification
domain: product
kind: audit
status: verified
last_verified: 2026-10-23
---

# Durable meeting preparation review

Scope: branch-built durable queue/worker, shared summary ownership and expiry, strict API, progress/recovery panel and Meeting Tracker confirmation removal. This is not a release receipt for the remaining Meeting Coordination plan. No Production schema apply, deployment, mail or paid application processing occurred.

Claude Opus reviewed read-only through verified first-party Team subscription OAuth outside the sandbox, with provider/API-key variables removed and only Read/Grep/Glob enabled under an empty strict MCP configuration. Requested `opus`, actual main `claude-opus-5-5`; CLI also reported internal `claude-fable-5-1` usage. Successful exit, 734588 ms and 65 turns. The reported USD 5.6124056 is list-price accounting metadata, not an API-credit invoice. No direct API or Ultrareview substitution.

## Adjudication

| Finding | Verification and final mechanism | Status |
|---|---|---|
| P1 JSONB order looked like input drift | Source/fingerprint use existing recursive `canonicalJson`. Added an actual SQL→worker test with a populated files object plus an explicit reordered-object worker test; both pass. | Fixed |
| P2 preparation retired old legacy generation or interrupted publication | Owned reservation no longer treats generation/publish age as replacement permission. Real PG tests retain an old unowned generating run and a yielded registering publish with saved edited text, refusing a new owned attempt. Explicit ready-draft ID/version replacement remains. | Fixed |
| P2 parent recovery exhausted attempts before publication lease expired | `meeting_transcript_publication_busy` remains pending with no failure code; waiting does not consume parent retry budget. The exact existing receipt is reconciled rather than republished. Worker test starts at the attempt cap and verifies this behavior. | Fixed |
| P3 false uncertainty after pre-dispatch worker death | Recovery conditionally retires only reserved/undispatched ownership, creates a fresh attempt and resumes without a charge warning. Dispatched/unknown ownership remains protected. Known failed outcomes block for ordinary explicit retry. | Fixed, real PG proof |
| P3 completed result mislabeled unknown after child lifecycle change | Recovery recognizes completed outcome separately from text state. Expired/discarded/superseded drafts surface as actionable unavailable work, with explicit retry; published/ready results are preserved without another paid call. | Fixed |
| P3 advisory key casing | Reservation and recovery normalize request GUIDs in their shared request/kind advisory key. | Fixed |
| P3 replacement copy omitted saved edits | Confirmation explicitly says saved text and unsaved changes will be discarded. | Fixed |
| P3 endless video wait | Each attempt waits at most 24 hours, beyond the child Sandbox's configured maximum; it then blocks visibly. Explicit resume reuses the matching child and never cancels or recreates it automatically. | Fixed |
| P3 off flag is not a schema fallback | Shared legacy readers/writers use 087 columns regardless of new admission. Migration-first deployment and physical schema verification remain mandatory; no unsafe legacy fallback is introduced. | Release prerequisite retained |
| P3 partial migration repeatability | New columns use IF NOT EXISTS and acknowledgement constraint creation handles duplicate_object; canonical runner still owns existing-database application. | Fixed |

Additional primary-agent checks cover persisted progress, exact operation/attempt reuse, one running child per parent, stale context and reads, fresh retry actor provenance, visibility enrollment, source/media drift, coordinator-only uncertainty retirement even after visit replacement, and expiry that does not release uncertainty ownership. No live hosted acceptance is asserted.

## Contract reconciliation

Caller → strict staff route → fresh actor/request/visit/enrollment checks → atomic parent+five children → guarded cron claim → existing source receipt/transcript/summary/video service → lease-fenced result → minimized status → progress UI. Success is per child and never inferred from source publication alone. Protected ownership is checked by every shared summary reservation before age/expiry filters. Partial source publication is recovered by exact receipt; a source file/registry error cannot mark the bundle ready. Board edition readers and staff winner semantics remain separate.

Complement audit: unknown actions/fields/IDs reject; unassigned/ineligible actors cannot recover uncertainty; missing enrollment blocks admission; missing/stale sources block before child work; expired leases cannot finish or dispatch; true unknown calls never automatically retry; safe undispatched runs may resume; edited ready drafts require exact replacement identity; no discussion is an explicit successful marker; video source mismatch blocks without discarding other outputs; old attempts cannot revive after abandonment. No text, URLs or credentials enter the new queue metadata.

[VERIFIED via tests] Local PostgreSQL executes the actual migrations in random schemas and proves duplicate admission, claim concurrency, fencing, six-minute/fourteen-day protection against legacy calls and maintenance, saved-result recovery, explicit abandonment and late-result rejection, expired known-result recovery, JSONB handoff, legacy-generation preservation, interrupted-publish preservation and safe undispatched recovery. Unit/route/UI tests exercise child selection/reuse, capabilities, source drift, bounded waiting, exact replacement and stale navigation. Browser review of the real component at 1440×1050 and 390×844 used synthetic API data only: explicit unknown recovery, helper restriction, preserved sibling rows and no horizontal overflow; screenshots inspected and detector returned no findings.

[PLANNED release verification] Apply/verify 086–087 at an authorized target, verify queue schedule/admission and child configuration, rehearse source publication through summary/video recovery on approved test material, retain the edition-aware rollback floor, and complete the remaining combined save UI/manual source/before-meeting/Workbench slices before promotion.

## Original Opus review — historical pre-fix snapshot

The raw review below describes a changing pre-fix working tree; the adjudication and tests above supersede its open findings.

**Verdict:** I found no open P1 in the current files, but two P2s are open. It's fine to commit behind the off flag; fix both P2s before turning `MEETING_MATERIAL_PREPARATION_ACCESS` on. The files changed while I was reviewing, so the line numbers below come from my final reads. Everything here is from reading the code; I ran nothing and did no live QA.

### P1 found, then fixed while I was reviewing
**Input check blocked every step.** Postgres JSONB doesn't keep key order: it returns `slidesId`, `slidesHash`, `recordingId`, not the order the code builds. The worker compared the two with `JSON.stringify`, so every claim failed with `preparation_inputs_changed`, starting with the source step. `preparation-worker.js:22` now uses `canonicalJson`, and the start fingerprint is canonical too (`preparation-service.js:62`). Neither test would catch a regression: the PG test uses `files:{}` and the unit test passes a JS object. Add a PG test with a populated `files` object.

### P2-1: the worker replaces drafts the legacy UI never would
`summary-draft-store.js:64-65`: on a preparation reservation, `replaceable` still includes two kinds of row:
- **Stale legacy runs.** A legacy `generating` row older than 360 s has no outcome recorded (`generation_outcome` NULL). The worker marks it superseded and makes a new paid call, so an unknown legacy paid attempt is followed automatically by another paid call.
- **Interrupted publishes.** A `publishing` row whose claim was yielded or abandoned may hold edited text, and may already have a registry row (`publish_registration_attempted`). The worker clears its text and the link to its registry row with nobody naming it. The legacy card never allows this (`pairedSummaryEligible` requires no draft).

Minimal fix:
```js
const replaceable = (!preparationId && (active.generation_abandoned || active.publish_abandoned))
  || (active.state === 'ready' && (active.expired || namedForReplacement));
```
The legacy POST behaves as before. The preparation step blocks with `summary_generation_in_progress`.

### P2-2: crash during correction publication needs a manual retry
The step lease is 330 s, but the receipt lease is 7 × 60 = 420 s (`transcription-pilot/store.js:10`). If the worker dies after the freeze, this happens:
1. `recoverExpired` sets the step back to `pending` while the receipt lease is still live.
2. The next claim calls `reconcile`, which throws `meeting_transcript_publication_busy` (`service.js:735`).
3. That code isn't in the retryable list (`preparation-worker.js:94`), so the step is `blocked`.

"Crash resumes the exact receipt" therefore needs a human click.

Fix: add `meeting_transcript_publication_busy` to the retryable codes. Also give it a backoff of at least 2 minutes, or don't count it against `attempts`. With the current 1-minute backoff and 3 attempts it can still run out of attempts before the receipt lease expires.

### P3 (one line each)
- **False charge warnings.**
  - `preparation-store.js:56-64`: a `reserved` child can never have been sent, because `markSummaryDraftDispatched` needs a live lease. Recovery still marks it `unknown`, and a `failed` child (e.g. lease lost at `assertCurrent`) makes the step `unknown`. The coordinator then sees a duplicate-charge warning for a call that never happened.
  - Fix: branch on `generation_outcome`. Change `reserved`→`failed` with a conditional `UPDATE … WHERE generation_outcome='reserved' RETURNING`, so a late dispatch still lands as `unknown`.
- **Wrong recovery label.** `preparation-store.js:58` treats only `ready`/`published` as done. A completed draft that was later discarded, superseded or is publishing is reported as unknown. Use `generation_outcome='completed'`.
- **Advisory lock key.** `preparation-store.js:117` builds the lock key from the route's `requestId`, which may be upper-case; reserve uses the lower-cased id. Row locks still serialize, so this is hygiene only. Lowercase it.
- **Replacement copy.** `PreparationPanel.js:52` says "unsaved changes will not be kept", but exact-version replacement also discards edits saved at that version.
- **Endless video polling.** `finish` lowers `attempts` on a `pending` result with no failure code (`preparation-store.js:97`), so a stuck split polls forever. The claim also takes only one step per cron minute across all preparations.
- **Deploy order.** The legacy reserve, `getActiveSummaryDraft`, `expireSummaryDrafts` and `queueMeetingJob` all use 087 columns whatever the flag says. The off flag does not make a deploy before migration 087 safe.
- **Re-running 087.** Its `ADD COLUMN`/`ADD CONSTRAINT` statements have no `IF NOT EXISTS`, unlike the rest of the file.

### Checked and holding
- **Claim locking:** one running step per preparation, via the parent `FOR NO KEY UPDATE … SKIP LOCKED`, a fresh running re-check (`:80`), and the `idx_meeting_preparation_one_running` unique index.
- **Lease fencing:** reserve and `markSummaryDraftDispatched` need a live step lease, and `finish` is lease-fenced.
- **Old results:** `completeSummaryDraft` requires `dispatched` and `generating`, so neither an abandoned attempt nor an `unknown` one can be revived.
- **Protected ownership:** it's checked first in every reservation, past 360 s and 14 days, and `expireSummaryDrafts` and `getActiveSummaryDraft` exclude or include protected rows correctly.
- **Coordinator-only abandon:**
  - The service requires the coordinator when the step is unknown or the acknowledgement is sent (`:71`).
  - The store requires the acknowledgement for unknown steps or uncertain children (`:114`, `:119`).
  - `read()` shows an uncertain blocked step as `unknown` (`:25`).
- **Rechecks:** actor, app grant, visit, enrollment and recording/slides are rechecked at tick start and again inside `assertCurrent` before dispatch.
- **Reuse:** the video step finds and reuses a matching child split, and transcript generation is idempotent.
- **Acknowledgements:**
  - Meeting Tracker summary and start calls no longer send an acknowledgement.
  - Historical values are kept by the migration's shape constraint and `COALESCE`.
  - The rehearsal panel still sends one only behind its checkbox (`MeetingTranscriptionPanel.js:475`).
  - The admin pilot `queueJob` is unchanged.
