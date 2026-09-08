# J27 Register Per-Site Reconciliation Plan (2026-09-08, rev 2 after Codex review)

**Status: executed 2026-09-08, rev 2.** Four parallel Sonnet slice agents reconciled every
stale row to the binding syntax; two exhaustive Opus matrix reviews returned CONDITIONS on
all four slices, applied in a follow-up commit (`docs/J27_REGISTER_RECONCILIATION_DECISIONS_2026-09-08.md`).
Gate reached 59 ok / 0 stale / 6 unverifiable / 11 closed, 0 unbound, 0 vocabulary
warnings, self-test 72/72; a subsequent Codex adversarial review (`65eb4bfe`) found a
row-detection parsing gap (fixed) and that J27-023 was bound to a fragment that is not
its fact (fixed by unbinding it; the owner then ruled 2026-09-08 to drop the citation, since
the file is not a J27 site). Final: 59 ok / 0 stale / 6 unverifiable / 11 closed, 0 unbound,
self-test 80/80. See
`docs/J27_TRANSITION_REGISTER.md` §10 for the full record.

[RECHECKED after scripts/check-j27-register.js change: §2 and §9 track the gate as of 440143d8 — binding syntax, strict unbound, sibling-fallback binding resolution, whitespace-tolerant row detection] **Owner decision (2026-09-08):** keep the strict per-site rule in `scripts/check-j27-register.js`
and bring `docs/J27_TRANSITION_REGISTER.md` up to it with subagents, rather than weakening the
gate to warnings. "These things tend to drift and we don't need that now."

**Codex adversarial review of rev 1 (2026-09-08, `gpt-5.6-sol`): needs-attention.** Two design
findings accepted and folded in below: (1) demoting tests, Atlas pages, and memories to
"context" would silently drop real J27 sites from checking; (2) the gate had no site-to-fragment
binding, so a reconciled register could pass on coincidental matches. Three record findings
also accepted: contradictory exit counts, an unrecognised `closed.` disposition on J27-072, and
the canonical work queue left stale. Rev 2 sequences a schema fix **before** the row work.

**State this plan starts from** `[VERIFIED via node scripts/check-j27-register.js on branch
claude/j27-gate-tighten at c96a6a27]`: 76 rows = 17 ok · **43 stale** · 6 unverifiable ·
10 closed; 0 id-less markers. Codex counted 130 cited files across the 43 rows that currently
match no fragment. None went stale because a site changed since 2026-09-07; they fail because
the row cites several files and quotes a snippet that exists in only one of them.

## 1. Goal and non-goals

**Goal.** Every open register row verifies each of its cited files against a fragment that
belongs to that file. The gate returns 0 stale, 0 id-less markers, and its self-test passes.

**Non-goals.** No cited source file, doc, memory, or wiki page is edited. No row is scheduled,
no evidence label is upgraded, no register id is reused. Rows may be **split** (one fact per
row, new ids) when a file carries a distinct J27 fact; rows are never merged or deleted.

## 2. Phase 0 — schema binding in the gate (before any row work)

**Change to the register `excerpt` cell (plan §3 amendment).** A fragment may be **bound** to a
cited path by prefixing it: `` `path/or/glob` → `fragment` ``. Unprefixed fragments remain a
shared bag. Joins stay ` · `. Example:

```
`lib/a.js` → `const PHASE_II_FOLDER = 'Phase II';` · `pages/x.js` → `'wmkf_phaseiistatus'` · `shared fallback`
```

**Gate rule (Phase 0 build, STRICT UNBOUND per owner decision "we don't need drift", added
same day as a follow-up fix).** For each resolved file (every glob match included):
- if one or more fragments are bound to a path that resolves to this file (exact rel path, or
  the glob that matched it, matched by FILE MEMBERSHIP in the row's own resolved `site` set —
  not by string-equality on the raw token spelling, fixed in a same-day re-review), the file
  must contain at least one of **those** fragments;
- otherwise the file is **unbound**. In a single-file row it still falls back to the shared
  bag (must match, or the row is stale). In a multi-file row (more than one resolved file) an
  unbound file is itself a failure — the bag is NOT consulted for it — and the row is STALE
  (`unbound: <files>`), even when the bag would have matched.
- The summary prints `N multi-site rows with unbound files`. After this plan completes that
  number must be 0 for the rows in scope and is a drift signal thereafter.
