# Session 236 Prompt: Reviewer identity/contact/invite hardening — large S235 batch shipped

## Session 235 Summary

A long session that shipped the **entire E/G/F follow-on plan** to prod AND a further batch of
reviewer identity/quality fixes driven by live testing on real requests. Every change ran the
full Codex loop (ground → design review → implement → post-impl review → fix → verify → merge);
Codex caught a real issue at nearly every stage. All merged to `main` and deployed.

### What Was Completed

**The E/G/F follow-on plan (all shipped):**
1. **Slice E — identity-review gating** (`39e82b9`): identity-unresolved candidates non-selectable
   (UI read-only `needs_identity_review`) + server 422; markers persist through the Find-roster
   (E1b reload-leak); `provenanceGroupOf` correctness for positively-resolved BARRED rows.
2. **Slice G — invite-confidence + manual-confirm gate** (`4b57472`): `emailConfidence(person)`
   helper; `send-emails` refuses LOW recipients unless their id is in `confirmedLowConfidenceIds`
   (recipient-specific, Codex #6); manual edits stamp `emailSource='manual'`; scoped to invitations.
3. **Slice F — faculty-page email recovery, ZERO-SSRF** (`c5a4a0a`): `CandidatesPanel` "find on
   faculty page →" link; automated server-fetch Codex-reviewed but deliberately NOT built.
4. **Features + 19 prod-validation tests** (`b0ebb77`): `docs/REVIEWER_CONTACT_INVITE_FEATURES_AND_PROD_TESTS.md`.

**Post-plan reviewer fixes (driven by live testing):**
5. **Publication-list backfill + preprint dedup** (`6c8de43`): OpenAlex/ORCID-confirmed reviewers
   (resolved via the spine, non-biomedical) showed "0 publications" + `publicationCount5yr=0`
   (ranking penalty) — `getWorksByAuthor` backfills from the SAME confirmed author; shared
   title-dedup collapses preprint+published across PubMed + OpenAlex, BEFORE the MIN_PUBLICATIONS gate.
6. **Identity: trust ORCID-employment over OpenAlex institution drift** (`4b96ec5`): a real reviewer
   (Olga Smirnova, MBI) was excluded because OpenAlex's `last_known_institution` drifted to a
   sabbatical host (Technion) → no `affiliation_match`. The resolver now promotes
   `orcid_employment_corroborated[strong]` + `topic_match` → `probable` WITHOUT an OpenAlex
   affiliation match — GATED on a strict forename agreement (`forenameFullyAgrees`) to keep the
   namesake fail-safe. Probable-only.
7. **PI-named/cited reviewers selectable when unresolved** (`5086946`): a reviewer the PI explicitly
   named is no longer hard-blocked by Slice E when the spine can't auto-verify — `provenanceGroupOf`
   exempts `cited_reference`/`proposal_named` (selectable-with-warning), and `save-candidates`
   FORCE-NULLS all contact/identity/bibliometric fields for an unresolved exempt row (keyed only on
   the server-resolved `contactEnrichment.identity.status`, not client flags) so a wrong-person
   address can't be saved. UI suppresses contact/metrics for those rows (amber pill only).

**Operational / investigations (no code):**
8. `reset-request-reviewers.mjs` — clarified usage + the **same-flags rule** (dry-run and `--execute`
   must use identical flags) after a run without `--roster-only` soft-deleted 1002794's
   applicant-recommended reviewers; restored them via a targeted `wmkf_selected=true` flip. Memory
   `fc50d08`.
9. **arXiv author-email harvesting EVALUATED → DECLINED** (`fa43cf4`): arXiv shows the *submitter's*
   email behind login + irrevocably blocks bulk viewing; suggestions carry no ORCID. Not viable.

### Key commits (all on `main`, pushed; main auto-deploys to prod)
- E/G/F: `39e82b9` · `4b57472` · `c5a4a0a` · `b0ebb77`
- Publications: `f4c1c5e`→`692d8a2`, merge `6c8de43`
- Identity drift: `15b97fc`, merge `4b96ec5`
- PI-named: `50d3cbe`→`f12ff64`, merge `5086946`
- Memory: `fc50d08`, `fa43cf4`

## Potential Next Steps

### 1. Smirnova sparse-affiliation selection-collision (the remaining half)
The ORCID-employment promotion (#6) recovers her ONLY when her OpenAlex record gets SELECTED;
with a short/empty affiliation string she still abstains at SELECTION (`openalex_collision`, 114
namesakes) before promotion. The PI-named-selectable fix (#7) mitigates (she's selectable-with-
warning regardless), but true auto-resolution would need better namesake disambiguation —
**hard + fail-dangerous**. Codex Q3's "use the suggestion's ORCID" is NOT viable (suggestions carry
no ORCID). See `docs/REVIEWER_IDENTITY_ORCID_EMPLOYMENT_PROMOTION_DESIGN.md`.

### 2. Sticky-`confirmed` discrepancy — dedicated reconciliation pass
`[[project-reviewer-self-report-orcid-sticky-confirmed]]` (S218) claims the automated resolver
never emits `confirmed`, but the S232/S233 spine's `classifySpineEvidence` DOES (Codex-verified).
The memory is flagged; whether the spine's `confirmed` should downgrade to `probable` or the
sticky-sentinel model changes is OPEN.

### 3. Deferred from the plan
- **Slice G-opt2** (send-time audit field `wmkf_emailconfirmed`) — only if a hard requirement.
- **Slice F automated fetch** — the Codex-verified SSRF mechanism is preserved in
  `docs/REVIEWER_FACULTY_PAGE_RECOVERY_DESIGN.md`; do NOT add a server-side external-page fetch
  without it.
- **Widen the contact-anchoring smoke** beyond request 1002794 (incl. the PubMed/biomedical path).

### 4. Run the prod-validation tests
`docs/REVIEWER_CONTACT_INVITE_FEATURES_AND_PROD_TESTS.md` (19 tests). Quickest signal:
`npm run smoke:reviewer-contact`.

### 5. Broader direction (from S231/S232, NOT this arc)
Reviewer-finder RETRIEVAL REDESIGN; OpenAlex+ORCID spine biomedical-path + stratum-3 shadow-run
before broader cutover. See `[[project-reviewer-finder-retrieval-redesign]]`.

## Standing context / guardrails
- **`main` auto-deploys to prod on push. Commit/push only when asked. Stage by explicit path.**
  `npm run build` green before pushing — Codex CANNOT run build/jest; run them yourself.
- **Delegating to Codex = isolated git worktree off HEAD → commit first**
  ([[feedback-commit-before-delegating-to-worktree-agent]]). Codex companion was flaky this session
  (empty/background/stuck runs) — retry with `--fresh` + a self-contained prompt if a review hangs.
- **`reset-request-reviewers.mjs` SAME-FLAGS RULE**: dry-run and `--execute` must use identical
  flags ([[project-reviewer-find-roster]]).
- Identity principles: **identity-confirmed ≠ contact-validated; anchor-or-abstain**
  ([[project-reviewer-contact-enrichment-anchoring]]); the spine is **fail-dangerous** — abstains
  rather than mis-verify ([[project-reviewer-verify-fail-dangerous]]).
- Keep the Codex loop: spec → design review → implement → post-impl review → reconcile → merge.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/reviewer-identity-evidence.js` | Spine: `forenameFullyAgrees`, anchor scoring, selection. |
| `lib/services/reviewer-identity-resolver.js` | `classifySpineEvidence` — ORCID-employment→probable promotion. |
| `lib/services/openalex-service.js` | `getWorksByAuthor` (publication backfill), `shortOpenAlexId`. |
| `lib/services/discovery-service.js` | `backfillOpenAlexPublications`, `dedupePublicationsByTitle`. |
| `lib/utils/reviewer-provenance.js` | `provenanceGroupOf` + `isIdentityReviewExemptProvenance` (PI-named exemption). |
| `pages/api/reviewer-finder/save-candidates.js` | `isUnresolvedIdentity` exemption + `contactBlockedForUnresolvedExempt` nulling. |
| `lib/utils/reviewer-invite.js` | `emailConfidence` (Slice G). |
| `pages/api/review-manager/send-emails.js` | Server invite-confidence gate. |
| `docs/REVIEWER_IDENTITY_ORCID_EMPLOYMENT_PROMOTION_DESIGN.md` | Identity drift fix + the unbuilt selection follow-up. |
| `docs/REVIEWER_CONTACT_INVITE_FEATURES_AND_PROD_TESTS.md` | Features + 19 prod tests. |

## Testing

```bash
npm run smoke:reviewer-contact                 # live + offline contact-anchoring battery
npx jest reviewer provenance discovery identity save contact roster invite --runInBand
npm run build
# full startup gate set: see .claude/skills/start
```
