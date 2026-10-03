---
title: Autonomous follow-up and remaining decisions
kind: report
domain: operations
status: active
canonical: false
summary: October 3 bounded release, repair, Factory v2 planning and open-list checkpoint; no further runtime promotion authorized.
owner: product-engineering
related:
  - docs/plans/TEST_REQUEST_FACTORY_V2_PLAN_2026-10-03.md
  - docs/plans/FACTORY_ABSTRACT_COPY_FIX_2026-10-03.md
  - docs/plans/MATERIALS_EMAIL_REQUEST_LINK_FIX_2026-10-03.md
---

# Autonomous follow-up — October 3, 2026

## Scope and evidence boundary

The owner authorized the adjusted recipient-free sandbox test, conditional one-record Production email association repair, Factory v2 planning (not implementation), and an open-list reconciliation. No email delivery, test-record deletion, unrelated production change or additional PR promotion is authorized. Request 1003308 remains retained. This report is a bounded follow-up to the earlier open-items report carried by unmerged PR #423; that report's earlier observations are history, not fresh probes.

[Sweep Mode A] Changed facts: the two merged fixes and the authorized abstract repair. Authoritative evidence: GitHub PR/deployment APIs, Vercel production-alias inspection, Dataverse conditional update/readback, current GitHub open PR/check and alert APIs. The two fix plans and the Factory design/Atlas abstract-copy status are the in-scope current restatements. Factory v2 uses source/ledger/consumer traces in its plan. This is not a whole-repository truth audit: older Factory documentation debt, Office Mac state, transcription watch and natural refusal observations are not newly re-probed.

## Completed release and repair evidence

- [VERIFIED via GitHub] PR #424 merged as `5bfe07826` and PR #425 as `ed14e90a4`. All checks on #425's final head passed before merge.
- [VERIFIED via GitHub and Vercel] Production deployment `dpl_Ac2a21TX57PXgTcMJ57FSCrTJpKF` is Ready for `ed14e90a4`, serving `applications.wmkeck.org`. Signed-out Meeting Tracker returned the expected sign-in redirect. A bounded log scan found a database-library compatibility warning on a successful request, not a failed business request. Deployment is not a new-clone or new-email live smoke.
- [VERIFIED via Production PATCH/readback] Request 1003303 now has the exact 2,476-character source applicant abstract. One abstract-only conditional PATCH returned 204; full-string/hash readback matched, destination revision became `101913598`, and the Factory run remained Ready. No source or formatted/approved abstract field was patched. The redacted durable receipt is `docs/plans/evidence/FACTORY_AND_EMAIL_REPAIR_CHECKPOINT_2026-10-03.json`.
- [VERIFIED via sandbox action response and readback] The adjusted test allowed only the exact automatic Owner party and rejected every sender/recipient role. The record-only `IssueSend:false` action returned HTTP 400. Readback remained draft (`statecode=0/statuscode=1`), without sent time or regarding, with exactly one role-9 Owner party. The script stopped without retry; no successful sandbox proof was created and the conditional Production email repair was not run. No email was delivered by this operation, and no test record was deleted. The response body was not retained, so the specific server rejection reason is UNKNOWN; do not equate HTTP 400 with a proved missing-recipient cause.

## Current open list, in working order

| Item | Current evidence | Next action / decision |
|---|---|---|
| Existing materials email association | Exact sent activity and marked Request passed read-only preflight; sandbox record-only mark-sent failed with 400 and stayed draft. Production association was not changed. | BLOCKED: obtain a suitable existing synthetic sent fixture or a separately reviewed no-delivery fixture method. Do not waive the sandbox prerequisite or resend. |
| Factory v2 | Refined plan uses the same filename as the earlier draft in PR #423. No v2 code, schema or operation is built by this pass. | Review the plan's recommended first slice and explicit owner decisions. Preserve 1003308. |
| Refusal handling / signed thinking, PR #423 | [VERIFIED GitHub] Open at `b0c3843aa`; all reported checks passed on that head. Automatic Sonnet admission is still out of scope. | Separate promotion decision; update/integrate against main if needed. Reconcile its earlier v2 plan with this revision rather than keeping two competing drafts. |
| Personal reminders, PR #332 | [VERIFIED GitHub] Open at `4a68b7f39`; all reported checks passed. PR release notes still require Tier 2 rollback/deployment preparation and deliberate promotion. | Prepare release/rollback evidence before an owner promotion decision. Automatic reminder cron remains held; no send authorized. |
| Dependency maintenance, PR #417 | [VERIFIED GitHub] Open at `fac320fd4`; all reported checks passed. | Separate review/promotion decision; no blanket dependency update here. |
| Dependency alerts #115 / #116 | [VERIFIED GitHub] `braces` and `http-cache-semantics` are still open, high severity, with no patched version listed at this checkpoint. | Keep open; reassess on an upstream fix or new exposure evidence. No suppression or automatic monitor created. |
| Held PRs #328 / #390 | [VERIFIED GitHub] Both remain open. #328 is explicitly DO NOT MERGE; earlier owner hold on #390 is preserved. | Owner decision before resuming or promoting either. |
| Intermittent Factory source refusal | [HISTORICAL October 3 bounded probe] Prior source hydration checks passed; no new failure captured in this pass. | Capture the next exact failing comparison/cTag; retain verification safeguards. No speculative patch. |
| Office Mac / transcription watch | [UNKNOWN current state] Earlier report requires Office Mac sync and preserves an intentional expired-job watch. | Check on the appropriate machine or when new operational evidence arrives; do not infer a new incident. |
| Liaison inbox delivery | [OWNER-REPORTED] The CC address was correct; a separate test email to it worked, but receipt of the original CC was not confirmed. | Request association repair does not explain or resolve mailbox delivery. A mail trace would be a separate investigation; do not resend. |

[VERIFIED GitHub] Closed duplicate PRs #147, #148 and #212 are not backlog. Passing checks above are head-specific snapshots; they do not imply an automatic merge authorization or a new test against today's main. Mergeability was returned as UNKNOWN during the query and is not asserted.

## Review, validation and limits

Luna prepares the scripts and plan, Sol independently reviews, root adjudicates and executes authorized writes, and Claude Fable reviews through subscription OAuth only. The email executables received Sol/root and Fable approval before the attempted sandbox operation; safe stop/readback was the actual outcome. Factory v2 received Sol/root approval and Fable approval after one substantive clarification round covering bundle freshness, typed receipt transitions and effectful status recheck. The documentation gates and self-tests passed sequentially: Atlas, document currency, fact consistency, symbol references, documentation catalogue, secret scan and scaffolding (13 commands). Whitespace validation passed. These checks cover the changed documentation; no runtime tests or new production-send/new-clone smoke are claimed. No runtime build, Factory v2 implementation, test cleanup, email delivery or additional production promotion is part of this planning branch.

## Decisions for the owner

1. Email repair: select a suitable existing synthetic sent fixture or review an alternate no-delivery fixture method. The current recipient-free action was rejected, so no Production email association was changed. There is no need to repeat the abstract repair.
2. Factory v2: accept or revise the recommended actor-scoped read-only diagnosis first. Readback-verifier feasibility, recovery writes/freshness remedies, higher-effect operations and retirement stay separate. No implementation has started.
3. Release queue: choose promotion timing for #423, #332 and #417 after their applicable release preparation/current-main checks. Existing holds remain.

This work is retained on local branch `codex/factory-v2-plan` for review; it does not promote the documents or any new runtime behavior to main.
