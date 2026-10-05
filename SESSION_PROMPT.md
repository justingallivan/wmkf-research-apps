# Session 576 Prompt: follow up on Site Visit materials only if needed

## Session 575 Summary — 2026-10-05 PT (Codex debugging lane)

[VERIFIED via source, GitHub PR checks/merges, Dataverse permission readback, and Vercel deployment inspection] The materials-template save fix and Admin-configurable deadline offset are deployed. Owner: Codex; worktree `/Users/gallivan/.codex/worktrees/debugging/WMKF_Apps-codex`; branch `codex/debugging`. The owner requested this closeout while retaining this worktree/branch. Documentation is pushed on this branch; no additional runtime change or release is part of the stop.

### What Was Completed

1. **Personal default save failure diagnosed and fixed.** Production logs showed missing Basic Read `prvReadwmkf_AppUserPreference` for the affected staff member. With owner authorization, the minimal `WMKF App Preferences Owner` role was applied and assigned; readback verified Basic Read as the only newly effective privilege. The API now distinguishes persistence failure from invalid template input. PR #436 merged as `5999a066e`; its Production deployment `dpl_9n9dKnstH9svsDQpQfckahDNK825` was Ready. No real email was sent or personal template saved by the agent.
2. **Materials deadline is an Admin setting.** Admin → Site Visits → Materials defaults saves `site_visit_materials.due_business_days` independently of the upload cap: whole business days 1–30, absent default 2, weekends excluded (not holidays). Invalid or unreadable stored configuration fails closed with 503. New collections read the setting; existing saved `due_at` values are preserved. A changed resulting deadline after preview requires a refreshed preview before sending. No table, migration, or Production setting seed was needed.
3. **Deadline release verified.** PR #439 merged as `458ba7d63e` after all 12 checks passed. Vercel Production deployment `dpl_FqFFJSFTqS4Nytc8TBnyhUGvwZ6M` reported Ready with the `applications.wmkeck.org` alias. Sign-in returned HTTP 200; the initial deployment error-log scan returned no entries. This does not establish signed-in Admin acceptance. Pre-release rollback target: `dpl_4bibqzwp6BCuiU2QYBjzmp5wW4Wh`.
4. **Other work preserved.** PR #434 Stage 1 is already merged (`32664485b`) and present in this worktree's starting ancestry; do not carry its former build task forward. PR #432 remains OPEN on `codex/staff-deliberations-rework` at this checkpoint and belongs to another worktree. This lane did not modify or merge it.

### Commits

