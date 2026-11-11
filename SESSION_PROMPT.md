# Session 674 Prompt: Shared pre-flight prompts and proposal caching

## Session 673 Summary (Codex, 2026-11-10)

Owner requested stopping discovery and resuming architecture planning/building next session.
Detailed decisions, spreadsheet inventory, source evidence, live Admin edits, and proposed phases:
`docs/plans/PREFLIGHT_PROMPTS_HANDOFF_2026-11-10.md`.

Docs destination and resume branch: `codex/coordinated-start-2026-11-10-b`.
No runtime changes or main promotion. Complete preceding handoff is preserved at
`git show 33a233633:SESSION_PROMPT.md`; read it for other streams' constraints before acting.
Session numbering is local to this branch; reconcile concurrent numbering on any later merge.

### Completed

- Saved workbook H:Q preflight field requirements, Flags/List caveats, and existing prompt analogs in the linked handoff.
- Production Admin: adapted PD expertise prompt v1 stored under Pre-flight, unconnected; short-title v2 set to Sonnet 5.5 / 4096 tokens and moved to Pre-flight. UI readbacks verified then; re-read before edits.
- Verified Executor caches system instructions, not proposal user text; 22 mocked boundary/transport tests pass. No paid model runs.
- Owner selected PA triggering one backend Executor, replacing the earlier proposed PA-native executor direction. Architecture remains planned, not built.

## Next Items

### Verified Open

1. Refine the opt-in task/profile contract, Admin editing design and document-cache composition. Evidence: current composeMessages/callProvider/applyVariableBoundaries in `lib/services/execute-prompt.js`; linked handoff records gaps.
2. Design authenticated PA submission/status and durable retry/writeback contract after checking existing job infrastructure and Atlas. No generic endpoint was built here.
3. Discuss Executive Summary wording/audience with Justin, using Phase I Writeup Draft's 150–200-word summary section. Chairs sharing is changing. Then discuss remaining workbook prompts individually.

### Parked / Owner Decisions

- PD assignment integration waits for roster readiness; stored prompt is unconnected.
- Exact document inputs, destinations, controlled keyword lists, audiences, and rerun policy need discussion before implementation.
- Native JSON schemas can invalidate shared caches; preserve validation and test actual reuse before claiming savings.

### Do Not Reopen Without New Decision

- One backend Executor for app and PA; no duplicated PA Anthropic executor.
- Legible task instructions separate from shared security/cache machinery.
- No automatic reruns/flags on file replacement (inherited J27 constraint); snapshots apply when a run is explicitly initiated.
- No main runtime promotion, paid tests, environment changes, fixture cleanup or unrelated work authorized by this handoff.

## Concurrent streams — inherited, not freshly audited

| Stream | Last worked by | Resume in | Read first | First step |
|---|---|---|---|---|
| **A. J27 cycle page and request page** | Claude, Session 672 (2026-11-10) | `/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model`, checked out on `claude/j27-cycle-page` at `0bfca223d`, pushed. `claude/j27-read-model` (the sandbox Preview branch) is at `393da5dde`, two documentation commits behind | Stream A below; alignment log D53 to D61 on the branch | Give the sandbox test requests J27-shaped files (Stream A, Verified Open 1) |
| **B. Expertise roster** | Codex, Session 670 | `codex/expertise-roster-foundation-2026-11-09` at `1aedcb25d`, pushed (unverified work in progress; last verified foundation `d2b467e84`). Recorded worktree `/private/tmp/wmkf-codex-isolated-start-2026-11-09` | Stream B below; `docs/plans/EXPERTISE_ROSTER_HANDOFF_2026-11-09.md`, which is the authoritative resume boundary | Review and test the work in progress before extending it |
| **C. Request narratives** | Codex, Session 669 | `codex/request-narratives-2026-11-09` at `06e1ba6a4`, pushed and verified. Recorded worktree `/private/tmp/wmkf-request-narratives` | Stream C below; `docs/plans/REQUEST_NARRATIVES_HANDOFF_2026-11-09.md` | Power Automate initialization contract with Connor, then the J27 integration review |


The table is a dated index from `33a233633:SESSION_PROMPT.md`, not current authorization or live branch verification. Full constraints, other streams (Factory/reports), preservation rules and unresolved decisions remain retrievable at that exact Git reference. Do not switch or modify their worktrees.

## Testing and close

- Startup: 72 gates/self-tests passed sequentially in this worktree earlier this session.
- Focused Executor suite: 22 tests passed; provider behavior untested live.
- Claim-evidence report unavailable; no row invented. Memory router unchanged.
- No DEVELOPMENT_LOG entry required: architecture not shipped; only prompt/config edits in Admin.
- CLAUDE.md unchanged. Documentation-only commit and push on this branch; see Git log for the handoff commit.
