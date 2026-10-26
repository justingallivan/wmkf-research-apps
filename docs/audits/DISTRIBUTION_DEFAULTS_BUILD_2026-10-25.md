---
title: Deliberation-distribution personal defaults — build verification
domain: workbench
kind: audit
status: active
summary: "Branch implementation verified at 1215cfd7d: 426 focused tests, production build, four real-router fixture browser cases and independent Claude review chain passed. Discard warnings preserved; released through PR #529 with Production verification in the release receipt."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DISTRIBUTION_DEFAULTS_PLAN_2026-10-25.md
  - docs/audits/DISTRIBUTION_DEFAULTS_IMPLEMENTATION_CLAUDE_FINAL_REVIEW_2026-10-25.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/atlas/postgres-infra-tables.md
---

# Branch implementation and verification — 2026-10-25

[VERIFIED via branch source, focused tests, local Production-mode build and
fixture-only Chromium, plus ordinary OAuth Claude reviews.]
Runtime fingerprint: `1215cfd7d4151f5df628e0795b16c178b8a6af37` on
`codex/distribution-email-defaults-plan`, isolated worktree
`/Users/gallivan/.codex/worktrees/session-start-2030/WMKF_Apps`.
The following receipt/test-assertion commit changes no runtime code. This is
implemented and independently reviewed work, **released through PR #529** as
`7f2a6e9c8bfa3332cb1d8f4ae662779f4e606764`. Production proof and rollback:
`docs/audits/DISTRIBUTION_DEFAULTS_RELEASE_2026-10-25.md`.

During implementation, no live preference or shared-setting write, migration, seed, email, deployment,
or database probe was performed. Claude's separate checkout and database work
were not modified. Dependencies were copied locally from the existing installation
so the build used this worktree, without installing into Claude's checkout.
The local test server was stopped after verification.

## Implemented contract

| Claim | Entry → source/persistence → consumer | Evidence / status |
| --- | --- | --- |
| Exact authenticated sender | Dedicated reviewers-gated `distribution/email-preferences` route → session GUID → complete exact-owner/key DAL enumeration in existing Dataverse `wmkf_appuserpreferences` | VERIFIED: route and service suites; no caller identity, query fields or profile remapping; private no-store; 256kb parser |
| Reusable raw pair | `deliberation_share_template`, exactly subject/body → strict family validator → per-open subject renderer and separate raw editor | VERIFIED: raw/maximum/token tests; non-empty message; subject-only requestNumber token; generated content is unchanged |
| Honest reads/writes | Distinct own read states and per-field shared fallback → raw/effective DTO; Save exact readback, Clear absence readback | VERIFIED: duplicate/encrypted/invalid/unavailable, partial Clear, uncertain mutation and independent refresh tests; no uniqueness or cross-tab locking claim |
| Future-only defaults | Panel-owned editor/mutation lane → explicit Save/Clear/Reload → future editor state only | VERIFIED: existing form/recipients/preview/hash/confirmation retained; eligible lock spy and URL assertions exclude prepare/send side effects |
| Fresh ordinary open | Parent open version → stable request/confirmed-sender panel → fresh defaults and value-independent recipient seed | VERIFIED: late auto-fill remains clean, edits returned to baseline are clean, source pause retains text, initial auth loading and real actor replacement tests |
| Discard protection | Shared Close/Escape handler, inline Close/Reload/retained-open confirmation → busy guards → explicit discard only | VERIFIED: cancel/Escape preserves edits; busy cannot close/reload; confirmed retained-open discard starts fresh in-place; recovery guard prevents losing Retry |
| Navigation protection | Panel-local hook → real Pages router route start / Back / beforeunload | VERIFIED: four local browser cases cancel tab, shell Link and Back with URL/state preserved; confirmed navigation prompts once. Pending-default warning also names lost email edits |
| Frozen exact retry | Memory envelope and permanent uncertainty latch → exact operation/hash Send; exact acceptance or complete-response plus fresh explicit no-transport history proof | VERIFIED: network/malformed/in-progress/unknown errors, later stale refusal, null-ID/intent proof, foreign/uppercase IDs, source/history/recipient changes and queued opens |
| Async teardown | Independent history/default/preference/prepare/send/reissue generations → mounted/source/call fences | VERIFIED: late lock cannot start prepare; late reissue cannot fetch history/notify old parent; source changes cannot abort Send or strand its busy flag |
| Existing transport authority | Existing prepare/store/send/history services and DTO retained | VERIFIED: compatibility suites and runtime diff; new personal service never sends or changes schema, server-generated briefing/session/link content remains server-owned |

Primary runtime files: `distribution-personalization.js`, dedicated preference
route, `PreSiteDistributionPanel.js`, `DistributionSenderPanel.js`,
`DistributionWordingDefault.js`, `useDistributionUnsavedChanges.js`, parent open/
retention signals, and the request page's expected navigation-cancellation catch.
The key is in both generic preference privacy and reserved-write sets.

