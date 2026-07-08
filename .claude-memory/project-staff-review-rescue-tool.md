---
name: project-staff-review-rescue-tool
description: Owner ask (S347) — build a dedicated staff "manually enter a review" rescue tool, off the Track Reviewers panel, that mirrors the FULL structured review form (incl. rich-text) for edge cases / portal breakage. Backend routes already exist.
metadata:
  type: project
  status: active
  scope: reviewer
---

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
  staff-editable question set (`getActiveQuestionSet`). The old
  `shared/components/external/ReviewFormFields.js` only renders picklist/string (NO
  rich-text), so it is **insufficient** on its own — do not just re-surface it.
- **Backend already exists** (retained by design): the write path is
  `/api/review-manager/mark-received-no-file` (structured, no file) and
  `/api/review-manager/upload-review` (file). Prefer routing a full structured entry
  through the same producer the portal `/submit` uses
  (`lib/external/build-review-submission.js`) so a staff-entered review is
  indistinguishable from a portal one — reconcile before reusing `mark-received-no-file`
  as-is (it currently omits rich-text at the UI layer only).
- **Location:** off the Track Reviewers panel. Candidate homes: an admin/superuser
  surface, or the Reviews tab. Owner to confirm placement at build time.
- **Orphaned asset:** `ReviewFormFields.js` has no importer after S347 — it's a
  candidate for reuse (partial) or deletion; decide during this build, don't delete
  speculatively.

## Why not just keep the panel buttons

They were PDF-email-era holdovers that (a) implied a file-based workflow that no longer
exists and (b) couldn't capture rich-text answers — confusing and incomplete. The owner
wants the capability preserved as an explicit *edge-case rescue*, not as if it were a
primary path. See [[project-reviewer-upload-dormant-not-deleted]] and agent-wiki
`external-reviewer-portal`.
