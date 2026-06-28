#!/usr/bin/env bash
#
# bootstrap-machine.sh — set up this repo's PER-MACHINE, gitignored state on a
# fresh machine (e.g. syncing to a second computer). Idempotent: safe to re-run;
# it skips anything already correct and never overwrites your data.
#
# Per-machine state does NOT travel with git, so each machine needs it recreated:
#   - .agents/skills                    symlink -> .claude/skills        (Codex reads skills here)
#   - ~/.claude/projects/<slug>/memory  symlink -> <repo>/.claude-memory (Claude auto-memory store)
#   - node_modules                      (npm install)
#   - .env.local                        (SECRETS — provisioned separately, NEVER by this script)
#
# Usage:
#   scripts/bootstrap-machine.sh                 # bootstrap the main repo (the common case)
#   scripts/bootstrap-machine.sh --worktree NAME # also create + bootstrap a sibling Codex
#                                                #   worktree ../<repo>-codex on branch codex/NAME
#
# See docs/PARALLEL_AGENT_WORKTREE_RUNBOOK.md (the workflow) and
# docs/CREDENTIALS_RUNBOOK.md (how to provision .env.local).

set -uo pipefail

# Locate the repo root from the script's own location, so it works regardless of
# the absolute path on this machine (the home and office paths differ).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

echo "Bootstrapping per-machine state for: $REPO_ROOT"

# 1. Codex skills symlink — gitignored, per-machine. Codex runs stale/missing
#    skills without this.
step "1. Codex skills symlink (.agents/skills -> ../.claude/skills)"
if [ -L .agents/skills ] && [ "$(readlink .agents/skills)" = "../.claude/skills" ]; then
  ok "already linked"
elif [ -e .agents/skills ] && [ ! -L .agents/skills ]; then
  warn ".agents/skills exists as a real file/dir (stale copy). Remove it and re-run:"
  warn "    rm -rf .agents/skills"
else
  mkdir -p .agents
  ln -s ../.claude/skills .agents/skills && ok "created"
fi

# 2. Auto-memory store symlink. The slug is the repo's absolute path with '/' and
#    '_' replaced by '-', so it DIFFERS per machine — computed at runtime, never
#    hardcoded.
step "2. Auto-memory store symlink (~/.claude/projects/<slug>/memory)"
SLUG="$(printf '%s' "$REPO_ROOT" | sed 's#/#-#g; s#_#-#g')"
MEM_PARENT="$HOME/.claude/projects/$SLUG"
MEM_LINK="$MEM_PARENT/memory"
MEM_TARGET="$REPO_ROOT/.claude-memory"
if [ -L "$MEM_LINK" ] && [ "$(readlink "$MEM_LINK")" = "$MEM_TARGET" ]; then
  ok "already linked  (slug: $SLUG)"
elif [ -d "$MEM_LINK" ] && [ ! -L "$MEM_LINK" ]; then
  warn "$MEM_LINK is a real directory (diverging memory). Move any unique files into"
  warn "  .claude-memory/, remove that directory, then re-run."
else
  mkdir -p "$MEM_PARENT"
  ln -s "$MEM_TARGET" "$MEM_LINK" && ok "created  (slug: $SLUG)"
fi

# 3. Dependencies.
step "3. npm install"
if npm install; then ok "dependencies installed"; else warn "npm install failed — see output above"; fi

# 4. Secrets — checked, never created here.
step "4. .env.local (secrets — provisioned separately)"
if [ -f .env.local ]; then
  ok ".env.local present"
else
  warn ".env.local is MISSING — it holds secrets and is NOT created by this script."
  warn "Provision it (see docs/CREDENTIALS_RUNBOOK.md):"
  warn "  - securely copy .env.local from your other machine (most reliable), OR"
  warn "  - 'vercel env pull .env.local'  (NOTE: Sensitive vars pull back EMPTY and"
  warn "    must be filled in by hand)."
fi

# 5. Verify the symlink invariants.
step "5. Verify symlink invariants"
if npm run --silent check:agent-invariants; then ok "agent invariants OK"; else warn "check:agent-invariants failed — see above"; fi

# Optional Layer 2 — a Codex worktree (../<repo>-codex on branch codex/NAME).
if [ "${1:-}" = "--worktree" ]; then
  WT_NAME="${2:-}"
  if [ -z "$WT_NAME" ]; then
    warn "--worktree needs a task name, e.g.: scripts/bootstrap-machine.sh --worktree my-task"
    exit 1
  fi
  REPO_NAME="$(basename "$REPO_ROOT")"
  WT_PATH="$(cd .. && pwd)/${REPO_NAME}-codex"
  BRANCH="codex/$WT_NAME"
  step "6. Codex worktree: $WT_PATH  (branch $BRANCH)"
  if [ -d "$WT_PATH" ]; then
    warn "worktree dir already exists — reuse it instead:"
    warn "    git -C '$WT_PATH' fetch origin && git -C '$WT_PATH' checkout -B $BRANCH origin/main"
  else
    git fetch origin
    if git worktree add -b "$BRANCH" "$WT_PATH" origin/main; then
      ok "worktree created on $BRANCH"
      mkdir -p "$WT_PATH/.agents"
      ln -s ../.claude/skills "$WT_PATH/.agents/skills" && ok ".agents/skills linked"
      if [ -f .env.local ]; then
        ln -s "../${REPO_NAME}/.env.local" "$WT_PATH/.env.local" && ok ".env.local linked -> main repo"
      else
        warn ".env.local link skipped (main repo has no .env.local yet)"
      fi
      ( cd "$WT_PATH" && npm install ) && ok "worktree dependencies installed"
    else
      warn "git worktree add failed (branch may already exist?) — see above"
    fi
  fi
fi

step "Done."
[ -f .env.local ] || echo "Reminder: provision .env.local before running the app or live probes."
