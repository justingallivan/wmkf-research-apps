---
agent_wiki: topic
status: active
last_verified: 2026-07-28
stale_after_days: 90
owner: product-strategy
source_files:
  - docs/CURRENT_WORK_QUEUE.md
  - docs/SYSTEM_MODEL.md
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - DEVELOPMENT_LOG.md
  - SESSION_PROMPT.md
  - docs/GROUP_B_WRITEUP_SPINE_DESIGN.md
  - docs/audits/AUDIT_REQUEST_WORKBENCH_TRUTH_2026-07-26.md
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
canonical_docs:
  - docs/CURRENT_WORK_QUEUE.md
  - docs/SYSTEM_MODEL.md
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - DEVELOPMENT_LOG.md
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
watch_paths:
  - docs/CURRENT_WORK_QUEUE.md
  - docs/SYSTEM_MODEL.md
  - DEVELOPMENT_LOG.md
  - SESSION_PROMPT.md
  - docs/**/*ROADMAP*.md
  - docs/GROUP_B_WRITEUP_SPINE_DESIGN.md
update_triggers:
  - roadmap or phasing changes
  - cross-capability architecture changes
  - backend automation/post-award planning changes
---

# Strategy & Roadmap

Use this page for system model, roadmap, grant-cycle phasing, planned review
pipeline/proposal extracts, backend automation, interim reports, post-award work,
and broad AI capability planning.

Start with `docs/CURRENT_WORK_QUEUE.md` for ordered commitments. The catalog is a
document inventory, and individual implementation plans do not establish priority.

## Durable Memory

- Current priorities: `docs/CURRENT_WORK_QUEUE.md`.
- Current Workbench truth and contradictions:
  `docs/audits/AUDIT_REQUEST_WORKBENCH_TRUTH_2026-07-26.md`.
- Current near-term sequence: synthesis lifecycle closure → remaining-tab
  design freeze → first deadline-bound writeup slice. The 2026-07-27 Request
  `1002788` v2 smoke closed by its bounded-failure alternative; governed v3
  then became sole-current and the 2026-07-28 post-fix smoke persisted valid
  synthesis with complete audit evidence and exact synthetic-review cleanup. See
  `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`.
- Writeup artifact direction (owner-decided 2026-07-28): SharePoint Word is the
  canonical editable narrative; Dataverse is the typed document
  registry/workflow/structured-decision authority; Microsoft Search supplies
  body search; version recovery, retention, least-privilege editing, and frozen
  Board milestones are required parts of the design. Initial Assessment,
  Pre-Site, and Final are three distinct documents; Final is copied from a
  selected Pre-Site version. Exact schema and target-library configuration
  remain planned/unverified. See `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` and
  the near-term plan.
- Pre-Site input direction (owner-decided 2026-07-28): draft factual material
  from the full proposal through an iterated governed `phase-ii.summarize`;
  supply authoritative request metadata from Dataverse; use
  `review-synthesis.generate` over all currently submitted reviews; and allow
  distribution with zero reviews because the Site Visit date controls timing.
  Late reviews regenerate only the synthesis and mark the review-derived
  section stale; they do not silently replace staff-edited Word prose or
  regenerate the factual core. Use a versioned prompt/template pair based
  initially on the supplied examples. The new pipeline is planned:
  `phase-ii.summarize` currently drives no route, while the legacy retained
  PDF route still uses `createSummarizationPrompt()`.
- Site Visit direction (owner-decided 2026-07-28): the tab is a dossier, not a
  fourth writeup. Its logistics are date, time/time zone, format,
  location/link, lead PD, WMKF staff, applicant participants, and
  Board/consultant participants; no separate visit-status field is needed.
  Its categories are applicant slides, other applicant materials, recording,
  transcript, transcript summary, and one paste-friendly staff-observations
  area without per-entry timestamps. Do not add a general material-revision
  workflow absent observed need, but the applicant surface explicitly supports
  recoverable delete/replace rather than inferring replacement from duplicate
  files. Pre-Site distributions and Final remain linked writeups, not material
  categories. A narrow expiring applicant-material upload link is in scope
  without reopening the parked general intake product; it accepts PDF/PPTX and
  additional uploads while active, and successful changes notify the lead PD
  plus other designated staff. An authorized staff user manually triggers the
  request; a visit-date change never sends it automatically. Recipient choices
  are the Dataverse-linked liaison and PI—normally liaison in To, or PI in To
  with liaison optionally copied. To and CC share one request-scoped link and
  may manage the same file list; without sign-in or personalized links, the
  audit does not promise PI-versus-liaison attribution. Visits are scheduled
  promptly after advancement around reviewer invitations; once the date is
  recorded, staff may send without waiting for reviews, synthesis, or a
  Pre-Site Writeup. Exact requester roles, sender identity, expiry, shared-link
  audit disclosure, limits, and notification audience remain open. Prefer an
  acceptable
  transcription-platform summary before a deliberate suite LLM fallback.
  Exact token, schema/read model, validation, folder, retention,
  summary-quality, and partial-failure contracts remain planned.
- Editor Dashboard direction (owner-confirmed 2026-07-28): preserve Allison's
  former single-folder editing workflow with a cycle-wide list of governed
  writeups, direct Open in Word, and an explicit per-editor Reviewed tracker.
  It reuses the typed registry and canonical SharePoint file; it is not a
  second editor. Exact collaborator audience, marker granularity, coordinator
  view, access key, and delivery date remain open. See the near-term plan.
- Strategy/system model: `project-system-model`, `project-strategy-direction`.
- Virtual Review Panel: `project-virtual-review-panel`.
- Roadmap snapshots: `project-app-roadmap-2026-04-25`, `project-phase-i-summary-app-winddown`.
- Phasing/cycle scoping: `project-grant-phasing-evolution`, `feedback-cycle-vs-executor-scope`, `feedback-concepts-vs-phase-i`.
- J27 document-capture & Proposal-tab evolution (document identity/metadata →
  typed Dataverse registry; file bytes and editable narrative remain in
  SharePoint; D26 filename-match is interim; near-term planning):
  `project-j27-doc-capture-evolution`.
- Historical Group B writeup proposal: `docs/GROUP_B_WRITEUP_SPINE_DESIGN.md`. Its proposed
  URL fields and `writeup.*` prompt rows are not live, and its D26 pilot timing is obsolete.
- Planned review/proposal work: `project-staged-review-pipeline`, `project-proposal-context-extraction`.
- Planned automation/reports/post-award/AI: `project-backend-automation`, `project-interim-report-automation`, `project-awardee-onboarding`, `project-new-ai-capabilities`.
- IRS verify-EIN: `project-irs-exempt-verification`.

## Standard Probe

```bash
rg -n "roadmap|phase|cycle|interim|post-award|proposal extract|review pipeline|EIN" docs .claude-memory SESSION_PROMPT.md DEVELOPMENT_LOG.md
```
