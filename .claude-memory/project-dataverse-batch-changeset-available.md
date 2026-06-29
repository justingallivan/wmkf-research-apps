---
name: project-dataverse-batch-changeset-available
description: Dataverse Web API $batch with an atomic changeset + per-op If-Match WORKS in WMKF prod (verified S301 via probe) — refutes the "Dataverse has no $batch transaction" comment in prompts/[name].js
metadata:
  type: project
  status: active
  scope: dataverse
  last_verified: S301 (2026-06-28) via scripts/probe-dataverse-batch-changeset.mjs --execute against prod
---

## Recall Rule

Read this before designing any multi-row/all-or-nothing Dataverse write, or if you
hit the `pages/api/admin/prompts/[name].js` comment claiming "Dataverse has no
$batch transaction." That comment is **wrong for this environment** — don't build a
non-atomic mirror on its say-so.

## The fact (verified S301, 2026-06-28)

The Dataverse Web API `$batch` endpoint at `https://wmkf.crm.dynamics.com/api/data/v9.2/$batch`
accepts a `multipart/mixed` body with a single changeset and behaves to spec in **prod**:
- **Multi-op changeset commits** — two creates in one changeset → HTTP 200, embedded ops `204,204`.
- **Atomic rollback** — a create + a 404-delete in one changeset → HTTP 400 and the created
  row did **NOT** persist (the whole changeset rolled back).
- **Per-op `If-Match` honored** — a PATCH with a stale etag → 412.

Evidence: `scripts/probe-dataverse-batch-changeset.mjs` (run with `--execute --suggestion=<guid>`;
dry-run by default, self-cleans its `__probe*` rows). Verdict was GO on all three.

## How to apply

- Atomic multi-row Dataverse writes ARE available — use a `$batch` changeset (create/PATCH/delete,
  per-op `Content-ID`, per-op `If-Match`) when you need all-or-nothing semantics. The single-row
  helpers in `lib/services/dynamics-service.js` (`createRecord`/`updateRecord`/`deleteRecord`) are
  not the only option.
- The reviewer review-form submit (Phase 3 of [[../docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN]])
  is the first planned consumer: build `DynamicsService.executeChangeset(operations, { actingUserSystemId })`
  to upsert the `wmkf_appreviewanswer` snapshot child rows + PATCH the parent ratings in one atomic
  changeset. The §5a non-atomic fallback (and its unsolved P0-R1/P0-R2 controls) is **not needed**.
- The prior `prompts/[name].js` non-atomic publish mirror predates this verification; if it's ever
  reworked, $batch is now a real option (rename the belief, not just the doc — [[feedback-rename-code-not-just-docs]]).

Related: [[project-dynamics-sandbox-state]] (probe ran against prod, not sandbox, because the sandbox
lacks the reviewer schema), [[feedback-verify-external-platform-claims]].
