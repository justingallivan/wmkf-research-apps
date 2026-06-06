---
paths:
  - "lib/bill/**"
  - "pages/api/bill/**"
  - "pages/api/webhooks/bill.js"
---

# BILL Integration

Use the `lib/bill/` wrappers and durable onboarding state rather than ad hoc BILL calls. Preserve webhook atomic dedup, reserve-before-create behavior, torn-state recovery, secret separation, and TTL cleanup. Consult `docs/BILL_LIB_DESIGN.md` and `docs/BILL_CHUNK_4_DESIGN.md`.
