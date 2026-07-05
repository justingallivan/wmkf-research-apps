---
name: start
description: Start a new session by reviewing SESSION_PROMPT.md and CLAUDE.md
allowed-tools: Read, Bash(git status, git fetch:*, git pull:*, git rev-parse:*, git log:*, npm run check\:*, readlink:*, ls:*, pwd)
---

# Session Start

Start a new coding session with proper git sync and context loading.

## Step 1: Git Housekeeping

Before reading any files, sync the repo: `git rev-parse HEAD` (fails → repo may be
corrupted, see CLAUDE.md for recovery), `git fetch origin && git status`, pull if
behind (`git pull origin main`; merge conflicts → stop and alert the user).

If there are uncommitted changes, warn the user — they may be leftover from a
previous session; ask whether to commit, stash, or discard them.

## Step 1.5: Verify the memory store is consolidated

Durable memory lives in the git-tracked `.claude-memory/` directory. The harness
auto-memory feature writes to `~/.claude/projects/<slug>/memory/`, where `<slug>`
is the repo's absolute path with `/` and `_` replaced by `-`. That path MUST be a
symlink into `.claude-memory/`, or memory silently diverges per-machine (see the
`memory-store-propagation` memory entry).

Check it:
```bash
SLUG=$(pwd | sed 's#/#-#g; s#_#-#g')
readlink "$HOME/.claude/projects/$SLUG/memory"
```

- If `readlink` prints a path ending in `/.claude-memory` → consolidated, good.
- If it prints nothing AND `~/.claude/projects/$SLUG/memory` is a **regular
  directory** → memory is diverging. STOP and report: the symlink must be
  (re)created before any memory is written this session. Recreate with:
  `ln -s "<repo>/.claude-memory" "$HOME/.claude/projects/$SLUG/memory"` (move any
  unique entries out of the regular dir first).
- If neither path exists yet → first session at this path; create the symlink.

This is per-machine and breaks whenever the repo moves (the slug changes).
Never put `.git` or the working tree in a cloud-synced folder (iCloud / OneDrive
Folder Backup / Google Drive mirror) — it offloads `.git` objects to placeholders
and hangs `git fsck`/`gc`.

## Step 1.6: Verify the Codex skills symlink

Claude Code reads skills from `.claude/skills/` (git-tracked); **Codex** reads
them from `.agents/skills/`. To keep ONE source of truth and stop Codex from
running stale/missing skills, `.agents/skills` MUST be a symlink to
`.claude/skills`. `.agents/` is gitignored, so this symlink is **per-machine** —
it does not travel with git and must exist on each machine (S221: Codex was
running May-22 copies that lacked `sweep`).

Check it:
```bash
readlink .agents/skills
```

- If it prints `../.claude/skills` → good, Codex sees the live skills.
- If it prints nothing AND `.agents/skills` is a **regular directory** → it's a
  stale per-machine copy. Replace it (back up first if unsure):
  `rm -rf .agents/skills && ln -s ../.claude/skills .agents/skills`
- If `.agents/skills` doesn't exist → `mkdir -p .agents && ln -s ../.claude/skills .agents/skills`

Do NOT run the `migrate-to-codex` skill to populate `.agents/` — it writes a
corrupted `s/Claude/Codex/` copy and severs the `AGENTS.md` symlink (see CLAUDE.md
header). The symlink above is the only sanctioned way to share skills with Codex.

## Step 2: Run rubric-enforcement gates

Before reading any session context, run the project's CI gates to surface rubric violations *before* doing other work. A red gate is a violation of the ground-truth rule (`docs/CLAUDE_REMEDIATION_PLAN.md` + CLAUDE.md "Ground-truth requirement"), regardless of which session caused it.

