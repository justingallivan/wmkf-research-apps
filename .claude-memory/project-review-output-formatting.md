---
name: project-review-output-formatting
description: "Owner note (S328): reformat the review renditions — the reviewer courtesy-copy attachment (thank-you sweep) ships with a placeholder format, and the staff DOCX/PDF exports (review-report.js) are staff-oriented and also need a formatting pass"
status: active
metadata:
  node_type: memory
  type: project
  originSessionId: 7db29a2d-b16d-490a-80f0-7e4fa4c04f0a
---

Owner note (S328, 2026-07-04), captured while architecting the review
thank-you sweep with courtesy-copy attachment:

1. **Reviewer courtesy copy** — the attachment of the reviewer's own review
   sent by the thank-you sweep uses a first-pass format. The owner wants a
   deliberate formatting pass on it (reviewer-facing tone/layout).
2. **Staff exports too** — the existing DOCX/PDF export renditions
   (`shared/utils/review-report.js` composition + renderers, Reviews tab
   Export) are "more appropriate for staff" and should also be reformatted
   in the same effort.

**Why:** both renditions derive from the same `wmkf_appreviewanswer`
snapshot data; a single formatting effort should restyle the shared
composition seam rather than diverging the two outputs ad hoc.

**How to apply:** when either surface is next touched, or when the owner
schedules the formatting pass, treat `composeReviewReport` (pure seam) as
the single place to evolve; keep reviewer-facing and staff-facing renditions
as two styles over one composition.
