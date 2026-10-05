# Session 576 Prompt: recording links on Staff Deliberations, then transcript summaries

## Session 575 Summary — 2026-10-05 PT (Stage 1 shipped; staff discussion transcript; two follow-up fixes)

Fable orchestrated Stage 1 (three Sonnet builders in worktrees, Opus review, Codex adversarial review); after the owner switched the model, Opus 5.5 built the rest directly with Codex as reviewer. Owner merged each PR and ran every Production step via `!`. Everything below is on `main` and deployed.

### What Was Completed

1. **Plan Stage 1: Board links serve the presentation only** (PR #434, merge `32664485b`, deployment 6863898521 success). Transcript bundle v4 freezes the confirmed presentation end; new type `PRESENTATION_TRANSCRIPT` 100000012; derivative bound by generation key (revision + boundary) and pinned SharePoint eTag (Codex finding); both outside pages serve only the bound Presentation Transcript and the Transcript Summary, never TRANSCRIPT or RECORDING. Migration 068 and picklist 100000012 owner-applied. Opus review 9 findings + Codex 1 high, all fixed.
2. **Exposure check (owner-run read):** 3 live Board links (all test requests) and 12 briefing links; owner confirmed no real recording/transcript was exposed.
3. **Staff Discussion Transcript** (owner decision 7, PR #435, merge `700702ee9`): type 100000013, exact complement of the presentation cut, written by the same "Generate presentation and discussion transcripts" action; staff-only (mutation-checked exclusion on both outside pages). Codex finding fixed: Staff Deliberations shows only derivatives bound to the current boundary. Migration 069 and picklist 100000013 owner-applied before merge.
4. **Proposal stray-line guard** (PR #437, merge `9dfec5479`): acceptance on 1003222 showed the proposal landing on "[1:00:48] Sujoy Mukhopadhyay: Same." (diarization misattribution >10 min into staff talk). Short applicant lines (≤3 words) are skipped only when >2 min after the last longer applicant line, so a closing "Thank you" stays; every skip is shown with "Use this line instead".
5. **TXT encoding** (PR #438, merge `1e2a798fd`): TXT opened from SharePoint showed "youâ€”" (UTF-8 read as Windows-1252). Formatter/bundle v5 and both derivative writers prefix a UTF-8 BOM; v1–v4 rebuild byte-identical. Owner republished 1003222 and reported "Looks good".
6. **Memory:** `project-agent-worktree-base-is-main.md` (Agent `isolation: worktree` branches from `main`; brief the base commit and fast-forward first).
7. **DEVELOPMENT_LOG** milestone entry added.

### Commits (main, first-parent)
- `32664485b` PR #434; `b5752272e` docs live.
- `700702ee9` PR #435; `90ab246b5` docs live.
- `1e2a798fd` PR #438; `9dfec5479` PR #437; `1b01d3de0` docs live.
- (`5999a066e` PR #436 is a separate owner/Codex fix merged during the session.)

## Next Items

### Owner-Stated Next Focus

1. **Links to the recordings on the Staff Deliberations pages.** Scope this with the owner before building. Evidence: `shared/components/workbench/ResearchPresentationFollowUp.js` already renders a "Recording → Watch recording" row from the RECORDING winner (Zoom link or SharePoint MP4) [VERIFIED]; on 1003222 the card shows "No recording yet", so nothing is linked there today. Ask whether the gap is (a) no recording saved for the request, (b) a different page or placement, or (c) the Board-facing trimmed recording (plan Stage 4, type 100000011, not built). Related carryover: S571 "staff video-sharing acceptance" (whether intended staff can play the SharePoint MP4) was never traced.
2. **Transcript summary feature** = plan Stage 2 (presentation summary, existing type `TRANSCRIPT_SUMMARY` 100000007) and Stage 3 (staff discussion summary, type 100000010 not yet in the picklist). Plan §4.3, §4.4, §5, §6, §7 decisions 3, 4, 6, 7. Preconditions before any writer ships:
   - **Bind the Transcript Summary outside** (plan §4.2/§12; code note in both outside services): today it is served unbound because nothing writes it.
   - Stage 3 input can read the Staff Discussion Transcript row (decision 7) instead of re-cutting.
   - Server-enforced, versioned summarization acknowledgment per recording (§6); `APP_MODELS` row (`sonnet`, `haiku` fallback), budget row, prompt seed (owner-run with `DATAVERSE_PROD_WRITE_ACK`), A7 tagging entry, `requireAcceptedLlmResponse`, `check:model-override-warming` for new routes.
   - Run `/contract-reconcile` on the build plan first (new writers, durable drafts).

### Verified Open

1. **Roster-as-foundation rule unconfirmed.** Evidence: plan §14; this run was consistent but no roster attendee was identifiable. Confirm on a visit with saved roster attendees.
2. **PR #431 checklist remainder:** plain VTT upload and Zoom chat.txt-as-.vtt refusal not exercised (publish-from-run and names republish were exercised on 1003222 this session).
3. **Leadership dashboard readiness** (S571 item 3): Codex worktree `/Users/gallivan/Code/WMKF_Apps-codex-dashboards`, unread since S572.
4. **Sonnet 5.5 inventory amendment** (branch `audit/sonnet-55-consumer-inventory`): still lists two closed blockers; add the Stage 2/3 summary prompts as future `sonnet` consumers.
5. **Memory hygiene debt:** router `.claude-memory/MEMORY.md` 8,325 B (over the 8,192 B trigger; grew by one pointer this session); router diet `docs/MEMORY_HYGIENE_RUNBOOK.md` §10; `project-virtual-review-panel.md` closed but not in the closed-work archive.
6. **Sweep item:** `docs/PC_MEETING_TRACKER_PLAN.md:105` says presentation materials "PRODUCTION NOT DEPLOYED"; materials plan says enabled.
7. **Small follow-ups (plan §11–§13):** external briefing page empty-state copy still mentions recordings; a derivative whose SharePoint file was replaced needs a manual regenerate path (writer returns early when bound); applicant-uploaded rows are not eTag-pinned; the misattributed "Same." stays in the 1003222 staff discussion TXT (per-line editor declined).

### Owner Decision Needed

1. **Pre-Site distribution email** (`lib/services/pre-site-visit/distribution/model.js` `MATERIAL_TYPES`): keep offering full RECORDING/TRANSCRIPT SharePoint links, or trim to the Presentation Transcript.
2. **Pinned save bar** in the speaker editor (Save sits below all speakers; owner missed it on 1003222). Offered, not decided.
3. **Sonnet 5.5 pre-flip replay** (carried; spends provider credits).
4. **Dependabot #115 (`braces`) and #116 (`http-cache-semantics`)** — upstream-blocked as of 2026-10-04.

### Parked

1. `feature/unsupported-stretch-split`, `feature/reassign-direct-overlap` — Zoom plan "Deliberately NOT merged".
2. Old `PostPresentationMaterialsCard.js` / `MeetingTranscriptionPanel.js`: retire with the rehearsal page later, not before.
3. `multi-llm-service.js` `DEFAULT_MODELS.claude` dead config.
4. Items parked in S571 (#428 rehearsal, #328, #390, reminder cron); not revalidated.

### Verify Before Acting

1. **Roll forward, not back:** once v4/v5 bundles exist, older code rejects them (card shows the transcript as not editable).
2. **Agent worktrees branch from `main`** (memory `project-agent-worktree-base-is-main.md`): name the base commit in every builder brief and have builders `git merge --ff-only` to it.
3. Production reads/writes, migrations, and picklist inserts are owner-run via `!`; Dataverse writes take `DATAVERSE_PROD_WRITE_ACK="<purpose> <YYYY-MM-DD UTC>"`. Run additive prerequisites before the merge that needs them.
4. `codex:review` rejects focus text; use `codex:adversarial-review` for focused reviews.
5. Full-suite runs showed one load-dependent flake (`tests/unit/workbench-integrity-service.test.js`); passes alone and on rerun.

### Do Not Reopen Without New Decision

1. Summaries plan decisions 1–7 (§7) and card redesign decisions 1–5; time-split speaker editor declined; model-as-veto, dominance 0.2, legacy VRP retirement, Integrity Screener haiku pin.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/SITE_VISIT_SUMMARIES_AND_BOARD_SHARING_PLAN_2026-10-04.md` | §4.3–§7 for Stages 2–3; §11–§15 build records |
| `lib/services/post-presentation-materials/presentation-transcript-service.js` | derivative writer (two specs, one createDocument) |
| `lib/services/post-presentation-materials/presentation-transcript-binding.js` | generation keys, bind functions, `withoutUnboundDerivatives` |
| `lib/services/meeting-tracker-transcription/presentation-boundary.js` | proposal, stray-line guard, presentation/discussion cuts |
| `lib/services/post-presentation-materials/presentation-page-service.js`, `lib/services/deliberation-briefing/briefing-page-service.js` | outside allowlists; Stage 2 summary-binding note |
| `shared/components/workbench/ResearchPresentationFollowUp.js` | Staff Deliberations follow-up rows (Recording, transcripts, summary) |
| `shared/components/meeting-tracker/RecordingAndTranscriptCard.js` | card: boundary editor, Generate, skipped-line notice |
| `scripts/probe-outside-link-exposure.js` | owner-run read-only census of live outside links |

## Testing

```bash
npx jest tests/unit/presentation-boundary.test.js tests/unit/presentation-transcript-binding.test.js tests/unit/presentation-transcript-service.test.js
npx jest tests/unit/presentation-page-service.test.js tests/unit/deliberation-briefing-page-service.test.js tests/unit/site-visit-logistics-service.test.js
npx jest tests/unit/meeting-tracker-transcription tests/unit/recording-and-transcript-card.test.js
```

## Earlier handoff — Session 574 (historical; its open items are re-verified above)

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

(Sessions 572 and earlier: see git history of this file, e.g. `git show a8474e16e:SESSION_PROMPT.md`.)
