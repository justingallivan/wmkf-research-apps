---
name: project-reviewer-institution-match
description: Conservative accepted-reviewer affiliation to CRM Account rule; exact unique active label only, fill-empty parent only, otherwise abstain
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-08-10 via production audit/adjudication and source implementation tests
---

## Recall Rule

This memory supersedes both the old fuzzy-match proposal and the later blanket
“alert-only / do not build” reversal.

At accepted-reviewer follow-up only:

- Use the accepted suggestion/contact-edit affiliation, not discovery data.
- Match against the complete active Account population using the shared
  conservative normalizer and Account `name`, `akoya_aka`, `wmkf_legalname`,
  and `wmkf_dc_aka` labels.
- Write `contact.parentcustomerid` only when exactly one Account is reached and
  only while the parent is empty.
- Re-read the target and use an ETag-conditional fill-only Contact PATCH.
- Preserve any existing parent. Ambiguous/no-match cases continue to the staff
  mismatch alert. Never create Accounts or use fuzzy/ROR/OpenAlex similarity as
  write authority.
- A capped Account scan is an incomplete-cardinality abstention, not a retry:
  leave the Contact unchanged, emit one deduplicated operations warning, and
  continue the reviewer-specific mismatch alert. A successful or already-correct
  link auto-resolves that reviewer's standing mismatch warning.

Source implementation pending promotion:
`lib/services/auto-link-reviewer-contact-account.js`,
`lib/utils/reviewer-institution-account-match.js`,
`lib/dataverse/adapters/contact.js`, and
`lib/services/reviewer-acceptance-drain.js`.

Broader institution/account cleanup and non-acceptance linking remain parked;
see [[project-reviewer-affiliation-institution-linking]].
