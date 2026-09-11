---
name: project-site-visit-materials-planning-handoff
description: Applicant materials collection SHIPPED to production 2026-09-10 (S503, plan §16 M1–M5, PRs #229/#230, migrations 042–044, flag on); briefing page live since S502 (D13–D20); PR 3 (staff visibility lines, auto-close, unscheduled reminder cron, replay_ambiguous event) BUILT S506 as PR #252, open and unmerged
metadata:
  node_type: memory
  type: project
  originSessionId: 4645a5a6-2b0a-4200-94ed-4ddc0e8c0b83
  status: active
  scope: site-visit-materials
  last_verified: 2026-09-11 via docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md §16.3 on claude/applicant-materials-pr3 (PR #252) and the S503 production rollout
---

## Recall Rule

Read this when: any work touches Site Visit materials, applicant additional materials, the
external briefing room, or `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md`. <!-- doc-symbol-refs:ignore reason=on-codex-branch-not-main -->

Do:
- Start from `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16 on main (decisions M1–M5, reuse map, data model, slices); PR 1 (staff) and PR 2 (applicant) are built and live; PR 3 is built on `claude/applicant-materials-pr3` (PR #252, open): counts-only summary reader → three staff lines, maintenance auto-close step, `/api/cron/site-visit-materials-reminders` built but deliberately absent from `vercel.json` (owner decides the schedule; `?dryRun=1` is the safe probe), durable `site_visit_material_replay_ambiguous` operational event.
- Treat the two Codex adversarial reviews' outcomes as the upload path's contract: clean-only scan, strict cap read (503 on outage), per-slot lease in `site_visit_material_collections.slot_leases`, Graph candidate recorded in staging before the Dataverse create, generation key from the staging id, client Retry with the same staging id, real ZIP central-directory parse for PPTX/DOCX. A candidate with no registry row is redone from the top; only a superseded or mismatched generation row is held as `replay_ambiguous`.
- Owner runs migrations and flags; hand over `! <command>` lines.

Do not:
- Rebuild the collection or the briefing page; reopen M1–M5 or D13–D20 without a new owner decision.
- Read the July Site Visit upload language in `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` as current for this path; §16 supersedes it (flat `Site Visit - <bucket>` folders, canonical filenames, admin cap).

## Applicant materials shipped (2026-09-10, S503)

Owner answered §12: checklist confirmed (PDF presentation, PPTX/Keynote source, participant bios), due two business days before the visit (`lib/utils/business-days.js`), admin-editable cap default 100 MB, flat `Site Visit - Slides|Participant Bios|Other` folders, go. Built: `lib/services/site-visit-materials/*`, `/api/meeting-tracker/visits/[requestId]/materials`, `SiteVisitMaterialsCard` on the visit page, `/external/materials/[token]` + `/api/external/materials/[token]/{context,upload-token,finalize}`, `lib/external/verify-materials-token.js`, `GraphService.uploadFileLarge`. Owner applied 041–044, set `SITE_VISIT_MATERIALS_SCHEMA_READY=on`, redeployed; junk-token probe answers 401 `malformed`. Reminder cron and auto-close landed in PR 3 (S506, PR #252): the cron claims before sending with the same predicate as its candidate read and resolves every precondition (missing items, recipients, enabled sender, readable link, the optional visit read) before the claim; a delivered email whose receipt fails to attach counts as `receiptFailed`, not a transport failure. Known residual: the PC's manual reminder has no claim.

## Briefing-room subset built (2026-09-09, S502)

The owner authorized the deliberation-session subset of the briefing room ahead of the first session (week of 2026-09-14): D13 every recipient sees full reviews and authors; D14 all completed reviews; D15 Share mints the link; D16 revoke-and-reissue from the tab. Built on `feature/deliberation-briefing-page` per `docs/DELIBERATION_BRIEFING_PAGE_PLAN.md`: migration 038 `deliberation_briefing_links`, `lib/services/deliberation-briefing/*`, `lib/external/verify-briefing-token.js`, `/api/external/briefing/[token]/{context,document}`, `/api/workbench/pre-site-visit/briefing-link`, `pages/external/briefing/[token].js`, Share integration in `distribution-service.js`. Departure from the Codex plan §8: no stored manifest; the writeup is pinned by the latest send-requested distribution attempt and reviews resolve live. Flag `DELIBERATION_BRIEFING_SCHEMA_READY` (owner-set) gates everything; unset = byte-identical to before.
- Treat the July Site Visit upload language in `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` as current; it carries superseded assumptions (expiry, file limits, paths, deletion) that the plan says must be reconciled before implementation.

## Handoff (2026-09-08, owner message to Claude)

Codex completed the planning work in `../WMKF_Apps-codex` on `codex/applicant-additional-materials`; committed and pushed, clean tree, no PR. Claude owns continuity only. Canonical artifacts on the branch, not yet on main: the plan and the brief named in the Recall Rule above (Site Visit Materials is the defining workflow; later additional-material requests reuse the same capability), plus a regenerated docs catalog. Codex verified docs-catalog, doc-symbol-refs, fact-consistency, build-claim-freshness, agent-invariants green on the branch.

**Owner decisions (plan §2):** a PC manually starts collection for an already scheduled Site Visit (scheduling later); minimum set = applicant PDF presentation + source presentation (PPTX/Keynote) + participant bios; PC may add/waive/mark optional, applicants may add bounded other materials; PI and liaison share one forwardable contributor link (uploader identity not proven); PC owns follow-up, render sanity check, publication, PD has visibility; PDF and source advance independently with prior SharePoint versions kept and a soft out-of-sync warning; materials due ~3 days before the visit; contributor and briefing access close 7 days after; first release includes collection AND an external briefing room (selected applicant materials, exact Pre-Site Writeup version, selected peer reviews) behind one shared expiring read-only link for Board/consultants/staff without app login; point at canonical SharePoint items and exact versions, no audience copies; internal names request-numbered, external labels institution-led without request numbers; email/Dropbox is the first-cycle fallback; scheduling and Datto retirement deferred. First Site Visit ~20 days from 2026-09-08.

**Open (plan §12):** exact baseline checklist from the current applicant email; 3-day due rule and reminder cadence; inspect large PPTX/Keynote before setting limits; which representations and peer-review labels the external audience sees; test the nested SharePoint structure in signed-in AkoyaGo (fall back to flat "Site Visit - <Category>" folders); first-cycle go/no-go date and fallback procedure; reconcile the July language in `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`.

**Deck:** Codex built an eight-slide PC/Ops discussion deck (proposed SharePoint hierarchy; how the briefing manifest points at exact files and versions), committed on the branch at `e0166296` under `docs/plans/site-visit-materials/` and pushed 2026-09-08, so it travels with the plan.

Related: [[project-j27-doc-capture-evolution]] (J27-061/063 applicant capture rows), [[feedback-codex-delegation-review-vs-rescue-routing]].
