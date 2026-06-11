# Session 241 Prompt: Reviewer COI Chunk 2b (retire POTENTIAL_CONCERNS)

> ✅ **GIT STATE.** End-of-S240 the Chunk-2a stack was rebased onto the onboarding
> PR #23 (`8d2edae`) and pushed — `origin/main` = **`fcbb258`**, local in sync.
> **Chunk 2a is in prod.** Rebase was clean (reviewer-finder files disjoint from PR
> #23). Verified pre-push: build + 2182 unit tests + all 15 startup gates green on the
> integrated tree. `main` auto-deploys to prod on push.

## Session 240 Summary

S240 built the first two increments of the S239-validated multi-lane reviewer
origination work, each through the full Codex loop (design → pre-impl review → fold →
implement → post-impl review → fold → re-review until SHIP).

### What Was Completed

1. **Chunk 1 — structured-ORCID PI identity (SHIPPED + IN PROD).** Resolves the
   proposal PI from structured Dataverse (request `_wmkf_projectleader_value` →
   contact `wmkf_orcid` → exact OpenAlex author) instead of the LLM-extracted name,
   and uses it to strengthen PI exclusion + coauthor-COI in `discover.js` (+ parity in
   `enrich-recommended.js`). Fail-open, augment-only. New `lib/services/proposal-pi-identity.js`
   (`resolveProposalPI` with a two-source mis-entered-ORCID name guard + `appendPiName`
   + `excludePiIdentity` gated on confirmed/probable) + `OpenAlexService.getAuthorByOrcid`.
   Clients send `requestId`. **Codex: SHIP.** Pushed (b19b3b9) → now in `origin/main`.

2. **Chunk 2a — institution COI (SHIPPED to prod, `fcbb258`; Codex SHIP).** Per the S240 COI
   policy ([[project-reviewer-coi-rely-on-self-disclosure]]): current same-institution
   is now a **HARD DROP on BOTH tracks** matched against the **UNION** of PI
   institutions (ORCID-current + OpenAlex-last-known + LLM); **historical/former-shared
   institution COI RETIRED**; **authoritative save-gate** in `save-candidates`
   (rejects same-institution rows incl. post-enrichment); ORCID-current affiliation
   preferred; co-author COI kept. `markInstitutionCOI` soft flag now survives only on
   the applicant-recommended (flag-not-drop) + post-enrichment paths. 602
   reviewer/identity tests green.

3. **Chunk 2b — designed, NOT built.** Retire the AI `POTENTIAL_CONCERNS` advisory.
   Codex flagged it as **fully coupled**: the field is required by the prompt validator
   (`prompt-validators.js:71`) + repair prompt (`claude-reviewer-service.js:88`), so
   templates + validator + repair + render + persist + ~5 test files + the **prod
   Dataverse reseed** (`seed-reviewer-finder-prompts.js --execute`, **Justin runs**)
   all move together. Design in `docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md` §6 (Chunk 2b).

### Decisions captured (Justin, S240)
- Reviewer COI philosophy: hard-act only on self-evident policy conflicts
  (proposal-authors + CURRENT same-institution); rely on reviewer self-disclosure for
  relationship/inferred conflicts; **no PD-unverifiable soft flags**; historical
  institution doesn't count. → [[project-reviewer-coi-rely-on-self-disclosure]].
- Track A current-same-institution → hard-drop (both tracks uniform).
- Institution COI → match the **union** of known PI institutions.
- Applicant-recommended path → **flag, not drop** (don't silently hide the applicant's pick).

### Commits (chronological)
- **Chunk 1 (in prod):** `7b19db6` design · `49b5b65` pre-impl fold · `e896a93` policy
  · `70e78f0` impl · `6d3952a` post-impl fold · `689beea`/`b19b3b9` abort-guard folds
- **Chunk 2 design:** `d778a81` · `96ca819`
- **Chunk 2a (in prod):** `977dd92` impl · `0fa8e55` post-impl fold · `15b5aa8`
  re-review fold (rebased onto `8d2edae`, pushed as part of `fcbb258`)
- **Docs:** S240 writeup + S241 prompt (this commit)
- All of the above are on `origin/main` at `fcbb258`.

## Potential Next Steps

### 1. Smoke-check Chunk 2a in prod (just deployed)
Chunk 2a (`fcbb258`) is the **first real behavior change** of the COI overhaul —
same-institution candidates now hard-dropped on both tracks; the historical flag/badge
is gone; `save-candidates` rejects same-institution rows. Run a reviewer search on a
request whose PI shares an institution with a likely candidate and confirm: the
same-institution candidate is excluded (with the PD excluded-summary), no "Former
shared institution" badges appear, and a post-enrichment same-institution row can't be
saved. (Verify-prod is the only step not done in S240.)

### 2. Build Chunk 2b — retire `POTENTIAL_CONCERNS` (the primary build; coupled; via the Codex loop)
Code retirement (parse/render/persist + validator + repair prompt + tests) is decoupled
from the prompt reseed (code ignores the field regardless). **Justin runs the prod
reseed.** Watch: removing the field must NOT push COI back into REASONING (keep
"REASONING fitness-only, no COI anywhere"). Design: `docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md`.

### 3. Later multi-lane origination increments (NOT in 2a/2b)
PI-trail corpus lane (ORCID works list), peer-group parsing, topic→author facet
generation, the two net-new COI gates (advisor/advisee + all-time-collaborator),
recency-weighted ranking. Canonical: `docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md` §12.

### 4. Carryover (still open from S238)
Manual-add dedup write path never live-smoked (PR #21); applicant-exclusion breadth
policy ([[project-applicant-exclusion-policy-pending]]); combined Phase I+II PA doc-assembly.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/proposal-pi-identity.js` | Chunk 1+2a: resolveProposalPI, appendPiName, excludePiIdentity, piInstitutions union |
| `lib/services/deduplication-service.js` | `filterConflicts`/`markInstitutionCOI` now accept an institution array; current-only |
| `pages/api/reviewer-finder/discover.js` | builds the union; hard-drops both tracks |
| `pages/api/reviewer-finder/save-candidates.js` | authoritative institution-COI reject gate |
| `lib/utils/reviewer-provenance.js` | `sanitizeInstitutionCOIDetails` (canonical; server+client) |
| `docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md` | Chunk 2 design + Codex folds + 2a/2b split |
| `docs/REVIEWER_FINDER_PI_IDENTITY_WIREIN_PLAN.md` | Chunk 1 design + full Codex history |
| `docs/agent-wiki/topics/reviewer-identity.md` | live institution-COI + structured-PI behavior map |

## Testing
```bash
npx jest reviewer discovery identity dedup coauthor evidence enrich institution save provenance
npm run build && npm run lint
# full startup gate set: see .claude/skills/start
# After rebasing + before pushing 2a, re-run the gate set (esp. check:agent-wiki, check:api-routes).
```
