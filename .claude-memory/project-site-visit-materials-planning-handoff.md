---
name: project-site-visit-materials-planning-handoff
description: Applicant materials collection SHIPPED to production 2026-09-10 (S503, plan §16 M1–M5, PRs #229/#230, migrations 042–044, flag on); briefing page live since S502 (D13–D20); PR 3 (staff visibility lines, auto-close, unscheduled reminder cron, replay_ambiguous event) merged 2026-09-11 as PR #252; Admin due-date offset merged 2026-10-05 in PR #439
metadata:
  node_type: memory
  type: project
  originSessionId: 4645a5a6-2b0a-4200-94ed-4ddc0e8c0b83
  status: active
  scope: site-visit-materials
  last_verified: 2026-10-05 via gh pr view 252 (merged 2026-09-11), commit 28e9424b0 on main through PR #439, pages/api/cron/site-visit-materials-reminders.js present and absent from vercel.json
---

## Recall Rule

Read this when: any work touches Site Visit materials, applicant additional materials, the
external briefing room, or `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md`.

Do:
- Start from `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16 on main (decisions M1–M5, reuse map, data model, slices); PR 1 (staff), PR 2 (applicant) and PR 3 (PR #252, merged 2026-09-11) are on `main`; PR 3 added: counts-only summary reader → three staff lines, maintenance auto-close step, `/api/cron/site-visit-materials-reminders` built but deliberately absent from `vercel.json` (owner decides the schedule; `?dryRun=1` is the safe probe), durable `site_visit_material_replay_ambiguous` operational event.
- Treat the two Codex adversarial reviews' outcomes as the upload path's contract: clean-only scan, strict cap read (503 on outage), per-slot lease in `site_visit_material_collections.slot_leases`, Graph candidate recorded in staging before the Dataverse create, generation key from the staging id, client Retry with the same staging id, real ZIP central-directory parse for PPTX/DOCX. A candidate with no registry row is redone from the top; only a superseded or mismatched generation row is held as `replay_ambiguous`.
- Owner runs migrations and flags; hand over `! <command>` lines.

Do not:
- Rebuild the collection or the briefing page; reopen M1–M5 or D13–D20 without a new owner decision.
- Read the July Site Visit upload language in `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` as current for this path; §16 supersedes it (flat `Site Visit - <bucket>` folders, canonical filenames, admin cap).

## Applicant materials shipped (2026-09-10, S503)

Owner answered §12: checklist confirmed (PDF presentation, PPTX/Keynote source, participant bios), due two business days before the visit at initial release (`lib/utils/business-days.js`); the owner-approved Admin offset merged to `main` on 2026-10-05 (commit `28e9424b0`, PR #439; Production deployment [ASSUMED] from the `main` auto-deploy, not read back): `site_visit_materials.due_business_days`, 1–30 business days, absent default 2, invalid/unreadable saved setting fails 503, new collections only, existing `due_at` preserved, and changed preview deadlines require refresh; admin-editable shared applicant/staff attachment cap default 500 MB (owner decision 2026-10-01; valid saved 1–500 MB overrides remain effective), flat `Site Visit - Slides|Participant Bios|Other` folders, go. Built: `lib/services/site-visit-materials/*`, `/api/meeting-tracker/visits/[requestId]/materials`, `SiteVisitMaterialsCard` on the visit page, `/external/materials/[token]` + `/api/external/materials/[token]/{context,upload-token,finalize}`, `lib/external/verify-materials-token.js`, `GraphService.uploadFileLarge`. Owner applied 041–044, set `SITE_VISIT_MATERIALS_SCHEMA_READY=on`, redeployed; junk-token probe answers 401 `malformed`. Reminder cron and auto-close landed in PR 3 (PR #252); the cron and the PC's manual reminder (S507, `90641978`) both claim before sending, and PR #279 made both emails' copy configurable.

## Large-upload follow-up (2026-10-02; background processing live)

PR #396 shipped the shared 500 MB default. A 300+ MB PPTX initially exhausted the production finalizer’s 2048 MB memory; after the PR #400 mitigation, a real 326,914,310-byte PPTX completed successfully (see the canonical plan §16.14). That evidence does not establish a live transfer at the exact 500 MB limit. Applicant Site Visit background admission is now enabled in Production and its first real job completed; see `docs/plans/MATERIALS_BACKGROUND_PROCESSING_PLAN_2026-10-01.md` for deployment and job evidence. PRs #405 and #413 are in Production (deployment record in that plan). The exact 500 MB live transfer is unverified and parked, not a release blocker. The owner declined further simultaneous-large tests on October 2 (expected set: one large PPTX, a smaller PDF, a text document); reopen only if usage or failures warrant it.

## History

The 2026-09-08 planning handoff and the 2026-09-09 briefing-room build record moved to
[[project-site-visit-materials-history]] on 2026-10-05.

Related: [[project-j27-doc-capture-evolution]] (J27-061/063 applicant capture rows), [[feedback-codex-delegation-review-vs-rescue-routing]].
