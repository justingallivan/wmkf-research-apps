# J27 Register Per-Site Reconciliation Plan (2026-09-08)

**Owner decision (2026-09-08):** keep the strict per-site rule in `scripts/check-j27-register.js`
and bring `docs/J27_TRANSITION_REGISTER.md` up to it with subagents, rather than weakening the
gate to warnings. "These things tend to drift and we don't need that now."

**State this plan starts from** `[VERIFIED via node scripts/check-j27-register.js on branch
claude/j27-gate-tighten at 49cf4d28]`: 17 ok · **43 stale** · 6 unverifiable · 10 closed;
0 id-less markers. The 43 stale rows are listed in §4. None of them went stale because a site
changed since 2026-09-07; they fail because the row cites several files and quotes a snippet
that exists in only one of them.

## 1. Goal and non-goals

**Goal.** Every open register row satisfies the strict rule: each file named in its `site`
cell contains at least one of the row's backticked `excerpt` fragments, verbatim. The gate
returns 0 stale and its self-test passes 32/32 (both "real repository baseline is green"
assertions included).

**Non-goals.** No cited source file, doc, memory, or wiki page is edited. No row is scheduled,
no evidence label is upgraded, no register id is reused, no new rows are added, and the gate
script is not changed again. This is register-content work only.

## 2. The per-row decision rule (agents apply this, nothing else)

For each stale row, for each cited file the gate names as lacking a fragment, read the file at
the cited line(s) and pick exactly one of:

| Case | What you see in the file | Action |
|---|---|---|
| **A. Real site, unquoted** | The file states the J27-sensitive fact the row is about (the code literal, comment, doc sentence, or memory line). | Add a verbatim backticked fragment from that file to the `excerpt` cell. Join fragments with ` · `. Keep each fragment ≥ 8 characters, short (one clause or one code token run), and copied exactly, including punctuation and case. Inner backticks and comment sigils are ignored by the matcher, so quote the text, not the `//` or the backticks. |
| **B. Context, not a site** | The file only pins, restates, tests, or cross-references the fact (a unit test asserting the value, an Atlas restatement, a memory that summarises the plan, a doc that mentions it in passing). | Move that citation out of the `site` cell into the `disposition / notes` cell, prefixed `context:` and keeping its original `file:line` form. The row's checked sites shrink to the files that actually carry the fact. |
| **C. Genuine drift** | The file no longer contains the fact at all, or says something different. | Do not invent a fragment. Update the `site` line cite to where the fact now lives if it moved within the file; otherwise treat the citation as case B **and** add a dated note `drift 2026-09-08: <what changed>`. If the row's claim itself no longer holds, set the evidence label to `AS` and say why; only the owner may move a row to `rejected`. |

Rules that apply to every edit:

- Excerpt fragments are **verbatim**. Copy from the file, never paraphrase, never "clean up" a
  quote. If the matcher fails after your edit, the quote is wrong, not the matcher.
- Keep the seven-column row shape (`id | site | excerpt | Dep | Ev | Q | disposition`). Never
  put a bare `|` inside a cell; the gate exits 2 on a malformed row and that blocks the batch.
- Do not remove a citation from a row. Case B *moves* it; the row must still be findable from
  the same places it was before.
- Do not touch rows outside your slice, the section headers, the legend, §6–§10, or any other
  file. If you believe a row is wrong in a way this rule does not cover, leave it and report it.
- Do not write `J27:` in prose; the gate treats comment-led `J27:` as a marker.
- Line cites (`file:47`) are decorations the matcher strips; correct them when you notice they
  are off, but a wrong line cite alone never makes a row stale.

## 3. Execution shape

Four Sonnet subagents run **in parallel, each in its own worktree** branched from
`claude/j27-gate-tighten`. Each owns a contiguous block of register lines so no two agents edit
adjacent rows. Each agent:

1. Verifies its base: clean tree, HEAD at `49cf4d28` or later on the branch; symlinks
   `node_modules` and `.agents/skills` from the main checkout.
2. Runs `node scripts/check-j27-register.js` and confirms its rows are the stale ones assigned.
3. Applies §2 row by row, reading every cited file at the cited lines before deciding.
4. Re-runs the gate after each row. Its rows must reach `ok`; the gate must never exit 2.
5. Commits once (register only), does not push, and reports per row: `id · case per file
   (A/B/C) · fragments added · citations moved · drift noted`, plus any row it could not resolve
   under §2 and why.

Time-box: 60 minutes per agent. An agent that cannot finish stops, commits what is done,
and reports the remainder; the orchestrator reassigns.

**Integration (orchestrator, Fable).** Because all four agents edit one file, the orchestrator
splices the four commits onto `claude/j27-gate-tighten` with zero-context patches so
near-adjacent hunks do not conflict:

