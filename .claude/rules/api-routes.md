---
paths:
  - "pages/api/**"
  - "proxy.js"
  - "lib/utils/auth.js"
  - "shared/config/appRegistry.js"
---

# API Routes And Authentication

Use `requireAppAccess(req, res, ...appKeys)` for app routes, authenticated-context identity for user-scoped operations, and the documented infrastructure/cron/external-token guard for exceptions. Never accept a profile ID from request input when authenticated context supplies it. Register every new route in `docs/API_ROUTE_SECURITY_MATRIX.md`; run `npm run check:api-routes`. Preserve SSE framing for streaming routes.
