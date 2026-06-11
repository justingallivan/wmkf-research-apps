---
name: project-download-proxy-parked
description: The record-scoped private-blob download proxy is built but PARKED (not smoked/promoted) — its only consumer is legacy; kept as a reusable pattern for future Postgres-backed private storage.
metadata: 
  node_type: memory
  type: project
  status: active
  originSessionId: 708289ea-ea51-4981-8bad-646e820059d9
---

The Phase-1 **record-scoped private-blob download proxy** (`pages/api/reviewer-finder/cycle-material.js`, gated `requireAppAccess('reviewer-finder','reviewers')`) is **code-complete + Codex-reviewed** (no record-scope bypass; slice-2 findings folded + verified) but **PARKED 2026-06-11**: not e2e-smoked, not promoted. It stays flag-gated default-public (`NEXT_PUBLIC_REVIEWER_FINDER_PRIVATE_CYCLE_MATERIALS`), so it is **inert in production** — public behavior unchanged. Shipped commits: `e6e5d22`, `9f9eaba`, `b6ea150`, `29deab3`, `b0316be`. Design: `docs/security-audit/DOWNLOAD_PROXY_DESIGN_2026-06-11.md`.

**Why:** its only consumer is the reviewer-finder/review-manager **grant-cycle email materials** (review template + attachments) — **low risk** (staff-authored org assets), and **reviewer-finder + review-manager are being replaced by the Dataverse-native Workbench** that combines both. So the proxy would only ever serve soon-to-be-legacy code; not worth the smoke/promote effort now. (Slice 2 also fixed a *live* `maintenance-service` data-loss bug — public cycle attachments were reapable after retention — that fix stands regardless.) See [[project-reviewer-apps-redesign-direction]], [[project-reviewer-workbench-invite-workflow]].

**How to apply:** don't smoke/promote the cycle-materials flag as routine cleanup — it's a deliberate park, not an unfinished task. The real value retained is the **pattern**: an authenticated, record-scoped (`record → requireAppAccess → server-side private get → attachment/nosniff/no-store`) download proxy for private Vercel Blob, with the shared `lib/utils/cycle-material-ref.js` prefix-classifier + back-compat helper. Reach for it (or generalize it beyond the reviewer-finder namespace) when we add the expected **Postgres-backed storage** for data that doesn't belong in Dataverse and needs an auth-gated browser download. The server-read private path (`readUploadedBlobBuffer`, `lib/utils/uploaded-blob.js`) is already live + prod-promoted for the file-loader cohort and is the piece to reuse first.
