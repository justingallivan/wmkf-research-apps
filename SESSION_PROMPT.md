# Session 175 Prompt: finish A7 (Parts 5–6) + verify git after reboot

## Session 174 Summary

Two threads: (1) executed the A7 prompt-injection initiative — Parts 0–4 of 6
shipped; (2) diagnosed a serious local git failure mid-session.

### What Was Completed

1. **A7 plan revised after two Codex reviews** (`e79460a`).
   - Codex found the original plan unsound (forgeable delimiter) and
     incomplete (3 missed call sites, under-scoped schema validation, too-narrow
     gate). All findings folded in. A7's units renamed **Slice → Part** to
     avoid colliding with the schema-deploy "Slice-0" work.

2. **A7 Part 0 — shared primitives + CI gate** (`0a80da5`, `bc51233`).
   - `wrapUntrustedContent` + `buildUntrustedContentPreamble` in
     `lib/utils/ai-payload-boundary.js`: nonce-bearing sentinels on BOTH ends,
     scrubs any sentinel/nonce from inner text → forged-close-resistant.
   - `validateAiJson` in `lib/utils/ai-output-schema.js`: declarative
     validator — drops undeclared keys, enforces types/enums, `coerceEnum`.
   - `check:prompt-injection-tagging` registry gate + self-test (9/9). Every
     LLM-input surface is registered migrated|pending.

3. **A7 Part 1 — grant-reporting/extract proof** (`0a80da5`).
   - All 3 prompts wrap untrusted text + carry the preamble; the
     "AUTHORITATIVE header" amplification vector fixed; output validated
     against `shared/config/grant-reporting-output-schema.js`. Prompt v1→v2.

4. **A7 Part 2 — Dynamics writeback path** (`5bae845`).
   - Executor honours an `untrusted: true` variable declaration → wraps with
     `wrapUntrustedContent` + injects the preamble into the composed system
     prompt. `seed-phase-i-summary-prompt.js` declares `proposal_text`
     untrusted. Legacy `summarize.js` wraps + prepends the preamble directly.

5. **A7 Part 3 — agentic Dynamics Explorer** (`aa0a16d`).
   - Each CRM `tool_result` wrapped; AI export pass wraps record JSON; both
     route-local system prompts hardened.

6. **A7 Part 4 — process-peer-reviews** (`04979f2`).
   - Every reviewer-submitted review wrapped (first length bound on that
     path); both prompt calls carry the preamble.

7. **Local git failure diagnosed.** `git gc`/`fsck`/`repack`/`prune` hang in
   `mmap()` on `.git` loose objects. Cause UNCONFIRMED — likely stale OS links
   after this period's reinstalls; possible cloud-sync File Provider issue
   (revisit only if it persists). End-of-session plan: **reboot** to clear
   stale links. `gc.auto 0` set as interim workaround. See memory
   [[env-broken-git-autogc]].

### Commits (S174, `main`, all pushed)
- `e79460a` A7 plan revision (Codex review)
- `0a80da5` A7 Parts 0–1 — primitives + grant-reporting proof
- `bc51233` A7 Part 0 — check:prompt-injection-tagging gate + self-test
- `5bae845` A7 Part 2 — Dynamics writeback path
- `aa0a16d` A7 Part 3 — agentic Dynamics Explorer
- `04979f2` A7 Part 4 — process-peer-reviews
- (this `/stop`) — Document Session 174 + Session 175 prompt

### Verification status
- 🟢 603 jest pass, `npm run build` green, all doc/structure gates green
  (incl. the new `check:prompt-injection-tagging` 7 migrated / 18 pending).
- 🟢 All A7 commits pushed to `origin/main`.

## Potential Next Steps

### A. FIRST — verify git is healthy after the reboot
Run `git fsck` (or `git gc`). If it completes, the stale-links theory held;
re-enable gc with `git config --unset gc.auto`. If it still hangs, revisit the
cloud-sync angle per memory [[env-broken-git-autogc]] — re-run `sample <pid>`
on a hung git process + `fileproviderctl dump`. Do NOT assert a cause.

### B. A7 Part 5 — remaining U-FILE routes
Per `docs/security-audit/A7_PROMPT_INJECTION_PLAN.md`: #1–#6, #8, #11, #13,
#15, #16, #22. Same pattern — wrap untrusted text with `wrapUntrustedContent`,
prepend `buildUntrustedContentPreamble`, validate JSON sinks with
`validateAiJson`, move the surface to `migrated` in the gate registry.
#8/#11 also need the multimodal preamble (image/document content blocks).

### C. A7 Part 6 — remaining U-EXT routes
#9, #10, #14, #21, #24.

### D. Owed deploy step (A7 Part 2)
Re-run `scripts/seed-phase-i-summary-prompt.js --execute` so the live
`wmkf_ai_prompts` row carries the new `untrusted: true` declaration on
`proposal_text`. Until then the Executor wraps nothing for that prompt.

### E. Slice-0 schema deploy — still parked (destructive carryover, verify first)
Unchanged from prior sessions. Connor field-review + Justin go-ahead pending.

## Gotchas (current)

- 🔴 **Local git gc/fsck/repack/prune hang.** Reboot first (S174 plan). If a
  commit ever fails with `cannot lock ref 'HEAD'`, a hung gc left a stale lock
  — see memory [[env-broken-git-autogc]] for recovery.
- 🟡 **`gc.auto 0` is set** on this repo (interim). Un-set it once git is
  confirmed healthy post-reboot.
- 🟡 **A7 Part 2 deploy owed** — the seed re-run (step D above).
- 🟡 **`docs/INTAKE_PORTAL_ITEM_6_CONNOR_EMAIL.md`** still untracked (pre-S172).
- 🟢 Two memory entries added/used this session: [[env-broken-git-autogc]],
  [[feedback-drive-to-completion]] — in the harness memory store.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/utils/ai-payload-boundary.js` | `wrapUntrustedContent` + preamble (A7 Part 0) |
| `lib/utils/ai-output-schema.js` | `validateAiJson` schema validator (A7 Part 0) |
| `scripts/check-prompt-injection-tagging.js` | A7 coverage gate + registry |
| `shared/config/grant-reporting-output-schema.js` | Part 1 output schemas |
| `docs/security-audit/A7_PROMPT_INJECTION_PLAN.md` | A7 plan — Parts 0–4 done, 5–6 pending |

## Testing

```bash
npm run check:prompt-injection-tagging && npm run check:prompt-injection-tagging:self-test
npx jest                                     # 603 passed as of S174
npm run build                                # green
# A7 standard gate set still applies — see prior SESSION_PROMPT history.

# After reboot — confirm git health:
git fsck            # should complete; if it hangs, see memory env-broken-git-autogc
```
