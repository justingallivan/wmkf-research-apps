---
name: project-dynamics-crm-users
description: Dynamics CRM user count and licensing facts relevant to OBO/impersonation architecture decisions
metadata: 
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
---

- **16 licensed staff users** (Read-Write, `@wmkeck.org`) + ~180 Microsoft service accounts
- All staff already have Dynamics licenses — an OBO flow would not require additional licensing, but is not recommended due to complexity

**How to apply:** When evaluating impersonation or delegation approaches, the licensing constraint is not the limiting factor. Complexity of OBO token flows is. See [[project-dynamics-identity-reconciliation]] for the shipped approach (MSCRMCallerID via Delegate role).
