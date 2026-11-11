# Live attachment and matching venue — Opus 5.5 plan review

## Current disposition

[VERIFIED via the exact transcript below] The coordinating session accepted READY
WITH NAMED CHANGES for the minimal local-only venue. Implementation subsequently passed Opus READY build review and final 194-test/12-suite
verification; see [evidence](LIVE_VENUE_PREFLIGHT_2026-11-11.md). The accepted contract uses the existing Graph
upload path, existing credentials and schema conventions; no special Graph branch,
credential alias or unique staging index is added. Browser-only model/max-token
pinning belongs in `assertRosterPrompt`. The synchronous usage-logger SQL failure
must be caught; documenting the missing row alone is insufficient.

The owner subsequently approved the bounded run for two SharePoint PDF copies
and their child folder, private/public Blob usage and two `claude-sonnet-5-5`
submissions. The private `attachment-approval-candidate` manifest and
`live-checks-proposal` metadata identify the exact proposed scope; this archive is
not authorization to write or incur usage. The batch picker covers 2020 through
next year and excludes D99, so the proposed fixture can support route/service proof,
not picker proof. The authorized run is finished and cleaned up; see
[final results](LIVE_ATTACHMENT_MATCHING_RESULTS_2026-11-11.md). See the [revised contract](REMAINING_FLOW_REHEARSAL_2026-11-11.md).

Source transcript: `outputs/roster-live-venue-plan-opus.md`, preserved verbatim below.

## Archived transcript

**Verdict: READY WITH NAMED CHANGES.** The minimal local-only plan, using the real code path, is acceptable. Reject the subagent's larger alternative. One concrete issue is new: the usage-logging step can't simply be "documented honestly". As the code stands, it will break the paid browser proof (item 7). I worked read-only (Read/Grep/Glob only) and wrote no files, including the plan-mode file.

## Engineering requirements (code)

1. **`roster-sql.cjs` `db.connect`** — **required.** In browser mode it currently throws (`roster-sql.cjs:71`), and the feedback writes take a transaction (`consultant-feedback-service.js:516/602/763`). Browser branch: connect from `localPool`, run `verifyNamespace(client, schema, {browser:true})`, `release(true)` on failure, return the client. The non-browser branches stay as they are.

2. **`portal-upload-staging.js`: `sql` → `browserSql`** — **required.** It imports `@vercel/postgres` directly (line 16), the same pattern as `auth.js:23`. Outside browser mode `browserSql` is just `vercel.sql`, so Production doesn't change. Each connection is pinned to the one owned schema, so no extra namespace guard is needed.

3. **Fixture applies migrations 031 + 049, browser mode only** — **required.** 049 recreates the scope check including `consultant_feedback`, and 048 is already applied. `SITE_VISIT_MATERIALS_BACKGROUND_SCHEMA_READY` must stay unset, because the 060 columns aren't there. The venue's environment allowlist already leaves it out.

4. **Runner: opt-in `UPLOADS_BLOB_RW_TOKEN` and `CLAUDE_API_KEY` per approved run** — **required.** `environment()` (runner:36-52) passes neither. Say plainly in the plan that Graph write access already exists in today's venue: `graph/auth.js:35` uses the `DYNAMICS_*` credentials the venue already passes. The Blob token is the only gate on attachment writes, and the API key the only gate on paid calls. No separate credential alias is needed.

5. **Runner: drop the schema only when nothing is left over** — **required.** Today `fixture.cleanup()` runs unconditionally in `finally` (runner:183).
   - First, privately dump the `portal_upload_staging` and `consultant_feedback` rows.
   - Skip the drop and fail if any staging row is not `consumed`, any row holds a `candidate_result` without a terminal state, or any feedback row remains.
   - This covers the one window (`attachment-service.js:336`) where the Graph item identity exists only in SQL.

6. **Model pin in `assertRosterPrompt`** (`roster-match-contract.js:29`) — **required.** Both `match.js:116` and `batch-match-service.js:175` call it before the model call, so one edit covers both. In browser mode, require `resolved.model === 'claude-sonnet-5-5'` and `resolved.maxTokens === 4096`.
   - This is a real risk, not a hypothetical one. If the model-list warm-up fails, resolution falls back to `claude-sonnet-5`, a model the approval doesn't name.

