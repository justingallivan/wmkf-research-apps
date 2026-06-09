---
name: project-reviewer-field-aware-verification
description: "SHIPPED S236: reviewer Track-A verification is field-routed — clearly-non-biomedical proposals verify named suggestions via the OpenAlex/ORCID spine, not PubMed (which is biomedical-only). suggestionVerifierRouting() routes; pubMedVerificationContract stays field-UNAWARE so the coauthor-COI gate isn't broken. Spine promotions forename-gated."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-08
---

## Recall Rule
Read before touching reviewer-finder Track-A verification, the verifier-routing,
or `pubMedVerificationContract` in `lib/services/discovery-service.js`. Durable
design: `docs/REVIEWER_FIELD_AWARE_VERIFICATION_DESIGN.md`.

## What shipped (S236)
The symptom: a physics PD saw every Claude-suggested reviewer dumped into the
read-only "Unverified suggestions" bucket. Cause: Track-A verification was
**PubMed-only by default**, and PubMed is biomedical-only — physicists have no
PubMed record, so all failed `MIN_PUBLICATIONS`.

- **Change 1 — field-routed verifier.** New `DiscoveryService.suggestionVerifierRouting(options)`
  → `spine` when `searchPubmed===false` OR `isClearlyNonBiomedicalVerifierArea(primaryResearchArea)`,
  else `pubmed`. `verifyClaudeSuggestions` branches on it. The spine
  (`ReviewerIdentityEvidence.evaluateSuggestion`, OpenAlex+ORCID) is domain-agnostic
  and produces real verified/probable candidates (abstains otherwise — fail-safe).
  Ambiguous/unset fields stay on PubMed (the non-bio test needs a POSITIVE
  physical/eng match, so `'Not specified'` → PubMed).
- **Change 2 — forename gate** on the spine promotions; see
  [[project-reviewer-verify-fail-dangerous]].

## The load-bearing trap (why pubMedVerificationContract stayed field-unaware)
**Do NOT make `pubMedVerificationContract` field-aware.** It is ALSO the gate for
the PubMed coauthorship-COI check at `discover.js:244`. The first design did
exactly that and Codex caught it (E.2): flipping the contract to `false` for
non-biomedical proposals would have **silently disabled coauthor-COI detection**
for them. The fix decouples: routing is a separate function; the contract stays
keyed on `searchPubmed` only.

## How to apply
- Field detection reuses `isClearlyNonBiomedicalVerifierArea` /
  `isPhysicalOrEngineeringResearchArea` (positive allowlist; unset → PubMed).
- Spine-verified candidates must carry the same downstream fields the PubMed path
  sets, or they silently skip checks — S236 post-impl found `affiliationHistory`
  missing (former-institution COI skipped); now plumbed from ORCID employments.
  When adding a verifier path, diff its candidate shape against the PubMed one.
- This is an **interim routing fix within the current architecture**, compatible
  with and reducing the physics-recall cliff in the larger
  [[project-reviewer-finder-retrieval-redesign]] (NOT that redesign).
- Side-effect: the PubMed cross-field namesake guard (`evaluateCrossFieldNamesakeGuard`)
  is now inert for physical/eng proposals (spine supersedes it); left in place,
  retirement deferred (verify no caller first).
