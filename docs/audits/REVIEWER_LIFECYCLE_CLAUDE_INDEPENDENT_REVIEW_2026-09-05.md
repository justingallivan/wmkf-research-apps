---
title: Reviewer Lifecycle — Claude Independent Review of Stages 1B–6A
kind: audit
domain: reviewer-workbench
status: complete
canonical: false
owner: product-engineering
last_verified: 2026-09-05
---

# Reviewer lifecycle — independent Claude review (frozen branch)

Reviewer: Claude (Fable 5.1), interactive OAuth session, read-only review.
Date: 2026-09-05. No Codex, Ultrareview, or metered review product was used.
No source, test, instruction, memory, or session-note file was changed. This
report is the only repository edit.

## 1. Scope

| Item | Value |
|---|---|
| Branch | `codex/reviewer-lifecycle-approved-policies` |
| Base | `4839444c1223ed109146549527b09fe8c7a22dcd` |
| HEAD | `ca6f933eb50c73d4d448d22f7d9e512134d66642` |
| Working tree at start | clean (`git status --porcelain` empty) |
| Working tree at end | clean apart from this report |
| Diff reviewed | complete `base..HEAD`: 32 files, +4,625 / −450; 12 commits |

[VERIFIED via `git branch --show-current`, `git rev-parse HEAD`, `git status --porcelain`]
Branch, HEAD, and tree matched the frozen scope; no discrepancy to report.

Runtime files in the diff: `lib/dataverse/adapters/reviewer-suggestion.js`,
`lib/services/review-manager/reviewers-service.js`,
`lib/services/review-manager/send-emails-service.js`,
`lib/services/reviewer-finder/my-candidates-service.js`,
`pages/api/review-manager/reviewers.js`, `pages/api/review-manager/mark-received-no-file.js`
(header only), `pages/api/reviewer-finder/my-candidates.js`,
`shared/components/reviewers/ReviewerManagePanel.js`, plus `.impeccable/config.json`,
eight test files, and eleven documentation files.

Method: own findings were formed from source, callers, and tests first; the
prior Stage 1B/1C/1D/1E/6A review and receipt documents were read afterwards
and cross-checked. CodeGraph context was used for orientation; line-level
evidence below comes from the checked-out source at HEAD.

## 2. Findings, ordered by severity

No High or Medium defect was found. Two Low newly introduced defects, one
pre-existing risk worth a precheck, and several observations follow.

### L1 (Low, newly introduced) — adapter pre-read validation failures are reported as "attempted, unconfirmed" outcomes

- **Evidence.** `lib/services/review-manager/reviewers-service.js:514-523` wraps the
  whole `updateLifecycle` call in the attempted-operation `try`. Inside the adapter,
  the payload is built before any Dataverse read (`lib/dataverse/adapters/reviewer-suggestion.js:1830-1850`),
  and `mapPicklist` throws for an unknown status string at `:202`. The guard read
  happens later at `:1883`. So a validation failure surfaces as
  `ReviewerStatusMutationError` with `failedIds=[target]`.
- **Trigger.** `PATCH /api/review-manager/reviewers` with `reviewStatus: "bogus"`
  (single or batch). The route only checks `reviewStatus !== undefined`
  (`pages/api/review-manager/reviewers.js:110,137`); the service precheck at
  `reviewers-service.js:498-511` rejects only complete/terminal.
- **Reproduction.** Temporary probe (real service and real adapter, `DynamicsService`
  methods stubbed): single call returned `ReviewerStatusMutationError`,
  `failedIds=[A]`, with **zero** `getRecord`/`updateRecord` calls; batch `[A,B]`
  returned `savedIds=[]`, `failedIds=[A]`, `notAttemptedIds=[B]`, zero reads.
  Probe log: `/tmp/claude-review-484/probe-validation.log` (4/4 passed).
