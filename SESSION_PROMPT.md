# Session 174 Prompt: security-audit A7 execution + P2 private-blob migration

## Session 173 Summary

Two threads: (1) repaired the local dev environment, which had been silently
running under x86_64 emulation; (2) shipped the next four security-audit items
(A4, A5, A6, A8) plus a Codex-found A6 follow-up, and produced the A7 plan.

### What Was Completed

1. **Local dev environment fixed (Rosetta → native arm64).**
   - Root cause of the S172 "jest/build hang": the toolchain was running
     x86_64 under Rosetta, and `node_modules` was corrupt from killed
     `npm install` runs. Not the Terminal "Open using Rosetta" checkbox and
     not tmux — exact trigger not pinned, but the fix is arch-independent.
   - Fix: reinstalled Node via arm64 Homebrew (**Node 26.0.0** at
     `/opt/homebrew/bin/node`), reinstalled global CLIs, `rm -rf node_modules
     && npm ci`. jest now runs (565 passed / ~3s), `npm run build` green.
   - Standalone guide written for the work Mac: `~/Documents/Mac_ARM64_Migration_Guide.md`
     (outside the repo). See memory [[local-jest-build-environment]].

2. **A6 — rate-limit `/api/external/review/[token]/*`** (`e0bc12b`).
   - New `lib/external/rate-limit.js`: Postgres-backed fixed-window (60s)
     counters, per-token (30/win) + per-IP (120/win); 429 + `Retry-After`.
     Invalid-token-spike → deduplicated `system_alerts` row.
   - New table `external_rate_limit` (migration `010` + `schema.sql` + v31 in
     `setup-database.js`). Wired into all 4 token routes.

3. **A6 follow-up — degraded-limiter alert** (`55a01a9`, from Codex review).
   - The limiter fails open on a Postgres error (correct), but did so
     silently. Now: 5 consecutive limiter DB failures raise a deduplicated
     `external-rate-limit-db-degraded` `system_alerts` entry.

4. **A4 — `EXTERNAL_LINK_SECRET` dual-secret rotation window** (`3083d6d`).
   - `verifyToken` retries against optional `EXTERNAL_LINK_SECRET_PREVIOUS`;
     `mintToken` always uses the current secret.
   - `scripts/drill-external-link-secret-rotation.mjs` + runbook section.

5. **A5 — upload-endpoint consolidation** (`8b09d84`).
   - ⚠️ **The S173 carryover for A5 was INVERTED.** Verified live state:
     `/api/upload-handler` is the secure primary (used by `FileUploaderSimple`
     across 15+ apps + `review-manager`); `/api/upload-file` was the legacy
     one, called only by `SettingsModal`. Migrated `SettingsModal` →
     `upload-handler`, retired `/api/upload-file`. Route count 86 → 85.
   - **A5 only PARTIALLY closes audit P2** — both paths still write
     `access:'public'` blobs. The genuine fix is tracked in
     `docs/security-audit/P2_PRIVATE_BLOB_MIGRATION.md`.

6. **A8 — `npm audit`** (`46a8090`). 9 → 5 moderate, 0 high/critical.
   The remaining 5 only have breaking-major `--force` fixes — left accepted.

7. **A7 — prompt-injection inventory + plan** (`adf8df5`). No code; full
   inventory of ~20 LLM-input surfaces + 6-slice remediation plan in
   `docs/security-audit/A7_PROMPT_INJECTION_PLAN.md`.

### Codex review

All four shipped items (A4/A5/A6/A8) were reviewed by Codex (run via
`codex exec` in the foreground — the background/subagent launch hangs
silently; use foreground). Codex found no correctness/security bug; the one
gap it flagged (silent fail-open) is item 3 above.

### Commits (S173, `main`)

- `e0bc12b` A6 — rate-limit external-reviewer token routes
- `3083d6d` A4 — EXTERNAL_LINK_SECRET dual-secret rotation window
- `8b09d84` A5 — consolidate upload endpoints, retire /api/upload-file
- `46a8090` A8 — npm audit fix (non-breaking)
- `55a01a9` A6 follow-up — degraded-limiter alert
- `adf8df5` A7 — prompt-injection inventory + remediation plan
- (this `/stop`) — Document Session 173 + Session 174 prompt

### Verification status

- 🟢 jest 565 passed; `npm run build` green; all 13 doc/structure CI gates green.
- 🟢 Local jest + build work again (env fixed) — CI no longer the only option.
- 🔴 **Deploy step owed for A6:** the `external_rate_limit` table must be
  created — `node scripts/setup-database.js` (idempotent) against dev + prod,
  or via the deploy's setup-database run. A6's routes fail-open until then, so
  not a hard outage, but rate limiting is inert until the table exists.

