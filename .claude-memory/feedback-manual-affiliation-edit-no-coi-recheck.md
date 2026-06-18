---
name: feedback-manual-affiliation-edit-no-coi-recheck
description: "Product-owner decision (S267): a staff hand-typed affiliation edit on the reviewer Find/Workbench card should NOT trigger an institution-COI re-check. Don't add COI re-derivation to the on-card manual edit. The real-world edits are department/center → parent-institution refinements, not new-institution changes."
metadata: 
  node_type: memory
  type: feedback
  status: active
  scope: code
  last_verified: 2026-06-18 via session-decision
  originSessionId: a647b42e-0a37-4ef2-8e1d-ee1f87fb8990
---

## Rule

When working on the reviewer on-card manual contact edit (`ReviewerSearchSection.setManualContact`
+ `CandidateEditModal` local mode) or any future affiliation-edit affordance, do NOT gate or
re-run institution-COI on a manually edited affiliation.

**Why:** S267, building the on-card "✏️ Edit contact". Codex flagged (MED) that a hand-typed
affiliation isn't re-checked for institution COI, so a same-institution reviewer could slip past
the save gate (which reads only the pre-computed `hasInstitutionCOI`/`coiRecomputed` flags). The
product owner (Justin) decided NOT to add a COI re-check: in practice the affiliation errors he
fixes are "listed a department or a center instead of the parent institution" — i.e. refinements,
not institution changes. Such a refinement would, if anything, REVEAL a real same-institution COI
(dept string → "MIT") rather than introduce a hidden one, so the residual risk is low and accepted.

**How to apply:**
- Keep affiliation (and h-index) editable on the Find card without a client COI re-derivation.
- This is an accepted, owner-approved risk — don't "fix" it by adding COI re-check unless the owner
  asks. The invite-time wrong-person backstop is separate and unaffected (email stays `manual` →
  low-confidence → confirm-before-send).
- Contrast: the contact-recall safety invariant that DOES hold — a manually entered email/website is
  stamped `manual` provenance and never auto-sends. See [[feedback-prioritize-contact-recall-over-identity-precision]].
- Spec: `docs/REVIEWER_CONTACT_LEADS_SPEC.md` (Slice 4 + on-card manual edit follow-up).
