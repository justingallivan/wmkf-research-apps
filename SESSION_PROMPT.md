# Session 232 Prompt: Reviewer-finder retrieval-first redesign — next slices (provenance DTO, field-routed sources)

## Session 231 Summary

Started as "validate the S229 COI/ranking work on a real request," and that
validation surfaced a deeper problem that drove the whole session: the
reviewer-finder pipeline uses Claude as a candidate **generator**, which is
stale/senior-biased/hallucination-prone, and the verify path **launders**
fabrications. Outcome: a written retrieval-first redesign plan (Codex-reviewed
twice), an empirical evidence base, and **three safety/reliability fixes shipped
to prod**. All committed + pushed; build + gates green throughout.

### What Was Completed

1. **S229 validated on real proposals (read-only).** Built `scripts/validate-reviewer-analyze.mjs` (full proposal → ranked suggestions, no writes) + `scripts/lib/use-extensionless.mjs` (ESM loader so raw `node` runs app modules). Confirmed S229 on real requests (1002865 RNA/ML, 1002279 chem, etc.): COI/named-competitors → POTENTIAL_CONCERNS, recency-leaning seniority, REASONING fitness-only.

2. **Found + fixed the verify-path fail-dangerous bug (SHIPPED `a3e6cbb`, `4638db6`).** A fabricated wrong-forename ("Alfred Laederach") verified against the real same-initial person (Alain) with 100% confidence — `generateNameVariants` initial variant + first-initial `namesMatch` + `MIN_PUBLICATIONS` with no forename check. Fix: verification gates on a full-forename match (article-gathering keeps recall); institution/expertise mismatches demote→soft-flag-only (the forename gate is the sole demoter — caught over-demoting Silvi Rouskin in a live smoke). PubMed `year` now prefers real pub date over Medline maintenance dates.

3. **Analyze reliability contract (SHIPPED `de69833`, fixed `0af842c`).** Analyze no longer silently succeeds on empty/short/truncated responses (live smoke hit empty 1002899 + 1-suggestion 1003032). Added a mode-aware validator + 2-attempt budget-gated repair loop (maxTokens→8192 on truncation) + typed `analysis_invalid` surfaced as a retryable error in BOTH frontends (shared `readSseStream`) + a code-owned A7-safe repair block + `analysisPurpose:'proposal_info'` bypass for `enrich-recommended`. Validator **sanitizes** quality issues (placeholders/dups/excluded dropped; incomplete dropped from payload + off-floor) rather than hard-failing. `0af842c` fixed a regression I introduced (incomplete entries had leaked into the downstream payload — Codex re-review caught it).

4. **Evidence base + plan + spec (DESIGN, mostly not built).** Random 10-request cycle sample (analyze behavior across fields; ~20% analyze flakiness; ~1-in-4 non-research grants) + free multi-source coverage probe (`scripts/probe-source-coverage.mjs`). Findings: PubMed = biomedical depth only (astro/physics is sparse-real + namesake-conflated); **OpenAlex + ORCID** cover the PubMed-blind fields; NASA ADS/arXiv are the missing physics sources; Semantic Scholar ≈ OpenAlex recall but no inline ORCID. Wrote `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` + `docs/REVIEWER_ANALYZE_CONTRACT_SPEC.md` (both Codex-reviewed) + memory entries.

### Commits
- `443a2a7` retrieval-first redesign plan + S231 probes + memory (redesign direction + verify-fail-dangerous hazard)
- `58741bb` revise redesign plan per Codex review (contracts, sequencing, COI parity)
- `a3e6cbb` verify: gate on full-forename match (fail-dangerous fix)
- `4638db6` verify: forename gate is sole demoter; mismatches are soft flags
- `de69833` analyze: validation + retry/repair + typed analysis_invalid failure
- `0af842c` analyze: drop incomplete suggestions from payload + prefer-complete dedup
- (also pushed leftover `7b059bb` trial agent-wiki guardrails from S230 at session start)

## Potential Next Steps

