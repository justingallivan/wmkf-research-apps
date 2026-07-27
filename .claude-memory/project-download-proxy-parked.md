---
name: project-download-proxy-parked
description: The record-scoped private-blob proxy is a reusable built pattern; its last verified production posture was parked on 2026-06-11, and current flag/deployment state requires a read-only probe.
metadata: 
  node_type: memory
  type: project
  status: active
  originSessionId: 708289ea-ea51-4981-8bad-646e820059d9
  last_verified: 2026-07-27 via cycle-material route/helper callers and tests; production flag state remains bounded to 2026-06-11 evidence
---

## Recall Rule

Read this when: considering private browser downloads for record-scoped files,
or proposing to promote the parked cycle-material flag.

Do:
- Reuse the strict `cycle-materials/` classifier, record-scope check, and
  server-side `readUploadedBlobBuffer` pattern.
- Treat promotion state as external and re-check the target environment before
  changing the flag.

Do not:
- Promote/smoke this legacy-only path as routine cleanup.
- Infer private/public state from a stored JSON `access` field; the pathname
  prefix is the shared classifier.

Ground truth: `pages/api/reviewer-finder/cycle-material.js`,
`lib/utils/cycle-material-ref.js`, and
`docs/security-audit/DOWNLOAD_PROXY_DESIGN_2026-06-11.md`.

## Verified source and dated deployment snapshot

The Phase-1 proxy source is code-complete and reviewed:
`pages/api/reviewer-finder/cycle-material.js` enforces record scope and delegates
private reads through the shared helper. Shipped commits: `e6e5d22`, `9f9eaba`,
`b6ea150`, `29deab3`, `b0316be`.

**Deployment snapshot, 2026-06-11:** the
`NEXT_PUBLIC_REVIEWER_FINDER_PRIVATE_CYCLE_MATERIALS` path had not been
e2e-smoked or promoted, so production remained on public behavior at that
measurement. Current production flag/deployment state is `UNKNOWN`; inspect the
Vercel environment and active deployment read-only before relying on, preserving,
or changing that posture.

**Why it was parked then:** the consumers were grant-cycle email materials
(staff-authored review template and attachments), while the Dataverse-native
Workbench was replacing the standalone reviewer apps. The benefit did not
justify promotion work at that point. Slice 2's separate
`maintenance-service` fix remained useful regardless.

**How to apply:** retain the source as an authenticated, record-scoped
(`record → requireAppAccess → server-side private get →
attachment/nosniff/no-store`) pattern with the shared prefix classifier. Do not
treat an old park as standing authorization or as unfinished routine cleanup:
first establish current deployment state and a current consumer need. If future
Postgres-backed private storage needs browser downloads, evaluate this pattern
against that concrete flow. The file-loader cohort's production promotion is
also a dated 2026-06-11 observation; re-probe before making an operational claim.
