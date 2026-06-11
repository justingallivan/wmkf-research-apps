# Session 243 Prompt: Phase 1 private-blob rollout (continue) — after S242's security-audit remediation + Phase 1 start

> ✅ **GIT STATE.** `origin/main` = **`0839cf1`**, local in sync, working tree clean.
> S242 pushed 19 commits (`c67b883..0839cf1`) — all CI gates + builds green at each step.
> Mix of app-runtime changes (Executor transport, blob upload path, file-loader, two
> consumer pages) and docs. No prod cutover happened: Phase 1 ships behind per-app
> flags that default **public**, and the security-remediation phases are merged but the
> user controls deploys (CLI, not git-integration — see Gotchas).

## Session 242 Summary

S242 started by **reviewing a fresh security audit** (3 untracked `docs/security-audit/`
docs that landed 2026-06-11), then drove its remediation plan: completed Phases 2/3/4/7,
and **started Phase 1 (private-blob migration)** — shipping a smoked pilot plus the
file-loader chokepoint and two more consumer migrations. Codex reviewed every design and
the pilot implementation; all findings folded.

### What Was Completed

1. **Security audit reviewed + scanners re-run.** Independently verified the audit's
   findings; re-ran semgrep (the audit machine had a CA failure) — `p/owasp-top-ten`
   surfaced 5 real-but-low findings; re-confirmed npm audit (5 moderate). Amended the
   audit + plan (`c67b883`, `6dd909a`).

2. **Phase 3 — AI data-flow matrix reconcile** (`33518ef`): contact-enrichment was
   migrated to `LLMClient` but `AI_DATA_FLOW_MATRIX.md` still said raw `fetch` in 5 spots.

3. **Phase 4 — route-gate HMAC recognition** (`c81bca7`): `check:api-routes` now
   recognizes `verifyInternalCall`/`verifyBillWebhook` when the matrix documents the
   HMAC boundary; added `check:api-routes:self-test` (wired into `/start` + CI gates ref).

4. **Phase 7 — Semgrep hardening** (`c4142c4`, `429bc39`, `4b7e13e`): GCM `authTagLength`
   pinned in `apiKeyManager.js` + `encryption.js`; `nosniff`/forced-download on the two
   binary proxies; `PoliciesSection` dangerouslySetInnerHTML annotated (already DOMPurify-
   sanitized). OWASP re-scan → 0 findings.

