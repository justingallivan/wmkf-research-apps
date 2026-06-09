# Session 238 Prompt: Reviewer manual-add dedup shipped + relevancescore incident fixed; reviewer-finder prompt redesign on the table

## Session 237 Summary

A long, multi-arc session, all on `main` (auto-deploys to prod). Three arcs, all run through the
Codex loop.

### What Was Completed

1. **S236 manual-add / ORCID post-impl fixes** (`971ec97`) — Codex post-impl review of the S236
   manual-add + ORCID work found 6 real issues, all fixed: exclusion-gate-before-identity-writes,
   fill-only `emailSource`, option-scoped ORCID `strictAmbiguity`, stale-name lookup guard,
   `emailMatches` gating, and a client invalidation when an identity field changes.

2. **Manual-add cross-store dedup — PR #21, MERGED** (`d611130`, `bac7818`, merge `9178fce`) — the
   big feature arc. Manual reviewer-add now checks BOTH stores (`wmkf_potentialreviewer` + CRM
   `contact`) before minting a person, including the **former-PI case** (contact-only → create
   reviewer + link). New read-only `/api/workbench/reviewer-lookup` (tiered ORCID→email→name,
   ambiguity-aware `top:2`, cross-store conflict + reverse-link detection); `manual-reviewer` gained
   a `resolution` contract + create-and-link (link-last + hardened `setContactLink`); orchestration
   extracted to `lib/services/reviewer-identity-lookup.js`. Design: rev3 after 2 Codex pre-impl
   passes; Codex implemented, I reviewed/fixed + post-impl-reviewed; **18/18 live read-only smoke**
   (`scripts/smoke-reviewer-lookup-dedup.mjs`). ⚠️ The **write path (create-and-link) was NOT
   live-smoked** (would leave an un-deletable contact in prod) — wants a manual UI click-through.

3. **PRODUCTION INCIDENT — reviewer saves silently failing** (`dad3a26`, `9f4e378`) — PD reported a
   searched reviewer (Tanja Mittag, request 1002852) wouldn't save, no error. Root cause (live
   Dataverse 400, Codex-confirmed): `wmkf_appreviewersuggestion.wmkf_relevancescore` is a Double
   bounded **[0,1]**, but `save-candidates` writes a **0–100** score → any candidate scoring >1 hit a
   400 the per-row try/catch swallowed (orphan person, no candidate, no error). **Silently dropping
   the best-ranked candidates since the S223 scale change.** Fix: widened the field `[0,1]→[0,100]`
   in prod (PUT-full-definition + `PublishXml` via `scripts/widen-relevancescore-max.mjs` — **`PATCH`
   returns 405**; ran + verified live), `[0,100]` clamp guard in the adapter, and made the failure
   LOUD (`save-candidates` 500+errors when nothing saves; both Find clients show the failed name +
   error). `scripts/find-orphan-reviewers.mjs` (read-only) found 3 orphans (Mittag, Lavrik,
   Madabhushi) — heal on re-save, no cleanup needed.

4. **Reviewer-finder diagnosis (why 1002852 surfaced ~6 of 12, all "database")** — investigated;
   NOT a bug, a signal-starvation story: (a) the Workbench folds PubMed-verified Claude suggestions
   into "Literature-retrieved" (no Claude label, unlike the standalone); (b) **`load-proposal`
   reuses grant-reporting's `classifyFile`, which demotes Phase-I docs** (correct for a Phase II
   goals-assessment, wrong here) → only the 136KB `ProjectDescription.pdf` loads, not the full app;
   (c) **Phase I collects no bibliography + this narrative had no inline refs**; (d) **the PI
   excluded the field's 3 leading peers** (Ahel/Pascal/Luger, "overlapping research programs") — the
   same names the narrative cited — and the exclude filter clobbered them. Logged 2 memories.

5. **Reviewer-finder prompt redesign — design discussion + draft** (`docs/REVIEWER_FINDER_PROMPT_DECOMPOSITION_DESIGN.md`,
   draft, **NOT committed/built**) — the current analyze prompt is overloaded (extract + generate +
   query-craft in one call) and stale. Drafted a **field-primer + decomposition** sketch (primer =
   async pre-computed at submission → out of the latency budget; standalone PD deliverable). 2 Codex
   passes reshaped it to *extend* the existing `REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` (which
   already specifies the decomposition) and added the machine-readable primer→candidate boundary.