- Directory sites no longer pass on existence: a directory in `site` must be replaced by a
  specific file inside it (or the row is stale with `directory site needs a file`).
- Dispositions: `closed` is **not** a vocabulary word (plan §3 is `open` · `scheduled` · `done` ·
  `rejected`). J27-072's `closed.` is normalised to `done (6b810c96, promoted 2026-09-07)`.
  The gate stays strict on vocabulary; it does not learn `closed`.

**Negative self-tests required (Codex finding 2):** swapped bindings fail (fragment bound to
`a.js` present only in `b.js`); a bound fragment absent from its file fails even when a bag
fragment matches; a common eight-character token in the bag does not rescue a bound file;
directory-only existence fails; a glob-bound fragment must appear in every glob match;
`closed.` is not treated as closed; a pure-bag or partially-bound multi-file row is STALE
(STRICT UNBOUND) even when the bag would have matched the unbound file; an equivalent-spelling
binding (site cited via shorthand, bound via the expanded path) and a per-file binding under a
glob site are in-site, not stale. Positive: a fully-bound multi-file row (every file bound and
matching) passes; single-file row with bag only passes.

**Also in Phase 0:** `docs/CURRENT_WORK_QUEUE.md` item 8 is corrected (gate baseline is red on
this branch, reconciliation is prerequisite work, next action is this plan) and
`docs/J27_SINGLE_PHASE_TRANSITION_INVENTORY_PLAN.md` §3/§7 and `docs/CI_GATES_REFERENCE.md`
describe the binding syntax. Phase 0 is one commit on `claude/j27-gate-tighten`, Opus-reviewed
before Phase 1 starts.

## 3. Phase 1 — the per-row decision rule (agents apply this, nothing else)

For each stale row, for each cited file the gate names, read the file at the cited line(s)
and pick exactly one of:

| Case | What you see in the file | Action |
|---|---|---|
| **A. Site carries the fact** | The file states, implements, pins, or restates the J27-sensitive fact the row is about. **Tests, Atlas pages, wiki topics, and active memories count** — they must change with the transition, so they stay checked. | Add a **bound** verbatim fragment from that file: `` `path` → `fragment` ``. Copy exactly, ≥ 8 characters, one clause or one code-token run. The matcher ignores inner backticks, comment sigils, and whitespace runs; nothing else. |
| **A′. Same file, different fact** | The file carries a J27-sensitive fact that is *not* the one this row states (the row was bundling two facts). | **Split**: leave this row for the original fact; add a new row with the next unused id in the same section for the other fact, with its own bound fragment, `Dep`/`Ev` copied, `Q` as applicable, disposition `open (split from J27-NNN 2026-09-08)`. |
| **B. Non-actionable provenance** | The file is a dated snapshot that will never change: `DEVELOPMENT_LOG.md`, `docs/audits/*`, `docs/archive/*`, `_archived/**`, a memory whose frontmatter is `status: stale` or `superseded`, or a commit-record line. | Move the citation into the `disposition / notes` cell prefixed `provenance:` with its original `file:line`. **Nothing else qualifies for B.** Every B is listed in the agent's decision matrix and reviewed. |
| **C. Genuine drift** | The file no longer contains the fact, or says something different. | Never invent a fragment. If the fact moved within the file, fix the line cite and bind a fragment at the new location. If it is gone, keep the citation in `site`, add a dated note `drift 2026-09-08: <what changed>`, and set `Ev` to `AS` with a one-line reason; the row is then reported to the orchestrator, who decides with the owner whether it is `rejected`. A row with unresolved drift stays stale on purpose. |

Rules that apply to every edit:

- Fragments are verbatim. If the matcher fails after your edit, the quote is wrong, not the
  matcher.
- Seven-column row shape; no bare `|` inside a cell (gate exits 2 on malformed rows).
- Never remove a citation. Case B moves it into notes; nothing deletes it.
- Every multi-file row you touch ends with **zero unbound files**.
- Do not touch rows outside your slice, section headers, legend, §6–§10, or any other file.
- Do not write `J27:` in prose.
- **Decision matrix.** Each agent appends its per-file decisions to
  `docs/plans/J27_REGISTER_RECONCILIATION_DECISIONS_2026-09-08.md` (one table row per cited
  file: `register id · file · case · fragment or note · one-line reason`). This is the artifact
  the reviewers audit, and it is committed with the register change.

