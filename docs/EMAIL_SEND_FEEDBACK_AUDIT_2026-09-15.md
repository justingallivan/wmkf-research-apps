---
title: Email Send Feedback Audit
domain: email
kind: audit
status: active
summary: System-wide outbound-email inventory and the implemented feedback contract for confirmed, failed, uncertain, partial, and draft outcomes.
cataloged: 2026-09-15
owner: product-engineering
related:
  - docs/OUTBOUND_EMAIL_INVENTORY_2026-08-26.md
  - docs/CURRENT_WORK_QUEUE.md
  - docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md
---

# Email Send Feedback Audit — 2026-09-15

This audit owns the user-feedback contract for outbound email. It does not replace
`docs/OUTBOUND_EMAIL_INVENTORY_2026-08-26.md`, which owns sender, recipient, and
trigger inventory.

## Contract

**[VERIFIED via `shared/utils/email-send-outcome.js` and
`shared/components/EmailSendFeedback.js`]** Human-triggered email surfaces use one
outcome vocabulary:

- `sent`: Dynamics accepted the email request for delivery. It does not claim inbox delivery.
- `draft`: Dynamics created the activity and no send was requested.
- `failed`: the app can prove no send was dispatched; retry is allowed.
- `uncertain`: a send request may have reached Dynamics but the app could not confirm the result; the UI tells staff to check history before retrying.
- `partial`: a batch has mixed per-recipient results and retains the named recipients.
- `info`: a non-send completion, such as recording a release without email.

The shared feedback component supplies an icon, text, semantic color, and live-region
role. Color is reinforcement, not the only state signal. Confirmed success stays visible
in the interaction that initiated the send.

**[VERIFIED via `lib/services/dynamics/email.js`]** `createAndSendEmail` marks every
pre-dispatch exception `dispatched:false`. An exception from the Dynamics `SendEmail`
request retains the created activity id and is ambiguous until a caller reconciles it.

## Inventory and disposition

| Flow | Durable reconciliation | Immediate surface | Implemented disposition |
| --- | --- | --- | --- |
| Reviewer invitation, response reminder, materials release, and manual thank-you batches | Per-recipient SSE result; invitations also carry lifecycle bookkeeping | `InviteEmailModal`, `ReleaseMaterialsModal` | Named sent/failed/unconfirmed recipients; mixed batches use partial feedback; ambiguous errors never enter the definite-failure bucket. |
| Reviewer manual respond/review-due reminders | Claim-before-send marker | `RespondReminderModal`, `ReviewReminderAction`, Workbench Reviews tab | Confirmed receipt remains visible; uncertain disables blind retry; definite failure remains retryable where the durable contract permits it. |
| Reviewer due-date extension notification | Deadline write plus notification result | `ReviewerDueDateEditor` | Saved deadline is never relabelled failed; definite notification failure offers Retry email; uncertain notification blocks blind retry. |
| Reviewer withdrawal courtesy email | Reviewer lifecycle write precedes email | `ReleaseEmailModal` | Per-reviewer failures stay named; ambiguous results are unconfirmed; clean email results remain visible until Done. |
| Automated reviewer reminders | Claim-before-send timestamp | Reviewer-reminders maintenance run | `sendFailed` and `sendUnconfirmed` are counted separately and recorded in run details. |
| Automated reviewer thank-you | Claim-before-send timestamp | Thank-you maintenance run | Definite and uncertain post-claim failures are separate; neither is retried under the at-most-once policy. |
| Meeting Tracker agenda | Durable agenda attempt with Dynamics activity id and correlation | `SessionAgendaPanel` | A failed response reconciles the same attempt; unresolved sends return 202/uncertain and cannot be replaced by a blind new send. A later history refresh cannot relabel accepted transport. |
| Pre-Site deliberation distribution | Durable distribution attempt with Dynamics activity id and correlation | `PreSiteDistributionPanel` | Same ledger/reconciliation contract as agenda; exact preview remains attached to the result. |
| Site-visit applicant-material invitation and manual reminder | Collection row plus invitation/reminder receipts | `SiteVisitMaterialsCard` | Creation success is separated from invitation outcome; confirmed, failed, and uncertain mail states are shown independently. |
| Automatic site-visit materials reminder | Claim-before-send collection reminder marker | Materials-reminder maintenance run | `sendFailed` and `sendUnconfirmed` are counted separately; neither is blindly retried after a claim. |
| Grantee deliverables invitation | Deliverable lifecycle write after send | Workbench `AwardeeTab` | Confirmed, failed, and uncertain results stay in the recipient modal; a post-send data refresh cannot turn a confirmed send red. |
| Scheduled personalized reminder | Durable scheduled-email activity id, send intent, and correlation key | Scheduled Emails page | Ambiguous sends remain in the reconcilable sending state instead of becoming retryable failures; Send now shows immediate confirmed/failed/uncertain feedback. |
| Scheduled-email digest | Durable digest-run activity id and correlation key | Maintenance/digest job | Existing activity is read back before retry. A failed request is reconciled against that activity rather than creating another digest. |
| Reviewer acceptance confirmation | Acceptance-job claimed step | Acceptance drain and operational alert | The claimed step records `failed` versus `uncertain`; the alert title and metadata preserve that distinction. At-most-once behavior remains unchanged. |
| Admin Dynamics email test | Dynamics activity id | Email Test Client | Draft, accepted-for-delivery, definite failure, and uncertain send use the shared feedback component. |
| System/operational notifications | Caller-owned alert/event policy | Logs and maintenance surfaces | The transport log now says “accepted for delivery.” These are not direct human click flows; caller-specific operational events remain the result surface. |

## Cross-layer reconciliation

**[VERIFIED via the full repository suite and focused contract tests]** The caller → persistence → consumer contracts retain
these invariants:

1. A success panel appears only after a Dynamics send request returns successfully or a
   ledger readback proves an accepted status.
2. A refresh/read failure after success cannot overwrite the send result.
3. An ambiguous result carries the same activity/operation identity where a ledger exists.
4. Partial batches retain recipient names and do not collapse into a generic toast.
5. Stale component generations do not publish results into a newer interaction.
6. No schema migration or new background retry loop was introduced.

## Appearance and usability

**[VERIFIED via the Impeccable hardening pass and component tests]** The shared panel
uses existing Workbench green, amber, red, and blue semantics; Lucide icons replace
ad-hoc success/failure glyphs; sub-12px text touched by this work was raised to the
documented `text-xs` floor; and result panels use `role=status` or `role=alert` with
appropriate live-region behavior.

Transactional email HTML and the isolated recipient-preview document intentionally keep
inline email-compatible fonts, sizes, radii, and colors. Those values are narrow,
file-scoped Impeccable exceptions in `.impeccable/config.json`; they are not app-UI
design tokens.

## Remaining proof

- **[NOT YET VERIFIED]** Production deployment and signed-in send smoke are outside this
  branch implementation. Smoke at least one ledger-backed send and one ordinary
  `createAndSendEmail` flow after promotion.
- **[NOT YET VERIFIED]** Inbox delivery remains an external mail-system fact and is
  deliberately not claimed by any app success message.
