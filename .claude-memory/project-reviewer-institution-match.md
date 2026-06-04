---
name: project-reviewer-institution-match
description: Reviewer affiliation must be matched against existing `accounts` whenever it lands in Dataverse — discovery save, contact promotion, and any future reviewer-side edit
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: S213 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: a free-text reviewer affiliation is about to land in Dataverse (discovery save, contact promotion, or any reviewer-side edit).

Do:
- Match affiliation against existing `accounts.{name, akoya_aka, wmkf_legalname, wmkf_abbreviation}` via Dataverse Search before writing; match-first, create-as-last-resort.
- Set `contact.parentcustomerid` to a matched account GUID at promotion (highest-impact touch point), not a free-text fill.
- Reuse one fuzzy-match primitive shared with the intake portal.

Do not:
- Let raw web-search affiliation strings populate `contact.parentcustomerid` unmatched — it fragments grant history and pollutes the registry.
- Assume `reviewer-finder/send-emails.js` is the promotion path — it's `pages/api/review-manager/send-emails.js` (verified S209).

Ground truth: `pages/api/review-manager/send-emails.js`, `docs/atlas/dataverse-akoya-request.md`, [[project-intake-portal-institution-match]], [[reviewer-identity-fragmentation]], [[project-contact-promotion-permission]].

The reviewer pipeline has the same institution-dedup hazard as the intake portal: a free-text "affiliation" string entering Dataverse without being matched to an existing `account` fragments a researcher's grant history and pollutes the canonical institution registry.

**Current state (S168, 2026-05-20):**
- `wmkf_potentialreviewer.wmkf_primaryaffiliation` (S213: was `wmkf_appresearcher.wmkf_primaryaffiliation` before the sidecar collapsed onto the person) is a **String**, not a lookup. It receives raw web-search output from PubMed / ArXiv / SerpAPI scraping in `save-candidates.js`. **No curation / matching against `accounts` happens today.**
- Contact promotion at acceptance (per [[project-contact-promotion-permission]] — "send-emails fully links potentialreviewer → contact") is the path that touches `contact.parentcustomerid` (lookup → `account`). This is the load-bearing join for "what institution does this person belong to in our org graph."
- A reviewer-facing affiliation-correction UI may or may not exist yet; user (S168) is unsure, my memory says Stage 2a doesn't collect this. Treat as forward work, not a live surface.

**Why:** without enforced matching, `contact.parentcustomerid` ends up pointing at fragmented or auto-created junk accounts. This is the failure mode already sample-observed in [[reviewer-identity-fragmentation]] (S158: ≥4 disjoint stores per reviewer, no shared key). Cleanup post-hoc is staff-expensive and AI-confounding (name-match ≠ GUID-match, per the contact-divergence finding in `docs/atlas/dataverse-akoya-request.md`).

**How to apply** (touch points in priority order):
1. **Contact promotion (highest impact).** When `wmkf_potentialreviewer` → `contact` promotion happens (currently in `pages/api/review-manager/send-emails.js` — NOT `reviewer-finder/send-emails.js`, which doesn't exist; [verified S209]), set `contact.parentcustomerid` to a matched `account` GUID, not a free-text fill. Use the same fuzzy-match primitive as the intake portal ([[project-intake-portal-institution-match]]): Dataverse Search over `accounts.{name, akoya_aka, wmkf_legalname, wmkf_abbreviation}`. Match-first, create-as-last-resort with a "Did you mean…?" interstitial for staff (this path is staff-driven, not applicant-driven, so the interstitial can be a tooltip on the send-emails confirmation).
2. **`wmkf_potentialreviewer.wmkf_primaryaffiliation` curation** (S213: now on the person). Option A: keep the string (web-search snapshot) AND add a sibling lookup `wmkf_primaryaccount → account` populated by best-effort match at save-candidates time, defaulting to unset when confidence is low. Option B: schema-change to lookup-only. A is lower-risk; staff can still see the raw scraped string for reviewer disambiguation. Decide with Connor.
3. **Reviewer self-edit (if/when built).** Same matching primitive applies — when the reviewer corrects their affiliation, surface candidate `accounts` rather than accept a free-text string. If no match scores above threshold, allow free text but flag for staff review before contact promotion.

**Cross-cutting:** the same fuzzy-match service should serve both the intake portal and the reviewer pipeline. Build it once. Reuse extends to any future flow where free-text institution names enter Dataverse (PA flows, Bill.com sync, etc.).

Related: [[project-intake-portal-institution-match]] (same primitive, applicant-side), [[reviewer-identity-fragmentation]] (the failure mode being prevented), [[project-contact-promotion-permission]] (current promotion code path).
