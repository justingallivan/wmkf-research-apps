---
name: project-reviewer-apps-redesign-direction
description: The unified Request Workbench has proven Pre-Site/Initial/Site Visit and same-item Final paths; acknowledgement, matrix, and explicit persona dashboard lenses are Production-live.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-09-06 via source (Final writeups dashboard service/views) and owner decision
---

## Recall Rule

Read this when: building or planning the Request Workbench, the cycle dashboard, the reviewer-lifecycle slice, or anything that touches the Finder/Manager → Workbench consolidation. J27-sensitive sites are tracked in `docs/J27_TRANSITION_REGISTER.md`; add there, not here.

Do:
- Build toward the per-request-holistic destination; the near-term build is the reviewer-lifecycle slice as Workbench v1 (URL `/workbench/[requestId]/...`).
- Reviewer-tab structure: DECIDED S206 as 4-tab; built as 5 sub-tabs (Candidates added S211); now **COLLAPSED to 3 sub-tabs — Find · Invite Reviewers · Track Reviewers (S280, commit `4d45b4c8`)** — with state-aware default landing. The `candidates` tab key now backs the "Invite Reviewers" label; legacy `invite`/`completed` deep-links normalize to `track`.
- Treat `akoya_requeststatus` (Status tab) as a read-only living taxonomy — enumerate live, never hardcode; the board decides approve/decline, staff only recommend.
- Verify-before-relying on the D26 allowlist: grep reviewer/invite/honorarium paths to confirm only dashboard visibility is gated on grant status.

Do not:
- Propose incremental cleanup to Finder/Manager, or design Workbench as a narrow reviewer-only surface.
- Re-flag `akoya_requeststatus` values as "unverified," or advance status early for D26 (use the manual request-number allowlist instead — advancing status fires PA triggers prematurely).
- Treat "Completed" as final payment authorization or as an email state. The
  approved 2026-09-04 design makes it a human PD closeout with a separate
  engagement-level honorarium-eligibility disposition; Operations/Finance still
  controls remittance. Completed rows remain visible.

Ground truth: `pages/workbench/[requestId].js`,
`docs/audits/AUDIT_REQUEST_WORKBENCH_TRUTH_2026-07-26.md`,
`docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`, and the per-surface source/Atlas
contracts. `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` and
`docs/REQUEST_WORKBENCH_SCOPING.md` are historical chronology/rationale.

History: dated release checkpoints (2026-07-29 → 2026-09-02), the S194–S206 decision chronology, the locked landing-dashboard and Workbench-v1 slice definitions, and the build sequence moved to [[project-reviewer-apps-redesign-history]] (closed) on 2026-09-17; nothing was deleted.

## Current source-backed state (verified 2026-08-31)

- Nine top-level tabs are implemented in Production, with zero placeholders.
  The former Pre-Site/Site
  Visit pair now presents as the unified Staff Deliberations workspace, and
  Final Writeup is a readiness-gated same-item handoff/workspace rather than a
  placeholder. **[PRODUCTION-LIVE 2026-08-17 / PROVED 2026-08-21]** Pre-Site
  and Site Visit have durable registry-backed route/UI evidence on Request
  `1002379`. **[PRODUCTION-PROVED 2026-08-30 PT / 2026-08-31 UTC]** Request
  `1002788` created one current Ready/Review Final row while retaining the
  current Pre-Site pointer and exact SharePoint item/version/hash/size; explicit
  group-review actor/time was read back and no new file was created.
  **[PRODUCTION-PROVED, FIRST ACKNOWLEDGEMENT READ BACK 2026-08-31]** The ordinary-staff Final Writeups
  dashboard and focused-review foundation now provide a bounded cross-request
  queue, responsible-PD stewardship rows, reviewed history/freshness state,
  positive initials, and separate **Open review** / **Open in Word** actions.
  The server caps and batches its reads and derives relationships/actions; it
  does not infer PC/leadership personas or broaden supporting-material access.
  **[PRODUCTION-LIVE + SIGNED-IN READ SMOKE PASSED 2026-08-31]** commit
  `52575761` and Ready deployment `dpl_Frc6fAonyFFYwiWyFJCzzE3UNune` ship the
  full neutral current-Final × exact reviewer-role matrix with direct
  review/Word links. Signed-in Production DOM proof showed the exact 11-person
  roster and Request `1002788`, with Duncan Spore Reviewed, Justin Gallivan
  Responsible PD, all other cells Not reviewed, both direct actions, and zero
  browser-console errors.
  Focused responses receive no matrix; configured PCs now receive it on the
  index alongside superusers. PR #140 merge `ce229778` is Ready in deployment
  `dpl_P7xay61LHnxohad9FEtSniBAosuY`; Wave 23 Production readiness is exact
  `on` in Ready deployment `dpl_B9k3AprnYp5ExpkqpT3dUxCUZqWo`. Signed-in
  dashboard and Request `1002788` Final reads passed with zero reviews and
  correct responsible-PD exclusion. An eligible colleague's first POST then
  reached Dataverse but failed on missing acknowledgement Create; the no-fallback
  reread confirmed no partial row. The tracked dedicated reviewer role is now
  directly assigned and its six requested Global privileges are effective for
  all 11 confirmed audience members. The colleague's post-role retry succeeded,
  appeared in review history, and independent readback proved exactly one
  complete acknowledgement row for Request `1002788`. The version-2 staffing
  configuration is migrated/read back; representative PC and Leadership Word
  access was proved 2026-09-03. Commit `213f6c34` then enabled persona lenses in
  Ready Production deployment `dpl_HGrbWUNPJMJunVevYLVEmtn7He6a`, and the
  six-case read-only production-data smoke passed. [OWNER-REPORTED 2026-09-04]
  Duncan Spore then completed the signed-in non-superuser History/matrix/Word
  observation on Request `1002788`.
  **[PRODUCTION-LIVE + SIGNED-IN READ/WRITE PROVED 2026-08-31]** Role
  eligibility is not the same as per-program matrix assignment. Commit
  `5573bca3` is live in Ready Production deployment
  `dpl_5DNuc2BV76RihwuWu8ZFYBgxBXE7`. The published Research audience contains
  nine current reviewer-role members and excludes owner-confirmed Southern
  California staff Anneli Stone and Saskia Pallais. Signed-in Admin
  publication/readback survived a full reload; Request `1002788` then rendered
  under Research with exactly those nine reviewer columns and zero
  application-console errors. Later signed-in Production readback from the
  v2-capable deployment proved the stored v1 setting also contained a six-person
  Southern California audience. The 2026-09-01 UTC migration preserved that
  audience and Research exactly in v2 at ETag `W/"96944113"`. The Admin editor stores stable broad Grant
  Program GUID → reviewer GUID audiences, resolves names live, rejects stale
  publishes through Dataverse ETag/`If-Match`, and makes unconfigured programs
  explicit while stale references fail closed.
  Initial Assessment production
  registry/pointer schema, governed prompt v1, and application are live and
  verified; Request `1002788` preserves mechanics-only historical evidence,
  while Request `1003109` proves canonical-input generation, linked-run
  lineage, exact reuse, and interrupted-finalization recovery in production.