## 4. Execution shape

Four Sonnet subagents run **in parallel, each in its own worktree** branched from the
Phase 0 commit. Each owns a contiguous block of register lines so no two agents edit adjacent
rows; new split rows are appended at the end of the agent's own block, not the section end.
Each agent:

1. Verifies its base (clean tree, HEAD at the Phase 0 commit or later); symlinks `node_modules`
   and `.agents/skills` from the main checkout.
2. Runs the gate and confirms its rows are the stale ones assigned.
3. Applies §3 row by row, reading every cited file at the cited lines before deciding, and
   writing the decision-matrix line before editing the row.
4. Re-runs the gate after each row: the row must reach `ok` with no `unbound` warning; the
   gate must never exit 2.
5. Commits once (register + decision matrix only), does not push, and reports: rows done,
   per-slice A/A′/B/C counts, any row left stale (case C) with its note.

Time-box 60 minutes per agent; an agent that cannot finish commits what is done and reports
the remainder for reassignment.

**Integration (orchestrator, Fable).** The four commits are spliced onto the branch with
zero-context patches (`git diff -U0 <phase0>..HEAD -- <register> <matrix> | git apply
--unidiff-zero`) in slice order; after each splice the orchestrator diffs the register row ids
touched against the slice's assignment and rejects any patch that touches an id outside it.
Fallback: re-run that slice sequentially against the integrated register.

## 5. Verification and review (exhaustive, not sampled — Codex finding 3)

- **Gate:** 0 stale, 0 id-less markers, 0 multi-site rows with unbound files, no exit 2.
  Expected counts: 76 original rows + split rows; ok = 76 − 6 unverifiable − closed (10 + any
  case-C rows the owner rejects) + splits. The orchestrator computes the exact expected line
  from the decision matrix before running the gate and records both in the PR.
- **Self-test:** exits 0 (the assertion count is whatever the file maintains; today 36 `check()`
  calls plus the Phase 0 additions — cite the number from the run, not from this plan).
- **Docs battery** sequentially: memory-router, fact-consistency, doc-currency, doc-symbol-refs,
  build-claim-freshness, canonical-pointers, docs-catalog, harness-framing, agent-wiki (each
  with self-test), agent-invariants:ci.
- **Opus review, exhaustive.** Two Opus reviewers split the decision matrix by slice (A+B, C+D)
  and check **every** line: open the file, confirm the bound fragment is verbatim and is the J27
  fact the row states (not a coincidental token); confirm every case B file matches the §3
  provenance definition; confirm every A′ split is a distinct fact; confirm every case C note is
  true. Reject any slice with an unjustified B or a paraphrased fragment; findings route back to
  the slice agent.
- **Codex adversarial review** of the whole branch (`--model gpt-5.6-sol`, `--base origin/main`)
  after Opus is clean.
- **PR** to `main` (Tier 0: gate script, self-test, register, plan docs, queue). Owner merge.

## 6. Record surfaces

`docs/J27_TRANSITION_REGISTER.md` §9 (drop the resolved weakness bullets, add the binding
convention) and §10 (dated line with before/after counts); `docs/J27_SINGLE_PHASE_TRANSITION_INVENTORY_PLAN.md`
§3 (schema amendment) and §10; `docs/CI_GATES_REFERENCE.md`; **`docs/CURRENT_WORK_QUEUE.md`
item 8** (Codex finding 5); `SESSION_PROMPT.md` item 2.

## 7. Slices (42 rows after Phase 0's J27-072 normalisation; register line numbers as of
`c96a6a27`, re-check after Phase 0)

| Slice | Register lines | Rows | Count |
|---|---|---|---|
| **A** Retire + Persist | 44–72 | J27-007, 008, 010, 011, 022, 023, 024, 025, 026, 027, 028, 032, 033 | 13 |
| **B** Change (code-heavy) | 79–92 | J27-035, 036, 037, 038, 039, 040, 041, 042, 043, 044, 045, 047, 048 | 13 |
| **C** Change (docs/memory) | 94–103 | J27-050, 053, 055, 056, 057, 058, 059 | 7 |
| **D** Build + Scale | 109–133 | J27-060, 062, 063, 065, 066, 070, 073, 074, 079 (J27-072 left this slice via Phase 0's
disposition normalisation, not a row edit) | 9 |

