# Session 504 Prompt: Smoke the agenda email and the applicant upload on real requests; PR 3 (PD visibility, auto-close, reminder cron)

> Session 503 ran on 2026-09-10 (one long conversation, owner present throughout). Everything
> below is on `main` at `cba1c4a9` or later and deployed to production with migrations 041–044
> applied and `SITE_VISIT_MATERIALS_SCHEMA_READY=on`. Start with `/start`.

## Session 503 Summary (Claude Fable building, reviewing, and merging; Codex on the agenda email and one rescue pass)

### What Was Completed

1. **Briefing page rehearsed in production on request 1003222** (PR #223 `adcc5f0a` fixed the
   rail's false "AI draft ready"; `2578463d`). Owner sent a real Share, opened the link in a
   private window, reached every material, reissued, and saw the old link revoked. D17 expiry
   rule confirmed; D18 token-in-request-logs accepted. Tracker schedule reader wired into the
   page's session seam (`22626e9b`).
2. **Staff Deliberations tab redesigned and shipped** (PRs #224 `a16615ab`, #225 `6781ae49`,
   #226 `adf11766`; follow-ups `727ab13a`, `e2327ffb`). Stage sentence + one primary action;
   Share opens a dialog that locks at preview then sends; Download and Regenerate under More;
   **writeup attachments dropped entirely** (migration 039 `attachment_mode='none'`); material
   links retired from the composer and served on the briefing page instead; proposal now comes
   from `Reviewer Materials/Proposal_<num>.pdf` titled "Proposal" (D20, `49e1ea74`).
3. **Meeting Tracker enabled in production** (owner applied Wave 28, readback 22/0/0, flag on).
   Bugs fixed on main: `queryAllRecords` dropped `$expand` so slots never saw their session
   (`118fc754` + regression test); cycle picker inert when arriving with a cycle in the URL
   (`aec3458e`); scope label alignment (`5ed5df9e`); exit link and saved notice at the bottom
   (`dde4973f`); Virtual is the default visit format (`eff5ecd7`). Share email session slot
   (PR #227 `15f17268`, migration 040 `session_snapshot`); site-visit editor slice 2b
   (PR #228 `17c5f0c7`); each slot links to its request's briefing page (D11, `6fabefd1`).
4. **Session agenda email designed, delegated, reviewed, merged** (D21–D25 `83266903`; Codex
   built on `codex/session-agenda` from `docs/plans/SESSION_AGENDA_EMAIL_CODEX_BRIEF_2026-09-10.md`;
   PR #232 `cba1c4a9`). One agenda per session with per-proposal time windows and briefing
   links, exact-email ledger `deliberation_agenda_sends` (migration 041, fresh-install v46),
   lease-fenced send with correlation recovery. Claude re-ran the sixteen tracker suites and
   ten gates before merging and resolved the fresh-install block collision with #229.
5. **Applicant materials collection built and LIVE** (plan §16 M1–M5 from the owner's answers;
   PR #229 `eb6cb0e3` staff side, PR #230 `7b3aef91` applicant side). Staff: the visit page's
   materials card creates the collection from the active visit, invites the PI and liaison
   with one sealed contributor link, reminds, waives, confirms ready; admin cap
   `site_visit_materials.upload_max_mb` default 100; due date = two business days before the
   visit in its zone (`lib/utils/business-days.js`). Applicant: `/external/materials/[token]`
   uploads one file per checklist slot straight to the private staging store (migration 043
   scope), finalize validates extension-vs-signature (real ZIP central-directory parse for
   PPTX/DOCX), scans (clean-only), uploads under the canonical name with `replace`, registers
   a READY/DRAFT `wmkf_requestdocument` row (producer `site-visit-materials-portal`), and
   supersedes the slot's prior row. Two Codex adversarial reviews; Codex rescue implemented
   six findings (`12ea32a4`: strict cap read, per-slot lease `slot_leases` migration 044,
   candidate recorded in staging before the Dataverse create, client Retry with the same
   staging id, scanner throw classification); Claude corrected one dead end (`c12f179a`: a
   candidate with no registry row is redone, not held). `GraphService.uploadFileLarge`
   (upload session above 60 MB).
6. **Rollout done by the owner in-session:** migrations 041–044 applied and read back (24
   agenda columns, 4 constraints, 3 indexes, `slot_leases`, staging scope check), flag set,
   production redeployed; `/api/external/materials/<bogus>/context` answers 401 `malformed`.
7. **Housekeeping:** main's Tests workflow had been red since `dc269bf1` (duplicate import in
   a tracker test); fixed in PR #231 `b2717058`. 161 merged remote branches deleted; 38
   remain, all unmerged or with open PRs. Codex worktree parked on `codex/parked`.

### Commits (first-parent on main, this session)
- `cba1c4a9` #232 session agenda email (Codex) · `7b3aef91` #230 applicant upload path ·
  `eb6cb0e3` #229 materials collection staff side · `b2717058` #231 lint fix
- `83266903` agenda decisions + brief · `6fabefd1` D11 slot links · `49e1ea74` D20 proposal
- `eff5ecd7`, `17c5f0c7` #228, `15f17268` #227, `5ed5df9e`, `aec3458e`, `118fc754`,
  `dde4973f`, `e2327ffb`, `adf11766` #226, `727ab13a`, `6781ae49` #225, `a16615ab` #224,
  `3b8a9b59`, `22626e9b`, `2578463d`, `adcc5f0a` #223

## Next Items

### Verified Open

1. **Smoke the agenda email on a real session.** Evidence: PR #232 merged and deployed;
   no production send yet. Owner opens a session in the tracker, "Send agenda…", sends to
   self; check time windows, zone, Zoom link, briefing links; then reorder a slot and confirm
   "Schedule changed since the last agenda." Claude may read `deliberation_agenda_sends`
   (Postgres, read-only) to confirm the row reached `sent`.
2. **Smoke the applicant materials path on a real visit.** Evidence: flag on, routes answer;
   no collection created yet. Pick a request whose PI/liaison may receive the invitation (or
   add the owner as a contact first); create the collection from the visit page; open the
   link in a private window; upload a PDF; confirm it lands under `Site Visit - Slides` and
   appears on the briefing page; replace it and confirm SharePoint keeps the version.
3. **PR 3 — visibility and closeout** (plan §16.3): "Materials: 2 of 3 received" line on the
   Staff Deliberations tab and cycle view; auto-close by `closes_at`
   (`closeExpiredCollections`); reminder cron (owner flagged "we just have to remember to
   write it"); a staff-facing signal for `replay_ambiguous` finalizes (today only the
   applicant sees it). Evidence: `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16.3.
4. **Post-merge production check of PR #218** (rail) — still not done. Evidence: PR body.
5. Carried unchanged: closeout route generic 500 (`close-review.js:64-71`); Codex
   `codex/UI-audit` reviewer UI commits; Cycle Dossier reconciliation (PR #179).

### Owner Decision Needed

1. **Reissue during Dynamics Pending Send**: accept as designed (current) or add a short
   post-send hold. Evidence: `outputs/deliberation-briefing-codex-adversarial-review-2026-09-09.md`.
2. **Release reason:** whether a PD-recorded `no_response` lowers standing anywhere.
   Evidence: `docs/plans/REVIEWER_RELEASE_REASON_CODEX_BRIEF_2026-09-09.md`.
3. Carried: Program select on Final writeups/Awardees; historic suggestion rows with stale
   cycle codes; dossier roster scope; unmerged Codex branches to abandon (`codex/UI-audit`,
   `codex/reviewer-ui-surfacing`, `codex/c0-4-action-policy-foundation`,
   `codex/ror-api-production-shadow`, plus the other 30 unmerged remotes); combined dossier
   retention; PD front-end flip; distribution email copy edits.

### Parked

1. Connor items (J27 Q5, back-end status changes, slice G). 2. Request Quick Find metadata
repair. 3. Legacy Complete row with null eligibility. 4. `NEXTAUTH_SECRET` rotation;
multipart direct-upload conversion; Stage III institution identity authority.
5. Playwright coverage for the external briefing and materials pages (need flags and
Postgres in the e2e environment). 6. Legacy labels/affordances the decided target removes
(see `feedback-skip-legacy-fixes-that-the-target-state-removes`).

### Verify Before Acting

1. **Never set `DATAVERSE_ALLOW_PROD_READS`, `DATAVERSE_PROD_WRITE_ACK`, or any
   `*_SCHEMA_READY` yourself.** Owner ran every migration and flag today; hand over
   `! <command>` lines. `psql` is not installed; a Node readback through
   `@vercel/postgres` must live inside the repo to resolve the package (delete it after).
2. **`vercel redeploy` takes a deployment URL and `--target production`**, not `--prod`;
   the CLI may print "fetch failed" while waiting even though the build succeeds — confirm
   with `vercel inspect <url>`.
3. **Codex worktree `../WMKF_Apps-codex`** is parked on `codex/parked` at main; reuse it
   with `git -C ../WMKF_Apps-codex checkout -B codex/<slug> origin/main`.
4. **Fresh-install blocks in `scripts/setup-database.js`** are now v44 (042), v45 (044),
   v46 (041); the next migration is 045 → block v47. Check before adding.
5. **`visitExpected()`** remains the single D26 assumption; J27 register row when it changes.

### Do Not Reopen Without New Decision

1. **Deliberation email carries no attachment; the briefing page is the only carrier**
   (owner 2026-09-10). Evidence: `docs/plans/STAFF_DELIBERATIONS_TAB_SHAPE_BRIEF_2026-09-09.md`.
2. **Applicant materials M1–M5** (checklist, two business days, admin cap 100 MB, flat
   `Site Visit - <bucket>` folders, go). Evidence: plan §16.
3. **Agenda D21–D25**; **tracker D1–D12**; **briefing D13–D20**. Evidence: the plans.
4. **Ledger `sent` = transport accepted (statuses 3/6/7)**; unchanged since 2026-08-24.
5. Initial assessments hidden for D26; copy-the-bytes Board snapshot; `wmkf_meetingdate` as
   the single temporal axis.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16 | Materials decisions, data model, slices (PR 1–2 built, PR 3 planned) |
| `lib/services/site-visit-materials/{collection-service,collection-store,contributor-service,upload-cap}.js` | Staff collection, per-slot leases, applicant finalize, admin cap |
| `pages/api/meeting-tracker/visits/[requestId]/materials.js`; `shared/components/meeting-tracker/SiteVisitMaterialsCard.js` | Staff route and card |
| `pages/api/external/materials/[token]/{context,upload-token,finalize}.js`; `pages/external/materials/[token].js`; `lib/external/verify-materials-token.js` | Applicant surface |
| `lib/utils/site-visit-material-file.js`; `lib/utils/business-days.js` | Byte validation (ZIP directory parse); due-date helper |
| `lib/services/graph-service.js` `uploadFileLarge` | Upload session above 60 MB |
| `lib/services/meeting-tracker/{agenda-service,agenda-store}.js`; `pages/api/meeting-tracker/sessions/[id]/agenda.js`; `shared/components/meeting-tracker/SessionAgendaPanel.js` | Agenda email (Codex) |
| `docs/plans/SESSION_AGENDA_EMAIL_CODEX_BRIEF_2026-09-10.md` § Handoff | Agenda readback queries and expected names |
| `shared/components/workbench/{StaffDeliberationsTab,PreSiteDistributionPanel,OverflowMenu}.js`; `shared/utils/deliberation-stage.js` | Redesigned tab |
| `lib/db/migrations/039–044` | no-attachment mode, session snapshot, agenda ledger, collections, staging scope, slot leases |

## Testing

```bash
npx jest tests/unit/site-visit-materials tests/unit/site-visit-material-file tests/unit/external-materials tests/unit/portal-upload tests/unit/graph-service-upload-large tests/unit/meeting-tracker tests/unit/pre-site-distribution-* tests/unit/deliberation-*
npm run check:types && npm run check:api-routes && npm run check:atlas && npm run check:request-document-writers && npm run check:fact-consistency
# Live, flag on:
curl -s https://wmkfresearch.vercel.app/api/external/materials/not-a-token/context   # → {"ok":false,"reason":"malformed"}
```
