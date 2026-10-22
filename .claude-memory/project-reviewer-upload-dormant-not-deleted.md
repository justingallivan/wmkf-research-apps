---
name: project-reviewer-upload-dormant-not-deleted
description: The old reviewer-PDF experiment was replaced by structured form submission to Dataverse. Its hidden/removed UI and retained server routes/fields can leave legacy test baggage; do not treat a PDF as a current authoritative review.
metadata:
  type: project
  status: active
  scope: external-reviewers
  last_verified: 2026-10-22 via shared receipt guard, legacy receipt writers, and implemented structured rescue; test-artifact classification remains the dated July 26 owner record
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

For the current meanings and reader-specific limits of drafts, snapshots, receipt
stamps and file pointers, use the [review-record authority map](../docs/atlas/dataverse-wmkf-appreviewanswer.md#review-record-authority).
Retained partial paths do not imply a complete modern structured review.

## Staff-side surfaces ALSO removed from the Track Reviewers panel (S347)

The staff-side counterparts on `ReviewerManagePanel` (Track Reviewers ⋮ menu) — the
**"Staff upload (override)"** file-upload control (`/api/review-manager/upload-review`,
`UploadReviewModal` + `ReviewFormFields`) and **"Mark received (no file)"**
(`/api/review-manager/mark-received-no-file`) — were **removed from the UI (S347)**.
They were PDF-email-era holdovers: a modern review is structured answer-snapshot data
(via the portal `/submit`), not a file, and `ReviewFormFields` can't even capture the
rich-text answers (it renders picklist/string only). **Routes + services remain retained
server-side as separate legacy partial writers.** The dedicated structured rescue
is implemented on the Reviews tab: `ManualReviewEntryForm` →
`/api/review-manager/manual-review-entry` uses the full live question set and the
canonical snapshot producer. It is not a restoration of those file-era controls;
see [[project-staff-review-rescue-tool]]. `shared/components/external/ReviewFormFields.js` was **deleted (S347)** —
the legacy uncontrolled string+picklist renderer (no rich-text) was orphaned by this
removal, had zero importers, and couldn't render the
rich-text answers the rescue tool needed. That limitation motivated reuse of the
full shared field renderer in the implemented structured rescue, not restoration
of the deleted renderer. Its dep `lib/external/review-form-schema.js` stays
(still used by 10+ files). [VERIFIED via `ReviewerManagePanel.js` (S347) + route files still present.]
- **Current shared finality boundary:** `lib/services/review-receipt-guard.js`
  rejects received or terminal rows, unaccepted/declined engagements, and missing
  ETags. Portal submit, structured staff rescue, retained staff/token uploads, and
  no-file receipt use the authorizing row version for their conditional write.
  Staff upload is not an overwrite escape hatch for an already received review.
  The token route's early receipt check is additional protection; its presence
  does not exempt the shared staff service.
- **Historical hardening:** S302 added the reviewer-token early guard; July 22
  shared-receipt hardening (`a9ac471c6`) extended the common eligibility/finality
  contract across the receipt writers. The old planned-rescue description predates
  the dedicated full-form implementation recorded in the rescue memory.
- **Not surfaced:** `MaterialsView` renders the authoring form; the file input / "replace
  your submission" affordances are gone (plan §7).

## Historical restoration mechanics — not authorization

The old implementation note proposed re-adding an upload card to `MaterialsView`
/ `ReviewAuthoringForm` that posted multipart to `/upload`. Preserve that as the
mechanics of the retired experiment, not a current next step. The owner-directed
structured workflow remains controlling: re-exposure would require a new owner
decision and an explicitly reviewed receipt/content-authority design. Do not
restore it merely because the route remains in source.

The retained endpoints are still directly callable subject to their token or staff
authorization and receipt guards; hidden UI is not proof of dead code. Keep files,
pointers, and old test-artifact classifications distinct from authority to delete
or reset them. This documentation change authorizes no restoration or cleanup.

Related: [[../docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN]] §7, agent-wiki
`external-reviewer-portal`.
