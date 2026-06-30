# Session 307 Prompt: Reviewer workbench correction-path fixes (merge UX + applicant promote)

## Session 306 Summary

Investigated a program-director bug report from the reviewer workbench (editing a
wrong-namesake "Jun Ye" whose corrected email collided with the applicant-suggested
duplicate, losing all typed edits) and shipped three fixes across two commits, each
Codex design-reviewed before implementation. The data was never actually corrupted —
the system correctly refused a conflicting write and routed to merge — but the UX
around it lost edits and dead-ended. Full `npm test` green except the documented
expected-red `bill.test.js` / `discovery-verification-status.test.js`.

### What Was Completed

1. **Email-collision no longer discards the other edits** (`my-candidates.js handlePatch`).
   The email used to ride in the same atomic person PATCH as name+affiliation, with
   website/h-index written only afterward — so a duplicate-email 409 rolled back
   affiliation AND skipped website/h-index. Now the conflict-safe fields write FIRST
   and the email is isolated LAST; a 409 returns `partialSuccess` + `savedFields`,
   `emailSource:'manual'` is stamped only after the email lands, and
   `CandidateEditModal` shows a "saved" note + routes any cancel through
   `refreshAndClose` so the card isn't left stale.
2. **Blocked-merge message points to the way out** (`CandidateEditModal` MergeMode).
   A merge blocked solely by `loser_in_applicant_slot` is orientation-specific
   (keeping the applicant-suggested record as keeper IS allowed), so the modal now
   tells staff to use **Swap** instead of dead-ending. Softened wording; `bothBlocked`
   CRM/Connor message unchanged; no auto-orient.
3. **Promote persists the PD's hand-corrections** (`promote-applicant-reviewer`).
   Applicant-suggested is the lowest-trust input (no email / wrong-namesake common);
   promote used to flip `wmkf_selected=true` only and silently drop the corrected
   contact — including PD identity-confirmed rows (they route here by
   `provenanceKindOf`→`APPLICANT_SUGGESTED`, NOT to `save-candidates`). Now it flips
   selected first, then writes ONLY the client-marked `manualContactFields` to the
   suggestion's own person record, forcing `emailSource:'manual'` server-side, with a
   non-fatal partial-success `contactError` on email collision (resolves on the
   Invite-tab merge from fix #1/#2).

### Commits
- `10c7932a` — merge UX: stop email-collision from discarding edits + Swap guidance
- `ab9b4274` — promote: persist PD hand-corrections instead of dropping them

## Next Items

### Owner Decision Needed

1. **Remit-flag on review-completion** — wire `wmkf_authorizationtoremitpaymentflag`
   on submit? Carried from S304/S305, not addressed.
   Evidence: `.claude-memory/project-honorarium-payment-landscape.md`.

### Parked

1. **Lift the `loser_in_applicant_slot` v1 merge block** (the real root fix behind
   S306's symptom-patches). Re-point applicant slot lookups (`findApplicantSlotRefs`)
   to the keeper so EITHER merge orientation works, not just Swap.
   Evidence: `.claude-memory/project-reviewer-duplicate-merge.md` (S306 note),
   `lib/services/reviewer-merge.js:185-186`.
   Re-open trigger: real usage shows namesake/wrong-identity applicant merges are
   frequent (parked pending volume — ~4 users, low usage as of S306).
2. Longer carried list (BILL API access, PNI self-report, workbench access
   boundaries, applicant-exclusion, awardee onboarding, Dataverse settings audit,
   GRANTEE_PORTAL title provenance, nomenclature/app-sunset sweep).
   Re-open trigger: owner prioritization. Evidence: `.claude-memory/MEMORY.md` router.

### Do Not Reopen Without New Decision

1. **The staff-editable-review-questions epic is COMPLETE (A–E).** Ratings live solely
   in the `wmkf_appreviewanswer` snapshot; the 3 parent rating columns are dropped from
   Dataverse. Never redeploy any bundle older than `cc0bce6b` (it PATCHes the now-
   missing columns and would 500 submit/upload/no-file).
   Evidence: `docs/STAFF_EDITABLE_REVIEW_QUESTIONS_BUILD_PLAN.md` §6d-E2.

### Verify Before Acting

1. Anything claiming `promote-applicant-reviewer` "only flips selected" or that the
   saved-candidate edit "loses other fields on an email collision" — both are now
   FIXED (S306). Treat such a claim as stale; check `git log` / the two commits above.

## Key Files Reference

| File | Purpose |
|------|---------|
| `pages/api/reviewer-finder/my-candidates.js` | `handlePatch` — safe-fields-first + email-isolated write; 409 returns `partialSuccess`/`savedFields`. |
| `pages/api/workbench/promote-applicant-reviewer.js` | `writePromotedContact` — persists client-marked manual contact on promote; force-manual; partial-success on email conflict. |
| `shared/components/reviewers/CandidateEditModal.js` | Merge mode: partial-save note, refresh-on-cancel, applicant-slot Swap hint. |
| `shared/components/reviewers/ReviewerSearchSection.js` | `setManualContact` records `manualContactFields`; `saveSelected` sends the manual subset + surfaces contact conflicts. |
| `lib/services/reviewer-merge.js` | `planMerge` block predicate (`loser_in_applicant_slot` at :185-186) — the v1 limitation to lift. |

## Testing

```bash
npx jest tests/unit/my-candidates-partial-save-on-email-conflict.test.js \
  tests/unit/candidate-edit-modal-merge.test.js \
  tests/unit/promote-applicant-reviewer-contact.test.js \
  tests/unit/promote-applicant-reviewer-endpoint.test.js
npm test   # full suite, green except expected-red bill / discovery-verification-status
```
