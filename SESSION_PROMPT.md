# Session 237 Prompt: Reviewer field-aware verification + manual add/ORCID + regression fix shipped

## Session 236 Summary

A long session, all shipped to `main` (auto-deploys to prod). Two arcs ran the full Codex loop
(design → pre-impl → impl → post-impl); a third was a live-testing-driven regression caught and
fixed same session.

### What Was Completed

1. **Reviewer-search UI fixes** (`38bf9ab`) — two PD-reported issues on a physics search:
   the "Unverified suggestions" label hardcoded "PubMed couldn't confirm these" (relabeled
   database-neutral); a Claude suggestion that *also* verified from a DB search appeared under
   BOTH headings (added `unverifiedToShow` dedup — the verified row wins). `ReviewerSearchSection.js`.

2. **Field-aware Track-A verification** (`d03e09a` + post-impl `c6ba84b`; spec `2788ae2`; memory
   `7c17d71`, `02182d3`) — the big arc. Root cause of #1: Track-A verification of Claude's named
   suggestions was **PubMed-only**, so non-biomedical (physics/chem/CS) suggestions all failed.
   - **Change 1:** new `DiscoveryService.suggestionVerifierRouting()` routes clearly-non-biomedical
     proposals to the OpenAlex/ORCID spine instead of PubMed. `pubMedVerificationContract` left
     field-UNAWARE so the coauthor-COI gate at `discover.js:244` is untouched (Codex E.2 catch).
   - **Change 2:** forename-gate the spine promotions (was ungated). **NOTE: this Change 2 caused
     the regression in #4 — see below; its gate semantic was fixed later this session.**
   - **Post-impl fix:** spine-verified candidates now carry `affiliationHistory` (from ORCID
     employments) so former-institution COI still fires (Codex CHECK 4).
   - Side-effect logged: `evaluateCrossFieldNamesakeGuard` is now inert for physical/eng proposals
     → parked in new `project-deferred-code-cleanup` backlog memory (retire later, verify callers).

3. **Manual reviewer add → ORCID lookup** (`d8a6bd9`, `8c19b0a`, `42aa9fe`) — **NOT Codex-reviewed
   (self-reviewed only); pending next session (see top of S236 prompt / the note still applies).**
   - Reviewed + committed Codex's Phase-1 manual add (`d8a6bd9`): new `/api/workbench/manual-reviewer`,
     `ensureStaffManualCandidate` adapter (idempotent, source-union, fail-closed on excluded, reselect).
   - Renamed "Add reviewer" → "Manually Add New Reviewer", moved below search / above verify via a
     `manualAddSlot` passed into `ReviewerSearchSection` (`8c19b0a`).
   - **ORCID lookup** (`42aa9fe`): new read-only `/api/workbench/orcid-lookup` reusing
     `ORCIDService.findContact` (name-match-gated, abstains on ambiguity); "Find ORCID" button +
     ORCID field on the form; a staff ORCID is persisted **fill-only** via `upsertByPotentialReviewer`
     (never overwrites resolver/attested ORCID, never touches `wmkf_identitystatus`). Open question
     for review: fill-only vs allow staff *correction*; ORCID search uses name+affiliation, not email.

4. **Forename-gate REGRESSION fix (Keller/Sang)** (`b2245d0` + Codex follow-up `28a764d`) — a PD
   flagged two proposal-named physics reviewers (Ursula Keller, Robert Sang) coming back UNVERIFIED
   (0 pubs, no email) though previously verified. Live spine probe proved cause: Change 2's gate
   (`forenameAgrees !== false`) treated OpenAlex initial-only records ("U. Keller", "R. T. Sang")
   as "wrong forename" and demoted confirmed→unresolved despite affiliation_match[strong] +
   orcid_employment_corroborated[strong]. **Fix:** gate on a forename **contradiction** (both full
   AND different — the "Alfred vs Alain" signature), not initial-only. New `forenamesContradict()`;
   resolver gates `:172`/`:175` on `forenameContradicts !== true`. The `:188` employment-only path
   (no affiliation_match) keeps strict `forenameAgrees === true`. Codex review: SHIP (hazard not
   reopened). Live spine now returns `confirmed` for both.