7. **`usage-logger.js`: catch synchronous throws** — **required; replaces "document honestly".**
   - The venue's `POSTGRES_URL` points at `127.0.0.1`. `@vercel/postgres` only exempts the hostname `localhost`, and the URL isn't pooled, so its `sql` proxy throws synchronously (`chunk-7IR77QAQ.js:49,164-168,212-216`).
   - `logUsage` calls `sql\`…\`` at line 60 before `.catch` is attached, so the error escapes.
   - In `match.js` the first call (line 181) comes after the paid call and the `expertise_matches` insert. The throw sends control to the catch block, whose second `logUsage` call (line 209) throws again. Result: a 500 with no rendered results, even though the paid call and the save succeeded. `batch-match-service.js:244/278` behaves the same way.
   - Fix: wrap lines 60-89 in `try { … } catch (e) { console.warn('Usage log failed:', e?.message) }`. Production is unaffected because its URL is pooled. Add one unit test for a synchronously throwing `sql`. The missing usage row can then be documented honestly.

## Plan-text changes (no code)

- **Folder creation:** `ensureFolderPath` will create the `Consultant Feedback` child folder, a second shared object. The approval and cleanup must name it: either delete it by exact ID once it's verified empty, or keep it and record it.
- **Batch fixture placement:** `listFiles` is non-recursive (`batch-match-service.js:107`). The `…Phase_I_Staff_Version…pdf` must sit directly in the Request folder `akoya_request/1000339_…`. Upload it with conflict behaviour `fail`; clean up by exact item ID and eTag.
- **Batch reachability:** the batch picker lists proposals by cycle code (`proposals.js:31-42`). Check read-only whether 1000339 appears there. If it doesn't, label batch as route-level proof (a same-origin POST), not proof through the picker.
- **Plan line 161:** it says "allow only the approved synthetic Request". Not an engineering requirement. Reword it as operator procedure (or add a one-line browser-mode check at mint if you want it). Either way, the text and the build must agree.
- **Reviewers grant:** finalize requires the `reviewers` grant (`finalize.js:52`), but the runner only asserts `expertise-finder` (runner:146). Add `reviewers` to the operator preflight.
- **Replay labelling:** replaying a consumed staging ID returns the stored payload (`finalize.js:88`). It proves consumed replay only, not the step-5/6 recovery paths.
- **Drive check:** `uploadFileLarge` resolves the default site plus the library name. Have the preflight prove that the bucket library's drive equals `getDriveId('akoya_request')` on akoyago-shared. The receipt then compares the returned `driveId` and parent path. That answers the subagent's concern without a separate Graph branch.
- **Cost disclosure:** each submission can make up to 1 + 3 attempts on 429/529, plus one corrective retry for a deprecated parameter. Timeouts are not retried (`llm-client.js:280`), but a timed-out request may still be billed. No fallback model is configured.
- **Scanning:** `VIRUS_SCAN_ENABLED` unset means off (`virus-scan-config.js:33`), and the venue doesn't pass it.
- **Blob cleanup:** `completePortalUpload` already deletes the staged Blob. The operator confirms it's gone with a `head` 404 on the exact persisted pathname.

## Rejected as hypothetical

From the subagent's proposal: the separate credential alias, scope guards in both the staging module and the service, the filename cap, and the unique one-row staging index (a schema change for a test). Also the separate Graph `uploadFile` branch: it would test a path Production doesn't use. The fact that a bucket on a non-default site would be written to the default site is existing Production behaviour and out of scope.

## Unverified

I only checked that no route under `pages/api/workbench` imports `@vercel/postgres` directly. The services those routes call for the Reviews tab are unchecked. Make the first build step a zero-write page load of `/workbench/<1000339 GUID>` in the venue, before spending any approval. Any 500 there means the "only the SQL transport changes" assumption is wrong.
