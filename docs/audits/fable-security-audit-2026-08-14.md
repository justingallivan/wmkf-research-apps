# Fable Security Audit — 2026-08-14

**Point-in-time audit artifact** (skeleton; populated during Phase 3). Evidence labels per the
legend in `docs/audits/fable-task-ledger-2026-08-14.md`.

## Scope statement

_To be written: whether every route was semantically inspected or only a subset; which of the ten
required domains were traced end to end._

## Preliminary concerns (routing clues, not accepted findings)

- `[PRELIMINARY; REVERIFY]` merge-candidates authorization scope (task T1).
- `[PRELIMINARY; REVERIFY]` reviewer token mint/regeneration eligibility parity (task T2).
- `[PRELIMINARY; REVERIFY]` audit scripts partial coverage.
- `[PRELIMINARY; REVERIFY]` route-matrix inventory vs semantic authorization.
- `[PRELIMINARY; REVERIFY]` security operating plan (last updated 2026-05-05) predates later work.

## Findings

### T1 — Reviewer merge lacks any caller/request-scope authorization (CONFIRMED in current source; severity pending Phase 3)

Status: `[VERIFIED 2026-08-14 via source reads on branch @ f8a606e6]`

- Route `pages/api/reviewer-finder/merge-candidates.js:23` guards with
  `requireAppAccess('reviewer-finder','reviewers')` only; body carries `{keeperId, loserId,
  fieldChoices, confirm}` — no `requestId`, no membership predicate. GUID validation only (`:35-36`).
- `actingUserSystemId` (`:38`, service `reviewer-merge.js:342`) is attribution for Dataverse writes,
  never compared against a permission — not a guard.
- Block predicate is data-only (`lib/services/reviewer-merge.js:242-265`): loser promoted-to-contact,
  loser engaged, loser confirmed-identity. It narrows blast radius to pre-engagement, non-promoted,
  non-confirmed-identity duplicates; it is not caller authorization.
- UI gate `computeCanManage` is documented cosmetic/fail-open (memory
  `project-merge-candidates-authorization-gap`, last re-verified S422/2026-08-12).
- **Delta since the S422 memory:** `reviewer-merge.js` changed 2026-08-13 (`d8ffc4ae`, `f9beaec1`)
  — hardening (cap classification, pre-deactivate re-verification), NOT authorization. And since
  `fa62db30` (2026-06-29) the `loser_in_applicant_slot` block is lifted: executeMerge now also
  writes `akoya_request` applicant slots (repoint/disassociate, `reviewer-merge.js:466-486`),
  i.e. the merge mutates request records the caller may not manage — slightly wider write reach
  than the memory records.
- Failure handling: ETag-conditional writes throughout; `merge_retryable_replan` 409 on conflicts;
  colliding suggestion rows are hard-deleted (`:448`) before loser deactivation (`:541`) with a
  pre-deactivate reference re-check; no compensation after the hard delete (client is told to replan).
- Design provenance: S289 deliberately chose app-level auth + data predicate; S207 org-open rationale
  predates this destructive primitive. **[NEEDS OWNER]** whether that trust decision extends here
  (owner decision was already pending per S414/S422).

### T2 — Token mint/reminder authority graph diverges: cron sweeps skip the selected/revoked checks the manual path enforces (CONFIRMED in current source)

Status: `[VERIFIED 2026-08-14 via source reads on branch @ f8a606e6]`

The four mint paths and their eligibility predicates:

| Path | Excluded | Selected | Revoked | Notes |
|---|---|---|---|---|
| `ensureToken` (accept-flip, `lib/external/token-lifecycle.js:107-163`) | ✓ explicit (`:120`) | – (accept implies engagement) | re-mints deliberately on re-accept | idempotent when token active |
| `regenerateToken` (staff, `lib/services/review-manager/regenerate-token-service.js:61-108`) | ✓ explicit (`:75`) | – | clears revocation **deliberately** (documented purpose) | staff-initiated replacement |
| `send-emails-service` send-time mint (`:674`) | ✓ via adapter chokepoint `reviewer-suggestion.findById:1151-1157` (throws on excluded) | – | mint clears revocation on any resend | materials gated accepted-only (`:479`); invite-confidence gates first contact |
| **Manual** reminder (`lib/services/reviewer-manual-reminder.js:67-73`) | ✓ (`:71`) | ✓ `wmkf_selected === true` (`:69`) | ✓ refuses `revoked` (`:70`) | fresh-read authorize + atomic marker+token PATCH |
| **Cron** sweeps (`lib/services/reviewer-reminder-sweep.js:111-117, 195-199`) | ✓ query filter | ✗ **no check** | ✗ **no check** | respond-by checks token *expiry* only (`:152-153`); review-due checks neither expiry nor revocation |

Divergence: `mintAndStore` clears `wmkf_externaltokenrevoked` by design
(`token-lifecycle.js:41-43`). The manual reminder treats revoked as a refusal; the automatic cron
sweeps never read the field, so an automatic reminder to a staff-revoked (leak-response) or
deselected reviewer would mint and send a fresh live link, silently undoing the revocation.
Preconditions: request has reminder flags enabled (`wmkf_respondreminderenabled` /
`wmkf_reviewduereminderenabled`), row matches the sweep lifecycle filter, and for respond-by the
prior token is unexpired. This confirms the brief's preliminary concern (b) and substantiates the
standing "do not arm automatic reminders before the authority contract is re-verified" hold.
Severity/repair shape pending Phase 3; candidate minimal repair: add
`wmkf_selected eq true` and a revoked refusal to both sweep filters (mirroring
`reviewer-manual-reminder.js:67-73`).

## Strong controls observed

_Pending._
