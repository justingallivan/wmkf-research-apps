---
title: Reviewer Lifecycle Stage 1D — Independent Review
kind: audit
domain: reviewer-workbench
status: complete
canonical: false
owner: product-engineering
last_verified: 2026-09-05
---

# Stage 1D fresh-context independent review

Reviewer context: `/root/stage1d_fresh_review`  
Repository: `/Users/gallivan/Code/WMKF_Apps`  
Branch: `codex/reviewer-lifecycle-approved-policies`  
Frozen runtime/test commit: `c51fa34d8f48f520ebbf40c34965c48dd3e383b9`  
Parent: `95690c75`  
Review date: 2026-09-05

## Verdict

**PASS for the Stage 1D runtime/test change. Required runtime corrections: none.**

[VERIFIED via exact diff, reopened source and independent tests] The approved generic correction policy is enforced at the service and adapter: closed history is protected, the service's server-authorized Request binding and exact fresh version reach the actual conditional PATCH, and rejected corrections stop before token/person follow-up. Dedicated closeout correction and named lifecycle operations remain usable. This is not approval of Stage 1E, Stage 6A, publication or production promotion. The parent owns the full-suite/gates/build and final durable-document closure required by the original report's exit contract G; this review does not assert those checks completed.

No source, test, instruction, git or live-data mutation was performed by this reviewer. Temporary review fixtures and artifacts were written only under `/tmp`.

## Scope and authority

Read CLAUDE.md, SESSION_PROMPT.md, the contract-reconcile and start skills, applicable API/Dataverse/external-reviewer rules, the complete original `docs/audits/REVIEWER_LIFECYCLE_REFACTOR_REPORT_2026-09-04.md` (including F3, Stage 1D and G), and the complete approved-decisions document supplied at review start. Startup git synchronization and global gates were not run: the assignment explicitly designated a frozen branch, prohibited git mutations, and gave those checks to another agent.

- Change surface: block generic invitation/response history corrections on Complete/withdrew/released, unknown/missing source state, or a completion marker, with exact-version and authorized-Request protection.
- Entry points: `/api/reviewer-finder/my-candidates` PATCH; its generic service; direct `updateLifecycle` callers.
- Persistence: existing `wmkf_appreviewersuggestions` fields. No new field, enum, table or schema operation.
- Consumers: existing candidate/reviewer DTOs, invitation outcomes, external engagement state, synthesis/rollup/history readers, closeout and terminal services, test harnesses.
- Prior finding: original report F3. Later F5/UI/batch defects are outside Stage 1D.

Runtime and tests remained exactly frozen at the cited HEAD throughout review. The parent concurrently edited service-catalog, Atlas, wiki, approved-decision and Stage 1D receipt documents; those uncommitted handoff edits are not covered by this runtime verdict.

## Findings

1. **PASS — service rejects closed/complement states before later side effects.**
   Evidence: `lib/services/reviewer-finder/my-candidates-service.js:662` builds exactly the six defined fields, including false/null; `:683` requires separate authority; `:687` rereads; `:694` checks Request binding; `:697` rejects closed/completed state; `:700` allows only explicit null or the four known open statuses; `:703` requires a concrete ETag; `:708` forwards it. Token follow-up begins only at `:734`, person edits at `:744`. Unit and real-adapter closed matrices contain a real linked person and honorarium, so no-write assertions establish exclusion rather than absent fixtures. Receipt alone remains allowed until human closeout.

2. **PASS — route authority is server-derived and the authorized read is not upgraded.**
   Evidence: `pages/api/reviewer-finder/my-candidates.js:57` app access; `:62` post-auth DAL context; `:122` session actor; `:126` actual ownership authorization; `:131` server-returned Request binding; `:139` passes it separately from `body`. `lib/services/reviewer-request-authorization.js:59` resolves suggestion ownership, `:99` reads Requests, `:120` enforces lead PD/superuser, and `:133` returns normalized server ids. Independent extra probes exercised the real authorization helper, route, service, adapter, annotation processing and HTTP transport, mocking only session/role resolution and external I/O. A spoofed body binding was ignored; ownership denial produced 403 without the service row read; reparenting after authorization produced 409 without any write.

