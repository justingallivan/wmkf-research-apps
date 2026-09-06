---
title: Current Work Queue
domain: architecture
kind: source-of-truth
status: canonical
summary: Canonical priority queue separating current commitments, evidence windows, optional work, external dependencies, and parked programs.
canonical: true
cataloged: 2026-07-22
last_verified: 2026-09-06
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
| 1 | Final Writeup acknowledgement infrastructure and dashboard data foundation | **[FOUNDATION COMPLETE 2026-08-31.]** Slice 1 is Production-proved. Wave 23 is exact/Active, and Production acknowledgement readiness is exact `on` in Ready deployment `dpl_B9k3AprnYp5ExpkqpT3dUxCUZqWo` (Preview remains unset). The signed-in ordinary-staff dashboard and Request `1002788` Final tab loaded, retained the external Word action, and correctly omitted responsible-PD self-review. After the dedicated reviewer role became effective for all 11 audience members, an eligible colleague successfully marked the Final reviewed and saw it in review history; independent readback proved exactly one complete acknowledgement row. No PC/leadership persona or broader supporting-material projection is inferred. | **Met:** acknowledgement persistence and the superuser-testable dashboard data path are in place with exact identity/version keys, focused tests, and one successful cross-user Production acknowledgement/readback. |
| 2 | Release template-backed review DOCX outputs | **[PRODUCTION-LIVE + SIGNED-IN EXPORT PROVED 2026-09-03.]** `main` commit `3101f067` is live in Ready deployment `dpl_AjT5FeDh5wkdeFSoZWJsVDM5oBqs`; Wave 25 `wmkf_questionoptions` is exact. The approved scope keeps the combined Reviews-tab action as an on-demand, server-authoritative download and makes the individual review a template-backed courtesy attachment; this phase performs no SharePoint upload. Request `1002903` generated a valid 60,586-byte DOCX with the **Aggregated Proposal Reviews** title, successful 2xx Dataverse dependencies, and no post-deploy error logs. Historical rows retain the explicit selected-only fallback. The courtesy path is deployed and source/test/render verified but was not email-send smoked. | **Met:** reviewed promotion, Ready deployment, exact schema, and signed-in combined-export verification are complete. |
| 3 | Retain structured individual review DOCX files in SharePoint and backfill D26 | **[WAVES 1–5 COMPLETE; NATURAL FILING PROVED 2026-09-04 UTC.]** The v4 text-table templates, request-level `Reviews/Review-<request>-<reviewer name>.docx` target, guarded repair service, and exact D26 backfill are Production-proved. Exact manifest `9254df9e5e504c79007391efc85d189e89e8b8b2ff80b8e4f11990baca08f4f8` executed 22 created / zero failed; row-by-row reconciliation matched every expected identity, destination, governed hash, and unique SharePoint item. Production has exact `REVIEW_DOCX_SHAREPOINT_WRITE=on` and `REVIEW_DOCX_SHAREPOINT_CYCLE=D26`; activation deployment `dpl_E6VKW5Wi8zDTfU1ZRhNsbH9yg9oM` and the test-row disposition/legacy cleanup are proved. Production maintenance run `70820` then naturally processed Manuel Müller's newly received review on Request `1002959`, created `Reviews/Review-1002959-Manuel Müller.docx` (SharePoint version `1.0`, 43,498 bytes), and completed without error; Dataverse independently holds the matching complete pointer. | **Met:** backfill, activation boundary, test-row disposition, legacy cleanup, and the natural automatic create/pointer path are all proved. |
| 4 | Final Writeup persona rollout and complete dashboards | **[PERSONA LENSES PRODUCTION-LIVE; NATURAL STAFF OBSERVATION COMPLETE 2026-09-04 PT.]** Commit `213f6c34` is live in Ready deployment `dpl_HGrbWUNPJMJunVevYLVEmtn7He6a`; the tracked source flag is true. Read-only production-data smoke verified PD, PC, Leadership, overlap, ineligible/unassigned, and superuser projections. **[OWNER-REPORTED]** President Allison Keller and Program Coordinators Duncan Spore and Sarah Hibler proved canonical Word access and acknowledgement; Duncan later found Request `1002788` in History, saw the review matrix, and opened the Word document successfully. Duncan, Allison, and Sarah initially appeared Reviewed and later Updated, consistent with publication-version freshness. No team exists or is required. | **Met:** runtime projection, representative Word access, and signed-in non-superuser History/matrix/Word observation are complete. PC backup transitions, Leadership stage transitions, and any broader supporting-material projection remain separate implementation decisions. |
| 5 | Automated materials-on-acceptance email (reviewer lifecycle) | **[OWNER-DIRECTED 2026-09-06; NOT STARTED; PLAN-FIRST.]** Desired December 2026 (D26) flow: every review material the reviewer needs is in hand at the time of the request to review, and upon acceptance **and** onboarding the system automatically emails the reviewer a link to the review materials (the proposal) with no PD action. Nothing does this today [VERIFIED S490: the acceptance job/drain handles honorarium onboarding and bookkeeping only; materials go out solely through the PD-driven `ReleaseMaterialsModal` → send-emails `materials` template]. Build when the current campaigns settle; the plan must exist before D26 invitations go out. Plan-first triggers (`/contract-reconcile`): new background/durable work in the acceptance drain, a live email send, idempotency across drain retries (never two materials emails), the "materials in hand" precondition the drain can verify, accept-before-materials-attached handling, the PD's visibility/override, and how the manual modal becomes the fallback. No preview step, so the 6D draft fingerprint does not apply; render and send are one server step. | Production-live automated send observed on the first real D26 acceptance, recorded in the Stage 6B3 receipt; the manual modal documented as the exception path. |

