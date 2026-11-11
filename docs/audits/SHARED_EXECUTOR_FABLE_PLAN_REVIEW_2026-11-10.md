# Shared Executor architecture review

Dated review: 2026-11-10 Pacific. Claude Code OAuth; reported model `claude-fable-5-2`. Read-only review of the pre-build proposal. Line numbers refer to the reviewed draft; dispositions are in the architecture plan. No live provider tests or production access.

## Verbatim reviewer response

**Verdict: READY WITH NAMED CHANGES.** Nothing I found needs rework, and the synthetic trial can start before real destination fields or Entra exist. Changes 1–6 should go into the plan text before coding, and 7–12 can land during the build.

"Plan" line numbers refer to `docs/plans/SHARED_EXECUTOR_JOB_ARCHITECTURE_2026-11-10.md`. Every finding is a gap in a plan requirement unless marked as-built.

## Change before coding

1. **Profiled rows can still read live inputs at dispatch.**
   - Evidence: plan:72 requires only the mode marker plus `prepared_context`. As-built, `lib/services/execute-prompt.js:206-207` reads the Request and resolves variables live, and `:400-420` handles `dynamics` and `sharepoint`. The publisher checks variable names only (`lib/services/admin/prompts-publish-service.js:744`).
   - Change: give the new mode a source-kind allowlist (prepared context and frozen record inputs only), enforced at publish and at runtime.
   - Check: publishing a profiled row with a `dynamics` variable returns 400, and a runtime fixture with one refuses before any read.

2. **The existing security preamble contradicts the new layout.**
   - Evidence: as-built, `lib/utils/ai-payload-boundary.js:274-275` tells the model its task comes "ONLY from this system prompt". Plan:117-121 puts the task in the user turn after the document.
   - Change: add a wrapper-versioned preamble for profile mode that also trusts user text outside sentinels, and include it in the compatibility hash.
   - Check: a composed profiled request does not contain that sentence, and a document fixture carrying fake task instructions is still wrapped as data.

3. **The prefix will not be byte-identical as specified.**
   - Evidence: plan:104 defines one context hash that includes task-input values. Plan:124 scopes the nonce to that hash and to "authorization domain". Plan:235 requires identical bytes across tasks and across app and PA callers. Separately, as-built, a missing secret silently yields a random nonce (`lib/utils/ai-payload-boundary.js:180-185`, `:242-244`).
   - Change: derive the nonce from a document-only hash (roles, byte hashes, extraction and wrapper version), give task inputs their own hash, store the wrapped block in the snapshot, and block admission when the secret is absent.
   - Check: block 1 is byte-equal for two tasks with different PI inputs and for both caller types; with the secret unset, admission is blocked.

4. **Two audit writers, and the audit row keeps response text.**
   - Evidence: as-built, `execute-prompt.js:300` and the catch at `:334` both write run rows inside `executePrompt`. Raw output defaults to `full` (`:275`, `:1115-1118`). Plan:195-199 leaves parse and audit inline after the checkpoint, and plan:225 says response text stays out of audit.
   - Change: split `executePrompt` into dispatch, pure validation and audit-payload building, with the legacy call composing all three. The job worker runs them as stages, is the only audit writer, and pins `auditRetention: 'content-free'` (`:136-139`). Create the attempt row and run GUID at dispatch intent, so pre-dispatch retries write no run row.
   - Check: the 54 characterization tests pass unchanged. With a failing audit double, the result is retained, one run row exists after retry, and it holds no response text.

5. **An initialization slot is never released.**
   - Evidence: plan:174 and :207 reserve the slot before generation, and plan:223 keeps receipts forever. A job that fails before any PATCH blocks that Request permanently. Plan:207 also stores "existing content" in a content-free receipt.
   - Change: allow release only in the transaction that proves no publication operation was frozen. A 412 becomes a conflict that resolves only through staff apply. Store a hash and blank flag, not the content.
   - Check (real SQL): a validation failure releases the slot and a new initialize is admitted; a timed-out PATCH never releases it.

6. **The Request row version is doing two jobs.**
   - Evidence: as-built, the ETag is row-wide (`execute-prompt.js:488-489`). Plan:74 freezes "record versions" for inputs and plan:110 pauses on source change, so any unrelated Request edit pauses the job. The narratives handoff requires the original ETag for If-Match (`docs/plans/REQUEST_NARRATIVES_HANDOFF_2026-11-09.md:72-76`), which should stay.
   - Change: compare a hash of the declared field values for input freshness and use the ETag only for If-Match. Capture the baseline when the job takes the per-request claim, so an earlier job's write does not 412 it.
   - Check: an unrelated field edit mid-job leaves inputs fresh and produces a publication conflict with the result retained. A second job on a different field is not 412'd by the first.

