---
name: project-connor-intake-flow-map
description: "Connor's Research intake Power Automate map (2026-11-20) is the reference for what PA writes, where, when and in what format; read docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md before touching any intake-written field or file."
metadata:
  type: project
  status: active
  last_verified: 2026-11-20 via Connor's field map plus owner-approved metadata reads (all 57 named fields exist; the three flows are not visible to the app identity)
---

## Recall Rule
Read before planning, building or documenting anything that reads or writes a
field, row or SharePoint file that Connor's Research intake flows produce:
stage tracking (`wmkf_ingeststage`), request fields set at intake, personnel,
applicant-suggested reviewers, excluded reviewers, step-3 AI outputs (summary,
methodology, personnel, rationale, keywords, PD scores, injection, compliance,
fit), the keyword table, `wmkf_ai_run` rows from PA, the staff version, or PD
assignment/packets.

Do:
- Use `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md` as the map. It is Connor's
  report, not a probe: label claims from it `[REPORTED by Connor 2026-11-20]`.
- Keep Connor's status labels exact (2026-11-20: steps 1–2 LIVE, step 3 AI review
  PLANNED, step 5 staff version BUILT but not live, steps 6–7 PLANNED).
- Treat the app as a second writer wherever the map overlaps it
  (`wmkf_wmkfprojectdescription` via `grantee-title.generate`,
  `wmkf_appreviewersuggestion`), and check the map's section 9 before changing
  either side.
- Ask Connor (map section 10) rather than guessing on the open questions.

Do not:
- Restate the map's tables in other docs or memory; point at the doc.
- Present a PLANNED or BUILT step as running, or a field as populated, without
  a named, owner-approved Production read.

**Why:** the owner flagged this map as important for many things
(2026-11-20). Earlier repo docs predate it and disagree in places (file
contract rules, "pipeline not deployed", compliance field "vestigial").

Related: [[project-j27-review-workbook-reflects-cso-intent]],
[[project-program-field-retired-use-grant-program]],
[[project-j27-doc-capture-evolution]].
