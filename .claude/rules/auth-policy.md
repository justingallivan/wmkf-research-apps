---
paths:
  - "proxy.js"
  - "lib/utils/auth-policy.js"
  - "lib/utils/auth.js"
  - "pages/api/auth/**"
---

# Auth Policy And Proxy

Keep `auth-policy.js` bundle-safe because both proxy and Node helpers consume it. Production auth must fail closed unless the documented emergency bypass is explicitly enabled. Preserve staff/applicant session non-crossing and derive identity from authenticated context.