## Change during the build

7. **PI precedence has no mechanism.**
   - Evidence: plan:17 states the rule and plan:74 covers resolvers only. As-built, a missing field becomes an empty string (`execute-prompt.js:412`).
   - Change: store present or missing per field and render an explicit missing marker. Put the precedence rule in the profile's shared instructions. Fill any output that corresponds to a record input from the frozen value, not from model output.
   - Check: the composed bytes show the marker. When the document names a different PI, the written field equals the record value whatever the model double returns.

8. **The profile pin and the frozen prompt are references, not content.**
   - Evidence: the pin is key plus revision (plan:60) and the fingerprint covers that string (`prompts-publish-service.js:711-721`), so an in-place edit of the settings row goes undetected. `promptSnapshot` needs the full row and a concrete model (`execute-prompt.js:1358-1377`), but the publisher accepts tiers and blank (`prompts-publish-service.js:780`, `:798`).
   - Change: add a sha256 to the pin and compare it at admission. Store the prompt row and profile content with the job. Require a concrete model for new-mode publish. Reject a job whose tasks pin different revisions.
   - Check: mutating the profile fixture in place blocks admission; a tier model returns 400.

9. **The old-runtime brake covers only `executePrompt`.**
   - Evidence: the refusal is at `execute-prompt.js:422` (the plan cites `:388`). Other readers interpolate current rows with no source-kind check, for example `lib/services/tool-prompt-resolver.js:83` and `lib/services/reviewer-prompt-resolver.js:92`.
   - Change: the publisher refuses new mode unless the name is in the capability registry, and the pilot uses new prompt names.
   - Check: publishing new mode onto an unregistered name returns 400.

10. **Storage for the trial, and a global stall.**
    - Evidence: plan:108 needs a newly provisioned Blob token, which plan:19 excludes. Plan:219 allows one active request globally and does not say whether an unknown task holds it.
    - Change: use a content-store interface with a Postgres driver for responses and results, in a table separate from receipts. There is precedent in `lib/db/migrations/070_meeting_transcript_summary_drafts.sql:23`, `:54`. This also makes response save and attempt transition one transaction. State that an unknown task releases the global slot.
    - Check: killing the worker double between provider return and commit leaves the attempt unknown, with no orphan, and another request proceeds.

11. **Cache timing (not correctness).**
    - Evidence: plan:178 does one stage per tick against a five-minute TTL. The fastest crons here run every minute, and the cited preparation worker's cron runs every 15 minutes (`vercel.json:171-172`).
    - Change: validate inline in the invoke tick, order a sibling's invoke ahead of audit and publish, and run the cron every minute.
    - Check: task 2 dispatches on the tick after task 1.

12. **Smaller items.**
    - **Unknown writeback:** replaying the identical PATCH once with the original ETag is safe per the handoff (`:75-76`), so only a 412 on replay needs an operator. This assumes Dataverse changes the row version on every update.
    - **Principal key:** derive it from validated claims, namespace it by kind, and re-check permission before returning an existing job on idempotent replay (plan:147, :171).

## Can the synthetic trial proceed?

Yes, on two conditions:

- **Token verifier:** build it behind an interface and test it with locally minted keys. That proves the claim logic only; tenant setup stays unknown.
- **Fixture writer:** it must refuse a missing ETag. As-built, `execute-prompt.js:1068` sends an unconditional write when the ETag is null, and `lib/dataverse/adapters/grant-request.js:247-250` permits it.

Real-SQL constraint tests have precedent in `tests/integration/meeting-material-preparation.pg.test.js`.

## Checked and sound

- The fallback model is opt-in and the Executor does not set it (`lib/services/llm-client.js:325-328`, `execute-prompt.js:644-648`).
- `LLMClient` forwards `messages` verbatim, so a block-level cache marker is possible (`llm-client.js:227`).
- The existing publisher preserves the `execution` key (`prompts-publish-service.js:693-696`).
- Raw mode bypasses `validationSchema` as the plan says (`execute-prompt.js:908-917`).

## Not verified

- Dataverse create with a client-supplied id for the audit GUID. The adapter has only a plain create (`lib/dataverse/adapters/ai-run.js:23-28`).
- Settings value size and whether a create-only write exists.
- Provider cache behaviour.

## For the owner before real enablement

The workbook table lists Refresh as "Overwrite" for both pilot tasks and labels Methodology "(page 1)" (`docs/plans/PREFLIGHT_PROMPTS_HANDOFF_2026-11-10.md:29-30`). The plan offers only initialize or draft-plus-apply, and assumes both tasks share one full-document prefix. Neither blocks the trial.
