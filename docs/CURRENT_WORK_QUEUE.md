---
title: Current Work Queue
domain: architecture
kind: source-of-truth
status: canonical
summary: Canonical priority queue separating current commitments, evidence windows, optional work, external dependencies, and parked programs.
canonical: true
cataloged: 2026-07-22
last_verified: 2026-08-29
owner: product-engineering
related:
  - docs/SYSTEM_MODEL.md
  - docs/STRATEGY.md
  - docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md
  - docs/REVIEWER_TERMINAL_STATUS_AND_DUE_DATE_PLAN.md
  - docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md
  - docs/REVIEWER_IDENTITY_CONTACT_PLAN.md
  - docs/REVIEWER_WORKBENCH_NICE_TO_HAVES_PLAN.md
  - docs/audits/AUDIT_REQUEST_WORKBENCH_TRUTH_2026-07-26.md
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
---

# Current Work Queue

This document owns **work priority**, not runtime truth. Source, the Application State Atlas,
live probes, and current tests own what the system does. `docs/DOCS_CATALOG.md` inventories
documents; an `active` catalog status means the document remains useful, not that every task in
it is approved backlog.

## Current sequence

Work these items in order unless an operational incident or explicit owner decision changes the
sequence.

| Order | Work | Current boundary | Completion decision |
| --- | --- | --- | --- |
| 1 | Promote and verify durable Executor output budgets | **[SOURCE-BUILT 2026-08-29 on `codex/executor-budget-settings`; not yet Production-claimed.]** The superuser Admin editor publishes append-only `executor.budgets.vNNNNNN` Dataverse rows with optimistic versioning, UUID idempotency, model-ceiling checks, and reread verification. Pre-Site and review synthesis resolve the latest valid revision server-side; tracked values are bounds/fallback only. | Fresh adversarial review and all relevant gates pass; deliberately promote the Tier 1 branch; verify the Admin read surface after deployment. The first production publication is an explicit owner action, not required to prove fallback-safe deployment. |
| 2 | Close the remaining Initial Assessment pilot controls | **[VERIFIED IN SOURCE 2026-08-29]** Canonical artifact mechanics, exact-input reuse, interrupted-finalization recovery, substantive attributed editing, Graph-current metadata, native version restore, first-stage recovery, version limits, and second-stage recovery are proved. Purview retention and the Edit level's exact Delete flags remain owner-accepted-open absent a pressing need. Workbench administrator restore and milestone snapshots remain unbuilt. See `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` and `docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md`. | Workbench administrator restore and milestone snapshot controls are implemented and verified against the existing stable-item/version contract. |

## Audit follow-ups — verified open, not silently prioritized
- **Post-reviewer-cycle: promote the reviewer cron-reminders ledger slice.**
  **[OWNER-PARKED 2026-08-27 — merge only after the current reviewer cycle
  ends.]** Built and held on `feature/reviewer-cron-reminders-ledger`
  (commits `7c29fac7`..`059e51f9`; two Codex adversarial rounds' highs
  fixed). Promotion sequence and mid-cycle hazards (reminder outage without
  migration 038; posture freeze under un-onboarded PDs) are recorded in
  `SESSION_PROMPT.md` Parked item 2 and
  `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` items 7–10.
