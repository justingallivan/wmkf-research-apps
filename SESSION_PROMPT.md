# Session 622 Prompt: Vocabulary colleague review pending; Meeting Tracker audit saved

## Session 621 Summary — Briefing release and terminology review (Codex, 2026-10-19 PT)

### What Was Completed

1. **Printable briefing shipped.** [VERIFIED via source and GitHub PR #512] The owner-approved SE/MR briefing is merged as `1120f95ec10559b412f02866d4f971807b3fa5ea`. It combines proposal and staff discussion summaries, accepted current sentiment positives/concerns/open questions, and print/PDF styling. Links exist from Meeting Tracker and Discussion Sentiment. Earlier signed-in Production verification in this chat loaded 23 proposals (11 SE, 12 MR); this is a dated observation, not a fresh stop-time data read. Production's current label remains Program briefing.
2. **Meeting Tracker audits saved.** [VERIFIED via committed audit] Impeccable design and technical review found workflow overload and expanded detail cards on the landing page. Scores were 24/40 UX and 13/20 technical, with two P1 findings. No redesign was implemented. The audit is dated evidence, not a claim that every finding remains unchanged after future edits.
3. **Vocabulary inventoried and reviewed.** [OWNER DIRECTION] Keep Staff Deliberations as the Workbench request tab. Proposed names include Proposal discussion session, Proposal discussion brief, Proposal review packet, Post-presentation discussion (and its summary/sentiment), and Discussion summaries. Full table and owner-edited PPTX are tracked under `docs/plans/review/`. The exact owner-edited file was copied byte-for-byte. These remain proposals for colleagues, not authorization to rename the app or migrate identifiers.
4. **Main handoff.** [OWNER AUTHORIZATION] User explicitly requested the handoff on main. Only review/audit documentation was cherry-picked from the isolated branch; feature code was already merged through #512. Existing concurrent audio-release documentation and unrelated local artifacts were preserved.

### Commits

- `1120f95ec` — printable SE/MR briefings, PR #512 (branch implementation `6de803226`).
- `da0b1c13c` — owner-edited PPTX and searchable proposed vocabulary table (branch original `8f0552408`).
- `a6d7c6a04` — Meeting Tracker UX/technical audit (branch original `6dfe59e74`).
- Stop documentation commit follows these; use Git history for its identity.

## Concurrent Claude Session — Research PI/co-PI ORCID backfill and co-PI recovery (2026-10-19/20 PT)

Worked in worktree `WMKF_Apps-claude-session` on `claude/session-2026-10-19`; merged to main at owner request. All production reads/writes were owner-run.

1. **ORCID backfill, done.** [VERIFIED via owner-run `--verify`: 176/176] Awarded Research PIs and co-PIs (meeting dates 2016-10..2026-10, `akoya_programid` Medical / Science & Engineering Research, status Approved/Active/Closed): contact ORCID coverage 29 → 205 of 285. Matcher graded candidates from ORCID search, dated ORCID employments, ROR institution ids and email-domain institutions; blind validation on 29 known ORCIDs had 0 wrong high grades. Owner approved 180 in a workbook; resolve held back 4 duplicate-contact cases (Weizhe Hong, Peter Reiners, Kristy Townsend, Vincenzo Vitelli) and 4 nickname cases were owner-accepted. Three Codex adversarial reviews shaped the rules; the last finding was fixed by Codex and reviewed.
2. **`contact.setOrcidIfAbsent` gained opt-in `requireEtag`** [VERIFIED via `tests/unit/contact-set-orcid-require-etag.test.js`]: fails closed when the re-read has no ETag, including on 412 retries. Existing callers unchanged.
3. **Co-PI data facts.** [VERIFIED via owner-run probes] On those awards Dataverse records co-PIs only from 2024 on (52 co-PIs/27 awards, all contacts, 51 junction-linked); `contact.wmkf_copiorganizationname` and `akoya_collaboration` are unused. Connor confirmed GoApply will collect co-PI details, with institution on the contact and the link through `wmkf_apprequestperson` [PLANNED; recorded on the Atlas page].
4. **Older co-PI recovery (Project 2).** [VERIFIED via owner-run probes] SharePoint `RequestArchive3` holds proposals for every year; Dec 2016 proposals are mostly scans, June 2017 on are text; 2018–2023 have biosketch files for 130/148 grants. Owner-approved Haiku 5.5 extraction ($0.55) found 308 co-PIs on 154 grants (institution from email 242, stated 64, assumed 2); rule: co-PIs named in the documents, else faculty-level non-PIs. Output is a CSV only; nothing written.
5. **PII handling.** Workbooks, logs and CSVs were moved by the owner to a restricted SharePoint folder; the repo is public, so none of them belong in git.

## Next Items

### Owner Decision Needed

1. **Co-PI data structure — decided 2026-10-20.** Connor agreed in writing (relayed by the owner) to a lookup column on `wmkf_apprequestperson`, which the GoApply submission flow will fill. The owner assumes Connor's flow also links the co-PI contact to an account, and is alerting Connor. Wave 34 `lib/dataverse/schema/wave34-copi-institution-at-award/` (`wmkf_InstitutionAtAward` → `account`) **applied 2026-10-20**: sandbox [VERIFIED via metadata readback]; production [VERIFIED via owner-run `--execute` output, `✓ created`]. For sandbox runs, pass `DYNAMICS_SANDBOX_URL` on the command line, never in `.env.local` (`docs/CREDENTIALS_RUNBOOK.md`). Connor can wire the GoApply flow to it.
2. **Colleague vocabulary review.** [VERIFIED via owner request and saved review artifact] Review `docs/plans/review/PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md` and the linked owner-edited deck. Await feedback and explicit implementation scope. Do not treat the October 8 options as the newest proposed names.
3. **Meeting Tracker redesign direction.** [VERIFIED via audit and unchanged implementation] Choose the primary landing task and whether to separate task views / compact rows. Investigation and mockups did not authorize a redesign build.

### Verified Open (owner-paced)

1. **Institution at Award backfill** (PI + co-PI, awarded Research, meeting date 2017 on; owner scope 2026-10-20). [PLANNED; not built] Plan: `docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md`. Stage A covers PIs from the applicant account; its read-only resolve (`scripts/backfill-research-pi-institution-at-award.mjs`) is built and awaits an owner production run. Stage B matches the 308 extracted co-PIs to contacts (email, then name + institution), creates missing contacts and junction rows only with owner approval, and fills a contact's current institution only when it is empty. Follow the ORCID-backfill pattern (resolve/apply/verify, owner-run, Codex review). A staff member will handle the manual list: 4 unreadable 2017 grants (989734, 989935, 989982, 990613), one model failure (995777; a re-run usually fixes it), the 5 Dec 2016 scanned grants, and the ~18 2018–2023 grants with no biosketch file.
2. **Duplicate contacts** for the 4 held-back ORCID rows need cleanup in Dynamics before their ORCIDs can be written.

### Parked / Verification Limits

- The earlier November 1 vocabulary reminder remains historical scheduling context; colleague review is the current next action. No automatic rename is authorized.
- Other queue items require fresh owner selection and source checks. Do not interpret this handoff as permission for live sends, schema changes or file operations.
- Carry forward Session 620 limits: audio PR #513 is already released (`413c5f048`); no fresh Production transcription or 4 GB stress rerun was proved. Board activation is owner-reported complete, while full real release/email/archive acceptance remains unproved. Those are evidence limits, not authorized tasks.

### Do Not Reopen Without New Decision

- PRs #506, #511, #512 and #513 are merged. The printable briefing does not need rebuilding.
- Keep `codex/legacy-test-request-1002788` (`e563c5f3b`) unmerged per owner decision.
- Preserve completed Final Writeup review dates/versions through ordinary edits; do not broaden role eligibility from President assignment.
- Proposed naming does not imply route, database, API or persisted identifier migration.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/review/PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md` | Latest proposed table and link to exact owner-edited PPTX |
| `.impeccable/critique/2026-10-19T22-21-01Z__nts-meeting-tracker-meetingtrackerlist-js-ef43d395.md` | Dated Meeting Tracker audit and scope questions |
| `docs/NOMENCLATURE_GLOSSARY.md` | Canonical terminology decision record; decision remains open |
| `docs/CURRENT_WORK_QUEUE.md` | Priority routing; latest review artifact linked |
| `shared/components/meeting-tracker/ProgramBriefingView.js` | Released printable briefing UI |
| `docs/plans/evidence/ZOOM_AUDIO_IMPLEMENTATION_2026-10-19.md` | Concurrent Session 620 audio release evidence |
| `docs/plans/RESEARCH_PI_ORCID_BACKFILL_STAGE2_PLAN_2026-10-19.md` | ORCID backfill write plan (as built) |
| `scripts/apply-research-pi-orcid-backfill.mjs` | Owner-run resolve/apply/verify/rollback for approved ORCIDs |
| `scripts/match-orcid-backfill-candidates.mjs` | ORCID candidate matcher and blind validation |
| `scripts/extract-research-copi-candidates.mjs` | Haiku co-PI extraction from proposal documents (paid; needs owner approval) |

## Verification and handoff

Feature validation earlier in this chat: 138 focused tests, build and relevant gates passed before PR #512; GitHub merge and checks were re-read at stop. No feature tests or production writes are needed for this documentation-only handoff. Stop gates and final remote sync are recorded in the closing message.

Milestone determination: entry added to DEVELOPMENT_LOG.md, **Printable proposal and discussion briefings released**. CLAUDE.md needs no change. Claim-evidence report returned local observation state unavailable; no observation row was invented.

Bounded changed-fact reconciliation: newest vocabulary proposal is linked from the glossary, work queue and historical October 8 sheet; application vocabulary remains unchanged and colleague approval pending. This is not a whole-repository truth audit.

Unrelated untracked files in the shared main checkout remain owned by the other session/user: `output/` and `.impeccable/critique/2026-10-19T02-04-42Z__shared-components-board-writeups-boardwriteups-js.md`. They were not included or deleted. The isolated `codex/coordinated-session` worktree is retained, not archived.
