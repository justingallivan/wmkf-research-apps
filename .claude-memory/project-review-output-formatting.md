---
name: project-review-output-formatting
description: "Reviewer output formatting: approved individual and combined Word templates are Production-live; PDF remains deferred"
status: active
metadata:
  node_type: memory
  type: project
  last_verified: 2026-09-03 via exact Production Wave 25 readback, Ready deployment, and signed-in combined-export DOCX smoke
  originSessionId: 7db29a2d-b16d-490a-80f0-7e4fa4c04f0a
---

## Recall Rule

Read this when: changing a reviewer courtesy-copy attachment or the staff
Word review export, or considering a restored PDF workflow.

Do:
- Keep `composeReviewReport` as the combined-export semantic composition seam;
  `composeSingleReviewCopy` owns the individual courtesy-copy model.
- Route individual answer loading, composition, filename/content-type selection,
  and rendering through `review-documents/individual-review-builder.js`; its
  caller deliberately owns the generation timestamp.
- Apply separate reviewer-facing and staff-facing presentation styles over the
  same answer snapshot.
- Treat a future PDF as a conversion of the canonical DOCX through Microsoft
  Graph, not as a second independent layout implementation. The planned
  contract lives in `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md`.

Do not:
- Fork answer interpretation between courtesy and staff exports.
- Deploy the renderer before Wave 25 `wmkf_questionoptions` is exact in the
  target Dataverse environment.
- Describe PDF as a current Reviews-tab affordance; the UI is Word-only as of
  the owner decision on 2026-08-13.

Ground truth: the formatting pass is `[PRODUCTION-LIVE 2026-09-03]` on `main`
at `3101f067` in Ready deployment `dpl_AjT5FeDh5wkdeFSoZWJsVDM5oBqs`.
The tracked templates and OOXML renderer are in `shared/templates/reviews/`
and `lib/services/review-documents/`. Production Wave 25 was independently
read back exact. A signed-in export from Request `1002903` produced a valid
60,586-byte DOCX with the **Aggregated Proposal Reviews** title. No courtesy
email was sent for release verification; that deployed path is source/test/
render verified, not Production transport-smoked.

Owner note (S328, 2026-07-04), captured while architecting the review
thank-you sweep with courtesy-copy attachment:

1. **Reviewer courtesy copy** — the attachment of the reviewer's own review
   sent by the thank-you sweep uses a first-pass format. The owner wants a
   deliberate formatting pass on it (reviewer-facing tone/layout).
2. **Staff exports too** — the staff rendition was built as DOCX/PDF. The
   current Reviews-tab export is Word-only; its formatting still needs the
   deliberate pass. The legacy PDF renderer remains source-only, and any future
   one-click PDF should convert the canonical DOCX through Graph.

**Why:** both renditions derive from the same `wmkf_appreviewanswer`
snapshot data; a single formatting effort should restyle the shared
composition seam rather than diverging the two outputs ad hoc.

**Current contract:** the combined document is an authenticated, server-
authoritative on-demand download; the individual document is generated through
the shared builder by the thank-you sweep before its If-Match claim. A render failure leaves the row
unclaimed and unsent so the complete delivery retries later. Both use the same answer
snapshot interpretation but distinct approved templates. Historical categorical
rows without a full option snapshot render selected-only with an explicit note;
new submissions snapshot every presented option. SharePoint retention/link
replacement remains planned and has not been implemented by Wave 1.
