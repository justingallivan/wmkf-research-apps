---
title: Ordered open-items follow-up
domain: operations
kind: report
status: active
summary: "October 3 follow-up: refusal safeguards built, reminder PR integrated, dependency PR repaired and duplicates closed; authorized test visit prepared; promotion and email send remain separate decisions."
canonical: false
owner: product-engineering
related:
  - docs/plans/TEST_REQUEST_FACTORY_V2_PLAN_2026-10-03.md
  - docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md
  - scripts/probe-admin-alert-operations.js
---

# Open-items follow-up — October 3, 2026

Initial read-only scope (before the implementation and authorized test-record changes below): investigate the intermittent Factory lookup first, then work through the
reported open list. Source baseline `d1eae6fd3`; isolated branch
`codex/open-items-followup`. No production mutation, message send, provider
inference, migration or model admission was performed. Original checkout changes
were preserved. Results below are bounded observations, not an all-clear.

## Ordered results — initial read-only checkpoint

| Item | Evidence and outcome | Remaining action |
|---|---|---|
| Factory source refusal | VERIFIED: source trace preserves metadata/byte checks. Three read-only hydration attempts for each previously implicated XLSX all passed; each source's hash and metadata stayed stable. Retained Vercel log contains an older generic 409, not a new diagnostic-rich failure. | Root cause UNKNOWN; retain the guard and capture the next failing comparison/cTag. No speculative patch. |
| Dependency alerts | VERIFIED via GitHub alert readback: #115 braces and #116 http-cache-semantics remain open with no patched release listed. | Upstream-blocked; keep open. No suppression or blanket dependency update. |
| Sonnet 5.5 | REVIEW COMPLETED, ADMISSION BLOCKED: vendor contract and candidate registry/pricing/tests checked; fresh independent review found two consumer blockers below. | Fix/refuse incompatible callers before automatic admission; obtain separately authorized paid replay if needed. |
| Factory artifacts | VERIFIED via read-only maintenance record: daily maintenance at 2026-10-03 03:00:50.382Z completed at 03:01:02.022Z; Factory aggregate deleted 4, kept 2, errors 0, neither scan nor deletion truncated. | This closes aggregate sweep observation only; exact per-object deletion/retention was not proved. |
| Test email browser check | PARTIAL: authenticated Workbench on cast-bound Request 1003303 shows neither a presentation nor a visit scheduled. | Prepare an explicit test visit/schedule and recipient preview before a separately authorized send. No successful delivery claimed. |
| Office Mac | UNKNOWN: brief read; current machine cannot establish office checkout/environment state. | Run the existing Office Mac sync brief on that machine. |
| Factory decisions | VERIFIED owner decisions: prepare v2 plan; retain marked Request 1003308. | Linked plan is a proposal; no recovery or cleanup of retained record. |
| Transcription | VERIFIED via content-free operations probe: no active processing jobs; one expired job retains input watch/local cleanup pending. Audio deletion, provider cleanup and content purge observed. | Keep intentional watch. Confidential-use assurances, maximum-size test, callback delivery and inbox receipt remain unproved/parked. |
| Scheduled transcription execution | PARTIAL: read-only Vercel logs show recurring hourly GETs returning 200. Logs omit query strings and invocation origin. | Do not claim those rows separately prove daily mode, platform origin, clean cleanup, or callback/inbox success. |
| Tracker acceptance/performance | VERIFIED authenticated production schedule load: 12 request cards and materials counts rendered; one reload to the final request card took 3,360 ms using browser-action timing. | Bounded read smoke only. No before/after baseline or speedup claim; no mutation acceptance performed. |
| Older PRs | VERIFIED via GitHub: #332 conflicts with main; #328 draft/DO NOT MERGE and conflicting; #390 on owner hold, mergeable but prior Jest red. Dependency #417/#212/#148/#147 are open with red test checks. | #332 needs current-main integration and full revalidation; preserve explicit holds; investigate dependency CI before any promotion. |

## Sonnet review findings — initial checkpoint

