---
name: project-reviewer-affiliation-institution-linking
description: Accepted-reviewer affiliation may fill an empty CRM Contact Company link only for one unique normalized exact active Account label; broader institution canonicalization remains parked
status: active
metadata:
  node_type: memory
  type: project
  last_verified: 2026-08-10 via production Contact/Account audit, owner adjudication, guarded nine-row apply, and source implementation tests
  originSessionId: c3f606e9-2cc7-43e5-a6e6-f74614c159f9
---

## Recall Rule

Read before changing accepted-reviewer affiliation handling, Contact
`parentcustomerid`, or the affiliation-mismatch alert.

**Current owner decision (2026-08-10):** at the acceptance-drain boundary,
after accepted state is re-verified and a Contact is resolved, automation may
fill an **empty** Contact parent only when the accepted self-reported
affiliation resolves to exactly one active CRM Account across normalized
`name`, `akoya_aka`, `wmkf_legalname`, or `wmkf_dc_aka`. Do not overwrite an
existing parent, create an Account, infer acronym expansion, use fuzzy/provider
similarity, or fall back to discovery affiliation. Ambiguous and unmatched
cases retain the staff warning.

**Source state:** `lib/services/auto-link-reviewer-contact-account.js` and
`lib/utils/reviewer-institution-account-match.js` implement this rule on the
current branch pending promotion. `reviewer-acceptance-drain.js` invokes it
after the withdrawal re-check and before the affiliation warning. Exact links
suppress the warning; operational failures keep the durable acceptance job
retryable and defer transient alert noise. `contact.setParentAccountIfEmpty`
uses a fresh ETag, preserves every existing parent, and re-evaluates 412 races.

**Evidence that changed the earlier alert-only decision:** the committed
`scripts/probe-reviewer-contact-account-link-candidates.mjs` audit used the
same exact/AKA/legal/DC-AKA labels and exposed named targets for adjudication.
The owner adjudicated the results; acceptance/provenance probes narrowed the
one-time production apply to nine real new-to-us accepted reviewers (Martha Cat
and other test rows excluded). The guarded apply wrote and independently
verified all nine without conflict. This established a useful conservative
subset without authorizing broader fuzzy matching.

**Still parked:** canonicalizing/deduplicating CRM Accounts, enriching them
with ROR/EIN/aliases, typeahead selection, creating missing Accounts, and
linking discovered-but-not-accepted reviewers. Connor/Sarah Account cleanup is
still the prerequisite for those broader cases; the acceptance-time exact
subset does not solve the messy-target problem.

**Writeup contract remains independent:** Reviews and planned Pre-Site/Final
writeups use the accepted suggestion's `wmkf_revieweraffiliation` first, with
reviewer-person fallback and an explicit missing state. Contact
`parentcustomerid` is not a prerequisite for rendering reviewer names and
affiliations.

See [[project-reviewer-verify-fail-dangerous]] for the wrong-identity hazard and
`docs/REVIEWER_CONTACT_PROMOTION_AND_ADDRESS_LIFECYCLE.md` for the current
caller→persistence→alert contract.
