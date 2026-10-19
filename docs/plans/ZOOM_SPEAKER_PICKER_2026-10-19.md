---
title: Zoom participants in the transcript speaker picker
domain: meeting-tracker
kind: plan
status: active
summary: "Branch implementation: picker-only Zoom participant suggestions from verified transcript provenance, with request-contact/manual fallback and a five-second lookup budget. Not deployed."
owner: product-engineering
related:
  - docs/CURRENT_WORK_QUEUE.md
  - lib/services/meeting-tracker-transcription/attendance-service.js
  - lib/services/meeting-tracker-transcription/service.js
  - shared/components/meeting-tracker/RecordingAndTranscriptCard.js
---

# Zoom speaker picker

Owner scope: offer participants from the recorded Zoom occurrence ahead of
request-associated people when correcting speaker names. Keep request contacts
and manual entry for uploads or unavailable attendance. Presence is not proof
of who spoke. Implementation is on `codex/zoom-speaker-picker`, not deployed.

## Invariants and contract

| Invariant | Enforcement / verification |
| --- | --- |
| Use only this transcript's verified Zoom occurrence | Job GET loads the request/visit/job-scoped import through `getZoomImportForJob`; correction GET uses integrity-checked source provenance frozen in the publication receipt. Invalid or legacy provenance yields no Zoom names. |
| Suggestions cannot change classification or attendance decisions | `zoomCandidates` is separate from existing `candidates`; only the speaker picker combines them. `proposePresentationEnd` still receives the original request candidates. |
| Optional lookup must not block editing indefinitely | Picker calls `getMeetingAttendance` with a five-second total budget. The same absolute deadline covers OAuth and every report page, with fetch abortion. Other attendance callers retain their existing default budget. |
| No automatic edit or save | Selecting a candidate fills local name state; existing explicit save/publish paths and validation remain unchanged. |
| Incomplete reports never look like a complete call roster | Partial, failed, malformed and oversized reports yield no Zoom choices, with request/manual fallback. Waiting-room-only entries and unusable names are excluded. |
| No external identity inference | Choices contain display labels only; exact rejoins deduplicate, and collision-aware Zoom display formatting retains distinct labels. No email or Zoom user identifier is returned. |

Existing authenticated request routes and binding guards remain the entry points.
There are no new routes, tables, migrations, stored candidate lists or write
operations. Optional `zoomCandidates` and `zoomCandidateStatus` response fields
flow through the existing generation/sequence-guarded detail loaders. Request
and editor switches retain their existing stale-response protections.

Complement checks: uploaded, absent, invalid and historical provenance never
queries Zoom; partial/unavailable reports preserve request/manual options; long,
control-character and email labels are excluded; a request with no candidate
still permits typing. Names are not fuzzy-matched to contacts or staff.

## Review and verification

Fresh read-only review found an unsafe inherited 90-second lookup budget against
60-second editor routes. The picker now uses the five-second total deadline;
review of that correction found no remaining must-fix issue. Tests exercise an
actual timeout abort, the remaining report budget after authentication, scoped
job and frozen-correction occurrence selection, duplicates/collisions, fallback,
group ordering and no implicit save. Existing publication, attendance and
presentation-boundary regressions are included in the focused run.

Validation passed: 300 tests across six focused suites. Relevant route/context/status/GUID gates and paired self-tests, type checking,
changed-file ESLint, design detection and documentation drift checks passed for
this change. Existing ESLint warnings outside edited lines remain unchanged.
No live Zoom report, production mutation, hosted browser rehearsal or deployment
was performed. Runtime behavior still needs hosted staff acceptance after an
explicit release decision.
