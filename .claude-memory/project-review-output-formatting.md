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
zero. The scheduled write path has not been exercised. The dry-run-first D26 Wave 3
backfill is source-built with a redacted hash-bound unfinished population,
pre-write drift checks, exact Production Dataverse plus SharePoint target
binding, and the existing create-only ensure service. Claude's Wave 3 review
returned APPROVE WITH NON-BLOCKING NOTES and its accepted hardening is
incorporated. The first read-only Production dry run found 23 eligible rows and
one `invalid_snapshot` on owner-confirmed test Request `1003223`. The replacement
schema-v2 manifest records that exact request as a hash-bound
`excluded_test_request` and is clean: 23 eligible, one visible test exclusion,
zero blockers, and zero existing generated items. No Graph or Dataverse mutation
occurred. The owner selected Request `1002874` / Agnes Karasik for the one-file
proof. Its fresh request-scoped manifest validates with one eligible missing
file, zero blockers, no existing item, and hash
`8cc5c7821fa515828a2426cde6e800de131a4ab826c240881a97001899e41711`; a
metadata-only Production read confirmed the exact request/suggestion/reviewer
identity. The owner then explicitly approved that exact manifest. The operator
backfill created SharePoint item `01G4GVMSZ3RAXEKILFYRCISR6CGKHFVCQI`
(`Review-1002874.docx`, 69,761 bytes, version `1.0`) and committed the exact
Dataverse pointer pair. Independent readback classified it `already_filed` and
matched the reviewed governed hash. The owner confirmed the Workbench download
succeeds and the downloaded file looks correct. Opening the retained item
through akoyaGO/Word for the web exposed a tab-layout defect that split
`Proposal Review` after its first character. The branch removes the positioning
tabs and directly right-aligns both review-template titles; focused tests,
package isolation checks, and rendered inspection pass. The fix is not deployed.
The owner then simplified the retained-file
destination to request-level
`Reviews/Review-<request>-<reviewer name>.docx`, removing both intermediate
generated/GUID layers from the current target. The old Request `1002874` item
remains backward-compatible. The current v4 D26 manifest has hash
`9254df9e5e504c79007391efc85d189e89e8b8b2ff80b8e4f11990baca08f4f8`,
22 eligible missing files with unique destinations, one visible test exclusion,
zero blockers, and no Request `1002874` candidate. Its exact suggestion set is
unchanged from the preceding survey; no new qualifying rows appeared. The owner then approved the
exact Request `1002874` repair while deferring old-file cleanup. Manifest hash
`c30c76e47281208b8b4cc25976360453eebbdc65ba3d4b203c19a6e0f1a5692d`
created and verified item `01G4GVMSZZ25YPTP3RGFEK6LCT64W3JPX2` at
`Reviews/Review-1002874-Agnes Karasik.docx`, repointed Dataverse, and left the
old item present. Independent readback matched the corrected semantic hash.
The owner confirmed that v2 fixed the split title but Word Online still moved it
below the floating logo. The v3 templates preserve the package except for the
first-page logo wrap directive, replacing contradictory behind-text
`wrapTight` geometry with explicit `wrapNone`. The exact content-repair manifest
hash is `ab98b779b660c77719c317f73b8f1004b08a898f7159971d6f5c97f9bfb2295d`.
Its first execution received an explicit SharePoint 423 lock and changed
nothing; the retry versioned the same stable item/name from `1.0` to `2.0`,
retained and verified the prior version, and produced governed hash
`gdc1:E3KvF7rvlOaGoxps6DHihILCQlyDlSheguneB0F0ojw`. Independent readback matched
that hash and the existing Dataverse pointer pair. Owner inspection still
rejected the floating-logo alignment and supplied an edited header-only Word
file. The v4 templates preserve its exact fixed two-column Times New Roman text
header without first-page drawings, anchors, tabs, or image relationships.
Exact content-repair manifest hash
`18007d495f52ab7abb88c03e6d3099eadb953157e69051b0c4c96898881ef09e`
versioned the same stable item/name from `2.0` to `3.0`; independent readback
matched v4 governed hash `gdc1:fbIC8o5aWoe_rOjXNK6mAKR6kbNRQ_I6MU60R28Chi4`
and the existing Dataverse pointer pair. At the owner's explicit request, a
second guarded in-place upload regenerated the same real v4 output as version
`4.0` at `2026-09-04T00:59:51Z`; versions `1.0`–`3.0` remain in SharePoint
history, and independent readback again matched the v4 hash and unchanged
pointers. The owner visually confirmed version `4.0` in Word Online and approved
the v4 header on 2026-09-03. Describe Wave 2 as
Production-deployed inert, Wave 3 as exact new-path storage/pointer and
manifest-bound v3/v4 content repairs proved, and automatic filing as not activated.