## Verification actually run

- **Jest: 12 suites / 426 tests passed.** Files: `distribution-defaults-panel`,
  `distribution-sender-panel`, `distribution-unsaved-changes`,
  `distribution-personalization`, `distribution-email-preferences-route`,
  `user-preferences-reserved-keys`, both existing pre-site panel suites,
  `staff-deliberations-tab`, `pre-site-distribution-service`, and distribution
  prepare/send route suites under `tests/unit/`.
- **Discriminating regressions:** three teardown/busy-discard tests failed against
  80826ff16 and passed with fixes. The D1 start-fresh/send race failed against
  7ec440049 and passed with the central guard. Source was restored after each
  bounded old-revision experiment. The final prompt-dismissal assertion was added
  after review without changing runtime behavior and the panel suite re-passed.
- **Production Next/Turbopack build passed at the final runtime fingerprint.**
  Process-only throwaway local auth configuration; no environment file changes.
- **Chromium: four real Pages-router fixture cases passed at the final build.**
  `tests/e2e/distribution-defaults-navigation.spec.js` intercepts all APIs and blocks
  external requests. Shell/tab handlers are invoked through their real DOM/Next
  handlers while the native dialog makes pointer input behind it inert. Back is
  real browser history. No server preference, prepare or send route runs live.
- **Visual check:** expanded editor inspected at desktop and 640px widths, using
  fixture content. Desktop density, wrapping and existing dialog retained. No
  separate operating-system zoom or inbox-delivery acceptance is claimed.
- **Types passed. Scoped ESLint: zero errors, warnings remain**, including the
  established render/ref patterns in the panel and surrounding source. Jest also
  emits existing React act warnings; all asserted tests pass.
- Relevant gates and paired self-tests passed sequentially: API route inventory,
  Atlas, fact consistency, DAL, Dynamics context, route/service boundary, trust
  GUID boundary, lifecycle auth, status enum parity, documentation currency,
  symbol references, build-claim freshness and secret scan. Docs catalog, agent
  invariants, types and whitespace checks passed. This is scoped local evidence;
  the subsequent full GitHub CI passed before release; see the release receipt.

## Independent review chain

| Exact runtime target | Verdict and disposition |
| --- | --- |
| a5f3b6548 | NEEDS CHANGES: F1 GUID case and L1–L5; all addressed and regression-tested |
| 80826ff16 | PASS/no blockers, with N1–N3 and T1–T4; all addressed, including root teardown finding |
| 7ec440049 | NEEDS CHANGES: D1 retained-open prompt could hide Retry after uncertainty; central fresh-init guard added |
| 1215cfd7d | PASS for D1, no introduced safety regression; last required finding closed |

Reports are preserved verbatim in the four dated
`DISTRIBUTION_DEFAULTS_IMPLEMENTATION_CLAUDE_*` receipts. All used ordinary
Claude.ai OAuth/subscription, read-only. No metered review product or delegation.
Root's verification above is separate from each reviewer's stated tests.

## Contract-reconcile and bounded sweep

All nine contract hops are accounted for in the implementation table.
Partial success is one pair or absence-confirmed Clear; uncertain writes require
strict Reload. Async success/error/finally and actual teardown are tested.
Family helpers preserve literal one-send wording and do not copy the agenda's
optional-body policy. Durable storage/migrations are N/A as new infrastructure;
existing preference ownership, route matrix, Atlas consumer, catalog and both
key guard sets were updated. Enum/key fan-out was searched and generic GET/
POST/DELETE exclusions are tested. Complement branches reject/fallback/retain
recovery, rather than assuming success.

Historical implementation-phase sweep (superseded for release state by the release receipt):
Sweep mode A: changed fact was slice 7 branch implementation and independent
verification, **not Production state**. Source and test/browser/build results
establish that fact; the plan, TODO, inventory, route matrix, Atlas and service
catalog are the in-scope durable restatements. The new route updates generated
canonical counts and the technical-brief pointer. September case tables and
plan-review reports are explicitly historical; unrelated email/database work is
excluded. Current in-scope implementation claims agree; no remaining live stale
claim of slice 7 being unstarted or awaiting coding authorization. Historical
baseline counts and transport limitations are not upgraded to live evidence.

## Limits and release boundary

Recovery is memory-only. Intentional departure warns, but a reload/crash loses
the envelope and retains the existing cross-page duplicate-send gap. A refusal
after activity creation remains held under the strict null-ID/no-intent proof.
An open consumed during recovery needs a later ordinary open after resolution.
Browser beforeunload may be suppressed. Existing preference uniqueness and atomic
multi-row Clear are not introduced; duplicates remain repairable. Live tenant
permissions and live preference/send acceptance were not probed.

The owner subsequently authorized release. Integration, full CI, deliberate merge
and Production verification are recorded in the release receipt. Claude's separate
checkout and database work were not modified.
