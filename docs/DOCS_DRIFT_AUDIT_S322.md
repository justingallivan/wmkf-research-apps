---
title: Docs-vs-Code Drift Audit (S322)
domain: repo-hygiene
kind: audit
status: active
summary: Fresh code-first comparison of README, CLAUDE.md, and docs/ claims against actual behavior. Drift table with evidence plus a proposed docs patch. No edits.
---

# Docs-vs-Code Drift Audit — Session 322 (2026-07-03)

Audit-only; nothing was changed. Method: three code-first read-only scans (setup/commands, env vars both directions, architecture/layout) that derived ground truth from source before reading the doc claims, plus main-session re-verification of every load-bearing mismatch. Evidence anchor: commit `1ccb837a`.

**Evidence labels:** [VERIFIED session] = re-checked directly in the main session; [VERIFIED scan] = confirmed by an S322 scan agent with cited evidence.

**Context:** this repo's drift gates (`check:fact-consistency`, `check:doc-currency`, `check:doc-symbol-refs`, `check:atlas`, …) were all green this session, so registered facts are clean. Everything below is drift in *unregistered* claims — exactly the residue the gates don't cover. 47 setup/command claims, 11 architecture claims, and 88 code-read env vars were checked; the table lists only the failures.

## Drift table

| # | Claim | Reality | Evidence | Severity |
|---|---|---|---|---|
| 1 | README says: "Copy `.env.local.example` to `.env.local`" | No `.env.local.example` exists; the file is `.env.example` | `README.md:53` (quote) vs `ls` → only `.env.example` [VERIFIED session] | High — first setup step fails as written |
| 2 | `docs/CI_GATES_REFERENCE.md` names self-test scripts `check:drain-table-mentions-self-test` and `check:prompt-storage-mentions-self-test` (hyphen), in both the table and prose | package.json defines `check:drain-table-mentions:self-test` and `check:prompt-storage-mentions:self-test` (colon); the hyphen form fails with "missing script" | `docs/CI_GATES_REFERENCE.md:201-202,230-231` vs `package.json:49,51` [VERIFIED session — all four locations quoted] | Medium — copy-pasted command fails; every other gate pair in the same doc uses the correct colon form |
| 3 | `.env.example` documents `NOTIFICATION_EMAIL_TO` as a config var (sibling `NOTIFICATION_EMAIL_FROM` in the same block) | `_TO` has zero readers — recipients are admin-configured and category-routed via `lib/services/alert-recipients.js` (see `notification-service.js:140-142`); `_FROM` IS live (`lib/services/notification-service.js:104,133`) and must stay | `.env.example:114-115` vs repo-wide grep [VERIFIED session, both directions] | Low — one dead var; superseded by the Alert Recipients admin mechanism |
| 4 | BILL runtime credentials are implied covered by the credentials runbook | `BILL_BASE_URL`, `BILL_DEV_KEY`, `BILL_ORG_ID`, `BILL_PASSWORD`, `BILL_USERNAME` are read by live code (e.g. `lib/bill/index.js:153`) but appear in neither `.env.example` (zero `BILL_` entries [VERIFIED session]) nor the runbook's env inventory — the runbook documents only the two BILL HMAC secrets (`docs/CREDENTIALS_RUNBOOK.md:371,378` [VERIFIED session]) | [VERIFIED scan + session] | Medium — a fresh environment can't be provisioned for BILL from the docs (mitigated: `BILL_ENABLED` is off in prod) |
| 5 | (implicit) `.env.example` + runbook cover the runtime env surface | 22 more code-read vars are undocumented in both, notably: `REVIEWER_PAGE_EMAIL_TIER_ENABLED` (`lib/services/contact-enrichment-service.js:1170` — the flag enabled in prod 2026-07-03), `BILL_ENABLED`/`BILL_WEBHOOK_DEBUG`/`BILL_WEBHOOK_SECRET`, `BILLCOM_ACCOUNT_*_VALUE` (`lib/bill/option-set-values.js:19`), `DRAIN_BATCH_SIZE`/`DRAIN_LOCK_TTL_SECONDS` (`pages/api/cron/drain-submissions.js:74-75`), `WAVE2_BACKEND_GRANT_CYCLES` (`lib/services/grant-cycles-dataverse.js:22`), `ALLOWED_ORIGINS` (`shared/config/baseConfig.js:106`), `API_SECRET_KEY` (`shared/utils/apiKeyManager.js:12`), `DATABASE_URL` fallback (`lib/services/irs-bmf-service.js:149`), plus `CLAUDE_API_URL`/`CLAUDE_MODEL`/`ENABLE_CACHE`/`ENABLE_LOGGING`/`LOG_LEVEL`/`MOCK_MODE` in `shared/config/baseConfig.js` | [VERIFIED scan; counts: 88 code-read, 66 documented, 61 overlap] | Medium in aggregate — mostly optional tuning vars, but the prod-enabled feature flag being undocumented is the standout |
| 6 | `docs/CREDENTIALS_RUNBOOK.md:231` lists `BLOB_STORE_ID` / `BLOB_WEBHOOK_PUBLIC_KEY` | Removed via `vercel env rm` per the doc's own text — historical note, and correctly framed as such; no live reader | [VERIFIED scan] | Info — no action needed, listed for completeness |
| 7 | CLAUDE.md "Project Shape" tree | Three real top-level dirs are absent: `modules/` (contains `modules/expertise_matching/` with its own README/CLAUDE.md), `outputs/` (reports/decks), `_archived/` (the archive destination appRegistry.js comments point at) | `CLAUDE.md:56-68` vs `ls` [VERIFIED scan] | Low — omission, not contradiction; the tree doesn't claim exhaustiveness |