## Audit follow-ups — verified open, not silently prioritized
- **Public/onboarding reviewer-token documentation reconciliation.**
  **[OWNER-DEFERRED 2026-09-01.]** Internal operating sources now reflect the
  production incident remediation: review-due reminders are link-free and
  preserve token authority, manual reminders have resumed, and the automatic
  schedule remains held. Public/onboarding artifacts were intentionally left
  untouched during the emergency response. Before their next publication,
  audit `docs/onboarding/` and any generated public help/decks for stale claims
  about reminder token rotation, manual-send freezes, or scheduler operation;
  update the source generators first, regenerate outputs, and verify that no
  credential/runbook material becomes public accidentally.
- **Request Document explicit actor tracking (Option B).**
  **[OWNER-APPROVED 2026-08-31; ADVERSARIAL REVIEWED; PRODUCTION-PROVED FOR
  PRE-SITE CREATION.]** Keep Request Document CRUD off staff roles and
  retain service-principal writes while adding explicit, authenticated
  actor/time persistence. The focused plan is
  `docs/REQUEST_DOCUMENT_EXPLICIT_ACTOR_PLAN.md`: it proposes immutable
  row-origin actor/time fields, an explicit Site Visit milestone actor, reuse
  of the existing Final fields and distribution ledger, and no invented
  historical backfill. The read-only Claude review returned APPROVE WITH
  CONDITIONS; source reconciliation accepted its corrections. The owner
  selected the current-posture missing-identity policy: existing strict flows
  stay strict, while Initial Assessment, Pre-Site, and Site Visit retain
  availability with honest null attribution plus durable operational evidence.
  The 2026-08-27 Connor broad staff-role brief was never sent and is withdrawn.
  A confirmation-only question is scheduled for Monday
  2026-09-07 to identify any compliance,
  audit, report, view, flow, business rule, or plug-in that specifically
  depends on built-in `createdby`/`modifiedby`; absent such a consumer, Connor
  has no action. Do not modify the existing Final Writeup Reviewer role. The
  approved creation-only Production apply completed 2026-08-31 with independent
  readback at 3 exact / 0 absent / 0 divergent. The Production-only readiness
  flag is exact `on`; commit `8ff4205a0ad43337cd987a4fc76639f936bab4bc`
  first reached Ready deployment `dpl_D94J9aRcfLfK81iBDsVYARVhZFPb`, signed-in
  health passed. Naturally generated Request `1002874` then proved a Ready/Draft
  Pre-Site row with explicit Justin Gallivan origin actor/time, application
  built-in creator, exact current pointer, and no missing-attribution event.
  The deployment-boundary census is 1 attributed / 0 event-backed unattributed /
  0 violations. Treat Site Visit milestone attribution and other producer-first
  writes as opportunistic path-specific proof; do not block the Final dashboard
  or manufacture records.
- **Pre-J27 scale: Initial Assessment Production write proof.**
  **[OWNER-DEFERRED 2026-08-30.]** Restore and exact byte-copy Board snapshot
  controls are deployed and the signed-in Request `1003109` read surface passed.
  The owner explicitly chose a good stopping point rather than manufacturing
  Production evidence. Before J27 scale—or earlier only under a new explicit
  authorization—choose an agreed dummy request, run Board snapshot first if
  only one proof is needed, and capture SharePoint/Dataverse readback plus
  cleanup state. Restore retains the documented final-call concurrency race.
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

