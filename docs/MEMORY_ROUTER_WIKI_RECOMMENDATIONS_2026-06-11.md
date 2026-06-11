# Memory Router and Agent Wiki Recommendations - 2026-06-11

**Author:** Codex  
**Scope:** Claude memory router, agent wiki, and Atlas roles after the latest fetched `origin/main` changes.  
**Intent:** Handoff brief for Claude to plan and implement a retrieval-surface cleanup, then send back to Codex for review.

## Executive Summary

The memory hygiene issue is active again. The Claude memory router is still structurally valid, but it has grown past its comfort budget and is absorbing detailed operational routing that belongs in the agent wiki or in existing canonical docs.

The Atlas is not the weak point in this specific problem. It remains the data-layer source-of-truth surface and its coverage gate is green. The underused surface is the agent wiki: it still has only one topic page, so `.claude-memory/MEMORY.md` continues to carry dense domain summaries and task-routing notes.

Recommended direction: make the agent wiki the pressure valve for domain routing, shrink the memory router back to terse triggers, and then harden the router gate so the same creep becomes a failure rather than a warning.

## Current State Evidence

All checks below were run or inspected by Codex on 2026-06-11.

### Local And Remote State

- The local worktree was clean.
- Local `main` was behind `origin/main` by 14 commits after `git fetch origin`.
- Codex did not pull or merge the remote changes into the working tree.
- The latest remote delta was inspected with `git show`, `git diff HEAD..origin/main`, and a temporary `git archive origin/main` extraction.

### Memory Router

On fetched `origin/main`, the memory-router gate passes but warns:

```text
warning: MEMORY.md is 13470 bytes, over the 12288-byte comfort target (still under the 18432 hard cap).
memory-router OK - MEMORY.md 13470 bytes / 101 lines; 143 topic file(s), all links resolve + all carry a valid status.
```

The gate currently treats this as a warning, not a failure. The hard caps remain:

- `MAX_LINES = 150`
- `MAX_BYTES = 18 * 1024`
- `TARGET_BYTES = 12 * 1024`

Current concern: the warning threshold is already breached, but agents can keep adding dense router lines until the hard cap is hit.

### Agent Wiki

On fetched `origin/main`, the agent-wiki gate passes:

```text
agent-wiki OK - 3 markdown file(s), 1 topic page(s) checked.
```

The wiki currently contains:

- `docs/agent-wiki/index.md`
- `docs/agent-wiki/log.md`
- `docs/agent-wiki/topics/reviewer-identity.md`

That means the wiki remains a narrow trial rather than a real retrieval layer. The index routes only one domain topic: reviewer identity.

### Atlas

On fetched `origin/main`, Atlas coverage passes:

```text
Atlas coverage OK: 34 Postgres table(s), 32 Dataverse entity set(s).
```

The Atlas role is already clear in `docs/APPLICATION_STATE_ATLAS.md`: it is the live-state reference for data-layer claims. It should stay canonical for tables, entities, source-of-truth, and read/write paths. This cleanup should not move Atlas facts into memory or wiki.

### Latest Change Made The Router Creep Worse

The latest remote changes add:

- `.claude-memory/project-e2e-playwright-harness.md`
- one new long line in `.claude-memory/MEMORY.md`
- E2E harness docs and CI files:
  - `tests/e2e/README.md`
  - `playwright.config.js`
  - `.github/workflows/e2e.yml`

The new router line is about 251 characters and summarizes details that already live in the E2E README, Playwright config, workflow, and the new topic memory:

```text
Playwright browser-E2E harness for the reviewer portal (`tests/e2e/`, `npm run test:e2e`; mocks the data layer; runs against `next build --webpack && next start`, NOT next dev; CI-gated `.github/workflows/e2e.yml`)
```

This is a useful memory entry, but the router line is doing too much. It is a miniature recurrence of the old dense-index failure mode.

## Diagnosis

The current retrieval layers have the right conceptual split but the wrong operational load:

| Surface | Intended Role | Current Reality |
|---|---|---|
| `.claude-memory/MEMORY.md` | Auto-loaded router: terse task trigger -> 1-3 memory files | Over comfort budget and carrying dense operational summaries |
| `.claude-memory/*.md` | Intent, lessons, hazards, historical decisions | Useful, but being routed through oversized index lines |
| `docs/agent-wiki/` | Launch-pad retrieval layer: source files, canonical docs, watch paths, update triggers | Structurally green but only one topic page |
| `docs/APPLICATION_STATE_ATLAS.md` + `docs/atlas/` | Data-layer source of truth | Healthy for this issue; coverage gate green |
| Hooks/gates | Structure and changed-surface reminders | Agent-wiki hook is edit-only and advisory; router warning does not fail |

Root cause: the wiki has not been promoted beyond the reviewer-identity trial, so every new operational domain still gets squeezed into `.claude-memory/MEMORY.md`.

## Recommendations

### 1. Make The Agent Wiki The Pressure Valve

Create a small set of real topic pages and route bulky clusters through them.

Recommended first topics:

| Topic Page | Purpose | Likely Source Files / Canonical Docs |
|---|---|---|
| `docs/agent-wiki/topics/reviewer-origination.md` | Reviewer retrieval/origination strategy and hazards | reviewer-finder design docs, reviewer origination memories, relevant reviewer-finder routes/services |
| `docs/agent-wiki/topics/reviewer-identity-contact-coi.md` or expand existing `reviewer-identity.md` | Identity, contact enrichment, COI, PI identity, save/display consumers | current reviewer identity page sources, COI docs, `discover.js`, `save-candidates.js`, enrichment services, Atlas pages |
| `docs/agent-wiki/topics/external-reviewer-portal.md` | External reviewer portal, accept flow, E2E harness, real-prod automation hazards | `pages/external/**`, `pages/api/external/**`, `shared/components/external/**`, `tests/e2e/README.md`, `playwright.config.js`, `.github/workflows/e2e.yml`, BILL docs/memories |
| `docs/agent-wiki/topics/intake-portal.md` | Intake portal auth, capture, virus scan, pilot decisions | intake docs, intake routes/services, relevant Atlas pages |
| `docs/agent-wiki/topics/dataverse-dynamics.md` | Dynamics Explorer, Dataverse schema/probes, OData gotchas | `docs/APPLICATION_STATE_ATLAS.md`, `docs/atlas/**`, Dynamics services, schema/probe scripts |

