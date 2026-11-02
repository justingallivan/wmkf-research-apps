---
title: Current Work Queue
domain: architecture
kind: source-of-truth
status: canonical
summary: Canonical priority queue separating current commitments, evidence windows, optional work, external dependencies, and parked programs.
canonical: true
cataloged: 2026-07-22
last_verified: 2026-11-01
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

## Verification scope — bounded recheck 2026-10-31

The bounded code/Git audit in `docs/audits/work-queue-drift-2026-10-19.md`
corrects the named Site Visit, Workbench, J27, Cycle Dossier and personal-email
status claims. Other entries retain their earlier evidence dates; this is not a
whole-backlog or live-environment verification. The 2026-10-22 targeted document
reconciliation updated selected status entries from source, Git ancestry, and dated
receipts only; it did not re-probe Production. Priority order is unchanged. The 2026-10-31 source/Git audit corrected materials-on-acceptance, cycle-calendar and Zoom-picker status and classified the unfinished product threads below. It did not re-probe Production or recertify unrelated queue entries. Evidence and limits: `docs/audits/product-backlog-reconciliation-2026-10-31.md`.

## Current sequence

Work these items in order unless an operational incident or explicit owner decision changes the
sequence.

| Order | Work | Current boundary | Completion decision |
| --- | --- | --- | --- |
| 1 | Final Writeup acknowledgement infrastructure and dashboard data foundation | **[FOUNDATION COMPLETE 2026-08-31.]** Slice 1 is Production-proved. Wave 23 is exact/Active, and Production acknowledgement readiness is exact `on` in Ready deployment `dpl_B9k3AprnYp5ExpkqpT3dUxCUZqWo` (Preview remains unset). The signed-in ordinary-staff dashboard and Request `1002788` Final tab loaded, retained the external Word action, and correctly omitted responsible-PD self-review. After the dedicated reviewer role became effective for all 11 audience members, an eligible colleague successfully marked the Final reviewed and saw it in review history; independent readback proved exactly one complete acknowledgement row. No PC/leadership persona or broader supporting-material projection is inferred. | **Met:** acknowledgement persistence and the superuser-testable dashboard data path are in place with exact identity/version keys, focused tests, and one successful cross-user Production acknowledgement/readback. |
| 2 | Release template-backed review DOCX outputs | **[PRODUCTION-LIVE + SIGNED-IN EXPORT PROVED 2026-09-03.]** `main` commit `3101f067` is live in Ready deployment `dpl_AjT5FeDh5wkdeFSoZWJsVDM5oBqs`; Wave 25 `wmkf_questionoptions` is exact. The approved scope keeps the combined Reviews-tab action as an on-demand, server-authoritative download and makes the individual review a template-backed courtesy attachment; this phase performs no SharePoint upload. Request `1002903` generated a valid 60,586-byte DOCX with the **Aggregated Proposal Reviews** title, successful 2xx Dataverse dependencies, and no post-deploy error logs. Historical rows retain the explicit selected-only fallback. The courtesy path is deployed and source/test/render verified but was not email-send smoked. | **Met:** reviewed promotion, Ready deployment, exact schema, and signed-in combined-export verification are complete. |
| 3 | Retain structured individual review DOCX files in SharePoint and backfill D26 | **[WAVES 1–5 COMPLETE; NATURAL FILING PROVED 2026-09-04 UTC.]** The v4 text-table templates, request-level `Reviews/Review-<request>-<reviewer name>.docx` target, guarded repair service, and exact D26 backfill are Production-proved. Exact manifest `9254df9e5e504c79007391efc85d189e89e8b8b2ff80b8e4f11990baca08f4f8` executed 22 created / zero failed; row-by-row reconciliation matched every expected identity, destination, governed hash, and unique SharePoint item. Production has exact `REVIEW_DOCX_SHAREPOINT_WRITE=on` and `REVIEW_DOCX_SHAREPOINT_CYCLE=D26` (the cycle pin is superseded 2026-10-29 by filing every cycle until its calendar Board date, D44, PR #551); activation deployment `dpl_E6VKW5Wi8zDTfU1ZRhNsbH9yg9oM` and the test-row disposition/legacy cleanup are proved. Production maintenance run `70820` then naturally processed Manuel Müller's newly received review on Request `1002959`, created `Reviews/Review-1002959-Manuel Müller.docx` (SharePoint version `1.0`, 43,498 bytes), and completed without error; Dataverse independently holds the matching complete pointer. | **Met:** backfill, activation boundary, test-row disposition, legacy cleanup, and the natural automatic create/pointer path are all proved. |
| 4 | Final Writeup persona rollout and complete dashboards | **[PERSONA LENSES PRODUCTION-LIVE; NATURAL STAFF OBSERVATION COMPLETE 2026-09-04 PT.]** Commit `213f6c34` is live in Ready deployment `dpl_HGrbWUNPJMJunVevYLVEmtn7He6a`; the tracked source flag is true. Read-only production-data smoke verified PD, PC, Leadership, overlap, ineligible/unassigned, and superuser projections. **[OWNER-REPORTED]** President Allison Keller and Program Coordinators Duncan Spore and Sarah Hibler proved canonical Word access and acknowledgement; Duncan later found Request `1002788` in History, saw the review matrix, and opened the Word document successfully. Duncan, Allison, and Sarah initially appeared Reviewed and later Updated, consistent with publication-version freshness. No team exists or is required. | **Met:** runtime projection, representative Word access, and signed-in non-superuser History/matrix/Word observation are complete. Owner decisions 2026-09-06: **Leadership stage transition is a PD action in the Workbench** (a new lifecycle-state write from Review to Final). Planned S493 in `docs/FINAL_WRITEUP_LEADERSHIP_TRANSITION_PLAN.md` (six Codex passes; D2 owner-confirmed 2026-09-07) and **[PRODUCTION-LIVE 2026-09-07: PR #176 merged as `25dc8645`, Ready deployment `dpl_22eyAD8S4yPmx16iv3Nng2u9sw5T`, owner-run signed-in smoke passed on Request `1002788`.]** **PC backup is not a separate feature:** PCs already see every Final [VERIFIED via `dashboard-service.js:355`, PC persona returns all rows]; a retiring PD's requests transfer by changing the program director in Dataverse, which the dashboards key on. Broader supporting-material projection remains open. Dashboard filters, cycle scoping, and the retired-preview decision are tracked as item 5 below. |
| 5 | Final writeups dashboard: cycle scoping, views, PD filter, and version context | **[RELEASED AND SIGNED-IN SMOKED 2026-09-06–07; SOURCE ON MAIN, VERIFIED BY GIT ANCESTRY 2026-10-22.]** Slice 6A–6C are implemented: cycle scoping, Needs my review / Reviewed by me / All writeups views, bookmarkable PD filtering, and current/acknowledged publication-version context. Merge `842c9f13` records 6A (deployment `dpl_2xuEv64c5NQVXEhA3rSXZRQQaWPa`); PR #175 (`44bdd240`) records the 6B/6C release (deployment `dpl_2UrsDnydRqudu95wJyLCK7A6FUFR`). The owner closed 6D/6E as unnecessary for D26. Plan and detail pointers: Slice 6 in `docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md`, `docs/FINAL_WRITEUPS_DASHBOARD_CYCLE_SCOPING_PLAN.md`, and `docs/FINAL_WRITEUPS_DASHBOARD_VIEWS_AND_VERSION_PLAN.md`. The dated receipts establish the 2026-09 promotion and signed-in checks; this pass did not re-probe Production. | **Release met.** The original two-cycle capacity criterion remains an explicit verification gap; it was not re-proved by this pass. No dashboard-filter build is queued. |
| 6 | Automated materials-on-acceptance email (reviewer lifecycle) | **[IMPLEMENTED AND MERGED 2026-10-31 — PR #562, `fcad0ad53`; dated Production release recorded in Session657 / DEVELOPMENT_LOG.]** The acceptance drain now sends one materials email after onboarding, sharing the `reviewer_materials_releases` claim with manual sends (migration 091). Preparation failures retry for about 15 minutes before the acceptance-confirmation/manual-release fallback and staff alert; uncertain sends require staff recovery. Source: `lib/services/reviewer-acceptance-drain.js` and `lib/services/reviewer-engagement/materials-release-store.js`. Manual fallback remains; this is no longer an unbuilt J27 feature. Plan: `docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md`. | **Build met; operational observation remains:** first natural J27 acceptance delivery is not proved here. Invitation wording / `{{proposalDelivery}}`: done 2026-11-01 (PRs #586, #587; live body and one PD override line-edited, owner-approved). Reviewer Finder cycle-record date retirement: PR #589 (2026-11-01). No fresh deployment or send probe in this audit. |
| 6a | Stop reading the request meeting date; derive each request's cycle from its Grant Cycle link | **[DONE 2026-10-30; ALL BUILD STEPS DEPLOYED; J27 ITEM.]** Owner: nothing in the apps reads `akoya_request.wmkf_meetingdate`; a request's cycle comes from its Grant Cycle link `akoya_request.wmkf_grantcycle` and cycle dates from that linked calendar row, with no meeting-date fallback anywhere (owner-confirmed 2026-10-29; older gaps are fixed as Dynamics data, `docs/CONNOR_DATA_CLEANUP_QUESTIONS.md`). **[DEPLOYED]** PR #552 (`54070863f`) moved the reviewer email path to the link. Plan with whole-repo inventory, owner decisions, contract check and Codex review: `docs/plans/MEETING_DATE_RETIREMENT_PLAN_2026-10-29.md` (on main, `8dd123543`). Build step 1 (sandbox cycle rows and links) done and verified. **[DEPLOYED 2026-10-30]** Step 2 (cycle lookup and Research screens) PR #554 `fe749f063`; step 3 (checks, dates shown, cleanup) PR #555 `701a58bea`; step 5 (Test Request Factory, real cycles only) PR #556 `a1f9d0035`; step 4 (invitation closing and honoraria) PR #557 `84ba3bf84`; step 6 (Dynamics Explorer, current-use scripts, `check:request-meeting-date-reads` ratchet gate) PR #558 `fd0333864`; reader batches PR #559 `95bde8874` and PR #560 `4906e7793`. No app code reads the request meeting date; the gate records only deliberate uses. | **Met.** Follow-ups only: about 140 older unlinked Research requests (Connor DC1, low priority) and app-made 2026 honoraria without a link (DC5, parked); rebuild any review-file backfill/repair manifest made before 2026-10-30. |
| 7 | Per-reminder audit trail for reviewer follow-up (Activity history) | **[SURFACED 2026-09-06 BY THE CODEX POLISH HANDOFF; NOT STARTED; PLAN-FIRST WITH `/contract-reconcile`; J27 ITEM (owner 2026-09-06: "can wait till J27"). Reminders stay manual for D26.]** The reviewer record stores only cumulative `reminderCount` and the latest `reminderSentAt`, so the Activity history drawer (reachable since the 2026-09-06 polish from status, token, and reminder pills) shows one dated reminder event plus "N reminders recorded in total". Build a durable per-reminder record and extend the reviewer activity API/DTO so each reminder is its own dated event. Do not read `reminderCount` as evidence of individual timestamps. Handoff: `docs/plans/REVIEWER_FOLLOW_UP_POLISH_HANDOFF_2026-09-06.md`. | **Met when:** each reminder sent appears as its own dated event in the drawer, backed by durable rows, with the existing count preserved for older reviewers. |
| 8 | J27 single-phase transition inventory | **[VERIFIED via Git ancestry and `check:j27-register`, 2026-10-19.]** The register and tightened per-site binding gate are on `main`; the reviewed `65eb4bfee` history is included. Current gate: 79 rows, 61 ok, 0 stale, 6 unverifiable, 12 closed. The register remains the detailed source for owner questions and the separate J27 build plan. | Gate implementation and merge are complete. Six unverifiable rows and unresolved owner inputs remain explicit; a green gate does not resolve them or establish runtime readiness. |
| 9 | PC Meeting Tracker: deliberation sessions and site visits as the schedule of record, read by the Staff Deliberations rail and cycle view | **[PRODUCTION-LIVE; DATED REVERIFICATION 2026-09-15.]** Slices 0–3 and 2b are merged and deployed; the dated Production Wave 28 readback was 22 exact / 0 absent / 0 divergent and `MEETING_TRACKER_SCHEMA_READY` was exact-on. The app owns session/slot scheduling and Site Visit editing; the rail, cycle view, Share flow, and briefing seam consume its schedule reader. PR #294 disables attendee choices that lack an email and returns a named, actionable save error. Migration 041 is applied for the agenda ledger; the owner-run Production send and inbox receipt are recorded 2026-09-16 in item 10. Current live configuration was not re-probed in this documentation pass. | **Met for dated runtime/schema promotion and agenda send receipt.** Remaining work is operational observation and the separately listed future-cycle/email-consistency follow-up, not activation of the tracker. |
| 10 | Email send feedback and consistency audit (system-wide) | **[PRODUCTION-LIVE 2026-09-15; COMMITS `2c9497ce` + `d6cfcfeb`; READY DEPLOYMENT `dpl_CxCtZ7F8AnniXRCsPyctjmz22LcW`; PLAYWRIGHT FOLLOW-UP `472b1ad8` GREEN.]** `docs/EMAIL_SEND_FEEDBACK_AUDIT_2026-09-15.md` records the complete send-path inventory and the implemented contract. Human-triggered surfaces now share accessible confirmed/failed/uncertain/partial/draft feedback; a clean confirmed result renders only **Sent for delivery.** and never exposes the Dynamics activity id, sender, or recipient. `sent` still means Dynamics accepted for delivery, never inbox delivery. Pre-dispatch errors are definite failures, send-stage errors retain the activity id internally and stay uncertain unless a ledger reconciles them, batch outcomes retain recipient identities, and refresh failures cannot relabel accepted sends. Background at-most-once jobs now count failed versus unconfirmed separately. No migration or new retry loop was introduced. The full 939-suite / 13,667-test repository run and production build passed; the corrected 25-test Playwright suite passed locally and in GitHub Actions. **[OWNER-REPORTED]** An ordinary Admin Email Test send succeeded in Production and exposed the former over-detailed receipt, proving the ordinary `createAndSendEmail` path. | **[CLOSED 2026-09-16]** Owner-driven Production smoke of a ledger-backed Meeting Tracker agenda send (smoke session, To = owner only) rendered exactly **Sent for delivery.** with no technical detail; the owner also received the email. Inbox delivery remains an external mail-system fact and is not claimed. Residue cleaned: smoke session set Cancelled; its one `deliberation_agenda_sends` row deleted after owner confirmation. |
| 11 | Cycle Dossier pilot: remaining retention decision | **[VERIFIED via Git ancestry, 2026-10-19.]** The recorded owner smoke on Request 1002852 succeeded on 2026-09-12; it is not a pending task. Pilot hardening merged in PR #265 (`1accfbcab`), followed by #274–278 for entry timeout, edition clarity, retry budget, run-item links and request revision. The former accepted-for-smoke hardening list must not be offered as unbuilt work. The recorded five-minute drain cadence and smoke receipts are historical operational evidence, not a fresh environment probe. | Preview/Blob retention remains an owner decision requiring a focused current-state check before implementation. Current production configuration and broader pilot acceptance were not re-probed in this documentation pass. |
| 12 | Pre-Research Presentation Brief: fourth governed artifact replacing the Pre-Site writeup as the Board distribution source | **[SHIPPED 2026-09-17 — PR #307 merged `f1cf8fe3`, hotfix PR #308 `9ab5fe71`, CI repair PR #309 `de349928`; migration 052 applied and read back.]** Owner decisions B1–B14 and Codex rounds in `docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md`. Follow-ups built S516 and **merged 2026-09-17**: PR #310 `0eba7358` (items 2–10), PR #311 `248233c7` (guarded regeneration of a sent brief), PR #312 `7f776e36` (review bundle PDF; migration 053 applied and read back exact). | ZZTEST-03 smoke run 2026-09-17 (plan §12): generate, lock, share with bundle, briefing page, drift detection, guarded regeneration pass. Email link confirmed by the owner. Finding A (snapshot hash mismatch) fixed in PR #313 `b5af962b`, deployed and smoked on ZZTEST-03 2026-09-17: Staff Brief download and same-version re-preview pass. **Met.** |
| 13 | Client request layer: fix unguarded response handling (D1) after each file migrates onto `shared/utils/api-request.js` | **[RELEASED 2026-09-20; merge `8623c2f7b`, production `dpl_9rNyDMfuEMHPHo6ndSNh3di9d9eQ`.]** The roles, providers, scheduled-email posture GETs, and remaining D9 `ErrorAlert` props are implemented with focused tests. [VERIFIED via Git, Vercel API and signed-in smoke] Release evidence: `docs/plans/AGENDA_D1_RELEASE_2026-09-20.md`. Source plan and execution details remain in `docs/plans/CLIENT_REQUEST_LAYER_D1_UNGUARDED_RESPONSES_2026-09-20.md` and `docs/plans/CLIENT_REQUEST_LAYER_EXECUTION_2026-09-19.md`; Luna built, Sol reviewed, root accepted, and the owner authorized promotion. | Every confirmed unguarded site shows the server error on non-2xx, each with a test; execution log carries a "D1 fixes" section; campaign-critical rows released under Tier 2. |

## Owner-requested product follow-ups

- **Personal email defaults and editable send previews (2026-09-20).**
  [PRODUCTION-LIVE — PR #320, merge `834b83d8382`, deployment
  `dpl_FRtcw4uqBB12jAH7Ug1aPfYTB8nQ`] Meeting Tracker's first and later
  materials invitations and manual reminders now have personal defaults and
  editable previews in Production. Named copy resolves the actual PI, liaison and
  request-assigned Program Coordinator; the shared four-key Admin readback matched
  tracked seeds exactly after runtime promotion. Implementation and evidence are
  recorded in `docs/plans/MATERIALS_EMAIL_PERSONALIZATION_PLAN_2026-09-20.md`.
  The suite-wide inventory is complete; grantee invitation and reviewer-reminder
  slices merged in PRs #330 and #332. Broader adoption remains a separate to-do:
  extend the remaining email families in bounded changes. This merge-status
  correction does not establish live delivery. Requirements and remaining follow-ups:
  `docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md`.

- **Deliberations display vocabulary — approved 2026-10-21; adoption partial.**
  PRs #577, #580, #581, #583, #590, #591 and #592 merged bounded display-copy
  slices. PR #593 merged the audit (`d73cdc96e`); PRs #594–#597 merged A1–A4,
  B1–B2 and C1–C2 (`21c937783`, `6cbed404c`, `73ecc8445`, `3285d2ad3`); PR
  #598 merged scoped prompt-source terminology (`25cac4785`). Its SHA deployed
  successfully to Production as deployment `7482300775`; Git merge status alone
  does not prove deployment. Signed-in Production walkthrough confirmed
  the main Request 1003222 Staff Deliberations/Final writeup headings and found
  11 baseline old-label strings across six files (two observed, nine
  source-only). Root reports corrections implemented on
  `codex/final-terminology-copy`; PR review and Production verification remain
  pending, so the migration is not release-complete. A fresh read-only
  inventory reported 46 email fields / 4 personal records and 60 prompt
  versions / 39 current. Only three scoped shared fields, Duncan's cleared
  invitation override, and two prompt families published at v6/v3 with exact
  approved content preserved and audits completed are verified changes.
  No raw content is stored here. No broad migration/backfill is authorized;
  existing saved names/content, historical files, identifiers and contracts
  remain protected. The stale-client compatibility guard is explicitly outside
  this 11-string PR. Evidence, limits and source locations:
  `docs/audits/terminology-completion-audit-2026-11-01.md`; approved table:
  `docs/plans/review/PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md`; glossary:
  `docs/NOMENCLATURE_GLOSSARY.md`.

- **Staff Deliberations: group-review handoff from the writeup step
  (2026-10-06).** [STAGE 1 LIVE — PR #452, merge `40b70a145`, Production 2026-10-06]
  Step 4 now reads "Post-visit drafting"
  with "Edit writeup in Word" and "Ready for group review" (same
  `POST /api/workbench/final-writeup` route and authorization); Final writeup
  buttons renamed "Ready for group review" / "Send to leadership". Stage 2 (the
  draft is hidden in the apps from everyone but the lead PD, PCs and superusers
  until group review; changes are lead PD or superuser only) is live (PR #453,
  merge `b47a70eae`, 2026-10-06). Stage 3 (lead-PD sign-off view; "Mark
  reviewed" renamed "Sign off"; Send to leadership names unsigned PDs) is live
  (PR #454, merge `b2bc23b95`, 2026-10-07). Stage 4 (PD handoff email,
  Research only via `FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS`) is live
  (PR #456, merge `8bc5b466b`, 2026-10-07; migration 072 applied, copy seeded,
  Production list = Research only); verify the first real send. Stage 5 (leadership daily digest) is live
  (PR #461, merge `ddeb1b401`, S584; migration 073 applied, copy seeded; first digest not
  yet observed); scope is Research only, via the same program list (owner, S584);
  SoCal is parked by the owner (2026-10-07). Program-list reminder:
  when SoCal (or another program) adopts group review, add its Grant Program
  GUID to `FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS` or it sends no email:
  `docs/plans/FINAL_WRITEUP_GROUP_REVIEW_HANDOFF_PLAN_2026-10-06.md`.
- **Deferred items from 2026-10-06, live S584 via PR #460 (merge
  `ea1e09a0d`):** (a) the Staff Deliberations
  list's next step for a ready briefing names the deliberation session date while the
  session is upcoming, matching the request tab's rule (`StaffDeliberationsPanel.js`);
  (b) the two writeup "check in Word" warnings no longer say "the Dataverse fill"
  (`lib/services/pre-site-visit/artifact-model.js`). Owner approved both wordings.

- **Overlapping cycles with minimal configuration (2026-10-21).**
  [PARTIAL: CALENDAR, LANDING CYCLE AND NAMED DATE CONSUMERS SHIPPED; CONSOLIDATED READINESS VIEW/NOTICES STILL PLANNED]
  Owner requested a cross-app plan after three read-only agents inventoried
  cycle selection, settings, jobs and schema. Proposed delivery: verify the
  operations calendar contract, isolate reviewer dates per cycle, make app
  context explicit, replace routine job pins with bounded eligibility, and
  surface only actionable rollover exceptions in one readiness view.
  `docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md`
  now contains the evidence, migration order and acceptance scenarios.
  Foundational read-only Production checks now verify shared roles/assignments,
  cycle rows, selected settings and request/GOApply linkage. Evidence and remaining
  owner/Connor questions: `docs/audits/cycle-foundations-2026-10-21.md`. J27
  exists in operations; D27 does not yet. Calendar role decided 2026-10-24:
  Grants Manager, Program Coordinator fallback; 2026-10-27: either role edits at
  any time, with last editor and time shown; readiness notices route by
  role (log D12). 2026-10-28 (log D43): the operations `wmkf_grantcycle`
  table, now carrying eleven milestone date columns, is the authoritative home
  for cycle dates, edited from an app Admin calendar; prototype plan
  `docs/plans/CYCLE_CALENDAR_DATAVERSE_PLAN_2026-10-28.md` (merged as PR #542, `e8fdcaa07`; attribution follow-up #543; dated Production release recorded in `d6aba6cb6`). Intended Research
  opportunity/publication and date propagation remain unresolved; meeting log: `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md`.
  Central response-period/quota defaults and simpler PD controls retain the D9 scope;
  calendar due-date sourcing and materials-on-acceptance are already implemented
  (#552 / #562). The consolidated readiness panel and role-routed daily notices
  remain planned. Verify remaining slice scope against current source rather than
  replaying the original rollout. This audit made no runtime/live write or priority change.
  Historical interim safeguard: owner-reported Production preparation list
  `["D26","J27"]`, redeployed 2026-10-07 (J27-084), not read back this session.
  Coordinate implementation with J27 row 8; routine future rollover should need
  no code/env/deployment edits, while real business approvals remain explicit.

- **Reduce transcription audio copies and stream verified uploads (2026-10-19).**
  [PRODUCTION-LIVE — PR #513, merge `413c5f048`, Ready deployment `dpl_Dh9KeHbpPbqoYEzvjuiKgymJR6hG`; all 12 CI checks passed] The reviewed
  [plan](plans/ZOOM_AUDIO_STREAMING_PLAN_2026-10-19.md) is implemented: metadata-gated
  preallocation with bounded fallback, full-file integrity checks, bounded upload
  streams, caller deadlines and pre-upload lease/switch checks. Zoom import opts
  audio into preallocation and releases its Buffer after provenance capture,
  before queue validation; the Blob reread and copying inspector remain.
  [Implementation evidence](plans/evidence/ZOOM_AUDIO_IMPLEMENTATION_2026-10-19.md)
  records local tests and memory results, including outliers and concurrent starts.
  [Real private Blob Preview validation](plans/evidence/ZOOM_AUDIO_PREVIEW_VALIDATION_2026-10-19.md)
  passed small, 199 MiB, two concurrent near-cap operations and corrupt-byte
  rejection with verified cleanup. The concurrent process peak was 1,898 MiB;
  this does not establish a safe sustained concurrency bound. Keep the 200 MiB/
  four-hour limits. [Real Zoom/AssemblyAI Preview acceptance](plans/evidence/ZOOM_AUDIO_REAL_PREVIEW_2026-10-19.md)
  also passed on the approved 85-minute recording: full import, one provider job,
  saved transcript and TXT download; disposable resources were removed. The
  receipt records one automatic cleanup warning email to the owner. The release uses
  Performance allocation (4 GB / 2 vCPUs), verified in deployment configuration;
  the earlier memory measurements used 2 GB, and no 4 GB stress rerun is claimed. Hosted slow-source/abort, callback
  delivery and sustained concurrency remain unverified.

- **Site Visit page redesign and follow-ups — implemented.**
  [VERIFIED via source and Git ancestry, 2026-10-19] The redesign merged as
  `c574e9e7d`. Correction publication queues automatic split-transcript
  regeneration when a confirmed presentation end is available; first publication
  without that boundary does not queue it. Summaries remain manual. The card
  displays specific video supersession reasons and offers inline Watch playback;
  `SiteVisitEditor` renders the shared readiness status chip. C1–C3 and the chip
  are implementation history, not remaining builds. Source and limits:
  `lib/services/meeting-tracker-transcription/service.js`,
  `shared/components/meeting-tracker/RecordingAndTranscriptCard.js`,
  `shared/components/meeting-tracker/SiteVisitEditor.js`, and
  `docs/plans/SITE_VISIT_PAGE_REDESIGN_PLAN_2026-10-10.md` §10.
  This code/Git check does not establish new production playback acceptance.
- **Card stays busy after a successful transcript publish (2026-10-10).**
  [FIXED 2026-10-10 — branch `claude/card-publish-busy`, Codex approve round 3; owner-token busy claims for publish, save and attendance] In `RecordingAndTranscriptCard.js`
  the publish handler closes the editor on success (`setCorrectionDetail(null)`,
  which changes `editorKey`), awaits `loadCollection()`, and only then clears
  `busy` in `finally` under `editorKeyRef.current === targetKey`. By then the
  ref has moved, so `busy` stays `'publish'` and every `disabled={Boolean(t.busy)}`
  control (Generate presentation and discussion transcripts, Edit speaker
  names) stays greyed until a page reload. Fix: clear `busy` on the success
  path regardless of the editor key, and add a test that the generate button
  is enabled after a successful publish.
- **Speed up the presentation video cut (2026-10-10).** [OPEN — from the
  first real cut, 1003222: 40 min on 2 vCPUs; encode 22 min, probe and accept
  checks about 15 min] (1) Set `PRESENTATION_VIDEO_SANDBOX_VCPUS=4` in
  Production (no code). (2) After a measured 4-vCPU run, lower
  `PRESENTATION_VIDEO_SANDBOX_TIMEOUT_MS` from 3 h to about 90 min. (3) Replace
  frame decoding in the cut script's probe/accept steps with packet timestamps
  where the recipe allows; a privacy-recipe change, so full Codex review.
  Detail: `docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md` "First real cut".
- **Show transcripts and summaries formatted in the browser across the suite
  (2026-10-11).** [SHIPPED 2026-10-11, Session 595] Workbench summaries render
  with their headings and lists through the shared `SummaryText` (merge
  `99c91df93`); a staff reading page `/workbench/read` shows transcripts
  (timed speaker turns) and summaries formatted, opened from the Workbench and
  the Site Visit card; the Workbench also plays the approved presentation video
  inline (merge `b9d0d0ff2`). Plan and live verification:
  `docs/plans/STAFF_READER_AND_VIDEO_PLAN_2026-10-11.md`. Out of scope and
  unchanged: the transcription rehearsal page and the admin transcription pilot.
- **Board file check uses the SharePoint eTag (2026-10-10).** [VIDEO FIXED
  2026-10-11 (Session 594); transcripts OPEN, low priority] The approved
  1003222 video's eTag moved after approval with size and quickXorHash
  unchanged, so the Board link refused it. The video is now bound by the
  approved cut's size and quickXorHash. The Presentation Transcript and
  Transcript Summary still compare eTag (`pinnedBytesMatch` in
  `lib/services/post-presentation-materials/presentation-page-service.js`);
  owner chose to leave them until one breaks (fails closed: the file will not
  open). Fix if needed: compare size + `publication.versionId`, which Graph's
  default item response omits, so `resolveMediaDownloadUrl` must request it
  explicitly. Detail: `docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md` "Board link fix".
- **Zoom participants in the speaker-name picker — implemented on main.**
  [VERIFIED via source and Git ancestry, 2026-10-31] PR #511 (`bb7b5e04c`)
  supplies verified-occurrence Zoom names ahead of request/manual choices, with
  a five-second lookup budget. Source: `attendance-service.js`, transcription
  `service.js`, and `RecordingAndTranscriptCard.js`. The branch-only backlog is
  closed; a fresh hosted Zoom lookup / staff-acceptance check was not performed.
  Contract and evidence limits: `docs/plans/ZOOM_SPEAKER_PICKER_2026-10-19.md`.

## Product follow-ups — source-audited 2026-10-31, no priority change

These are bounded findings, not new build authorization. Full evidence and
search limits: `docs/audits/product-backlog-reconciliation-2026-10-31.md`.

- **J27 intake and staff triage — partial foundations.** Existing Workbench
  lists and Initial Assessments do not implement the new staff-state field,
  bulk changes, flags and First Cut output. November 15 is the recorded owner
  target, not a delivery claim. Use the alignment log for current decisions.
- **Research document corpus — index implemented, product incomplete.**
  `scripts/load-request-file-corpus.mjs` persists metadata/classification;
  scaled text extraction, admin browsing/analyses, scheduled refresh and
  Dataverse promotion remain separately approved work. Pre-2018 stays parked.
  Plan: `docs/plans/RESEARCH_REQUEST_FILE_CORPUS_PLAN_2026-10-25.md`.
- **Grant Reporting and Literature Analyzer — product decisions open.** Both
  standalone apps remain implemented. Grant Reporting's future integration
  destination and Literature Analyzer's role/reuse need owner decisions;
  neither is an unbuilt app or authorized retirement. Read their routed memories.
- **Interim-report evaluation — contract undecided.** Existing final-report
  comparison and document-discovery plumbing are not a dedicated annual
  progress evaluation or staff-field writeback. See
  `.claude-memory/project-interim-report-automation.md`.
- **Historical portfolio analysis — partial building blocks.** Bulk Export
  already filters/exports request records and the corpus indexes files; neither
  supplies the full document selection → custom-prompt batch → structured
  model-results export workflow. The old retrospective plan is historical.
- **Calendar agendas — Duncan walkthrough pending.** Standalone agenda email
  exists; updating the existing organizing calendar event is not implemented.
  Follow `docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md` before planning.
- **Program Chairs writeup/sharing — partial foundations.** Existing Executive
  Summary and Board exports are reusable; the Chairs-specific artifact and
  proposal-sharing contract are not established by those features. Content,
  staff-review timing and sharing mechanism remain in the alignment log.
- **Eligibility/staged review — historical design, not an execution plan.**
  Concept eligibility, successor Review Panel and Cycle Dossier research exist
  separately; the old staged full-proposal pipeline is not implemented.
  Re-scope from current J27 intent before any build; do not revive its old migration.

## Audit follow-ups — verified open, not silently prioritized
- **Hard-coded late-2026 `expiresAt` dates in unit-test fixtures (2026-09-27, S546).** **[CLOSED
  2026-10-08 UTC, S584: no clock dependence.]** All seven files pass at 05:48 UTC on 2026-10-08
  (236 tests), after four of the dates had passed. Each remaining value is display-only or under a fake
  clock: `external-briefing-page` and `pre-site-distribution-service` (10-08T20:00, 11-14) only format
  the date (`pages/external/briefing/[token].js:298-299`, `distributionBodyHtml`);
  `pre-site-distribution-panel` (12-17) goes through `briefingExpiryLabel`, a formatter
  (`PreSiteDistributionPanel.js:71-76`); `meeting-tracker-session-service` (12-18) is an equality
  fixture; `reviewer-institution-evidence-attestation` (10-14) sets `jest.useFakeTimers().setSystemTime`
  (line 52); `workbench-briefing-link-route` and `reviewer-institution-auto-resolution-policy` already
  pass with their dates in the past. The original failure was fixed in `5ced59d3b`.
- **Preview CSRF origin check rejects alias-hosted POSTs (2026-09-19, integration
  smoke).** `lib/utils/auth.js validateOrigin` derives the Preview allowed origin from
  `VERCEL_URL` (the immutable deployment host), so any state-changing request made
  through a Vercel alias such as `wmkfresearchapps-preview.vercel.app` returns 403
  `Forbidden` while GETs pass. Seen on the Explorer chat POST during the
  `integration/2026-09-19` Preview smoke; worked around with a branch-scoped Preview
  `NEXTAUTH_URL` set to the alias origin. Pre-existing, not a regression.
  **Runbook option (a) documented 2026-09-23:**
  `docs/AUTHENTICATION_SETUP.md` Step 2.4 and
  `.claude-memory/project-vercel-cli-deploy-preview-auth.md` specify the exact
  branch scope, new deployment, validation-only POST, and alias/environment
  rollback. No Vercel setting or runtime allowlist changed in that docs pass.
  Option (b), if later needed, is to accept `VERCEL_BRANCH_URL` and a fixed
  allowlist of registered alias origins alongside `VERCEL_URL`, never a request
  header; it widens a CSRF allowlist and requires `/contract-reconcile` under
  `docs/API_ROUTE_SECURITY_MATRIX.md`. The two temporary Entra callbacks for the
  retired Codex branch aliases (`git-codex-pau-5b4bef`, `git-codex-wor-464bcd`)
  were removed from the app registration on 2026-09-24 (Session 539, owner
  authorized; both source branches were already gone from origin). Seven Web
  redirect URIs remain, including three older deployment-hash callbacks that
  were not part of that directive.
- **Dependabot / npm audit triage 2026-10-06 (S578).** PR #447 bumps http-cache-semantics 4.2.0 → 4.3.0 (alert #116), the sharp override 0.35.4 → 0.35.5 (librsvg), proxy-addr 2.0.7 → 2.0.8 (critical; not reached — no trust-subnet config) and source-map-js 1.2.1 → 1.2.2 (build-time). Alert #115 (braces ≤3.0.3, no patched release, maintainer disputes it) was dismissed as tolerable risk: build-time only via Tailwind. Still open in `npm audit`, by decision: postcss-selector-parser <7.1.6 (GHSA-rj75; Tailwind 3 / typography pin 6.x, fix waits for the Tailwind 4 migration; build-time on repo CSS) and sprintf-js ≤1.1.3 (GHSA-hp3w; no upstream fix; reached only via mammoth/js-yaml → argparse, no attacker-controlled format strings). The remaining audit rows are dependents of those two plus braces.
- **Dependabot triage 2026-09-30 (S553).** PR #378 (merge `361fbcdfd`) closed all five open alerts: Next 16.3.5 → 16.3.8 (critical next/og RCE; `next/og` is not imported in this repo), dompurify 3.4.13 → 3.4.16 (low), and the vendored brace-expansion shim's upstream pin 5.0.9 → 5.0.12 in both the root and `vendor/brace-expansion-compat` package.json (two high, one medium). `npm audit` reported 0 vulnerabilities; the alert count on `main` was 0 after the merge.
- **Dependabot triage 2026-09-12 (S509).** Patch bumps (Next 16.3.5, xmldom 0.8.15,
  sharp 0.35.4, qs 6.16.0, js-yaml 3.15.2/4.3.2) and csv-parse 7.0.2 (a mistaken major
  with no breaking changes) shipped in S509. At that time, the IRS BMF importer's
  option set was smoke-tested, but it had no unit test and was not re-run against
  a live IRS file. **[VERIFIED via PR #333, merge `374a2e51e`, 2026-09-24]** The
  importer now has a fixture-driven CSV/COPY stream test; a live-file re-run
  remains unverified.
  The `@tiptap/core` prototype-pollution alert (GHSA-cp6q-959q-f8rh) was closed by the
  tiptap 2 → 3.31 editor migration (same day): StarterKit's new bundled link/underline/
  trailingNode/listKeymap are disabled to hold each editor's allowlist, `setContent` uses
  `{ emitUpdate: false }`, `shouldRerenderOnTransaction: true` keeps toolbar state live,
  and the Markdown serializer imports `prosemirror-markdown` directly (the `@tiptap/pm/
  markdown` subpath is gone). Production smoke 2026-09-12 (Chrome, signed-in staff): the
  grantee abstract editor on an awarded J26 request and the manual-review rescue form on
  a D26 request both rendered on tiptap 3.31; bold, italic (Cmd+I), subscript, and
  superscript applied and the toolbar pressed-state tracked each; Undo restored the
  original; no console errors; nothing was saved. The external reviewer portal itself and
  the Playwright authoring spec were not exercised.
- **Safe `Content-Disposition` filenames on five download/export routes (fixed 2026-09-23).**
  Commit `6f89b1df` converted `review-manager/export-reviews.js`,
  `workbench/export-candidates.js`, `dynamics-explorer/download-document.js`,
  `review-manager/download-review.js`, and `reviewer-finder/cycle-material.js` to
  `lib/utils/content-disposition.js` (ASCII fallback plus UTF-8 `filename*`).
  Route tests cover quotes, Unicode, and CR/LF in
  `tests/unit/export-reviews-route.test.js`,
  `tests/unit/workbench-export-candidates-route.test.js`,
  `tests/unit/dynamics-explorer-download-document-route.test.js`,
  `tests/unit/download-review-route.test.js`, and
  `tests/unit/cycle-material-endpoint.test.js`.
- **Single-page Request Workbench shell (owner direction 2026-09-08, Session 499).**
  The Workbench was conceived as one page a PD moves across left to right through
  a cycle; the Request list kept its content in place while Reviewer follow-up,
  Final writeups, and Awardees opened separate pages, which made back navigation
  hard. Owner: "Why not do 2 now?" (build the shell). Sequence, one PR each,
  every one independently green: (1) shell + URL state + Request list panel +
  nav links into the shell — **built in PR #204 (`claude/workbench-shell`)**:
  `shared/components/workbench/WorkbenchShell.js` owns `view`, `programId`,
  `cycleCode`, `scope`, `setAside` in the URL (`workbench-location.js`), resolves
  the working cycle from the dashboard cycle list, and mounts
  `RequestListPanel.js`; (2) Reviewer follow-up panel — **owner approved the
  strip restore 2026-09-08; built the same day in PR #205 (`claude/workbench-shell-follow-up`)**:
  `ReviewerFollowUpPanel.js` shares the shell's `scope`, carries `reviewers=` and
  `q=` in the URL, `previewReadOnly` comes from the shell page's
  `getServerSideProps`, and `/workbench/reviewer-follow-up` redirects into the
  shell; (3) Final writeups panel — **built 2026-09-08 (`claude/workbench-shell-final-writeups`)**:
  `FinalWriteupsPanel` takes the shell's cycle, carries `writeups=`/`pd=`/`q=`/`uncycled=1`,
  replaces the walk-back with an in-place notice and link (§3.3 of
  `docs/FINAL_WRITEUPS_DASHBOARD_CYCLE_SCOPING_PLAN.md` reconciled; service and its
  `defaultResolvedBy` tests untouched), and the legacy index redirects; the shell now honors an
  unlisted `?cycleCode=` (reverses a PR #204 rule) so cross-view cycle links work — PR #206; (4) Awardees + Initial assessments
  panels — **built 2026-09-08 in PR #207 (`claude/workbench-shell-awardees`)**: `AwardeesPanel.js`
  applies the owner's Awardees rule below; `InitialAssessmentsPanel.js` takes the shell's
  cycle and a D26 deep link renders the existing explanatory card; the two legacy pages
  redirect; (5) the approved stragglers, split read-side / write-side: (5a) read-side —
  **built 2026-09-08 in PR #208 (`claude/cycle-stragglers-read`)**: Expertise Finder's Batch tab
  opens on the working cycle and `/api/expertise-finder/proposals` takes `cycleCode`
  (compiled to a `wmkf_meetingdate` range) instead of the `akoya_fiscalyear` string,
  and request search rejects an unknown cycle label with a 400 instead of falling
  back to a fiscal-year match; (5b) write-side — **built 2026-09-08
  (`claude/cycle-stragglers-write`)**: `save-candidates` stamps `wmkf_grantcyclecode`
  from the request's meeting date (`loadCoiContext.cycleCode`) and no longer reads
  it from the body (the Find panel stopped sending it), and `my-candidates` shows
  the meeting-date-derived code first, using the stored value only for a request
  with no meeting date. Not done: rows stamped by an earlier stale page value stay
  filed under that code in the by-cycle My Candidates list until re-saved (a data
  question for the owner; no probe run).
  **Owner decided 2026-09-08 (yes to the proposal):** Awardees opens on the *last decided*
  cycle while every other view opens on the *working* cycle; with one cycle in
  the URL both cannot hold, so the Awardees panel shows
  the shell's cycle and, when that cycle has no awardees yet, one line naming
  the last decided cycle as a link that changes the shell's cycle (the awardees
  endpoint's cycle-list mode already returns `lastDecidedCycleCode`).
- **Reviewer follow-up cards should show the program director.** Owner request
  2026-09-08 (Session 499): each request card on
  `/workbench/reviewer-follow-up` shows institution and PI but not the PD, so
  with All requests selected a reader cannot tell whose request a row is. The
  page already loads `/api/workbench/dashboard`, whose proposal DTO carries
  `programDirector` (formatted name) [VERIFIED via
  `lib/services/workbench/dashboard-service.js:252`], so this is a card-render
  change in `pages/workbench/reviewer-follow-up.js` (the institution · PI line,
  ~line 61), plus a render test. Tier 0 UI. **Built the same session in PR #200**
  (`claude/follow-up-pd`); closes on merge.
- **Public/onboarding reviewer-token documentation reconciliation.**
  **[CLOSED BY RETIREMENT 2026-09-08.]** The `docs/onboarding/` Workbench decks
  (two generated `.pptx` files, their Python generator, and README) were retired
  and deleted on owner decision 2026-09-08: no one had been shown them, they were
  still DRAFT v1, and they had drifted from the product repeatedly. PR #182
  (`f1a5113d`) had reconciled them the day before; that pass stands as the last
  state in git history. The other public artifacts audited in that pass
  (`shared/config/guideContent.js`, `pages/guide.js`, the public reviewer portal
  `pages/external/review/[token].js`) carried no stale reminder, token-rotation,
  freeze, or scheduler claims [VERIFIED via grep, 2026-09-07]. The generator→deck
  parity-check follow-up is moot. The two residual follow-ups surfaced by that
  pass — `docs/REVIEWER_ENGAGEMENT_SPEC.md:110` (contradicted the same spec's
  `:64`/`:79` on the lifted freeze and respond-by re-minting) and
  `docs/agent-wiki/topics/finance-honoraria.md:41` (said the closeout honorarium
  decision was "deployment pending" although it is on `main`) — were both
  **resolved 2026-09-08 on branch `claude/j27-gate-tighten`, commit `c1f4893d`.**
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
  `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` items 7–10. The former
  `SESSION_PROMPT.md` Parked item 2 is absent from the current handoff and the
  2026-10-21 archive snapshot; use the plan as the durable ledger.
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

## Historical implementation and release records — not backlog

The entries below preserve dated build/release sequences. Open steps inside those
sequences describe their original checkpoint; use the current sections above and
the owning plan for remaining work, not this historical record as a fresh queue.

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

- **Site Visit Materials / applicant additional materials — deployed; bounded residuals remain.**
  **[SOURCE ON MAIN: Git ancestry includes background-queue/finalize commit `28e9424b0`;
  dated release evidence: `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §§16.14–16.15.]**
  The applicant upload path uses durable background jobs and a shared finalizer that
  validates/scans, writes SharePoint, registers the Request Document, and supports
  replay/recovery. The base code, schema, worker, and guarded activation follow-ups
  reached Ready Production deployment `dpl_7zi1no5HrxgrPbCQo18Lsi1NM5CZ` at
  `b223dad7d` (2026-10-02); this is dated release evidence, not a fresh live probe.
  **Residuals:** the exact 500 MB live transfer remains unverified. The owner declined
  another simultaneous-large background test on 2026-10-02; reopen only if use or
  failures warrant it. Automated reminder scheduling was retired by owner decision
  2026-09-17; staff monitor arrivals manually (`docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md`
  §16.6 item 1). Detailed current contract, owner decisions, and release receipts are
  in `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md`.

### Historical planning and review — 2026-09-08–09

The initial Codex plan/review was branch-only at `b6005273` with no PR at that time;
the owner asked for a read-only review before Slice 0. The discussion deck was carried
on the same branch from `e0166296` (`docs/plans/site-visit-materials/`, pushed
2026-09-08). Its decision and open-item inventory was planning history and is
superseded by the source and dated release evidence above. This record does not
reopen the former branch-review task.

### Current dependency-bound work

- **Request Workbench top-matter reconciliation — merged.**
  [VERIFIED via Git ancestry, 2026-10-19] PR #210 (merge `0fb2e47ba`)
  and PR #211 (merge `7c647b524`) are both on `main`. The cycle count,
  subtitle, view introductions, Scope controls and locator disclosure are no
  longer awaiting merge. The original recommendation remains in
  `docs/plans/CODEX_WORKBENCH_TOP_MATTER_RECOMMENDATION_2026-09-08.md`.
  This merge check does not independently establish deployment acceptance.

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
- Zoom speaker-alignment refinements `feature/unsupported-stretch-split` and
  `feature/reassign-direct-overlap` (2026-10-04) — built, Codex-reviewed and deliberately
  NOT merged: live probes showed the first targets a scenario that did not occur (the
  supposed uncaptioned participant never spoke) and the second moved one word while
  reintroducing a weak-overlap attribution hole. Not forgotten work. Reopen only on a new
  owner decision with a recording that exhibits the problem. Rationale and evidence:
  `docs/plans/ZOOM_VTT_SPEAKER_MAPPING_PLAN_2026-10-04.md` § "Deliberately NOT merged".
- Postgres access layer (one client seam, per-domain stores, raw-SQL ratchet, real-Postgres
  contract lane) — owner stopped after Stage 0 to regroup (2026-09-23); work continued past
  that point on `claude/postgres-access-layer` (Stages 1–2 and part of 3, last commit labelled
  unreviewed WIP). Tabled 2026-10-12 (Session 598): the branch is ~1,860 commits behind `main`
  and its fresh-install versions V55–V59 collide with `main`'s. Record: GitHub branch and draft
  PR #328 (do not merge); plan `docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md`
  exists only on that branch. If revived, restart from a fresh Stage 0 census on `main`; do not
  rebase the branch. Its Stage 0 "five migration-only tables" finding is not a fresh-install
  gap: `setup-database.js` replays `lib/db/migrations-manifest.json` via
  `scripts/lib/fresh-database-bootstrap.js`, verified on a throwaway Postgres 16 2026-10-12.
- Flat `lib/services` relocation (Plan B) — tabled by the owner 2026-10-12 (Session 598):
  navigation-only benefit against a repo-wide rename. Revival notes, including the
  `reviewer-engagement/` boundary-gate hazard, are in
  `docs/plans/FLAT_SERVICES_RELOCATION_PLAN_2026-10-11.md` §7.

## Completed implementation records — not backlog

Plans describing the Workbench build, Postgres-to-Dataverse reviewer migration, staff-editable
review questions, reviewer search timeout controls, service decompositions, route/service
consolidation, OData/chunk consolidation, prompt migrations, grantee portal construction, and
honorarium portal construction are implementation history or current operating references. They do
not become current work merely because their document status remains `active`.

- **Integrity Screener in the Workbench, with PD approval (2026-09-26/27).**
  [LIVE since 2026-09-30: PR #366 merged as `fdaec0b1f`, Production deploy
  `dpl_EbiwNNbuRgPGaAswWNGK7DsYyn7p`; migrations 056 and 057 applied and
  schema-verified; read-only production smoke passed (S552)] It adds:
  - a gated Integrity tab that screens the request's PI and Co-PIs automatically;
  - request-linked screening history;
  - an append-only PD approval/hold audit (`approved` means a complete screen plus the
    lead PD's approval for the current roster).
  
  Evidence and PD decisions stay in Postgres. Luna implemented, Sol reviewed, and Codex
  adjudicated the Claude Opus findings. Validation and residual limits are in
  `docs/plans/INTEGRITY_WORKBENCH_TAB_BUILD_BRIEF_2026-09-26.md` (on `main` since #366).
  
  **Open, not built:** one informational Dataverse flag, **Integrity review complete**
  (`wmkf_integrityreviewcomplete`), meaning a complete screen plus PD approval for the
  current roster; a screen alone is not enough. The investigation and a read-only
  metadata probe are on `main` (`docs/plans/INTEGRITY_DATAVERSE_FLAG_INVESTIGATION_2026-09-26.md`, `scripts/probe-request-integrity-metadata.js`):
  - production metadata checked, no existing equivalent column found by keyword;
  - sandbox metadata not checked.
  
  Next design work must cover invalidation after replacement screens, holds and roster
  changes (including edits made outside our apps), and durable retries when Dataverse sync
  fails.
  
  **Release record (S552):** two review rounds (Claude code review, then Codex
  adversarial gpt-5.6-sol); all fixed except finding 6 (strict SerpApi empty-result
  wording, needs a real zero-result response) and finding 9 (repeated Dataverse/SQL
  reads, performance only), both deferred. The owner chose not to restrict who may
  re-screen an approved request. Migration numbering: 055 post-presentation (#365),
  056–057 Integrity, 058 B4, 059 scheduled-email Part A.
  
  **Deferred:** the hard board-readiness gate waits for the staff recommendation/readiness
  workflow. Screening normally covers only applicants staff recommend for funding.

## Queue maintenance rule

When priority changes, update this file, `docs/STRATEGY.md`, the strategy wiki router, and the
current `SESSION_PROMPT.md` in the same reconciliation pass. Detailed implementation plans may
remain where they are; link them from the queue instead of duplicating their contracts here.
