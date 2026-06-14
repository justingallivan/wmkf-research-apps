# Session 254 Prompt: reviewer doc-debt reconciled + dead Stage-1 searchQueries trimmed (repo + prod)

> **GIT.** All S253 work is on `main` and **pushed** (HEAD `8f87ae1`). Working tree clean. 11 commits.

## Session 253 — what happened

Two threads, both finished and verified: (1) the **reviewer wiki doc-debt** from S252's next-steps, and
(2) trimming the analyze prompt's **dead Stage-1 `searchQueries`** (an older carryover) — including the
live prod Dataverse prompt row. Two Codex review passes were run and folded back.

### What was completed

1. **Maintained enforcement-contracts reference (`3f48487`).** Created
   `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` — the single maintained home for the **8 live
   fail-closed contracts** (Slice-E asymmetry, PI-named/cited/**referred** force-null exemption,
   Slice-G invite-confidence allowlist, structured-PI fail-open, S240 institution-COI hard drop,
   OpenAlex bibliometrics, faculty-page zero-SSRF, work-grounding rescue). Each traced to `file:line`
   and `[VERIFIED 2026-06-13]`. The `rejectedInstitutionCOI` gate had **no documentary home outside
   the wiki** before this (verified). Reconciled the post-S251 "Google Scholar profile links" drift in
   `REVIEWER_FINDER.md`, `guides/REVIEWER_FINDER.md`, and a prod-test.

2. **Thinned `reviewer-identity.md` to hub+pointer (`f271583`).** Its 8 contract bullets now route to
   the reference (added to `canonical_docs`). Kept the wiki-specific ground rules, hazards, namesake
   worked-example, durable-memory, probe.

3. **Reconciled 9 stale/imprecise design-doc status banners** (`7fbe16a`, `6f5add7`, `e093567`,
   `8f87ae1`) — each **verified against live source first** (a classifier agent over-claimed; caught a
   hallucination + a false positive). Examples: RESOLUTION_PLAN "no code yet"→shipped; COI_CHUNK2 split
   to 2a-shipped/2b-not-built; ORCID_BACKPROPAGATION→shipped (`backprop-reviewer-orcid.js` +
   `backfill-contact-orcid.js`); **MANUAL_ADD_DEDUP→shipped** (Codex caught my too-narrow probe — it
   lives in `pages/api/workbench/`, not `reviewer-finder/`).

4. **`searchQueries` trim (`437af3f` + Codex fixes `63c700e`).** Removed analyze PART 3 (PubMed/arXiv/
   bioRxiv/chemRxiv query generation) from **both** the code template (`createAnalysisPrompt`) and the
   Dynamics/stored template (`ANALYZE_USER_PROMPT_TEMPLATE`), byte-parity preserved. Removed the dead
   parser, `allSearchQueries`, the `missing_queries`/`truncated_or_missing_queries` validations, the
   PART 3 required-labels in `prompt-validators`, and (Codex catch) the **repair-prompt prose** that
   still asked for a query section. `parseAnalysisResponse` keeps a stable empty `searchQueries` shape
   so guarded consumers (discovery-service, logging) are untouched. Reconciled current-state docs
   (`AI_PROMPTS_DETAILED`, `REVIEWER_PROVENANCE_MODEL`, `RETRIEVAL_REDESIGN_PLAN` note, reviewer-origination
   wiki) + 2 design/diagnosis docs. Full suite **2415 green**, lint + build + A7 gate clean.

5. **Prod prompt row republished.** The live Dataverse `reviewer-finder.analyze` row (v1) still had
   PART 3; **Justin ran `node --env-file=.env.local scripts/seed-reviewer-finder-prompts.js --execute
   --only=analyze`**. Re-audited read-only: now `hasPart3Header:false`, two-part, 4637 B (was 5785).

6. **New feedback memory (`6afd69b`).** `feedback-truncation-is-breakage-not-completion.md` — a
   truncated/short tool result is a BREAKAGE signal (re-run/narrow/paginate), and a "not built / no
   home" claim needs a COMPLETE search of every plausible dir. Born from the dedup miss (probe scoped to
   one dir). Routed under Working Norms → completion posture.

### Commits (11)
`3f48487` enforcement-contracts ref + Scholar drift · `f271583` thin reviewer-identity · `7fbe16a` +
`6f5add7` banner reconciliations · `5cbc8fb` guide tier-list fix · `9be7c60` Codex doc fixes · `6afd69b`
truncation memory · `e093567` FINDER_REVIEW_REQUEST historical · `437af3f` searchQueries trim · `63c700e`
Codex trim fixes · `8f87ae1` PART-3 notes in 2 design docs.

## ⚠ Continuity guardrails — READ before reviewer/wiki/prompt work

- **`docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` is now the maintained owner** of the 8 live gates.
  Update it (and bump Last verified) in the same commit when you change any enforcement point.
- **`reviewer-identity.md` is thinned (hub+pointer).** The OTHER 3 rich wiki pages (`reviewer-origination`,
  `integrity-screener`, `external-reviewer-portal`) are **deliberately NOT thinned** — their facts have
  non-wiki homes and their residual content is hazard-routing, not orphaned spec. Do NOT thin them
  without first giving their unique synthesis a maintained owner. (PubPeer sanctioned-access detail is
  fullest in the integrity-screener wiki; promote to `SERPAPI_MIGRATION_PLAN` before any future thinning.)
- **`searchQueries` empty-shape is intentional.** `parseAnalysisResponse` returns
  `{pubmed:[],arxiv:[],biorxiv:[],chemrxiv:[]}` by design. Re-enabling Track B (`TRACK_B_ENABLED`) now
  ALSO needs PART 3 query generation restored (prompt + parser + `prompt-validators` labels) — flipping
  the flag alone runs against empty queries. See reviewer-origination wiki "To re-enable".
- Memory router stays **hub-link form** — do NOT re-expand to flat per-domain leaf lists (S252).
- `grep`/`rg` may corrupt identifiers+digits (`project-rtk-grep-output-corruption`) — use Read for exact
  content; and a truncated/empty grep is breakage, not "clean" (`feedback-truncation-is-breakage`).

## Potential Next Steps

### 1. COI **Chunk 2b** — retire the AI `POTENTIAL_CONCERNS` advisory — ✅ SHIPPED S254 (`da6fb70`)
Done this session after the verify-callers pre-flight + a Codex adversarial review (no blocking defect).
Removed the PD-unverifiable amber advisory from prompt (both byte-parity files), parser, validator,
repair prompt, both card renders, and the roster-prune persist. Full suite 2384 green, lint/build/A7 clean.
Design owner `docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md` is now historical.
**ONE STEP LEFT (Justin):** reseed the prod Dataverse `analyze` row —
`node --env-file=.env.local scripts/seed-reviewer-finder-prompts.js --execute --only=analyze`. Until
then the live prompt still emits the field, which the parser safely parse-and-discards (no UI breakage).

### 2. Older carryover (externally blocked — verify before acting)
- Recall padding-ceiling live check before raising count >15 (needs API key + a real proposal).
- SerpAPI **Hobby-tier downgrade** eval (Justin, out-of-repo billing dashboard).
- PubPeer migration — **parked, externally gated; do NOT proactively resurface.**

### 3. Tiny follow-up
- `score-candidates` prod prompt row was **not** reseeded this session (unchanged — fine). If you ever
  edit `SCORE_CANDIDATES_USER_PROMPT_TEMPLATE`, reseed it too (`--only=score-candidates`).

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` | NEW — maintained owner of the 8 live fail-closed gates |
| `docs/agent-wiki/topics/reviewer-identity.md` | Thinned hub+pointer → the reference above |
| `shared/config/prompts/reviewer-finder{,-dynamics}.js` | analyze prompt — PART 3 removed S253 (byte-parity pair) |
| `lib/utils/prompt-validators.js` | parse-contract required labels (PART 3 labels removed) |
| `lib/services/claude-reviewer-service.js` | repair prompt (query-section prose removed); resolves via composer |
| `scripts/seed-reviewer-finder-prompts.js` | republishes the prod analyze/score rows (`--execute` = prod write) |
| `.claude-memory/feedback-truncation-is-breakage-not-completion.md` | NEW feedback memory |

## Testing
```bash
npx jest --testPathPatterns "reviewer|discovery|prompt"   # 655 green
npm test && npm run lint && npm run build                 # full suite 2415 green
# read-only audit of the live analyze prompt row (needs prod approval):
#   node --env-file=.env.local -e "..."  (fetchCurrentPrompt('reviewer-finder.analyze'))
```
