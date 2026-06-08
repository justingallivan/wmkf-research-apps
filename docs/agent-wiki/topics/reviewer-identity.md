---
agent_wiki: topic
status: active
last_verified: 2026-06-08
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
  - pages/api/review-manager/render-emails.js
  - lib/utils/reviewer-invite.js
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
  - identity-unresolved selectability/save-gate behavior changes
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
- Identity-unresolved candidates are gated at TWO boundaries (Slice E, S235), and the two boundaries are INTENTIONALLY asymmetric — the client select list is stricter than the server save gate:
  - **Client (FIND select list):** BOTH the Workbench and the standalone `reviewer-finder.js` gate selectability on `provenanceGroupOf(c) !== 'needs_identity_review'` — they render the `needs_identity_review` group read-only and exclude it from select-all/save. `provenanceGroupOf` routes a row to `needs_identity_review` when `needsIdentification===true || identityStatus==='unresolved' || verificationStatus==='unresolved'`, OR when the provenance kind is barred/unknown AND the row has NO positive identity. A positively-resolved row (confirmed/probable/verified) is ALWAYS selectable even with a barred kind (e.g. a BARRED Track-A row upgraded by a shared-ORCID Track-B match) — the fallback explicitly excludes it.
  - **Server (`save-candidates.js`):** HARD-REJECTS only the EXPLICIT-unresolved triple (`needsIdentification===true || identityStatus==='unresolved' || verificationStatus==='unresolved'`), per-row (422 if the whole batch is rejected; mixed batches return 200 with `rejectedUnresolved`). It deliberately does NOT gate on the full `provenanceGroupOf` — a BARRED/unknown-kind row with no top-level identity is legitimately saved here from other paths (a contact-enriched person with a resolver verdict but no top-level `identityStatus`; see `tests/unit/reviewer-route-identity-gate.test.js`) with field-level gating. Gating the server on `provenanceGroupOf` would wrongly reject those.
  - The gate must survive a Find-roster reload — `pruneCandidateForRoster` persists `identityStatus`/`needsIdentification`/`verificationStatus`, else a deferred candidate re-surfaces as selectable.
- Invite-confidence gate (Slice G, S235): `send-emails.js` independently computes `emailConfidence(person)` (`lib/utils/reviewer-invite.js`) from `wmkf_emailsource`+`wmkf_identitystatus` and REFUSES a LOW-confidence recipient unless that recipient's `suggestionId` is in the request's `confirmedLowConfidenceIds` allowlist (skip reason `email_unconfirmed`). The acknowledgement is recipient-specific, NOT a batch boolean (Codex post-impl #6: a batch boolean would let a row that became LOW after preview ride on another row's confirmation). HIGH = `orcid`/`pubmed`/`institution_page`, or `serp_search`/`claude_search` on a `confirmed`/`probable` identity; LOW = `manual`, `affiliation`, unknown/null source, or a search email on an unconfirmed identity. **Scoped to `templateType==='invitation'`** (first contact); post-acceptance materials/followup/thankyou are NOT gated. `render-emails.js` stamps `emailConfidence` per draft (the modal DTO is too thin to compute it); `InviteEmailModal` shows the warning + one-click "confirm & send" and sets the flag. Manual email edits (`my-candidates.js`) stamp `emailSource='manual'` via the researcher adapter so staff-typed addresses read LOW. The API is the enforced boundary — the modal acknowledgement alone is not trusted.

## Standard Probe

Start with:

```bash
rg -n "writeIdentityDecision|clearIdentityFields|setOrcidIfAbsent|verificationConfidence|publicationCount5yr|currentAffiliation|unconfirmedMatch" lib pages tests docs
```

Then read the relevant source file and adapter in full enough to trace caller to persistence to consumer.
