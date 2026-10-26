---
title: Scheduled reminder correlation recovery gap fix
domain: workbench
kind: audit
status: active
summary: "Recovery fix at 17f1969d2 independently reviewed, 47 SQL/125 unit tests passed; released as 6a37ea105 in PR #531 after full CI. Production verification and remaining limits in release receipt."
owner: product-engineering
related:
  - docs/audits/SCHEDULED_GRANTEE_DEFAULTS_BUILD_2026-10-25.md
  - docs/atlas/postgres-infra-tables.md
---

# Scheduled reminder recovery follow-up — 2026-10-25

[RELEASED PR #531 / 6a37ea105.] Current release proof and limits:
`docs/audits/SCHEDULED_GRANTEE_DEFAULTS_RELEASE_2026-10-25.md`. Build/review evidence below retains its pre-release fingerprints.

[VERIFIED via source and local tests.] Runtime fingerprint: `17f1969d2`, branch
`codex/scheduled-grantee-defaults`, PR #531 (draft during that build checkpoint). Justin explicitly authorized
fixing the prior review's N1 duplicate-send recovery gap, recovery and concurrent
reassignment tests, and independent Claude review before release. The owner later separately authorized release after CI, completed as recorded
in the release receipt. Claude's other checkout/database work is excluded and untouched.

## Invariants and whole-flow trace

| Invariant | Entry / persistence / consumer | Verification |
| --- | --- | --- |
| Recovery key survives failed identity storage | Delivery ownership hold or ordinary lookup → freezeScheduledEmailCorrelation writes existing last_error_code before external lookup/create → SQL generation guards | Actual baseline regression fails because reassignment changes owner/generation; fixed test preserves original key and recovers acceptance |
| Crash cannot erase uncertainty | Marker keeps lease; generic failure preserves marker when ID/intent absent; expiry does not clear marker | Process death, failed fallback failure receipt, identity null/throw, expired lease, stale worker tests |
| Reassignment cannot race recovery | Marker blocks PD reset and recipient transitions; saved ID independently blocks both once marker clears atomically | Separate real Postgres connections launch reassignment and recovery in both orders; neither changes PD/generation or sends |
| Only read-only recovery can reclaim | Due and ordinary/forced claims reject marker; bounded reconciliation query/read claim accept marker without ID | SQL tests assert candidates/force refusal, original correlation lookup, accepted identity/receipt/finalization; absent/draft/duplicate/offline remain held |
| No false release | Ownership-mismatch lookup can release marker only on successful nonaccepted result under current token; ambiguous reads retain it | Existing A5 orphan tests pass, ambiguous recovery cases remain frozen, stale release refuses |
| Staff actions reflect hold | Shared attention enum/copy → projection/digest/API/page | Recovery is Needs attention, edit/approve/send disabled, Stop allowed; page/route/digest tests |

## Behavior and complements

The new `scheduled_email_correlation_recovery` code uses existing
`scheduled_email_messages.last_error_code`; no column/table/migration is added.
The durable marker is written before correlation lookup/create, not after an
accepted result. Without that write, delivery stops before any external lookup,
create or send. On successful identity persistence the same atomic update clears
the marker; the stored ID then prevents a handoff or recipient-generation rewrite.
A receipt failure after identity storage is recovered from that exact identity.

A process killed before the generic catch retains the marker. A failed generic
failure write also cannot lose the already committed marker. Reconciliation
reads only the frozen correlation (or stored identity), records acceptance and
finalizes the source. Missing, unreadable, duplicate or unaccepted results never
create/send, clear the hold or change generation; the row stays visible for manual
history review and Stop. Stop is terminal and ends automatic reminders for that
source. A successful nonaccepted lookup during the initial ownership guard can
release the marker under its original lease and retain the reviewed A5 behavior.

**Deliberate availability tradeoff:** an interruption can hold a reminder even if
no activity was created or accepted. Automatic blind retry is not offered. A
stale worker's token cannot release another worker's fence. The pre-existing
cross-system current-PD read → send-intent race remains; no atomic Dataverse /
Postgres lock is claimed. This fix prevents the reproduced post-failure recovery
identity loss; it does not discover historical accepted activities already orphaned
under abandoned generations before this fix.

## Verification

- **47 real local PostgreSQL 16 engine tests passed.** Disposable task-owned Docker
  instance, random scratch schema, existing migrations 036/059 inside that schema
  only, mocked Dynamics. This includes 14 additional recovery cases over the prior 33.
- **Five focused Jest suites / 125 tests passed:** scheduled service/current
  recipients/routes/page/schema. API/body/default editor behavior is unchanged.
- **Red/green proof:** ran the correlation-only accepted identity failure test
  with actual prior runtime from `dc95789e8`; it failed at reassignment refusal:
  former PD changed to new PD, recipient_generation advanced 0→1. Restored runtime
  byte-for-byte and all 47 tests passed. No experiment remains in source.
- Types passed; scoped ESLint 0 errors / 5 existing page warnings. Fresh production
  build passed. No live mail, preference write, shared configuration mutation,
  environment edit or shared database/schema operation occurred.
- Relevant gates and paired self-tests passed sequentially: Atlas, status enum,
  GUID trust, DAL/context, route/service boundary, API inventory, doc currency,
  facts, symbol references and build claims; docs catalog/whitespace passed.
  Secret scan and its self-test passed after staging the closeout.
- Hosted CI is a separate run for PR #531; no pending run is claimed green here.

## Contract-reconcile and bounded sweep

Mode B implementation: source → existing ledger → read-only recovery → source
finalization → DTO/attention/digest/API/page traced above. Partial success is
explicit: freeze before external work, identity before receipt, receipt before
finalization; failed finalization remains in existing sent-repair lane. Async
fences are lease/token/version; no client async state change. Helper extraction
N/A; existing helpers retain their semantics. Durable-surface: existing error
column, Atlas/catalog and attention consumers updated, migrations N/A. New enum
fan-out includes SQL claims/queries, generic failure, reassign/recipient/draft/
approval writes, read-only lane, shared mapping/copy, page label, API guards and
digest grouping; none defaults to a new send.

Sweep Mode A changed fact: prior review N1 is now reproduced/fixed on this branch.
The prior build/review fingerprints remain historical evidence. Current plan,
TODO/inventory, ledger Atlas, service catalog and digest-plan branch boundary link
this follow-up. Unrelated Duncan/J27 and database/corpus work are excluded.
Independent ordinary OAuth Claude review returned PASS WITH NONBLOCKING NOTES,
closing N1 with no blocking findings; not release authorization. Verbatim receipt:
`docs/audits/SCHEDULED_GRANTEE_RECOVERY_GAP_CLAUDE_REVIEW_2026-10-25.md`.


## Independent review disposition

Claude's ordinary OAuth review at runtime `17f1969d2`: **PASS WITH NONBLOCKING
NOTES**, N1 closed, no blocking findings. Report:
`docs/audits/SCHEDULED_GRANTEE_RECOVERY_GAP_CLAUDE_REVIEW_2026-10-25.md`.

- NB1: Held is intentional page wording; the digest categorizes the same reason
  as Needs attention. Both use the same Stop-only action guard.
- NB2: test-request/source-ineligible cancellation stays terminal and cannot send;
  it may record Stopped instead of Sent for a correlation-only accepted activity.
- NB3: added two real-Postgres cases after review. Identity persists, receipt fails,
  then fallback either restores the marker or also fails. Both recover acceptance
  without a new send; reassignment stays blocked by the saved ID. Runtime unchanged.
- NB4: interrupted but unaccepted work remains held for manual history resolution;
  this availability tradeoff is explicit above.

Mode A closeout re-search found no remaining current claim that N1 is uncorrected
on this branch. Prior fingerprint reports remain visibly historical. Live write acceptance remains UNKNOWN; Production read-only verification is
recorded in the release receipt. No new runtime changes followed independent review.
