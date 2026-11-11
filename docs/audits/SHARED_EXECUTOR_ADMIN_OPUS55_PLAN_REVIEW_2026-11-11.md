# Shared Executor Admin plan review and disposition

**Review verdict:** READY WITH NAMED CHANGES.

The owner-authorized read-only Claude Code OAuth plan review used
`claude-opus-5-5` at baseline `86e672fc3`. The CLI result reports
`is_error:false` and lists only `claude-opus-5-5` in `modelUsage`.
The review checked source and performed no live Dataverse probe. Source
dispositions below are bounded to the local branch. The final build review
and validation have separate receipts.

## Verbatim review

**Verdict: READY WITH NAMED CHANGES.** The design is sound and its scope matches the authorization, but five things need to change before it can claim that findings 5 and 7 are closed. I read the source at HEAD `86e672fc3` and made no edits. Anything I couldn't confirm from source is marked [ASSUMED].

### 1. An empty system prompt may not survive saving, so stored tasks could fail while the preview passes (Medium)
- **Evidence:**
  - `profile.js:60` rejects a row unless `wmkf_ai_systemprompt` is exactly `''`.
  - `prompts-publish-service.js:420` writes `systemPrompt || ''`.
  - [ASSUMED, fairly confident] Dataverse returns `null` for a text column saved as `''`. I didn't probe this.
- **Counterexample:** the preview builds from draft fields where the system prompt is `''`, so it passes. After publishing, the readback, the execution snapshot and the "prior row is a profile task" check all see `null` and throw `execution: invalid prompt text`. The design's "readback verifies exact" step would report a publish that succeeded as a failure.
- **Named change:**
  - Treat `null` and `''` the same in one place (`parseExecutionSpec`, or where the snapshot is frozen).
  - Make the publish fingerprint (`rowPublishPayload`, around line 699) use the same rule.
  - Add a store test whose readback returns `systemprompt: null`.

### 2. The new limits only bind the publisher, not execution, so finding 7 stays open (Medium)
- **Evidence:**
  - The job store accepts whatever profile and prompt row the job's creator supplies (`store.js:169`).
  - Execution only checks that maxTokens is at least 1 (`execute-prompt.js:411-416`).
  - The profile check still allows 2,000,000 bytes per document and 4,000,000 in total (`profile.js:32`).
  - The output-budget check (`capabilities.js:9-25`) doesn't look at maxTokens.
- **Counterexample:** a synthetic job built directly against the store, as the existing tests do, still gets a 4 MB profile and an unbounded token budget. The worst-case checkpoint is then unchanged.
- **Named change:**
  - Put the 256 KiB per-document and total caps in `validateProfile`.
  - Put maxTokens ≤ 1536 and a finite temperature in `validateSyntheticTask`. Both already run at admission, execution and publish.
  - Make sure `maxTokensOverride` can't raise the budget above the cap.
  - Update the existing fixture profiles, which will now fail validation.
- **Docs:** the published settings revision is not what execution reads; execution only matches the hash in the job's configuration. Don't describe the settings store as authoritative at run time.

### 3. Snapshot size arithmetic doesn't count records, and the oversize failure must be final (Medium)
- **Where the size comes from:**
  - Document text is stored twice: once raw and once in the escaped block (`context.js:52-53`).
  - Records add up to 16 × 64,000 bytes, about 1 MB (`profile.js:32`), on top of the 256 KiB document cap.
  - Worst-case JSON escaping (control characters become `\u00XX`, six times the size) applies to both.
  - That puts the total near the 4 MiB limit.
- **The original bug:** a 400 from `saveSnapshot` was retried on every tick (`worker.js:46`), so the job never ended.
- **Named change:**
  - Count records in the budget, or lower `maxRecordBytes`.
  - When the exact canonical size exceeds 4 MiB, end the job with a final `failed_pre_dispatch` that releases its slots. It must not throw something that gets retried.
  - Test the worst-case escaping for both documents and records.

