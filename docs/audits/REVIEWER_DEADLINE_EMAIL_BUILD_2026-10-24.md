---
title: Reviewer deadline email defaults — build and review evidence
domain: reviewer-engagement
kind: audit
status: active
summary: Branch-only slice 2 build evidence and OAuth Opus review corrections; no deployment or live email verification.
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_REVIEWER_DEADLINE_DEFAULTS_PLAN_2026-10-24.md
---

# Reviewer deadline email defaults — build and review evidence

## Scope and invariants

Branch: `codex/reviewer-deadline-email-defaults`. Entry points are Workbench and
follow-up reviewer panels, the deadline operation route and own-user preference
route. Existing Dataverse preferences/settings and suggestion deadline fields
remain the only persistence; no schema, cron or durable draft was added.
Assigned PD only; every final operation has a fresh reviewed proof; empty bodies
remain explicit; Cc never persists as defaults and is prohibited on synthetic
requests; a saved date is never relabelled unsaved after notification failure.

## First candidate

[VERIFIED via local commands.] `a79003426` passed 1,460 Jest suites / 25,143 tests
and five snapshots, with 21 suites / 247 tests skipped. Start and end HEAD matched
in `/tmp/slice2-jest-candidate.log`. Production build, changed-file lint, required
scope gates and sequential self-tests passed. Desktop 1440px and mobile 390px
browser checks used the actual webpack-compiled editor, synthetic in-memory
responses and a localhost-only network fence: no browser errors or horizontal
overflow; From/To and Cc visible; empty-body preview, edit invalidation and PD-only
controls checked. These are component rehearsals, not authenticated live flows.
Reusable fixture: `scripts/rehearse-reviewer-deadline.js`.

## Opus build review and corrections

Review receipt: `SLICE2_OPUS_BUILD_REVIEW_2026_10_24`; Claude Opus 5.5 through verified
Claude.ai Team OAuth on the host, with API-key auth variables removed, safe mode,
Read/Grep/Glob only, no external tools or paid review product. Review returned
not ready. Parent verified reviewed HEAD and SHA256 of every changed file unchanged.

| Finding | Resolution in corrected candidate |
| --- | --- |
| P1-1: display annotations/date formatting and API property order invalidate post-write comparison | Fixed field-list row/request projection excludes annotations; canonical object ordering for digests; save and restore regressions change formatted annotations and reorder API keys while asserting actual dispatch |
| P2-1: Dataverse may represent an empty shared text value as null | Present null body is treated as empty; missing key/null subject still blocks; compatibility test added, live storage semantics remain unprobed |
| P2-2: saved-state error could also claim no date changed | Separate saved-state messages for read/config/identity/link failures; editor regression for post-write read failure |
| P3-1: seed replaces intentionally empty Admin body | Existing extension body is preserved on found=true, including empty/whitespace/null values; execute-mode tests assert no write |
| P3-2: post-write policy refusal incorrectly retryable | Preserve policy retryable=false; synthetic Cc post-write regression checks field |
| P3-3/4: non-PD error and request-mismatch messages | Route maps shared-helper 403 to assigned_pd_required; editor has explicit request_mismatch copy; reason/status test table expanded |
| P3-5: bad shared config prevents repairing own defaults | Preference GET exposes own-row repair with sharedUnavailable flag; default editor is reachable even when initial preview fails; Save/Clear remains independent |
| Test gap: defaults Save/Clear versus one-send edits | Deferred-save editor test locks conflicting edits and proves one-send draft survives Save and Clear |

Corrected focused run: 131 tests in seven suites passed. Second review and final
candidate verification are pending; do not treat the first verdict as approval.

## Whole-flow / contract-reconcile

Source → persistence → consumer: authenticated app guard and session actor →
request authorization plus same-context PD/sender equality → optional shared/own
wording read → selected-state digest preview → final fresh state/proof check →
conditional suggestion write for save/restore only → post-write confirmation →
full-recipient safety check and Dynamics email/calendar → explicit saved/notified
result → current-generation editor state. Retry/resend performs no date write.

Partial success: one reviewer per operation, explicit saved/notified booleans;
post-write reread failures retain saved=true; uncertain sends have no retry proof.
Async: mounted/context/generation guards; identity/permission changes close/reset;
conflicting Save/Clear and send actions lock edits. Helper semantics: extension-only
validator allows optional/empty body, does not weaken sibling required tokens or
authorization. Durable surfaces: existing stores only, new route in security matrix,
namespace guard verified, both private/reserved preference key sets, canonical
route counts regenerated, service catalog updated. Symbol fan-out: raw key,
extension Admin keys, operation/result reasons and both UI mounting paths checked.
Documentation reconciliation uses branch-built labels, not production claims.

## Remaining verification boundaries

No Dataverse, email, configuration seed, production deployment or business-record
write was invoked by this task. Before promotion, authorize and perform the
non-overwriting subject seed and exact readback with candidate validation; verify
empty description acceptance in the chosen isolated delivery rehearsal. Actual
null/annotation storage behavior has source-based compatibility coverage, not a
fresh live observation. The suggestion ETag cannot atomically lock request fields;
a remaining cross-record race is documented, not described as owner-accepted.
Proofs expire after five minutes but are not single-use; manual resend/retry
replay outside the UI is an existing-pattern limitation. A transport timeout on
the date PATCH still has the baseline ambiguous-write limitation; this change does
not claim to solve it. No migration or PostgreSQL integration change is in scope.