### Commits (all on `main`, pushed)
- `38bf9ab` UI label + dedup · `2788ae2` design spec · `d03e09a` Change 1+2 · `c6ba84b` COI fix
- `7c17d71` memory · `02182d3` cleanup-backlog memory
- `d8a6bd9` manual add (Codex, reviewed) · `8c19b0a` rename/reposition · `42aa9fe` ORCID lookup
- `b2245d0` forename-gate regression fix · `28a764d` Codex follow-up coverage

## Potential Next Steps

### 1. Codex review of the manual-add / ORCID work (PENDING — promised)
`42aa9fe` (ORCID lookup, new route + identity persistence) and `8c19b0a`. Focus: the fill-only vs
staff-correction persistence policy; ORCID search not using email. Run the Codex post-impl loop.

### 2. Confirm the regression fix in the real flow
Re-run a physics reviewer search and verify Keller / Sang come back **verified with pubs+email**.
The initial-only over-block likely hit other good reviewers too since Change 2 shipped — not just
those two. `npm run smoke:reviewer-contact` for the broader contact battery.

### 3. Deferred cleanup backlog
`[[project-deferred-code-cleanup]]` — retire the now-inert `evaluateCrossFieldNamesakeGuard`
(verify no live caller first). Read at the start of any cleanup session.

### 4. Carryover from S235 (still open)
Smirnova sparse-affiliation selection-collision (hard); sticky-`confirmed` discrepancy
reconciliation ([[project-reviewer-self-report-orcid-sticky-confirmed]] vs spine emitting confirmed).

### 5. Broader direction (NOT this arc)
Reviewer-finder RETRIEVAL REDESIGN ([[project-reviewer-finder-retrieval-redesign]]); the field-aware
routing shipped this session is a compatible interim step that reduces the physics-recall cliff.

## Standing context / guardrails
- **`main` auto-deploys to prod on push. Commit/push only when asked. Stage by explicit path.**
  `npm run build` green before pushing — Codex CANNOT run build/jest; run them yourself.
- **Delegating to Codex = isolated git worktree off HEAD → commit first**
  ([[feedback-commit-before-delegating-to-worktree-agent]]). Pass a self-contained prompt; embed
  uncommitted spec text inline if it isn't committed yet.
- **No backticks in `git commit -m "…"` (double-quoted bash runs them as command substitution and
  mangles the message).** Use single quotes, or avoid backticks.
- Identity principles: **identity-confirmed ≠ contact-validated; anchor-or-abstain**
  ([[project-reviewer-contact-enrichment-anchoring]]); the spine is **fail-dangerous** — abstains
  rather than mis-verify ([[project-reviewer-verify-fail-dangerous]]). **Forename gate = block a
  CONTRADICTION (both full + different), not an initial-only record (S236 lesson).**
- Keep the Codex loop: spec → design review → implement → post-impl review → reconcile → merge.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/discovery-service.js` | `suggestionVerifierRouting` (field-aware Track-A), `pubMedVerificationContract` (COI gate, field-unaware), `mapSpineVerificationResult`. |
| `lib/services/reviewer-identity-evidence.js` | `forenameFullyAgrees`, `forenamesContradict` (both in `_internals`), `buildAnchors`, spine selection. |
| `lib/services/reviewer-identity-resolver.js` | `classifySpineEvidence` — `:172/:175` forename-contradiction gate; `:188` employment-only strict gate. |
| `lib/dataverse/adapters/reviewer-suggestion.js` | `ensureStaffManualCandidate` (manual add). |
| `lib/dataverse/adapters/researcher.js` | `upsertByPotentialReviewer` (fill-only ORCID/metrics writer). |
| `pages/api/workbench/manual-reviewer.js` | Manual add endpoint (+ fill-only ORCID persist). |
| `pages/api/workbench/orcid-lookup.js` | Read-only ORCID lookup (reuses `ORCIDService.findContact`). |
| `shared/components/reviewers/ReviewerFindPanel.js` | Manual-add form (state + `manualAddSlot`, ORCID lookup). |
| `docs/REVIEWER_FIELD_AWARE_VERIFICATION_DESIGN.md` | Field-aware verification + forename-gate spec (incl. the regression history). |
| `docs/REVIEWER_MANUAL_ADD_DESIGN.md` | Manual add Phase-1 design. |

## Testing

```bash
npx jest reviewer discovery identity contact provenance save manual-reviewer orcid-lookup
npm run build
npm run smoke:reviewer-contact                 # live + offline contact-anchoring battery
# full startup gate set: see .claude/skills/start
```