3. **PASS — adapter defense covers all six fields and preserves a supplied version.**
   Evidence: `lib/dataverse/adapters/reviewer-suggestion.js:81` raw-field list; `:1797` mapping; `:1852` ignores an empty payload; `:1883` guard read; `:1889` uses own-property presence, not truthiness; `:1891` closed/completed rejection; `:1896` explicit source allowlist; `:1952` keeps the caller's version even when stale or malformed; `:1955` rejects malformed/missing concrete versions; `:1963` forwards the final precondition and actor. `lib/services/dynamics/annotations.js:25` preserves `@odata.etag`; `lib/services/dynamics/write-core.js:163` retains trusted-context enforcement and `:170` sends actual `If-Match`. Numeric 412 is mapped to domain 409 at service `:717`, without a correction retry. A source/binding change before the service read, before the adapter read, or before PATCH cannot overwrite the winning row.

4. **PASS — dedicated and unprotected operations retain their distinct effects.**
   Closeout notes/eligibility correction at `lib/services/review-manager/close-review-service.js:168` does not include any protected invitation/response field; it retains the existing exact ETag and does not restamp receipt/completion. Real composed closeout repeat/correction passed (`tests/integration/reviewer-engagement-contract.test.js:241`). Staff withdrawal still uses `applyStaffReviewerWithdrawal` at `lib/services/review-manager/terminal-transition-service.js:97`, preserving conditional parent-plus-honorarium deletion (`lib/dataverse/adapters/reviewer-suggestion.js:2095`). Release still uses status/token revocation at terminal service `:106`. External accept/decline still uses the separate `applyStage2aResponse` writer at adapter `:1989`. Pending-invitation withdrawal at `lib/services/review-manager/withdraw-sufficient-service.js:265` remains an open-source response update. Confirmed manual invitation at candidate service `:639` passed an additional real-adapter token/version probe. Deadline, reminder, courtesy, metadata and legacy selection-repair payloads contain no protected field and retain their contracts.

5. **PASS — already-delivered invitation failure stays visible.**
   Evidence: `lib/services/review-manager/send-emails-service.js:913` stamps inline after transport; `:920` catches stamping failure and sets `inviteRecorded:false`; `:926` records the successful delivery. Three independent extra probes changed the row to Complete/withdrew/released during delivery. Each preserved the winner, performed no correction PATCH, sent once, and returned the delivered event with `inviteRecorded:false`. This does not establish a new pre-send terminal authorization gate.

## New issues

No newly introduced blocking runtime defect found. Recommendations: N/A; no implementation change is requested by this review.

## Tests actually run

All successful review runs used fake external I/O. The composed suites keep real services/adapters/DAL/context/annotation/write transport above a strict in-memory HTTP boundary. The boundary's unexpected-request inventory and explicit SQL mocks are checked; no unexpected external request/SQL invocation occurred. Expected error-envelope test logs are present in the core run and are not missing-connection fallbacks.

1. `./node_modules/.bin/jest --runInBand --watch=false --runTestsByPath tests/unit/my-candidates-service.test.js tests/unit/reviewer-suggestion-disposition.test.js tests/integration/my-candidates-route.test.js tests/integration/reviewer-engagement-races.test.js --json --outputFile=/tmp/reviewer-stage1d-fresh-core.json`
   **4 suites, 486 tests passed; 0 failed/skipped.** Log: `/tmp/reviewer-stage1d-fresh-core.log`.