- **Post-reviewer-cycle: decide invitation-link strictness deliberately.**
  **[OWNER-FLAGGED 2026-08-26 — revisit when the current reviewer cycle
  ends.]** The unified `lib/utils/invitation-link-validator.js`
  (branch `feature/reviewer-invite-vip`, commit `ff156f3d`) deliberately
  KEEPS two long-tolerated send inputs that Codex's second-round rescue had
  tightened away: repeated IDENTICAL copies of the same reviewer JWT dedupe
  and send (only DISTINCT tokens fail as `external_link_ambiguous`), and
  trailing prose punctuation directly after a token is accepted (an
  extended/four-segment token is still rejected). Claude reverted the
  tightening mid-cycle because no probe could rule out live PD templates
  relying on those shapes. The open decision: once the cycle ends, either
  adopt the stricter exactly-one-occurrence contract (Codex's version) or
  ratify the current tolerance as permanent. The current behavior is pinned
  by `tests/unit/send-emails-service.test.js` ("S2: repeated identical
  copies") and `tests/unit/invitation-link-validator.test.js` ("token
  boundary"); flipping the contract means re-pinning those tests
  deliberately, plus a re-test of the invite send flow. Owner context: "I
  worry we will forget about it and have to test everything again in 6
  months" — this entry is the anti-forgetting mechanism.

- **Historical Workbench discovery:** **[PRODUCTION-LIVE 2026-08-17]** the
  Workbench dashboard now opens an exact active or historical
  request number through the existing authenticated `resolve-request` route;
  this does not change the active-cycle dashboard filter or request status.
  **[OWNER-DECIDED FUTURE WORK 2026-08-17; PLANNED]** add a broader historical
  locator/search by institution, PI, proposal title, cycle, and request status.
  Results should open the existing per-request Workbench rather than create a
  separate workflow/data silo. Pagination, query bounds, result fields, and
  exact authorization/search semantics must be designed before implementation.
  The existing Expertise Finder historical-proposals query already projects
  request number, title, institution, PI, cycle/program, and Phase I/II status,
  but it is guarded by a different app grant and loads a whole fiscal-year set;
  treat it as reusable design/source material, not as the Workbench endpoint.
- **Retired-table operational scripts:** 25 non-archive scripts mention the
  dropped `reviewer_suggestions` table. `scripts/README.md` now blocks the
  copy-pasteable commands, but code quarantine/removal requires an owner-approved
  scope and caller review.
- **Live-state reconciliation:** environment posture, mutable row counts, external
  automation, and genuine external-reviewer use remain probe-required. The
  repository-wide material-claim audit is partial reconciliation, not a clean
  bill of health.
- **Phantom co-PI — LINKS GONE (verified 2026-08-27, S464); importer fix
  still Connor's.** The full read-only co-PI census
  (`scripts/probe-placeholder-copi-census.js`, owner-run; 1,084 slot links +
  1,073 junction rows, 1,049 distinct contacts, pagination verified
  complete) found **0 remaining links** for the phantom contact
  `2a67a272-9eb5-f011-bbd3-6045bd0510d4` — all 14 recorded rows are gone,
  remediated CRM-side outside this repo (by whom is not recorded; the repo
  script was never `--execute`d). The former "floor, not a ceiling" caveat
  is CLOSED: zero other punctuation-placeholder contacts are linked as
  co-PI. Remaining (all CRM-side, none app-code): **Connor's akoyaGO
  importer fix** (recurrence prevention), the duplicate contact's fate
  (unprobed — census reads links only), and small residuals recorded in the
  incident record's 2026-08-27 update (8 empty-email contacts, 2
  trailing-dot typos, an `ab@ab.com` test contact on `1001931`, the
  1002788 test byline trio spread across five requests, one
  corrupted-email duplicate pair, and 18/8 cross-store drift rows).
  Full record: `outputs/phantom-copi-incident-2026-08-12.md` — **local-only
  since 2026-08-27** (untracked from the public repo because it names real
  people with personal emails; its 2026-08-12–2026-08-27 tracked history is
  queued in `docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md`).

## Completed in this execution

- Durable Executor-budget implementation: **[SOURCE-BUILT 2026-08-29;
  PROMOTION OPEN]** the former tracked-literal ownership is replaced by an
  append-only Dataverse `wmkf_appsystemsettings` publication contract and a
  superuser editor. The two runtime callers read the same resolved revision;
  code retains strict schema/ranges and the reviewed outage fallback. Focused
  service, route, caller, persistence, and UI tests cover invalid schemas,
  stale editors, idempotency, duplicate-key races, model ceilings, and both
  consumer behaviors. Production deployment and the first Admin-published
  revision are deliberately not claimed from source evidence.

- Curated Site Visit materials-recipient directory: **[PRODUCTION-LIVE AND
  OWNER-VERIFIED 2026-08-29]** superusers curate a maximum of 50 active staff
  and existing Dataverse Contact references (Consultant/Board) for the
  distribution-composer menu. The setting stores references/categories only;
  source records own names/email. Name search is read-only, uses one bounded
  51-row Dataverse probe, returns at most 50 candidates, and explicitly signals when
  more matches exist. Configured people are menu choices only and are never
  auto-added to drafts. Merge `c5efa770`; Ready Production deployment
  `dpl_dKmm19nMyX3w6RRjkLNJowiFqFU1`; owner verified the broad `smith` warning.

- Error-message and operational-event reliability: **[PRODUCTION-LIVE
  2026-08-29]** Graph document search now honors `Retry-After`, retries the
  transient 408/5xx/429 class, serializes same-round search scopes, and carries
  cooldown/breaker state. Admin Operational Events groups repeats and supports
  ABA-safe single/group resolution with truthful partial-success/current-filter
  feedback. PR #137 merge `1c153a35`; Vercel status succeeded.

- Staff Deliberations distribution-history UX: **[PRODUCTION-LIVE
  2026-08-29]** history groups by calendar day and marks self-addressed sends
  as `Test send`. Merge `90d0f10e`; Vercel status succeeded. The accompanying
  Final Writeup Review document is plan-only and remains owner-gated.

- Site Visit workspace handoff: **[PRODUCTION-PROVED 2026-08-21]** after the
  owner's exact approval, signed-in Request `1002379` transitioned its current
  Pre-Site Word workspace from Draft to Review. Site Visit and Pre-Site retained
  the same exact SharePoint Edit/Download URL and filename; a fresh authenticated
  GET returned **Site Visit in progress** with handoff time
  `8/21/2026, 5:22:36 PM`, and Pre-Site regeneration was locked. The service's
  success path includes a post-write reread that requires the exact publication
  version, governed hash, and milestone time to match. Supporting-file dossier,
  logistics, and Final remain separate later slices.

- Pre-Site durable-generation production proof: commit `abfe5529` reached Ready
  Vercel deployment `dpl_CF7ia9TYyT5ZU5hyv2TNWUYnPb3H`. Signed-in Request
  `1002379` created one Ready/Draft Request Document, one completed governed
  v3 AI run, one stable Word item, and the current request pointer from the
  narrative-only source. Exact Ready retry produced no duplicate; the exact
  four-page Word file passed visual QA. The initial long request completed on
  the server but displayed `Failed to fetch` in the browser. Commit `1ac01405`
  deployed read-only status loading/polling and template-v2 Recommendation
  padding. A later v2 generation created Ready artifact
  `76a0d4b2-8b9a-f111-b8db-7ced8d3d15a6` and exposed a width-sensitive Word
  Online Recommendation-label alignment defect. **[INFERRED FROM SCREENSHOT +
  OOXML WIDTH]** implicit wrapping was the remaining layout variable. Template
  v3 is deployed and locally verified with an explicit no-wrap label. Ready
  deployment `dpl_58hstAQNBP8ATqfBXtYczC9tFziE` also includes the compact
  Pre-Site action panel: hidden contextual help, Generate before a draft exists,
  and Edit, Download, and confirmation-guarded Regenerate actions when
  Ready/Draft. The signed-in Word Online v3 and compact-action/download smoke
  remain open. **[DEPLOYED TO PRODUCTION AND SIGNED-IN RECEIPT SMOKE PASSED
  2026-08-21]** commit `b3bb0ef6` first reached Production in Ready deployment
  `dpl_FkWu55fyBqSEo8q4DBcdcA3xvigi` and makes the promoted-state panel a
  read-only handoff receipt with one Site Visit continuation action; later and
  unknown lifecycle states also fail closed. After a hard reload of the
  previously open browser tab, signed-in Request `1002379` showed the receipt
  with no Pre-Site work controls; its one continuation action opened Site Visit,
  where the expected same Word item exposed Edit/Download and the recorded
  handoff time. No document or write action was invoked.

- Initial Assessment substantive human edit: Request `1003109`'s canonical
  SharePoint item advanced to version `2.0`, attributed to Justin Gallivan.
  Foundation Opportunity now contains staff-authored content and no
  `STAFF INPUT REQUIRED` marker. The per-request Workbench and D26 locator
  still open the same stable item. The edit also verified that the current
  Dataverse registry retains upload-time version `1.0` metadata. Response-only
  Graph-current refresh and consumer display are deployed and live-verified on
  Request `1003109` via deployment `dpl_HhiYXVFAtsGMwjU9UDcKz22AfvR2`;
  native version inspection/restore and first-stage recycle recovery also
  passed in the production Request library. Library limit (500 majors, no age
  limit) and second-stage recycle presence are now closed via administrator
  evidence (2026-08-10 / 2026-08-20); retention and the Edit level's Delete
  flags stay owner-accepted-open, while Workbench history/admin-restore and
  milestone controls remain in the open library/readback gate.

- Initial Assessment interrupted-finalization recovery: Request `1003109`
  was staged as Failed after its SharePoint upload and retried through the
  signed-in Workbench. Recovery restored the same registry row and request
  pointer while preserving the single AI run and SharePoint item/version;
  attempt count advanced to `2`, with no second model call, upload, overwrite,
  duplicate, or cleanup work. Runtime logs again used the service-principal
  fallback for Dataverse registry writes. The owner accepts application
  attribution for system-generated registry changes; native SharePoint
  version attribution remains the required human-edit audit surface.

- Initial Assessment controlled-production rehearsal: Request `1002788`
  generated registry row `fb995f0f-628c-f111-ab0f-6045bd018a07`, the matching
  request pointer, completed AI run
  `b7ae9b17-628c-f111-ab0f-000d3a31c468`, and canonical SharePoint item
  `01G4GVMS77A2SBVPGA4VFINZFWAFIZGVFG`. Both Workbench consumers opened the
  same item, and a same-input retry preserved the one row/run/item with no new
  attempt. This is valid mechanics evidence only: the loaded document was an
  old Phase I proposal, so the generated content is not valid Phase II
  semantic evidence. The rehearsal also exposed the recovery hash mismatch and
  null AI-run request lookup recorded in
  [the pilot report](INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md).

- Review-synthesis lifecycle rollout: signed-in read-only verification passed;
  Production automation was deliberately enabled; and the controlled Request
  `1002788` smoke completed job `2`, maintenance run `27723`, and prompt-v3 AI
  run `1b882cf6-bf8a-f111-ab0f-7ced8d3d15a6` in one claim. Exact cleanup
  removed 11 temporary answers, restored four parent fields, left no draft, and
  returned the census to 157 participant rows / 25 requests / zero eligible.
  PR #98 fixed the automatic run-source defect found before the first attempt's
  LLM boundary; PR #99 moved claimed-job readiness revalidation before content
  loading. Final deployment `dpl_FdUJSjNwhbNWKWVzpyymiB2mpJo1` is Ready with
  automation enabled; the post-deploy zero-eligible drain was clean.
- Auth-status policy reconciliation: `/api/auth/status` remains intentionally
  public with the exact `{ enabled: boolean }` shape, but now delegates to the
  same fail-closed `isAuthRequired()` policy used by the proxy and API guards.
  Production-mode misconfiguration therefore reports enforcement enabled; the
  explicit emergency bypass must permit the base kill-switch/configuration
  predicate before the endpoint reports disabled. The endpoint policy matrix
  is covered by a focused regression suite.
- Review-synthesis reliability implementation and deployment: the Executor now parses
  complete normalized text, requires `end_turn` before persistence, preserves
  safe stop/token/hash diagnostics on failure, and capability-gates native JSON
  schema. Review synthesis retries only a confirmed `max_tokens` result once,
  at a bounded larger budget; each invocation remains separately audited.
  Focused and surrounding Executor/service suites passed 102 tests, and the
  model-registry gate plus self-test passed. The code merged through PR #92 as
  `ab1d2943` and reached a Ready production deployment on 2026-07-28.
  Governed prompt v3
  (`660d7e3f-9e8a-f111-ab0f-000d3a31c468`) was then published through the
  version-preserving seed recovery path and verified as the sole current row
  with exact tracked system/body/variables/schema/model/settings. The
  2026-07-28 controlled Request `1002788` smoke completed on the first semantic
  attempt (`end_turn`), persisted a valid synthesis, and wrote completed AI run
  `20aec518-9f8a-f111-ab0f-6045bd018deb` against prompt version 3. The 11
  synthetic answers and four staged parent fields were atomically restored;
  the new synthesis and append-only audit remain as the intended proof.
  Independent follow-up review returned READY after the requested local changes.
- Production review-synthesis smoke: the owner-authorized Request `1002788`
  smoke ran once on 2026-07-27 after a reversible staff Manual Review Entry.
  It reproduced the current-v2 incomplete-JSON failure as HTTP 500 and failed
  AI run `be61f383-f289-f111-ab0f-70a8a59cded0`. The original 1,709-character
  memo retained SHA-256 `a91f05cc0a20cad72341db9d7fc5fe808ed3b28610a35dfdaca82d69beebbcba`
  and its prior modified timestamp; no partial synthesis write occurred. The
  11 synthetic answers and four staged parent fields were atomically restored,
  with no draft and no changes to other target/sibling email, reminder,
  materials, or thank-you state. The append-only failed audit row remains.
  This bounded failure supplied the diagnosis baseline for the successful
  governed-v3 proof recorded immediately above.
- Evidence-first sweep correction and bounded Workbench truth pass: the sweep now derives truth before
  searching prose, supports domain audits, requires producer→persistence→consumer evidence, and
  records supported/falsified claims. The scalar fact gate now derives Workbench tab counts and
  cannot be bypassed with Markdown-bold/code-wrapped numbers. That pass retired the stale forward
  roadmap and established the six-live/four-placeholder state, but it did not fully reconcile the
  Reviewer/Reviews corpus; the 2026-07-26 [repository-wide material-claim
  audit](audits/AUDIT_FULL_DOCUMENTATION_TRUTH_2026-07-26.md) records the
  remaining contradictions and probe requirements.
- Documentation ground-truth reconciliation: merged to `main` on 2026-07-22; this queue is the
  priority authority and the documentation gates were green.
- Dataverse target/write interlock: positive warn-mode production observation, explicit owner
  approval, staged local/Preview/Production flip, and signed-in post-flip Workbench smoke completed
  2026-07-22. Production logged `mode=on deployment=production target=production` and no denial.
- Structured staff review-entry rescue: complete live-question/rich-text UI, dedicated authenticated
  route/service, canonical full-review producer, ETag/version guards, and atomic parent/answer writes
  shipped through PR #75 / merge `0226f7eb` to production deployment
  `dpl_BjkM3tjopMpRWPMwn3NRgtB4CHSU` on 2026-07-22. All PR checks passed; Vercel reported Ready,
  the unauthenticated route smoke redirected to sign-in, and the post-deploy error scan was clean.
- Reviewer terminal statuses: `withdrew` and `released` shipped through PR #78 plus the accepted/null
  repair in PR #79 / merge `fd610837` on 2026-07-24. Production Dataverse and Workbench readback
  verified `Withdrew`, token revoked, accepted preserved, and no review-received/completed timestamp.
  That is the historical production baseline. Merge `70f51f45`, production-live in deployment
  `dpl_9r2FYkAXhRqSXiJVCwevrXFZ5SzH` on 2026-07-24, changes PD-recorded `Withdrew`
  to the full withdrawal contract: accepted false, declined true, token revoked, exact linked
  honorarium deleted, and acceptance follow-up cancelled. Deadline evidence and completed-review
  payability remain separate.

## Reviewer redesign gates

The reviewer redesign is an active **measured program**, not authorization for continuous tuning.

- W2 `combined` mode remains owner-gated. Shadow output never changes the authoritative result.
- Wave 13 action-policy reader/backfill/send enforcement remains a separate migration.
- The applicant-neighborhood finding arm remains evaluation-only under `scripts/`; production
  assignment and attribution require an explicit pilot decision.
- Do not delete legacy readers, Track B, or old heuristics until the applicable promotion decision
  and one complete campaign of observation.

## External or dependency-bound work

These are valid directions but are not current app-team delivery commitments:

- Power Automate Executor parity and status-driven backend automation — Connor-owned and dependent
  on grant-cycle sequencing. The 2026-07-27 production metadata probe found no
  deployed prompt-Executor flow among the 114 visible cloud-flow definitions;
  this is planned external work, not an active production pipeline.
- Power Automate-backed writeup automation remains dependency-bound. The former Group B document
  is historical; the app-side writeup contract must be redesigned from current fields, prompts,
  inputs, and deadlines before any build.
- Proposal-context extraction and staged-pipeline evolution — later-cycle work, not part of the
  current reviewer campaign.
- Excluded-reviewers structured intake (`docs/EXCLUDED_REVIEWERS_STRUCTURED_INTAKE_PLAN.md`,
  S398) — schema contract drafted; repo-side Phases A/B (Dataverse wave + backend consumption)
  are buildable on owner go, but final field names and the form work wait on the Justin×Connor
  reconciliation meeting (agenda in the plan §6).

## Parked — do not resurface without a new decision

- Applicant intake product build — parked while WMKF evaluates the GOApply
  re-engineering. The narrow request-scoped Site Visit Materials Upload planned
  as part of the Workbench lifecycle does not reopen the general intake
  product.
- Automated BILL onboarding — tabled, possibly permanently; honorarium payment remains an offline
  operations process.
- Whack-a-mole remediation workstreams — independent review returned `NEEDS REWORK`; owner
  reconciliation is required before execution.
- Reviewer institution-to-CRM linking/typeahead — parked pending Connor/Sarah account cleanup.
- Destructive reviewer cleanup — gated by promotion plus one full campaign.

## Completed implementation records — not backlog

Plans describing the Workbench build, Postgres-to-Dataverse reviewer migration, staff-editable
review questions, reviewer search timeout controls, service decompositions, route/service
consolidation, OData/chunk consolidation, prompt migrations, grantee portal construction, and
honorarium portal construction are implementation history or current operating references. They do
not become current work merely because their document status remains `active`.

## Queue maintenance rule

When priority changes, update this file, `docs/STRATEGY.md`, the strategy wiki router, and the
current `SESSION_PROMPT.md` in the same reconciliation pass. Detailed implementation plans may
remain where they are; link them from the queue instead of duplicating their contracts here.
