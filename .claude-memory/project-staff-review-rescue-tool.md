---
name: project-staff-review-rescue-tool
description: Dedicated staff "Enter review manually" rescue in the Reviews tab, mirroring the full live structured review form for portal-breakage edge cases.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-07-22 via PR 75 checks + production deployment dpl_BjkM3tjopMpRWPMwn3NRgtB4CHSU Ready + auth-boundary smoke
---

## Recall Rule

Read when staff need to enter a review outside the reviewer portal. The dedicated
full-form rescue lives in the Reviews tab; the retained upload/mark-received
endpoints remain separate legacy partial paths.

## The ask (owner, S347, 2026-07-08)

When the S347 cleanup removed the legacy "Staff upload (override)" (file) and "Mark
received (no file)" affordances from the Track Reviewers ⋮ menu (see
[[project-reviewer-upload-dormant-not-deleted]]), the owner said: keep a way to
**manually enter a review** for edge cases / if the portal breaks — **but not on the
Track Reviewers panel**. This is that action item.

## Requirements / shape

- **A modern review is structured data** (`wmkf_appreviewanswer` snapshot rows +
  parent affiliation/`wmkf_reviewreceivedat`/status PATCH), NOT a file. So the rescue
  tool must let staff enter the **full structured review** — the 3 rating radios + the
  **rich-text narrative answers** — mirroring `ReviewAuthoringForm` and the live
  staff-editable question set (`getActiveQuestionSet`). NB the old
  `shared/components/external/ReviewFormFields.js` was **deleted (S347)** — it only rendered
  picklist/string (NO rich-text), so it was insufficient anyway; do not resurrect it.
- **The retained backend was insufficient:** `mark-received-no-file` and
  `upload-review` intentionally write partial/file-era representations. The dedicated
  `/api/review-manager/manual-review-entry` route instead uses the same producer the
  portal `/submit` uses (`lib/external/build-review-submission.js`), so staff entry
  creates the complete answer snapshot without changing either legacy contract.
- **Location:** the Reviews tab, off the Track Reviewers panel.
- **`ReviewFormFields.js` was deleted (S347)** — it was the legacy uncontrolled
  string+picklist renderer with no rich-text, so it couldn't serve this tool anyway.
  Build the rescue UI on the full `ReviewAuthoringForm` (controlled + `RichReviewEditor`
  + `getActiveQuestionSet`), not a resurrected `ReviewFormFields`.

## Implemented contract (2026-07-22)

**Ship state:** live in production via PR #75 / merge `0226f7eb`; exact Vercel
deployment `dpl_BjkM3tjopMpRWPMwn3NRgtB4CHSU` reported Ready and holds the live aliases.

- `ReviewsTab` offers **Enter review manually** only on accepted, outstanding rows.
- `ManualReviewEntryForm` GETs the authoritative live question set/version and current
  affiliation, then reuses `ReviewQuestionFields` from `ReviewAuthoringForm`, including
  the rich-text editor. It has no autosave and clearly labels submission as final.
- POST re-reads acceptance/receipt state and the parent ETag, rejects stale question
  versions, sanitizes rich text, runs the full external validator and canonical
  `buildReviewSubmission()`, then commits parent + every answer row atomically.
- The parent is marked `wmkf_reviewuploadedbystaff=true`; any stale portal draft is
  deleted best-effort only after the Dataverse commit. A received review is locked
  against retry overwrite, and a concurrent parent change returns a retryable conflict.

## Why not just keep the panel buttons

They were PDF-email-era holdovers that (a) implied a file-based workflow that no longer
exists and (b) couldn't capture rich-text answers — confusing and incomplete. The owner
wants the capability preserved as an explicit *edge-case rescue*, not as if it were a
primary path. See [[project-reviewer-upload-dormant-not-deleted]] and agent-wiki
`external-reviewer-portal`.