### 1. Provenance-DTO migration (plan §4.2) — the next big slice
The cross-layer wire shape (`provenance.{kind,sources,seedRole,groundingWorkIds}`) across the FOUR consumers that today use binary source semantics: `/discover` result events, `reviewer-roster-store.js` (`claude_verified` vs `database`), `save-candidates.js` (source mapping), and `ReviewerSearchSection.js` (UI sections by `isClaudeSuggestion`). Must land together. Unblocks field-routed sources. Codex flagged this as the centerpiece blocker; scope a spec → Codex-review → build → smoke → merge, same loop as the analyze slice.

### 2. Field-routed sources (plan §4.1/§6) — needs the DTO first
OpenAlex + ORCID cross-field spine; NASA ADS/arXiv for physics/astro; DBLP for CS. **Prereq:** parse richer PubMed XML (`Initials`, ORCID `Identifier`, `MeshHeadingList`, `ArticleDate`/`PubDate`) — these are load-bearing for the identity anchors, not nice-to-have. **Sequencing:** add sources BEFORE demoting Claude generation, or PubMed-blind fields lose all candidates. Verify ADS/S2 production key constraints before relying.

### 3. Carryover (still unverified)
- **Eyeball the Find-tab UI changes in-browser** (`954fd91`+`e7fc59b`, S230) — never visually confirmed. `.env.local` has Azure auth; `npm run dev` + Microsoft sign-in. Also worth eyeballing the new `analysis_invalid` retryable error states (both frontends) shipped this session.
- **`reset-request-reviewers --include-slots`** still unexercised live (S229 carryover).

### 4. Deeper analyze fix (deferred)
The retry/typed-failure now *handles* the ~20% degraded-response rate, but the underlying cause is delimiter-format brittleness + Claude padding/truncation. The real fix is the JSON-schema Stage-0 rewrite — deferred to the retrieval-first phase (plan §4.4 end-state), since it couples to removing parametric generation (which needs sources first).

## Standing context / guardrails
- **`main` auto-deploys to prod on push. Commit/push only when asked.** Stage by explicit path (not `-A`). Pre-deploy: `npm run build` green before pushing.
- **`.env.local` points at prod Dataverse/Postgres.** Read-only probes are fine; anything mutating hits prod.
- **Codex review caught real defects again — including one I (Claude) introduced** (`0af842c`). Keep the loop: spec → Codex review → build → self-review + live smoke → merge. The Codex rescue runs in a sandbox that can't write `.git` — it leaves changes uncommitted; commit after review.
- Probe scripts use `node --import ./scripts/lib/use-extensionless.mjs <script>`; Dataverse access needs `enterDynamicsBypassForScript(label)`.
- Memory router: `project-reviewer-finder-retrieval-redesign` (direction) + `project-reviewer-verify-fail-dangerous` (hazard).

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` | The architecture: fan-out/fan-in, provenance model, coverage-by-field, sequencing. Read first. |
| `docs/REVIEWER_ANALYZE_CONTRACT_SPEC.md` | Per-slice spec for the (shipped) analyze reliability contract. |
| `lib/services/discovery-service.js` | `verifyClaudeSuggestions` — forename gate + identity status (shipped). |
| `shared/config/prompts/reviewer-finder.js` | `validateReviewerAnalysis` — mode-aware validator + sanitization (shipped). |
| `lib/services/claude-reviewer-service.js` | `analyzeProposal` retry/repair loop + typed failure (shipped). |
| `scripts/validate-reviewer-analyze.mjs` | Read-only single-request analyze probe (reusable). |
| `scripts/probe-source-coverage.mjs` | Read-only multi-source coverage probe (PubMed/OpenAlex/ORCID/DBLP/keyed-S2). |
| `scripts/lib/use-extensionless.mjs` | ESM loader for raw-`node` probe scripts. |

## Testing

```bash
npx jest reviewer discovery analyze pubmed verification   # all reviewer-finder unit tests
node --import ./scripts/lib/use-extensionless.mjs scripts/validate-reviewer-analyze.mjs --request <num>
node --import ./scripts/lib/use-extensionless.mjs scripts/probe-source-coverage.mjs --names "Anna Frebel, David Baker"
# full startup gate set: see .claude/skills/start
```
