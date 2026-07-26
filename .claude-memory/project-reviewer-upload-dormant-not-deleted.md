---
name: project-reviewer-upload-dormant-not-deleted
description: The old reviewer-PDF experiment was replaced by structured form submission to Dataverse. Its hidden/removed UI and retained server routes/fields can leave legacy test baggage; do not treat a PDF as a current authoritative review.
metadata:
  type: project
  status: active
  scope: external-reviewers
  last_verified: 2026-07-26 via owner clarification, retained upload/mark-received routes, and current MaterialsView/ReviewAuthoringForm source
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
  the `wmkf_reviewsharepointfolder` / `wmkf_reviewfilename` columns.

**Authority boundary:** the current review is the form submission's structured
`wmkf_appreviewanswer` snapshots in Dataverse, not a PDF filename or file in a
review upload folder. The older design explicitly experimented with reviewers
uploading a PDF of their review. Files, pointers, statuses, scripts, and retained
routes from that experiment are legacy baggage unless a current caller and
provenance prove otherwise.

Owner clarification 2026-07-26: the Tim Newhouse/St. Jude PDF found under request
1002379's `Reviewer_Uploads/GallivanTest_6ad328b4` folder was another **test
artifact from that earlier PDF-upload experiment**, not a genuine submitted
review. It was preserved during the exact EICAR cleanup because its status was
unknown at deletion time. This later classification does not retroactively widen
that deletion authorization.

When legacy review files surface:

- do not count the file as a current review or infer genuine reviewer history;
- inspect suggestion lifecycle fields, answer snapshots, draft/audit history,
  folder provenance, and current callers;
- distinguish “test artifact” from “authorized to delete”—classification alone is
  not deletion authority;
- expect more dormant PDF-era baggage elsewhere until positively reconciled.

## Staff-side surfaces ALSO removed from the Track Reviewers panel (S347)

The staff-side counterparts on `ReviewerManagePanel` (Track Reviewers ⋮ menu) — the
**"Staff upload (override)"** file-upload control (`/api/review-manager/upload-review`,
`UploadReviewModal` + `ReviewFormFields`) and **"Mark received (no file)"**
(`/api/review-manager/mark-received-no-file`) — were **removed from the UI (S347)**.
They were PDF-email-era holdovers: a modern review is structured answer-snapshot data
(via the portal `/submit`), not a file, and `ReviewFormFields` can't even capture the
rich-text answers (it renders picklist/string only). **Routes + services are RETAINED
server-side** (unchanged), for a planned dedicated staff "manual review rescue" tool
that must mirror the FULL `ReviewAuthoringForm` (incl. rich-text) — see
[[project-staff-review-rescue-tool]]. `shared/components/external/ReviewFormFields.js` was **deleted (S347)** —
the legacy uncontrolled string+picklist renderer (no rich-text) was orphaned by this
removal, had zero importers, and couldn't render the
rich-text answers the rescue tool needs, so the rescue tool should reuse the full
`ReviewAuthoringForm`, not this. Its dep `lib/external/review-form-schema.js` stays
(still used by 10+ files). [VERIFIED via `ReviewerManagePanel.js` (S347) + route files still present.]
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
