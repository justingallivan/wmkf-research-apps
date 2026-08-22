---
title: Memory Hygiene Runbook
domain: docs-governance
kind: runbook
status: canonical
summary: "Canonical procedure for auditing repository memory: routine and deep audits, triggers, router diet, classification rules, and acceptance criteria."
canonical: true
cataloged: 2026-08-21
last_verified: 2026-08-21
owner: product-engineering
related:
  - docs/audits/memory-hygiene-best-practices-review-2026-08-21.md
  - docs/CLAUDE_MEMORY_REORGANIZATION_PLAN.md
  - docs/CI_GATES_REFERENCE.md
  - .claude-memory/MEMORY.md
  - scripts/check-memory-router.js
  - scripts/check-memory-health.js
  - scripts/check-memory-drift.js
---

# Memory Hygiene Runbook

The reusable procedure for keeping this repository's durable agent memory
truthful, small, and retrievable. It is executable by a future agent without
any other context. Evidence and rationale for its design live in
`docs/audits/memory-hygiene-best-practices-review-2026-08-21.md`; this document
does not depend on that report to run.

## 1. Purpose and authority

- **Purpose:** prevent the two known failure classes of this memory system:
  (1) the auto-loaded router regrowing until enforcement bites (historical
  sawtooth: diets on 2026-06-04, 2026-07-02, 2026-07-29, each followed by
  regrowth of roughly 166–500 bytes/day), and (2) stale semantic claims —
  especially false negative claims ("not built", "unused", "still
  load-bearing") — sitting in active memory between ad-hoc audits.
- **Authority:** subordinate to `CLAUDE.md` (Universal Operating Rules, the
  time-box rule, and destructive-carryover verification), to
  `.claude/rules/durable-docs.md`, and to the gate contracts in
  `docs/CI_GATES_REFERENCE.md`. Where this runbook and a checker disagree
  about a threshold, the checker source is authoritative
  (`scripts/check-memory-router.js` exports the router caps; do not trust
  numbers quoted in prose, including in this file's examples).
- **Skills:** a deep audit runs as `/sweep` Mode B; `/contract-reconcile`
  applies when a memory claim describes cross-layer behavior.

## 2. Source-of-truth hierarchy

When surfaces disagree, higher wins; the loser is corrected or marked stale:

1. Live external state via an authorized read-only probe (see §4 safety).
2. Current source code and persisted schema/migrations.
3. `docs/APPLICATION_STATE_ATLAS.md` + `docs/atlas/` (probe-labeled claims).
4. Canonical docs (`kind: source-of-truth` / `status: canonical` in the docs
   catalog) and current owner decisions.
5. `docs/agent-wiki/` (routing + hazards; subordinate by its own contract).
6. `SESSION_PROMPT.md` (current handoff only).
7. `.claude-memory/*.md` leaves (intent, lessons, hazards, history).
8. `.claude-memory/MEMORY.md` (pure routing; asserts no facts of its own).

A memory is never evidence for a live-state claim. A plan is never evidence of
built behavior. An audit's date is never evidence a claim is still current.

## 3. Roles and ownership

- **Any agent (Claude or Codex)** may run the routine audit and commit its
  bounded fixes on an appropriate branch (Tier 0 docs/memory work may land on
  `main` per `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`).
- **A deep audit** is a named workstream: one owner-session, one dated report,
  read-only until the fix pass is explicitly begun.
- **The owner (Justin)** decides: checker/threshold changes, memory deletions,
  live-probe authorization (production Dataverse reads are always owner-run —
  never set `DATAVERSE_ALLOW_PROD_READS` yourself), and disputed
  classifications.
- Multi-agent etiquette per `docs/AGENT_COLLABORATION_PLAN.md`: one owner per
  surface; never audit memory files another agent is actively editing.

## 4. Prerequisites and safety boundaries

Before any audit step:

1. `/start` has run (or minimally: correct branch confirmed, memory-store and
   skills symlinks verified, no unexplained dirty files).
2. **Read-only first.** The audit's discovery phase makes no edits. Fix passes
   are separate, explicit, and committed separately from feature work.
3. **Never run** `npm run check:memory-drift` (mutating) during diagnosis —
   only `npm run check:memory-drift:no-write`. Regenerating the report runs
   live probes and dirties the tracked JSON; that is an owner-approved action.
4. No production Dataverse reads without the owner running/authorizing them.
   Postgres/Vercel probes follow the same rule during a documentation audit:
   if the claim needs live state, record it as `UNKNOWN` + the named probe.
5. Do not delete memory files during an audit. Demote (stale / closed /
   superseded) instead; deletion is a separate owner-approved cleanup with the
   destructive-carryover verification from `CLAUDE.md`.
6. Time-box: routine audit ≈ 30–60 minutes; if it exceeds that or two commits,
   check in per Universal Operating Rule 3.

## 5. Audit triggers and cadence

Run the **routine audit** when ANY of:

| Trigger | Check | Rationale |
|---|---|---|
| Calendar | ~2 weeks since the last routine audit | backstop only — the size trigger below is primary (mechanical since 2026-08-21: `check:memory-router` notice + SessionStart/Stop advisories, per `docs/MEMORY_ROUTER_EARLY_WARNING_PLAN.md`): at the worst observed regrowth (~500 B/day) a 6 KiB router reaches the 12 KiB cap in ~12 days, inside any calendar cadence |
| Router size | `MEMORY.md` ≥ 8,192 B (the gate's OK line prints the size) | crossed silently on 2026-08-13; observed regrowth ≈166–500 B/day |
| Health findings | `check:memory-health` flagged files ≥ 5 | steady inflow; resets do not persist |
| Store growth | ≥ 25 new leaf files since the last audit | roughly one month of observed inflow |
| Drift report | committed report older than 24 h **and** a session needs to cite "drift clean" | the checker itself warns; do not cite a stale report silently |

Run a **deep audit** when ANY of:

- quarterly, if none has run this quarter;
- a schema/migration wave, retirement, or rename touches facts that memory
  asserts;
- an incident is traced to a stale memory or a memory-guided wrong action;
- a harness/model change alters how memory is loaded or written;
- before relying on remembered negative claims for destructive work (this one
  is mandatory, per CLAUDE.md rule 2);
- the routine audit surfaces contradictions it cannot resolve in its time-box.

## 6. The routine audit (lightweight, recurring)

Read-only discovery, then a bounded fix pass. Exact commands:

```bash
# A. Structural + advisory state (read-only)
npm run check:memory-router            # note bytes/lines from the OK line
npm run check:memory-health -- --json  # save/inspect the findings array
npm run check:memory-drift:no-write    # note report age from the warning line

# B. Router composition (read-only)
node -e "
const fs=require('fs');const raw=fs.readFileSync('.claude-memory/MEMORY.md','utf8');
const refs=raw.match(/[A-Za-z0-9._\/-]+\.md/g)||[];
const leaf=[...new Set(refs.filter(r=>!r.includes('/')&&r!=='MEMORY.md'))];
const hub=[...new Set(refs.filter(r=>r.includes('/')))];
console.log('bytes',Buffer.byteLength(raw),'| unique leaf refs',leaf.length,'| unique hub refs',hub.length);"

# C. Status census (read-only)
node -e "
const fs=require('fs');const d='.claude-memory';const c={};
for(const f of fs.readdirSync(d)){if(!f.endsWith('.md')||f==='MEMORY.md')continue;
const m=fs.readFileSync(d+'/'+f,'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
const s=m&&m[1].match(/^\s*status:\s*(.+?)\s*$/m);const v=s?s[1].replace(/['\"]/g,''):'MISSING';
c[v]=(c[v]||0)+1;}console.log(c);"
```

Then:

1. **Classify every health finding** (see §9). Every flagged file gets a
   written disposition in the audit note: `real-defect` (stale/false claim —
   fix in the fix pass), `hygiene-debt` (missing heading/metadata, oversize —
   fix cheaply or schedule), or `accepted` (with a one-line reason). Silencing
   a finding by inserting checker keywords without substantive repair is
   forbidden (this is the standing invariant from the 2026-07-27 sweep).
2. **Read the router end-to-end** (it is small) and flag every line carrying a
   status/release claim ("RESOLVED …", "done", "shipped", "production-live",
   "accepted by-design") — these are diet candidates (§10), because status
   belongs to SESSION_PROMPT / the current queue / plans, not the router.
3. **Sample 5 leaf memories** — at least 2 recently added (`git log
   --diff-filter=A -5 -- .claude-memory/`) and 2 routed-and-old. For each:
   recall-rule quality (§11) and one spot-verification of its most
   consequential claim against source (CodeGraph first).
4. **Fix pass (bounded):** router diet if over 8 KiB (§10); dispositions from
   step 1 that take minutes; demote any leaf the sampling proved stale.
   Anything larger becomes a queued deep-audit item, not scope creep.
5. **Verify and record:** rerun the three commands from A, run
   `npm run check:memory-router:self-test` after any router edit (gate before
   self-test, sequentially), run `npm run check:fact-consistency &&
   npm run check:fact-consistency:self-test` if any fact was touched, append a
   row to the metrics table (§18), and commit with a `memory:`/`docs(memory):`
   message. A routine audit that changes nothing still records its metrics row
   (a "no findings" result with the denominator printed).

## 7. The deep evidence audit

A `/sweep` Mode B workstream over the memory domain (or a named slice of it —
slicing by domain hub is legitimate and preferred over shallow-everything).

1. **Scope contract first** (sweep Step 0): claims inventory, authoritative
   sources expected, surfaces in scope, exclusions with reasons.
2. **Baseline:** the routine audit's command block, plus the full gate battery
   if session start did not already run it.
3. **Evidence pass over every in-scope active leaf** — whole-file reads, then
   for each material claim: producer → persistence → consumer trace where the
   claim describes behavior (CodeGraph before grep); classification per §9.
4. **Falsification disciplines (mandatory, from the S154-V2 method):**
   - every named identifier checked, not a sample;
   - every negative claim ("NOT built", "do NOT drop", "unused", "still
     load-bearing", "no callers") verified by searching for the negated thing —
     including current names, former names, and the consumer side;
   - the memory's date treated as an upper bound — search for newer evidence
     (newer commits, newer docs, newer probes) that supersedes it;
   - Atlas pages cross-read for every claim naming a table/entity;
   - every CLEAN verdict re-justified before recording ("no external claims
     left unverified" or "external-state only, probe named").
5. **Contradiction pass:** compare leaves against each other and against
   docs/wiki for semantic conflicts and omissions (sweep Step 4) — grep alone
   cannot find these.
6. **Fix structurally** (sweep Step 6): rewrite sections around current truth;
   no update-banners stacked over contradictory text; history moved below an
   explicit historical boundary, never deleted for size alone.
7. **Re-run and falsify** (sweep Step 7): same searches, relevant gates and
   self-tests sequentially, one named disconfirming check per conclusion.
8. **Report** under `docs/audits/memory-<slice>-audit-YYYY-MM-DD.md` using the
   template in §17, with the point-in-time banner, and append the §18 metrics
   row.

## 8. Required treatment of every checker finding

Tool output is a worklist, never a verdict, in both directions:

- A finding is closed only by: substantive repair, an evidence-backed
  `accepted` disposition, or reclassification of the leaf. Never by inserting
  a grounding keyword, a fake `last_verified`, or a decorative recall-rule
  heading.
- A zero is only a structural statement. Never cite "memory-health: 0" as
  semantic cleanliness; cite the audit that established it and its date.
- Known measurement artifacts (record them as such rather than "fixing" the
  leaf): `weak-basis` currently keys on a `last_verified` frontmatter key and
  can flag a leaf whose body carries dated `[VERIFIED]` evidence; the router
  gate counts lines by newline-split (one higher than `wc -l`). Apply
  measurement artifacts in both directions — they can hide findings as well as
  create them.

## 9. Classification vocabulary and decision rules

Leaf frontmatter `status:` (enforced by the router gate):

| Status | Meaning | Decision rule |
|---|---|---|
| `active` | operationally relevant; an agent should still obey/consult it | keep ONLY if: (a) the lesson/decision still constrains action, AND (b) its factual frame survived the audit. "True but no longer guides anything" is `closed`, not `active`. |
| `closed` | work finished / decision executed; kept as history | route only via the closed-work archive, never directly from a task line |
| `stale` | contradicted by stronger evidence | first line states what contradicts it and where truth now lives |
| `superseded` | replaced by a specific newer surface | must name its successor |

Audit-hit classification (sweep vocabulary): `AGREE` / `STALE` / `HISTORICAL`
/ `UNRELATED`. `HISTORICAL` requires a visible historical boundary; a dated
caveat above contradictory current-voice text does not qualify — that line is
`STALE`. A line mixing current and stale assertions is `STALE`.

Demotion is a normal outcome: a deep audit that demotes nothing from a
~90%-active store should justify that result explicitly (the store's active
share has historically over-claimed; see the review §10 Q9).

## 10. Router-diet procedure

Trigger: router ≥ 8,192 B (the primary, size-based trigger — see §5), or the
audit flagged status-narrative lines. Target
after the diet: ≤ ~6 KiB and roughly ≤ 45 unique leaf refs (the 2026-07-29
diet landed at 5,175 B / 41 unique leaf refs and preserved all content).

1. Read the whole router. For each line, ask: *is this a retrieval trigger or
   a status claim?* Status claims (shipped/resolved/accepted/live/smoked) move
   to their owning surface: SESSION_PROMPT for session state, the current
   queue for priority, the plan/wiki hub for domain state, the closed-work
   archive for finished work.
2. Collapse leaf lists: a task line routes to a hub (wiki topic / plan) plus
   at most the 1–3 leaves that carry live hazards. Other leaves stay
   discoverable through the hub or archive — no leaf file is deleted by a
   diet.
3. Keep guardrail lines terse: decision keyword + file refs; rationale lives
   in the leaf (`project-memory-router-trap-prevention.md` is the shape
   reference).
4. No memory content may be destroyed to meet the number: a diet moves and
   points, it does not erase. If a line resists compression, its content
   belongs in a leaf/wiki page — create or extend one.
5. Verify sequentially: `npm run check:memory-router` then
   `npm run check:memory-router:self-test`; rerun the §6.B composition
   one-liner and record before/after in the audit note. The write-time guard
   never blocks a shrinking edit, so a diet cannot wedge.

## 11. Recall-rule quality criteria

A good `## Recall Rule` (shape from `docs/CLAUDE_MEMORY_REORGANIZATION_PLAN.md`):

- **Trigger is discriminative:** names concrete task/file/symbol conditions
  ("editing `.claude-memory/MEMORY.md`", "before adding a prompt seed"), not a
  topic ("when working on reviewers").
- **Do / Do-not are actions**, 1–3 each, executable without reading the body.
- **Ground truth names checkable surfaces** (source paths, Atlas page, gate) —
  and those paths exist (`check:doc-symbol-refs` enforces this in CI).
- **Boundaries are explicit:** what this memory does NOT cover; supersession
  pointers where applicable.

Bad patterns (audit as hygiene-debt): heading present with vague body
("remember this context"); trigger that matches every session; rules
duplicating another leaf verbatim (near-duplicates measurably degrade
retrieval — dedupe by merging and pointing); a recall rule asserting live
state instead of pointing at its authority.

## 12. Promotion and demotion between surfaces

Promote OUT of memory when a fact hardens; demote INTO history when it closes:

| Content | Promote to | Leaf afterward |
|---|---|---|
| Structural live-state (schema, ownership, read/write paths, row counts) | Atlas page with probe/`[VERIFIED]` label | pointer + the lesson only |
| Domain mechanism, hazard map, source routing | `docs/agent-wiki/topics/*` (update `last_verified`; run `check:agent-wiki`) | pointer + intent |
| Always-binding rule of conduct | `CLAUDE.md` / `.claude/rules/` — only if it must bind every session; else a skill | leaf keeps the incident rationale |
| Mechanically checkable invariant | a gate/hook per the CI-gates contract (lesson → self-test fixture → gate, in that order) | leaf records why the gate exists |
| Drift-prone derived scalar | `scripts/lib/canonical-facts.js` registry + generated counts doc | cite the pointer, never the literal |
| Finished work / executed decision | `status: closed` + closed-work archive index | — |

Rules: one promotion per fact (no dual-authority copies); the leaf is edited in
the same pass to defer to the new authority; `check:fact-consistency` runs
after any scalar move. Never promote an unverified memory claim — promotion
requires the same evidence bar as an audit `AGREE`.

## 13. Editing rules and forbidden shortcuts

- Read the entire target file before editing any fact (durable-docs rule).
- Update-in-place over near-duplicate files; new leaf files need frontmatter
  with a valid `status:` and a recall rule.
- Forbidden: mass `last_verified` refreshes without per-claim verification;
  keyword insertion to silence checkers; deleting content purely for size;
  appending correction banners above contradictory text; rewriting explicitly
  historical records to sound current; editing another agent's in-flight
  surface; hand-editing generated outputs (`docs/DOCS_CATALOG.md`,
  `docs/CANONICAL_COUNTS.md`, `docs/RECONCILIATION_REPORT.json`) — use their
  generators.
- Every fact edit sweeps its restatements in the same pass (`/sweep` Mode A
  applies when one known fact changed).

## 14. Stop and escalation conditions

Stop the audit and report (do not push through) when:

- a memory claim, if true, makes planned work destructive — apply CLAUDE.md
  rule 2 verification before anything else;
- two authoritative surfaces contradict each other (e.g. Atlas vs source) —
  that is a truth problem, not a memory-formatting problem; resolve via
  `/sweep` with the live source winning, or escalate to the owner;
- resolving a finding requires a live probe you are not authorized to run —
  record `UNKNOWN` + the exact probe command for the owner;
- the fix pass wants to touch checkers, hooks, thresholds, or instruction
  files — those are owner-decision changes, proposed in the report;
- the routine time-box is exhausted — queue the remainder as deep-audit scope;
- any relevant gate goes red for a cause you did not introduce — surface it as
  P0 per repository policy rather than working around it.

## 15. Sequential gate and self-test order

After a fix pass, run the relevant set, each gate before its own self-test,
never in parallel (fixture-race rule in `docs/CI_GATES_REFERENCE.md`):

```bash
npm run check:agent-invariants
npm run check:memory-router && npm run check:memory-router:self-test
npm run check:fact-consistency && npm run check:fact-consistency:self-test   # if facts touched
npm run check:doc-symbol-refs && npm run check:doc-symbol-refs:self-test     # if paths touched
npm run check:build-claim-freshness && npm run check:build-claim-freshness:self-test
npm run check:agent-wiki && npm run check:agent-wiki:self-test               # if wiki touched
npm run check:docs-catalog                                                   # if top-level docs touched (regenerate first)
npm run check:harness-framing && npm run check:harness-framing:self-test     # if router/feedback-memory wording touched
npm run check:memory-health                                                  # advisory close-out reading
npm run check:memory-drift:no-write                                          # advisory close-out reading
```

A red gate blocks completion of the audit for the touched surface regardless of
who caused it.

## 16. Acceptance criteria (measurable)

A **routine audit** is complete when:

- the three §6.A commands were run and their outputs recorded;
- every flagged file has a written disposition (denominator printed: "N
  flagged / N dispositioned");
- the router is < 8,192 B after the pass (or the diet is an explicitly queued
  deep-audit item with a reason);
- the §18 metrics row is appended;
- relevant gates (§15) are green sequentially;
- the working tree is clean (work committed) and no memory file was deleted.

A **deep audit** additionally requires:

- a scope contract and evidence matrix in the report;
- 100% of in-scope active leaves classified with evidence;
- every negative claim in scope carries a named falsification query and
  result;
- zero remaining live `STALE` hits in scope (or the verdict is explicitly
  `AUDIT INCOMPLETE`/`CLAIM NOT RECONCILED` — never a soft "mostly done");
- unknowns listed with their named probes and owners.

## 17. Audit-report template

```markdown
---
title: Memory <Routine|Deep> Audit — YYYY-MM-DD
summary: "<one sentence>"
canonical: false
owner: product-engineering
last_verified: YYYY-MM-DD
---
Status: point-in-time evidence report. Re-run the named checks before relying
on these counts.
Repo baseline: <branch> @ <sha>

## Scope            (mode; slice; exclusions + reasons)
## Commands run     (verbatim, with the numbers they printed)
## Findings         (| file/claim | classification | evidence | disposition |)
## Falsification    (per conclusion: the disconfirming query and its result)
## Fixes applied    (commits; before/after metrics)
## Unknowns & owner decisions   (UNKNOWN + named probe; proposals, not edits)
## Metrics row      (appended to docs/MEMORY_HYGIENE_RUNBOOK.md §18)
## Verdict          (RECONCILED | RECONCILED WITH EXPLICIT UNKNOWNS |
                     CLAIM NOT RECONCILED | AUDIT INCOMPLETE — bounded to scope)
```

## 18. Metrics and trend table

Append one row per audit (values from the §6 commands; do not estimate):

| Date | Type | Router B (before→after) | Lines | Unique leaf refs | Leaf files | Active share | Health flagged (before→after) | Drift report age | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 2026-08-21 | baseline (review) | 8,991 | 66 | 62 | 247 | 221/247 | 3→3 (dispositions recorded, fixes out of scope) | 4 d | `docs/audits/memory-hygiene-best-practices-review-2026-08-21.md` |
| 2026-08-21 | routine | 9,040→5,911 | 66→60 | 63→45 | 248 | 222/248 | 3→2 | >24 h | `docs/audits/memory-routine-audit-2026-08-21.md` |

Interpretation guardrails: router bytes trending toward 11 KiB means the
routine cadence is too slow or diets too shallow; unique leaf refs climbing
~20 above the last diet's landing point predicts the next one; health-flagged
counts are an inflow gauge, not a scoreboard — a steady trickle with prompt
dispositions is healthy, a cliff to zero with no evidence trail is suspect.

## 19. Rollback and recovery

- Memory is git-tracked: recover any pre-audit state with
  `git log --follow -- .claude-memory/<file>` and `git show <sha>:<path>`;
  revert an audit commit with `git revert <sha>` (never unscoped stash/reset in
  shared worktrees — see the scoped-stash rule in the memory router).
- An over-aggressive diet loses no content by construction (§10.4); restore a
  demoted route by re-adding one line — the guard never blocks a shrinking or
  neutral edit, and a growing one passes below the cap.
- If the router gate goes red after an edit, the gate's message names the
  dimension; a partial cleanup always passes the write-time guard, so fix
  incrementally rather than force-writing.
- If the drift report was regenerated by mistake: first inspect
  `git diff -- docs/RECONCILIATION_REPORT.json`; restore with
  `git checkout -- docs/RECONCILIATION_REPORT.json` ONLY when the diff is
  solely the accidental regeneration. If it contains any other change
  (another agent's work, a deliberate pre-existing edit), stop and confirm
  with the owner before discarding anything.

## 20. Examples

**Good router entry** (terse trigger + hub + hazard leaf):

```md
- Reviewer address trust: ../docs/agent-wiki/topics/reviewer-identity.md; ../docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md
```

**Bad router entry** (status narrative that will rot in place — real historical
pattern; the status belongs to the plan/queue/handoff):

```md
- Review-form multiselect: …BUILD_PLAN.md — implementation and production smoke are complete; broader exposure and rollback rehearsals remain held
```

**Good recall rule** (discriminative trigger, checkable ground truth):

```md
## Recall Rule
Read this when: editing `.claude-memory/MEMORY.md`, adding a routed memory, or
debugging memory-router budget failures.
Do: keep router lines terse; run check:memory-router + self-test after routing changes.
Do not: treat the write-time hook as complete coverage; grow the router with narrative.
Ground truth: .claude/hooks/memory-router-guard.js, scripts/check-memory-router.js
```

**Bad recall rule** (undiscriminative, unfalsifiable, asserts state):

```md
## Recall Rule
Read this when working on the project. Remember the reviewer data migration is
not done yet, so treat the legacy tables as load-bearing.
```

(Both bad examples illustrate the same defect: a claim frozen at write time,
presented as durable guidance, with no pointer to the surface that actually
owns the fact.)