- **Impact.** The response is HTTP 500 with `success:false` and outcome arrays for
  an input error that was never sent to Dataverse. The UI then tells staff to
  "Review the current status before submitting another update" and, outside
  development, hides the reason (`details` is dev-only). The route header's claim
  that "Pre-write validation/auth errors stay error-only" (`reviewers.js:28`) and
  the decisions document's "A failed id denotes an attempted, unconfirmed outcome"
  are not true for adapter-level validation. Not reachable from the shipped select
  (settable statuses are constrained at `ReviewerManagePanel.js:256-260`), but
  reachable through the API. Conservative direction (over-reports uncertainty),
  which is why this is Low.
- **Smallest correction.** In `patchReviewers`, after the complete/terminal
  precheck, reject any status that is not a `REVIEW_STATUS_MAP` key (or a numeric
  value in the map) with a `ServiceHttpError` 400 so validation stays outside the
  attempted wrapper. The prior Stage 6A review treated adapter-typed errors inside
  the wrapper as intended; this review disagrees for the pre-read validation case
  on the strength of the probe above.

### L2 (Low, newly introduced) — single-path `savedIds` echoes the raw body id; batch canonicalizes

- **Evidence.** `reviewers-service.js:510-513` uses `[suggestionId]` for the single
  path and `[...new Set(suggestionIds.map(id => id.trim().toLowerCase()))]` for
  batch. The route forwards the body value untrimmed (`reviewers.js:132-148`;
  `isGuid` trims for validation only, `lib/utils/guid.js:41`).
- **Reproduction.** Probe: single call with `" <UPPER-GUID> "` returned
  `savedIds: [" <UPPER-GUID> "]`; batch with the same value returned the
  lower-cased trimmed GUID.
