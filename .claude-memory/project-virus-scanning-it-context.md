---
name: virus-scanning-it-context
description: "WMKF tenant has no MDO / no Safe Attachments for SharePoint; only workstation Defender + Huntress. DFT greenlit app-side scanning for public upload paths (reviewer, intake) and recommended against per-detection emails to DFT. Decisions locked S190."
metadata: 
  node_type: memory
  type: project
  originSessionId: 31a4b8ba-daca-4b1d-9ce6-4b88706b7693
  status: active
  scope: security
  last_verified: S190 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: working on `VIRUS_SCAN_ENABLED` rollout, upload-path virus scanning, or detection-notification design.

Do:
- Treat app-side Cloudmersive scanning as the PRIMARY defense for external upload paths (reviewer, intake) — tenant has no MDO/Safe Attachments.
- On detection, write a `system_alerts` row AND email the UNION of the `'virus-detection'` category recipients plus per-event explicit recipients (the PD on the related request when resolvable).
- Ship sender UX + internal alert + operational enable as a unit before flipping the flag; preserve typed text on rejection.

Do not:
- Build a DFT-recipient email path — DFT does not need per-detection notifications.
- Assume staff paths need app-side scanning urgency (Defender + Huntress cover staff-OneDrive uploads).

Ground truth: `docs/CREDENTIALS_RUNBOOK.md` § virus scanning; `lib/utils/virus-scan-config.js`; DFT email 2026-05-26. Related: [[memory-store-propagation]], [[project-bill-honorarium-integration]].

DFT email exchange 2026-05-26 — locked context for the `VIRUS_SCAN_ENABLED` rollout.

**Tenant posture (S190).** WMKF currently has Microsoft 365 Business Standard. **No Microsoft Defender for Office 365, no Safe Attachments for SharePoint, OneDrive, and Teams.** Workstation coverage only: Defender for Endpoint + Huntress as a secondary layer on staff devices. Business Premium upgrade is an "open project" (timeline unspecified), would eventually bring MDO Plan 1.

**Why app-side scanning is the primary defense, not defense-in-depth.** External upload paths (reviewer files, intake portal attachments) come from machines DFT doesn't administer. Workstation Defender + Huntress catch nothing on these paths today. App-side Cloudmersive scanning IS the primary control — not a redundant layer.

**DFT scope recommendation.** Enable for public-facing paths (reviewer, intake). Lukewarm on internal staff paths (grant reporting, expense receipts) because Defender + Huntress already cover staff-OneDrive uploads.

**DFT does NOT need per-detection notifications.** Our scan happens in app memory before any SharePoint write. On detection we reject and discard bytes — nothing to quarantine, nothing for DFT to investigate, nothing in any system they administer. DFT's original ask for their support email as detection notification target was framed against an MDO/Safe-Attachments quarantine model that doesn't apply here. Future cadence: aggregate stats once a cycle, not per-event.

**Internal notification design — locked S190.** Per-detection: write a `system_alerts` row AND send an email. Recipients are the **union** of:
1. The `'virus-detection'` category configured in `/admin → Alert Recipients` (stored in `wmkf_appsystemsettings.alertRecipientsByCategory`). Set to `alerts@wmkeck.org` for production. **Admin must configure this in the dashboard before detection alerts will email anyone.**
2. `explicitRecipients` per-event: the PD on the related `akoya_request` when resolvable. Reviewer path: PD resolved via suggestion → request → wmkf_programdirector → systemuser.internalemailaddress. Intake path: PD-of-request is N/A (drafts are pre-submission, request_id is null) so explicitRecipients is empty there.

`NotificationService.sendAdminEmail` was changed S190 from "explicit-bypasses-category" semantics to "explicit-unions-with-category" so this design works. See [[memory-store-propagation]] for how this lives across sessions.

**Sender UX design — locked S190.** Server rejects on detection (no backend redesign). Client preserves typed review/form text in form state and surfaces: "We scanned your upload and detected what appears to be malware. Your text has been preserved here — please replace the file with a clean copy from a scanned-clean machine and try again."

**Why:** Justin's concern was "we still want the review (uninfected) and we would want the sender to be informed that they may have a problem." Reviewer text loss on detection (current behavior) is unacceptable UX.

**How to apply:**
- Before flipping `VIRUS_SCAN_ENABLED=true`, ship the three workstreams (sender UX + internal alert + operational enable) as a unit.
- Do NOT build a DFT-recipient email path — it adds operational overhead with no signal value.
- See [[project-bill-honorarium-integration]] for parallel pattern on integrating external services with internal notification routing.
