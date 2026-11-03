# Prepared J27 fixture: bounded reviewer rehearsal

[VERIFIED 2026-11-03 via Production browser flow, PDF checks and read-only
Dataverse receipts.] Request 1003456 completed the bounded reviewer rehearsal.
This proves this prepared fixture path, not the broader PD workflow or intake
assembly/AI automations. Owner authorized the one test reviewer invitation,
acceptance, materials inspection and clearly labeled test review; the two policy
acknowledgments received separate action-time confirmation.

## Observed outcome

- Factory reviewer promotion succeeded through the explicit immutable-test action
  after PR #618. The synthetic person's stored identity was not edited by that
  promotion.
- Invitation and one manual materials email were sent to the same owner-approved
  test inbox. Both messages were labeled TEST ONLY; the invitation's honorarium
  promise was replaced with no-payment wording. A first invitation attempt was
  refused before sending because its test label contained the internal request
  number; the corrected attempt was the sole sent invitation.
- Acceptance recorded both current policy acknowledgments and honorarium opt-out.
  Test isolation skips the ordinary automatic acceptance follow-up; the staff
  materials-release flow was exercised explicitly.
- PR #623's Production deployment was verified at merge
  `a66e09091c06d8ed6c4e7443cbe0954ab60a42aa` and the live preflight returned
  `{ok:true,fileCount:1}`. The earlier unavailable result was a false classification
  of expected archive misses. Staff UI treats that result as advisory, so the
  correction alone was not evidence of a completed release.
- Manual release reported Sent for delivery and the staff row became Materials
  Sent. The prior invitation URL then returned hash_mismatch as expected.
- The browser still contained that original invitation URL. The existing current
  URL was recovered read-only from the exact test materials email record, with
  exact request/suggestion/recipient checks; no token was regenerated and no
  additional email sent. Mail-app access was not available. Inbox delivery of the
  materials email was not independently verified; Dataverse reports both email
  activities as Sent (status 3).
- The current materials URL displayed the exact canonical reviewer PDF and the
  structured review form. The PDF downloaded through that portal link, parsed as
  an unencrypted 24-page PDF and all 24 pages rendered. Sampled first/last pages
  were readable. Its 1,615,389 bytes and SHA-256 matched the saved Factory source
  package exactly. This was a copied source document, not newly assembled intake
  output.
- All narrative responses were explicitly TEST ONLY and stated that no scientific
  assessment was performed. Required categorical values were labeled arbitrary
  test placeholders in the narrative. Autosave displayed Saved.
- Submission displayed Review submitted / Review received at 2:11 PM Pacific.
  Staff Track showed Review Received; staff Reviews showed one of one accepted
  reviewer submitted, with all nine answers and the explicit test labels visible.
- The read-only 22:14 UTC receipt found nine distinct answer keys, honorarium
  declined, no linked honorarium request, zero request-payment rows, two email
  activities and two sent email activities. Request readiness remained true,
  Phase I Invited, Phase II Pending Committee Review and derived Phase II Pending.
- Temporary downloaded/rendered proposal copies created for this check were
  removed after hash verification. The canonical SharePoint copy, Factory source
  package metadata, local metadata receipts and application screenshots were
  preserved. Bearer links, email bodies, proposal contents and screenshots are
  not committed.

## Reproduction and boundaries

- `scripts/read-test-materials-email-link.mjs`: GET-only exact marked-test email
  read; private mode-0600 link output, no mint/send or bearer value on stdout.
- `scripts/probe-factory-reviewer-rehearsal.mjs`: GET-only exact marked request,
  suggestion, answer-count, payment-count and email-status receipt; rejects
  mismatched pairing or incomplete paginated reads.
- Both probes were executed successfully for this fixture; scoped ESLint passed.
  They are diagnostics, not new runtime app surfaces.
- No synthesis, payment/onboarding, reviewer-complete action, cleanup of live
  records or real-request transition was exercised. The review remains clearly
  test data on the marked fixture. Honorarium and ordinary automatic follow-up
  paths were deliberately outside this rehearsal.
