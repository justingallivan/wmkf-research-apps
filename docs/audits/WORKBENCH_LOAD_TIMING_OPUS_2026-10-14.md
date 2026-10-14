# Workbench load timing: Opus OAuth review

October 14, 2026. Read-only ordinary Claude Opus review via verified claude.ai Team OAuth. No provider API credentials or metered review product. Both reviews found no blocking issue.

## Initial review

I found no confirmed correctness or security bugs, so the change looks safe to ship as written. Everything below is either an invariant I checked in the source or a recommendation. I only read the code; I didn't run tests or the probe. Plan mode was on, but the plan-file write tool was turned off for this session, so the review is only in this reply.

**Invariants checked (all pass):**
- **Projection is complete.** Every document field the consumer reads is in `LIST_FACT_FIELDS`:
  - the active-row filters and stage-source resolution (`cycle-list-service.js:92-216`)
  - `projectRow` (`:218-272`)
  - `toFact`, including milestones
  - draft-file hiding via `isPreSiteWriteupRow` and lifecycle
  - correction (`wmkf_reopencycleid`)
  - the final writeup's source, drive/item, and group/leadership fields (`:599-617`)
  - the snapshot helper's `wmkf_producer` (`shared/config/requestDocument.js:114`)
  - `createdon` for `newestFirst`

  Request-pointer fields come from the request rows, not document rows.
- **Schema gates are kept.** `findByRequests` builds the full select first and then intersects it (`request-document.js:218-219`), so the reopen and final-writeup fields still depend on their readiness gates. The pre-site call still passes `includeGuardedReopen: true`. The default `listFactsOnly=false` gives the same full select as before, and only `cycle-list-service.js:329-338` sets the flag. `summary-reader.js` still uses the full select.
- **Moving the reads earlier changes nothing.** The old `requestIdsForVisit` held the same ids as `requestIds`, and the old `chosenEntries` requestNumbers map held the same pairs as the new `requests` map. So site visits, schedules and materials get the same inputs. The caps on documents and site visits are still enforced before any result is used. The sent-source and sent-version `.catch` fallbacks are still around the timed calls.
- **Timing data is per request and safe.** Each request gets its own `AsyncLocalStorage` store. Concurrent `push` into one array is safe in a single thread. Errors pass through `finally` and are re-thrown, and the error responses don't set the header. Labels are fixed strings checked against `/^[a-z_]+$/`. Durations must be finite and non-negative. No record data ends up in the header.
- **Auth and DAL context are unchanged.** Both routes still do the guard, then `withDalContext`, then the service. Only the response wrapper changed.
- **No new browser exposure.** `dynamics-context.js:37` already imports `node:async_hooks` at the top level in the same server-only tree. The only lib imports in `pages/workbench*.js` are `preview-read-only` and `interlock`, and none of the changed modules reach a client page.
- **The probe is read-only and gated.** It needs `DATAVERSE_ALLOW_PROD_READS=yes`, refuses `VERCEL_ENV=production`, forces `DATAVERSE_TARGET_INTERLOCK=on` before the dynamic imports, and prints only timings, counts and a hash. It does use `enterDynamicsBypassForScript`, which is acceptable here because it only reads.

**Recommendations (not bugs):**
1. **Error precedence changed** (`cycle-list-service.js:325-354`). Before, a documents cap returned `staff_deliberations_documents_capped` before the site-visit, schedule and materials reads started. Now all six reads run first. If one of them rejects, `Promise.all` returns that error instead of the cap 503. On the success path the caps are still checked before any data is used. Only the error code a client sees in a double-failure case changes. Your new test covers the cap-only case.
2. **More concurrent Dataverse reads.** The peak goes from about 3 queries at once to about 6, counting chunked fan-out. I found no 429 or Retry-After handling in `lib/services/dynamics-service.js`, so throttling would show up as a 5xx. This is worth watching at production scale; I wouldn't block on it.
3. **`Server-Timing` is always on in production.** It shows internal step names and durations to signed-in staff. There's no `Timing-Allow-Origin`, so other origins can't read it. The leak is low-sensitivity, but if you don't want a permanent production header, put it behind a flag or turn it on only in non-production.
4. **Detached comment** (`request-document.js:~180-216`). The `findByRequests` JSDoc now sits above `LIST_FACT_FIELDS` instead of the function. Move the constant above that JSDoc.
5. **The probe reports a `programId` it doesn't control.** It passes `dashboard.value.programId` from the cycle-list response. That's fine as long as `listCycles` always returns one; otherwise validation throws a 400, which is loud and doesn't produce wrong timings.

**Test teeth:** the lifecycle `it.each` test makes the mocked `DynamicsService` return only the selected fields, so a missing field would make the full and trimmed outputs differ. That's a real check. The adapter test also checks that the final-writeup fields depend on their schema gate.

## Disposition

Preserved document error/cap precedence with an explicit all-settled read join and added double-failure tests. Moved the adapter JSDoc back above its function. Retained authenticated Server-Timing headers as the requested diagnostic; labels/durations only. Concurrent read fan-out remains a rollout observation item. The probe intentionally uses the server-resolved program. Its entry was renamed to .js to use the repository lint configuration.

## Focused follow-up

I found no new blocking issue in this change.

**Read join (`lib/services/pre-site-visit/cycle-list-service.js:325-366`)**
- All six reads run through `Promise.allSettled`, so by the time any error is thrown, every read has finished. No rejected promise is left running after the service returns, which avoids unhandled rejections.
- Errors are reported in the intended order:
  1. A failed document read (pre-site, then brief, then final).
  2. A document read that hit its cap (503 `staff_deliberations_documents_capped`).
  3. A failed visit, schedule or materials read.
- So when two reads fail together, the document failure or cap error always wins. This settles the double-failure precedence issue from the prior review.
- Trade-off: when a document read fails, the error now waits for the slowest other read before it is thrown. That's acceptable because nothing is lost, only delayed.
- Behaviour for successful reads is unchanged: all values are read only after the checks above pass.

**Tests (`tests/unit/pre-site-visit-cycle-list-service.test.js`)**
- Line 381 checks that the other reads start while documents are pending, and that the call doesn't finish until documents resolve.
- Line 435 checks that the document cap error wins when the visit read also fails.
- Minor, non-blocking gap: no test covers a failed document read alongside a failed other read. The code clearly handles it (line 351 throws before line 362).

**Constant move (`lib/dataverse/adapters/request-document.js:182-216`)**
- `LIST_FACT_FIELDS` and its comment now sit above the `findByRequests` JSDoc, so the JSDoc is directly attached to the function again.

**Probe rename**
- `scripts/probe-workbench-load-timing.js:19` builds from `lib/workbench-timing-entry.js`, and that file exists. No other references to the old name remain.

I only read the code; I didn't run any tests or lint.

The follow-up’s minor test gap was subsequently covered: a document rejection plus visit rejection waits for a pending materials read and returns the original document error. Final focused suite: 82 passing tests.