### 4. The guards on the update path have to cover every branch, not only a fresh publish (Low to Medium)
- **Evidence:**
  - Replay matches only the request ID and the payload hash, not the prompt name (`prompts-publish-service.js:190`). The design already plans to fix this.
  - The resume path (`:213-217`) succeeds when `expectedVersion` is absent.
  - A first publish copies the latest draft (`:144-154`).
  - Repairing a half-finished publish (`:245`) skips the expected-version check.
  - `buildPublishPayload` (`:650`) adds `override` declarations for undeclared placeholders.
- **Named change:**
  - Apply "fail if the prior row is legacy" and "the marker can't be removed" to the draft row in a first publish, to the newer row in a repair, and to the row checked during a resume.
  - In the new mode, require `expectedVersion` on the resume branch too.
  - Skip the automatic placeholder declarations for marked rows rather than letting them fail later.

### 5. Prefix scans and column widths are unverified (Low)
- **Wildcards and case:** [ASSUMED, unverified] Dataverse may treat `_` in `startswith` as a pattern wildcard, and its comparisons ignore case. Profile keys may contain `_` (`profile.js:5`). Combined with "any unknown row fails closed", one well-formed row for profile `a-b` could break the listing for `a_b`.
  - **Change:** scan only the fixed prefix `executor.profiles.` and split the results by exact key in code, or disallow `_` in profile keys.
- **Column widths:** a key can be up to 90 characters (`executor.profiles.` + 64 + `.vNNNNNN`), and the envelope up to 100,000. I found no width for `wmkf_settingkey` or `wmkf_settingvalue` in the repo.
  - **Change:** check the column definitions before relying on these limits, and cap the key length to match. Reading live Dataverse metadata needs your authorization.
- **No collision with budget settings:** budgets use the prefix `executor.budgets.v` (`shared/config/executorBudgets.js:11`), so the new profile keys can't match it.

### Checked and sound
- **Settings writes:** `createSettingStrict` never updates an existing row and returns 409 when the key exists. A request whose outcome is unclear is settled by the planned scan-and-readback.
- **Task creation:** replay there already checks the prompt name (`:435`).
- **Task names:** both synthetic task names pass the prompt-name format check.
- **Preview nonce:** a fresh random secret per preview avoids exposing a value derived from the real nonce secret.
- **Profile pin:** the key, revision and hash check at `context.js:66` already enforces the exact pin.

I didn't consult the separate advisor reviewer, to stay within your 10-call limit.

## Dispositions

1. **Accepted.** The profiled parser accepts null or empty system text and
   rejects a populated system template. Publish fingerprint and Admin
   projection normalize stored null to empty. Profiled snapshot validation
   preserves the same rule. Legacy frozen prompt validation keeps its
   existing contract. Evidence is local source and null-readback fixtures,
   with Dataverse round-trip behavior outside the review's proof.
2. **Accepted.** Shared profile and capability validators enforce 256 KiB
   raw document limits and a 1,536-token frozen output limit across
   publication, synthetic admission, and execution. The Executor also
   bounds the effective token budget. Runtime resolves the configuration
   frozen into the job. Admin settings resolve the exact profile pin at
   authoring time.
3. **Accepted.** The snapshot preparer checks the exact canonical bytes
   including records and escaped documents. Storage enforces the same
   ceiling. Oversize preparation ends queued tasks and releases eligible
   slots. The normalized checkpoint carries text once or saves a bounded
   oversize marker with available usage. Marker recovery ends validation
   without a second provider call.
4. **Accepted.** Marked task publication requires the UUID and, for updates,
   the loaded version before replay/repair. The draft/prior row supplies
   the mode check. Torn-state repair matches the newer row by the complete
   payload fingerprint. Reserved names require the marker and existing
   names cannot change modes. Marked rows bypass automatic override
   declarations.
5. **Accepted with repository evidence.** The reader scans the fixed
   `executor.profiles.` prefix and checks exact keys in code. The tracked
   [settings schema](../../lib/dataverse/schema/wave1/wmkf_app_system_setting.json)
   declares the 255-character key, 100,000-character Memo, and alternate key
   on `wmkf_settingkey`. The writer caps the serialized envelope. Duplicate
   storage fails closed. Live schema/index activation and comparison
   behavior were outside the review's evidence.
