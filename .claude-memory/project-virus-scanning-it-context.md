---
name: virus-scanning-it-context
description: "DFT's 2026-05-26 exchange documented no MDO / Safe Attachments and recommended app-side scanning for public upload paths, with no per-detection emails to DFT. Treat that tenant posture as historical until freshly checked; preserve the no-DFT-email owner decision."
metadata: 
  node_type: memory
  type: project
  originSessionId: 31a4b8ba-daca-4b1d-9ce6-4b88706b7693
  status: active
  scope: security
  last_verified: 2026-10-22 source routing rechecked; tenant M365 posture remains based on the 2026-05-26 exchange, not a fresh infrastructure check
---

## Recall Rule

Read this when: working on `VIRUS_SCAN_ENABLED` rollout, upload-path virus scanning, or detection-notification design.

Do:
- Treat app-side Cloudmersive scanning as the approved primary defense for external upload paths (reviewer, intake), based on the tenant posture documented in the 2026-05-26 DFT exchange; verify current licensing and controls before describing that posture as current.
- On detection, write a `system_alerts` row AND email the union of resolved category recipients plus per-event explicit recipients (the PD on the related request when resolvable). Resolve order is category → `default` → active-superuser roster; category is optional when explicit recipients are present and a sender is configured.
- Configure the intended category and default recipients deliberately; an absent or empty category entry does not itself suppress an alert email because fallback routing exists.
- Ship sender UX + internal alert + operational enable as a unit before flipping the flag; preserve typed text on rejection.

Do not:
- Build a DFT-recipient email path — DFT does not need per-detection notifications.
- Assume staff paths need app-side scanning urgency (Defender + Huntress cover staff-OneDrive uploads).

Ground truth: `docs/CREDENTIALS_RUNBOOK.md` § virus scanning; `lib/utils/virus-scan-config.js`; DFT email 2026-05-26. Related: [[memory-store-propagation]], [[project-bill-honorarium-integration]].

DFT email exchange 2026-05-26 — locked context for the `VIRUS_SCAN_ENABLED` rollout.

**Tenant posture reported in the 2026-05-26 DFT exchange (S190).** At that time, WMKF had Microsoft 365 Business Standard, no Microsoft Defender for Office 365 or Safe Attachments for SharePoint, OneDrive, and Teams, and workstation coverage through Defender for Endpoint plus Huntress. This is historical evidence, not a fresh statement of current tenant licensing or controls. Business Premium was then an open project with no timeline; recheck before relying on that status.

**S190 rationale for primary app-side scanning.** External upload paths (reviewer files, intake portal attachments) came from machines DFT did not administer. Under the tenant posture described in that exchange, staff workstation Defender + Huntress did not cover those uploads; app-side scanning was selected as the primary control. This rationale preserves the approved scanning design without claiming a fresh tenant-control inventory.

**DFT scope recommendation.** Enable for public-facing paths (reviewer, intake). Lukewarm on internal staff paths (grant reporting, expense receipts) because Defender + Huntress already cover staff-OneDrive uploads.

**DFT does NOT need per-detection notifications.** Our scan happens in app memory before any SharePoint write. On detection we reject and discard bytes — nothing to quarantine, nothing for DFT to investigate, nothing in any system they administer. DFT's original ask for their support email as detection notification target was framed against an MDO/Safe-Attachments quarantine model that doesn't apply here. Future cadence: aggregate stats once a cycle, not per-event.

**Internal notification design — locked S190.** Per-detection: write a `system_alerts` row AND send an email. Recipients are the **union** of:
1. The `'virus-detection'` category configured in `/admin → Alert Recipients`
   (stored in `wmkf_appsystemsettings.alertRecipientsByCategory`). The resolver
   falls back to `default`, then the active-superuser roster if this category is
   absent or empty, so a category-specific entry is not required for an email
   to be sent. Configure intended recipients deliberately; the address does not
   belong in memory.
2. `explicitRecipients` per-event: the PD on the related `akoya_request` when resolvable. Reviewer path: PD resolved via suggestion → request → wmkf_programdirector → systemuser.internalemailaddress. Intake path: PD-of-request is N/A (drafts are pre-submission, request_id is null) so explicitRecipients is empty there.

`NotificationService.sendAdminEmail` was changed S190 from "explicit-bypasses-category" semantics to "explicit-unions-with-category" so this design works. See [[memory-store-propagation]] for how this lives across sessions.

**Sender UX design — locked S190.** Server rejects on detection (no backend redesign). Client preserves typed review/form text in form state and surfaces: "We scanned your upload and detected what appears to be malware. Your text has been preserved here — please replace the file with a clean copy from a scanned-clean machine and try again."

**Why:** Justin's concern was "we still want the review (uninfected) and we would want the sender to be informed that they may have a problem." Reviewer text loss on detection (current behavior) is unacceptable UX.

**How to apply:**
- Before flipping `VIRUS_SCAN_ENABLED=true`, ship the three workstreams (sender UX + internal alert + operational enable) as a unit.
- Do NOT build a DFT-recipient email path — it adds operational overhead with no signal value.
- See [[project-bill-honorarium-integration]] for parallel pattern on integrating external services with internal notification routing.
