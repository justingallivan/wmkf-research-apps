---
title: Zoom transcript provenance slice
kind: plan
domain: transcription
status: branch-verified-not-deployed
summary: "Preserve exact imported recording identity across transcript revisions and recovery; attendance and discussion policy remain a separate later slice."
owner: product-engineering
related:
  - docs/atlas/postgres-zoom-recording-imports.md
  - docs/atlas/postgres-meeting-transcript-publications.md # <!-- drain-table:ignore reason=transcription-atlas-filename-not-retired-table -->
  - docs/plans/STAGE4_VIDEO_SPLIT_PLAN_2026-10-09.md
  - lib/services/meeting-tracker-transcription/source-provenance.js
---

# Zoom transcript provenance — 2026-10-09

## Scope and release status

Owner authorized provenance implementation first on `codex/transcription-labels` in
`/Users/gallivan/Code/WMKF_Apps-codex-labels`. This document describes branch source,
not a deployed feature or applied database change. The owner confirmed the migration sequence ends at 076 and reserved
`077_zoom_transcript_provenance.sql` for this slice; execution remains pending. Attendance, timeline attribution, Duncan's
checklist and discussion exclusions are deferred to a separate schema/release slice;
never amend a landed provenance migration to add that policy.

## Rollout prerequisite and rollback

Apply additive migration 077 through the owner-run migration process **before merging
this runtime code into main**. Existing readiness flags do not detect these new columns;
shipping code first would fail imports/publication. This branch does not execute the
migration. After a v6 publication exists, rolling back to a v5-only binary removes its
editable/download/derivative compatibility; prefer a forward fix or retain v6 readers
in any rollback. Do not drop the additive columns as a rollback step.

## Shared contract

- Capture approved Zoom occurrence and host plus selected audio and optional VTT IDs,
  recording type, byte count, recording start/end and actual downloaded-byte SHA-256.
  Persist the count of `audio_only` entries in the recording response, including entries
  not selected. One selected file alone does not prove a single-audio occurrence.
- Refreshed URLs must resolve to the originally selected file with unchanged ID, type,
  extension, size and recording start/end. A same-size replacement is rejected.
- Freeze capture before transcription dispatch under the live import lease. Publication
  resolves the exact request/visit/job import, never the newest request import.
- Bundle source and manifest v6 carry identical `sourceProvenance`; publication receipts
  freeze `frozen_source_provenance`. Corrections create new revisions but carry the same
  source identity. Recovery verifies receipt, source and manifest agreement and replays
  the frozen formatter version. Versions 1–5 remain readable/recoverable.
- Source identity includes job UUID, verified audio hash, bytes and duration. Zoom sources
  add import UUID, occurrence, host and selected-file capture. Upload sources have no Zoom
  identity. Historical imports lacking capture remain unknown; never infer or backfill
  identity from a similarly named recording.
- Preserve this content-free identity independently of temporary job cleanup. It contains
  no transcript words, speaker names, attendance, signed URLs or tokens. Retaining identity
  does not retain audio bytes or establish audio/video synchronization.
- Word timings, utterance boundaries, segmentation, speaker reconciliation and presentation
  cut semantics do not change in this slice. No route response expansion is required.

## Stage 4 coordination

Codex owns capture, shared provenance validation, bundle/receipt/correction/recovery
changes and the server consumer seam. Stage 4 consumes that contract after the shared
slice merges; shared-file edits are sequential. Its proposed owner-selected acceptance
rule is matching recording metadata plus staff listening, not measured alignment.
No packet fingerprint, audio re-fetch or mapping benchmark is included here. VTT is
optional for Stage 4 eligibility. Every transcript revision invalidates the existing
video approval; names-only changes do not bypass that rule. Attendance must never enter
retained video lineage. Stage 4 implements its own eligibility/listening flow later.

## Review corrections

The fresh Claude review found that Postgres BIGINT fields arrive as strings. Publication
now converts and safe-integer-validates verified size/duration, and the transaction
compares normalized values against its locked job. Fixtures use the driver's string
representation. VTT hashes are also checked against the verified job. The server-only
Stage 4 reader requires an authenticated actor supplied by its caller, a trusted DAL
context, and a matching published receipt for non-null provenance; it is not a public
Zoom endpoint or a substitute for route authorization.

## Evidence and remaining verification

| Claim | Producer → persistence → consumer | Evidence/status |
|---|---|---|
| Exact download capture | `import-service.js` → `selected_recording_files` via `captureZoomImportFiles` → `provenanceFromJob` | VERIFIED via branch source; offline regressions passed; database provisioning pending |
| Revision-stable identity | publication service → `frozen_source_provenance`, source and manifest v6 → correction/recovery | VERIFIED via branch source; offline regressions passed; deployment pending |
| Authorized current-source read | current binding and verified bundle → `resolveCurrentMeetingTranscriptSource` | VERIFIED via branch source; server seam only, no video eligibility inference |
| Attendance/policy and video acceptance | N/A in this slice | PLANNED separately |

## Verification and handoff record

- 40 affected Jest suites, 920 tests passed after review fixes (2026-10-09).
- Reverting exact file binding produced three expected regression failures; reverting
  source freezing produced one; reverting BIGINT normalization produced two. Every fix
  was restored and the affected suites passed.
- All 70 `check:*` commands ran sequentially, including self-tests and `check:types`.
  Only the owner-accepted worktree memory-link invariant failed. The factory-ledger
  check (also run with `--allow-unreachable`) skipped because no test-ledger URL is set.
- Fresh read-only Claude review against origin/main found a BIGINT representation bug
  and missing service-flow coverage. Normalization, string-valued database fixtures,
  publish/correction/recovery coverage, the node test pragma, VTT hash verification,
  receipt checks and actor preconditions were corrected. No claim of a second Claude
  approval is made; the implementation owner verified the fixes with regressions.
- Docs, import/publication Atlas pages and wiki router reconciled for this bounded
  provenance change. The two drain-table scanner false positives were narrowly
  annotated and the gate/self-test reran successfully. No unrelated memory or
  SESSION_PROMPT edit was made.

Scoped documentation sweep: RECONCILED for branch-source provenance facts. Production
application of 077 and deployed behavior are unverified; no Production probe or write
was performed. Attendance, policy, timeline inference and Stage 4 video processing
remain separate future slices. Commit/push and the owner-controlled migration/merge
complete the handoff; migration must precede the main merge as described above.
