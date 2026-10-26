---
title: Scheduled reminder recovery gap — independent Claude review
domain: workbench
kind: audit
status: active
summary: "Ordinary OAuth Claude review PASS WITH NONBLOCKING NOTES at runtime17f1969d2; N1 closed, no blocking findings. Not release authorization."
owner: product-engineering
related:
  - docs/audits/SCHEDULED_GRANTEE_RECOVERY_GAP_FIX_2026-10-25.md
---

# Independent Claude review — 2026-10-25

[VERIFIED via host Claude CLI output.] Ordinary subscription OAuth, read-only
Read/Grep/Glob tools, hooks/MCP disabled, no advisor/delegation or metered review.
Target runtime `17f1969d2`; no other checkout, database, environment or live mail
operation. Root ran tests separately. The two additional PostgreSQL cases for NB3
were added after this review, with runtime unchanged; all47 engine tests passed.
They cover identity saved then receipt failed, with successful/failed fallback
persistence. This receipt does not attribute those test runs to Claude.

## Verbatim report (line references at reviewed target)

# Independent review: duplicate-send recovery follow-up (N1 fix)

**Verdict: PASS WITH NONBLOCKING NOTES.** This is not release authorization.

## Target and method
- **Target:** commit `17f1969d2` on `codex/scheduled-grantee-defaults`. I reviewed only the delta from `dc95789e8`.
- **Method:** contract-reconcile Mode A, done with Read and Grep only. I did not use a shell, run tests or gates, make edits, delegate, or call any advisor or metered product. I did not write the plan-mode scratch plan file because you prohibited scratch plans. I relied on your test results and did not re-run them.
- **What I read:**
  - `lib/services/scheduled-email-store.js:1-706`, every SQL write and claim.
  - `lib/services/scheduled-email-service.js`: recovery by correlation key (`:178-204`), the test-request path (`:420-452`), the ownership hold (`:464-516`), delivery (`:518-698`), the reconciliation candidate (`:713-767`) and digest grouping (`:837-843`).
  - `shared/utils/scheduled-email-attention.js` in full.
  - Route guard: `pages/api/scheduled-emails/[id].js:58-129`.
  - Cron handoff: `grantee-deliverable-reminders-service.js:476-499`.
  - Page label: `pages/scheduled-emails.js:31-41`.
  - New integration tests: `tests/integration/scheduled-email-engine.pg.test.js:729-850`.

## Findings
**Blocking: none.** N1 is closed.

**NB1 — page label wording.** At `pages/scheduled-emails.js:37` the new reason shows as "Held — email history needs recovery", while the missing and forbidden reasons say "Needs attention — …". The behavior is correct: the digest puts the row under Needs attention (`service:839`) and the shared helper makes it Stop-only (`attention:77-80`). Only the page wording differs from your stated contract. Decide whether "Held" is intended.

**NB2 — test-request path can terminally stop a frozen row.** A frozen row has no saved activity ID and no send intent. On a test request with isolation on, `reconcileTestRequestScheduledEmail` returns null for it (`service:425`). The next step, `cancelForSource(..., 'test_request')` (`store:263-283`), has no recovery-marker check. It sets the row to stopped and overwrites the marker.
- Nothing is sent and the action is terminal.
- If an email was accepted under the correlation key only, the row would end as stopped, not sent.
- Reaching this requires a test request whose marker was set while isolation was off. The route guard (`[id].js:63-67`) already rejects send-now on a marked row.
- This has the same safety direction as the existing source-ineligible stop. I'm noting it, not blocking on it.

**NB3 — gap in your specific tests.** In the recovery lane, if `recordEmailActivity` succeeds (clearing the marker) and then `recordSent` fails, the catch at `service:752` calls `recordFailure(frozen, …, CORRELATION_RECOVERY)`.
- The lease token is unchanged and the current code is NULL, so the SQL CASE writes the marker back (`store:583-585`). The row ends with an activity ID plus the marker.
- That state is still safe: it stays out of ordinary claims and the read lane re-reads the saved activity (`service:739-741`).
- If that failure write also fails, the row has an ID and no code. Ordinary delivery then reads the saved activity and records the receipt without sending (`service:578-598`), and reassignment is blocked by the ID (`store:699`).
- I found no test for this exact sequence. Your listed coverage may include it under another name.

**NB4 — your stated tradeoff, confirmed.** An interruption after the freeze and before an accepted identity is saved needs manual recovery. That includes cases where no email was accepted, or only a draft was created and never sent (`service:742`). This is a safe no-send hold, never an automatic resend. The UI copy says this (`attention:34-35`).

