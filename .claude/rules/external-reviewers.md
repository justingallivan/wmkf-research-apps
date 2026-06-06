---
paths:
  - "lib/external/**"
  - "pages/api/external/**"
  - "pages/external/**"
---

# External Reviewer Flows

`lib/external/` owns token lifecycle, token-plus-row verification, reviewer-visible materials, and review-form contracts. Treat these routes as public token-authenticated surfaces; preserve expiry, row binding, replay/duplicate guards, and private-material access rules. Consult `docs/EXTERNAL_REVIEWER_INTAKE_PLAN.md` and the relevant stage design before changing the flow.