- **Impact.** None functionally today: the UI normalizes both sides
  (`ReviewerManagePanel.js:1843,1904-1905`). The route header ("confirms every canonical
  unique target in `savedIds`", `reviewers.js:26`) overstates the single path, and
  the untrimmed id also reaches the adapter selector (pre-existing).
- **Smallest correction.** Normalize the single target the same way, or narrow the
  header wording to the batch path.

### P1 (Low, pre-existing, same path at base) — `reviewStatus: null` or `""` clears the recorded status

- **Evidence.** `mapPicklist` returns `null` for `null`/`undefined`/`""`
  (`reviewer-suggestion.js:198`), and `updateLifecycle` writes any non-`undefined`
  value (`:1831`). The route accepts `null` because it only tests `!== undefined`.
- **Reproduction.** Probe: `lifecycle: { reviewStatus: null }` on an open row produced
  one `updateRecord` with `{ wmkf_reviewstatus: null }`.
- **Impact.** An authorized lead PD or superuser can clear a status through the
  generic route. The closed-source guard still blocks this on complete/withdrew/released
  rows (`:1902-1911`). The shipped select never sends an empty value. Unchanged by
  this branch; recorded because L1's precheck is the natural place to close it.

### Observations (not defects)

- **O1 — success `alert()` on every structured success.** `ReviewerManagePanel.js:1940-1942`
  raises a modal alert after each confirmed status save when the server returns
  outcome keys, which the new server always does. The panel already used `alert`
  for feedback (9 call sites at base, 12 at HEAD), so this is consistent with the
  existing convention, but it is a new interruption on the happy path. Product
  call, not a defect.
- **O2 — Stage 1B retry treats a guard-GET 412 as retryable.** Already documented
  in the Stage 1B review and receipt. Reread and agreed; the retry still re-reads
  and writes conditionally, so no unsafe write follows.
- **O3 — two Dataverse reads per protected correction or bookkeeping attempt.**
  The service `findById` plus the adapter's guard read. Performance only.
- **O4 — unknown-template throw in `recordDeliveredEmail` is unreachable.**
  `send-emails-service.js:133` throws for a template other than
  materials/followup/thankyou, but `isKnownTemplateType` rejects anything outside
  the four known types before any send (`:265`, `lib/utils/reviewer-invite.js:49-57`),
  and invitations bypass the post-loop (`:998`). No new warning path.

## 3. Classification

| Class | Items |
|---|---|
| Confirmed newly introduced defects | L1, L2 (both Low; neither blocks) |
| Confirmed pre-existing risk | P1 |
| Unverified concerns | none remaining; O1 is a product judgement |
| Accepted policy / documented limits (agree) | status-only writes may use the guard-read ETag; suggestion ETag does not lock Request ownership; remove/restore generation reuse; failed id may have committed; mutex is per mounted panel; host callbacks do not certify refresh; inline invitation stamp may return `inviteRecorded:false` on a now-closed row; backfill script inherits the six-field guard; legacy generate-email raw markAsSent remains a separate boundary |
| Deferred by decision | mechanical Stages 2–5; general 6B/6C extraction; batch UI |

## 4. Whole-flow and cross-stage conclusions

Contract-reconcile Mode A trace (all hops accounted for; none skipped):

| Hop | Stage 1B (post-send bookkeeping) | Stage 1D (generic correction) | Stages 1E/6A (status PATCH) |
|---|---|---|---|
| Caller / client state | Email modal → `sendEmails` (unchanged) | CandidateEditModal / InviteEmailModal → `PATCH my-candidates` | Row select → `updateStatus`, synchronous per-row mutex `ReviewerManagePanel.js:1834-1836` |
| Route auth/validation | unchanged | `my-candidates.js:124-134` authorizes, then passes server-resolved `requestIds[0]` separately from body | `reviewers.js:56-64` access guard; batch GUID validation `:116`; whole-batch `authorizeReviewerRequestMutation` before service `:119-123` |
| Service | `recordDeliveredEmail` `send-emails-service.js:127-199` | `patchMyCandidates` `:682-716` | `patchReviewers` `:493-532` |
| Persistence | `updateLifecycle` with exact fresh `_etag` `:188-191` | `updateLifecycle` with exact fresh `_etag` `:708-711` | `updateLifecycle` per canonical target, sequential, stop-first-failure `:514-523` |
| Adapter guard | closed-source status guard `:1902` applies to bumps | six-field guard `:1889-1900`, strict version `:1951-1960` | closed-source status guard `:1902` |
| Response | SSE progress warning on failure `:1012-1017`; `sent[]` intact | 400/404/409 typed envelopes; 412 → `correction_conflict` | 200 + arrays; 500 + `success:false` + arrays only for `ReviewerStatusMutationError` `reviewers.js:154-170` |
| Consumer | unchanged DTO/history | unchanged DTO | UI validates identity/HTTP/partition `:1889-1926`; refresh only after confirmed success `:1931-1942` |

Cross-stage checks [VERIFIED via source]:

- **1B ↔ 1D.** Bookkeeping payloads contain none of the six protected fields, so
  the Stage 1D adapter guard never blocks Stage 1B; thank-you after closeout is
  allowed by both (`send-emails-service.js:156,182`; adapter guard keyed on
  `INVITATION_RESPONSE_FIELDS` only).
- **1D ↔ 6A.** Status-only batch writes carry no protected field, so the strict
  ETag requirement does not apply; they still hit the extended closed-source
  status guard (complete now included, `reviewer-suggestion.js:77-80,1902`).
- **1D caller census.** All `updateLifecycle` callers were read
  (`rg "updateLifecycle\(" lib pages scripts`). Writers of protected fields:
  inline invitation stamp (`send-emails-service.js:913`), manual-invite recording
  (`my-candidates-service.js:639`, passes ETag), pending-invitation withdrawal
  (`withdraw-sufficient-service.js:265`, null-status source, passes ETag), generic
  correction, and the administrative backfill script. External accept/decline use
  separate adapter writers, not `updateLifecycle`. No unintended caller is blocked.
- **Authorization vs. normalization.** The authorization helper and the service
  normalize identically (trim + lowercase + first-occurrence dedupe,
  `reviewer-request-authorization.js:25` vs `reviewers-service.js:511`), so every
  written target was authorized. Authorization runs before any write; failures
  keep the error-only envelope.
- **1E currentness.** Request/mode/permission changes bump an epoch; observed row
  absence permanently invalidates; unmount invalidates; cleanup is token-owned and
  releases the mutex even after invalidation (`ReviewerManagePanel.js:1655-1686,1943-1953`).
  Both hosts (`ReviewersTab.refreshAll`, `reviewer-follow-up.loadProposals`) keep
  `proposal.proposalId` stable across refresh, so a normal refresh does not
  invalidate feedback. On the follow-up page a proposal that no longer needs
  attention can unmount the panel after refresh, which suppresses the success
  alert by design.
- **Receipt semantics (1C).** `mark-received-no-file-service.js:90` sets
  `wmkf_reviewstatus = review_received`; the corrected route header now matches.
  No receipt code changed on this branch.

Seven audits: whole-flow PASS; partial-success PASS (unit is the row; identifiers
returned; UI refreshes only on confirmed success; `success:true` impossible with
any failed row); async/stale-state PASS with the documented per-panel limit;
helper-extraction N/A beyond a narrow error carrier; durable-surface N/A (no new
table/field/enum/route; Atlas/catalog/wiki updated); doc-reconcile see §6;
symbol fan-out PASS (no new persisted value; raw six fields and status grep
showed no reader change needed).

## 5. Tests, gates and experiments actually run

All commands ran from the repo root at HEAD `ca6f933e`. Logs under
`/tmp/claude-review-484/`.

| Check | Command | Result |
|---|---|---|
| Focused suites | `npx jest` on the 8 changed test files | 8 suites / 1,213 tests passed |
| Full suite | `npx jest` | **770 suites / 10,850 tests passed**, 0 failed/skipped (29.4 s) |
| Webpack build | `npm run build -- --webpack` | exit 0; tree unchanged afterwards |
| Changed-file lint | `npx eslint` on the 8 changed runtime files | 0 errors, 9 warnings (pre-existing panel warnings) |
| Gates (sequential, gate then self-test) | 38 commands: api-routes, atlas, route-lifecycle-auth, route-service-boundary, trust-boundary-guid, dataverse-access-layer, dynamics-context-boundary, odata-escape, status-enum-parity, doc-currency, fact-consistency, agent-wiki, docs-catalog, doc-symbol-refs, build-claim-freshness, canonical-pointers, agent-invariants, instruction-architecture, migrations-manifest, scaffolding-tokens, harness-framing, each with its self-test where one exists | all 38 exit 0 (`gates-summary.log`) |

Mutation probes (temporary in-place edits, each restored with `git checkout`
before the next; tree verified clean after the run):

| Mutation | Suites | Result |
|---|---|---|
| Adapter: disable six-field detection | 1D set (507 tests) | 93 failed — detected |
| Adapter: borrow guard-read ETag when supplied one is falsy | 1D set | 2 failed — detected |
| Send-emails: materials bump ignores receipt | 1B set (337) | 2 failed — detected |
| Send-emails: retry on any error, not only 412 | 1B set | 9 failed — detected |
| Send-emails: use pre-send snapshot status | 1B set | 9 failed — detected |
| Service: `savedIds` includes the failed target | 6A set (323) | 36 failed — detected |
| Service: no deduplication | 6A set | 6 failed — detected |
| Route: drop `success:false` from 500 body | 6A set | 27 failed — detected |
| UI: remove synchronous mutex | status suite (458) | 2 failed — detected |
| UI: accept any 2xx as confirmed | status suite | 6 failed — detected |
| my-candidates: ignore `wmkf_completedat` | 1D set | 1 failed — detected |
| UI: remove currentness check between JSON parse and outcome evaluation | status suite | **458 passed — not detected** |

The one survivor is behavior-equivalent: every downstream feedback path
(`reportUnconfirmed`, the pre-refresh `isCurrent()` at `:1931`, and the
post-refresh checks) re-checks currentness, so removing that single check has no
observable effect. It is redundant defensive code, not a coverage gap.

Additional probe: a temporary Jest file exercising real `patchReviewers` and the
real adapter with stubbed `DynamicsService` methods (4/4 passed; results in §2 L1,
L2, P1).

Method deviations, disclosed: the probe test was written under `tests/` (Jest
`rootDir` constraint) and deleted immediately; the mutation runner edited
working-tree files in place and restored them via `git checkout`. `git status`
was clean after both. Temporary logs live under `/tmp/claude-review-484/`.

Coverage gaps and limits: no live Dataverse, email, cron, browser, or deployment
check; Impeccable was not rerun; 38 of the receipts' 59 gate commands were rerun
here (the 59 figure is inherited); the composed HTTP fake models conditional
writes but is not proof of live Dataverse concurrency behavior; StrictMode/normal
rendered tests cover the panel but no signed-in smoke was performed.

## 6. Documentation discrepancies and completion claims

- **Overstated (minor).** `pages/api/review-manager/reviewers.js:26-28` header and
  the decisions document's "A failed id denotes an attempted, unconfirmed outcome":
  adapter-level validation failures are classified as attempted without any read
  or write (L1). "Every canonical unique target in `savedIds`" holds for batch only (L2).
- **Verified claims.** Full-suite counts (770 / 10,850) match this run exactly.
  Webpack build passes. Changed-file lint warnings: nine, unchanged (matches
  SESSION_PROMPT). Arial exceptions: exactly five `Arial` declarations in
  `send-emails-service.js`, and the two ignore entries in `.impeccable/config.json`
  name only that file and only the two font rules, so the exception is narrow
  (six other email/HTML renderers also use Arial and carry no exception; they were
  outside this branch's scope). Receipt header for the no-file route matches the
  service. Wiki, Atlas, and catalog entries cited line ranges that match HEAD.
- **Publication claims.** [VERIFIED against local remote refs, no fetch] base
  `4839444c` is on `origin/codex/reviewer-lifecycle-stage1a`; no local remote ref
  contains `08752364` or HEAD. This agrees with "Stage 1A was previously published;
  later commits remain local." Remote refs were not refreshed, so this is local-ref
  evidence only.
- **No overstatement found** of deployment (all docs say "deployment pending"),
  atomicity (docs state no rollback), idempotency (docs disclaim replay/cross-tab
  locks), or refresh guarantees (docs disclaim void/self-catching callbacks).
- **Inherited, not verified here.** The 59-command gate battery count, the earlier
  reviewers' 15/8/7 mutation tables, and Impeccable results.

## 7. Final verdict

**PASS with named Low findings.** No blocking defect was found in the Stage 1B,
1C, 1D, 1E, or 6A changes, in their interactions, or in the shared adapter change's
effect on unchanged callers. The approved intent for each stage is implemented as
described, and the checked-in tests distinguish material breakage (11 of 12
independent mutations detected; the survivor is behavior-equivalent).

Reasons: full suite, build, and 38 gates green on this run; whole-batch
authorization precedes writes with identical normalization; closed history is
protected at both service and adapter with strict versions; post-send bookkeeping
uses fresh state and exact ETags with bounded 412-only retry and no resend; status
feedback distinguishes confirmed, unconfirmed, and refresh-failed outcomes with a
synchronous per-row mutex.

Recommended before or shortly after publication (non-blocking): add the
`REVIEW_STATUS_MAP` precheck in `patchReviewers` (closes L1 and P1 together),
normalize the single-path `savedIds` (L2), and soften the two header/decision
sentences named in §6. Publication and production promotion remain owner
decisions outside this review.
