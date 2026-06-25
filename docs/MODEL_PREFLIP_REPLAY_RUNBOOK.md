# Model Pre-Flip Replay Runbook

Use this before changing reviewer-affecting Claude model routing, including
advancing the `reviewer-finder` tier fallback or removing a concrete pin.

## Scope

This runbook validates the reviewer-finder analyze prompt on a real request before
the model change reaches users. It is read-only for reviewer/grant/Blob state:
the harness reads Dataverse and SharePoint, parses the proposal locally, and makes
one real Claude call. The normal `api_usage_log` telemetry row is still written by
the LLM transport.

## Preflight

1. Add or update the target model in `lib/services/model-capabilities.js`.
2. Add or confirm pricing coverage in `lib/utils/model-pricing.js`.
3. Run:

```bash
npm run check:model-registry
npm run check:model-registry:self-test
npx jest tests/unit/llm-client.test.js tests/unit/admin-models.test.js tests/unit/validate-reviewer-analyze-artifact.test.js --runInBand
```

4. Confirm `/admin` -> Models shows `cap ok` and `price ok` for the effective
   reviewer-finder model.

## Replay

List candidate proposal files if needed:

```bash
node --import ./scripts/lib/use-extensionless.mjs scripts/validate-reviewer-analyze.mjs \
  --request 1002836 \
  --list-files
```

Run the replay and write the artifact:

```bash
node --import ./scripts/lib/use-extensionless.mjs scripts/validate-reviewer-analyze.mjs \
  --request 1002836 \
  --file-key "Documents::Active/1002836::Project Narrative.pdf" \
  --reviewer-count 12 \
  --temperature 0.3 \
  --json-out artifacts/model-replays/1002836-claude-opus-4-8.json
```

Use at least one previously-problematic request/proposal. For a high-risk model
flip, run two or three proposals that cover sparse, dense, and edge-case proposal
text.

## Artifact

The JSON artifact records:

- command inputs, request id/number/title, selected file, and extraction size;
- prompt provenance and actual model returned by Claude;
- fallback usage, stop reason, attempt count, and token budget;
- parse success, reviewer count, validation issues, and proposal-info presence;
- quality signals such as fallback use, reviewer-count match, and COI/conflict
  words in reasoning;
- a `humanReview` block with `pass: null` and notes fields for the reviewer to fill.

## Pass Criteria

Do not flip the model unless the artifact and human review show:

- no request-parameter 400;
- no fallback unless intentionally expected;
- successful parse with non-empty proposal info;
- reviewer count is acceptable for the requested count;
- reviewer names are real, independent people;
- no quota-padding loop, duplicate names, excluded names, or placeholder rows;
- reasoning is topical and does not contain COI/conflict text;
- human reviewer marks `humanReview.pass = true` in the saved artifact or records
  equivalent notes in the release handoff.

## Fail Handling

If the artifact status is `failed`, or any pass criterion is not met, keep the
current model routing. Fix the capability/pricing registry, prompt, transport, or
candidate model choice, then rerun the replay and keep both artifacts for the
handoff trail.
