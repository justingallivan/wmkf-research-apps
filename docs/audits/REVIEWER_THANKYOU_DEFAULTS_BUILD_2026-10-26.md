---
title: Automatic reviewer thank-you defaults — implementation verification
domain: reviewers
kind: audit
status: active
summary: "Branch implementation 2a882dac2: 367 mocked tests and six fixture Chromium cases passed; fresh production build, types/lint and scoped gates passed. Independent Claude code review passed with nonblocking notes; not released."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_REVIEWER_THANKYOU_DEFAULTS_PLAN_2026-10-26.md
  - docs/atlas/postgres-infra-tables.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Implementation verification — 2026-10-26

[VERIFIED via source, mocked tests and fixture-only production-mode Chromium.]
Runtime fingerprint `2a882dac2f55a6de19704d4839063a9e511f08e7`, branch
`codex/reviewer-thankyou-defaults`. Justin authorized implementation and independent
Claude code review; he separately confirmed both inherited Admin and personal copy
must be held before the claim when final rendered safety checks fail. No release
is authorized by this task. Independent ordinary OAuth code review passed with nonblocking notes.

Integrated main `5e004b041` includes Claude's corpus index work. Git comparison of
lib/db, lib/services/request-file-corpus and scripts/load-request-file-corpus.mjs
with that main commit is empty. No apply-migrations, loader, live schema/row probe,
seed, environment edit, shared-setting/preference mutation, cron or real email
send was run. Only fixture/mocked stores were used; no test database was needed.
Claude's other checkout and database work remain untouched.

## Contract / invariant evidence

| Invariant | Entry → persistence → consumer | Proof |
| --- | --- | --- |
| Exact owner only | Staff session/profile + actor GUID/profile-map equality → dedicated route → exact owner/key preference | Real requireAuth Origin/revocation/session tests; bypass/applicant and actor mismatch failures; response echoes normalized owner and authenticated profile |
| New raw pair, no legacy rewrite | reviewer_automatic_thankyou_template → strict complete enumeration → independent Profile Settings controller | Validator tests; actual foreign owner/key Clear fixture; strict create/update/readback, duplicate/encrypted/capped/unreadable states; generic exact/case/whitespace aliases blocked in every read/mutation shape |
| No false success | Save exact-pair readback / Clear absence → status DTO or confirmed-mutation refreshUnavailable | Partial Clear, changed/duplicate readback, initial listing failure vs unconfirmed mutation, foreign/malformed receipts; strict Reload latch |
| No claim on unsafe or unreadable copy | Own snapshot + prepareReviewerThankYou → rendered business-body/subject checks → required DOCX → original If-Match marker → frozen send | Real and dry refusal/recovery; CR/LF, expanded-length bounds, empty stripped honorarium copy; no DOCX/claim on refusal; existing sender/attachment/signature/at-most-once assertions retained |
| No mixed pair or duplicate sweep send | Lowercase per-run promise cache → full raw pair → prepared HTML/subject → ETag winner | Same-PD success/failure cache, next-run freshness, different-PD continuation, two overlapping sweeps with different snapshots and one controlled ETag winner |
| Observable bounded failures | Existing skipped/skippedMisconfigured → grouped PD/reason errors → Maintenance failure status | All failures counted, sample cap 10 and group cap 100; maxBatch-before-lookup; real/dry ETag precedence tests and existing route Maintenance tests |
| Loading and identity cannot silently rebase a draft | Parent-owned controller above isLoading return → scoped epochs/inFlight → separate raw form | Actual Profile Settings dirty and pending-save loading tests, actor change, foreign profile/owner/shape DTO, stale response/unmount, explicit Switch/current-Archive cancellation, noncurrent Archive independence |
| Deliberate discard | Family-only route/Back/unload guard + Reload/Clear confirmation → preserved or deliberately discarded draft | Six real-browser cases: load, collapse retention, cancel, confirm/fresh return, Back, pending-save warning; latest history snapshot unit test |

## Verification actually run

- **16 suites / 367 tests passed** on the integrated runtime: 13 focused suites / 311
  tests plus three caller/census suites / 56 tests. Includes unchanged legacy email
  templates, signature/invitation characterization, post-send bookkeeping and the
  reviewer-engagement contract with real DAL context but mocked transport/stores.
- **Fresh production Next/Turbopack build + six fixture Chromium cases passed.**
  All APIs/external requests intercepted. Test-owned local ephemeral port; no
  user browser, shared DB or live preference/claim/send endpoint was exercised.
  Desktop screenshot inspected: independent disclosure fits existing Reviewer
  Emails card and retains the current page layout.
- **Types passed. Full repository ESLint: 0 errors / 192 warnings** on the integrated
  runtime.
  Three new hook warnings reflect lifecycle/interaction-local guards; no errors.
  Existing test act/log warnings do not affect assertions.
