# Session 253 Prompt: memory router restructured to hub-link form; reviewer wiki doc-debt named

> **GIT.** All S252 work is on `main` and **pushed** (HEAD `5374856`). Working tree clean.

## Session 252 — what happened

Restructured the durable-memory **router** (`.claude-memory/MEMORY.md`) from flat per-domain
leaf-file fanout into compact **hub links**, relieving the cap pressure that had been warning at
every startup. Codex drafted it in a tmp package; reviewed it across **three** critical passes
(orphans → preservation → canonical-doc ownership), each folded back before applying. 1 commit, pushed.

### What was completed

1. **`MEMORY.md` compaction (`5374856`).** 11,319 B / 84 lines → **4,171 B / 62 lines** (was 969 B
   from the 12,288 B hard cap; now ~8 KB headroom). Sections: Startup / Always-Read Guardrails /
   Working Norms / Task Routing / User Context / Archive. Task routes now point at wiki **topic hubs**
   instead of listing every leaf file. **All 141 currently-routed leaf memories remain reachable
   (zero orphans, verified by `comm` against the real post-apply corpus).**

2. **Agent wiki expanded.** `index.md` router table now covers all **12** topics. **6 new topic pages**
   added (dev-environment, finance-honoraria, prompt-executor, reviewer-workbench-lifecycle,
   security-auth, strategy-roadmap); `dataverse-dynamics` + `intake-portal` refreshed with
   `## Durable Memory` sections.

3. **4 rich pages preserved (append-only deltas, NOT rewrites).** `reviewer-identity`,
   `reviewer-origination`, `integrity-screener`, `external-reviewer-portal` got only a `## Durable Memory`
   section appended. **Their rich current-state synthesis was deliberately kept** — see the doc-debt
   item below for why.

### Commit (1)
`5374856` docs(memory): restructure router to hub-link form; offload leaf lists to wiki topics.

## ⚠ Continuity guardrails — READ before touching memory/wiki

- **The router is now hub-link form. Do NOT re-expand it** back to flat per-domain leaf-file lists.
  New durable memory goes into the relevant wiki topic's `## Durable Memory` section (+ its leaf file),
  **not** a new root router line. A new root line is only for a genuinely cross-cutting guardrail.
  The `memory-router-guard.js` hook will block a bloating root edit — work with it.
- The 4 rich wiki pages (`reviewer-identity` etc.) carry **load-bearing current-state synthesis**, not
  redundant restatement. Do **not** thin them until the doc-debt below is done.

## Potential Next Steps

### 1. Reviewer wiki doc-debt — promote enforcement contracts into a maintained reference (then thin the wiki)
**Why this exists:** the reviewer `docs/` set is ~51 files, almost all design-time `*_PLAN/_DESIGN/_SPEC`
snapshots, none reconciled to what shipped. `docs/REVIEWER_FINDER.md` is a feature overview and is
already drifted (still says "Google Scholar links" post-OpenAlex migration). So the
`reviewer-identity` wiki page became the **de-facto current-state reference**, and at least one
load-bearing fact — the `save-candidates.js` **`rejectedInstitutionCOI`** durable COI gate — has
**no other documentary home** (verified: appears in zero non-wiki docs). Thinning now = real loss.

**The work:** create/designate a maintained current-state reference that OWNS the live enforcement
contracts, then reduce the rich wiki pages to hub+pointer. At minimum the reference must own:
- Slice-E client/server identity-gate asymmetry (`provenanceGroupOf` / `save-candidates` 422)
- PI-named/cited unresolved exemption + contact force-nulling (`contactBlockedForUnresolvedExempt`)
- Slice-G invite-confidence recipient allowlist (`confirmedLowConfidenceIds` / `emailConfidence`)
- Structured-PI identity fail-open / augment-only (`resolveProposalPI` / `forenamesContradict`)
- S240 current-institution COI hard-drop + `rejectedInstitutionCOI` durable gate
- S251 OpenAlex bibliometrics / verified-domain migration (`_attachOpenAlexMetrics`)
- Faculty-page recovery SSRF boundary (`verifiedInstitutionDomain`)
- Namesake / work-grounding rescue safety contract (`rescueByWorkGrounding`)

Of the 8, only bibliometrics (→ `SERPAPI_MIGRATION_PLAN`) and faculty-recovery
(→ `FACULTY_PAGE_RECOVERY_DESIGN` §D) are already doc-owned. The rest are wiki-only or design-time-only.
Consider also marking the ~51 design docs `historical` once their live facts are promoted.

### 2. Deferred hook candidates (post-restructure; cherry-pick, do NOT bulk-adopt)
Best signal-to-noise: (a) extend `check:memory-router` to flag routes mixing a hub link + many leaves
(protects the new structure); (b) external-literal-in-code scanner (backstops
`feedback-no-fabricated-placeholder-values`). Skip "warn on durable-doc edit without a sweep note" —
it fires on every small edit. Full list in the tmp brief.

### 3. Older carryover (verify-before-acting — unchanged from S251/S250)
- SerpAPI Hobby-tier downgrade eval (Justin, out-of-repo billing dashboard).
- PubPeer (parked — externally gated; do NOT proactively resurface).
- Recall padding-ceiling live check before raising count >15 (needs API key + real proposal).
- Reviewer COI **Chunk 2b** (retire `POTENTIAL_CONCERNS`) — ⚠ destructive, deferred (`docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md`).
- Trim the analyze prompt's dead Stage-1 `searchQueries`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `.claude-memory/MEMORY.md` | Restructured router (hub-link form — do not re-expand) |
| `docs/agent-wiki/index.md` | Expanded 12-topic router table |
| `docs/agent-wiki/topics/reviewer-identity.md` | De-facto current-state reference for identity/COI/invite enforcement contracts (preserve until doc-debt #1) |
| `docs/agent-wiki/topics/{dev-environment,finance-honoraria,prompt-executor,reviewer-workbench-lifecycle,security-auth,strategy-roadmap}.md` | 6 new topic hubs |
| `/private/tmp/wmkf-memory-wiki-draft/` | Codex's draft package + `REVIEW_BRIEF.md` (tmp; full rationale, hook list, doc-debt list) |

## Gotchas
- `/private/tmp/wmkf-memory-wiki-draft/` is **tmp, not in the repo** — it disappears on reboot. The
  authoritative state is what was committed; the brief's doc-debt list is reproduced in Next Step #1 above.
- Relevant gates after memory/wiki edits: `check:agent-wiki`, `check:memory-router`,
  `check:agent-invariants` (each + self-test), sequentially.
- `grep`/`rg` may corrupt identifiers+digits (`project-rtk-grep-output-corruption`) — use Read for exact content.
