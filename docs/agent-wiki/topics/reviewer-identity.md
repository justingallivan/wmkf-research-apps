---
agent_wiki: topic
status: active
last_verified: 2026-06-07
stale_after_days: 45
owner: reviewer-finder
source_files:
  - lib/services/contact-enrichment-service.js
  - lib/dataverse/adapters/potential-reviewer.js
  - lib/dataverse/adapters/reviewer-suggestion.js
  - lib/dataverse/adapters/researcher.js
  - pages/api/reviewer-finder/save-candidates.js
  - pages/api/reviewer-finder/my-candidates.js
  - pages/api/review-manager/send-emails.js
canonical_docs:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/dataverse-wmkf-potentialreviewers.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
  - docs/SERVICE_AND_UTILITY_CATALOG.md
watch_paths:
  - lib/services/contact-enrichment-service.js
  - lib/dataverse/adapters/potential-reviewer.js
  - lib/dataverse/adapters/reviewer-suggestion.js
  - lib/dataverse/adapters/researcher.js
  - pages/api/reviewer-finder/**
  - pages/api/review-manager/send-emails.js
  - docs/atlas/dataverse-wmkf-potentialreviewers.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
update_triggers:
  - identity persistence or clearing behavior changes
  - ORCID/contact propagation changes
  - reviewer ranking or verification confidence changes
  - reviewer suggestion lifecycle write changes
---

# Reviewer Identity

Use this page before work on reviewer identity, enrichment, ORCID propagation, current affiliation, reviewer suggestions, or candidate ranking.

## Ground Rules

- `wmkf_potentialreviewers` is the person-level reviewer record and carries identity, contact, and bibliometric fields after the sidecar collapse. Verify current schema and source-of-truth details in `docs/APPLICATION_STATE_ATLAS.md` and `docs/atlas/dataverse-wmkf-potentialreviewers.md`.
- `wmkf_appreviewersuggestion` is the per-request lifecycle ledger. Verify suggestion lifecycle and request-specific persistence in `docs/atlas/dataverse-wmkf-appreviewersuggestion.md`.
- Postgres reviewer tables are historical or dropped for this domain. Before acting on a Postgres reviewer-table claim, check the Atlas page and live callers.
- Generic user/profile input must not be trusted for authenticated identity. Preserve route auth and Dynamics restriction context.

## Recurring Hazards

- Hidden write sinks matter. Do not stop at the route named in the task; trace adapters and service helpers that can persist identity fields or suggestion state.
- ORCID/contact propagation can cross from reviewer-finder into review-manager and honorarium flows. Search call sites before treating it as a local reviewer-finder change.
- Tests that mock an injected resolver or enrichment seam can miss the default production path. Verify at least one unmocked path when the bug involves default credentials, provider routing, or persistence.
- Ranking and verification fields may be consumed downstream even when a task names only enrichment. Trace save, display, and lifecycle consumers before changing field semantics.

## Standard Probe

Start with:

```bash
rg -n "writeIdentityDecision|clearIdentityFields|setOrcidIfAbsent|verificationConfidence|publicationCount5yr|currentAffiliation|unconfirmedMatch" lib pages tests docs
```

Then read the relevant source file and adapter in full enough to trace caller to persistence to consumer.
