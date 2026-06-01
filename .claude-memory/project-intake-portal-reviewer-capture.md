---
name: project-intake-portal-reviewer-capture
description: The new intake portal must collect applicant recommended + excluded reviewers and write them to wmkf_appreviewersuggestion (the per-request junction) flagged via the new wmkf_applicantdisposition picklist — NOT the legacy akoya_request slots/free-text.
metadata:
  type: project
---

When building the new applicant intake portal (GOapply replacement), the reviewer-capture form fields (applicant **recommended** reviewers + reviewers to **exclude**) must write to **`wmkf_appreviewersuggestion`** — the per-(person, request) engagement junction, the SAME table Reviewer Finder candidates live in — distinguished by the **new `wmkf_applicantdisposition` picklist** (`recommended` / `excluded`; null = staff/Claude-discovered). Origin is flagged by appending `applicant` to the free-text `wmkf_sources`.

This is the **going-forward location**, chosen 2026-05-31 with Justin. It deprecates the legacy GOapply path (applicant suggestions → `akoya_request.wmkf_potentialreviewer1..5` lookup slots; excludes → free-text `akoya_request.wmkf_excludedreviewers`). The D26 Workbench build includes a one-time patch that migrates those legacy slots + free-text into junction rows; the intake portal writes the junction rows directly so no migration is needed for future cycles.

**Why the junction (not a person-level field):** exclusion must be **per-request** — a reviewer excluded by one applicant must stay eligible/enrichable for every other proposal. The junction is request-scoped by construction. Write the disposition ONLY on the junction row, never on the global `wmkf_potentialreviewer` person record. This is distinct from the planned-but-undeployed person-level `wmkf_reviewerstate` lifecycle picklist (see [[project-intake-portal-pilot-decisions-2026-05-06]]) — that's a person lifecycle axis, not the applicant recommend/exclude capture location.

**Load-bearing follow-through:** every reader of `wmkf_appreviewersuggestion` that treats rows as candidates (counts, candidate lists, invite paths) must filter `wmkf_applicantdisposition ne excluded`, or an exclusion leaks into a candidate/invite path. Recommended entries get full enrichment (papers/COI/contact) on equal footing with Claude candidates; excluded entries are only resolved/matched, not bibliometrically enriched. Free-text `wmkf_excludedreviewers` is kept as the raw source of the applicant's *reasons* and mirrored into structured excluded rows.

Related: [[project-machine-legible-form-capture]], [[project-reviewer-apps-redesign-direction]], [[project-intake-portal-skinny-scope]], [[human-legibility-schema-principle]], [[reviewer-identity-fragmentation]].
