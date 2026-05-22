# Session 176 Prompt: A7 Parts 5–6 (from the new repo location)

## ⚠️ Read first — the repo moved

Work now happens from **`~/Code/WMKF_Apps`** (this clone). The old copy at
`~/Documents/Programming/Claude_Projects/WMKF_Apps` is **abandoned** — its `.git`
is on a cloud-synced path and `git fsck`/`gc` hang there. Justin will delete it
once a clean session from here is confirmed. Do not work in the old copy.

## Session 175 Summary

Session 175 diverted entirely from A7 to diagnose and fix a root-cause
infrastructure failure. A7 Parts 5–6 were **not touched** and remain the work.

### What Was Done (infrastructure fix)

1. **Diagnosed the `git fsck`/`gc` hang.** Cause CONFIRMED: the repo lived under
   `~/Documents`, which a cloud File Provider (OneDrive Folder Backup / Google
   Drive) managed in place — it offloaded cold `.git` loose objects to macOS
   `dataless` placeholders, so any full-object-walk command blocked in `mmap()`
   downloading them. The S174 reboot did NOT fix it, disproving the
   "stale OS links" theory. See memory [[env-broken-git-autogc]].

2. **Reconciled the memory store.** The git-tracked `.claude-memory/` store and
   the per-machine harness store had diverged (11 recent entries lived only in
   the harness store). Merged all 11 in, renamed every entry snake→kebab-case,
   collapsed the obsolete memory-propagation entries into `memory-store-propagation.md`.
   82 entries, all links verified. Commit `988f17b`.

3. **Moved the repo off the cloud path.** Fresh clone to `~/Code/WMKF_Apps`.
   `git fsck` here = 0.165s (vs. infinite hang in the old copy). Local-only
   files carried over; `npm install` done.

4. **Consolidated memory via symlink.** `~/.claude/projects/<slug>/memory` →
   `~/Code/WMKF_Apps/.claude-memory`, so harness memory writes are git-tracked
   and propagate. Added a drift-detection check to the `/start` skill. Commit
   `90ab31e`.

### Commits (S175, `main`, pushed)
- `988f17b` Reconcile memory into a single git-tracked kebab-case store
- `90ab31e` Add memory-store consolidation check to /start skill
- (this `/stop`) — Session 176 prompt

### Work-machine (other Mac) setup
A setup checklist was drafted (clone off-cloud → create memory symlink →
`vercel env pull .env.local` → `npm install` → `/start`). The symlink step is
required and per-machine — `/start` will flag if it's missing.

## Potential Next Steps — A7 Parts 5–6 (the real pending work)

Per `docs/security-audit/A7_PROMPT_INJECTION_PLAN.md`. Parts 0–4 shipped in
S174. Same pattern for each surface: wrap untrusted text with
`wrapUntrustedContent`, prepend `buildUntrustedContentPreamble`, validate JSON
sinks with `validateAiJson`, move the surface to `migrated` in the
`check:prompt-injection-tagging` registry.

### A. A7 Part 5 — remaining U-FILE routes
Routes #1–#6, #8, #11, #13, #15, #16, #22. #8/#11 also need the multimodal
preamble (image/document content blocks).

### B. A7 Part 6 — remaining U-EXT routes
Routes #9, #10, #14, #21, #24.

### C. Owed deploy step (A7 Part 2)
Re-run `scripts/seed-phase-i-summary-prompt.js --execute` so the live
`wmkf_ai_prompts` row carries the `untrusted: true` declaration on
`proposal_text`. Until then the Executor wraps nothing for that prompt.

### D. Slice-0 schema deploy — still parked
Destructive carryover; verify before acting. Connor field-review + Justin
go-ahead pending. See memory [[slice0-deactivate-not-delete-recalc]].

## Gotchas (current)

- 🟢 Git is healthy in this clone — `gc.auto` is default, `fsck` fast.
- 🟡 The old `~/Documents` copy still exists with `gc.auto 0` set — harmless,
  delete it after a clean session here.
- 🟡 **A7 Part 2 deploy owed** — the seed re-run (step C).
- 🟢 Memory is consolidated: `.claude-memory/` is the single store, kebab-case,
  committed by `/stop`. `/start` Step 1.5 verifies the symlink.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/utils/ai-payload-boundary.js` | `wrapUntrustedContent` + preamble (A7 Part 0) |
| `lib/utils/ai-output-schema.js` | `validateAiJson` schema validator (A7 Part 0) |
| `scripts/check-prompt-injection-tagging.js` | A7 coverage gate + registry |
| `docs/security-audit/A7_PROMPT_INJECTION_PLAN.md` | A7 plan — Parts 0–4 done, 5–6 pending |

## Testing

```bash
npm run check:prompt-injection-tagging && npm run check:prompt-injection-tagging:self-test
npx jest                                     # 603 passed as of S174
npm run build                                # green
```
