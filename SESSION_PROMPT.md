# Session 242 Prompt: Reviewer COI Chunk 2b (still queued) — after the S241 memory-router prevention work

> ✅ **GIT STATE.** `origin/main` = **`367e28d`**, local in sync, working tree clean.
> S241 pushed the 4 memory-router commits (`c7f01e3..e5176f4`) + the `91f3ea3` handoff,
> then follow-ons: `f07c13f` (another window — records `~/.claude` git-sync, see
> [[claude-config-git-sync]]); `5e5dc11` (belt-and-suspenders `/stop` fix — that other-window
> commit added a memory file with no `status:` key, red-gating `check:memory-router` on
> main); `7b2a1fd` (handoff pointer refresh); `367e28d` (hardened the gate's status check —
> see "What Was Completed" #5). All are docs + hooks + a CI gate — **no app-runtime paths
> touched**. Verified pre-push: all memory/wiki/doc gates + self-tests green.
>
> ⚠️ **NEW HOOK ACTIVE NEXT SESSION.** S241 added a PreToolUse write-time guard on
> `.claude-memory/MEMORY.md` (`.claude/hooks/memory-router-guard.js`). Hooks load at
> session start, so it activates for YOU now. It **blocks** an edit that pushes the
> router further over budget (>12KB / >150 lines / >200-char router-prose line) and
> tells you to route detail to `docs/agent-wiki/topics/` instead. Net-neutral/shrinking
> edits always pass. If it blocks you, that's working as designed — move the detail to a
> wiki topic. See [[project-memory-router-trap-prevention]].

## Session 241 Summary

S241 was prompted for reviewer-COI Chunk 2b but **pivoted** (Justin's call) to fixing
the memory-router "trap": `.claude-memory/MEMORY.md` had crept back over its 12KB budget
in under a week after the reorg. Implemented the Codex handoff brief
(`docs/MEMORY_ROUTER_WIKI_RECOMMENDATIONS_2026-06-11.md`) AND a structural prevention so
it doesn't recur. Full Codex loop (review → fold → re-review until SHIP) on every part.

### What Was Completed

1. **Agent wiki promoted from 1 → 5 topic pages** — `reviewer-origination`,
   `external-reviewer-portal`, `intake-portal`, `dataverse-dynamics` (+ existing
   `reviewer-identity`), all routed from `docs/agent-wiki/index.md`. Each carries
   `source_files`/`canonical_docs`/`watch_paths` that exist and link the Atlas.

2. **Router shrunk** 13,470 → ~10,539 bytes / 101 → 82 lines — clears the over-budget
   advisory with ~1.7KB headroom. **Every memory-file slug preserved** (zero routing
   lost; two design-DOC paths moved into wiki `canonical_docs`). Dense lines collapsed
   to terse triggers + inline `→ wiki:<topic>` pointers.

3. **`check:memory-router` hardened** — 12KB comfort target promoted warn→hard-fail; new
   200-char router-prose cap (`.md` file-ref lists exempt, so a line may route to many
   files); 11KB early-warning band. Self-test 6 → 10 cases.

4. **Write-time prevention (the actual fix for recurrence)** —
   `.claude/hooks/memory-router-guard.js` blocks a *worsening* MEMORY.md edit at write
   time (monotonic before/after metrics — never wedges a cleanup). SessionStart hook
   routes domain work to the wiki + surfaces router pressure; `agent-wiki-reminder.js`
   now nudges on `.claude-memory/*.md` writes. Three layers: enforcement + signal +
   discoverability. Rationale in [[project-memory-router-trap-prevention]].

5. **`check:memory-router` status check hardened** (`367e28d`) — the status check used an
   unscoped regex matching `status:` ANYWHERE in the file; scoped it to the leading
   frontmatter block (require frontmatter, require a `status:` within it, strip quotes,
   validate). Closes a false-negative where body prose mentioning "status:" satisfied the
   requirement. NB the auto-memory writer bypasses PreToolUse hooks, so this GATE — not a
   hook — is what catches its output (cf. `f07c13f`/`5e5dc11`). Self-test 10 → 14; 145 live
   files green.

### Codex review notes (folded)
- Review #1 (cleanup): under-populated `watch_paths` (3 topics), an overstated
  prod-accept hazard, a dropped "timeout/time-budget" trigger, a stale 18KB ref — all folded.
- Review #2 (prevention): a **HIGH fail-closed bug** — the guard compared violation
  *tokens*, so a partial cleanup of an over-budget file would have been BLOCKED. Rewrote
  to monotonic numeric comparison; verified with a 9-case dirty+clean battery. SHIP.

### Commits (chronological)
- `e1642bc` promote wiki + shrink router + harden gate
- `4b2d5a9` fold Codex review #1
- `22f741a` write-time guard + wiki discoverability
- `e5176f4` fix guard fail-closed bug (monotonic comparison)
- `5e5dc11` add missing status frontmatter (fix red gate from other-window commit)
- `7b2a1fd` refresh handoff git-state pointer
- `367e28d` harden memory-router status check (frontmatter-scoped)

### Operational note
- The shared Codex runtime **wedged** mid-review once (dead PID, vanished broker socket).
  Recovery: `codex-companion.mjs cancel <job>`, then `kill` the `app-server-broker.mjs`
  (+ its `codex app-server` children); the companion respawns a fresh broker on the next
  task. A fresh runtime then completed normally.

## Potential Next Steps

### 1. Build Chunk 2b — retire `POTENTIAL_CONCERNS` (THE ORIGINALLY-QUEUED PRIMARY BUILD; via the Codex loop)
Still not built. Retire the AI `POTENTIAL_CONCERNS` advisory. **Fully coupled** (Codex,
S240): required by the prompt validator (`prompt-validators.js`) + repair prompt
(`claude-reviewer-service.js`), so templates + validator + repair + render + persist +
~5 test files + the **prod Dataverse reseed** (`seed-reviewer-finder-prompts.js
--execute`, **Justin runs**) move together. Code retirement is decoupled from the reseed
(code ignores the field regardless). Watch: removing the field must NOT push COI back
into REASONING (keep "REASONING fitness-only, no COI anywhere"). Design:
`docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md` §6.

### 2. Smoke-check Chunk 2a in prod (still not done since S240)
Chunk 2a (institution COI hard-drop) is in prod but never verified live. Run a reviewer
search where the PI shares an institution with a likely candidate; confirm the
same-institution candidate is excluded (with PD excluded-summary), no "Former shared
institution" badges, and a post-enrichment same-institution row can't be saved.

### 3. Later multi-lane origination increments (NOT in 2a/2b)
PI-trail corpus lane (ORCID works list), peer-group parsing, topic→author facet
generation, the two net-new COI gates (advisor/advisee + all-time-collaborator),
recency-weighted ranking. Canonical: `docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md`
§12. See `docs/agent-wiki/topics/reviewer-origination.md`.

### 4. Carryover (still open from S238)
Manual-add dedup write path never live-smoked (PR #21); applicant-exclusion breadth
policy ([[project-applicant-exclusion-policy-pending]]); combined Phase I+II PA doc-assembly.

## Key Files Reference

| File | Purpose |
|------|---------|
| `.claude/hooks/memory-router-guard.js` | S241: write-time block on bloating MEMORY.md edits (monotonic) |
| `scripts/check-memory-router.js` | S241: hardened gate (12KB hard-fail, 200-char prose cap, 11KB warn) |
| `docs/agent-wiki/index.md` + `topics/*.md` | S241: 5-topic retrieval layer; read first for domain work |
| `docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md` | Chunk 2b design (the queued build) |
| `lib/services/proposal-pi-identity.js` | Chunk 1+2a: PI identity + institution union |
| `pages/api/reviewer-finder/discover.js` / `save-candidates.js` | Chunk 2a COI hard-drop + save-gate |

## Testing
```bash
# memory/wiki infra (S241):
npm run check:memory-router && npm run check:memory-router:self-test
npm run check:agent-wiki && npm run check:agent-wiki:self-test
node /tmp/guard-test.mjs   # (regenerate from S241 if gone) — guard dirty/clean battery
# reviewer-finder (Chunk 2b work):
npx jest reviewer discovery identity dedup coauthor evidence enrich institution save provenance
npm run build && npm run lint
# full startup gate set: see .claude/skills/start
```
