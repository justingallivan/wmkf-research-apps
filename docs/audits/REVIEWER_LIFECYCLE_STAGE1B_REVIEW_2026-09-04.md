---
title: Reviewer Lifecycle Stage 1B — Fresh-context Review
kind: audit
domain: reviewer-workbench
status: complete
canonical: false
owner: product-engineering
last_verified: 2026-09-04
---

# Reviewer lifecycle Stage 1B — independent fresh-context review

Review context: `/root/stage1b_fresh_review` (ordinary native subagent, independent of the builders).
Repository: `/Users/gallivan/Code/WMKF_Apps`.
Implementation commit: `087523643d27d0896efb16f374920417bde515b4`.
Base: `4839444c`.
Review scope: Stage 1B non-invitation post-send bookkeeping and its consumers; no approval of another stage, merge, deployment, live operation, or paid review product.

## Findings / New issues

1. **RESOLVED P3 — Receipt 412 provenance wording qualified during review.**
   Evidence: `docs/audits/REVIEWER_LIFECYCLE_STAGE1B_RECEIPT_2026-09-04.md:43`–47 at the time of review says only a numeric HTTP 412 “from the conditional write” permits another attempt and that read errors warn. `lib/services/review-manager/send-emails-service.js:187`–197 catches the entire `updateLifecycle` promise; that adapter includes a guard GET at `lib/dataverse/adapters/reviewer-suggestion.js:1862`, as well as the PATCH at 1917. A temporary composed experiment returned HTTP 412 from that guard GET once. The service reread, then committed one conditional PATCH, with one email send and no warning. The code checks numeric status, not read-versus-write provenance.
   The orchestrator narrowed the receipt wording to numeric 412 from the adapter update call, explicitly distinguished the helper's direct fresh-read errors (which are outside the retry catch), and recorded the internal guard-read edge. I reread the complete corrected receipt and verified this correction. No runtime source changed. If operation provenance were itself a strict requirement, error origin would need to be preserved before deciding to retry. No unsafe overwrite or email resend occurred in this experiment, and it does not invalidate the F4 repair. This was a documentation precision correction, not a recommendation to broaden this stage's runtime patch. It is now a documented limitation, with no outstanding source-required finding.

**No actionable runtime defect found within the ratified Stage 1B contract.** F4's stale receipt regression and lost concurrent increment are repaired at this commit. Evidence and limits follow; this is not a live Dataverse correctness claim.

## Surface and prior findings

- Change surface: one private post-send bookkeeping helper in the existing email service, plus unit and composed-race coverage. The implementation diff contains exactly `lib/services/review-manager/send-emails-service.js`, `tests/unit/send-emails-service.test.js`, and `tests/integration/reviewer-engagement-races.test.js`.
- Entry points: reviewer email dialogs → authenticated `POST /api/review-manager/send-emails` → `sendEmails`.
- Persistence: existing `wmkf_appreviewersuggestions` fields and existing row ETag. No new durable object, schema, enum, route, or public service export.
- Consumers: per-recipient SSE events and terminal summaries, reviewers DTO, status pipeline, reminder/history displays, existing manual/automated reminder and thank-you protocols.
- Prior finding: F4 (stale status decisions and stale reminder counts). F2 is prior Stage 1A; F3/F5 remain intentionally characterized and were not reopened as Stage 1B findings. The four-producer receipt contract remains green.

The complete historical refactor report and the complete in-progress Stage 1B receipt were read. The latter changed only as the orchestrator added evidence; no runtime source changed during review. The complete contract-reconcile skill and CLAUDE instructions were read. Mode A was used.

## Whole-flow evidence

[VERIFIED via source and focused tests]