2. `./node_modules/.bin/jest --runInBand --watch=false --runTestsByPath tests/integration/reviewer-engagement-contract.test.js tests/unit/reviewer-request-authorization.test.js tests/unit/reviewer-suggestion-withdrawal.test.js tests/unit/withdraw-sufficient-service.test.js tests/unit/reviewer-closeout-service.test.js --json --outputFile=/tmp/reviewer-stage1d-fresh-preserved.json`
   **5 suites, 98 tests passed; 0 failed/skipped.** Log: `/tmp/reviewer-stage1d-fresh-preserved.log`.
3. `STAGE1D_FRESH_PROBES=on ./node_modules/.bin/jest --config=/tmp/reviewer-stage1d-fresh-jest.cjs --runInBand --no-cache --watch=false --runTestsByPath tests/integration/reviewer-engagement-races.test.js --testNamePattern=FreshStage1D --json --outputFile=/tmp/reviewer-stage1d-fresh-extra.json`
   **7 independently added composed probes passed.** The 185 existing race tests were intentionally unselected in this extra-only run; they passed in item 1. Extra source is `/tmp/reviewer-stage1d-fresh-extra-tests.js`. Log: `/tmp/reviewer-stage1d-fresh-extra.log`.

**Total independent successful assertions: 591 tests.**

Read the supplied red artifacts rather than taking their names as proof: focused red has 154 failures / 15 passes, with representative protected writes resolving when rejection was expected; composed red has 106 failures / 1 pass, including a closed row returning success with the mixed person correction. Supplied green/compatibility artifacts were inspected but are not counted as independently executed tests above.

### Discriminating mutation evidence

The temporary SWC wrapper `/tmp/reviewer-stage1d-fresh-transform.cjs` rewrites only the module source passed into the compiler, never checked-out files. Each anchor is required to occur exactly once. Each mutation was run against all four core suites with `--no-cache`, the same temporary config and `STAGE1D_FRESH_MUTATION=<name>`. Each result contains 486 executed tests and exited nonzero due to failed assertions, not parse/fixture failure.

| Deliberately broken behavior | Failed tests | What falsified it |
|---|---:|---|
| Disable adapter protected-field detection | 93 | Closed raw writes and missing-version cases reached persistence |
| Use value truthiness instead of own-property presence | 44 | Defined false/null corrections bypassed the guard |
| Replace supplied ETag with newer adapter-read version | 13 | Stale/malformed caller versions stopped being preserved/rejected |
| Apply the new guard to every lifecycle payload | 26 | Existing notes/courtesy/terminal/closeout behavior was blocked |
| Remove service Request-binding comparison | 6 | Reparented suggestions could be corrected or produced wrong envelopes |
| Omit service's exact ETag | 11 | Reparent/nonterminal changes could borrow a newer adapter version |
| Remove service unknown-state rejection | 6 | Missing/unknown source stopped failing at the service boundary |
| Remove service closed/completion rejection | 104 | Closed states reached adapter/mixed-update boundaries incorrectly |

Artifacts: `/tmp/reviewer-stage1d-fresh-mutations.json` and `/tmp/reviewer-stage1d-fresh-mutant-<name>.{json,log}`. These mutations prove the tests distinguish material failure modes, including preservation of allowed siblings.

## Contract-reconcile audits and fan-out

