---
name: project-dynamics-crm-users
description: Dynamics CRM user count and licensing facts relevant to OBO/impersonation architecture decisions
metadata: 
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
  status: active
  scope: dynamics
  last_verified: unknown via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: evaluating impersonation, OBO, or delegation approaches for Dynamics, or reasoning about CRM licensing constraints.

Do:
- Treat licensing as a non-limiting factor (all staff already have Dynamics licenses); weigh OBO on complexity instead.
- Use the shipped MSCRMCallerID-via-Delegate approach (see [[project-dynamics-identity-reconciliation]]) rather than building an OBO token flow.

Do not:
- Trust the exact user/service-account counts as current — re-probe Dynamics if a count is load-bearing.

Ground truth: Dynamics user/licensing facts (re-probe live if a count matters); shipped approach [[project-dynamics-identity-reconciliation]].

- **16 licensed staff users** (Read-Write, `@wmkeck.org`) + ~180 Microsoft service accounts
- All staff already have Dynamics licenses — an OBO flow would not require additional licensing, but is not recommended due to complexity

**How to apply:** When evaluating impersonation or delegation approaches, the licensing constraint is not the limiting factor. Complexity of OBO token flows is. See [[project-dynamics-identity-reconciliation]] for the shipped approach (MSCRMCallerID via Delegate role).
