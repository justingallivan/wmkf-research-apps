# Fable Security Audit — 2026-08-14

**Point-in-time audit artifact** (skeleton; populated during Phase 3). Evidence labels per the
legend in `docs/audits/fable-task-ledger-2026-08-14.md`.

## Scope statement

Denominator: **157 route files** under `pages/api` (`.js`; no `.ts` routes) `[VERIFIED via find count,
Scout 2 + Scout 1 agree]`. Scout 2 semantically traced 32 routes (~20%) end to end (handler → identity
source → id flow → service); the remaining 125 were guard-mapped only (guard import + callsite proven,
semantics not). Every route carries a recognized guard except `auth/[...nextauth].js` (the provider)
and `auth/status.js` (intentionally public, documented contract). T1 (merge) and T2 (token graph) were
Fable-personal and are recorded under Findings. This is honest partial semantic coverage, not a clean
bill; the 125 guard-mapped routes carry only guard-presence assurance.

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

## Scout 2 defect-class findings (Fable-verified where marked)

Severity is preliminary; final P0/P1 ranking and repair scoping happen in Phase 3 synthesis.

- **D1 — DAL enforcement default fails open in production.** `lib/services/dynamics-context.js:124-129`:
  unset `DATAVERSE_DAL_ENFORCEMENT` resolves to `NODE_ENV !== 'production'` = false in prod. Already
  documented in CLAUDE.md; prod is explicitly `=on` (S330). Finding is that a prod env regression
  silently disables entity-write enforcement instead of failing loud. `[VERIFIED — matches CLAUDE.md
  and the source]`. Medium, config-dependent.
- **D2 — `verifyCronSecret` non-constant-time compare.** `[VERIFIED via lib/utils/cron-auth.js:36]`
  (`authHeader !== \`Bearer ${secret}\``). Two sibling verifiers (`irs/verify-ein.js:54-66`,
  `lib/bill/internal-call-auth.js:99-108`) use `timingSafeEqual` — convention violation on the guard
  for 19 cron routes incl. bulk-delete. Low practical exploitability over HTTP; real inconsistency.