1. **P1 — ordinary callers discard refusal status.** `pages/api/refine.js:92`
   takes only text and returns HTTP 200; `pages/phase-ii-writeup.js` consumes it as
   a formatted summary. `pages/api/qa.js:178` emits ordinary completion without
   recognizing refusal. A global Sonnet admission would reach these callers.
   Required: explicit refusal result/rendering and consumer tests, or keep these
   callers on the previous reviewed model.
2. **P2 — Explorer rewrites signed thinking history.**
   `lib/services/dynamics-explorer/conversation.js:49` compacts earlier tool
   results/inputs; `chat-session.js:246` retains/replays response content including
   thinking. A supported Sonnet override can violate 5.5 prefix binding. Explorer
   defaults to Haiku, so this is not a default-Haiku regression. Required: a
   provider-supported history policy and multi-round regression coverage before
   permitting that override.

The candidate passed 5 focused suites / 97 tests, but those tests did not cover
these consumer failures. The candidate runtime/test edits were removed from this
branch after review; automatic selection remains unchanged. No provider replay
was performed. Pricing/capability facts were compared with the official
[overview](https://platform.claude.com/docs/en/models/sonnet-5-5/overview) and
[migration notes](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5).
The fresh review was read-only and raised the two findings above. Its bounded
consumer inventory also identified Phase I/II summary generation, Phase I
writeup and multi-perspective evaluation as dropping refusal metadata. Expertise
matching and grant extraction parse text without explicit refusal handling;
generic parse failure is not supported refusal handling. Shared Executor already
rejects refusal before persistence; Explorer already handles refusal as terminal.
The prerequisite is the affected-consumer inventory, not only fixes to two routes.

## Evidence mechanisms and limits

- `scripts/probe-admin-alert-operations.js` ran with an explicit existing
  environment file in a read-only Postgres transaction on October 3 at 17:00Z.
  The alert is still active; no alert was manually resolved. The expired lease
  aggregate is not evidence of an active processing backlog.
- Source checks followed UI → source route → export/hydration → bundle digest →
  runner → ledger/consumer. CodeGraph failed to open its database; direct source
  inspection was used. The existing
  `scripts/probe-sharepoint-download-stability.mjs` is the repeatable operator
  tool for follow-up stability/package inspection. The initial six hydration observations
  were ad-hoc. `scripts/probe-factory-source-hydration.mjs` now preserves the
  bounded exact-Request lookup/discovery/hydration procedure. Its independent
  rerun on source 1002860 passed all three attempts at 17:04Z with the same
  36,516-byte hash as the original probe. The operations probe now also includes
  the Factory maintenance aggregate; its 17:04Z rerun confirmed those counts.
- Browser timing includes automation and rendering overhead. One sample is not
  a percentile, benchmark, or controlled comparison.
- GitHub checks are snapshots of their existing heads; old passing checks on
  #332 are not current-main validation. No held PR was changed or merged.

## Bounded durable sweep

Mode A: changed facts are the aggregate Factory sweep observation and the owner
choice to retain 1003308 / prepare v2. Searched docs, memory, session handoff and
source for sweep observation, retained-record decisions and Sonnet review claims.
The runbook and Factory Atlas contained live “not observed” claims and are
corrected. Session 563/566 sections are explicitly under historical handoff
boundaries; they remain dated history. Registry-unreviewed references still
correctly mean not admitted, not that this review approved adoption.

Semantic review also found older contradictions in the Factory Atlas (blanket
Neon refusal, API not yet built, earlier shared-schema descriptions) and a stale
unmerged-email-fix statement in the production plan. These are outside the two
changed facts and remain named documentation debt. No whole-domain reconciliation
is claimed. Verdict: changed sweep-observation claim reconciled; broader Factory
domain AUDIT INCOMPLETE. Detailed source-cause and exact-object claims remain
UNKNOWN. No unrelated cleanup or memory-router diet was undertaken.

## Review and validation

A separate read-only agent reviewed the v2 proposal and this report and found no
material recovery-safety or evidence-scope issue. External observations were not
independently repeated by that reviewer. Runtime admission edits were discarded;
final changes are documentation and read-only operator probes. No main promotion
is part of this initial pass. The subsequent implementation is recorded in
[the refusal-hardening execution report](LLM_REFUSAL_HARDENING_2026-10-03.md).

Validation: all 15 selected documentation/safety gate commands and available
self-tests passed sequentially (Atlas, doc currency, fact consistency, symbol
references, docs catalogue, secret scan, scaffolding and harness framing).
Whitespace validation passed. The hydration script passed syntax checking and
refused missing arguments before any live request. Its live read-only run and the
extended operations probe both passed.


## Subsequent execution — October 3

[VERIFIED via source, local tests, independent reviews and GitHub] The owner asked to work through the next actions. These results supersede the initial checkpoint's open-PR and consumer-blocker status:

- **PR #423**, runtime head `fa9d312a5`: explicit refusal handling across the affected legacy callers and signed-thinking preservation in Explorer are implemented; all checks passed on that head. The PR is ready for review and remains unmerged. Sonnet 5.5 is still excluded from automatic selection; this is prerequisite hardening, not model admission. Detailed validation is in `LLM_REFUSAL_HARDENING_2026-10-03.md`.
- **PR #332**, head `4a68b7f39`: current main integrated, conflicts resolved, 17 focused suites / 345 tests passed, relevant gates/self-tests passed and a fresh source review found no material integration regressions. All GitHub checks passed. Main's test-request exclusion, exact manual test-recipient checks, and current `reviewAll` preference contract are preserved. The automatic reminder cron stays held. The Tier 2 rollback/deployment preparation and owner promotion decision remain.
- **PR #417**, head `fac320fd4`: current main integrated with shipped security overrides retained. npm 10 generated the two missing nested Workflow lock entries, Chokidar 5.0.0 and Readdirp 5.1.1; the repair changes no other entry. Clean install with lifecycle scripts disabled, final lock validation, and 11 dependency-sensitive suites / 295 tests passed. Independent narrow lock review found no material findings. All GitHub checks passed. It remains unmerged.
- **PRs #147, #148 and #212 closed as duplicates**: main already contains their exact proposed qs/side-channel, xmldom, and csv-parse lock entries (and the csv-parse manifest version). Their old red jobs were unrelated Awardees test failures or an old harness-framing failure. No extra runtime change was needed. PRs #328 and #390 remain on their existing holds.

[VERIFIED via owner authorization, Factory ledger command and authenticated Production browser] The owner authorized preparing a visit/preview for marked Request 1003303, then separately authorized advancing it when scheduling was refused. The existing Factory status command verified ready run `e33fa857-4b00-4c60-94da-77d4406d4027` and changed Phase II from unset to **Phase II Pending Committee Review**. Change `a9324159-642a-4a6f-83b7-40d815450cc7` completed with request status **Phase II Pending**, two background jobs settled, and zero new emails, tracking rows or payments. The marked test Request and cast contacts were retained.

The browser saved **TEST ONLY — Email preview check — #1003303**, Friday October 9, 2026, 10:00–10:30 America/Los_Angeles, organized by Justin Gallivan, with the existing Factory PI and liaison test attendees. The initial October 6 test date was moved to October 9 so the computed materials deadline would be in the future. This is a synthetic visit, not an actual meeting. The shared email template could not render its missing program-coordinator name; a clearly labeled one-send test draft removes that placeholder without saving a personal or shared default. No email has been sent. The final browser preview rendered successfully with Send enabled: from the signed-in PD mailbox, to the Factory PI test address, cc the Factory liaison test address, subject **TEST ONLY — Request 1003303 materials email check**, visit October 9 and upload deadline October 7. It states there is no actual meeting. The exact addresses and full message are visible in the retained browser preview; explicit send approval is still required.

Remaining external prerequisites from the initial checkpoint (Office Mac access, intentional transcription watch, natural Factory refusal evidence, and separately authorized model replay/admission) are unchanged. Request 1003308 remains untouched.