- Review DOCX template implementation: **[PRODUCTION-LIVE + SIGNED-IN EXPORT
  PROVED 2026-09-03]** approved individual/combined templates, strict OOXML renderer,
  server-authoritative combined export route, thank-you courtesy attachment,
  and full categorical option snapshots are implemented with focused tests and
  rendered-page QA. Production Wave 25 was applied and read back exact; the
  six-commit release passed 306 affected-workflow tests, relevant gates and
  self-tests, TypeScript, lint with zero errors, production build, and template
  bundle-trace checks, then reached Ready at `3101f067` /
  `dpl_AjT5FeDh5wkdeFSoZWJsVDM5oBqs`. Signed-in Request `1002903` generated a
  valid 60,586-byte aggregated DOCX; focused route dependencies were 2xx and the
  post-deploy error scan was empty. The courtesy-email path was not sent during
  smoke. The later Wave 2 retention release deployed a separate guarded
  SharePoint filing/repair route at `3ba2a6ad` /
  `dpl_22wUzC1cCi4nhKTSFQftfaycucSh`. Wave 5 later activated that hourly route
  for exact D26 in Ready deployment `dpl_E6VKW5Wi8zDTfU1ZRhNsbH9yg9oM`.
  The first authenticated enabled sweep attempted no filing, made no document or
  pointer mutation, and surfaced only known test Request `1003223` as
  `invalid_snapshot`; its bounded error scan was empty. That test suggestion was
  subsequently changed only to `wmkf_selected=false` under its current ETag,
  preserving the received-review history; the immediate enabled follow-up
  returned zero candidates and zero attempts. The Wave 3 backfill is
  source-built, focused-test verified, and adversarially reviewed with the
  accepted hardening incorporated. Its first Production read-only manifest
  found one owner-confirmed test request; the replacement schema-v2 manifest
  records that explicit exclusion and is clean for 23 eligible rows. The owner
  selected Request `1002874` / Agnes Karasik for the one-file proof and
  explicitly approved its exact scoped manifest. The create-only SharePoint
  upload, Dataverse pointer commit, and independent semantic readback passed;
  the owner confirmed the Workbench download succeeds. The retained file then
  exposed the tab-positioned first-page title defect in Word for the web. The
  branch carries the no-tab compatibility fix, and its replacement read-only
  manifest contains 22 remaining eligible rows plus the visible test exclusion.
  The exact path repair and subsequent v3/v4 same-item content repairs are
  complete and independently verified, with prior SharePoint versions retained.
  The separate old legacy-path item was later owner-deleted after read-only
  Graph and Dataverse verification. The owner-requested repeat generation/upload
  advanced the stable item to version `4.0`, with exact v4 readback and versions
  `1.0`–`3.0` retained. The owner visually confirmed version `4.0` in Word
  Online and approved the v4 header. The fresh v4 population manifest contains
  22 eligible missing files and no blockers. The exact approved manifest then
  completed 22 created / zero failed, every result reconciled to the reviewed
  identity/destination/hash, and a fresh post-write survey found no eligible or
  reconcile rows and no blockers. Old-file cleanup and scheduled activation
  remain separately gated, not part of this completed template-output item.

- Reviewer Follow-up organization-wide cycle visibility and server authorization:
  **[PRODUCTION-LIVE + AUTHENTICATED READ PROOF 2026-09-02]** Runtime merge
  `acf40fb85a36ab2d481869c706a069abea52c087` ships the shared lifecycle
  navigation and consolidated `/workbench/reviewer-follow-up` surface. Authorized
  `reviewers` users can select organization-wide eligible cycles and use **All
  requests**, while **My requests** remains the personal default. Request-bound
  mutations independently resolve the target request and allow only its lead PD
  or a superuser. Two Claude code-review passes returned APPROVE; the merged
  candidate passed 17 focused suites / 241 tests plus relevant gates, lint, types,
  and build. Authenticated Production proof showed D26 My 10 → All 44 (picker:
  44 active + 184 set aside) and J26 My 0 → All 5 without exercising a write.
  Release deployment `dpl_7ToPKYtpXhyW3WmPmn1WiY9wz2iv` reached Ready; rollback
  target is `dpl_3SJebjL3tPTdv89o5dVzR1dBS3Y2` (`39413e3d`). The owner then
  selected review-DOCX work as queue order 2; the later scope refinement keeps
  the combined output as a download and the individual output as a thank-you
  attachment, with no SharePoint upload in that template-release phase. The
  separately approved review-DOCX retention plan is now order 3, with Final
  Writeup persona rollout preserved after it as order 4.

