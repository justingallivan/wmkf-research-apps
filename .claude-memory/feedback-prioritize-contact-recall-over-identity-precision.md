---
name: prioritize-contact-recall-over-identity-precision
description: "The Reviewer Finder's headline utility is contact RECALL (give staff the emails/pages they need). The identity-confirmation gates that suppress wrong-person data ALSO suppress that recall, so endlessly hardening identity precision (namesake/affiliation edge cases) makes the tool LESS useful. When the user's pain is 'candidates lack emails I can find by hand in 30s,' fix recall, not precision."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 404d25f7-fbe1-4ecd-9f37-ec8651198ec4
  status: active
  scope: code
  last_verified: 2026-06-18 via session-feedback
---

## Recall Rule

Read this before starting (or proposing) another reviewer-identity-precision fix (namesake
disambiguation, affiliation matching, ORCID promotion, needs-review tuning).

**Why:** S266 — after many sessions iterating on identity edge cases (Smirnova, Landsman, Le,
needs-review split), the user said it feels like "regressing in utility": searches surface candidates
with no email, while the email is trivially web-discoverable. The root tension: the conservative
identity gates we keep tightening are the SAME mechanism that withholds contact info
(`contact-enrichment-service.js:487` `hasIdentityAnchor` gates the Claude/Serp contact search; an
unconfirmed identity force-nulls email at `_markUnanchoredAbstain` and at the enrich-recommended
`unconfirmedMatch` path). Tightening safety = less recall.

**How to apply:**
- Default to fixing RECALL (find/show the contact) over PRECISION (confirm the identity) when the user's
  complaint is missing-but-findable contact data.
- The agreed architecture: decouple them — a quarantined `contactLeads[]` layer that searches
  aggressively for staff breadcrumbs but never feeds the safe `email`/`website`/persist/invite fields.
  Design + Codex GO-WITH-CHANGES: [[../docs/REVIEWER_CONTACT_LEADS_SPEC.md]] + `REVIEWER_CONTACT_LEADS_REVIEW.md`.
  Build order starts with Slice 1 (MEASURE the real missing-email buckets) before building.
- Identity-precision fixes (e.g. the OpenAlex affiliation-history widening, Codex GO-WITH-CHANGES) are
  real but should be PARKED behind the recall work — they only move a few candidates and don't address
  the headline pain.
- Cardinal safety invariant still holds: leads stay quarantined; a wrong-person email must never reach
  an auto-invite. Related: [[project-reviewer-verify-fail-dangerous]].
