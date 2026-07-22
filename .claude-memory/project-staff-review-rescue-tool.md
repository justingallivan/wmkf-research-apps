---
name: project-staff-review-rescue-tool
description: Owner ask (S347) — build a dedicated staff "manually enter a review" rescue tool, off the Track Reviewers panel, that mirrors the FULL structured review form (incl. rich-text) for edge cases / portal breakage. Backend routes already exist.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-07-22 via current workbench UI search and retained staff review routes/services
---

## Recall Rule

Read when staff need to enter a review outside the reviewer portal. The dedicated
full-form rescue UI is still unbuilt; retained upload/mark-received endpoints are
not proof that a complete structured-entry surface exists.

## The ask (owner, S347, 2026-07-08)

When the S347 cleanup removed the legacy "Staff upload (override)" (file) and "Mark
received (no file)" affordances from the Track Reviewers ⋮ menu (see
[[project-reviewer-upload-dormant-not-deleted]]), the owner said: keep a way to
**manually enter a review** for edge cases / if the portal breaks — **but not on the
Track Reviewers panel**. This is that action item.

## Requirements / shape

- **A modern review is structured data** (`wmkf_appreviewanswer` snapshot rows +
  parent ratings/affiliation/`wmkf_reviewreceivedat` PATCH), NOT a file. So the rescue
  tool must let staff enter the **full structured review** — the 3 rating radios + the
  **rich-text narrative answers** — mirroring `ReviewAuthoringForm` and the live
  staff-editable question set (`getActiveQuestionSet`). NB the old
  `shared/components/external/ReviewFormFields.js` was **deleted (S347)** — it only rendered
  picklist/string (NO rich-text), so it was insufficient anyway; do not resurrect it.
- **Backend already exists** (retained by design): the write path is
  `/api/review-manager/mark-received-no-file` (structured, no file) and
  `/api/review-manager/upload-review` (file). Prefer routing a full structured entry
  through the same producer the portal `/submit` uses
  (`lib/external/build-review-submission.js`) so a staff-entered review is
  indistinguishable from a portal one — reconcile before reusing `mark-received-no-file`
  as-is (it currently omits rich-text at the UI layer only).
- **Location:** off the Track Reviewers panel. Candidate homes: an admin/superuser
  surface, or the Reviews tab. Owner to confirm placement at build time.
- **`ReviewFormFields.js` was deleted (S347)** — it was the legacy uncontrolled
  string+picklist renderer with no rich-text, so it couldn't serve this tool anyway.
  Build the rescue UI on the full `ReviewAuthoringForm` (controlled + `RichReviewEditor`
  + `getActiveQuestionSet`), not a resurrected `ReviewFormFields`.

## Why not just keep the panel buttons

They were PDF-email-era holdovers that (a) implied a file-based workflow that no longer
exists and (b) couldn't capture rich-text answers — confusing and incomplete. The owner
wants the capability preserved as an explicit *edge-case rescue*, not as if it were a
primary path. See [[project-reviewer-upload-dormant-not-deleted]] and agent-wiki
`external-reviewer-portal`.
