# Session 265 Prompt: Reviewer-email discovery investigation (first task)

> **GIT.** All S264 work is on `main` and pushed. Working tree clean. Everything below is
> deployed to production EXCEPT it's all live as of session end (10 commits, all pushed).
> **FIRST TASK S265:** diagnose why good Claude-discovered reviewers (e.g. Prof. Artem Rudenko,
> request 1002794 / GUID `423eee92-1e35-f111-88b4-000d3a3065b8`) come back with no email.

## Session 264 — what happened

A big reviewer-finder polish session: shipped the applicant-promotion model + 4 follow-on
features, each Codex-reviewed and deployed. 10 commits, all live in prod.

### Shipped + deployed (commit order)

1. **`7aef1883`** — read-only probe `scripts/probe-applicant-selected-live-state.js` (pre-migration
   safety check for the demotion).
2. **`ad8e0299`** — **Applicant-suggested reviewers require explicit PD promotion.** Ingestion now
   lands `wmkf_selected=false`; new `POST /api/workbench/promote-applicant-reviewer` (GUID-guarded,
   ownership + disposition checks) flips it true. UI `applicant_suggested` section made selectable;
   `saveSelected` partitions on provenance KIND and routes applicant rows to the promote endpoint.
   New `findApplicantRecommendedByRequest`. Codex-reviewed (caught the `selected:true` return + the
   shared-paper count bug, both fixed).
3. **`99ca6e71`** — demotion migration script accepts explicit `--dry-run`.
   **Migration RAN in prod:** all 54 applicant-recommended rows demoted to `selected=false`
   (52 via `scripts/demote-applicant-suggested-reviewers.js --apply`; the 2 live-token rows on
   request 423eee92 — Andreas Becker, Ahn-Thu Le — demoted **+ token-revoked** via a targeted op
   after the user confirmed). Re-running the dry-run now shows 0 candidates (idempotent).
4. **`dd5a5301`** — removed the confusing "Reviewer diversity" (temperature) slider; search runs at
   the server default 0.3 (analyze.js + claude-reviewer-service both default to 0.3).
5. **`024d0ff3` / `469e0989` / `f5131e24`** — **Excel export** of selected candidates:
   `POST /api/workbench/export-candidates` → two-sheet `.xlsx` (Request Info + Candidates) via
   `lib/services/reviewer-candidate-export.js` (ExcelJS). Columns: Name, Affiliation, Email, Source,
   Why selected, Potential conflicts, ORCID iD, Google Scholar, h-index, 5-yr publications,
   Seniority. Codex review fixed the conflict count (sum `paperCount`, not author count) + stale
   exportError clear.
6. **`ffec9186`** — **backfill 5-yr publication count** for applicant rows from the OpenAlex author
   already resolved for h-index (`getWorksByAuthor`, same window as `DiscoveryService.YEARS_LOOKBACK`).
   Fixes the false "0 publications" next to a real h-index (Paul Corkum → 69). Gated on
   `blockScholar`. Codex-reviewed: clean GO.
7. **`7ea7339f`** — when there's NO resolved bibliometric profile (null count + no pubs), the card
   shows **"publication count unavailable"** instead of a misleading "0 publications". (A genuine
   resolved-zero still shows "0".)

### Also shipped (no separate item): applicant-enrichment caching — `e6dd4b2e`

**Applicant-suggested reviewers now persist + restore across reloads** instead of re-running the
SSE enrichment every time. `enrich-recommended` persists each enriched row to `reviewer_find_roster`
(via `recordSurfaced`) BEFORE emitting `complete`, stamped with `enrichedProposalKey`. On reload they
restore via `rosterActive`. **Cache key = `doc.data.picked` (`library::folder::name`), NOT `blobUrl`**
— `load-proposal` uploads with `addRandomSuffix:true`, so the blob URL changes every load. Same-file
reload restores; a genuine re-pick changes the key → auto-re-enrich. Codex implemented to a
Codex-reviewed plan; Claude reviewed the output (clean). `pruneCandidateForRoster` whitelist gained
`enrichedProposalKey` + `suggestionId`; promote/exclude cleanup touch the roster.