- **D3 — bare `requireAuth` skips the `is_active` revocation check.** `[VERIFIED via lib/utils/auth.js:136-157`
  (returns after session, no is_active) vs `:205-214`/`:296-312` where the check lives]`. Routes on bare
  `requireAuth`: `blob-proxy.js`, `upload-handler.js`, `api-capabilities.js`, `health.js`. A disabled
  staff account keeps shared-blob write + allowlisted-blob read until session expiry. Medium.
- **D4 — app-level guard on request-scoped document reads.** `[VERIFIED via review-manager/download-review.js:37-48]`
  (app grant + client `suggestionId`, GUID-validated, **no per-record membership check**) and the two
  sibling download routes. Folder-confinement proves *folder ∈ requestId*, not *caller may see requestId*.
  `download-review.js` returns another reviewer's submitted review file — the most confidentiality-
  sensitive item — with no per-record scope. **[NEEDS OWNER]**: is staff-wide cross-request read the
  accepted model (blob-proxy.js:11 documents it as intended for staff) or a gap for review files
  specifically? Mirrors the T1 pattern: app grant used as the trust boundary for a record-scoped op.
- **D5 — internal `error.message` returned to callers** on `cron/maintenance.js:279`,
  `cron/sweep-stale-invites.js:59`, `admin/reconcile-identities.js:41`. Callers authenticated; low, but
  diverges from the disciplined generic-reason convention on external routes.
- **D6 — grep-defeating non-UTF8 bytes in a guarded route file.** `[VERIFIED via file(1): pages/api/cron/pricing-refresh.js
  is `data`]`. Route IS guarded (verifyCronSecret), but a text-based CI coverage checker could be
  silently blind to it — cross-reference with Scout 4's `check:api-routes` blind-spot probe.
- **Suspected (route-level confirmed, service-layer compensations not fully traced):** S1 intake +
  link-profile POSTs bypass `validateOrigin` (mitigated by next-auth default SameSite=Lax, no
  middleware); S2 `validateOrigin` config-dependent fail-open branches (`auth.js:76-86`); S3
  staff-composed grantee invite with fully client-controlled recipient+body+subject
  (`grantee-deliverables/send-invite.js:52-55`); S4 missing route-level idempotency on send-invite /
  replace-submission; S5 BILL onboard replay window (no nonce store, ±300s skew).

## Controls / operability findings (Scout 4, Fable-verified where marked)

- **Two P0-set gates have no CI backstop.** `[VERIFIED via grep test.yml (0 occurrences) and empty
  .git/hooks]`: `check:status-enum-parity` and `check:trust-boundary-guid` (the client-id→Dataverse
  selector IDOR/filter-injection gate) are enforced **only** by Claude Code PreToolUse(Bash) commit
  hooks — bypassed by any Codex/terminal/IDE/GitHub-web commit, and both fail open on hook-internal
  error. This is a real hole in the enforcement of the trust-boundary GUID guard that D4/T1 lean on.
- **DAL/interlock fail-open surfaces (Scout 4 §4, corroborates D1):** unset `DATAVERSE_DAL_ENFORCEMENT`
  fails open in prod; unset `DATAVERSE_TARGET_INTERLOCK` resolves `off` (no policy) while an invalid
  value fails closed `on`. Both documented in CLAUDE.md.
- **Untracked rotation surface:** `UPLOADS_BLOB_RW_TOKEN`, `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`,
  `SERP_API_KEY`, `ORCID_CLIENT_SECRET`, `NCBI_API_KEY`, `EXTERNAL_LINK_SECRET_PREVIOUS` appear in the
  runbook but have no `TRACKED_SECRETS` entry, so `secret-check` never reports them (and they're
  weaker against `check:secret-scan`'s entropy patterns, which derive names from the same file).
- **Observability blind spots:** no request-scoped correlation ID anywhere (grep-verified; all
  `requestId` are the grant-request business id); deployment identity captured in exactly one file;
  alert email rides Dynamics + recipient config rides Dataverse + alert rows ride Postgres — a
  Dataverse or Postgres outage is simultaneously the likely incident and the thing that silences
  alerting; no queue-depth/age metric. **This is the direct evidence that Phase 4 cannot attribute
  latency and Phase 5's observability-first stage is load-bearing.**
- **No integrated rehearsal path** for any external-user journey (accept/decline/submit/upload/
  invite/merge): all 4 Playwright specs route-mock at the browser; sandbox lacks reviewer schema
  (404s) so a non-prod reviewer rehearsal is blocked behind a 5-item campaign gate, not a config step.

## Strong controls observed

- External reviewer + grantee token surface traced end to end is the strongest surface: single
  verification chokepoint (`verify-suggestion-token.js:163-188` — hash match, revocation, applicant
  exclusion, row-level expiry beyond JWT expiry), `tokenHasOp` fails closed, all write record-ids come
  from the verified token/row never request input, upload is at-most-once (409 on
  `wmkf_reviewreceivedat`), proposal file access confined to the request's own file set.
- Cron email idempotency is exemplary (the house pattern): claim-before-send via `ifMatch: row._etag`,
  no rollback on send failure (`reviewer-thankyou-sweep.js:90-91`, `grantee-deliverable-reminders-service.js:216`).
- Identity-from-request: 0 hits repo-wide; the only such read hard-fails in production (`auth.js:184-192`).
- `requireAppAccess`/`requireAuthWithProfile` fail **closed** (503) on lookup error; `is_active` and
  superuser role re-read fresh every request (not cached); only non-escalating app grants use the 2-min cache.
- `isAuthRequired()` fails closed in production unless literal `EMERGENCY_AUTH_BYPASS=true`, monitored
  by cold-start + daily cron; target/write interlock unknown-host classification fails closed.
