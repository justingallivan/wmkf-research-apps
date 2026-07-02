---
agent_wiki: topic
status: active
last_verified: 2026-06-14
stale_after_days: 60
owner: intake-portal
source_files:
  - pages/api/intake/submit.js
  - pages/api/intake/draft.js
  - pages/api/intake/draft/attach.js
  - pages/api/intake/draft/upload-token.js
  - lib/services/intake-draft-service.js
  - lib/services/intake-audit-service.js
  - lib/intake/rate-limit.js
  - lib/utils/intake-blob.js
canonical_docs:
  - docs/INTAKE_PORTAL_DESIGN.md
  - docs/INTAKE_PORTAL_SCHEMA_CHANGES.md
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/dataverse-akoya-request.md
watch_paths:
  - pages/api/intake/**
  - lib/services/intake-draft-service.js
  - lib/services/intake-audit-service.js
  - lib/intake/**
  - lib/utils/intake-blob.js
update_triggers:
  - intake draft / submit / attachment flow changes
  - intake blob token or virus-scan handling changes
  - intake auth / external-id / institution-match changes
  - intake-to-Dataverse field mapping changes
---

# Intake Portal

Use this page before work on applicant intake: draft capture, submit, attachment
handling, intake Blob storage, auth/external identity, institution match, and
intake-to-Dataverse mapping.

## Ground Rules

- Private intake Blob operations use `INTAKE_BLOB_RW_TOKEN`, never the shared Blob token.
- Scope is deliberately skinny: capture-first and machine-legible form fields.
- External identity and institution match are foundation-anchored; do not accept authenticated/person identity from client input when server context supplies it.
- No banking/PII belongs in Dataverse.
- Live-state for tables, entities, read/write paths, and migration status lives in the Atlas.

## Durable Memory

- Scope and pilot posture: `project-intake-portal-skinny-scope`, `project-intake-portal-pilot-decisions-2026-05-13`.
- Reviewer capture and field capture: `project-intake-portal-reviewer-capture`, `project-machine-legible-form-capture`.
- Document-capture → Dataverse-table direction (intake is the natural producer; J27): `project-j27-doc-capture-evolution`.
- External ID, institution match, creator privileges: `project-intake-portal-external-id-foundation`, `project-intake-portal-institution-match`, `project-dataverse-creator-privileges`.
- Intake UI TODOs: `project-intake-portal-ui-todo`.
- Virus scan and Cloudmersive: `project-intake-portal-virus-scan-e2e-deferred`, `project-virus-scanning-it-context`, `project-cloudmersive-advanced-endpoint`.
- Cross-topic hard constraint: `project-no-banking-pii-in-dataverse`.

## Operating Notes

- Virus-scan E2E was deferred and must run before the next cycle.
- Budget/roster drain reconciliation deactivates obsolete child rows (`statecode`), never hard-deletes removed lines; recompute over active children only. Current pointers: `docs/INTAKE_PORTAL_BUDGET_ROSTER_RECONCILE_STATUS.md` and `lib/dataverse/schema/wave4/wmkf_proposalbudgetline.json`.
- Pilot decisions and UI TODOs should be read before re-deciding settled questions.

## Standard Probe

```bash
rg -n "INTAKE_BLOB_RW_TOKEN|intakeDraft|attachToken|deactivat|recalc|cloudmersive" lib pages docs
```

Then read `intake-draft-service.js` and the relevant `pages/api/intake/*` route
in full before changing capture or attachment behavior.
