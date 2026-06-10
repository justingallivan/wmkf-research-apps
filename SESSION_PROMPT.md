# Session 239 Prompt: Reviewer-finder recall flaw confirmed + rescue dossier prepared for a fresh-model review

## Session 238 Summary

All on `main` (auto-deploys to prod). The session started as "ship two small reviewer-finder
fixes," ran them through the Codex loop, then **live-smoked them — and the smokes exposed a deeper,
structural recall flaw**. It ended by preparing a **rescue dossier** for a fresh Claude model,
because we're worried we're circling (patching candidate *handling* while *origination* stays broken).

### What Was Completed

1. **Three discover-disposition fixes — SHIPPED + LIVE-VERIFIED** (`10ef27f`, `25110c8`, `3c79bac`).
   All "surface, don't silently drop," on the recall-over-precision thesis:
   - **Track-B `<3`-pub → warning, not drop** (`partitionByPublicationBar`). Dedup of a
     preprint+published pair can push a real reviewer under the bar.
   - **`isRelevant: No` cull → surfaced + ranked-last + named** (`aiFlaggedNotRelevant`,
     `rankAllCandidates`). Was a silent, count-only parametric cull of *grounded* people.
   - **Coauthor COI graded** `likely`/`possible` (`gradeCoauthorCOI`, max-shared-with-one-author ≥3
     = likely). A single hub-artifact paper now reads amber, not red — protects methods experts.
   - Codex post-impl review caught 3 real consumer-safety bugs (Workbench re-rank undid "ranked
     last"; roster DTO dropped the new fields → reload regression; persisted COI notes ignored
     severity) — all fixed, confirmed clean by a 2nd Codex pass.

2. **Design docs consolidated into ONE** (`10ef27f`). `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md`
   is now canonical: Part A (retrieval-first plan), Part B (field primer), Part C (S238 discussion).
   Removed the decomposition + refinements docs; repointed references.

3. **CONFIRMED structural flaw — Track-B activity signal (§8f)** (`c7af6ea`). The
   "Olga Smirnova h-index 61 but '2 publications', ranked 28th" paradox. A Track-B candidate's pub
   count = **keyword-search-hit concentration**, not the author's corpus: ~3 queries × top-50 ×
   one-author-per-paper → in a busy field, ~everyone has count ≈1, so `MIN_PUBLICATIONS≥3` buries
   real leaders and misfires. Triangulated 3 ways (live runs, the funnel math, **Codex line-level
   code adjudication**). Fix scoped in §8f (in-pipeline: re-eval activity from the *resolved* author
   corpus + widen the OpenAlex backfill, plus a cap-25 selection complication; redesign-scope:
   non-origination — single-author-position minting means heavyweights are sometimes never minted).

4. **Read-only live smoke harness** (`6d7837d`, `0d49d07`) —
   `scripts/smoke-discover-dispositions.mjs`. Runs the real pipeline on a request, dumps lane
   attribution (Track-A vs Track-B) + disposition flags + an overlap table vs a known reviewer set.
   This is how §3/§8f were measured. Confirmed run-to-run **nondeterminism** (each run surfaces a
   different expert subset).

5. **RESCUE DOSSIER** (`788f836`) — `docs/REVIEWER_FINDER_RESCUE_DOSSIER.md`. A self-contained,
   honest brief written **for a fresh Claude model**: the objective + what "good" means, the
   as-built architecture (with code refs), and **every strategy tried and how each fell short**. It
   explicitly asks the new model to *challenge our framing first, code second* — including whether
   the retrieval-first redesign is even the right path (Codex flagged that as asserted, not proven).

### Commits (all on `main`, pushed)
- `10ef27f` Track-B <3 warning + doc consolidation · `25110c8` off-topic surfacing + graded COI ·
  `3c79bac` post-impl fixes · `8e818cc` doc: mark shipped · `4da142b`/`a106e32` recall-over-precision
  memory (+ router gate fix) · `6d7837d`/`0d49d07` smoke harness + lane/overlap · `c7af6ea` §8f
  finding + scoped fix · `788f836` rescue dossier