Keep the first pass small. The goal is not a knowledge garden; it is a handful of high-traffic routing pages that reduce the memory router.

### 2. Shrink The Memory Router Back To Terse Triggers

After topic pages exist, edit `.claude-memory/MEMORY.md` so long operational lines become short trigger lines.

Examples:

Current shape:

```text
- Playwright browser-E2E harness for the reviewer portal (`tests/e2e/`, `npm run test:e2e`; mocks the data layer; runs against `next build --webpack && next start`, NOT next dev; CI-gated `.github/workflows/e2e.yml`): project-e2e-playwright-harness.md
```

Preferred shape:

```text
- External reviewer portal testing / Playwright E2E: project-e2e-playwright-harness.md; see docs/agent-wiki/topics/external-reviewer-portal.md
```

Current shape:

```text
- Testing the reviewer-accept flow (real-prod accept CREATEs a honorarium akoya_request -> fires AkoyaGo plugins + classic workflows + a live Bill.com payment flow + contact->Business-Central sync; gate real-prod on human PA review, MOCK the data layer for automated tests; read-only probe `scripts/probe-dataverse-automation.js`): project-reviewer-accept-prod-automation.md
```

Preferred shape:

```text
- External reviewer accept-flow prod automation hazard: project-reviewer-accept-prod-automation.md; see docs/agent-wiki/topics/external-reviewer-portal.md
```

The memory file should keep the hazard. The router should only point to it.

### 3. Preserve Atlas Boundaries

Do not move live-state data-layer truth into wiki or memory.

Wiki topic pages should link to Atlas pages under `canonical_docs` when they touch:

- Postgres tables
- Dataverse entity sets
- read/write paths
- source-of-truth claims
- migration/drop/disposition claims

When memory/wiki and Atlas disagree, source/Atlas/probe wins and the memory/wiki should be marked stale.

### 4. Harden The Router Gate After Cleanup

Once `.claude-memory/MEMORY.md` is brought back under the 12KB comfort target, make future creep harder.

Recommended gate changes:

1. Change over-`TARGET_BYTES` from warning to failure.
2. Add a max-line-length check for router content.
3. Add self-test fixtures for both checks.

Suggested initial thresholds:

- Hard fail if `MEMORY.md` exceeds `12 * 1024` bytes.
- Hard fail if any non-heading, non-blank router line exceeds 180-200 characters.

This should be done only after the current router is slimmed down, otherwise the gate will immediately fail on known debt.

### 5. Make Wiki Use More Discoverable

The current agent-wiki hook fires only on `Write|Edit` and only when an edit path matches a topic `watch_paths`. That means it does not help before read-only reviews, planning, or broad exploration.

Options:

- Add explicit wiki-topic pointers to `.claude-memory/MEMORY.md` router lines.
- Add a small "Read agent wiki before broad domain work" reminder to the relevant startup/handoff docs.
- Consider expanding the hook later, but do not depend on hooks for initial adoption.

The low-risk first move is router pointers to wiki topics.

## Proposed Implementation Sequence For Claude

1. Confirm current branch and whether to pull/rebase onto `origin/main` before editing.
2. Add the first topic page: `docs/agent-wiki/topics/external-reviewer-portal.md`.
3. Update `docs/agent-wiki/index.md` to route external reviewer portal / accept flow / E2E harness work to that topic.
4. Shorten the two external-reviewer testing lines in `.claude-memory/MEMORY.md`.
5. Repeat for the largest reviewer-finder clusters if time allows.
6. Run gates sequentially:

```bash
npm run check:agent-wiki
npm run check:agent-wiki:self-test
npm run check:memory-router
npm run check:memory-router:self-test
npm run check:atlas
```

7. If the router falls below 12KB, consider a follow-up commit that hardens `check-memory-router`.

## Acceptance Criteria

Minimum useful slice:

- `check:agent-wiki` passes.
- `check:memory-router` passes.
- `.claude-memory/MEMORY.md` is smaller than before and preferably below 12KB.
- At least the external reviewer portal / E2E harness routing no longer requires a long operational router line.
- Wiki topic links point to source files and canonical docs, not just memory files.
- Atlas remains the canonical data-layer source; no Atlas facts are duplicated into memory/wiki as fresh truth.

Better slice:

- Add 3-5 wiki topic pages for the current highest-traffic clusters.
- Bring `.claude-memory/MEMORY.md` below the 12KB comfort target.
- Add `check-memory-router` max-line-length and target-byte failure after cleanup.

## Codex Review Focus After Claude's Patch

When Claude sends this back, Codex should check:

1. Did the memory router actually shrink, or were wiki topics added while the router stayed dense?
2. Do new wiki pages have useful `source_files`, `canonical_docs`, `watch_paths`, and `update_triggers`?
3. Does every new wiki topic link to the Atlas when it makes data-layer claims?
4. Did Claude avoid moving live-state truth from Atlas into memory/wiki?
5. Did `check:agent-wiki`, `check:memory-router`, and their self-tests run sequentially?
6. If the gate was hardened, do the self-tests prove the new failure mode?