- Source gates and self-tests passed sequentially: API inventory, Atlas, DAL,
  Dynamics context, route/service boundary, lifecycle auth, GUID trust and enum
  parity. Final doc/secret gate results are recorded in the closeout below.
  API count 316 is derived; requireAppAccess endpoint count remains 196.

**Discriminating red/green proof:** the new shared-empty-body regression was run
with the actual prior sweep source from the planning baseline. Both real/dry cases
failed: real mode claimed/sent an automation-only email; dry mode failed to report
the refusal. Source was restored byte-for-byte in finally; all 40 sweep tests passed.
No experimental implementation remains.

## Complements and accepted limits

Confirmed absence alone falls back; duplicate/encrypted/invalid/unavailable own
copy never silently uses shared wording. Required shared presence remains the
existing batch prerequisite. Shared token grammar is deliberately unchanged,
including literal unknown tokens and legacy aliases/retired-note stripping; only
new personal copy gets strict grammar. Both sources receive final rendered safety
checks. Literal URLs remain authored text, with no generated secure link/action.

Claim failure/412 never sends; post-claim transport failure remains at-most-once
and is not automatically retried. Callable legacy manual sends still bookkeep the
same marker AFTER delivery; this slice does not claim to coordinate that existing
manual/cron race. Request sender/recipient/signature remain the existing per-run
server snapshot; no cross-system PD reassignment transaction is claimed.

Save/Clear across browser tabs is not transactional; strict duplicate detection
pauses delivery until explicit repair. An uncertain write can require Reload even
if it did not commit. A real authenticated actor change clears private state;
a temporary loading pause retains it and ignores stale responses. Unknown own
read state cannot unlock an existing uncertainty barrier. A title/context refusal
leaves the marker untouched until repaired; it is not a scheduled delivery hold or
new queue/ledger. No live inbox/tenant acceptance is claimed.

## Seven audits / bounded sweep

Contract-reconcile Mode B: table traces caller→auth→existing Dataverse preference→
strict DTO→editor and cron→context/snapshot→preparation→claim→transport→Maintenance.
Partial-success barriers, async epochs, helper semantics and complement cases
above were inspected. The shared renderer, generic editor, scheduled guard and
legacy storage were not extracted/refactored. New key/status fan-out includes
reserved/private sets, alias normalization, route, own reader, sweep, diagnostics,
Maintenance and UI; unknown values refuse rather than select arbitrary copy.
No new schema, migration or transport state: N/A. Existing canonical counts,
route matrix, Atlas, catalog and current slice records distinguish branch-built
from deployed status. Historical plan/review evidence remains identified as such.
No unrelated Duncan/Connor or corpus/database facts were rewritten.


## Initial independent code review and follow-up

At `e4c55148f`, ordinary OAuth Claude returned PASS WITH NONBLOCKING NOTES,
no blocking findings. Verbatim report:
`docs/audits/REVIEWER_THANKYOU_DEFAULTS_IMPLEMENTATION_CLAUDE_REVIEW_2026-10-26.md`.
The reviewer inspected source but not tests, so a direct test review is requested
with the targeted rereview. Nonblocking note1 is corrected: definite pre-write
identity_unavailable/identity_mismatch refusals now truthfully say no default was
changed, retain the draft and disable mutations until Reload. Contradictory error
receipts remain uncertain. Three additional editor tests pass. Note2's two seeded-
copy headers now describe own/shared defaults. Notes3–5 retain the reviewed
claimFailed-only ETag policy, deliberate interaction-local hook dependency/lifecycle
warnings and capped/simple diagnostic scans. None changes transport or persistence.

## Final rereview and closeout

[VERIFIED via independent Claude report and root-run checks.] Claude rereviewed
`2a882dac2` including direct test inspection: **PASS WITH NONBLOCKING NOTES**, no
blocking findings. Both initial source notes are closed. Verbatim receipt:
[implementation rereview](REVIEWER_THANKYOU_DEFAULTS_IMPLEMENTATION_CLAUDE_REREVIEW_2026-10-26.md).
Remaining notes describe evidence limits: preference-refusal Maintenance status,
existing exact-owner adapter filtering, route reason strings, stronger overlapping
pair assertions and additional navigation permutations. These do not invalidate
the reviewed safety contract; source inspection supports them where tests do not.
The controlled ETag winner is simulated, not a live concurrency probe.

Final run at that target: 367 tests, six fixture Chromium cases against a fresh
production build, types and lint passed (0 errors / 192 warnings). Scoped source
gates/self-tests passed sequentially. Draft [PR #533](https://github.com/justingallivan/wmkf-research-apps/pull/533).
Documentation currency, fact consistency and symbol-reference gates/self-tests, docs catalog, secret scan/self-test and whitespace checks passed. No runtime or test edits follow the reviewed target. Not released.
