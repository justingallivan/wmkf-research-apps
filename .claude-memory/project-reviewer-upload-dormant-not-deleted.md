---
name: project-reviewer-upload-dormant-not-deleted
description: The external-reviewer FILE-UPLOAD path is hidden-not-deleted (S301 Phase 2 cutover to in-browser authoring). Route/infra retained server-side + hardened with a post-submit finality guard; how to re-enable.
metadata:
  type: project
  status: active
  scope: external-reviewers
---

## Recall Rule

Before "removing dead reviewer upload code" or "restoring the upload UI" — read this.
The file-upload path is **intentionally retained but unsurfaced**, not dead, and not
to be re-exposed as a regression.

## The fact (S301 Phase 2, S302 Phase 3)

The reviewer review-form authoring rework replaced the stage2b file-upload card with
an in-browser rich-text authoring form (`ReviewAuthoringForm`) + `/submit` (atomic
Dataverse answer-snapshot write). Per plan §7 the upload capability is **hidden, not
deleted**:

- **Kept server-side:** `pages/api/external/review/[token]/upload.js`,
  `lib/services/review-upload.js`, the virus-scan path, `sharepoint-cleanup.js`, and
  the `wmkf_reviewsharepointfolder` / `wmkf_reviewfilename` columns. The staff
  upload-on-behalf path is unaffected.
- **Hardened (Codex P0-1, S302):** the reviewer-token upload path
  (`opts.source === 'reviewer_self_token'`) now **409s once `wmkf_reviewreceivedat`
  is set**, so the dormant-but-reachable route can't overwrite a completed in-browser
  review. [VERIFIED via `pages/api/external/review/[token]/upload.js`.]
- **Not surfaced:** `MaterialsView` renders the authoring form; the file input / "replace
  your submission" affordances are gone (plan §7).

## How to re-enable (if ever needed)

The route is live and reachable directly today (just not linked). To restore the UI,
re-add an upload card to `MaterialsView` / `ReviewAuthoringForm` that POSTs multipart
to `/upload`. Note the finality guard: a reviewer who has already submitted in-browser
will get 409 — by design. The download-on-read in `ReviewsTab` already shows the
SharePoint link only when a file actually exists, so staff-uploaded files still
surface.

Related: [[../docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN]] §7, agent-wiki
`external-reviewer-portal`.