### Commits (all on `main`, pushed)
- `971ec97` S237 post-impl fixes · `d453c9b` dedup design rev3 · `d611130` Codex dedup impl ·
  `91e06c5` test-mock fixes · `bac7818` lib extraction + e2e smoke · `9178fce` **merge PR #21**
- `d9f4803` canonical-counts reconcile (Justin) · `dad3a26` relevancescore widen + loud failures ·
  `9f4e378` widen-script PUT+publish fix · `0a15594` schema-deploy memory gotcha #5
- `7f0ab8a` proposal-doc-context memory · `bd3bd4f` exclusion-policy memory

## Potential Next Steps

### 1. Reviewer-finder prompt redesign — first concrete step
The design is drafted + Codex-reviewed (extends `REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md`). The
recommended de-risk first step: a **shadow, non-candidate-producing prototype** — structured
extraction + **people-agnostic** field primer + query/`sourcePlan` generation → feed only the
queries into existing retrieval → compare yield/latency/false-positives. Do NOT prototype "primer
names people" first. Decide before building: web tooling, primer caching/scope, prompt-version
migration, eval metrics.

### 2. Manual-add dedup — verify the write path live
PR #21 merged but the create-and-link write path wasn't live-smoked. Manual UI click-through in
the Workbench Find tab (add someone who exists as a contact-only / former PI) before relying on it.

### 3. Open POLICY decision — applicant-exclusion breadth (needs the foundation)
`[[project-applicant-exclusion-policy-pending]]` — a PI can exclude the whole peer set with one soft
"overlapping programs" line, clobbering Claude's signal. Sub-question for a quick UX win: surface
**excluded-but-suggested** peers (and Claude-origin) in the Workbench Find tab so the PD can judge.

### 4. Next-cycle input fix (combined Phase I+II)
`[[project-reviewer-finder-proposal-doc-context]]` — build the **Power Automate flow** that
assembles ONE clean reviewer-finding doc (narrative + bibliography; drop budget/board/biosketches).
Also: give the Reviewer Finder its own doc selector so `classifyFile` no longer demotes Phase I.

### 5. Carryover from S236 (still open)
Smirnova sparse-affiliation selection collision; the automated-resolver-emits-`confirmed` vs
sticky-sentinel discrepancy.

## Loose ends / gotchas
- **`docs/REVIEWER_ONBOARDING_FLOW_MOCKUP.md` is UNTRACKED and not from this session** (created
  14:51 by Justin/another agent — reviewer-portal onboarding flow + mockups). Left uncommitted on
  purpose; decide whether to keep/commit it.
- `main` auto-deploys to prod on push. Commit/push only when asked. No backticks in `git commit -m`.
- Delegating to Codex = isolated worktree off HEAD → commit first; embed uncommitted text inline.

## Key Files Reference

| File | Purpose |
|------|---------|
| `pages/api/workbench/reviewer-lookup.js` | Thin shell → `lib/services/reviewer-identity-lookup.js` (cross-store dedup orchestration) |
| `pages/api/workbench/manual-reviewer.js` | Manual add + `resolution` contract + create-and-link |
| `lib/dataverse/adapters/{potential-reviewer,contact}.js` | `findBy{Email,Orcid}Candidates`, `searchByName`, `findByContactId`, hardened `setContactLink` |
| `pages/api/reviewer-finder/save-candidates.js` | relevancescore clamp + loud failure (500 on all-fail) |
| `scripts/widen-relevancescore-max.mjs` | Dataverse attr-widen deploy script (PUT+publish; ran in prod) |
| `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` | The retrieval-first redesign (decomposition home) |
| `docs/REVIEWER_FINDER_PROMPT_DECOMPOSITION_DESIGN.md` | Field-primer draft (extends the plan; not built) |

## Testing
```bash
npx jest reviewer save-candidates suggestion          # reviewer/save/suggestion battery
node --import ./scripts/lib/use-extensionless.mjs scripts/smoke-reviewer-lookup-dedup.mjs  # live dedup read smoke
npm run build && npm run lint                          # green before pushing (Codex can't run these)
# full startup gate set: see .claude/skills/start
```