- Final Writeup acknowledgement Wave 23: **[PRODUCTION-PROVED 2026-08-31]**
  schema-as-code defines the
  organization-owned entity, six fields, two required lookups, and the
  Final-document + reviewer alternate key. The identity census proved exact,
  enabled Dataverse links for all 11 existing active sign-in profiles; the
  owner subsequently confirmed that this is the complete intended audience.
  The hardened Production preflight first reported 11 absent / 0 divergent / 0
  pending / 0 exact. After explicit owner approval, the date-bounded interlock
  acknowledgement allowed the scoped apply; final readback reports 11 exact / 0
  absent / 0 divergent / 0 pending and an Active key index. Accepted OAuth Claude Fable review findings
  now enforce exact relationship/cascade/type checks, terminal failed-key
  handling, and discriminating self-tests. The acknowledgement identity and
  schema gates are cleared. The typed adapter, separate literal-on readiness
  interlock, mark/read service, authenticated route, and Final-tab consumer are
  Production-deployed with focused service/route/component tests. Reviewer identity
  remains session-derived; the responsible PD has no self-review action; other
  users see positive initials plus unreviewed/reviewed/updated state; and a
  tracking failure never blocks the separate Word action. PR #140 / merge
  `ce229778` reached Ready Production deployment
  `dpl_P7xay61LHnxohad9FEtSniBAosuY`. Production readiness is now exact `on` in
  Ready deployment `dpl_B9k3AprnYp5ExpkqpT3dUxCUZqWo`; Preview remains unset.
  Signed-in dashboard and Final-tab reads passed on Request `1002788`, including
  external Word launch state, zero reviews, and responsible-PD exclusion. An
  eligible colleague's first POST
  reached Dataverse but failed with `0x80040220` because their roles lacked
  `prvCreatewmkf_FinalWriteupReviewAcknowledgement`; the no-fallback service
  reread confirmed no partial persistence. Commit `6659bba2` now tracks the
  dedicated `WMKF Final Writeup Reviewer` role. The approved Production apply
  assigned it to all 11 confirmed audience members. Independent readback proved
  11/11 assignments and effective Global acknowledgement Create/Read/Write/
  Append plus Request Document/User Append To. Dataverse added nine standard
  App Opener baseline privileges when it created the role, for 15 total; none
  grants Delete, Assign, Share, or Request Document write. The colleague's
  post-role retry succeeded and appeared in review history; independent
  Production readback proved exactly one complete acknowledgement row for
  Request `1002788` with all required stable file/version fields populated.

- Final Writeup Slice 1 release: **[PRODUCTION-PROVED 2026-08-30 PT /
  2026-08-31 UTC]** four approved local commits reached public GitHub and
  `main` at `ebb147bb`; Ready Production deployment
  `dpl_7kzQ1v7XGtyNx4Fady2JxMrTxQEJ` carries literal-on Wave 22 readiness.
  Signed-in test Request `1002788` created Final row
  `b6d6220b-f0a4-f111-b8dd-70a8a59cded0`, retained source/current Pre-Site row
  `7b059a2f-19a3-f111-b8dd-000d3a5bbe46`, recorded Justin Gallivan at
  `2026-08-31T03:57:20Z`, and preserved the exact SharePoint drive/item,
  version `1.0`, 38,273-byte size, and governed hash. The global Request
  Document census is now 12, including one Ready/Review Final Writeup; the
  distinct SharePoint-file count for the test request remained four. Focused
  tests passed 48/48, webpack build passed, and the bounded Production
  error/5xx scan was clean.

- Durable Executor-budget implementation: **[PRODUCTION-DEPLOYED AND
  OWNER-VIEWED 2026-08-30]** the former tracked-literal ownership is replaced by an
  append-only Dataverse `wmkf_appsystemsettings` publication contract and a
  superuser editor. The two runtime callers read the same resolved revision;
  code retains strict schema/ranges and the reviewed outage fallback. Focused
  service, route, caller, persistence, and UI tests cover invalid schemas,
  stale editors, idempotency, duplicate-key races, model ceilings, and both
  consumer behaviors. The owner-provided Production Admin screenshot showed
  the editor loading successfully with **No published revision · using reviewed
  code fallback**, so deployment/read-path proof is closed while the first
  Admin-published revision remains an explicit later owner action.

- Initial Assessment restore and Board-snapshot release:
  **[PRODUCTION-DEPLOYED + SIGNED-IN READ-SMOKED 2026-08-30]** Claude's
  adversarial findings were fixed; the relevant gates and 9,205-test suite
  passed; PR #138 merged as `c519daf6`; and Production deployment
  `dpl_9RVF7gdGtXrFAyLxcG16M1Fa86gK` reached Ready. Signed-in Request `1003109`
  showed the canonical artifact, Board-snapshot control, and native versions
  `2.0` / `1.0` without browser warnings/errors. The smoke invoked no write,
  refresh, or external-document action. Restore and first-snapshot write proof
  remain an explicit owner action, not an automatically queued task.

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
  flags stay owner-accepted-open. Workbench history, administrator restore,
  and exact byte-copy Board snapshots are Production-deployed; the signed-in
  read surface passed on Request `1003109`. Restore and first-snapshot writes
  remain unexercised and require separate explicit owner authorization.

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