Run **every** `check:*` gate, not a subset. Run each gate and its `:self-test` **sequentially, never in parallel** — the self-tests write synthetic fixtures into paths the main gate scans (CLAUDE.md "Operating rules"). The `&&` below pairs each gate with its self-test so a red gate skips its own self-test but the next gate still runs:
```bash
npm run check:migrations-manifest                                              # migrations-manifest ↔ on-disk .sql files
npm run check:agent-invariants                                                # local symlinks for CLAUDE/AGENTS and Codex skills
npm run check:agent-invariants:ci                                             # tracked symlink invariant for CI
npm run check:instruction-architecture                                        # CLAUDE.md/AGENTS.md invariants + lifecycle hooks + fresh-install guard
npm run check:api-routes && npm run check:api-routes:self-test                 # API route security matrix coverage (+ HMAC guard recognition)
npm run check:atlas && npm run check:atlas:self-test                           # Application State Atlas coverage
npm run check:doc-currency && npm run check:doc-currency:self-test             # doc-currency drift (was red & unnoticed ~8 sessions)
npm run check:fact-consistency && npm run check:fact-consistency:self-test     # registered scalar drift across docs/memory
npm run check:canonical-pointers && npm run check:canonical-pointers:self-test # anchor rot in CANONICAL_COUNTS pointers
npm run check:docs-catalog                                                     # generated docs/DOCS_CATALOG.md in sync with top-level docs frontmatter (no self-test)
npm run check:drain-table-mentions && npm run check:drain-table-mentions:self-test       # stale "lives in PG" claims for drain tables
npm run check:prompt-storage-mentions && npm run check:prompt-storage-mentions:self-test # stale wmkf_prompt_template refs (was red & unnoticed ~1 session)
npm run check:doc-symbol-refs && npm run check:doc-symbol-refs:self-test           # dangling repo path refs in memory/wiki (renamed/removed code, docs lag); primary trigger is CI-on-push
npm run check:build-claim-freshness && npm run check:build-claim-freshness:self-test # stale "planned/not-built" claims whose cited path now EXISTS (complement of doc-symbol-refs); primary trigger is CI-on-push

npm run check:prompt-injection-tagging && npm run check:prompt-injection-tagging:self-test # A7 prompt-injection surface markers
npm run check:memory-router && npm run check:memory-router:self-test           # MEMORY.md router shape + valid statuses/links
npm run check:model-registry && npm run check:model-registry:self-test         # Anthropic model capability/pricing registry parity
npm run check:model-override-warming && npm run check:model-override-warming:self-test # API routes that resolve an LLM model must call loadModelOverrides() first
npm run check:agent-wiki && npm run check:agent-wiki:self-test                 # agent retrieval-layer structure
npm run check:status-enum-parity && npm run check:status-enum-parity:self-test # producer↔consumer key parity (status/enum/workRemaining vs label/bucket maps)
npm run check:trust-boundary-guid && npm run check:trust-boundary-guid:self-test # client-supplied id → Dataverse selector must be GUID-validated (also a blocking commit guard)
npm run check:dataverse-access-layer && npm run check:dataverse-access-layer:self-test # raw DynamicsService access ratchet; line-tolerant allowlist counts
npm run check:odata-escape && npm run check:odata-escape:self-test            # hand-rolled OData single-quote escapes must route through odata.escape (sequential pairing, same convention as the gates above)
npm run check:dynamics-context-boundary && npm run check:dynamics-context-boundary:self-test # bypassDynamicsRestrictions import boundary + empty-restrictions withDynamicsContext + script-only-outside-scripts (LAW mode, S333 bypass-strip Stage 3)
npm run check:route-lifecycle-auth && npm run check:route-lifecycle-auth:self-test # ROUTE_NAMESPACE_LIFECYCLE.guardAppKeys must match each route's real requireAppAccess args (fail-closed)
npm run check:route-service-boundary && npm run check:route-service-boundary:self-test # pages/api routes reaching Dataverse adapters/dynamics-service directly (LAW mode since Route→Service Stage 7; no baseline)
npm run check:secret-scan && npm run check:secret-scan:self-test              # no real secret-shaped values in tracked files (GHAS-free push protection)
npm run check:scaffolding-tokens && npm run check:scaffolding-tokens:self-test  # no leaked tool-call scaffolding tags (bare-line </content>/</invoke>/antml:*) in tracked files
npm run check:harness-framing && npm run check:harness-framing:self-test        # active harness wording stays expert/procedural; rationale lives in sidecars/backups
npm run check:memory-drift:no-write                                            # advisory: memory↔code drift (read-only)
```

**This list is the full set as of 2026-07-05. Before running, `grep '"check:' package.json` — if a `check:*` script exists that is NOT above (and is not a `:self-test` of one already listed), run it too and add it here.** That keeps the list from silently going stale as gates are added. Skip silently only if NONE of these scripts is defined (not every project has them); do not skip a gate that IS defined.

**If any gate is red:** report it as the FIRST thing in the Step 4 summary, before recapping the previous session. A red gate is a P0 blocker for any new feature work in the affected area (data layer for `check:atlas`, API routes for `check:api-routes`, docs/memory drift for the rest), regardless of which session caused it. Treat fixing it as a candidate first task, not a side-note.

## Step 3: Load Context

Read the following files to get context for this session:

1. **SESSION_PROMPT.md** - Previous session summary and potential next steps
2. **CLAUDE.md** - Project documentation and conventions

## Step 4: Present Summary

After completing the above:
- **First, report any red CI gate from Step 2** as a P0 blocker — name the gate, what it's complaining about, and propose fixing it before other work.
- Report git sync status (up to date, pulled N commits, or any issues)
- Summarize what was accomplished in the previous session
- List the potential next steps from SESSION_PROMPT.md
- Note any uncommitted changes that need attention
- Ask what the user would like to work on this session

## Step 5: Treat destructive carryover items as unverified

When summarizing "next steps" or "pivot to" sections from SESSION_PROMPT.md, flag any item that says **drop**, **remove**, **retire**, **archive**, **delete**, or **deprecate** infrastructure as **unverified-until-checked**, NOT as a green-lit task. These items have inherited from prior sessions and may have gone stale.

If the user asks to act on one, do a pre-flight verification first:
1. Grep for live callers of the thing being removed.
2. Read the most likely callers to confirm they're not load-bearing.
3. If anything looks live, stop and report back before touching anything.

This rule exists because on 2026-05-03 a "drop dormant Postgres reviewer tables" carryover item was about to be acted on; the tables were actually load-bearing for the live Reviewer Finder app. The rule does NOT apply to additive work.