## Potential Next Steps

### 1. THE RESCUE (primary intent) — hand the dossier to the new model
Point the freshly-released Claude model at `docs/REVIEWER_FINDER_RESCUE_DOSSIER.md` (it links to
everything else). Goal: a fresh take on the *approach* before more code. **Do not assume
retrieval-first is the answer** — the dossier asks the model to pressure-test that. Bring its
verdict back before committing to a build direction.

### 2. §8f Part 1 fix — activity-from-resolved-corpus (if proceeding incrementally)
After identity resolution, for confirmed/probable Track-B candidates: widen `backfillOpenAlexPublications`
(today only runs on empty `publications`, only sets count when `!Number.isFinite`) to **overwrite**
`publicationCount5yr` from the resolved author's real recent works; re-evaluate `lowPublicationCount`;
stop gating confirmed identities on the search-hit count. **Settle first:** the cap-25 selection — the
pre-resolution ranking that picks which 25 to resolve uses the same broken signal, so heavyweights can
be deferred and never resolved (Part 1 never reaches them). Validate with the smoke + overlap harness.

### 3. Coauthor-COI namesake fix (separate defect, §8c/§5.1)
The "Jian Wu / 10 papers with Wen Li" FALSE COI — initial-only `Wu J AND Li W` PubMed search conflates
namesakes (the example paper was biomedical, on a physics proposal). Proposed: field-gate the PubMed
coauthor check (don't run it for non-biomedical) + forename-gate where it does run.

### 4. The retrieval redesign itself (Part 2 / origination ceiling)
All-authors extraction (not single-position), field-routed sources, cited-reference lane, decomposed
(non-overloaded) query generation. The dossier's whole point: this is the unsolved core, but the
new model may reframe it.

### 5. Carryover (still open, untouched)
Manual-add dedup **write path** never live-smoked (PR #21); applicant-exclusion breadth policy;
combined Phase I+II PA doc-assembly; Smirnova sparse-affiliation collision (S236).

## Loose ends / gotchas
- `main` auto-deploys to prod on push. No backticks in `git commit -m` (use a message file for
  multi-line). Codex runs in an isolated worktree off HEAD → commit (or embed inline) before delegating.
- **Smoke result files are gitignored** (`smoke-results-*.txt`) — reproducible via the harness; the
  two from S238 (requests 1002794 / 1002794-lanes) are on the local Mac for review only.
- The overlap numbers in the smokes are **run-specific** (fuzzy name matching, no identity anchor) —
  trust the *direction* (low, variable overlap), not exact counts.
- Be wary of conclusion-drift: this session's reviewer-recall read shifted twice before Codex pinned
  it. Verify against source/live runs before asserting.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_FINDER_RESCUE_DOSSIER.md` | **START HERE for the rescue** — problem + failed-strategy history for the fresh model |
| `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` | Canonical design (Part A plan · B primer · C S238 discussion; **§8f** = the recall flaw + scoped fix) |
| `scripts/smoke-discover-dispositions.mjs` | Read-only live smoke: lane attribution + disposition flags + `--compare-file` overlap |
| `lib/services/discovery-service.js` | Track-A/B discovery; `searchPubMed`, `partitionByPublicationBar`, `resolveTrackBIdentities`, `backfillOpenAlexPublications`, `gradeCoauthorCOI` |
| `shared/config/prompts/reviewer-finder.js` | The one overloaded analyze prompt (PART 3 = the keyword query generation) |
| `pages/api/reviewer-finder/discover.js` | Stage-2 route orchestration (disposition fixes live here + in the service) |

## Testing
```bash
npx jest reviewer discovery suggestion disposition save-candidates search-logic   # reviewer battery
# Live read-only smoke (real LLM + scholarly APIs, NO writes); --compare-file for overlap:
node --import ./scripts/lib/use-extensionless.mjs scripts/smoke-discover-dispositions.mjs --request 1002794 --compare-file scripts/compare-1002794-production.txt
npm run build && npm run lint                          # green before pushing (Codex can't run these)
# full startup gate set: see .claude/skills/start
```