5. **Phase 2 — Executor transport convergence** (`e3ca0f7`): `execute-prompt.js`
   `callClaude()` now uses `LLMClient.complete()` (was raw `fetch`); cache_control system
   array preserved verbatim, response re-shaped to the raw snake_case shape downstream
   reads. No `appName` (avoids double-counting `api_usage_log` vs summarize-v2's logUsage).
   2 new regression tests; 23 Executor tests + build green.

6. **Phase 1 — private-blob migration (STARTED).**
   - **Pilot: `expense-reporter`** (`6df8918`, `dcafaf1`, `d24f9b0`) — `FileUploaderSimple`
     gained an `access` prop; new `lib/utils/uploaded-blob.js` `readUploadedBlobBuffer()`
     reads private blobs server-side by `pathname` (`get(...,{access:'private',token})`),
     legacy public via `safeFetch`. `upload-handler` routes private uploads to a dedicated
     store via `clientPayload`, fails closed (503) without the token. Codex review folded.
   - **Provisioned + SMOKED** (`663b798`, `2fc4d6f`, `832ae16`): created private store
     `wmkf-uploads-private` (`store_WvoDkxrlWniAuJAj`, iad1) + `UPLOADS_BLOB_RW_TOKEN`
     (dev+preview). `scripts/smoke-private-upload.mjs` + a live expense-reporter
     upload→extract PASSED: receipts landed in the private store; URL returns **HTTP 403**.
   - **`file-loader.js` made private-aware** (`747376d`): its upload branch delegates to
     `readUploadedBlobBuffer` — the read chokepoint for its Dynamics callers. New unit test.
   - **Two more consumers migrated** (`e79a38e`, `0839cf1`): `phase-i-dynamics` and
     `grant-reporting` — uploader `access` flag-gated, fileRefs carry `pathname`+`access`,
     routes already pass full refs to `loadFile`. Back-compat (flag off = unchanged).

### Codex reviews (all folded)
- Phase 1/2 designs → REVISE: fixed an `onBeforeGenerateToken`-can't-set-access SDK
  error, the `api_usage_log` double-count, and `EXECUTOR_CONTRACT.md` staleness.
- Phase 1 pilot impl → REVISE: the **dedicated private store/token** blocker (public
  token can't serve private blobs) + documented the staff-shared ownership model.

### Commits (19, chronological): `c67b883` → `6dd909a` → `33518ef` → `c81bca7` →
`c4142c4` → `429bc39` → `4b7e13e` → `54c0270` → `8379a87` → `e3ca0f7` → `6df8918` →
`dcafaf1` → `d24f9b0` → `663b798` → `2fc4d6f` → `832ae16` → `747376d` → `e79a38e` → `0839cf1`

## Potential Next Steps

### 1. Promote the smoked work to production (USER-run, low-risk)
- **expense-reporter** is fully smoked. To go live: `vercel env add UPLOADS_BLOB_RW_TOKEN production` + `vercel env add NEXT_PUBLIC_EXPENSE_REPORTER_PRIVATE_BLOB production` (=true) + `vercel deploy --prod`.

### 2. Smoke phase-i-dynamics + grant-reporting (then promote)
Same recipe as the expense smoke: set their `NEXT_PUBLIC_*_PRIVATE_BLOB` flags in
dev/preview, upload a doc, confirm extraction + private (reuse `vercel blob list --rw-token`
+ `curl` → 403). Flags: `NEXT_PUBLIC_PHASE_I_DYNAMICS_PRIVATE_BLOB`,
`NEXT_PUBLIC_GRANT_REPORTING_PRIVATE_BLOB`.

### 3. Download proxy (the remaining Phase 1 *infra*)
Browser-render consumers (review-email templates/attachments via `proxifyBlobUrl` /
`blob-proxy.js`) need a NEW record/app-scoped authenticated download proxy (nosniff +
attachment) — do NOT extend `blob-proxy.js` (org-asset-only). Then migrate those consumers.

### 4. Remaining FileUploaderSimple consumers + deferred Codex follow-ups
Other server-read consumers can be migrated with the same 3-edit pattern. Deferred:
route-level `process-expenses` private test; optional per-uploader pathname binding
(currently documented staff-shared, app-scoped, matching `download-review.js`).

### 5. Carryover from earlier (still open)
Reviewer COI Chunk 2b (retire `POTENTIAL_CONCERNS`) was the originally-queued S242 build,
deferred again — see `docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md §6`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/utils/uploaded-blob.js` | `readUploadedBlobBuffer({access,pathname,url})` — shared private/public blob read chokepoint |
| `lib/utils/file-loader.js` | Now private-aware (upload branch → `readUploadedBlobBuffer`) |
| `pages/api/upload-handler.js` | Routes private uploads to the private store via `clientPayload`; fail-closed 503 |
| `shared/components/FileUploaderSimple.js` | `access` prop; descriptor returns `pathname`+`access` |
| `scripts/smoke-private-upload.mjs` | One-command private store/token smoke (PUT/GET/403/cleanup) |
| `lib/services/execute-prompt.js` | `callClaude()` now via `LLMClient.complete()` (Phase 2) |
| `scripts/check-api-route-security-matrix.js` (+ `-self-test`) | HMAC guard recognition (Phase 4) |
| `docs/security-audit/PHASE_1_PRIVATE_BLOB_DESIGN_2026-06-11.md` | Authoritative Phase 1 what-shipped + status |
| `docs/security-audit/SECURITY_AUDIT_REMEDIATION_PLAN_2026-06-11.md` | Per-phase status (2/3/4/7 done; 1 in progress) |

## Gotchas / continuity
- **Vercel = CLI deploys, NO git integration** (`.vercel/project.json` has no gitRepo
  link; all deploys are hash URLs). Pushing a branch does NOT build a preview, and CLI
  hash URLs fail Azure AD redirect. To smoke auth-gated changes: run **localhost**
  (`http://localhost:3000` callback is registered) or add the exact preview URL to Azure.
- **`UPLOADS_BLOB_RW_TOKEN` is a SENSITIVE Vercel var** → `vercel env pull` returns it
  EMPTY. Pass the token on the command line for the smoke. (cf. `project-vercel-sensitive-env-pull-empty`.)
- **Private blobs use a DEDICATED store/token**, never the public `BLOB_READ_WRITE_TOKEN`
  (public token can't serve private — fails at the Blob API). See `CREDENTIALS_RUNBOOK.md`.
- Each migrated app is flag-gated **default public** → prod is unchanged until you set the
  flag. The read path handles both modes, so the flag only governs new uploads.

## Testing
```bash
# Phase 1 helpers + consumers:
npx jest tests/unit/utils/uploaded-blob.test.js tests/unit/utils/file-loader.test.js --runInBand
npx jest tests/integration/grant-reporting-extract-routes.test.js tests/integration/phase-i-dynamics-summarize-v2-payload-boundary.test.js --runInBand
UPLOADS_BLOB_RW_TOKEN='vercel_blob_rw_…' node scripts/smoke-private-upload.mjs   # private store smoke
# Phase 2 Executor:
npx jest tests/unit/execute-prompt-payload-boundary.test.js --runInBand
# Gates: npm run build && npm run lint ; full startup set: see .claude/skills/start
```
