---
paths:
  - "pages/api/intake/**"
  - "lib/utils/intake-blob.js"
  - "lib/utils/virus-scan-config.js"
  - "lib/services/review-upload.js"
---

# Intake And Upload Safety

Intake private Blob operations use `INTAKE_BLOB_RW_TOKEN`, never the shared Blob token. Preserve the three-call attachment contract, server-managed pending attachments, fail-closed virus scanning when enabled, and maintenance cleanup. Consult `docs/INTAKE_PORTAL_DRAIN_PLAN.md` and the relevant attach design before changing these paths.
