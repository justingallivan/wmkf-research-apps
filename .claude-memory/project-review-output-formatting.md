---
name: project-review-output-formatting
description: "Reviewer output formatting: approved individual and combined Word templates are Production-live; PDF remains deferred"
status: active
metadata:
  node_type: memory
  type: project
  last_verified: 2026-09-03 via exact Production Wave 25 readback, signed-in combined-export DOCX smoke, and the Ready inert Wave 2 retention deployment
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
new submissions snapshot every presented option. Wave 2 retention is now
Production-deployed on `main` at `83da197f` in Ready deployment
`dpl_F3oZ9MDbnyFox7S8Ekdos7423ece`: a dedicated guarded sweep
creates immutable individual DOCX files under the generated SharePoint namespace
and conditionally stores the existing pointer pair. Its scheduled discovery is
exact-cycle-stamp-only and newest-first, and flag-off requests create no
maintenance row. Claude's Wave 2 build review approved the source with
non-blocking suggestions; the accepted hardening is incorporated. Both rollout
variables are absent in Production. An authenticated flag-off request returned
`enabled:false` and left the job's maintenance-run population unchanged at
zero. The write path has not been exercised. The dry-run-first D26 Wave 3
backfill is source-built with a redacted hash-bound unfinished population,
pre-write drift checks, exact Production Dataverse plus SharePoint target
binding, and the existing create-only ensure service. Claude's Wave 3 review
returned APPROVE WITH NON-BLOCKING NOTES and its accepted hardening is
incorporated; all Production runs remain open. Describe Wave 2 as
Production-deployed inert and Wave 3 as reviewed but unexecuted, not activated.
