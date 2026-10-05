---
name: project-site-visit-materials-history
description: "Point-in-time history split from project-site-visit-materials-planning-handoff on 2026-10-05: the 2026-09-08 Codex planning handoff (owner decisions plan §2, open §12 questions, PC/Ops deck) and the 2026-09-09 briefing-room subset build (D13–D16, migration 038). Superseded by the shipped plan §16; not current state."
metadata:
  type: project
  status: closed
  scope: site-visit-materials
---

## Recall Rule

Read this when: you need the original reasoning behind a Site Visit materials or briefing-room
decision (why a choice was made, what was open in September 2026).

Do:
- Treat everything below as dated history; take current state from
  [[project-site-visit-materials-planning-handoff]] and `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16.

Do not:
- Act on the "open" questions or "not yet on main" notes below; they were resolved when §16 shipped.

## Briefing-room subset built (2026-09-09, S502)

The owner authorized the deliberation-session subset of the briefing room ahead of the first session (week of 2026-09-14): D13 every recipient sees full reviews and authors; D14 all completed reviews; D15 Share mints the link; D16 revoke-and-reissue from the tab. Built on `feature/deliberation-briefing-page` per `docs/DELIBERATION_BRIEFING_PAGE_PLAN.md`: migration 038 `deliberation_briefing_links`, `lib/services/deliberation-briefing/*`, `lib/external/verify-briefing-token.js`, `/api/external/briefing/[token]/{context,document}`, `/api/workbench/pre-site-visit/briefing-link`, `pages/external/briefing/[token].js`, Share integration in `distribution-service.js`. Departure from the Codex plan §8: no stored manifest; the writeup is pinned by the latest send-requested distribution attempt and reviews resolve live. Flag `DELIBERATION_BRIEFING_SCHEMA_READY` (owner-set) gates everything; unset = byte-identical to before.

## Handoff (2026-09-08, owner message to Claude)

Codex completed the planning work in `../WMKF_Apps-codex` on `codex/applicant-additional-materials`; committed and pushed, clean tree, no PR. Claude owns continuity only. Canonical artifacts on the branch, not yet on main: the plan and the brief named in the Recall Rule above (Site Visit Materials is the defining workflow; later additional-material requests reuse the same capability), plus a regenerated docs catalog. Codex verified docs-catalog, doc-symbol-refs, fact-consistency, build-claim-freshness, agent-invariants green on the branch.

**Owner decisions (plan §2):** a PC manually starts collection for an already scheduled Site Visit (scheduling later); minimum set = applicant PDF presentation + source presentation (PPTX/Keynote) + participant bios; PC may add/waive/mark optional, applicants may add bounded other materials; PI and liaison share one forwardable contributor link (uploader identity not proven); PC owns follow-up, render sanity check, publication, PD has visibility; PDF and source advance independently with prior SharePoint versions kept and a soft out-of-sync warning; materials due ~3 days before the visit; contributor and briefing access close 7 days after; first release includes collection AND an external briefing room (selected applicant materials, exact Pre-Site Writeup version, selected peer reviews) behind one shared expiring read-only link for Board/consultants/staff without app login; point at canonical SharePoint items and exact versions, no audience copies; internal names request-numbered, external labels institution-led without request numbers; email/Dropbox is the first-cycle fallback; scheduling and Datto retirement deferred. First Site Visit ~20 days from 2026-09-08.

**Open (plan §12):** exact baseline checklist from the current applicant email; 3-day due rule and reminder cadence; inspect large PPTX/Keynote before setting limits; which representations and peer-review labels the external audience sees; test the nested SharePoint structure in signed-in AkoyaGo (fall back to flat "Site Visit - <Category>" folders); first-cycle go/no-go date and fallback procedure; reconcile the July language in `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`.

**Deck:** Codex built an eight-slide PC/Ops discussion deck (proposed SharePoint hierarchy; how the briefing manifest points at exact files and versions), committed on the branch at `e0166296` under `docs/plans/site-visit-materials/` and pushed 2026-09-08, so it travels with the plan.

Related: [[project-site-visit-materials-planning-handoff]], [[feedback-codex-delegation-review-vs-rescue-routing]].
