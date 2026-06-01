---
name: project-excluded-reviewers-often-in-pool
description: Applicant-excluded reviewers are frequently already in our reviewer pool; exclusion is a per-request, case-by-case conflict call (competitor vs. collaborator), NOT a person-level "unfit" flag.
metadata:
  type: project
---
Justin correction (S210): do NOT assume applicant-excluded reviewers are unlikely to be in our `wmkf_potentialreviewer` pool. They often ARE — they're domain experts, and an applicant flags **competitors** as conflicts. "One man's competitor is another man's collaborator": the same person excluded on request X can be a perfect, eligible reviewer on request Y. Exclusion is a **per-request, case-by-case** judgment, never a global "this person is unfit" statement.

Design consequence (already baked into the Workbench design): applicant disposition lives ONLY on the `wmkf_appreviewersuggestion` junction row (per-(person,request)), NEVER on the global person record. Excluding someone here must leave them fully eligible/enrichable everywhere else. See [[project-intake-portal-reviewer-capture]] and `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` §Phase 3.

This also means the "excluded person already a saved candidate for the SAME request" collision is realistic, not theoretical — it's the case structured `disposition=excluded` rows (option A) exist to capture. S210 pilot chose option B (soft-block only, no structured excluded rows yet), knowingly deferring durable per-person excluded markers; the new intake portal will write structured excluded rows directly going forward.
