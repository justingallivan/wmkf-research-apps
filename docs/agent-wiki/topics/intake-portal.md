---
agent_wiki: topic
status: active
last_verified: 2026-06-10
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

Use this page before work on the applicant intake portal: draft capture, submit,
attachment handling, the intake blob path, and intake→Dataverse mapping.

## Ground Rules

- **Private intake Blob operations use `INTAKE_BLOB_RW_TOKEN`, never the shared
  Blob token** (CLAUDE.md safety invariant). `lib/utils/intake-blob.js` is the
  boundary; verify the token before changing upload/attach paths.
- Scope is deliberately skinny — capture-first, machine-legible form fields. Don't
  widen the schema casually; memory `project-intake-portal-skinny-scope` and
  `project-machine-legible-form-capture`.
- Auth is external-id / foundation-anchored, not session identity; institution
  match runs at capture. Memory `project-intake-portal-external-id-foundation`,
  `project-intake-portal-institution-match`, `project-dataverse-creator-privileges`.
- **No banking / PII in Dataverse** (firm constraint). Memory
  `project-no-banking-pii-in-dataverse`.

## Recurring Hazards

- **Virus-scan e2e is DEFERRED and MUST run before the next cycle.** The Cloudmersive
  advanced-endpoint path was built but not end-to-end verified. Memory
  `project-intake-portal-virus-scan-e2e-deferred`, `project-virus-scanning-it-context`,
  `project-cloudmersive-advanced-endpoint`.
- **Slice-0 deactivates, it does not delete (recalc).** A removed line is
  deactivated and budget recalculated, never hard-deleted. Memory
  `slice0-deactivate-not-delete-recalc`.
- Pilot decisions (2026-05-13) and open UI TODOs are captured in memory
  `project-intake-portal-pilot-decisions-2026-05-13` and
  `project-intake-portal-ui-todo` — read before re-deciding settled questions.
- Live-state for intake drafts / aggregates is in the Atlas and
  `docs/atlas/dataverse-akoya-request.md`; the Atlas wins over any claim here.

## Standard Probe

```bash
rg -n "INTAKE_BLOB_RW_TOKEN|intakeDraft|attachToken|deactivat|recalc|cloudmersive" lib pages docs
```

Then read `intake-draft-service.js` and the relevant `pages/api/intake/*` route in
full before changing capture or attachment behavior.
