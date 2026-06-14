---
agent_wiki: topic
status: active
last_verified: 2026-06-13
stale_after_days: 60
owner: platform-security
source_files:
  - lib/utils/tracked-secrets.js
  - lib/utils/intake-blob.js
  - pages/api/
canonical_docs:
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/CREDENTIALS_RUNBOOK.md
  - docs/AUTHENTICATION_SETUP.md
  - docs/SECURITY_ARCHITECTURE.md
  - docs/APPLICATION_STATE_ATLAS.md
watch_paths:
  - pages/api/**
  - lib/utils/tracked-secrets.js
  - lib/utils/intake-blob.js
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/CREDENTIALS_RUNBOOK.md
update_triggers:
  - API route auth/security changes
  - credential or tracked-secret changes
  - private blob/file access changes
---

# Security & Auth

Use this page for app access, admin routes, API security, tracked secrets,
private Blob/file access, prompt-injection hardening, and download proxy patterns.

## Ground Rules

- Never accept user/profile identity from request input when authenticated context supplies it.
- API keys and secrets stay server-side.
- Private intake Blob operations use `INTAKE_BLOB_RW_TOKEN`.
- API route security changes must reconcile the security matrix.

## Durable Memory

- Access/admin/credits: `project-app-access-control`, `project-admin-dashboard`, `project-api-credit-monitoring`.
- Security: `project-a7-prompt-injection-hardening`.
- Private download pattern: `project-download-proxy-parked`.
- No banking/PII: `project-no-banking-pii-in-dataverse`.

## Standard Probe

```bash
rg -n "getServerSession|requireAuth|authorization|trackedSecrets|INTAKE_BLOB_RW_TOKEN|BLOB" pages/api lib docs
```
