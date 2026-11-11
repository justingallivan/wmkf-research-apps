# Minimal live venue — Opus 5.5 build review

## Current disposition

[VERIFIED via the exact transcript below] Opus returned READY with no blockers in
the minimal changes since `0b3118f5f`. Subsequent final verification passed 194 tests
across 12 suites in one command (`outputs/roster-final-focused-tests.log`). Build,
scoped lint, types, model-warming and DAL gates/self-tests passed. The transcript's
pending final transport run is historical. The reviewer did not execute these checks.

This closes source/build review for the minimal venue, not live attachment or model
proof. The subsequently authorized run and final cleanup are recorded in
[final results](LIVE_ATTACHMENT_MATCHING_RESULTS_2026-11-11.md). D99 batch
execution, if approved, will be actual authenticated same-origin route proof, not
cycle-picker proof. See [preflight evidence](LIVE_VENUE_PREFLIGHT_2026-11-11.md).

Source transcript: `outputs/roster-live-venue-build-opus.md`, preserved verbatim below.

## Archived transcript

**READY.** I found no blockers in the new minimal changes since `0b3118f5f`. I did not write the plan file because Write is disabled in this session. I made no writes or network calls and did not use Ultrareview.

**What I checked against the Opus plan**

1. **Browser `db.connect`** (`roster-sql.cjs:23-33,73-77`): the client is handed over only after the namespace check passes, and it is released with `release(true)` if the check fails. The other two connection paths are unchanged. The transactions in the consultant feedback service use only `client.query` and `release`, which the local client supports.
2. **Staging import** (`portal-upload-staging.js:16`): the `browserSql` import follows the same pattern as `auth.js:23`. Outside browser mode it delegates to the normal Vercel path, and a test covers that. The module uses only tagged-template `sql`.
3. **Migrations 031 + 049**: applied only when attachments are authorized (`run-roster-browser-venue.cjs:212-217`). All names are unqualified, so they land in the owned schema. Migrations 043 and 055 change only the scope check, so nothing else is missing while 060 isn't applied.
4. **Tokens and grants**: each token is injected only when its approval flag is set (`:72-85`). The `reviewers` grant is required when attachments are approved (`:196-198`).
5. **Schema retention** (`:241-252`):
   - Retention defaults to on, and the private dump is written before the decision.
   - The schema is kept if any staging row exists or the feedback rows differ from the one-row baseline. The change check works on whole row lists.
   - If the check's query fails, the schema is kept and the run fails.
   - `result.json` reports `retainedSchema` and `fixtureRemoved` truthfully, and nothing cleans up shared storage automatically.
6. **Model guard** (`roster-match-contract.js:29-35`): both callers reach it in the venue, because the rehearsal flag is on (`match.js:85,116`; `batch-match-service.js:146,175`). The bundled row asks for the `sonnet` tier with 4096 max tokens. If the model resolves to anything other than `claude-sonnet-5-5`, the guard refuses with a 503 before the paid call. That fails safe; your model-list probe is what confirms it actually resolves to 5-5.
7. **Usage logger** (`usage-logger.js:60-93`): a synchronous throw on the first insert is caught by the outer `try`. A synchronous throw in the fallback becomes a rejection, which the last `.catch` handles, and an async rejection is handled the same way. Tests cover all three cases (`usage-logger-stop-reason.test.js:56-75`). Nothing that `llm-client`, the prompt resolver or the model resolver imports touches `@vercel/postgres`.

**Not blocking**
- `pages/api/expertise-finder/roster.js:23` still uses `@vercel/postgres` directly. That predates this work, and the Workbench page check won't exercise that route.
- I read only `roster-browser-sql.test.js` and `usage-logger-stop-reason.test.js` in full. I did not read the runner, consumer, persistence or staging tests. The pass counts are as you reported them, and the final transport run is still pending.
- Keep the batch result labelled as service/route-level proof, since batch D99 can't be reached through the picker.
