# Claude adversarial review prompt — Request Document Option B

Run an ordinary Claude Code session authenticated through the interactive OAuth
subscription. Do not set, read, export, remap, or use `ANTHROPIC_API_KEY`,
`CLAUDE_API_KEY`, or any project/provider API key. Do not invoke Ultrareview or
any paid/metered review product. If ordinary OAuth is unavailable, stop and
report that rather than substituting another mechanism.

You are the read-only adversarial reviewer. Codex owns the current working
surface. Do not edit files, apply patches, commit, push, deploy, change roles or
environment variables, or run any live Dataverse/SharePoint/Postgres/Vercel
probe. Repository source and tracked documentation are the evidence boundary.

## Primary artifact

Review `docs/REQUEST_DOCUMENT_EXPLICIT_ACTOR_PLAN.md` at the checked-out HEAD.
The owner has selected Option B: keep `wmkf_requestdocument` writes under the
service principal and add explicit, server-controlled actor tracking. Option A
and any broad/dedicated Request Document writer role are rejected unless a
future concrete compliance consumer requires built-in actor fields.

## Read before judging

Read the primary artifact whole, then read these controlling sources and the
logical regions/callers they reference:

- `CLAUDE.md`
- `docs/CLAUDE_REMEDIATION_PLAN.md`
- `docs/APPLICATION_STATE_ATLAS.md`
- `docs/atlas/dataverse-wmkf-requestdocument.md`
- `docs/SYSTEM_MODEL.md`
- `docs/REQUEST_DOCUMENT_ATTRIBUTION_ROLE_PLAN.md`
- `outputs/request-document-attribution-role-adversarial-review-2026-08-31.md`
- `docs/PRE_SITE_VISIT_DATAVERSE_SCHEMA_DESIGN.md`
- `docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md`
- `lib/dataverse/adapters/request-document.js`
- `lib/services/dynamics/write-core.js`
- `lib/services/dynamics/changeset.js`
- every Request Document create/update/changeset caller under
  `lib/services/initial-assessment`, `lib/services/pre-site-visit`, and
  `lib/services/final-writeup`
- the relevant authenticated routes and focused tests
- `lib/db/migrations/034_pre_site_distribution_attempts.sql` and
  `lib/services/pre-site-visit/distribution-store.js`

Use CodeGraph first if `.codegraph/` exists, then verify with source reads and
`rg`. Treat tracked plan assertions as claims to test, not evidence by
themselves. Label conclusions `[VERIFIED via file:line]`, `[DERIVED]`,
`[ASSUMED]`, or `[UNVERIFIED]`.

## Adversarial questions

1. Does the plan enumerate every current Request Document create path and every
   material same-row business transition, without attributing technical claim,
   cleanup, metadata, failure, pointer, or supersession writes to a person?
2. Are `wmkf_InitiatedBy/At` semantically stable across first create,
   duplicate alternate-key conflict, claim recovery, stale lease, response
   loss, and recovery by a different user? Find any path that would overwrite,
   omit, or misstate the first initiator.
3. Can the service principal actually bind the proposed system-user lookups on
   every single-write and changeset shape? Distinguish proved Wave 22 behavior
   from an unsupported inference.
4. Does adding actor binds change 403 fallback, changeset, relationship, or
   partial-success behavior in a way the plan misses?
5. Is `REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY` sufficient to avoid
   selecting/writing absent fields in every environment? Identify any silent
   flag-off or mixed-deployment loss of attribution and price the availability
   tradeoff rather than assuming fail-open or fail-closed.
6. Does the Site Visit handoff reconciliation truly require the actor on normal
   success, idempotent repeat, 412, and ambiguous response paths? Identify the
   exact source/test changes needed.
7. Is the guarded-reopen truth correction complete? Search for every live doc,
   source comment, DTO, UI, test, and report that still treats `_createdby` as
   the human actor or displays the service principal as if it were staff.
8. Does stamping retained distribution snapshot rows duplicate or conflict
   with `pre_site_distribution_attempts.acting_user_system_id`, especially
   when one operation creates DOCX and PDF rows or a second user resumes it?
9. Is Final claim `InitiatedBy` useful and non-conflicting with explicit group
   review attribution, or is it redundant/ambiguous enough to omit?
10. Is deferring repeatable native-version restore attribution honest and safe,
    or does the currently deployed owner-gated route create an unacceptable gap
    before Wave 24? Evaluate the two proposed future scopes without inventing a
    generic ledger unless needed.
11. Are lookup deletion/disabled-user behavior, formatted-name projection,
    historical nulls, timestamps, time zones, and reporting semantics handled?
12. Would the proposed three-field wave support the actual staff/executive
    dashboards, or is a consumer/query/index missing?
13. Is there a simpler design that meets the selected Option B objective with
    fewer fields or call-site changes without losing event truth? Conversely,
    does avoiding a generic event entity discard required history?
14. Check the plan's tests for negative-space quality: for each guard, require
    a fixture containing the dangerous condition and ask whether the test would
    still pass if the guard were deleted.

## Required output

Print the complete review for Justin to paste back into the coordinating
session. Do not modify any file. The coordinating owner can persist the review
after findings are accepted or refuted.

Start with a receipt containing:

- exact HEAD and branch;
- clean/dirty worktree status and the files already dirty before review;
- SHA-256 of the primary plan;
- whether any live probes ran (expected: none);
- gates run, if any (read-only gates are allowed, but do not repair failures).

Then provide:

1. a verdict: `APPROVE`, `APPROVE WITH CONDITIONS`, or `NEEDS REWORK`;
2. findings ordered BLOCKER/HIGH/MEDIUM/LOW, each with exact evidence, a
   concrete failure scenario, required plan change, and residual risk;
3. a caller → persistence → consumer matrix for every event in scope;
4. a recommendation on the three-field design versus any narrower alternative;
5. a list of claims you tried to disconfirm and the result;
6. discriminating test requirements; and
7. exact required revisions before implementation.

Do not approve based on process quality. Approve only if the plan's semantics
survive the actual callers, retries, fallback behavior, and consumers.
