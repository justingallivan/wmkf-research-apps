# Prepared J27 Factory — Fable correction review

OAuth-only authorized review; Read/Grep/Glob, safe mode, empty MCP configuration. Model claude-fable-5-1. No permission denials. Verdict READY FOR OWNER REVIEW; two remaining P2 observations are corrected and awaiting bounded closure.

All evidence is gathered and the advisor's blocking check on the manifest TTL is resolved. Writing the verdict now.

**Verdict: READY FOR OWNER REVIEW.** All three P1 items and all five P2 items from the first review are closed in source. No new P1. Two P2 corrections and one documentation gap remain, listed below. The post-stamp needs_attention boundary is a named operational limit, not a defect.

## Original findings, closed

- **P1-1 closed.** The finalizer no longer calls the live source fence. It uses the hash-bound saved bundle with `allowStale` and the pure copied-value check (`readiness-finalizer.js:78-79`). The manifest check passes `allowExpired`, which gates both the bundle freshness and the one-hour manifest expiry (`basic-clone-steps.js:912`, `:925`). Destination bytes are checked against the exact receipt hash, with the attested digest for package-mode files, and only the destination drive is read (`readiness-finalizer.js:37-53`). The pre-create fence is unchanged.
- **P1-2 closed.** The ETag is re-read after the single heavy pass and immediately before the plan row (`:95-96`). A 412 is journaled as a distinct code (`:109`). The attempt-keyed schema, the one-open partial index, and the attempt-bound dispatch, applied, attention and complete writes are correct (`094:6`, `:26-28`, `readiness-journal.js:20-28`). Recovery is read-only without the exact destination GUID, refuses true readiness, and atomically abandons then appends inside one transaction with the run row locked (`readiness-finalizer.js:139-146`, `readiness-journal.js:30-42`). The CLI prints the no-sender checklist and rejects `--confirm` on recovery (`rehearse...:308`, `:1410`). The pg test proves retained history and stale-attempt fences.
- **P1-3 remains a release step.** Both orderings fail the guard: a new build on an old ledger hits `missing`, an old build on a 094 ledger hits an unapproved `extra` for write modes (`ledger-guard.js:143-151`). The runbook now states the coordinated window for both ledgers (`runbook:169-172`). No live schema application is authorized.
- **P2-1 through P2-5 closed.** Status gate admits only the exact 412 no-write string alongside a complete Phase II Pending digest (`:64`). Package problems are a typed 409 at Confirm and a preview blocker (`admin-run-service.js:444`, `:572-576`). One heavy pass, then lightweight reads (`:95`, `:114`, `:125`). Help lines added (`rehearse...:468-469`). Readiness is selected only on production (`basic-clone-steps.js:280`). Minimum package is the proposal plus abstract (`prepared-fixture-contract.js:4`, `:25-31`).

## Post-stamp effects boundary

Named operational limit, not a defect. Readiness true with a terminal needs_attention row blocks nothing downstream, since the app reads the Dataverse Boolean, not the journal. It matches the status runner's precedent, which never reopens a finished change. The runbook states it (`runbook:158-159`, `:166-167`). Do not add an accept path.

## Remaining findings

**P2-6. Recovery reopens the pre-plan window it was meant to close.** A first attempt plans with an ETag captured after the heavy pass. A recovered attempt captures its ETag at `readiness-finalizer.js:140-144`, and the next finalize runs the full download pass before comparing at `:99`. Any row touch in that window fails "precondition changed", the attempt stays planned, and the owner needs another recovery round. Safe, since nothing is sent blind, but a loop hazard. Cleaner: recovery abandons only, and finalize plans the next attempt after its own heavy pass.

**P2-7. Recovery overwrites the prior attempt's error.** `readiness-journal.js:36` replaces the error column with `owner_confirmed_no_sender`, so the trail loses whether attempt one was a 412 or a refused PATCH. The claim that history is retained holds for ETag and timestamps only. The pg test checks only attempt, status and ETag (`:77-78`). Keep the original error, or append the recovery token to it.

**P3. Gaps, not defects.**
- A status change closed by `--status-abandon` blocks finalization forever, because its reason string (`rehearse...:1240`) never matches the gate at `:64`. This follows the stated rule that unknown history refuses, but the runbook does not name it.
- Run inspect does not surface readiness attempts, so a 412 or needs_attention diagnosis depends on knowing to run the finalize preview.
- No finalizer-level test covers 412, then recovery, then successful finalization, nor recovery from a planned attempt.

## Release and live-test limits, separate from code

Migration 094 is unapplied on both managed ledgers. The live reaction to the readiness PATCH, the Phase I Invited effects, and real copied bytes remain uncharacterized and need the bounded owner-authorized live test. The app migration manifest also lists 094, consistent with 054 and 058, so a fresh app bootstrap creates the table. Nothing in this review authorizes a Production write, merge or deployment.