- `f816c7978` — Fix materials default save errors and define minimal preference owner role (PR #436).
- `28e9424b0` — Make site visit materials deadline offset an Admin setting (PR #439).
- Documentation closeout commit follows on `codex/debugging`.

## Next Items

### Verified Open

1. **Signed-in acceptance remains unverified.** Evidence: this session performed focused tests, CI, deployment inspection, and public sign-in checks only. On ordinary use, confirm the affected staff member can save a personal default and an administrator can save/reload the deadline offset. Do not infer an unresolved defect from this testing limitation. New Production writes or real sends still require explicit authorization.

### Verify Before Acting

1. **Other lanes' carryovers below are historical, not this lane's worklist.** Recheck source, owner decisions, and current branch/PR state before using them. In particular, the old Stage 1 build task is DONE via PR #434; PR #432 is another agent's responsibility.
2. **Handoff integration:** this stop's docs are on `codex/debugging`, not a new main merge. Check current main and concurrent documentation ownership before any later integration. Remain in this worktree/branch unless the owner changes that instruction.

### Do Not Reopen Without New Decision

1. Both materials fixes are shipped. Do not rerun permissions writes, add a setting seed, change existing deadlines, send test invitations, or introduce new testing infrastructure merely to repeat this closeout.
2. Preserve Staff Deliberations PR #432 and unrelated agents' work.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/dataverse/schema/roles/app-preferences-owner.json` | Minimal preference-owner role specification |
| `pages/api/meeting-tracker/materials-email-preferences.js` | Personal-default persistence error handling |
| `lib/services/site-visit-materials/due-date-setting.js` | Strict offset setting read/write contract |
| `lib/services/site-visit-materials/collection-service.js` | Preview, deadline persistence, and stale-preview checks |
| `pages/api/admin/site-visit-materials-defaults.js` | Superuser defaults route, independent setting saves |
| `shared/components/admin/SiteVisitMaterialsDefaultsSection.js` | Admin deadline and upload-cap controls |
| `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` | Materials behavior and release contract |

## Testing and Stop-time Notes

- Feature verification: 28 focused Jest suites / 350 tests passed (2 suites / 21 tests skipped); type check, changed-file lint, applicable API/auth/boundary and documentation gates with sequential self-tests passed. Ten existing unrelated Admin effect warnings remained. Independent contract review found no blocking issue; its two requested negative-path tests were added. All final PR checks passed.
- No signed-in Admin UAT, test send, new migration, or Production setting seed was performed. CI Claude review uses subscription OAuth; no agent API credits or metered review product was used.
- Claim-evidence pilot report returned “local state could not be read”; no observation row was fabricated or borrowed from another session.
- Milestone determination: a new Production Admin capability and a permissions incident outcome shipped, so DEVELOPMENT_LOG.md receives “Site Visit materials preferences and configurable deadlines.” CLAUDE.md needs no new mutable feature catalogue or convention. The memory router is unchanged; older router-diet debt is historical and requires a fresh preflight.
- Stop changes documentation only. Doc-currency, fact-consistency, and Atlas gates plus their sequential self-tests passed, as did `git diff --check`. Branch verification and push target remain `codex/debugging`.

## Historical prior-lane handoffs — superseded checkpoints, not current instructions

The following records preserve other lanes' history. Their open-item labels and deployment assertions describe their own checkpoints; they are not revalidated by this debugging closeout. The current next items are above. The former Stage 1 build recommendation is superseded by merged PR #434.

## Historical Session 575 prompt — Stage 1 subsequently shipped in PR #434

## Session 574 Summary — 2026-10-04/05 PT (Site Visit card redesign shipped; summaries and Board sharing planned)

Owner opened with a screenshot of the Site Visit page and said the Post-presentation materials card and the Meeting transcription panel were confusing and overlapping, then that "pretty much everything about that panel sucks" (GUIDs with no timestamps, etc.). Everything below is on `main` and deployed unless marked otherwise.

### What Was Completed

1. **One "Recording and transcript" card replaces two cards.** Plan `docs/plans/SITE_VISIT_TRANSCRIPT_CARD_REDESIGN_PLAN_2026-10-04.md` (Impeccable Operate mode; Codex plan review; owner decisions 1–5). Built on `feature/site-visit-transcript-card`: Sonnet build → Opus review (12 findings fixed) → Codex code review (2 findings fixed; that fix round was test- and mutation-checked, not re-reviewed by Codex). PR #431 merged `38c767ae9`; Production deployment `dpl_AYayRueQDchJ7Qv2p4WMfNDnPAgA` Ready and tied to the merge commit. Owner looked at Production: "It looks better." New `shared/components/meeting-tracker/RecordingAndTranscriptCard.js` (~2,000 lines; composes the old materials logic and a rewritten transcription hook); `SiteVisitEditor` renders only it. Old `PostPresentationMaterialsCard.js` and `MeetingTranscriptionPanel.js` remain, unwired, for the rehearsal page (decision 5).
2. **Text transcripts skip the malware scanner** (owner decision: Zoom-generated, staff-uploaded, no execution surface). `finalizeTranscriptUpload` runs a local readability check for `.txt`/`.vtt` (UTF-8, no NUL, WEBVTT header), new permanent code `transcript_text_invalid` (also added to the finalize route's permanent set and the old card's list); PDF/DOCX keep Cloudmersive and the rejection names the tripped content flags. Closes S573 Verified Open §3.
3. **Jean suggestion sits in Speaker B's row** of the single editor; the editor seeds from the job on every load and is pinned to the run under edit (probe showed the old panel cleared names the job held). Closes S573 Verified Open §4 as a UI matter.
4. **Owner-run probe on request 1003222** (read-only Postgres): the "Draft" badge next to the published file's id was a labeling gap, not a service bug (draft row `703b5986` sources document `ea8e3af6`, published from op `4e7be123`); the blank editor was a component defect (job `7c1c5643` held seven aligned names). Both recorded in plan §8.
5. **Summaries and Board sharing plan written and Codex-reviewed, not built:** `docs/plans/SITE_VISIT_SUMMARIES_AND_BOARD_SHARING_PLAN_2026-10-04.md`. Two owner question rounds plus six decisions (all DECIDED 2026-10-05, §7): one recording with the staff discussion as its tail; boundary = last turn by a non-foundation speaker, proposed automatically, confirmed by a PC, stored on the transcript bundle as version 4 and frozen in the receipt; three new artifact types (presentation transcript 100000012, staff discussion summary 100000010, Board recording 100000011); summaries as reviewed drafts published to `.txt`; Board links serve only the presentation part; staff discussion may go to Anthropic per recording under a versioned, server-enforced summarization acknowledgment; `sonnet`/`haiku`; applicant PDF as input; the interim no-recording-outside gap accepted. Contract-reconcile (3 findings) and Codex adversarial review (5 findings, 2 citation corrections) folded in (§9, §10).
6. **Memory:** new `feedback-staff-ui-never-shows-internal-ids.md`, routed under Working Norms. DEVELOPMENT_LOG entry added for the card consolidation.

### Commits (main)
- `e0dea5d54`, `ce5f1a8d5` — card redesign plan and probe results.
- `38c767ae9` — merge PR #431 (branch commits `e87b72c68`, `6776b7cd5`, `b6225504e`, `7de7bbba4`).
- `5ffb8792a`, `1d38cf31e`, `20378bbaa` — summaries and Board sharing plan, decisions, Codex findings.
- Handoff commit follows.

## Next Items

### Verified Open

1. **Outside-link exposure.** Evidence: `presentation-page-service.js:25-30,145-152`, `briefing-page-service.js:91-99` project the full TRANSCRIPT and RECORDING; owner confirmed the recording continues after the applicants leave. Any Board presentation link or briefing link minted for such a request exposes staff deliberation. Owner-run read of `presentation_material_links` and `deliberation_briefing_links` tells whether one exists. Stage 1 closes it regardless.
2. **Build Stage 1 of the summaries plan** (plan §5): Postgres constraint migration (next after 066) extending the two `artifact_type` CHECKs; picklist insert 100000012 (owner-run sibling of `scripts/extend-requestdocument-artifacttype-pre-rp-brief.mjs`); manifest/source/formatter version 4 with the boundary frozen in the receipt; boundary proposal and confirmation in the card; presentation-transcript row; boundary-generation binding checked at context and open time; outside pages project the new type and stop projecting RECORDING; Board page file-mode check converted to an allowlist. No LLM. Owner-run: the migration and the picklist script.
3. **PR #431 acceptance checklist not fully run.** Evidence: owner said "It looks better"; the checklist in the PR body (publish from a fresh run, edit names and republish, upload a plain VTT, chat.txt-as-.vtt refused) was not confirmed executed. Run it on 1003222 when convenient.
4. **Staff video-sharing acceptance** (S571 order item 2). Evidence: untouched; the new card's recording line has Open, but whether intended staff can play the SharePoint MP4 was not traced.
5. **Leadership dashboard readiness** (S571 order item 3). Evidence: Codex worktree `/Users/gallivan/Code/WMKF_Apps-codex-dashboards` on `codex/leadership-dashboard-testing` at `9fec71a97`, not read in S572–S574.
6. **Sonnet 5.5 inventory amendment** (branch `audit/sonnet-55-consumer-inventory`): still lists two closed blockers; also add the two planned summary prompts as future `sonnet` consumers. Docs-only PR.
7. **Memory hygiene debt.** Evidence: router at 8,238 B before this session, grown by one pointer this session (`feedback-staff-ui-never-shows-internal-ids.md`); routine audit per `docs/MEMORY_HYGIENE_RUNBOOK.md` §10 still owed; `project-virtual-review-panel.md` is `status: closed` but not listed in `project-closed-work-archive.md`.
8. **Sweep item:** `docs/PC_MEETING_TRACKER_PLAN.md:105` says presentation materials are "PRODUCTION NOT DEPLOYED"; the materials plan front matter and the 2026-09-29 evidence say enabled in Production.
9. **Boundary rule confirmation:** speaker candidates carry `staff`, `roster`, `manual` (no Board class, `binding.js:104-107`); the plan treats `staff` and `roster` as inside the foundation. Confirm on a real visit before Stage 1 relies on it.

### Owner Decision Needed

1. **Authorize the Sonnet 5.5 pre-flip replay** (carried from S573; spends provider credits).
2. **Dependabot #115 (`braces`) and #116 (`http-cache-semantics`)** — upstream-blocked as of 2026-10-04.

### Parked

1. `feature/unsupported-stretch-split`, `feature/reassign-direct-overlap` — Zoom plan § "Deliberately NOT merged".
2. Items parked in S571 (#428 rehearsal, #328, #390, reminder cron); not revalidated.
3. Old `PostPresentationMaterialsCard.js` and `MeetingTranscriptionPanel.js`: retire together with the rehearsal page later (card plan §9 decision 5). Not before.
4. `multi-llm-service.js` `DEFAULT_MODELS.claude` dead config (S573).

### Verify Before Acting

1. Before any Dataverse write from a local shell: `DATAVERSE_PROD_WRITE_ACK="<purpose> <YYYY-MM-DD UTC>"`; seeds are create-only.
2. The auto-mode classifier blocks the agent from production reads/writes (even `node --check` on a script that reads prod); the owner runs them via `!`. Expect the same for the exposure read, the migration, and the picklist script.
3. Stage 1 touches outside-facing pages; Tier 1 branch + PR + owner merge, acceptance on 1003222 with the owner present.

### Do Not Reopen Without New Decision

1. Card redesign decisions 1–5 (card plan §9) and summaries plan decisions 1–6 (§7), all owner-decided 2026-10-04/05.
2. Model-as-veto, dominance 0.2, time-split editor, legacy VRP retirement, Integrity Screener haiku pin — earlier owner decisions.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/SITE_VISIT_SUMMARIES_AND_BOARD_SHARING_PLAN_2026-10-04.md` | the next build; §4.7 fan-out table, §4.8 version coupling, §9/§10 review records |
| `docs/plans/SITE_VISIT_TRANSCRIPT_CARD_REDESIGN_PLAN_2026-10-04.md` | shipped card; §6 state-to-copy table, §13 build/review record |
| `shared/components/meeting-tracker/RecordingAndTranscriptCard.js` | the live card (`useMaterials`, `useTranscription`, `describeCurrentTranscript`, `SpeakerEditor`) |
| `lib/services/post-presentation-materials/material-service.js` | `finalizeTranscriptUpload` text check; `publishMeetingTranscriptBundle` |
| `lib/services/post-presentation-materials/material-model.js:15-21,103-105,119-125` | shared type allowlist, external-backing guard, winner rule |
| `lib/services/meeting-tracker-transcription/bundle.js:114-150` | manifest and source validators (version lists) |
| `lib/db/migrations/055_post_presentation_materials.sql:71-72,146-147` | the two `artifact_type` CHECK constraints Stage 1 must extend |
| `scripts/extend-requestdocument-artifacttype-pre-rp-brief.mjs` | precedent for the owner-run picklist insert |
| `shared/components/workbench/ResearchPresentationFollowUp.js` | Staff Deliberations segment to grow in Stages 2–3 |

## Testing

```bash
npx jest tests/unit/recording-and-transcript-card.test.js tests/unit/post-presentation-material-service.test.js tests/unit/meeting-tracker-visit-editor.test.js
npx eslint shared/components/meeting-tracker/RecordingAndTranscriptCard.js
npm run -s check:request-document-writers && npm run -s check:types
```

## Earlier handoff — Session 573 (historical; its open items are carried above)


### Session 573 Summary — 2026-10-04 PT (owner decisions; legacy VRP retired; Integrity Screener on Haiku)

Owner picked "address the owner decisions" first. Both landed as fleet-level facts rather than the one-line items the Session 572 handoff framed. Everything below is on `main` and deployed unless marked otherwise.

### What Was Completed

1. **Legacy Virtual Review Panel retired** (owner decision). PR #429, merge `9240042f0`, Production deployment 6848777180 success. Page, SSE route, `panel-review-service.js`, `literature-search-service.js`, prompt file and output schema moved to mirrored paths under `_archived/`; `APP_LIFECYCLE_REGISTRY['virtual-review-panel']` is `deprecated` (successor `review-panel`); removed from `APP_REGISTRY`, `APP_MODELS`, and the admin label map (successor now labeled "Review Panel"). Retained: `panel_reviews` / `panel_review_items` history, existing grants, `multi-llm-service.js` + `lib/utils/vrp-providers.js` (successor's provider vocabulary; `MultiLLMService.call` now has no runtime caller), `VRP_ALLOWED_PROVIDERS`. Canonical app count 14 → 13. Docs/Atlas/wiki/memory/dev log reconciled.
2. **Integrity Screener on the haiku tier with a refusal guard** (owner decision "Haiku if available"). PR #430, merge `df274539c`, Production deployment 6848756433 success. `integrity-screener` was missing from `APP_MODELS`, so `analyzeWithHaiku` silently inherited the `sonnet` default; now `{ model: 'haiku', fallback: 'sonnet' }` (fallback = LLMClient 529-overload swap only) and the call is wrapped in `requireAcceptedLlmResponse`. Owner confirmed no `CLAUDE_MODEL_INTEGRITY_SCREENER` env var exists in Vercel or `.env.local`; the admin Models API rejects keys outside `APP_MODELS`, so no DB override can exist. New test `tests/unit/integrity-service-model-and-refusal.test.js`.
3. **Sonnet 5.5 admission reframed.** `resolveTierSync` picks the newest *reviewed* family member from the live model list, so adding Sonnet 5.5 to the registries flips every `sonnet`-tier app — a fleet move, not a one-prompt pin. Complete LLM consumer inventory written (`docs/audits/SONNET_55_CONSUMER_INVENTORY_2026-10-04.md` on branch `audit/sonnet-55-consumer-inventory`, pushed, no PR). Its two sonnet-tier refusal blockers are both closed by items 1 and 2.
4. **Dependabot rechecked:** `http-cache-semantics` 4.3.0 (published 2026-10-04) does not touch `max-stale` (tarball diff: Vary fix + `status()` accessor only); `braces` has no fix. Both tooling-only; keep open.
5. **Plan correction:** the Zoom alignment plan said "Sonnet 5.5 proposes"; the `sonnet` alias resolves to Sonnet 5 (`34785709e`).

### Commits (main)
- `28510be43`, `34785709e`, `5e1333826`, `d92a48d7f`, `f5e4df6c9`, `1f05600f5` — handoff/doc commits.
- `df274539c` — merge PR #430 (branch commit `fbf196810`).
- `9240042f0` — merge PR #429 (branch commits `d276790da`, `b4c218f74`, `e896470c1`).

### Codex worktree
`/Users/gallivan/Code/WMKF_Apps-codex-dashboards` on `codex/leadership-dashboard-testing` (synced with origin at `9fec71a97`; two commits: readiness test + assessment record; `package-lock.json` locally modified). Not touched in S573.

## Next Items

### Owner-Stated Next Focus
1. **"Work to do on the transcription issue."** Owner stated this at the close of S573 without naming which issue. Evidence: owner words 2026-10-04. Ask which before starting; candidates already recorded below are Verified Open §3 (post-presentation transcript slot rejects plain VTT as malware) and §4 (Jean unresolved on job `7c1c5643`). Do not assume either.

### Verified Open
1. **Staff video-sharing acceptance** (owner order item 2 from Session 571). Evidence: untouched in S572–S573; `docs/plans/POST_RESEARCH_PRESENTATION_MATERIALS_PLAN_2026-09-21.md`. Trace the sharing path and confirm intended staff can open the video.
2. **Leadership dashboard readiness** (owner order item 3). Evidence: Codex worktree commits `a76b0f31a`, `9fec71a97` exist but were not read. Start by reading the assessment record there; establish the target date.
3. **Post-presentation materials transcript slot rejects plain VTT as malware** (`scan_infected` from Cloudmersive advanced scan on an 81 KB WEBVTT text file). Evidence: owner report; `lib/services/post-presentation-materials/material-service.js` discards the content flags. Minimum fix: record `contentFlags` on infected verdicts; then decide a text-file policy. Separate surface from the alignment VTT upload, which has no scan.
4. **Jean on job `7c1c5643`** is a manual pick in the Detected speakers editor (suggestion offered). Stray one-word lines in rapid exchanges (~30) stay as diarized by design.
5. **Amend the Sonnet 5.5 inventory before it merges.** Evidence: `docs/audits/SONNET_55_CONSUMER_INVENTORY_2026-10-04.md` (branch `audit/sonnet-55-consumer-inventory`) still lists integrity-service and VRP synthesis as open blockers; both closed on `main` (items 1–2 above). Update "Decision state", open a PR, docs-only.
6. **Memory hygiene debt.** Evidence: Stop/Start hook notice — `.claude-memory/MEMORY.md` is over the 8 KiB routine-audit trigger (router diet, `docs/MEMORY_HYGIENE_RUNBOOK.md` §10); `.claude-memory/project-virtual-review-panel.md` is now `status: closed` but not yet listed in `project-closed-work-archive.md`.

### Owner Decision Needed
1. **Authorize the Sonnet 5.5 pre-flip replay** (`docs/MODEL_CHANGE_STRATEGY.md` §4 step 5, `scripts/validate-reviewer-analyze.mjs`; reviewer-finder's fallback is the `sonnet` tier). Spends provider credits. After a clean replay: mirror commit `bbf6457a8` (capability + pricing entries, tests; keep `LAST_CAPABILITY_REVIEWED_AT` unchanged) and accept that the whole `sonnet` tier flips. Vendor facts verified 2026-10-04 are in the inventory doc. Note for the entry author: vendor table lists Sonnet 5.5 thinking as "Adaptive" (floor is `between_tools`), not "always on" like Opus 5.5; pick the `thinkingMode` enum deliberately.
2. **Dependabot #115 (`braces`) and #116 (`http-cache-semantics`)** — upstream-blocked as of 2026-10-04 (see item 4 above). Reassess only when a release that touches the advisory appears.

### Parked
1. `feature/unsupported-stretch-split`, `feature/reassign-direct-overlap` — see the Zoom plan § "Deliberately NOT merged". Re-open only on a new owner decision with a recording that exhibits the problem.
2. Calibrated timing votes for sub-floor cues and streaming audio upload — `docs/CURRENT_WORK_QUEUE.md`.
3. Items parked in Session 571 (#428 rehearsal, #328, #390, reminder cron) remain parked; not revalidated.
4. `multi-llm-service.js` `DEFAULT_MODELS.claude` (dated Sonnet 4 id) is dead config since S573; leave unless the file is next touched.

### Verify Before Acting
1. Before any Dataverse write from a local shell: the target interlock requires `DATAVERSE_PROD_WRITE_ACK="<purpose> <YYYY-MM-DD UTC>"`; seeds are create-only.
2. The auto-mode classifier blocked the agent from production reads/writes (Vercel env pull, migrations, seeds); the owner ran those via `!`. Expect the same.
3. Production probes from an unauthenticated shell cannot distinguish a removed route from a live one on applications.wmkeck.org (everything 307s to sign-in). The build is the evidence for route removal; a signed-in look at the landing page confirms the tile is gone.

### Do Not Reopen Without New Decision
1. Model-as-veto, dominance 0.2, rendered-slice attribution, backchannel exemption — owner decisions recorded in the Zoom plan § 2.
2. Time-split speaker editor — owner declined 2026-10-04 ("not worth the effort").
3. Legacy Virtual Review Panel retirement and the Integrity Screener haiku pin — owner decisions 2026-10-04, shipped.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/audits/SONNET_55_CONSUMER_INVENTORY_2026-10-04.md` (branch) | every runtime LLM consumer and its refusal handling; admission preconditions |
| `shared/config/appRegistry.js` | `APP_LIFECYCLE_REGISTRY['virtual-review-panel']` retirement record |
| `shared/config/baseConfig.js` | `APP_MODELS` incl. new `integrity-screener` row |
| `lib/services/integrity-service.js` | `analyzeWithHaiku` — haiku tier, sonnet 529 fallback, refusal guard |
| `lib/services/model-resolver.js` | `resolveTierSync` / `isReviewedModel` — why registry admission is a fleet move |
| `_archived/README.md` | what was archived and why (six S573 rows) |
| `lib/services/transcription-pilot/zoom-vtt.js`, `lib/services/meeting-tracker-transcription/alignment-service.js` | Zoom alignment pipeline (S572) |
| `scripts/probe-meeting-speaker-alignment.js` | owner-run live alignment diagnostic |

## Testing

```bash
npx jest tests/unit/integrity-service-model-and-refusal.test.js tests/unit/integrity-service-strict-sources.test.js
npx jest tests/unit/vrp-providers.test.js tests/unit/multi-llm-service.test.js tests/unit/review-panel-generation.test.js
npx jest tests/unit/transcription-pilot tests/unit/meeting-tracker-transcription
node scripts/probe-meeting-speaker-alignment.js            # owner shell; newest job with a VTT
```

## Earlier handoff — Session 572 (historical; its next items are carried above)

## Session 572 Summary — 2026-10-04 PT (Zoom caption speaker alignment shipped; Claude Fable orchestrating)

Owner directive: Fable orchestrates; Sonnet builds; Opus reviews; Fable final review; Codex adversarial review until satisfied; owner makes every merge decision. Everything below is on `main` and deployed unless marked otherwise.

### What Was Completed

1. **Zoom VTT speaker alignment** (plan `docs/plans/ZOOM_VTT_SPEAKER_MAPPING_PLAN_2026-10-04.md`). Optional Zoom WebVTT uploaded with the audio in the Meeting transcription card; after the transcript is ready a workflow step aligns speaker IDs to Zoom names. Codex plan review 4 rounds; Codex code review 5 rounds (four verified identity bypasses fixed). Migration 065 applied to Production, prompt row `meeting-transcript.speaker-alignment` v1 seeded (owner ran the seed with `DATAVERSE_PROD_WRITE_ACK`), merge `c99f8d966`.
2. **Verifier revision after the first live run:** verified wording support decides, the model is a veto only; dominance ratio 0.2 replaces any-second-name conflicts; per-speaker `reasons`; `basis` model/support. Codex 3 rounds. Merge `c8901db6b`.
3. **Audio cap 50 → 200 MiB** (one constant in `lib/services/transcription-pilot/limits.js`; migration 066 applied). Merge `bde1bb41f`. Streaming upload stays queued.
4. **Transcript formatter v3:** one paragraph per speaker turn with start time; v1/v2 publications rebuild byte-identical; surname-first Zoom names shown "Given Surname", collision-safe. Codex 2 rounds. Merge `005d2fef5`.
5. **Short-utterance reassignment** from Zoom evidence (continuous caption coverage; backchannel list; content words need captioned evidence). Codex 3 rounds. Merge `0caac4972`.
6. **Read-only diagnostic** `scripts/probe-meeting-speaker-alignment.js` (owner-run; prod reads). Reruns the deterministic pipeline on a live job: support tables, clock calibration, verifier outcome, reassignment and why-not-moved reasons.
7. **Live rehearsal, Request 1003222:** three uploads of the Oregon State recording. Final job `7c1c5643`: 7 of 8 diarized speakers named automatically (Jean unresolved, six captions), 41:25 misattribution fixed, names first-name first. Allison Keller did not speak; earlier belief that she was merged into Andrea's ID was disproved by the probe.
8. **Deliberately NOT merged** (documented in the plan § "Deliberately NOT merged" and the work queue Parked section, `14ddf0543`): `feature/unsupported-stretch-split` (targets a scenario that did not occur) and `feature/reassign-direct-overlap` (one word of benefit, Codex-reproduced regression).

### Commits (main)
- `c99f8d966`, `bde1bb41f`, `c8901db6b`, `005d2fef5`, `0caac4972` — the five merges above.
- `14ddf0543` — parked-branch rationale. Handoff commit follows.

### Codex worktree
`/Users/gallivan/Code/WMKF_Apps-codex-dashboards` on `codex/leadership-dashboard-testing` (synced with origin at `9fec71a97`, two commits: readiness test + assessment record; `package-lock.json` locally modified from npm install, not committed). Owner was given a paste-in brief; outcome not reviewed this session.

## Earlier handoff — Session 571 (historical; items 1 of its order completed above, 2–3 still open)

## Session 571 Summary — 2026-10-03 PT (Codex Factory recovery closeout)

[OWNER DECISION] Stop for the evening. Tomorrow's order is transcript-generation
acceptance, staff video-sharing acceptance, then leadership-dashboard readiness.
The owner thinks dashboards are mostly done; that is an expectation to verify,
not a new completion claim or instruction to rebuild them.

### Completed and retained

- [VERIFIED via GitHub] Draft PR #428 contains Sandbox-only fresh Basic file
  readback recovery on `codex/factory-readback-proof`. Commits: `2bb311927`
  (offline proof), `c751bda5f` (implementation), `18d9c794e` (review evidence).
  All PR checks passed at `18d9c794e`; a handoff-only push needs fresh CI.
- Luna built, Sol and root reviewed, and Claude Fable approved via subscription
  OAuth. Eight focused suites / 280 tests passed, including six real PostgreSQL
  tests. Production recovery is refused; original six-hour freshness stays.
- [VERIFIED via read-only Sandbox workflow definitions/account inputs] The
  inspected acknowledgment workflow's email branch is not reached by Basic
  create fields. GoVerify's current predicate is true and would update the
  shared Foundation account. No fixture was created; no recovery was executed.
  Private sanitized receipt: `/tmp/factory-pr428-create-preflight.json`.
- [OWNER DECISION] Park the live rehearsal and isolated-applicant fixture work.
  Do not spend more time constructing fixtures. Revisit only with a suitable
  fresh run or a new owner decision. #428 remains draft/unmerged; neither
  production promotion nor live proof is claimed.
- Earlier releases and the abstract repair are recorded in
  `docs/audits/AUTONOMOUS_FOLLOWUP_2026-10-03.md`. Historical test-email repair is
  owner-closed; retain Request 1003308. No new sends, deletions, production writes,
  or shared-workflow changes occurred in this recovery rehearsal preflight.

### Next session — owner-requested order, verify before acting

1. **Test transcript generation.** Existing transcription shipped in PRs #416
   and #418 with a bounded synthetic acceptance (historical Session 567 below).
   Begin with the current UI and one appropriate owner-selected recording;
   verify generation, speaker handling, transcript output and staff visibility.
   Do not reopen infrastructure work unless this test exposes a concrete gap.
   Prior privacy limits remain; no blanket confidential-recording clearance.
2. **Test video sharing with staff.** Trace the existing sharing path and check
   that intended staff can open/play the video with correct access. Exact
   recordings, audience and current readiness remain to be established; saving
   this agenda does not itself authorize sending messages to staff tonight.
3. **Assess leadership dashboard delivery.** Inventory what already exists,
   inspect current data and intended leadership access, and list only actual
   remaining delivery gaps. [UNKNOWN] Current completeness and delivery date;
   the owner's expectation is that the dashboards are mostly done. Establish
   the target date if none is already recorded before declaring on-track status.

### Parked / do not reopen automatically

- #428 live fixture/recovery rehearsal and Production recovery promotion.
- #328 Postgres access-layer Stage 0: explicit DO NOT MERGE / regroup hold.
- #390 documentation-only refactor assessment: preserve earlier hold; no new
  refactor selected. GitHub confirmed these and #428 are the only open PRs at
  this checkpoint.
- Automatic reviewer reminder cron stays held. No resend or historical email
  repair. Office Mac checks, source-refusal observation and dependency alerts
  are separate watch items, not tomorrow's active build agenda.

### Handoff / validation

- Continue Luna reconnaissance/build → Sol review → root final → Claude Fable
  adversarial review through OAuth when code work is needed. Bound review loops;
  root takes over if they become incremental tail-chasing.
- The owner authorized copying this handoff alone to `main`. Recovery runtime
  remains on the unmerged #428 branch. The original dirty checkout and prior
  lanes below are preserved.
- Milestone determination for this recovery closeout: no new production
  capability or cutover shipped; no new DEVELOPMENT_LOG entry required.
- No CLAUDE.md or memory-router change. Claim-evidence report could not read
  local observation state; no observation row fabricated.
- Documentation-only closeout; run relevant documentation gates. Existing
  runtime-test and review evidence remains bounded as described above.

## Earlier lane handoffs — historical; not tomorrow's worklist

# Session 571 Prompt: dependency security closeout; two upstream alerts remain

## Session 570 Summary — 2026-10-03 PT (Codex dependency-security lane)

[VERIFIED via PR #419 merge, GitHub alerts and Production deployment status]
The narrow dependency security fix is merged and deployed. Eight alerts are fixed;
two remain open without a patched release at the October 3 checkpoint. The owner
requested this documentation handoff on `main`; no additional runtime work is
authorized by this closeout.

### What Was Completed

1. Scoped `@workflow/core` overrides select `devalue` 5.9.3 and `nanoid` 5.1.16.
   Workflow remains 5.0.0; unrelated dependency resolutions were preserved.
2. Luna built, Sol reviewed, root verified, and Claude Fable approved through
   subscription OAuth only. No direct model API or metered review substitute was
   used. Clean installation, production build, lint, 67 focused tests and relevant
   gates passed; all final-head PR checks passed before owner-authorized merge.
3. Compatibility coverage includes a real older serializer fixture decoded by
   the current Workflow error codec. This is bounded evidence, not exhaustive
   persisted-state compatibility. Shared-memory rejection is a safety invariant
   that also passed before the patch, not proof of a newly fixed exploit.
4. Merge `bf3ab8e17` received successful Production deployment status (GitHub
   deployment 6830197259); the production sign-in page returned HTTP 200. No new
   authenticated business-workflow or provider test is claimed for this patch.

### Commits / Key Files

- `b31b584a2` — scoped security dependency overrides and compatibility tests.
- `0b75d4265` — main integration preserving concurrent documentation corrections.
- `bf3ab8e17` — merged [PR #419](https://github.com/justingallivan/wmkf-research-apps/pull/419).
- `package.json`, `package-lock.json`,
  `tests/unit/dependency-security-compat.test.js` — complete final PR surface.

### Next Items

- **DONE:** Reviewed fix, final CI, owner-authorized merge and deployment check.
  GitHub readback confirms alerts #65 and #108–114 fixed.
- **Verified open / upstream-blocked:**
  [#115](https://github.com/justingallivan/wmkf-research-apps/security/dependabot/115)
  (`braces` 3.0.3, GHSA-vfj7-8cjw-p6xm) and
  [#116](https://github.com/justingallivan/wmkf-research-apps/security/dependabot/116)
  (`http-cache-semantics` 4.2.0, GHSA-ch52-4w7c-c8xp). No patched release was
  available at this checkpoint. Both were traced to tooling dependencies; no
  direct first-party application imports or production file-trace inclusion was
  found. That does not make the packages safe. Keep alerts open; reassess when an
  upstream fix appears or new application exposure is found. No automatic
  follow-up monitor was created.
- **Known limitation:** Overrides do not rewrite bundled serializer copies in
  Workflow artifacts, including its developer observability UI. The inspected
  application runtime uses external patched `devalue`; an upstream Workflow
  release is needed to refresh bundled copies. Do not claim every embedded copy
  or all dependency vulnerabilities are fixed.
- **Verify before acting:** Other lanes below are historical handoffs, not
  revalidated worklists. Their release state and authorization need fresh checks.
- **Milestone decision:** Routine dependency maintenance, not a new capability,
  cutover or architecture; no DEVELOPMENT_LOG entry required. No CLAUDE.md or
  memory-router change was needed. Original checkout changes remain untouched.
- Claim-evidence report could not read local observation state; no row was
  fabricated. This stop changes documentation only; documentation gates apply.

## Prior-lane handoffs — historical; not revalidated in Session 570

## Session 569 Summary — 2026-10-03 PT (Codex performance lane)

[VERIFIED via GitHub PR/checks, remote main and deployment status] PR #422
merged to `main` as `df55ad954` after all 12 checks passed. The targeted Meeting
Tracker read optimization and seven baseline test repairs are complete. The
owner authorized the merge conditional on clean CI and requested this final
handoff on `main`. GitHub records a successful Production deployment for the
merge commit (deployment `6830261304`). No authenticated production browser
smoke or live latency measurement was performed in this lane.

### What Was Completed

1. Tracker callers request the additive schedule projection, sharing Workbench
   selection without unused reviewer rollups. Site Visit summaries are read in
   paginated batches instead of one detail read per visit. Legacy/full API
   behavior, authorization, row visibility and missing-data notices remain.
2. Seven pre-existing failing suites were repaired with exact inventories,
   isolated mocks and meaningful negative coverage. The rehearsal operator now
   verifies the complete current projection and rejects absent cleanup columns.
3. Luna built and tested; Sol and root reviewed; Claude Fable approved through
   subscription OAuth. No direct provider API or alternative paid review product
   was used. Review findings were closed in bounded rounds.
4. Before integration with newer main, the local full suite passed 1,214 suites
   and 18,769 tests (8 suites / 72 tests skipped). Build, lint, types and 69
   check scripts passed. Main integration retained its transcription maintenance
   and recovery behavior. The integrated local full run passed 1,251 suites and
   20,181 tests (11 suites / 142 tests skipped), with five snapshots passing.
   Final PR CI, including canonical build and PostgreSQL integration, passed.

After main integration, all seven repair suites passed (133 tests). Sol accepted
the conflict resolutions with no material runtime change; current inventory is
25 cron handler files, 24 exact scheduled paths and 23 scheduled endpoints.
Main's daily/hourly transcription controls and newer assertions are preserved.

### Commits and Evidence

- `4b95863de` — targeted Tracker read optimization.
- `170145c9c` — baseline repair and review records.
- `3ffb20c46` — integrated main and reconciled verification contracts.
- `f952b20db` — pre-merge handoff, preserving concurrent lane history.
- `df55ad954` — PR #422 merge to `main`, after 12 passing checks.
- `docs/plans/MEETING_TRACKER_READ_PERFORMANCE_EXECUTION_2026-10-03.md`
  and its linked review receipt — behavior, reduced-call evidence and rollback.
- `docs/plans/BASELINE_TEST_REPAIRS_EXECUTION_2026-10-03.md`
  and its linked Fable receipt — diagnoses, tests and review disposition.

### Next Items

- **DONE:** Agreed targeted implementation, baseline repairs, review, CI and
  owner-authorized merge. No large refactor or new caching layer is selected.
  Do not reopen those without a new requirement or measured bottleneck.
- **Unverified / not claimed:** Authenticated production browser acceptance and
  measured user-visible latency improvement. Deployment success does not prove
  those properties. Any follow-up should begin with a concrete observed issue
  or an explicitly requested measurement, not a new speculative refactor.
- **Preserved:** The original transcription checkout's unrelated dirty test and
  untracked planning/audit documents are untouched. Other lanes below are
  historical handoffs, not newly validated worklists.
- **Milestone decision:** No new architecture or capability was introduced; this
  contained optimization and verification repair needs no DEVELOPMENT_LOG entry.
- Claim-evidence `--current` could not run because this session has no exported
  observation key. No observation row was fabricated or borrowed from another
  session. No memory-router edits were made by this lane.

## Prior-lane handoffs — historical; not revalidated in Session 569

## Session 568 Summary — 2026-10-02/03 PT (Codex admin-alert lane)

[VERIFIED via source, PR CI/merges, Vercel deployment and protected Production
maintenance/alert readback] Pricing remediation and reviewed Opus 5.5 coverage
are shipped. The owner authorized merge after CI and requested this closeout on
`main`. Evidence remains bounded; no private operational data or credentials
belong in the handoff.

### What Was Completed

1. **Pricing:** Replaced the app-local token denominator with matching provider
   cost/usage cohorts, separated cache lifetimes, preserved alerts on incomplete
   reports and corrected displayed dollar units. The protected Production check
   completed 15 comparisons without drift and auto-resolved the pricing alert.
2. **Model selection:** Reviewed Opus 5.5 pricing/capabilities, including its cache
   read override. Automatic tiers require specific coverage in both registries.
   The canary now flags Sonnet 5.5, which remains excluded from automatic tiers.
3. **Transcription:** Read-only inspection found no processing backlog at the
   October 2 checkpoint. One expired job retains a conservative late-upload safety
   watch. The October 3 email supplied by the owner bears the October 2 8:51 PM
   Pacific timestamp, before this release; it is consistent with that warning,
   not new evidence of a processing failure. No new October 3 live probe occurred.
4. **Verification:** Fresh independent review, 118 focused tests, scoped gates and
   full PR CI passed. Runtime PR #420 and evidence PR #421 are merged. The local
   dependency-symlink Turbopack limitation was covered by the canonical CI build.

### Commits

- `bbf6457a8` — provider pricing audit scope and reviewed model selection; merged
  via PR #420 as `a829ba94c`.
- `5cb14b859` — verified production evidence and milestone; merged via PR #421
  as `43de4bf2c`.

### Next Items

- **DONE:** Agreed pricing fix, Opus review, selection guard, CI, owner-authorized
  production release and pricing/model check readback. No further runtime work is
  authorized by this documentation closeout.
- **Verified open at October 2 checkpoint:** Sonnet 5.5 review. Source entries are
  absent and the canary reports ancestor coverage; do not advance the global
  review date or enable it automatically without a specific review.
- **Parked:** Transcription-watch closure and calendar-triggered cleanup
  observation. Preserve the safety watch; new relevant failures or an explicit
  owner request are the reopen triggers.
- **Known limitation:** Keyed alert deduplication retains the first payload, so
  the open model card can still name Opus while the latest canary identifies
  Sonnet. Verify fresh run details before using the card as current evidence.
- **Verify before acting:** Older lane handoffs below are historical, not current
  worklists. Their live state and owner authorization require a fresh preflight.

### Key Files / Handoff

- `docs/audits/ADMIN_ALERT_REMEDIATION_2026-10-02.md` — source contract, validation,
  deployment outcome and rollback baseline.
- `pages/api/cron/pricing-refresh.js`, `lib/services/anthropic-admin.js` — matched
  provider reports; `scripts/probe-admin-alert-operations.js` — content-free,
  explicitly scoped read-only Postgres probe.
- `lib/services/model-resolver.js`, `lib/services/model-capabilities.js`,
  `lib/utils/model-pricing.js` — reviewed selection and Opus coverage.
- Production milestone is already recorded in DEVELOPMENT_LOG.md; this stop
  needs no second milestone entry or mutable script catalogue in CLAUDE.md.
- Claim-evidence observation report could not read local state; no observation
  row was fabricated. The original transcription checkout's unrelated changes
  remain untouched.

## Prior-lane handoffs — historical; not revalidated at Session 568 closeout

## Session 567 Summary — 2026-10-02 PT (Codex transcription lane)

[VERIFIED via merged PRs, production configuration/deployment readback, authenticated browser, and exact cleanup receipts] Meeting Tracker transcription is enabled for authorized staff. The owner accepted completion and requested this closeout on `main`. Operational evidence stays private; do not copy recordings, transcript text, secrets, test-record identifiers, or detailed operational receipts into public documentation.

### What Was Completed

1. **Production release:** PR #416 integrated the request-bound flow; PR #418 added daily cleanup and hourly Workflow recovery through the existing operations-alert channel. No minute polling was added. Production access and both schema-readiness controls are on; the separate Admin pilot switches remain off in the shared application.
2. **Acceptance:** An approved short synthetic recording passed private upload, `universal-3-5-pro`, detected-speaker naming, minute-grouped TXT, VTT download, governed publication, and Staff Deliberations projection. The test's temporary content and exact published files were removed; its document was soft-retired. Audit receipts and the late-upload safety watch remain intentionally; existing meeting details/materials were preserved.
3. **Review/verification:** Luna built/reconnoitered, Sol reviewed, root verified, and Fable approved the bounded release through subscription OAuth only. Final PR checks passed. One unrelated Jest deadline flake passed on retry without changing or bypassing that test. Both maintenance modes returned 200 when triggered through the platform; the warning email was accepted for delivery, not inbox-verified.
4. **Privacy:** Approved non-sensitive recordings only. Owner-confirmed training opt-out and one-day provider retention are accepted; true zero retention and blanket confidential-use clearance are not established.

### Commits

- `23667af9d` — merge PR #416, transcription integration and disabled-release preparation.
- `1cc4302d7`, `302e9de27` — maintenance/alerts and scheduled-job census/reference corrections, merged in PR #418 as `aa7d5b0e1`.

### Next Items

- **DONE:** Agreed implementation, review, production enablement, bounded acceptance, and synthetic-content cleanup. Do not reopen infrastructure work without a new requirement or observed failure.
- **Owner decision needed:** Broader confidential use requires separate privacy assurances and an explicit processing decision; do not relabel sensitive recordings as non-sensitive.
- **Parked / not claimed:** Maximum-size live test, callback delivery, calendar-triggered maintenance observation, inbox receipt, and closure of the conservative late-upload watch. Manual platform delivery and content deletion are verified, not proof of those separate properties.
- **Verify before acting:** Other lanes below are preserved historical handoffs, not revalidated worklists. Re-probe their state before acting; no unrelated cleanup is authorized by this closeout.

### Key Files / Testing

- `shared/components/meeting-tracker/MeetingTranscriptionPanel.js`, `lib/services/meeting-tracker-transcription/` — request-bound review and publication.
- `pages/api/cron/drain-transcriptions.js`, `vercel.json` — daily cleanup and hourly recovery/alerts.
- `docs/plans/MEETING_TRACKER_TRANSCRIPTION_PLAN_2026-10-01.md`, `docs/atlas/postgres-meeting-transcript-publications.md` — contract and persistence. <!-- drain-table:ignore reason=transcription-atlas-filename-not-retired-table -->
- Release verification: focused tests, deployment/API/documentation gates and sequential self-tests, final PR CI, and production browser acceptance. This stop is documentation-only; run doc-currency/Atlas checks for changed references.
- Claim-evidence report could not read local observation state; no observation row was fabricated. The original checkout's unrelated dirty test file remains untouched.

## Prior-lane handoffs — historical; not revalidated in Session 567

## Session 566 Summary — 2026-10-02 PT (Factory follow-ups lane, Claude Fable, home Mac)

Numbered 566 because the materials (564) and app-feature (565) lanes closed first in this file; this lane ran alongside them from the S563 Factory handoff. Three handoff items closed, all merged to `main` and in Production [VERIFIED via GitHub deployments: Production built from `b223dad7d` at 23:10 UTC].

### What Was Completed

1. **Form stop copy** (PR #411 `45d8e6fd4`, runtime under `shared/components`, owner-authorized merge). Stops no longer send the operator to a CLI mode that does not exist; `timeout`/`network` say a retry re-checks first; `bundle_stale` and `meeting_date_patch_failed` have their own copy. Codex adversarial, three rounds: round 1 found `location_readback_mismatch` and the default fallback had been made terminal though both can recover on retry (`stepProvisionLocation` re-reads; the default covers `file_copy_failed`/`upstream_http`/`unknown_error`); round 2 found the runbook's `ambiguous_create_outcome` row said the same (the step recovers a late, owned Request); round 3 approve. Runbook stop table corrected for both.
2. **Source-changed refusal diagnostic** (PR #412 `cb84ee322`, owner-authorized merge). `hydrateSelectedDocument` now names each failing comparison with before → after values (metadata eTag/versionId/size/name/mimeType, the download's own metadata size, the content length) and the `cTag`, which moves only when bytes change. Lands in the existing `admin test-request run refusal:` log line; the form still shows fixed copy. Codex round 1 caught a null-final-metadata TypeError (Graph 404 → 500 instead of 409); fixed with a regression test; round 2 approve. **Cause still not established.** Two hypotheses, both [ASSUMED]: SharePoint touches the XLSX on first read (deferred property promotion bumps eTag/versionId, cTag unchanged); or Graph serves inconsistent metadata across the three reads. The next refusal's cTag separates them.
3. **Flaky `awardee-tab` test** (PR #414 `b223dad7d`, test-only, Tier 0). Cause [VERIFIED via the failing Jest job logs of runs 36943934734 and 37059489261, attempt 1]: not a `waitFor` timeout. The tests waited only for the abstract; the Send button is disabled until subject/body are seeded by effects that commit after it, so the synchronous click was a no-op and `getByRole('dialog')` threw. #398's flake was a different test with the same recipe. `openSendModal()` waits for the button to be enabled; 17 sites hardened.

### Commits

- `45d8e6fd4` (#411), `cb84ee322` (#412), `b223dad7d` (#414); branches deleted.

### Session note

A reproduction subagent asked to run the flaky test "under CPU pressure" launched ~38 concurrent Jest processes (load average ~160) and overheated the owner's laptop; it was killed. The CI logs alone had already established the cause. Recorded as memory `feedback-cap-subagent-load-in-reproduction-briefs`.

### Next items for this lane

**Verified open (owner-observable, deployed today):**
1. **Artifact sweep in Production** — the maintenance cron should delete run `a5161f47`'s bundle and manifest and keep `20407283`'s (`managed-ledger/ledger_prod`). Read the function log.
2. **Next `test_request_preview_source_changed` refusal** — the log line now names the failing comparison and cTag; that establishes or refutes the two hypotheses above. Optionally sooner: owner-run `scripts/probe-sharepoint-download-stability.mjs` against the 1002860 XLSX with `--repeats=10`.
3. **Browser check of the email fix on 1003303** and the **Office Mac brief** — unchanged from S563, not done.
4. **Memory router diet (debt):** `.claude-memory/MEMORY.md` is 8,238 bytes, just over the 8,192-byte routine-audit trigger after this session's one pointer. Run `docs/MEMORY_HYGIENE_RUNBOOK.md` §10 at the next quiet start.

Everything else in the Factory section below (owner decisions, parked, verify-before-acting) stands as written; items 1–3 of its "Previously reported" list are the PRs above.

## Prior-lane handoffs — retained for preflight, not revalidated in Session 566

## Session 565 Summary — 2026-10-02 PT (Codex app-feature lane)

[VERIFIED via PR #415 merge, CI, Vercel status, and authenticated production browser] Staff can now open received applicant materials from Meeting Tracker / Site Visit. PR #415 merged as `f5725544a` and deployed successfully.

- **DONE:** Checklist and additional-file rows show **Open file** for a valid saved HTTPS SharePoint URL. Links open in a new tab; missing/unsafe URLs have no link. Request/artifact matching stays scoped to the staff response; applicant response shape is unchanged.
- **DONE:** Production request 1003221 showed received PDF and PowerPoint links. Clicking the PowerPoint opened the uploaded presentation in SharePoint and loaded slide content (1 of 66). No records or files were edited during this check.
- **DONE:** Refreshed `.impeccable/design.json` sample labels and chip typography to the current design specification; added the factory-ledger startup check to the start skill.
- Validation: 141 targeted tests in six suites, type checking, relevant DAL/document-writer gates and self-tests, independent review, and all PR CI checks passed. ESLint had zero errors and two existing warnings. Preview browser sign-in was blocked by an unregistered Entra callback; the production opening flow was subsequently verified.
- Commits before squash: `8eb2449dd` (startup check), `4daaaa87f` (file opening), `9c252bca4` (design reference). Shipped together in #415 / `f5725544a`.
- Claim-evidence pilot report was unavailable because local observation state could not be read; no observation row was fabricated.

### Next items for this lane

**DONE:** Implementation, review, merge, deployment, and production file-opening verification. No remaining feature work identified.
**Verify before acting:** Other lanes below are retained historical handoffs, not newly verified worklists. Recheck their source, owner decisions, and current state before continuing them.

### Key files

- `shared/components/meeting-tracker/SiteVisitMaterialsCard.js` — staff file-opening links.
- `lib/services/site-visit-materials/collection-service.js` — staff-only safe URL enrichment.
- `tests/unit/site-visit-materials-card.test.js`, `tests/unit/site-visit-materials-collection-service.test.js`, `tests/unit/site-visit-materials-contributor-service.test.js` — regression coverage.
- `.impeccable/design.json`, `.claude/skills/start/SKILL.md` — reference/startup updates.

## Session 564 Summary — 2026-10-02 PT (Codex materials lane)

[VERIFIED via GitHub merges, CI results, Production readback, and owner acceptance] Background uploads, progress reporting, scan diagnostics, and clear connection errors are shipped. PR #405 merged as `1df8a33e2` after all current-head CI checks passed; PR #413 merged as `81dad17e2`. Both are included in Ready Production deployment `dpl_7zi1no5HrxgrPbCQo18Lsi1NM5CZ` at commit `b223dad7d` (October 2 final deployment readback and Git ancestry checks).

- Owner confirmed a PPTX finishes after closing the browser; first background job completed in about 2m44s on attempt 1, no error. Large PPTX and PDF uploads also succeeded before background activation.
- The exact 500 MB live transfer remains unverified and parked, not a normal-use release blocker. The owner declined another simultaneous-large background test on October 2: the expected set is one large PPTX, a usually smaller PDF, and a text document. Reopen stress testing only if usage or failures warrant it.
- The clean materials worktree was archived and is recoverable through Codex. No runtime change or merge remains for this lane. Staff Open file work is now DONE in Session 565: PR #415 deployed and production opening verified (see above).
- Key references: `docs/plans/MATERIALS_BACKGROUND_PROCESSING_PLAN_2026-10-01.md`, `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16.15–16.16, and the materials milestone in `DEVELOPMENT_LOG.md`.
- Commits: progress #410 `8fb8a6d83`; closeout #413 `81dad17e2`; connection errors #405 `1df8a33e2`. Final CI passed before merges. No new runtime tests were needed for this documentation-only stop.
- Claim-evidence pilot report was unavailable because local observation state could not be read; no observation row was fabricated.

## Materials next items

**DONE:** Production activation, guarded read-only recovery inspection, browser-close completion, final merges/deployment verification, and worktree archive.
**Parked:** Exact-cap live rehearsal; reopen only for a new requirement or relevant failure.
**Do not reopen without a new decision:** Another simultaneous-large-file test is not required for this workflow. Continue normal operational monitoring; the worker sends no completion email.

The Factory handoff below is retained as a separate lane. Its remaining carryovers require that lane's preflight; known merged fixes are annotated from main history.

## Session 563 Summary — 2026-10-01/02 PT (Factory admin form lane, Claude, home Mac)

This lane ran alongside the Codex refactor lane that closed as "Session 562"; the Factory plan documents written during it say "S562". It is numbered 563 here only to keep this file's sequence.

The admin Test Request form is built, enabled in Production, and has produced one complete test Request with a status change. [VERIFIED via owner-run `--run-inspect` against `managed-ledger/ledger_prod`, GitHub PRs, and Vercel deployment status]

### What Was Completed

1. **Slices 2, 2b, 3 built and merged** (PRs #398 `baa4eeb46`, #399 `9a7f12c49`, #401 `b5eb97138`): eight superuser routes, the status setter with exactly one PATCH per change, the admin UI. Sonnet builds, Opus reviews, Codex adversarial rounds, an Impeccable critique of the UI.
2. **Preview rehearsal** (owner click-through, branch `factory-form-rehearsal`, since deleted): sign-in, superuser gate, production source read, Confirm and `fence_source` worked; the sandbox refused the create, as anticipated. Rehearsal run `3de97783-6988-5c0c-b933-e7bccbc9da64`'s row is in `managed-ledger/ledger` with no Request behind it. All rehearsal configuration was removed.
3. **Server-side logging of stops and refusals** (PR #403 `cd0d6ebe6`).
4. **Production provisioning (owner)**: `TEST_REQUEST_FACTORY_FORM=on`, `TEST_REQUEST_LEDGER_URL`, `FACTORY_BLOB_RW_TOKEN` (store `wmkf-factory-private`). The form is **on in Production**.
5. **First production run stopped**: run `20407283-c279-5e0c-b396-210ad6842482` (`managed-ledger/ledger_prod`), source 1002860, test Request **1003308**, `needs_attention` / `file_journal_unverified`. SharePoint rewrote `docProps/custom.xml` in the uploaded XLSX and only DOCX had a package comparison. Not resumable.
6. **XLSX fix** (PR #406 `06797abd0`): XLSX verified by the existing package attestation at the destination, the Basic journal carries what `verify` needs, and a settle check before a package-mode copy is journaled. Opus approve-with-fixes; Codex three rounds, final approve.
7. **Complete production run**: run `a5161f47-7b02-5ad3-8f20-3f645ec3c254` (`managed-ledger/ledger_prod`), source 1002988, test Request **1003310**, `ready`, seven documents verified including the XLSX. One status change through the form: Phase II status to "Phase II Pending Committee Review" (seen on the form and in the route log; `--run-inspect` does not list status changes).
8. **Two display fixes** from that run (PRs #408 `c1b57d6e2`, #409 `e236a7e14`).
9. **Slice 5 docs** (`dbac432f3`): `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md`, Atlas, credentials runbook, older plans annotated, memory.
10. **Two read-only probes**: `scripts/probe-test-request-source-document-sizes.mjs`, `scripts/probe-sharepoint-download-stability.mjs`.

### Commits

- PRs #398, #399, #401, #403, #406, #408, #409 (merge and squash commits above).
- `e3f370163`, `4c7689e1b`, `fd12baee3` probes and run records; `a931c66ba`, `9557cf275` rehearsal record; `dbac432f3` slice 5 docs.

## Next Items

### Previously reported items — verify before acting

1. **DONE via PR #411 (`45d8e6fd4`): form stop copy.** Historical finding: Several stops point to a command-line resolution that no mode provides; the `timeout`/`network` copy holds only before a write; `bundle_stale` and `meeting_date_patch_failed` have no copy.
   Evidence: `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md` (*Known gaps*); `shared/components/admin/test-request-factory-copy.js` `ATTENTION_COPY`; delegated source trace 2026-10-02.
   The reviewed fix is merged. `BLIP_COPY` is owner-set wording and stays verbatim.
2. **Diagnostic follow-up shipped via PR #412 (`cb84ee322`); root cause still requires investigation.** Historical observation: first lookup of a source is refused once, then passes ("changed while its bytes were being verified", an XLSX).
   Evidence: Vercel log 2026-10-02 (`admin test-request run refusal: 409 test_request_preview_source_changed …`); `lib/services/test-requests/admin-preview-service.js` `hydrateSelectedDocument`. Cause not established; PR #412 now identifies the failing comparison.
3. **DONE via PR #414 (`b223dad7d`): flaky `tests/unit/awardee-tab.test.js`** ("T2 send: non-2xx with an unparseable body"): failed once and passed on re-run on PRs #398 and #409. The fix waits for Send to become enabled before opening confirmation.
4. **Artifact sweep not yet observed in Production.** It becomes active now that both variables are set; it will delete run `a5161f47`'s bundle and manifest and keep run `20407283`'s.
   Evidence: `lib/services/test-requests/factory-artifact-store.js` `sweepFactoryArtifacts`; `pages/api/cron/maintenance.js`.
5. **Verify the test-request email fix in the browser on 1003303** (carried from the S561 handoff; PR #392 is MERGED [VERIFIED via GitHub]). Not done this session.
6. **Office Mac**: run `docs/plans/briefs/OFFICE_MAC_SYNC_BRIEF_2026-10-01.md`. Its `.env.local` now also needs `FACTORY_BLOB_RW_TOKEN` if the artifact download script is to run there. Not done this session.

### Owner Decision Needed

1. **Form v2 scope**: a way to abandon or resume a stuck run (none exists), status-setter `rerun`, bind-reviewer, slot PATCH, retire. Evidence: admin form plan, decision 7; runbook, *What "cannot continue" leaves behind*.
2. **Request 1003308**: leave as a partly built marked test record, or clean up by hand. Its run cannot be resumed.
3. **PR #390** (refactor survey) is OPEN and on hold by the owner [VERIFIED via GitHub]. No next refactor is selected.

### Parked

1. **Layout checks never done in a browser**: long-label wrapping, selected-row tint, narrow window. Re-open the next time the form is used.
2. **Stray Production/Preview variables** `BLOB_STORE_ID` and `BLOB_WEBHOOK_PUBLIC_KEY` from connecting `wmkf-factory-private`; neither is read. Disconnecting the store should remove them (unverified).

### Verify Before Acting

1. **D2: retire the home Mac's local ledger copies** and scratch databases (carried from S560/S561). Destructive: list and confirm first; not revalidated this session.
2. **Worktree and branch hygiene**: `/Users/gallivan/Code/WMKF_Apps-factory-form` is on merged branch `claude/factory-xlsx-package-verify`; remote branches `claude/factory-admin-form-slice1..3`, `-slice2b`, `claude/factory-form-stop-logging`, `claude/factory-xlsx-package-verify`, `claude/factory-status-already-set-copy`, `claude/factory-status-history-arrow` are merged. List and confirm before removing anything.
3. Requests 1003301–1003303, 1003308 and 1003310 are tracked Factory runs in `managed-ledger/ledger_prod`, not cleanup residue.
4. **DONE:** Materials lane validated and closed in Session 564; see the current summary above and detailed evidence below.

### Do Not Reopen Without New Decision

1. The form never offers the GoVerify bypass; a Preview rehearsal therefore ends at `create_request`.
2. A sent create is never re-sent, and an uploaded file is never re-uploaded, on retry.
3. No message text in the ledger; stops are diagnosed from the function log.
4. PR #397's scope is complete; PR #390 stays on hold (refactor lane).
5. Delegated cadence for this lane: Fable orchestrates, Sonnet builds and reconnoiters, Opus reviews, Fable final review, Codex adversarial to satisfaction; no tail-chasing. Runtime merges need explicit owner authorization.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md` | Operating the form: needs, stops, retries, CLI limits, turning it off |
| `docs/plans/TEST_REQUEST_FACTORY_ADMIN_FORM_PLAN_2026-10-01.md` | Plan, slice build records, rehearsal and slice 4 results |
| `docs/atlas/postgres-test-request-runs.md` | Ledger ownership; the form as second writer; the artifact store |
| `lib/services/test-requests/admin-run-service.js` | The form's service: lookup, Confirm, advance, status |
| `lib/services/test-requests/bundle-file-copy.js` | Document copy, integrity modes, settle check |
| `shared/components/admin/TestRequestFactorySection.js` | The form's UI entry point |
| `scripts/probe-sharepoint-download-stability.mjs` | Owner-run: download stability and package diff of SharePoint files |

## Testing

```bash
npx jest --testPathPatterns "test-request|ledger|maintenance|rehearse|admin"
npx jest --testPathPatterns "bundle-file-copy|run-runner|docx-package"
# Owner-run, read-only, production ledger:
node scripts/rehearse-test-request-sandbox.mjs --target=production --run-inspect=<runId>
```

No claim-evidence observation row was added: the pilot report recorded no eligible plan/design documentation edit for this session.

## Materials feature branch handoff — 2026-10-02 (separate lane)

[VERIFIED via owner-authorized agent Production probes and deployment readback] PR #402 delivered the base Site Visit / Research Presentation background-upload feature. PR #404 (`a63747ca5dfa74954c208e23bd1f90f3b25b0eab`), #407 (`df7bb6ac3f90eba5b80d785f3119c96b8bd0f0e4`), and #410 (`8fb8a6d83684a9d49b8450b26ef5bbef382f9a32`) merged with all CI passing. The historical activation deployment `dpl_2AacXcc5YQX9dNvJ4gMn4PpGtWWN` serves the #410 commit at `https://wmkfresearchapps-36g8ub7g7-justin-gallivans-projects.vercel.app`, aliased to `applications.wmkeck.org`. Migration 060 is applied and the Production schema-readiness and admission flags are `on`, and the scan flag is `true`.

[VERIFIED via source/tests and owner-authorized agent Production read-only probe] The guarded operator CLI requires the fixed local-shell `MATERIALS_UPLOAD_PRODUCTION_DATABASE_URL`, explicit target/host/database and exact job/action confirmations, verified TLS, read-only inspect, sanitized output, and connected database/public-schema checks inside the resolver transaction. The Production read-only command passed target/TLS checks and returned expected `job_not_found` for deliberately nonexistent UUID `00000000-0000-4000-8000-000000000000`; no recovery mutation was run.

The exact-root recursive-reader filter and five callers are Production-deployed in PR #404; it suppresses exact same-request portal-produced Superseded drive/item identities beneath canonical Site Visit materials roots, preserves current/manual identities, and omits affected candidates with a sanitized error when registry/drive evidence is incomplete. PR #407 added scan-rejection diagnostics, and PR #410 added upload progress and verified rejection messages. All three PRs passed CI and merged.

[VERIFIED via owner-authorized agent Production probes] The first real job `33630e07-4311-41b3-8aef-737a2962ce03` (`presentation_source`) was admitted at 21:36:35 UTC, started at 21:37:05, recorded a clean scan checkpoint at 21:38:23, and completed at 21:39:19 on attempt 1 with no error; staging was consumed. Admission-to-completion took about 2m44s. The owner closed/reopened the browser during processing and later confirmed Received after reopening. Worker invocations 21:44–21:48 UTC were healthy with an empty queue. Monitoring remains required; no automatic email is sent. PR #405 merged as `1df8a33e2` after all current-head CI checks passed; PR #413 merged as `81dad17e2`. Both are included in Ready Production deployment `dpl_7zi1no5HrxgrPbCQo18Lsi1NM5CZ` at commit `b223dad7d` (October 2 final deployment readback and Git ancestry checks). The exact 500 MB live transfer remains unverified and parked, not a normal-use release blocker. The owner declined another simultaneous-large background test on October 2: the expected set is one large PPTX, a usually smaller PDF, and a text document. Reopen stress testing only if usage or failures warrant it. Cap enforcement is unit-tested. Preserve unrelated Factory and reviewer-refactor context above; this handoff replaces only the previous materials-lane section.


## Admin alert remediation branch handoff — 2026-10-02

[VERIFIED via branch source, focused tests and read-only operations probe]
`codex/admin-alert-remediation` isolates the owner's alert work from the dirty
transcription checkout. Pricing refresh now compares provider costs with matched
provider token cohorts; Opus 5.5 has reviewed pricing/capabilities; automatic tiers
exclude ancestor-only registry coverage. The intentional late-upload cleanup watch
remains. See `docs/audits/ADMIN_ALERT_REMEDIATION_2026-10-02.md` for evidence,
validation and deployment limitations. No production alerts were manually cleared.

- **DONE:** Source fixes, fresh review, 118 focused tests, scoped gates/self-tests,
  changed-file lint and webpack build. Canonical Turbopack build needs CI because
  the isolated worktree uses a shared dependency symlink.
- **DONE:** Owner authorized merge after CI; PR #420 passed all checks and merged.
  The approved merge commit is READY in Production.
- **DONE:** Protected Production pricing refresh completed with 15 comparisons
  and no drift; its alert auto-resolved. The canary completed and now flags
  Sonnet 5.5, which remains unreviewed and excluded from automatic tiers. The
  existing card may retain old Opus text due to keyed alert deduplication.
- **Parked:** Conservative transcription-watch closure and calendar-triggered
  maintenance observation, consistent with the existing transcription handoff.
- Production operational correction shipped through PR #420; see the audit
  report for deployment and follow-up evidence.


## Historical PR #332 handoff — September 24, superseded checkpoint

The following branch-local record is retained as history. Its head, check status, and mergeability claims describe September 24, not the current integration. Current implementation evidence lives in `docs/plans/PERSONAL_EMAIL_REVIEWER_REMINDERS_PLAN_2026-09-24.md`.

# Session 541 Prompt: Review PR #332 and decide reviewer-reminder promotion

## Session 540 Summary — 2026-09-24 PT (Codex personal-email reviewer reminders)

[VERIFIED via branch source, local checks, the PR plan, and GitHub] PRs #329 and #330 are merged. PR #332 remains open on `codex/personal-email-reviewer-reminders` at `4cf8976e8`; its checks passed and GitHub reported `mergeStateStatus: CLEAN` before this handoff edit. The owner confirmed the staff rehearsal and walkthrough were completed. The reviewer-reminder automatic cron remains unscheduled. This branch has not been merged to `main`, and no Production behavior or live delivery was tested in this session.

### What Was Completed

1. **Reviewer reminder personal defaults and manual sends.** The branch implements the sending PD's saved default for both reminder kinds, proof-bound editable preview/send, owner-keyed preference routes, and strict PD preference reads before automatic claims. The generic preference route reserves the new keys. The full caller-to-send contract and remaining uncertainty semantics are recorded in `docs/plans/PERSONAL_EMAIL_REVIEWER_REMINDERS_PLAN_2026-09-24.md`.
2. **Adversarial review fixes.** OAuth Claude Opus reviews found and then verified fixes for authorization, stale preview, uncertain-send, preference isolation, fallback, and recovery-edit issues. The last independent diff review found a late preference response could overwrite a recovery edit; `b74d385c4` added an edit-generation guard and regression test. The CodeQL rehearsal-loader findings were fixed by `e55cf26dc`.
3. **Staff rehearsal evidence.** `4cf8976e8` records the owner's confirmation and the synthetic browser walkthrough. A later targeted browser check on final runtime head `b74d385c4` showed an unknown template token blocked Send with a specific validation message, then a corrected body and refreshed preview enabled Send. The temporary loopback server on port 3133 was stopped; the separate 3132 rehearsal server was left running for the owner. Human observations were not itemized, and no live service or email probe was run.
4. **Verification.** After the final fixes, focused Jest passed 7 suites/176 tests, lint and build passed, and relevant API route, lifecycle auth, route service, reviewer engagement, reminder hold, fact consistency, secret scan, and scaffolding gates with their self-tests passed sequentially. GitHub checks on `4cf8976e8` all passed, including Jest, Playwright, static/security analysis, Claude review, and Preview status. A documentation-only handoff push will require a fresh PR check before merge.

### Commits on the PR Branch

- `2eab48fd2` — Add personal reviewer reminder defaults and preview-bound sends
- `d001180a4`, `ac8f9bc05`, `7af043073`, `11091eaaa`, `b74d385c4` — Fix review findings and preserve recovery edits
- `38000ffeb` — Record final reviewer reminder review
- `814285827` — Avoid backtracking in automated email marker stripping
- `fa86dd571`, `e55cf26dc` — Add and harden the synthetic staff rehearsal
- `4cf8976e8` — Record staff rehearsal evidence

## Next Items

### Verified Open

1. **PR #332 is open for owner review.** Evidence: GitHub PR state and checks at `4cf8976e8`, plus the branch plan. Recheck the new head, checks, and merge state after this handoff push; do not infer Production readiness from a Preview check.

### Owner Decision Needed

1. **Release preparation and promotion.** The Tier 2 plan still calls for a last-known-good Production deployment and an authorized rollback operator before promotion. Merging #332 to `main` auto-deploys and requires Justin's explicit approval. No Vercel commands, live-service probes, or merge are authorized by this handoff.

### Parked

1. **Automatic reviewer reminder cron.** Evidence: the plan and existing cron-hold gate. It remains unscheduled; any restoration needs a separate decision and release verification.
2. **Remaining personal-email slices.** The owner requested one slice at a time with review between slices. Continue only after PR #332 review and owner ordering.

### Verify Before Acting

1. The PR and `main` can move concurrently. Recheck branch, working tree, PR head, checks, and Production release record before any merge decision.
2. The loopback rehearsal process on port 3132 may not survive a new session. Treat it as a local synthetic aid, not evidence of live behavior.

### Do Not Reopen Without New Evidence

1. The owner-confirmed staff walkthrough and the reviewed P3 fixes are recorded in the PR plan. Reopen them only for a new defect or changed diff.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/PERSONAL_EMAIL_REVIEWER_REMINDERS_PLAN_2026-09-24.md` | Contract, review findings, verification, and release hold |
| `scripts/rehearse-reviewer-reminders.js` | Isolated synthetic staff rehearsal |
| `docs/API_ROUTE_SECURITY_MATRIX.md` | Dedicated preference and preview/send route gates |

## Testing and Stop-time Notes

- `npm run report:claim-evidence-pilot -- --current` returned “local state could not be read”; no pilot observation row was added.
- No `CLAUDE.md` update was needed: the branch's route and script contracts are covered in the plan and route matrix; no cross-agent instruction changed.
- No `DEVELOPMENT_LOG.md` milestone entry was required: #332 remains unmerged and no Production capability or cutover shipped in this session.
- This branch-local handoff starts from `origin/main`'s Session 540 prompt at `f9cf1e8c2`, preserving the newer concurrent session history.

## Prior Session 540 Prompt: Continue active workstreams after the IRS BMF test closeout

# Session 540 Prompt: Continue active workstreams after the IRS BMF test closeout
