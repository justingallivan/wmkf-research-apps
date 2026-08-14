---
name: project-review-output-formatting
description: "Reviewer output formatting: courtesy-copy and staff Word renditions need a deliberate formatting pass; Reviews-tab PDF is removed, with Graph conversion deferred"
status: active
metadata:
  node_type: memory
  type: project
  last_verified: 2026-08-13 via review-report composition and ReviewsTab export consumer; formatting and Graph conversion remain planned
  originSessionId: 7db29a2d-b16d-490a-80f0-7e4fa4c04f0a
---

## Recall Rule

Read this when: changing a reviewer courtesy-copy attachment or the staff
Word review export, or considering a restored PDF workflow.

Do:
- Keep `composeReviewReport` as the shared semantic composition seam.
- Apply separate reviewer-facing and staff-facing presentation styles over the
  same answer snapshot.
- Treat a future PDF as a conversion of the canonical DOCX through Microsoft
  Graph, not as a second independent layout implementation. The planned
  contract lives in `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md`.

Do not:
- Fork answer interpretation between courtesy and staff exports.
- Treat the requested formatting pass as already implemented.
- Describe PDF as a current Reviews-tab affordance; the UI is Word-only as of
  the owner decision on 2026-08-13.

Ground truth: owner note S328 and current composition/consumers in
`shared/utils/review-report.js` and
`shared/components/workbench/ReviewsTab.js`. Formatting remains `[PLANNED]`.

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

**How to apply:** when either surface is next touched, or when the owner
schedules the formatting pass, treat `composeReviewReport` (pure seam) as
the single place to evolve; keep reviewer-facing and staff-facing renditions
as two styles over one composition.