Known heavy rows: J27-011 (glob over six intake tests: case A each, one bound fragment per
test, or narrow the glob to the tests that carry the form key; **its site cell is the only
real directory citation left in the register, `` `shared/forms/phase-ii-research-2026-06/` ``
— the gate now stales any directory site on existence alone, so slice A must replace it with
a specific file inside that directory, not just add fragments elsewhere in the row**);
J27-032 (glob over `shared/components/reviewers/*`: bind per file or narrow to the components
with a "Phase 3" comment; case A′ likely); J27-040 / J27-041 (nine and seven Phase I/II sites:
one bound fragment each); J27-045 (five files sharing the `cycleCode` error string: one bound
fragment per file even if identical); J27-047 (runbook, security matrix, Atlas: all case A —
they change when the cycle constant flips).

**STRICT UNBOUND note (Opus review of Phase 0, `987ba3c9`, 2026-09-08):** the gate no longer
lets a multi-file row pass on a shared bag match; every file needs its own binding. This
raises the stale count above 42 and changes exactly which rows/files are affected — re-run
`node scripts/check-j27-register.js` against the Phase 0 commit before re-slicing, and treat
the counts and the row list above as a starting point, not the final assignment.

## 8. Exit criteria

- Gate: 0 stale, 0 id-less markers, 0 unbound multi-site rows; self-test exit 0; docs battery
  green; expected-count line in the PR matches the gate's summary.
- Every one of the 42 rows (43 before Phase 0's J27-072 normalisation moved it to closed; the
  exact set to reconcile after STRICT UNBOUND is whatever a fresh gate run against the Phase 0
  commit reports, per §7's note) — and every split row — appears in the diff with a
  decision-matrix line per cited file; no other row changed; no file outside the register,
  matrix, and §6 record surfaces changed.
- Both Opus reviewers clean on their halves; Codex findings dispositioned; owner has ruled on
  any case-C row.
- PR merged on owner decision; `/start` runs the gate green afterwards.

## 9. What the gate still cannot detect (stated so nobody over-trusts it)

A bound fragment proves the quoted words are still in the file, not that their meaning is
unchanged. Semantic drift is caught by the evidence labels, the owner questions, and the
next sweep, not by this string check. The register is an inventory with a freshness alarm,
not a contract.

**Updated after the Opus review of Phase 0 (`987ba3c9`, 2026-09-08) and the STRICT UNBOUND
fix — residual gaps that remain even with binding, per-site resolution, and strict unbound:**

- **A generic bound fragment can still be a wrong-but-plausible quote.** Binding proves the
  words sit in the *right file*; it does not prove they are the *right words for the fact the
  row states*. A short, common code token (a constant name reused across the codebase, for
  example) can be bound to the wrong site and still pass if it happens to appear there too —
  this is why the Opus review of each slice reads the file, not just the gate's exit code.
- **A shared bag fragment across several bound files still proves nothing about any one of
  them individually beyond presence.** Two files bound to the same generic fragment (e.g. a
  cycle-code literal repeated verbatim in five call sites, J27-045) can each satisfy the gate
  while still being the wrong quote for what changes in J27 — same caveat as above, at the
  bound-file granularity now that STRICT UNBOUND has closed the row-level version of this gap.
- **Binding-path resolution follows `site`'s own conventions (BARE_NAME_PREFIXES, sibling
  dir, globs), which are themselves heuristic.** A binding can resolve to the wrong file of
  the same basename in an edge case those heuristics do not disambiguate; this is a narrow
  surface, not eliminated by C1's `binding path not in site` check, which only catches a
  binding that resolves outside the row's own citations entirely.
- **Directory-site strictness only forces a *file* citation; it does not know which file in
  the directory is the load-bearing one.** Replacing a directory with the wrong file inside it
  still passes if that file happens to contain the bound fragment.
- **The disposition-vocabulary check is spelling, not judgement.** `open`/`scheduled`/`done`/
  `rejected` are recognized words; a row can carry a nonsense-but-vocabulary-legal disposition
  (`done` with no commit reference) and the gate has no way to tell.
- **STRICT UNBOUND stops a multi-file row from hiding behind a shared bag match, but a
  single-file row still falls back to the bag** — a lone cited file with only a generic bag
  fragment is exactly as weakly verified as before this review.
