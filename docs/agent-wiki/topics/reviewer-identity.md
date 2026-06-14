---
agent_wiki: topic
status: active
last_verified: 2026-06-13
stale_after_days: 45
owner: reviewer-finder
source_files:
  - lib/services/reviewer-identity-evidence.js
  - lib/services/reviewer-identity-resolver.js
  - lib/services/contact-enrichment-service.js
  - lib/services/proposal-pi-identity.js
  - lib/dataverse/adapters/potential-reviewer.js
  - lib/dataverse/adapters/reviewer-suggestion.js
  - lib/dataverse/adapters/researcher.js
  - pages/api/reviewer-finder/discover.js
  - pages/api/reviewer-finder/save-candidates.js
  - pages/api/reviewer-finder/my-candidates.js
  - pages/api/review-manager/send-emails.js
  - pages/api/review-manager/render-emails.js
  - lib/utils/reviewer-invite.js
canonical_docs:
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
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

## Live Enforcement Contracts → `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`

The fail-closed gates that protect against the wrong-person-invite failure are owned by the
**maintained** reference `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` (each traced to live
source file:line). Read it before changing any of these; do not restate its detail here (one home,
no drift). The 8 contracts:

1. **Slice-E identity-unresolved gate** — client FIND select list (`provenanceGroupOf`) is *stricter* than the server save gate (`isUnresolvedIdentity`, 422 on full-batch reject); the asymmetry is intentional.
2. **PI-named / cited / referred exemption + contact force-null** — `cited_reference`/`proposal_named`/`referred` rows (the exempt kinds in `isIdentityReviewExemptProvenance`, S249) are selectable when unresolved but ALL contact + identity-derived fields are force-nulled (`contactBlockedForUnresolvedExempt`) until confirmed/probable.
3. **Slice-G invite-confidence allowlist** — `send-emails.js` recomputes `emailConfidence` per recipient and refuses LOW unless its `suggestionId` is in `confirmedLowConfidenceIds`; scoped to `templateType==='invitation'`.
4. **Structured-PI identity** — `resolveProposalPI` is server-resolved from the request GUID, FAIL-OPEN + AUGMENT-ONLY, gated on confirmed/probable, name-guarded by `forenamesContradict`.
5. **S240 institution COI** — current same-institution is a HARD DROP on both discovery tracks AND re-rejected at the durable save boundary (`rejectedInstitutionCOI`); historical/former-shared COI is retired. `POTENTIAL_CONCERNS` retirement is Chunk 2b (not built — `docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md`).
6. **OpenAlex bibliometrics + verified-domain** — `_attachOpenAlexMetrics` sources metrics/affiliation/verified-domain from OpenAlex (ORCID or carried author id; never a bare name search). Scholar deep-links dropped; field renames in `docs/REVIEWER_FINDER_SERPAPI_MIGRATION_PLAN.md`.
7. **Faculty-page zero-SSRF boundary** — no server-side faculty-page fetch; staff enter the address manually. Auto-fetch SSRF mechanism is designed-but-unbuilt (`docs/REVIEWER_FACULTY_PAGE_RECOVERY_DESIGN.md` §D).
8. **Work-grounding rescue** — `rescueByWorkGrounding` is purely additive, strict-forename-gated, `probable`-ceiling; can only resolve an already-abstained name.

## Recurring Hazards

- Hidden write sinks matter. Do not stop at the route named in the task; trace adapters and service helpers that can persist identity fields or suggestion state.
- ORCID/contact propagation can cross from reviewer-finder into review-manager and honorarium flows. Search call sites before treating it as a local reviewer-finder change.
- Tests that mock an injected resolver or enrichment seam can miss the default production path. Verify at least one unmocked path when the bug involves default credentials, provider routing, or persistence.
- Ranking and verification fields may be consumed downstream even when a task names only enrichment. Trace save, display, and lifecycle consumers before changing field semantics.
- The identity-unresolved, invite-confidence, and institution-COI gates are enforced at the API/persistence boundary, NOT just the client. The clients hide ungrounded rows, but the standalone Reviewer Finder and any direct caller can still POST them — read the enforcement-contracts reference before assuming a client-side check is sufficient.

- **Worked example — namesake-collision recall loss (origination probe, 2026-06-12).** A Claude-named Track-A candidate failed to resolve (`oaId` null) not because the person was fabricated but because **citation-ranked author search resolves the wrong cluster.** Reproducible against live OpenAlex: a real low-footprint researcher (~24 works / ~115 cites) with a *directly on-topic* recent paper shares a name with a **famous unrelated namesake** (a psychologist, ~101 works / ~3,261 cites) that ranks #1 in `GET /authors?search=`; the real person is #2, and her own works are **fragmented across ≥3 author clusters**. Default top-1 name resolution therefore either lands on the wrong person or abstains — and abstaining (`oaId` null) is the SAFE branch (`project-reviewer-verify-fail-dangerous`). Root fixes shipped: field-aware *ranking* (S236: `scoreRecord`/`selectRecord` rank by affiliation+topic overlap, not citations) and the **work-grounding rescue** for the abstain case (Contract 8 above — see the enforcement reference for the safety invariants). The deeper ORCID-works-anchored *origination* corpus remains a separate, larger increment. Names stay in the local gitignored probe artifacts per the names-stay-local norm. Related: `reviewer-identity-fragmentation`.

## Durable Memory

- Identity resolution spine: `project-reviewer-identity-resolution`, `project-reviewer-identity-resolution-phase1`, `reviewer-identity-fragmentation`.
- ORCID and OpenAlex: `project-reviewer-self-report-orcid-sticky-confirmed`, `project-openalex-merge-use-orcid-works`.
- Safety posture: `project-reviewer-verify-fail-dangerous`, `project-reviewer-field-aware-verification`.
- Contact enrichment: `project-reviewer-contact-enrichment-anchoring`, `project-serpapi-budget-latency`, `project-serpapi-capability-erosion`.
- Structured PI and COI: `project-reviewer-pi-identity-structured`, `project-reviewer-coi-rely-on-self-disclosure`, `project-reviewer-coi-concern-surfacing`.
- Matching and institution contacts: `project-reviewer-institution-match`, `project-contact-promotion-permission`, `project-institution-foundation-liaison`.

## Standard Probe

Start with:

```bash
rg -n "writeIdentityDecision|clearIdentityFields|setOrcidIfAbsent|verificationConfidence|publicationCount5yr|currentAffiliation|unconfirmedMatch" lib pages tests docs
```

Then read the relevant source file and adapter in full enough to trace caller to persistence to consumer.
