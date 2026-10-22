# Scheduled Email and Reader Guidance Repair — 2026-10-22

**Status: bounded repair verified by parent; broader scheduled-email audit incomplete.** This report records
the bounded repairs and source evidence for the assigned second batch. It does
not certify repository-wide reconciliation or any live deployment state.

## Scope

- **Baseline:** repository snapshot `10f6c80c7` identified by the parent task.
- **Owned files:** `docs/API_ROUTE_SECURITY_MATRIX.md`,
  `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`,
  `docs/REVIEWER_WORKBENCH_NICE_TO_HAVES_PLAN.md`,
  `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md`,
  `docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md`,
  `.claude-memory/project-grantee-deliverable-email-voice.md`, and the header
  comments only in `pages/api/cron/grantee-deliverable-reminders.js`.
- **Added report:** this file.
- **Excluded:** earlier repair-batch files (frozen by parent), other site-visit
  and scheduled-email restatements assigned to later batches, and unrelated
  user changes.
- **Verification scope:** source-backed documentation repair. No live probes,
  tests, gates, commits, or deployment actions were performed, per task
  instruction. Parent verification is recorded below.

## Claims and evidence

| Claim | Evidence | Repair |
|---|---|---|
| The applicant-materials automatic reminder schedule is retired. The route remains callable but unscheduled; a new schedule needs a new owner decision. Its dry run sends nothing and claims nothing, but writes maintenance audit evidence. | Owner decision dated 2026-09-17 and plan §16.6 as supplied in the task; route dry-run path at `pages/api/cron/site-visit-materials-reminders.js:43`. | The API matrix now states the retired/unscheduled status and accurately describes dry-run writes. The prior claim that the owner still needed to decide the schedule is removed. |
| Reviewer due-date limits are token-preflight bounded, not a fixed calendar maximum. | `lib/services/reviewer-due-extension.js:131-136,327`; token lifecycle and adapter behavior at `lib/external/token-lifecycle.js:187-199` and `lib/dataverse/adapters/reviewer-suggestion.js:313-316` (source locations supplied and checked for this repair wave). | The API matrix, lifecycle wiki, and nice-to-haves plan now distinguish a non-null override with a stored hash from a missing hash and a null restore. Revoked or insufficiently long-lived stored tokens reject before the date write; this check does not rotate a token. |
| The reminder cron queues rows for newly invited deliverables before they are due; new rows use invite date + 12 days as `scheduled_send_at`, and the Postgres store gates delivery on time, lease, and approval. Dataverse status finalizes only after recorded delivery. | CodeGraph source trace: `lib/services/cron/grantee-deliverable-reminders-service.js:154-160,328-444`; `lib/services/scheduled-email-store.js:104-119,295-302`; `lib/services/scheduled-email-service.js:390-403`. | The API matrix row, memory recall, and route header now describe early queueing, send-time gating, current review posture and recipient checks, post-send finalization, and the persisted-activity exception. The July copy/signature decision and production observation remain explicitly dated history. |
| Grantee send-time posture is refreshed before ordinary transport; forced send-now and recipient drift have distinct outcomes. | `lib/services/scheduled-email-service.js:221-245,266-303,493-521,616-630`; `lib/services/scheduled-email-store.js:104-119,295-302`. | The scheduled-email plan and API matrix describe current source behavior. The per-type matrix remains planned and reviewer reminder-ledger work remains parked with its promotion dependencies. Dated August design and branch findings remain under explicit historical boundaries. |
| Re-address Parts A and B are merged; the document's older hazard list describes the pre-hardening baseline. | Parent-provided current status: PR #373 / migration 059 and PR #384; source paths `lib/services/scheduled-email-service.js:103-113,493-521,616-630` and `lib/services/scheduled-email-store.js:104-119,295-302`. | The contradictory merged/unmerged status was replaced with one current status and a dated checkpoint. The former “Current engine facts” are now explicitly historical; a current-source correction preserves the accepted saved-activity behavior and no-resend recovery rule. |

## Historical context and owner holds preserved

- Preserved the July 2026 grantee email copy, `Thank you,` decision, PD voice
  and signature rules, and the observation that the probe then found zero
  eligible rows and no successful live delivery.
- Preserved August 2026 scheduled-email owner decisions, reviewer-ledger design
  details, the preference-matrix design, the accepted saved-activity exposure,
  and the original re-address design/test rationale under dated or planned
  boundaries. The API matrix now records migration 036 as applied according
  to the dated 2026-08-26 shared-Neon tracker/schema receipt, without claiming
  a current live-schema recheck.
- Preserved the automatic Site Visit reminder's original implementation
  description as historical route context while marking the automatic cadence
  retired and unscheduled.
- No new product or schedule decision was introduced.

## Restatement scan and remaining work

A targeted repository search for the stale phrases found only the explicitly
historical freeze-at-creation / generation-blind descriptions in the scheduled
email plan after these edits. The remaining occurrences are visibly bounded by
dated historical sections. No exact-match hits remained for “owner decides the
schedule,” “no maximum,” the old Invited-row pre-send claim, or the contradictory
Part A/Part B status.

This was a targeted phrase scan, not a complete semantic sweep of every
restatement in the owned files. Other Site Visit planning surfaces and related
route/API/Atlas restatements assigned to the parent and later repair waves
remain out of scope here. No fresh production probe was run; deployment and
live-data claims remain at their cited historical probe dates. The parent must
inspect the full diff and perform the requested AST/comment and documentation
checks before closing this repair.


## Parent verification

Parent independently traced early queue creation (no day-12 age filter at draft
creation), scheduled due time, current-recipient/posture reconciliation,
transport-state fencing and post-send Dataverse finalization. Review corrected
the initial draft's day-12 wording and mismatched source line attribution.
The cron route has identical Babel non-comment tokens to the pre-repair source.

API route coverage and self-test, agent wiki and self-test, fact consistency,
document-symbol references, build-claim freshness and docs catalog passed after
the exact-date metadata corrections. Applicable remaining self-tests passed in
the shared parent verification round. Existing token-route guard-recognition
warnings are unchanged. No transport, scheduler, deployment, environment or
data operation was performed.
