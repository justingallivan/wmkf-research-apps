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

- Atomic multi-row Dataverse writes ARE available, but use the current write
  contract rather than constructing raw batch requests. Application callers
  should declare named DAL operations and use the registered core
  `runChangeset` path, which validates entity sets, builds operation URLs, and
  requires trusted DAL context. The public `DynamicsService.executeChangeset(...)`
  method is the raw batch transport and does not dispatch through `runChangeset`;
  do not pass caller-built raw URLs through that facade for application writes.
  Follow `docs/agent-wiki/topics/dataverse-dynamics.md` and the source contract
  before adding an operation. Preserve operation order, per-operation
  `If-Match`, and atomic failure behavior.
- The reviewer review-form submit (Phase 3 of [[../docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN]])
  is an atomic answer-snapshot plus parent-state write: `build-review-submission`
  upserts `wmkf_appreviewanswer` child rows by alternate key and writes the
  parent's receipt/status/affiliation fields. The two ratings are held in the
  answer snapshots; the parent ratings are not patched by this flow.
- The prior `prompts/[name].js` non-atomic publish mirror predates this
  verification; if it is reworked, `$batch` is an available option. The prompt
  page's current behavior still needs its own source review before changing it.

## Historical S302 implementation record (2026-06-28)

At the June S302 implementation checkpoint, the helper was documented as
`DynamicsService.executeChangeset(operations, { actingUserSystemId })`, accepting
ordered `{ method, url, body?, ifMatch? }` transport operations and returning a
structured atomic-operation result. The reviewer submit was then described as
the helper's first consumer: it upserted answer snapshots and patched the parent
ratings in the same changeset. The authoring-plan §5a non-atomic fallback was
considered unnecessary because the atomic path existed, removing uncertainty
about whether a parent write could commit without the answer rows (or vice
versa). This preserves the June raw-transport API, behavior, and atomicity
rationale. It does not attribute the later DAL entity-registry validation or
trusted-context guard to that June helper. The current consumer contract above
supersedes the historical account of which parent fields were written: current
submission writes parent receipt/status/affiliation and stores both ratings only
in answer snapshots. The later core `runChangeset` wrapper validates named DAL
operations and establishes the current application write path; its Stage 7
trusted-context assertion postdates the June checkpoint.

Related: [[project-dynamics-sandbox-state]] (probe ran against prod, not sandbox, because the sandbox
lacks the reviewer schema), [[feedback-verify-external-platform-claims]].