## Recommendation evidence and disconfirming checks
| Claim | Evidence | Disconfirming check |
|---|---|---|
| The marker is saved before any external lookup or create | `service:467-470` and `:592-596` both freeze before `recoverByCorrelation` or `resolveEmailActivity` | Searched for every `recoverByCorrelation` caller. The only unfrozen one is the test-request path (`:431`), which is read-only and receipt-only. A failed freeze throws first; tested at `:767-774`. |
| Only the same lease can release the marker, and only after a confirmed lookup | `store:488-498` checks lease, marker, no ID and no intent; the service calls it only when `lookupConfirmed` (`service:504`) | Ambiguous lookups, including "multiple matches", leave `lookupConfirmed` false (`:478-482`). A stale worker's release returns null (test `:844`). The hold path is only reachable after `claimSend`, which excludes the marker (`store:312`), so the lease that releases is always the lease that froze. |
| Generic failure cannot erase the marker | CASE at `store:583-585` | The marker exists only on rows with no ID and no intent: freeze requires both, and `recordActivity` clears it in the same write that sets the ID (`:503-505`). So the CASE preserves it on every frozen row. |
| Every write that clears or changes a frozen row is fenced | Exclusions in ordinary/forced claim `:312`, draft edit `:208`, approve `:230`, recipient changes `:462`, reassign `:701`, due list `:118` | Clearing writes with no exclusion: `recordSent` and send-intent (both need an ID, which a frozen row lacks), forbidden-clear (`:409`, forbidden code only), reconcile release (needs intent), Stop and cancel (terminal, no send). |
| The recovery lane never creates, sends or changes recipients | `service:736-754` calls only lookup/read, `recordEmailActivity`, `recordSent` and finalize | Tests `:763-764`, `:790` and `:818` assert no send, no create and no recipient read. |
| A failed acceptance receipt cannot allow a generation bump | Ownership-hold catch `service:493-498`, then outer `recordFailure` `:674`. The CASE keeps the marker if the ID write failed; if it succeeded, the saved ID blocks reassignment (`:699`) and recipient changes (`:460`). | Tested at `:745-765` and `:822-836`, including the failure write itself failing. The race between real connections is covered at `:794-820`. |
| A stale worker's identity write cannot land | `recordScheduledEmailActivity` is fenced on the lease (`store:508`), and read-lane claims rotate the lease token (`:378`) | The old lease token differs, so the write returns null and that worker's catch is fenced too. |

## Seven audits (scoped to this delta)
1. **Whole flow:** freeze, then lookup/create, then identity save (which clears the marker) or a hold. Frozen rows go only to the read lane, which records receipts or stays frozen. Display goes through the shared helper, projection, digest, route and page. **Pass**, with NB1 on wording.
2. **Partial success:** I checked every write order: freeze, lookup, identity, receipt, failure write, and failure-write failure. None leaves a row with no ID, no marker and an accepted correlation-only email. **Pass**, with NB3.
3. **Race, lease and stale state:** expired leases rotate tokens; release, identity and failure writes are lease-fenced; the marker blocks claims across crashes. The real-connection reassignment race is tested in both orders. **Pass.**
4. **Helper semantics:** `scheduledEmailActionsAllowed` returns Stop-only for the new reason, because send-now is allowed only for no reason or the ownership hold. `scheduledEmailAttentionReason` maps the new code. **Pass.**
5. **Durable surface:** no schema change or migration; the marker reuses the existing `last_error_code` column, as the header comment at `store:468-470` says. **Pass.**
6. **Callers and readers:** I checked the cron due, reconciliation and handoff paths, the send-now/edit/approve/stop route, the page and the digest. A row that crashes while still `sending` stays out of the digest until the read lane writes `failed`. That matches existing behavior for other codes. **Pass**, with NB2.
7. **Code and enum fan-out:** the store constant, the attention map and copy, the page label, and the service checks at `:736` and `:752` are consistent. Route test `:140`, page test `:374` and service test `:858` reference it. **Pass.**

## Final verdict
**PASS WITH NONBLOCKING NOTES** at `17f1969d2`. No marker can be cleared while the email's identity is uncertain, no recovery branch creates or sends, and a failed acceptance receipt cannot lead to a generation bump. NB1–NB4 are nonblocking. Your separately running build and gates still need to come back green. This review does not authorize release.
