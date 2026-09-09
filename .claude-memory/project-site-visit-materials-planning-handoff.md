---
name: project-site-visit-materials-planning-handoff
description: Codex planning handoff (2026-09-08, S499) for Site Visit Materials / applicant additional materials — plan lives on branch codex/applicant-additional-materials (b6005273), owner decisions decided, no PR, no implementation authorized; Claude owns continuity only
metadata:
  node_type: memory
  type: project
  originSessionId: 4645a5a6-2b0a-4200-94ed-4ddc0e8c0b83
  status: active
  scope: site-visit-materials
  last_verified: 2026-09-08 via origin/codex/applicant-additional-materials b6005273 and the owner's handoff message
---

## Recall Rule

Read this when: any work touches Site Visit materials, applicant additional materials, the
external briefing room, or `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md`.

Do:
- Start from the plan on `origin/codex/applicant-additional-materials` (commits `3f0d497c` plan, `b6005273` Site Visit alignment); read it with `git show origin/codex/applicant-additional-materials:docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md`.
- Treat §2 of that plan as decided owner contract and §12 as the open items; re-confirm §12 with Justin before building.
- Leave the Codex worktree `../WMKF_Apps-codex` and its branch alone unless Justin asks (no checkout, merge, wind-down).

Do not:
- Begin implementation, open a PR, or merge the branch on your own; the plan is Tier 0 docs, the feature is Tier 2.
- Treat the July Site Visit upload language in `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` as current; it carries superseded assumptions (expiry, file limits, paths, deletion) that the plan says must be reconciled before implementation.

## Handoff (2026-09-08, owner message to Claude)

Codex completed the planning work in `../WMKF_Apps-codex` on `codex/applicant-additional-materials`; committed and pushed, clean tree, no PR. Claude owns continuity only. Canonical artifacts on the branch: `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` (Site Visit Materials is the defining workflow; later additional-material requests reuse the same capability), `docs/plans/CODEX_BRIEF_APPLICANT_ADDITIONAL_MATERIALS_2026-09-08.md`, regenerated `docs/DOCS_CATALOG.md`. Codex verified docs-catalog, doc-symbol-refs, fact-consistency, build-claim-freshness, agent-invariants green on the branch.

**Owner decisions (plan §2):** a PC manually starts collection for an already scheduled Site Visit (scheduling later); minimum set = applicant PDF presentation + source presentation (PPTX/Keynote) + participant bios; PC may add/waive/mark optional, applicants may add bounded other materials; PI and liaison share one forwardable contributor link (uploader identity not proven); PC owns follow-up, render sanity check, publication, PD has visibility; PDF and source advance independently with prior SharePoint versions kept and a soft out-of-sync warning; materials due ~3 days before the visit; contributor and briefing access close 7 days after; first release includes collection AND an external briefing room (selected applicant materials, exact Pre-Site Writeup version, selected peer reviews) behind one shared expiring read-only link for Board/consultants/staff without app login; point at canonical SharePoint items and exact versions, no audience copies; internal names request-numbered, external labels institution-led without request numbers; email/Dropbox is the first-cycle fallback; scheduling and Datto retirement deferred. First Site Visit ~20 days from 2026-09-08.

**Open (plan §12):** exact baseline checklist from the current applicant email; 3-day due rule and reminder cadence; inspect large PPTX/Keynote before setting limits; which representations and peer-review labels the external audience sees; test the nested SharePoint structure in signed-in AkoyaGo (fall back to flat "Site Visit - <Category>" folders); first-cycle go/no-go date and fallback procedure; reconcile the July language in `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`.

**Deck:** Codex built an eight-slide PC/Ops discussion deck, local and gitignored, at `../WMKF_Apps-codex/outputs/site-visit-materials/final/Site_Visit_Materials_Discussion_2026-09-09_v2.pptx` (proposed SharePoint hierarchy; how the briefing manifest points at exact files and versions).

Related: [[project-j27-doc-capture-evolution]] (J27-061/063 applicant capture rows), [[feedback-codex-delegation-review-vs-rescue-routing]].
