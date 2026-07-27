---
name: project-intake-portal-institution-match
description: Intake portal must match an applicant's institution against existing `account` rows before creating a new one — typo-fuzzy ("Stafnord" → "Stanford"), AKA-aware
metadata:
  type: project
  status: active
  scope: intake
  last_verified: 2026-07-27 via owner park decision and current account-search primitives; matching UX remains planned
---

> **BUILD PARKED (2026-07-08, S348):** the intake-portal build (incl. this institution
> typeahead) is on the back burner (Connor re-engineering GOApply). Retained for revival;
> don't start build work off this memory. See [[project-intake-portal-parked]]. NB the
> *reviewer*-side account-matching twin was reversed as high-harm/low-yield
> ([[project-reviewer-institution-match]]) — revisit whether that applies here (applicant
> self-picks with a confirm-step, a different risk profile) before building.

## Recall Rule

Read this when: designing the intake portal's institution-selection control, or any path where a free-text org name lands in the system (PA flows, external integrations).

Do:
- Match-an-existing-account-first, create-only-as-last-resort.
- Query Dataverse `accounts` against `name`, `akoya_aka`, `wmkf_legalname`, and `wmkf_abbreviation` using fuzzy matching (trigram / edit-distance / Search API relevance).
- Use a typeahead + confirmed-pick UX with a "Did you mean…?" interstitial above a similarity threshold.

Do not:
- Ship a bare free-text Institution box — it pollutes the canonical `account` registry with near-duplicates.
- Rely on Connor's GOverify gate for dedup (it validates tax status only).

Ground truth: Dataverse `accounts` (Search API enabled per [[project-dynamics-explorer-details]]), [[project-intake-portal-skinny-scope]], [[project-machine-legible-form-capture]].

[VERIFIED 2026-07-27 as parked product intent]: the current account-search
primitives exist in `lib/dataverse/adapters/account.js`, but this intake
typeahead/dedup flow is not built. Before revival, verify the applicant
confirm-step risk model and query the live account metadata/read paths.

When the intake portal lets an applicant request a new account / submit a proposal, the institution selection must be **match-an-existing-account-first, create-only-as-last-resort**. A free-text "Institution" box will pollute the `account` table with near-duplicates (typos like "Stafnord", abbreviation drift "Stanford U." / "Stanford University" / "The Board of Trustees of the Leland Stanford Junior University", punctuation/casing variants).

**Why:** the `account` entity is the canonical institution registry shared across Dataverse, Reviewer Finder, Grant Reporting, Bill.com, etc. Polluted rows fragment a researcher's grant history, break the AKA-vs-legal-name distinction surfaced in Reviewer Finder, and force staff cleanup that's expensive and error-prone. The S168 AKA fix established that an account already has three name surfaces (`name`, `akoya_aka`, `wmkf_legalname`) plus `wmkf_abbreviation` — any of those should be matchable.

**How to apply:** when designing the intake portal's institution-selection control:
- Backend search should query Dataverse `accounts` against `name`, `akoya_aka`, `wmkf_legalname`, and `wmkf_abbreviation` (and possibly historic aliases if a multi-alias field is added later). Dataverse Search API is already enabled (77K+ docs) per [[project-dynamics-explorer-details]] and is the natural primitive.
- Use fuzzy matching (trigram / edit-distance / search-API relevance), not exact match — "Stafnord" needs to surface "Stanford" candidates.
- UX: typeahead with confirmed-pick (show formal name + AKA + city/state for disambiguation). "Create new" is a separate, secondary path with a "Did you mean…?" interstitial when any candidate scores above a similarity threshold.
- Same matching logic applies any time a free-text org name lands in the system (PA flows, external integrations) — not just the portal.
- Connor's account-create gate (GOverify) handles tax-status validation but does not enforce dedup; this is an additional layer.

Related: [[project-intake-portal-skinny-scope]] (pilot constraints — institution-match is a candidate for pilot scope, but the *full* matching logic could ship later if pilot accounts are all known/pre-vetted), [[project-machine-legible-form-capture]] (same theme: structure beats free text at intake).
