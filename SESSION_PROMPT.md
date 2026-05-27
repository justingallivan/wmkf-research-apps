# Session 195 Prompt: Reviewer Workbench redesign — continue scoping

## ⏰ Time-sensitive carryovers

### Operator-side action items (still pending)
1. **Send DFT courtesy email** — draft written in S193 (in transcript). Still unsent.
2. **Intake portal virus-scan e2e** — DEFERRED to pre-pilot. Must run EICAR through `/apply` flow before mid-June 2026 Phase II Research pilot. Recipe in [`project-intake-portal-virus-scan-e2e-deferred`](.claude-memory/project-intake-portal-virus-scan-e2e-deferred.md).

### BILL reviewer-honorarium build status (unchanged from S193)
- **Chunks SHIPPED:** 2-3, 6, 7a.
- **Chunks PENDING:** 4 (extend respond.js — blocked on Connor), 5 (Stage 2a UI address inputs — held), 8 (E2E sandbox test — blocked on Steph).
- **Connor still owes:** `wmkf_HonorariumRequest` lookup on `wmkf_potentialreviewer`.
- **Target ready:** 2026-06-10. First reviewer invitations ≥ 2026-06-17.
- **Note:** chunk 5 (Stage 2a UI) is the most likely candidate to *pivot into Reviewer Workbench scope* if the redesign starts soon. Discuss before building it standalone.

## Session 194 Summary

Two threads: a demo-failure bug hunt that turned into two real fixes, and a redesign-direction conversation that reframes the next major project.

### What was completed

1. **Reviewer Finder model-resolver 404 hotfix** (`6ccb221`, `34bfe8a`)
   - Justin demoed Reviewer Finder to colleagues; it failed with `Claude API error 404: model: sonnet`.
   - Root cause: `shared/config/baseConfig.js` stores per-app values as tier keys (`'sonnet'`, `'opus'`, `'haiku'`). The tier→concrete-id resolver is injected as a side-effect of importing `lib/services/model-override-loader.js`. None of the three reviewer-finder Claude routes (`analyze.js`, `discover.js`, `generate-emails.js`) imported the loader, so `_resolveModel` stayed as identity and the literal string `'sonnet'` reached Anthropic.
   - Fix: added the import + `await loadModelOverrides()` to all three routes (mirrors `evaluate-multi-perspective.js` pattern). Plus a defense-in-depth warn-log in `baseConfig.js` that fires once per `(appKey, type)` when `getModelForApp()` is about to return an unresolved tier key — kept inline tier-key set so client bundles don't pull `model-resolver`.
   - Codex pre-impl review: no findings.
   - Justin's earlier admin-panel changes (setting tier keys per app) were correct values, but weren't being consulted at all because the loader wasn't running. Now they resolve correctly.
   - test:ci then failed on the `cross-user-isolation` integration test (its `baseConfig` mock was missing `_setModelResolver` / `_setOverridesCache` / `_shouldReloadOverrides` / `clearModelOverridesCache` — internals that `model-override-loader.js` destructures at top-level). Patched the mock; 1350/1350 passing.

2. **Reviewer Finder parser format drift** (`4531ba4`)
   - First test after the resolver fix: `Found 0 suggestions, 11 queries`. Claude call succeeded, parser ate the queries but no reviewers.
   - Diagnosis: sonnet-4-6 emits reviewer block headers as `**REVIEWER:**` / `**REVIEWER 1:**` / `### REVIEWER 1` with markdown decoration. The strict `/REVIEWER:/i` split didn't match. Metadata parser had already been made tolerant for the same kinds of decorations; the reviewer block parser hadn't been.
   - Fix:
     - `shared/config/prompts/reviewer-finder.js`: header regex now matches optional bullet (`-`, `*`, `1.`), heading hashes, bold markers, and trailing number. Tail tightly constrained to `(?:\s+\d+)?\s*:?` so a REASONING line starting with "Reviewer is especially qualified..." cannot accidentally split the block (Codex pre-impl catch).
     - Per-field regexes (`NAME`, `INSTITUTION`, etc.) accept the same `[-*]?\s*\*{0,2}FIELD\*{0,2}` decoration shape as metadata.
     - `lib/services/claude-reviewer-service.js`: when 0 suggestions parse, log `responseLength` + `containsReviewerToken` + `firstReviewerOffset` unconditionally; raw response window only if `DEBUG_REVIEWER_FINDER=true` (REASONING text can echo proposal content, so the bytes are treated as proposal-derived for logging).
   - Codex pre-impl review caught 2 issues + suggested test cases (header tail too permissive; 1200-char prod snippet likely contains proposal text). Both folded into the final commit. 9 unit tests cover plain, `**REVIEWER:**`, `**REVIEWER 1:**`, `### REVIEWER 1`, `- REVIEWER:`, `1. REVIEWER:`, REASONING prose containing "REVIEWER", trailing-whitespace headers, and queries-coexistence.
   - **Verified in prod:** Justin reran upload after the deploy → reviewers parsed successfully.