1. **Client and request.** `ReviewerManagePanel.js:884`–1000 constructs sendable drafts and retains the established template/attachment/markAsSent payload. It captures a modal session epoch at 905, checks it after fetch and stream reads, handles `progress`, `email_sent`, `email_failed`, `result`, `complete`, and `error` at 969–991, and checks epoch again on failure. `ReviewersTab.js:139`–161 has request/generation checks on its refresh success, error, and loading completion. These paths are unchanged.
2. **Route authorization and wire contract.** `pages/api/review-manager/send-emails.js:56`–126 checks POST, application access, session sender/actor, rate limit and full-batch ownership before SSE; it establishes trusted DAL context around the service call and serializes the existing event vocabulary. No caller-supplied actor or new authorization bypass was introduced.
3. **Delivery and recording are separate.** The transport dispatch is still at `send-emails-service.js:887`–889, outside and before the retry helper. Invitation stamping remains inline at 905–919 before `email_sent`; non-invitation recording occurs only after delivery at 999–1023 and only when `markAsSent` is enabled. Capture behavior is preserved.
4. **Fresh state and binding.** `send-emails-service.js:136`–152 rereads the suggestion for each attempt, compares the original request and person bindings case-insensitively, rejects missing bindings, and requires a concrete syntactically valid ETag. The pre-send recipient object is used only as the original binding reference, not for status/count decisions. `findById` rejects excluded rows at `reviewer-suggestion.js:1204`–1209.
5. **Persistence mapping and lock.** `updateLifecycle` maps timestamp/count/status fields at `reviewer-suggestion.js:1790`–1799. Its explicit caller ETag takes precedence over its own later read at 1915–1919. `dynamics/write-core.js:168`–189 enforces trusted context and forwards the same value as HTTP `If-Match`; numeric transport status is retained in its service error. `dynamics/read-ops.js:115`–139 and `dynamics/annotations.js:23`–26 preserve `@odata.etag` as `_etag`. The composed races assert actual HTTP headers and final stored rows, not just mocked adapter options.
6. **Outcome.** `send-emails-service.js:1016`–1023 emits the existing nonterminal progress warning on bookkeeping failure. The delivered object remains in `sent[]`, with its suggestion/email identifiers; terminal `result` and `complete` remain at 1076–1102. Bookkeeping does not add a failed email or invoke transport again.
7. **DTO and rendering.** `reviewers-service.js:255`–257 maps raw status, while 322–342 projects materials/reminder/thank-you stamps, count and receipt independently. The established accepted fallback for unknown raw status remains preexisting and is not used to authorize the new helper. `reviewer-modes.js:16`–41 still includes all seven established states. Existing activity history reads each timestamp independently; a recorded message does not require a status advance to remain visible.

## Seven audits

| Audit | Result and evidence |
|---|---|
| Whole-flow | PASS for changed behavior; all caller → route → service → adapter → HTTP → SSE/DTO hops above inspected. No browser/live server claim. |
| Partial-success | PASS: per-recipient sent identifiers survive recording errors; subsequent recipients continue. Unit regression explicitly fails the first bookkeeping row and verifies the second still records. Existing transient warning is not a durable repair queue or new recovery DTO. |
| Async / stale-state | PASS within the row-version scope: every helper retry rereads and rebuilds state, and its exact ETag conditions the write. Closed/received/rebound races during delivery and between read/PATCH are composed tests. Existing UI epoch and loader checks remain unchanged. Separate request ownership changes and same-id engagement generations are named limitations below. |
| Helper extraction | PASS: private, fixed three-template bookkeeping helper; unsupported types reject. Invitation remains outside it. Manual thank-you writes only its timestamp, including after closeout; no receipt/accepted/selected/response/revocation predicate added. Automated pre-send claims are unchanged. |
| Durable surface | N/A for new table/schema/migration/enum/security registration; none added. Existing fields are already selected by the entity registry. Source header updated and runtime tests cover the changed contract. Orchestrator's 59 gate outputs inspected separately below. |
| Doc reconciliation | The complete historical report is treated as historical baseline; in-progress receipt read in full and challenged. One low-priority wording issue was corrected and the complete receipt reread, as above. Whole-repo `/sweep` edits and final durable handoff reconciliation belong to the orchestrator, not this read-only subtask; no unverified claim of having performed them. |
| Symbol-consumer fan-out | PASS for bounded Stage 1B change: raw status/receipt/completion/count/timestamp search in lib/pages/shared/scripts saved under `/tmp/reviewer-stage1b-field-fanout.log`. Entity registry projection, adapter mapping, DTO/status map, UI/history, reminder and thank-you writers, and reset definitions inspected. No new value or projection requiring a symmetric-map update. |

