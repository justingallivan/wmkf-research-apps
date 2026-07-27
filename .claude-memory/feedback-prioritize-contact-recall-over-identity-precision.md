---
name: prioritize-contact-recall-over-identity-precision
description: "The Reviewer Finder's headline utility is contact RECALL (give staff the emails/pages they need). The identity-confirmation gates that suppress wrong-person data ALSO suppress that recall, so endlessly hardening identity precision (namesake/affiliation edge cases) makes the tool LESS useful. When the user's pain is 'candidates lack emails I can find by hand in 30s,' fix recall, not precision."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 404d25f7-fbe1-4ecd-9f37-ec8651198ec4
  status: active
  scope: code
  last_verified: 2026-07-27 via source, live contact-gap probe, and owner decision
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
- When staff reports missing-but-findable contact data, inspect the shipped
  contact-audit buckets and quarantined `contactLeads[]` before proposing more
  identity-precision work or more paid search.
- The shipped architecture decouples recall from persistence by surfacing
  already-fetched weak/rejected emails and pages as quarantined staff
  breadcrumbs. It never feeds those leads into the safe
  `email`/`website`/persist/invite fields. See
  [[../docs/REVIEWER_CONTACT_LEADS_SPEC.md]].
- The broader paid scout is **parked, not planned**. A 2026-07-27 live probe
  found only 11/511 selected suggestions without email; all four
  completed-enrichment cases already had quarantined leads. Reopen only if a
  future full-cycle audit finds a material cohort with neither sendable email
  nor a useful lead, or staff reports recurring manual-recovery failures.
- Prioritize recall or identity precision from the measured failure mode; do
  not assume either class of work is categorically next.
- Cardinal safety invariant still holds: leads stay quarantined; a wrong-person email must never reach
  an auto-invite. Related: [[project-reviewer-verify-fail-dangerous]].