> **Note on first-load re-verify:** the user saw applicant rows re-verify on the first load after
> deploy — EXPECTED (cold cache; that first run populates it). A second same-proposal reload should
> restore instantly. If a plain same-proposal reload still re-verifies, that's a bug to investigate.

## Priority for S265

### 1. FIRST TASK — diagnose reviewer-email discovery misses
Good Claude-discovered reviewers come back with **no email** even when easy to find by hand.
Concrete case: **Prof. Artem Rudenko**, request **1002794** (GUID `423eee92-1e35-f111-88b4-000d3a3065b8`).
Roster blob: name `"Prof. Artem Rudenko"`, ORCID `0000-0002-9154-8463`, **email null**.

Investigation already done (don't repeat): the **honorific is NOT the cause** — `stripHonorifics`
is applied in `serp-contact-service` (Google/SerpAPI search), `orcid-service`, `openalex-service`,
and inside `isNameConsistentEmail` itself (contact-parser.js:152). So "Prof." doesn't poison the
search. The miss is the web-search email tiers not surfacing a usable address (ORCID doesn't expose
emails; the wrong-person guard `isNameConsistentEmail` drops uncertain addresses for a tool that
SENDS invitations).

**Recommended approach (option 1 from the user discussion):** run a targeted enrichment for
"Artem Rudenko / Kansas State" with tier-by-tier logging — did SerpAPI run / is it configured? did
Claude web search return an email and was it dropped by the guard? — to find whether there's a real,
fixable gap before changing enrichment logic. (Options 2/3 considered: strip honorifics at source =
cosmetic, won't recover the email; manual-reviewer add = reliable per-case fallback.)
Key files: `lib/services/contact-enrichment-service.js` (tier orchestration), `lib/services/serp-contact-service.js`,
`lib/utils/contact-parser.js` (`isNameConsistentEmail`, `stripHonorifics`).

### 2. Group B build — still blocked on Connor (unchanged)
Connor's four inputs still needed (field names, Graph write, PA flow, prompt rows). See S262.

## Continuity guardrails
- **Applicant promotion is LIVE** — applicant rows do NOT auto-enter the pool; PD promotion required.
  Migration already run (all 54 demoted). Don't re-run it.
- **`reviewer-finder` model namespace still live** — do NOT remove from `baseConfig.js`.
- **Orphaned Codex process:** a `codex app-server` was left pointing at the deleted worktree
  `.claude/worktrees/agent-a47a8626427139e8a` — harmless; quit/restart the Codex app to clear it.

## Key Files Reference

| File | Role |
|------|------|
| `shared/components/reviewers/ReviewerSearchSection.js` | Find tab: candidate list, enrich, promote, export, cache gate |
| `pages/api/workbench/enrich-recommended.js` | Applicant enrichment SSE + roster persist + 5-yr pub backfill |
| `pages/api/workbench/promote-applicant-reviewer.js` | Explicit applicant→pool promotion |
| `pages/api/workbench/export-candidates.js` + `lib/services/reviewer-candidate-export.js` | Excel export |
| `lib/services/reviewer-roster-store.js` + `shared/components/reviewers/reviewer-search-logic.js` | Roster persist + `pruneCandidateForRoster` |
| `lib/services/contact-enrichment-service.js` + `serp-contact-service.js` + `contact-parser.js` | **S265 first task — email discovery** |
| `scripts/demote-applicant-suggested-reviewers.js` | One-time migration (already run; idempotent) |

## Testing
```bash
npm run build && npm run lint
npm test                       # FULL suite (181 suites / 2539 tests as of S264)
npm run check:api-routes && npm run check:trust-boundary-guid && npm run check:atlas && npm run check:agent-wiki && npm run check:fact-consistency
```