## Branch complements and preserved differences

[VERIFIED via source, 313 focused tests, mutation tests, and additional probes]

- Missing row, excluded row, malformed or missing ETag, missing/changed request or person: no unconditional write; delivery retained. Exclusion after materials, follow-up and thank-you delivery was additionally tested below the real adapter.
- Valid ETags: both strong and weak quoted tags accepted and forwarded exactly; no wildcard/trim fallback. The original request/person binding case comparison does not depend on optional parent hydration succeeding.
- Receipt timestamp OR raw Review Received suppresses status advancement; materials delivery still stamps and follow-up delivery still stamps/increments. Timestamp-only receipt on an old accepted status has non-vacuous unit and composed coverage.
- Materials status bump: only null/undefined or accepted, and only without receipt evidence. Known later open/received states are stamp-only. Follow-up bump: only accepted/materials_sent without receipt evidence. Null follows historical stamp/count-only semantics.
- Complete/withdrew/released, unknown nonnull state, or independent completion timestamp block materials/follow-up recording. Integer-string, empty string, and unknown numeric complements are explicitly covered. Thank-you remains independent and stamp-only on those lifecycle states; it still requires binding/version and honors exclusion.
- Reminder count: nullish becomes zero; integer zero and positive counts increment; negative/fractional/string/empty/NaN/infinite/Int32-max values reject; the largest incrementable value reaches Int32 max. No wrapping or string concatenation.
- Later existing delivery timestamp is retained while count increments. Same-version competing reminders produce one 412, fresh reread, and two persisted increments for two successful deliveries.
- Only strict numeric `.status === 412` on the adapter update promise retries; string `412`, 400/404/409/429/500/undefined do not. The helper's direct fresh GET is outside the catch. At most three attempts, no wildcard fallback, and no transport resend. The internal adapter GET provenance caveat is identified above.
- `markAsSent:false` skips every bookkeeping read/write; capture mode still records the captured event without calling actual email transport. Invitation inline ordering, invitation-only `inviteRecorded`, campaign-config handling and mint ordering are unchanged.

## Tests independently run

Command:

```text
./node_modules/.bin/jest --runInBand --no-cache --watch=false --runTestsByPath tests/unit/send-emails-service.test.js tests/integration/reviewer-engagement-races.test.js tests/unit/reviewer-engagement-transport.test.js tests/integration/reviewer-engagement-contract.test.js tests/integration/send-emails-route.test.js
```

Result: **5 suites / 313 tests passed**, zero snapshots. Log: `/tmp/reviewer-stage1b-focused.log`.

These suites retain real service/adapter/DAL/HTTP behavior where the tests claim composition. The service unit suite intentionally mocks adapters and is supplemented by the composed races. The transport fake checks exact row ETags and returns 412 on mismatches; batch writes are staged before commit and roll back on parent failure. Unknown transport requests and unexpected SQL/synthesis dependencies fail the harness instead of silently returning empty success. The fake is an executable model, not evidence of live Dataverse atomicity.

## Non-vacuity experiments

Only temporary `/tmp` Jest transformers changed source text in memory; checked-out service/tests were untouched. The transformer asserts its target text exists and writes an `STAGE1B_MUTATION_APPLIED` marker, preventing a false negative from an unapplied mutation. Each mutation independently ran the service unit and composed-race suites (212 tests).

| Mutation | Result | Representative failure |
|---|---:|---|
| Remove receipt evidence (`received = false`) | 4 fail / 208 pass | Both templates regress timestamp-only receipt's old status; tests reject status payload. |
| Remove explicit `ifMatch` | 42 fail / 170 pass | Exact ETag expectations fail; metadata-only locks and concurrent counts regress. |
| Reuse original pre-send snapshot | 52 fail / 160 pass | Fresh receipt/count/binding/version assertions fail. |
| Remove request/person binding checks | 10 fail / 202 pass | Changed and missing bindings write when tests require no bookkeeping. |
| Remove closed/unknown/completed gate | 23 fail / 189 pass | Closed metadata-only writes and unknown/completed complements fail. |
| Stop all 412 retries | 11 fail / 201 pass | Receipt and same-version reminder races lose required recording/recomputed increment. |
| Apply non-courtesy lifecycle gate to thank-you | 8 fail / 204 pass | Closed thank-you stamp tests fail, including real adapter cases. |