```
git -C <agent worktree> diff -U0 49cf4d28..HEAD -- docs/J27_TRANSITION_REGISTER.md \
  | git -C <integration worktree> apply --unidiff-zero
```

applied in slice order A→D, then one integration commit. Fallback if a splice fails: apply the
slices sequentially by re-running that agent against the partially integrated register.

**Verification (orchestrator).** On the integrated branch, sequentially: `check:j27-register`
(0 stale, 0 id-less markers), `check:j27-register:self-test` (32/32), then the docs battery
used on the earlier register PRs (memory-router, fact-consistency, doc-currency,
doc-symbol-refs, build-claim-freshness, canonical-pointers, docs-catalog, harness-framing,
agent-wiki, each with self-test; agent-invariants:ci).

**Review chain.** Opus read-only review of the register diff: spot-check at least ten rows across
all four slices by opening the cited file and confirming each added fragment is verbatim and
each `context:` move is defensible; check no row lost a citation and no row outside the 43
changed. Then Codex adversarial review of the whole branch (`--model gpt-5.6-sol`, from the
integration worktree, `--base origin/main`). Findings route back to the responsible slice agent.
Then one PR to `main` (Tier 0, docs + gate script), owner merge decision.

**Record.** Register §9 loses its "multi-site rows only need one live match" bullet (already
rewritten on the branch) and §10 gains a dated line with the before/after counts. Plan §10 of
`docs/J27_SINGLE_PHASE_TRANSITION_INVENTORY_PLAN.md` gets the same line. `SESSION_PROMPT.md`
item 2 records the outcome.

## 4. Slices (43 rows; register line numbers as of `49cf4d28`, re-check before editing)

| Slice | Register lines | Rows | Count |
|---|---|---|---|
| **A** Retire + Persist | 44–72 | J27-007, 008, 010, 011, 022, 023, 024, 025, 026, 027, 028, 032, 033 | 13 |
| **B** Change (code-heavy) | 79–92 | J27-035, 036, 037, 038, 039, 040, 041, 042, 043, 044, 045, 047, 048 | 13 |
| **C** Change (docs/memory) | 94–103 | J27-050, 053, 055, 056, 057, 058, 059 | 7 |
| **D** Build + Scale | 109–133 | J27-060, 062, 063, 065, 066, 070, 072, 073, 074, 079 | 10 |

Known heavy rows, so the agent budgets for them: J27-011 (six intake test fixtures via glob:
expect case B for the tests, case A for the migration and smoke script), J27-032 (a glob over
`shared/components/reviewers/*`: expect case B for most components and a fragment from
`REVIEWER_ENGAGEMENT_SPEC.md`; if no component carries a "Phase 3" comment verbatim, narrow the
glob to the files that do), J27-040 and J27-041 (nine and seven Phase I/II sites: most are real
sites, each needs its own short fragment), J27-045 (five files sharing the `cycleCode` error
string: one fragment may satisfy several files; verify each), J27-047 (runbook, security matrix,
Atlas: expect case B for all three docs).

## 5. Exit criteria

- `node scripts/check-j27-register.js` on the integrated branch: 0 stale, 0 id-less markers;
  the ok count is 60 minus closed minus unverifiable (unverifiable rows are untouched by this
  plan).
- `scripts/check-j27-register-self-test.js`: 32/32.
- Every one of the 43 rows shows in the integrated diff; no other row changed; no file outside
  `docs/J27_TRANSITION_REGISTER.md` and the three record surfaces changed.
- Opus spot-check found no paraphrased fragment; Codex adversarial findings dispositioned.
- PR merged on owner decision; `/start` runs the gate green afterwards.

## 6. Risks the reviewer should challenge

- **Verbatim discipline.** The failure mode is an agent "quoting" a fragment from memory or
  tidying whitespace; the matcher collapses whitespace and strips backticks and comment sigils
  but nothing else. Mitigation: the gate is run after every row, and Opus opens the files.
- **Over-demotion.** Case B is the easy way out; an agent could demote every hard citation to
  `context:` and the row "passes" while checking nothing. Mitigation: the rule requires reading
  the file first, the report lists case per file, and Opus reviews the B/A ratio per slice; a
  slice that is almost all B is sent back.
- **Glob rows.** Globs expand to every match; a fragment must appear in each match. Narrowing a
  glob is allowed only when the excluded files do not carry the fact.
- **Adjacent-row splice conflicts.** Mitigated by contiguous blocks and zero-context apply;
  fallback is sequential re-run.
- **Semantic drift hidden as case A.** A file might still contain the quoted words while the
  surrounding meaning changed. Out of scope here; the register's evidence labels and the owner
  questions carry that, not the string check.