- Reviews is built and production-proved: governed-v3 structured output
  persisted successfully, the automatic all-in drain is enabled, and its
  producer/persistence/consumer lifecycle completed a controlled production
  smoke on request `1002788`.
- Awardee includes the distinct live `/external/grantee/[token]` portal and
  `wmkf_granteedeliverable` persistence. GAL-trigger automation remains separate/unknown.
- The proposed writeup URL fields and `writeup.*` prompt rows remain absent.
  Their June design is historical input; the implemented pilot instead uses
  the production-provisioned `wmkf_requestdocument` registry and governed
  `initial-assessment.generate` v1. The controlled production rehearsal created
  one Ready/Draft registry row, populated the request pointer, and proved both
  consumers plus same-input retry, but used an old Phase I proposal and did not
  prove approved-input semantics. It also exposed whole-package hash drift
  after SharePoint canonicalization and a null AI-run request lookup. The
  deployed runtime fixes both for future generations. Request `1003109`
  production-proved the canonical input, non-null AI-run request lookup, and
  interrupted-finalization recovery using the same row/run/SharePoint item and
  version.
- Reviewer Pool remains planned and optional, not a shipped Workbench-v1 deliverable.


## Architecture (locked S195)

**Three tiers, per-request as the spine:**

- **Global / cross-cycle:** app launcher survives for Reviewer Pool, Dynamics Explorer, Dataverse Power Tools, Expense Reporter, Literature Analyzer standalone, Grant Reporting (post-award), Admin. Standalone forms of `phase-ii-writeup` / `peer-review-summarizer` / etc. stay around for ad-hoc / off-cycle / training use.
- **Cycle-scoped:** PD landing dashboard (request queue, by cycle + scope + `isActionableForPD`). Future home of the long-list → short-list triage surface ([[project-staged-review-pipeline]]).
- **Per-request: the Request Workbench.** URL `/workbench/[requestId]/...`. Per-request operations become tabs/affordances: proposal viewer, initial writeup, reviewer-lifecycle, returned reviews + summarizer, pre/post-site-visit writeups, site visit notes. **(S206 pared the tab set:** screening — integrity / expertise / funding-gap — is backend-automated and lives in the Tools menu, not as a per-request tab; Virtual Review Panel likewise moved to Tools, labeled beta. See the S206 decisions block above.)

**The Workbench is a display + refinement surface, not a console.** Backend automation tier (event-driven: `proposal-submitted`, `phase-advanced`, `review-submitted`, etc.) materializes artifacts; the Workbench reads state and lets the PD intervene where judgment matters. PD-triggered regenerate is exception, not default.

**This unifies several initiatives that were sitting separate in memory:** [[project-backend-automation]], [[project-staged-review-pipeline]], [[project-proposal-context-extraction]], [[project-prompt-storage-strategy]], [[project-new-ai-capabilities]]. They are the **automation tier** feeding the Workbench, not separate projects.

**The two-stage submission *process* is sunsetting** ([[project-grant-phasing-evolution]]): D26 (the current cycle) is the last cohort with a *separate* Phase I → Phase II submission; single-submission begins J27. Going forward there is **one submission, entered as Phase I**, with "Phase II" as an internal status flip (no Phase II uploads) — full materials arrive at the start; "long list → short list" winnowing still happens but on that one submission. **This simplifies the trigger model** — don't over-design dual-phase branching; build the pipeline for single-submission with internal staging labels.

---


Related: [[reviewer-identity-fragmentation]], [[project-reviewer-finder-dataverse-entry-path]], [[project-reviewer-institution-match]], [[project-w6-table-drop-closed]], [[project-app-roadmap-2026-04-25]], [[project-bill-honorarium-integration]], [[project-grant-phasing-evolution]], [[project-backend-automation]], [[project-staged-review-pipeline]], [[project-proposal-context-extraction]], [[project-prompt-storage-strategy]], [[project-dynamics-ai-writeback]].