- **Whole flow:** traced current UI callers and request bodies, route auth/ownership, fresh service state, adapter mappings, actual If-Match transport, domain response and read consumers. Current UI PATCH callers are CandidateEditModal person edits, ReviewerInvitePanel restore, and InviteEmailModal named manual-invitation recording. Generic correction remains a live service/route compatibility surface. Review-manager's separate generic status route only constructs `reviewStatus` (`pages/api/review-manager/reviewers.js:133`).
- **Partial success:** Stage 1D makes precommit correction rejection precede token/person writes. It does not promise an atomic lifecycle/token/person transaction after successful persistence (`my-candidates-service.js:729`). Existing token failure tolerance and person-order/duplicate-email behavior remain. Batch F5 is deliberately unchanged and still characterized.
- **Async/stale state:** exact ETag covers suggestion changes through the conditional PATCH, including Request reparenting. Three race windows crossed four competing outcomes, plus a nonterminal edit, preserve the winner. Existing UI generation behavior was inspected, not redesigned; later Stage 1E/6B remain separate.
- **Helper extraction:** N/A; no extraction. The new predicate is deliberately limited to six fields so notes, eligibility, courtesy and specialized terminal effects are not collapsed.
- **Durable surface:** no new schema/enum/store/route; existing projection includes Request binding, status, completion marker and all six fields (`lib/dataverse/core/entity-registry.js:121`). Source contract comments changed. Parent is reconciling durable handoff docs and running gates.
- **Doc reconcile:** original report and approved policy were read in full as authority. Concurrent final handoff docs are parent-owned; no independent whole-repo documentation closure claim.
- **Symbol fan-out:** searched raw `wmkf_invited`, `wmkf_accepted`, `wmkf_declined`, `wmkf_emailsentat`, `wmkf_responsetype`, `wmkf_responsereceivedat`, plus sibling terminal signals `wmkf_reviewstatus`/`wmkf_completedat`, across lib/pages/shared/scripts/tests/docs. The inverse response map remains derived from the write map at adapter `:52`. Candidate projection (`my-candidates-service.js:301`), reviewer projection (`reviewers-service.js:255`, `:303`), external selection/state (`verify-suggestion-token.js:20`, `review-engagement-state.js:45`), engagement/history projection, rollup (`reviewer-rollup.js:79`) and synthesis (`review-synthesis-readiness.js:56`) retain existing raw values and semantics. No value or DTO was added, removed or renumbered.

Direct `updateLifecycle` caller regions read: candidate generic/manual invite; review-manager closeout/terminal/status/send/withdraw-sufficient; external respond legacy selection repair; due extension; reminder sweep; adapter bulk metadata; and administrative `scripts/backfill-postgres-to-dataverse.js:243`. The backfill now inherits the same closed-history guard and is not a authorized historical-repair bypass. Raw `patchFields` callers remain separate; legacy generate-email markAsSent at `lib/services/reviewer-finder/generate-emails-service.js:501` is an explicitly accepted remaining boundary, not a claim of global writer closure.

Search/inventory artifacts: `/tmp/reviewer-stage1d-fresh-callers.txt`, `/tmp/reviewer-stage1d-fresh-field-fanout.txt`, `/tmp/reviewer-stage1d-fresh-field-files.txt`, `/tmp/reviewer-stage1d-fresh-directory-inventory.txt`. Search commands included `codegraph explore "Stage1D reviewer lifecycle report approved decisions terminal guards response corrections"`, `codegraph explore "patchMyCandidates updateLifecycle authorizeReviewerRequestMutation handlePatch"`, `rg -n 'updateLifecycle\(|patchMyCandidates\(' lib pages shared scripts tests`, and raw-field `rg` scans described above. Exact seven-file commit diff was read. No repository files were modified by the reviewer.

## Named limits

- No live Dataverse/OAuth/session/provider/email/cron operation, schema change, migration, backfill, deployment or publication. The HTTP fake demonstrates the client precondition and interleavings; it is not independent proof of the Dataverse server's live concurrency configuration or transaction engine.
- Session/app-role resolution was mocked for the extra route probes. Real authorization helper, Request lookup, binding, context, service, adapter and transport were retained. The unchanged app guard was source-reviewed; no signed-in browser smoke was performed.
- Separate Request ownership changes are not locked by a suggestion ETag. Restore can reset an engagement without a separate generation id. These preexisting boundaries are explicitly recorded in the approved contract.
- Postcommit token/person failures, legacy generate-email raw stamping, historical malformed response values, and broader generic-status/UI/batch issues are not solved by this six-field source guard. No automatic transport resend or rollback was introduced.
- Global tests, global gates/self-tests, build and concurrent final documentation were assigned elsewhere and were not rerun here. Final stage completion still requires their receipts.

**Final independent runtime verdict: PASS. Required runtime changes: none.**