**Checked and clean:** all CLAUDE.md Development commands; all other ~25 gate names in CI_GATES_REFERENCE; both agent symlinks; all 19 source-of-truth pointer paths; README's stack framing (Next.js 16 Pages Router, NextAuth, Vercel, Dataverse) against package.json and the filesystem; all 16 appRegistry apps resolve to real pages; Postgres+Dataverse dual-storage claims; `BLOB_READ_WRITE_TOKEN` (not read literally in code but correct — it's the `@vercel/blob` SDK's implicit token, per comments at `lib/utils/intake-blob.js:4`) [VERIFIED scan].

## Proposed docs patch

Items 1-3 are mechanical and safe. Items 4-5's `.env.example` additions and item 7's tree additions are included but **need owner confirmation** (which vars belong in the local-dev contract, and whether `outputs/`/`_archived/` are deliberately untreed).

```diff
--- a/README.md
+++ b/README.md
@@ -53 +53 @@
-2. Copy `.env.local.example` to `.env.local` and fill in the values, including
+2. Copy `.env.example` to `.env.local` and fill in the values, including
```

```diff
--- a/docs/CI_GATES_REFERENCE.md
+++ b/docs/CI_GATES_REFERENCE.md
@@ -201,2 +201,2 @@
-| `check:drain-table-mentions` | `check:drain-table-mentions-self-test` |
-| `check:prompt-storage-mentions` | `check:prompt-storage-mentions-self-test` |
+| `check:drain-table-mentions` | `check:drain-table-mentions:self-test` |
+| `check:prompt-storage-mentions` | `check:prompt-storage-mentions:self-test` |
@@ -230,2 +230,2 @@
-- `check:drain-table-mentions` then `check:drain-table-mentions-self-test` (same hazard)
-- `check:prompt-storage-mentions` then `check:prompt-storage-mentions-self-test` (same hazard)
+- `check:drain-table-mentions` then `check:drain-table-mentions:self-test` (same hazard)
+- `check:prompt-storage-mentions` then `check:prompt-storage-mentions:self-test` (same hazard)
```

```diff
--- a/.env.example
+++ b/.env.example
@@ -114,2 +114,2 @@
 NOTIFICATION_EMAIL_FROM=
-NOTIFICATION_EMAIL_TO=
+# (removed: NOTIFICATION_EMAIL_TO — no reader; recipients are admin-configured via lib/services/alert-recipients.js)
+
+# --- Reviewer email tier (prod: enabled 2026-07-03) ---
+# REVIEWER_PAGE_EMAIL_TIER_ENABLED=true
+
+# --- BILL integration (off unless BILL_ENABLED=true; sandbox not provisioned) ---
+# BILL_ENABLED=false
+# BILL_BASE_URL=
+# BILL_USERNAME=
+# BILL_PASSWORD=
+# BILL_DEV_KEY=
+# BILL_ORG_ID=
+# BILL_WEBHOOK_SECRET=
+
+# --- Optional tuning (defaults in code) ---
+# DRAIN_BATCH_SIZE= / DRAIN_LOCK_TTL_SECONDS=  (pages/api/cron/drain-submissions.js)
+# WAVE2_BACKEND_GRANT_CYCLES=                  (lib/services/grant-cycles-dataverse.js)
+# ALLOWED_ORIGINS=                             (shared/config/baseConfig.js)
```
*(hunk content verified against the live file this session — `NOTIFICATION_EMAIL_FROM=` at :114 stays, it has live readers; never copy real values into the example file)*

```diff
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ (Project Shape tree, after "tests/" line) @@
 tests/             Unit and integration tests
+modules/           Self-contained sub-projects (e.g. expertise_matching, own README/CLAUDE.md)
+_archived/         Retired apps/pages moved out of the live tree (see appRegistry.js notes)
```

## Application protocol

1. Re-verify each quoted line live before applying (snapshot at `1ccb837a`).
2. README/CI_GATES fixes are safe to apply directly; run `npm run check:doc-currency` and `npm run check:docs-catalog` after (and `npm run generate:docs-catalog` if frontmatter changes).
3. `.env.example` and CLAUDE.md changes need owner confirmation first; a CLAUDE.md edit additionally requires `npm run check:agent-invariants` and `npm run check:instruction-architecture`.
4. Item 5's full undocumented-var list should be triaged once (runtime contract vs internal tuning) — the runbook is the right home for anything secret-shaped; `.env.example` for local-dev-relevant toggles only.