## Potential Next Steps

### A. SECURITY-AUDIT — A7 execution (the planned big one)
Execute `docs/security-audit/A7_PROMPT_INJECTION_PLAN.md`. Start with
**Slice 0** (shared `wrapUntrustedContent` helper + output-schema validator
primitive + the recommended `check:prompt-injection-tagging` gate) then
**Slice 1** (`grant-reporting/extract` as the proof — it has an amplification
bug). Slices 2–5 follow. Initiative-sized; Slices 0–1 are one session.

### B. SECURITY-AUDIT — P2 private-blob migration
`docs/security-audit/P2_PRIVATE_BLOB_MIGRATION.md`. Migrate the generic
uploader to `access:'private'` blobs + an authenticated download proxy across
15+ consuming apps. Its own initiative; sequence after or alongside A7.

### C. SLICE-0 SCHEMA DEPLOY — still parked (destructive carryover, pre-flight verify)
Unchanged from S169–S173. Justin go-ahead + Connor review-of-
`SLICE0_FIELD_REVIEW.md` still pending. Pre-flight probes must be CLEAR at
deploy time. No autonomous action.

### D. CONNOR P4 / FIELD-REVIEW — passive watch. Unchanged.
### E. ENV-0 — Other-Mac memory propagation still unverified. The work Mac
also needs the arm64 migration (`~/Documents/Mac_ARM64_Migration_Guide.md`).
### F. Cross-cycle Reviewer Finder dedup — observed-only. Unchanged.

## Calendar Checkpoints (soft — report factually, not "overdue")
- **2026-05-26** slice-0 dry-run / Connor field-review window.
- **2026-05-30** slice-0 go/no-go.
- **2026-06-01** external-reviewer pilot opens — A6 rate limiting has landed;
  **ensure `external_rate_limit` is deployed before this date.**
- **≥2026-07-01** post-pilot drain-table drop.

## Gotchas (current)

- 🔴 **A6 deploy step owed** — `external_rate_limit` table (see above).
- 🟡 **A5 carryover was inverted** — the *now-corrected* fact: `upload-handler`
  is the live primary, `upload-file` is retired. Do not re-trust any stale
  note that says otherwise.
- 🟡 **Codex background launch hangs silently.** Use `codex exec "<prompt>"`
  in the foreground (synchronous, visible). Confirmed working at 0.133.0.
- 🟢 **Local env fixed** — Node 26 arm64 via Homebrew; jest/build run locally.
  Node 26 is newer than Vercel's Node 24 LTS default; if a dep ever breaks,
  `brew install node@24 && brew unlink node && brew link node@24`.
- 🟡 **`docs/INTAKE_PORTAL_ITEM_6_CONNOR_EMAIL.md`** still untracked (pre-S172).
  Decide: commit or discard.
- 🟢 AGENTS.md symlink intact; repo out of iCloud.
- 🔴 All slice-0 gotchas still hold (destructive-carryover classification,
  Connor field-review + Justin go-ahead gate `--execute`).

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/external/rate-limit.js` | A6 — rate limiter + degraded-limiter alert |
| `lib/db/migrations/010_external_rate_limit.sql` | A6 table (needs deploy) |
| `lib/services/external-token.js` | A4 — dual-secret verify (`verifyToken`) |
| `scripts/drill-external-link-secret-rotation.mjs` | A4 — rotation drill |
| `pages/api/upload-handler.js` | The single surviving upload route (A5) |
| `docs/security-audit/A7_PROMPT_INJECTION_PLAN.md` | A7 inventory + 6-slice plan |
| `docs/security-audit/P2_PRIVATE_BLOB_MIGRATION.md` | P2 residual initiative |
| `docs/CREDENTIALS_RUNBOOK.md` | A4 — "Rotating EXTERNAL_LINK_SECRET" |

## Testing

```bash
# 13 sequential gates (run in order, never parallel — all green as of S173):
npm run check:atlas && npm run check:atlas:self-test && \
npm run check:doc-currency && npm run check:doc-currency:self-test && \
npm run check:api-routes && \
npm run check:fact-consistency:self-test && npm run check:fact-consistency && \
npm run check:canonical-pointers:self-test && npm run check:canonical-pointers && \
npm run check:drain-table-mentions:self-test && npm run check:drain-table-mentions && \
npm run check:prompt-storage-mentions:self-test && npm run check:prompt-storage-mentions

npx jest                                     # 565 passed as of S173
npm run build                                # green
node scripts/drill-external-link-secret-rotation.mjs   # A4 rotation drill

# Quick invariants:
test -L AGENTS.md && readlink AGENTS.md      # must be: CLAUDE.md
git rev-parse HEAD && git status --porcelain
```
