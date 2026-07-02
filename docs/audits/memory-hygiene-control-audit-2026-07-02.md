# Memory Hygiene Control Audit - 2026-07-02

Status: point-in-time cleanup-control audit plus Slice 1 result. Do not treat
this report as live application state after the run date; re-run the commands
before acting on counts.

Repo HEAD: `cb68a8c604e5fd63ba24a52b02ed2f2c9c4b8685`

## Scope

This audit covers the retrieval/control surfaces for project memory hygiene:

- `.claude-memory/MEMORY.md`
- `.claude-memory/*.md`
- `docs/agent-wiki/index.md`
- `docs/agent-wiki/topics/*.md`
- `docs/APPLICATION_STATE_ATLAS.md`
- `scripts/check-memory-router.js`
- `scripts/check-agent-wiki.js`

It does not edit, delete, archive, or mark any memory as stale. The purpose is to
define a safe cleanup queue before touching durable memory.

## Contract

| Surface | Intended role | Current control |
|---|---|---|
| `.claude-memory/MEMORY.md` | Startup router only: terse trigger -> a few files to read | `check:memory-router` enforces existence, links, status metadata, `150` lines max, `12KB` hard cap, `11KB` warning band, and `200`-char router-prose cap |
| `.claude-memory/*.md` | Durable lessons, hazards, owner decisions, historical rationale | `check:memory-router` requires frontmatter status but does not verify semantic freshness |
| `docs/agent-wiki/` | Retrieval hubs pointing to source, Atlas, rules, and memory | `check:agent-wiki` verifies frontmatter, freshness dates, routing, paths, and links |
| `docs/APPLICATION_STATE_ATLAS.md` plus `docs/atlas/*` | Canonical structural state for data-layer claims | `check:atlas` verifies Postgres/Dataverse coverage; Atlas requires claim labels and probe-before-plan discipline |

The wiki already states the right hierarchy: it is subordinate to source, Atlas,
and live probes, and it should route agents to source files and canonical docs
before claims are made. The Atlas already states the right data-layer rule: if a
claim is unlabeled and its basis is unclear, treat it as assumed and probe before
acting.

## Evidence

### Router pressure baseline

Measured with a read-only Node inventory and `npm run check:memory-router`
before the Slice 1 router diet:

```text
MEMORY.md: 11,255 bytes / 100 lines / 79 router entries
check:memory-router: OK - all links resolve and all 192 topic files carry a valid status
```

Section costs from the same inventory:

| Section | Bytes | Lines | Entries |
|---|---:|---:|---:|
| Startup | 420 | 8 | 6 |
| Always-Read Guardrails | 2,958 | 24 | 22 |
| Working Norms | 3,035 | 23 | 21 |
| Task Routing | 4,254 | 30 | 28 |
| User Context | 69 | 3 | 1 |
| Archive | 74 | 3 | 1 |

`scripts/check-memory-router.js` sets `TARGET_BYTES = 12 * 1024`,
`WARN_BYTES = 11 * 1024`, and `MAX_PROSE_LEN = 200`. The baseline router was
valid but already inside the warning band.

### Slice 1 router result

After consolidating prose in `.claude-memory/MEMORY.md` without deleting any
leaf memory files:

```text
MEMORY.md: 6,010 bytes / 60 lines / 39 router entries
```

Post-Slice 1 section costs:

| Section | Bytes | Lines | Entries |
|---|---:|---:|---:|
| Startup | 420 | 8 | 6 |
| Always-Read Guardrails | 1,384 | 10 | 8 |
| Working Norms | 1,324 | 9 | 7 |
| Task Routing | 2,349 | 19 | 17 |
| User Context | 69 | 3 | 1 |
| Archive | 74 | 3 | 1 |

The router is now below the original `7KB` to `8KB` cleanup target. Future work
should preserve this shape by moving domain detail to wiki topics or leaf memory
files rather than adding explanatory prose to the router.

### Leaf memory inventory

Measured with the same read-only inventory:

| Metric | Count |
|---|---:|
| `.claude-memory/*.md` files excluding `MEMORY.md` | 192 |
| Active | 180 |
| Stale | 2 |
| Closed | 9 |
| Superseded | 1 |
| Active with `unknown` or `not re-probed` in `last_verified` | 103 |
| Active without `## Recall Rule` | 34 |

This is the largest hygiene risk. A green router gate proves structure, not
semantic freshness. Many active memories still have old memory-content as their
verification basis, which makes stale recall likely even when links and statuses
are valid.

### Agent wiki inventory

Measured with `npm run check:agent-wiki` and a read-only freshness inventory:

```text
agent-wiki OK - 14 markdown file(s), 12 topic page(s) checked.
```

All 12 topic pages are active and within their configured `stale_after_days`
window as of 2026-07-02. The wiki is therefore not the weak layer in this pass.
It is the right pressure valve for router detail.

### Existing audit overlap

`docs/archive/MEMORY_ROUTER_WIKI_RECOMMENDATIONS_2026-06-11.md` diagnosed the
same router-pressure pattern before the wiki expansion. It recommended using the
wiki as the pressure valve and keeping Atlas facts out of memory/wiki.

`docs/audits/memory-wiki-audit-2026-06-23.md` is a claim-level stale-fact audit.
It found `26` stale claim clusters and `82` needs-probe clusters across memory
and wiki. Today's report should not replace that audit; it should control the
cleanup sequence so the stale findings are not fixed by adding more router
prose.

## Findings

### P1 - Router was valid but too close to the hard cap

The router is under the `12KB` hard cap but above the `11KB` warning band. The
largest cost centers are `Task Routing`, `Working Norms`, and `Always-Read
Guardrails`.

Status: addressed by Slice 1 on 2026-07-02. The router is now `6,010` bytes /
`60` lines. Continue to enforce the same shape.

### P1 - Active memory status is overused

`180` of `192` leaf memory files are active, but `103` active files carry an
unknown or not-reprobed verification basis. That makes "active" too weak as a
retrieval signal.

Required change: demote obvious historical or superseded active memories before
doing expensive live probes. Reserve live probing for high-traffic, high-risk
files.

### P1 - Leaf memory needs an executable retrieval shape

`34` active memories lack a `## Recall Rule`. Those files can still be valid
history, but they are weaker as operational memory because the trigger, do/do-not
behavior, and ground-truth pointers are not normalized.

Required change: add `## Recall Rule` only to files that remain active after the
status pass. Do not normalize archive material for polish.

### P2 - Existing gates do not cover semantic freshness

The router and wiki gates are doing their structural jobs. They do not fail when
an active memory has stale live-state prose, old memory-content verification, or
no recall rule.

Required change: add an advisory memory-health check after the first cleanup
slice. It should report, not initially fail, active memories with:

- missing `## Recall Rule`
- empty `last_verified`
- `unknown` or `not re-probed` verification basis
- structural terms such as Postgres, Dataverse, table, entity, row count, route,
  read path, or write path without an Atlas/source/probe pointer nearby

### P2 - Router lines still carry too much decision context

The longest router lines remain below the 200-character prose cap, but several
lines are miniature policy summaries. Examples include branch-safety, self-review
before delegation, Codex rescue sandbox behavior, Dataverse settings audit, and
email token syntax.

Required change: convert these to short trigger lines plus wiki/topic pointers.
The leaf memory keeps the rationale; the router should not.

## Cleanup Queue

### Slice 1 - Router diet

Status: complete on 2026-07-02. `.claude-memory/MEMORY.md` was reduced from
`11,255` bytes / `100` lines to `6,010` bytes / `60` lines.

Recommended edits:

1. Collapse `Working Norms` into fewer hub routes.
2. Move long explanatory parentheticals into wiki topics or existing leaf files.
3. Add explicit `see docs/agent-wiki/topics/...` pointers where a route currently
   explains domain context inline.
4. Keep guardrail triggers, but shorten them to decision keywords plus file refs.

Verification:

```bash
npm run check:memory-router
npm run check:memory-router:self-test
```

### Slice 2 - Active status triage

Goal: make `status: active` meaningful again.

Start with high-byte active memories that also say `not re-probed`, because they
are most likely to be influential and stale:

| File | Current risk |
|---|---|
| `.claude-memory/project-dataverse-power-tools.md` | Large active file; last verified from memory-content, not re-probed |
| `.claude-memory/project-reviewer-postgres-to-dataverse-migration.md` | Large active migration memory; likely overlaps Atlas |
| `.claude-memory/project-dynamics-explorer-reuse-power-tools.md` | Large active Dynamics memory; live behavior likely belongs in source/probes/wiki |
| `.claude-memory/dataverse-export-floor-scoping.md` | Large active Dataverse memory; should defer structural claims to Atlas/probes |
| `.claude-memory/reviewer-identity-fragmentation.md` | Large active reviewer identity memory; likely overlaps wiki and current source |
| `.claude-memory/project-dynamics-ai-writeback.md` | Large active Dynamics writeback memory; high risk if stale |
| `.claude-memory/slice0-deactivate-not-delete-recalc.md` | Old slice memory; likely historical unless still load-bearing |

For each file, choose exactly one:

- keep active and add/refresh `## Recall Rule`
- mark historical/closed if the durable lesson is no longer operational
- mark stale/superseded if contradicted by current source, Atlas, or probes
- leave active but add `NEEDS-PROBE` in the recall rule if live verification is
  required before action

Verification:

```bash
npm run check:memory-router
npm run check:doc-symbol-refs
npm run check:build-claim-freshness
```

### Slice 3 - Recall-rule normalization

Goal: normalize only high-value active memories.

Priority groups:

1. Always-read guardrails referenced in router lines.
2. Reviewer workbench, reviewer identity, and reviewer origination memories.
3. Dataverse/Dynamics memories that agents routinely consult before probes.
4. Finance/honoraria memories with production-risk decisions.
5. Dev environment memories that affect verification commands.

Standard shape:

```md
## Recall Rule

Read this when: <specific trigger>.

Do:
- <1-3 concrete behaviors>

Do not:
- <1-3 traps or forbidden assumptions>

Ground truth:
- <source docs, Atlas pages, scripts, or code paths>
```

### Slice 4 - Atlas boundary sweep

Goal: stop memory from acting like a shadow Atlas.

Search memory for structural live-state terms and either replace the claim with
an Atlas/source/probe pointer or mark it historical:

```bash
rg -n "Postgres|Dataverse|table|entity|row count|rows|read path|write path|source of truth|migration|dropped" .claude-memory docs/agent-wiki
```

Do not update structural data by hand from memory. If the fact matters, verify it
against source, Atlas, or a live probe first.

### Slice 5 - Advisory enforcement

Goal: make future rot visible without blocking cleanup too early.

Add a read-only advisory script after the first cleanup slices, for example
`scripts/check-memory-health.js`, with a package script such as
`check:memory-health:no-write`.

Initial report-only checks:

- active memory with no `## Recall Rule`
- active memory with missing/unknown/not-reprobed `last_verified`
- stale/superseded memory still referenced directly from `MEMORY.md`
- memory files over a chosen byte threshold that are still active and routed
- structural-state terms without nearby Atlas/source/probe keywords

Only after the report is stable should any part of it become fail-closed.

## Non-Goals

- Do not delete memory files in the first cleanup pass.
- Do not move app structural truth from Atlas into wiki or memory.
- Do not re-probe all `103` questionable active memories before triage.
- Do not make `MEMORY.md` a compressed encyclopedia. A shorter dense router is
  still the wrong shape.
- Do not treat this point-in-time report as future truth without re-running the
  commands.

## Suggested Acceptance Criteria For The First Commit

- `.claude-memory/MEMORY.md` is below `8KB`.
- `check:memory-router` and `check:memory-router:self-test` pass sequentially.
- `check:agent-wiki` passes if any wiki topic changes.
- No memory file is deleted.
- At least 20 active leaf memories are triaged to active/closed/stale/superseded
  or explicitly marked `NEEDS-PROBE`.
- Every edited active memory has a `## Recall Rule` or a deliberate reason it is
  not operational.
- Any structural claim touched during cleanup points to source, Atlas, or a probe
  rather than memory alone.
