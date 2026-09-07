---
name: feedback-mutable-parameters-not-in-code
description: Owner rule (2026-08-28) — operational parameters that staff may need to tune (LLM output budgets, timeouts) must be persisted, admin-editable settings, not literals in tracked code; code holds only bounds and fallbacks.
metadata:
  type: feedback
  status: active
  scope: executor-config
  last_verified: 2026-09-07 (S493) — first durable revision executor.budgets.v000001 published in Production
---

Owner directive, S467 (2026-08-28), on seeing the pre-site writeup's
`maxTokensOverride: 32 768` / `timeoutMsOverride: 240 000` surfaced from
`shared/config/executorBudgets.js`: "we can't be setting mutable parameters in
code."

**Why:** a value that changes with model behavior or workload (an output budget
exhausted by adaptive thinking, a timeout) needs a staff-facing edit path with an
audit trail, not a commit + deploy. Code-resident literals also invite the
"display mirrors code" trap the S467 panel had to engineer around.

**How to apply:** when adding a tunable, put it in durable state (the
`wmkf_appsystemsettings` pattern behind `/api/admin/models`, or the owning
Dataverse row) with a superuser-gated editor, and keep in code only the
server-side bounds (e.g. the model's reviewed `maxOutputTokens`) and a seed
default. Reviewed snapshots of external facts (model capability registry) stay
in code. **[PRODUCTION-DEPLOYED AND OWNER-VIEWED 2026-08-30]** Executor standing/retry budgets now use
append-only `executor.budgets.vNNNNNN` Dataverse settings through
`lib/services/executor-budget-service.js` and the superuser Admin editor; the
tracked registry owns only bounds and fallback. The Production Admin read
surface showed the expected no-revision/code-fallback state. **[PUBLISHED 2026-09-07, S493]**
The owner directed the first durable publication: `executor.budgets.v000001` pins the reviewed
code defaults for all three registered prompts, so a later edit to those defaults cannot move
Production on its own. Two mechanics worth carrying: the Admin editor disables Publish when the
draft equals the current values, so an identical document must go through
`PUT /api/admin/executor-budgets`; and registering a new prompt name is additive, because reads
fill names missing from an older revision from code defaults.
See [[feedback-no-fabricated-placeholder-values]].
