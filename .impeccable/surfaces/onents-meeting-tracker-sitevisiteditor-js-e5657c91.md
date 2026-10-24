---
version: 1
slug: "onents-meeting-tracker-sitevisiteditor-js-e5657c91"
primary_target: "shared/components/meeting-tracker/SiteVisitEditor.js"
related_targets: ["shared/components/meeting-tracker/RecordingAndTranscriptCard.js","shared/components/meeting-tracker/SiteVisitMaterialsCard.js","shared/components/meeting-tracker/ArtifactRow.js","shared/components/meeting-tracker/AttendeePicker.js"]
---

# Meeting Tracker landing and Meeting coordination

Mode: Operate. Visual authority: DESIGN.md Clear Workbench and the approved October 20 cycle/sessions/preparation mockups. No new visual identity or fabricated aggregate counts.

The cycle schedule is the default request queue: one scope toolbar, request search, result count and one precise materials-status select. Compact rows show request number, institution and title, both session and research-presentation actions, and materials status. PD and PI appear directly on one compact line. Share status appears in the request detail workspace header. At narrow widths both actions stay side by side below identity; no horizontal scrolling.

Sessions are a separate URL-addressable view independent of the cycle filters. Its desktop list and selected agenda preview sit side by side; narrow screens stack them. Each row has time range/time zone, location, status, Open session and a preview action. Upcoming sessions come first. Preview includes request count, allotted minutes and calculated slot starts from the actual authorized detail response. Search explicitly covers date/time/location/status; no partial agenda-search promise.

Meeting coordination retains the existing request/session identity and mounted forms. Grouped task selectors sit in a left desktop rail and above content on narrow screens. Before the meeting: setup, invitations and materials collection, where applicable. After the meeting: transcript preparation. Unsaved setup blocks leaving; unsent invitation text and ongoing upload/preparation state survive switching. No navigation grants permission or publishes materials.

Acceptance is the actual built Next pages at 1440px and 390px compared with saved mockups, keyboard/interaction regressions and Claude Opus product review. Synthetic API mocks prevent business writes. Evidence and release status: docs/audits/MEETING_UI_COMPLETION_2026-10-24.md.