3. **Sidebar diagnostic on `Proposal text bounded at 17,048 characters`**
   - Confirmed: `REVIEWER_FINDER_PROPOSAL_MAX_CHARS = 100_000` (`lib/utils/ai-payload-boundary.js:36`). "Bounded" wording means *not* truncated; 17,048 chars was the full proposal. Documented in the conversation but no code change.

4. **Reviewer apps redesign conversation** — captured in [`project-reviewer-apps-redesign-direction`](.claude-memory/project-reviewer-apps-redesign-direction.md) memory entry. Headline: Reviewer Finder + Reviewer Manager are archaeological (built across different constraint regimes — pre-Dataverse, single-user, ad-hoc cycle tracking, .eml downloads) and need to be replaced, not cleaned up. New shape:
   - **Reviewer Workbench** (request-scoped, URL `/reviewer-workbench/[requestId]/...`) replaces Finder + Manager as a unified per-request lifecycle view.
   - **Reviewer Pool** (request-agnostic) — standalone surface, browse roster with richer Dataverse context than the W6-retired Database tab.
   - `akoya_request` is the spine; every sub-view operates in request context.
   - PD landing dashboard: cycle dropdown (defaults to current open), scope dropdown (My-lead / My-lead-or-backup / All — defaults to My-lead), `isActionableForPD(request)` policy function for status filter (rules deferred), strict cycle filter.
   - Honorarium kickoff fits naturally as a Workbench tab.
   - **Build deferred.** Justin closing out at end-of-day; will think more at home; S195 likely continues the design conversation. No code yet — goal is a scoping doc shareable with Connor / Sarah first.

### Commits this session (3, all pushed)
```
4531ba4 Tolerate markdown-decorated reviewer blocks in analysis parser
34bfe8a Add missing baseConfig internals to cross-user-isolation mock
6ccb221 Wire model-override-loader into reviewer-finder Claude routes
```

## Potential next steps for S195

### Path A — Continue Reviewer Workbench design [PRIMARY, USER-DRIVEN]
Justin closing S194 to think more at home. Likely returning with refined direction. Next conversational beats from where we paused:
- **Row content** on the dashboard (bare title/PI/institution vs. richer at-a-glance lifecycle state).
- **Workbench tab layout** (how Find / Invite / Track / Honorarium fit together as sub-views).
- **Reviewer Pool surface** (which Dataverse fields, what filters/sorts, what actions from there).
- **Status policy function rules** (`isActionableForPD` — internal-recommendation state vs. official board-signoff state).

Once enough decisions are locked, produce a scoping doc (`docs/REVIEWER_WORKBENCH_SCOPING.md` or similar) shareable with Connor / Sarah BEFORE any code.

### Path B — Continue BILL chunk 5 standalone
Stage 2a UI with address inputs. If the redesign is going to absorb this surface, holding chunk 5 is the right move. If S195 confirms redesign-from-scratch isn't starting for weeks, chunk 5 can ship as a standalone increment.

### Path C — Operator items
- Send the DFT courtesy email drafted in S193.

## Key files reference

| File | Purpose |
|------|---------|
| `pages/api/reviewer-finder/{analyze,discover,generate-emails}.js` | MODIFIED S194 — added `loadModelOverrides()` call so tier keys resolve |
| `shared/config/baseConfig.js` | MODIFIED S194 — drift warn-log when `getModelForApp` is about to return an unresolved tier key |
| `tests/integration/cross-user-isolation.test.js` | MODIFIED S194 — baseConfig mock now exposes the four internals model-override-loader destructures |
| `shared/config/prompts/reviewer-finder.js` | MODIFIED S194 — markdown-tolerant reviewer block + field parser |
| `lib/services/claude-reviewer-service.js` | MODIFIED S194 — forensic logging on 0-parse, DEBUG-gated raw window |
| `tests/unit/reviewer-finder-parse-analysis.test.js` | NEW S194 — 9 cases locking in parser tolerance shape |
| `.claude-memory/project-reviewer-apps-redesign-direction.md` | NEW S194 — captures the redesign direction conversation, decisions locked, what's still open |

## Testing (sanity gates)

```bash
npm run check:atlas                            # 31 PG / 32 DV ✓
npm run check:api-routes                       # 95 ✓
npx jest tests/unit/reviewer-finder-parse-analysis  # 9/9 ✓
npm run test:ci                                # 1359/1359 ✓
```

## Codex cadence notes

S194 used the Codex pre-impl review loop twice on the two hotfix patches. First round: no findings (resolver wiring). Second round: 2 real issues caught (header regex tail too permissive; 1200-char prod snippet likely contains proposal text) + 4 test-coverage suggestions. Both rounds reviewed quickly because the patches were small and well-scoped. Continue this cadence for the reviewer-workbench build when it starts — design-then-pre-impl-then-impl-then-post-impl per [`project-codex-design-pre-impl-iteration`](.claude-memory/project-codex-design-pre-impl-iteration.md).
