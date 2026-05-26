---
name: virus-scanning-it-context
description: "WMKF tenant has no MDO / no Safe Attachments for SharePoint; only workstation Defender + Huntress. DFT greenlit app-side scanning for public upload paths (reviewer, intake) and recommended against per-detection emails to DFT. Decisions locked S190."
metadata: 
  node_type: memory
  type: project
  originSessionId: 31a4b8ba-daca-4b1d-9ce6-4b88706b7693
---

DFT email exchange 2026-05-26 — locked context for the `VIRUS_SCAN_ENABLED` rollout.

**Tenant posture (S190).** WMKF currently has Microsoft 365 Business Standard. **No Microsoft Defender for Office 365, no Safe Attachments for SharePoint, OneDrive, and Teams.** Workstation coverage only: Defender for Endpoint + Huntress as a secondary layer on staff devices. Business Premium upgrade is an "open project" (timeline unspecified), would eventually bring MDO Plan 1.

**Why app-side scanning is the primary defense, not defense-in-depth.** External upload paths (reviewer files, intake portal attachments) come from machines DFT doesn't administer. Workstation Defender + Huntress catch nothing on these paths today. App-side Cloudmersive scanning IS the primary control — not a redundant layer.

**DFT scope recommendation.** Enable for public-facing paths (reviewer, intake). Lukewarm on internal staff paths (grant reporting, expense receipts) because Defender + Huntress already cover staff-OneDrive uploads.

**DFT does NOT need per-detection notifications.** Our scan happens in app memory before any SharePoint write. On detection we reject and discard bytes — nothing to quarantine, nothing for DFT to investigate, nothing in any system they administer. DFT's original ask for their support email as detection notification target was framed against an MDO/Safe-Attachments quarantine model that doesn't apply here. Future cadence: aggregate stats once a cycle, not per-event.

**Internal notification design — locked S190.** Per-detection: write a `system_alerts` row AND send an email. Recipients = `alerts@wmkeck.org` (always, hardcoded as `VIRUS_DETECTION_ALERT_EMAIL` in `lib/utils/virus-scan-config.js`) PLUS the PD on the related `akoya_request` (when resolvable). Reviewer path: PD resolved via suggestion → request → wmkf_programdirector → systemuser.internalemailaddress. Intake path: PD-of-request is N/A at scan time (drafts are pre-submission, request_id is null), so just `alerts@wmkeck.org`. Routing bypasses the category mechanism — `explicitRecipients` on `NotificationService.notify` takes precedence over category resolution.

**Sender UX design — locked S190.** Server rejects on detection (no backend redesign). Client preserves typed review/form text in form state and surfaces: "We scanned your upload and detected what appears to be malware. Your text has been preserved here — please replace the file with a clean copy from a scanned-clean machine and try again."

**Why:** Justin's concern was "we still want the review (uninfected) and we would want the sender to be informed that they may have a problem." Reviewer text loss on detection (current behavior) is unacceptable UX.

**How to apply:**
- Before flipping `VIRUS_SCAN_ENABLED=true`, ship the three workstreams (sender UX + internal alert + operational enable) as a unit.
- Do NOT build a DFT-recipient email path — it adds operational overhead with no signal value.
- See [[bill-honorarium-integration]] for parallel pattern on integrating external services with internal notification routing.
