---
title: Bounded work queue drift reconciliation
domain: agent-harness
kind: audit
status: complete
summary: "Code and Git evidence correcting selected queue statuses; production configuration and the rest of the backlog remain outside scope."
owner: product-engineering
related:
  - docs/CURRENT_WORK_QUEUE.md
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md
---

# Work queue drift — 2026-10-19

Sweep Mode B, bounded to the status claims below. Luna performed a read-only
source/tests/Git investigation; Codex applied the corrections authorized by the
owner. No runtime changes or live data probes were made. Priority order did not
change. Current source and Git evidence take precedence over older plan prose.

| Claim in the queue or linked inventory | Independent evidence | Disposition |
| --- | --- | --- |
| Automatic split transcripts still need building | `lib/services/meeting-tracker-transcription/service.js` publishes durably, then calls `enqueueAutomaticTranscripts`; the regeneration journal/drain owns later execution. `RecordingAndTranscriptCard.js` reads regeneration state and displays updating status. Confirmed presentation-end eligibility remains required; summaries remain manual. | STALE: implementation exists; no new production acceptance claim. |
| Real video supersession reasons and inline playback still need building | `shared/components/meeting-tracker/RecordingAndTranscriptCard.js` maps failure reasons and renders `PresentationVideoPlayer`; `tests/unit/recording-and-transcript-card-presentation-video.test.js` covers inline playback. | STALE: implementation exists; browser acceptance remains distinct. |
| Header status chip still needs building | `shared/components/meeting-tracker/SiteVisitEditor.js` consumes child-reported state through the shared header/readiness resolvers and renders the chip. | STALE: implementation exists. |
| Workbench PRs #210/#211 await merge | `git merge-base --is-ancestor` succeeds for `0fb2e47ba` and `7c647b524` against main. GitHub also reports both merged September 9. | STALE: remove pending merge instructions. |
| Tightened J27 gate remains unmerged | Reviewed `65eb4bfee` history is an ancestor of main. `npm run check:j27-register` reports 79 rows: 61 ok, 0 stale, 6 unverifiable, 12 closed. | STALE merge/count wording; unverifiable rows remain unresolved. |
| Cycle Dossier still needs the recorded smoke and a hardening slice scoped | The queue already records the successful owner smoke. Git contains hardening merge `1accfbcab` (#265), then #274–278 (`df127a742`, `234da2712`, `33bdac373`, `b0c019e2d`, `b8e1499be`). | STALE/CONFLICT: remove duplicate pending work; retain retention decision and live-state uncertainty. |
| Personal-email PRs #330/#332 are unmerged | Git contains `185c9f35f` and `bab0d3989`; current producer, preference and UI paths were inspected by Luna. | STALE: correct merge status without declaring the broader initiative complete. |
| Audio streaming is unfinished | `lib/services/transcription-pilot/runtime.js` buffers Blob bytes, and `worker.js` passes the buffer to the provider. | AGREE: retain open item. |
| Zoom-participant speaker picker is unfinished | The card still uses request candidates; `attendance-service.js` separately reads Zoom participants. | AGREE: retain open item. |
| Production cut-speed configuration and measured improvement | Source defaults to two VCPUs; no current environment or measured-run probe was authorized or performed. | UNKNOWN: retain explicit verification requirement. |

The personal-email inventory's original September 24 tables are a historical
baseline, not a new exhaustive current send inventory. Historical briefs remain
under their explicit historical boundaries. Other roadmap claims and live
production behavior were excluded. This reconciliation does not establish that
all unfinished features in the repository have been identified.

Validation: documentation currency, fact consistency, canonical pointers, symbol
references, build-claim freshness and harness framing gates, each followed by its
self-test; generated docs catalogue parity and whitespace checks. The J27 gate
and its self-test ran sequentially. Gate results establish only their registered
checks, not full runtime correctness.
