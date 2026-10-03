---
title: Meeting transcription Fable round 2 evidence
domain: transcription
kind: evidence
status: review-evidence
summary: "OAuth-only read-only review of revision 2; conditional implementation verdict, not release approval."
owner: product-engineering
---

# Fable round 2 — 2026-10-01

Review completed through the authorized subscription OAuth session as `claude-fable-5-1`, with no permission denials. This is reviewer evidence, not independent verification of every claim. Root dispositions are in the plan. No secrets, recordings or transcript contents were supplied.

**Verdict: one named blocking change, then READY TO IMPLEMENT as disabled source on `codex/transcription-pilot`.** This is not approval for the Dataverse field wave, Postgres applies, enablement, shared-runtime provider wiring or real-recording tests; none of those are needed to write disabled source.

This was a read-only review using 15 source calls. The session has no write tool, so the review exists only in this message.

## Blocking change

**Name the mechanism that protects job bytes during publication.** The plan says "a valid publication lease blocks deletion of bytes it is reading", but puts that lease on the new receipt table, which nothing in the job store checks.

- **Cleanup claim:** `claimCleanup` honours only the job row's own lease (`lease_token IS NULL OR lease_expires_at <= NOW()`, `store.js:912-919`). I read only the first lines of `claimNextCleanupJob` (`:926-936`) and assume it uses the same predicate.
- **Cleanup request:** `requestCleanup` ignores leases entirely and immediately blanks `speaker_names` and bumps `version` (`store.js:887-892`).
- **Why it matters:** audio is already deleted once a job is ready, so a purge mid-publication loses paid content.

Exact correction for the "Cleanup and retention boundaries" section:

1. Freeze is one version-checked transaction using the same predicates as `updateSpeakerNames` (`store.js:873-876`). It copies the name mapping, job version and content hash into the receipt and takes the job row's own `lease_token`, before any SharePoint I/O.
2. The publisher renews that job lease until the source JSON is uploaded and read-back verified. Retries after that use only the frozen files.
3. The Tracker "delete draft" wrapper returns 409 while a receipt for that job is unresolved.

## Contracts to pin (small, not blocking)

- **Producer.** Bundle rows must use the existing producer constant; tell generated from manual by manifest presence. Three places depend on it:
  - the recipient projection filters on it (`presentation-page-service.js:79-82`);
  - replay validation requires it (`material-service.js:295`);
  - the staging reconciler binds on the literal (`portal-upload-staging.js:644`).
- **Registry field mapping.** The current key includes the file hash (`material-service.js:1703`), so a retry that regenerates bytes under a new formatter would mint a second row. Pin these:
  - generation key = digest(producer : request : TRANSCRIPT : operationId : frozenInputHash);
  - `wmkf_inputfingerprint` = frozen input hash;
  - `wmkf_contenthash` = TXT hash;
  - replay also compares all three manifest descriptors to the receipt, on top of the existing checks (`:291-303`).
- **Correction-draft home.** The plan never says where an editable post-expiry correction draft lives; `updateSpeakerNames` stops at `expires_at` (`store.js:876`). Recommend client-held edits, with the receipt created only at Publish (names plus expected artifact and revision). If root wants shared in-progress corrections, say the draft is a receipt row with version check and expiry.
- **Manifest select is opt-in per caller.** Every adapter reader calls `requestDocumentSelect()` (`request-document.js:113-124`, `:154-203`). A readiness-default group would ship the memo to all of them, so make it readiness-gated and requested only by the bundle reader, replay and reconciler.
- **Orphan-deletion rule.** The existing sweep deletes on a zero-row lookup as soon as the lease lapses (`portal-upload-staging.js:620-639`, `:719`). Do not copy that for bundles: also require the receipt closed by version check and a quarantine longer than the maximum request duration past the last lease expiry.

## Seams that hold as written

| Seam | Evidence |
|---|---|
| Manual and generated publication share one slot | Lease is keyed on request and artifact type, and the fence bumps on a new token (`slot-lease-store.js:17-43`). Predecessor and stale-replay checks run under it (`material-service.js:1793-1801`, `:1857-1877`). |
| Visibility boundary is atomic | One create writes a READY row with all file identity (`material-service.js:1820-1844`); the manifest rides in the same payload. |
| Staging cleanup cannot claim bundle files | It works only from staging rows and exact persisted drive/item (`portal-upload-staging.js:598-651`). |
| Recipients do not see the manifest | Descriptors are explicit field projections of slot winners (`presentation-page-service.js:79-96`, `material-model.js:181-194`). |
| Visit binding and mapped-actor gates exist | Exactly one active visit (`material-service.js:200-216`); mapped staff identity required (`:1666-1668`). |

Candidate privacy and shared-draft authorization are adequately specified in revision 2. I did not re-read those sources; R1's citations stand unverified by this round.

Once root folds in the blocking change, the plan's frontmatter status and closing "DRAFT — NOT IMPLEMENTATION-READY" line need updating.