Every run exited 1 because assertions found changed behavior, not syntax/configuration failure. Logs: `/tmp/reviewer-stage1b-mutation-{receipt,version,fresh,binding,closed,retry,courtesy}.log`. Reproducible config/transformer: `/tmp/reviewer-stage1b-jest.config.cjs`, `/tmp/reviewer-stage1b-transform.cjs`; select a mutation with `STAGE1B_MUTATION=<name>` and the same Jest command plus `--config`.

A separate transformer appended five temporary tests to the real composed suite: exclusion after each of three delivery types, thank-you person rebind, and the internal guard-GET 412 characterization. Result **1 suite / 86 tests passed** (81 existing + 5 added), log `/tmp/reviewer-stage1b-probes.log`. Config and appended fixture: `/tmp/reviewer-stage1b-probe.config.cjs`, `/tmp/reviewer-stage1b-probe-transform.cjs`, `/tmp/reviewer-stage1b-probes.js`. The guard-read characterization proves the observed edge; it does not assert that edge is the desired policy.

## Other validation evidence inspected, not rerun

[VERIFIED via saved orchestrator/builder outputs]

- `/tmp/reviewer-stage1b-gates.json`: 59 entries, 59 distinct names, every status zero. The orchestrator reports sequential execution, including self-tests; this reviewer did not independently execute the global gates.
- `/tmp/reviewer-stage1b-build.json`: `npm run build -- --webpack`, commit `08752364`, exit 0; 33 generated static pages and unchanged generated migration manifest. Existing warnings remain classified in that summary. This reviewer did not run a second build.
- `/tmp/reviewer-stage1b-full.json`: success true, 770 passed suites, 10,018 passed tests, zero failed/pending/TODO/runtime-error suites. This reviewer inspected the JSON counts and did not rerun full Jest.
- `git diff --quiet 08752364 --` the three changed implementation/test paths returned zero during final checks; HEAD remained the exact implementation commit above. Root-owned receipt edits were visible and deliberately left untouched.

## Recommendation evidence

| Recommendation | Current prerequisite | Available at execution point | Evidence actually tested | Disconfirming check | Status |
|---|---|---|---|---|---|
| Qualify receipt 412 provenance wording | Adapter update includes guard GET and PATCH | Yes; service catch receives only status, without operation discriminator | Real guard GET synthetic HTTP 412, then fresh reread + one conditional write + one email | If no retry/write occurred or a warning terminated recording, the wording concern would be refuted | VERIFIED; wording corrected and reread |

## Limitations

- No live Dataverse, email, Graph, PostgreSQL, cron, schema, browser, deployment, production or network operation was run. Full build/test/gate green is not deployment validation.
- Same suggestion ID plus unchanged Request/person bindings cannot distinguish a remove/restore engagement generation. The reset definitions at `reviewer-suggestion.js:880`–914 clear count/status/timestamps; restore can reuse those identities. This is an acknowledged boundary, not a new accepted/selected/response/token gate request.
- Explicit resets and other counter writers remain able to change the count. `reviewer-reminder-sweep.js:391`–418 keeps its separate pre-send claim protocol. The stage does not establish a global monotonic counter, cross-path exactly-once delivery, a durable repair queue, or a universal lifecycle boundary.
- The service's original hydration follows route ownership authorization; the same-row ETag/binding check does not lock parent ownership or the earlier authorization interval.
- Transport ambiguity and mid-batch termination remain outside this post-send repair. Existing warning/event limitations and unrelated F3/F5/UI behavior were not treated as new Stage 1B defects.

## Final verdict

**PASS / READY for the frozen Stage 1B implementation and the reviewed receipt contract. Required named changes: none.** The low-priority 412 provenance wording was corrected during review and reread. No runtime correction is required by this review, and no later stage or production promotion is approved. Final durable handoff/publication remains the orchestrator's work. If strict guard-read-versus-PATCH provenance is required in a future change, it needs an explicit implementation decision and focused proof.
