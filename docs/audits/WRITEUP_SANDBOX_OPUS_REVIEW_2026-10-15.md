# Sandbox tooling Opus review — 2026-10-15

Status: **review received; follow-up parked at owner-requested session stop**.
This is source-review evidence, not a live regeneration result. The owner stopped
sandbox expansion to return attention to the feature itself. Do not automatically
implement the recommendations below or restart the sandbox rehearsal.

The host authentication check reported `claude.ai`, Team subscription. The CLI
used `--safe-mode --model opus --effort high`, Read/Grep/Glob only, no external
MCP servers, and a subprocess environment stripped of API-key/auth-token/provider
overrides. No Ultrareview or API-key review was used. The completed result names
`claude-opus-5-5` and `claude-fable-5-1` in model usage; the latter role is unknown.
An initial invalid `--safe` flag stopped at argument parsing; the documented
`--safe-mode` invocation completed successfully. No application model call ran.

Parent assessment: the asynchronous-rollup recovery finding matches the observed
1000366 stop. A separate read-only recovery path was designed but not built before
the owner paused work. Budget-file identity is a valid harness hardening item
before any live model run; no budget file was consumed or reset in this session.
The timestamp-window issue should be included if this tooling is resumed. These
findings concern the rehearsal tooling, not a demonstrated regeneration defect.

## Reviewer output

**Verdict: CHANGES REQUIRED.** There is one blocking defect and one secondary one. Everything below comes from reading the source. The only live evidence is the GET-only probe and the two failed receipts (1000365, 1000366). I did not run the unit tests; the "39 passed" figure comes from the plan doc.

## Blocking: the rollup check runs once, races a background platform job, and has no way to recover

- **Where:** `scripts/rehearse-test-request-sandbox.mjs:733`, `lib/services/test-requests/sandbox-foundation-verification.js:309-311`, `scripts/complete-writeup-regeneration-sandbox-fixture.mjs:134-135`.
- **Sequence:**
  1. The create returns 201, then the meeting-date fix, location, `observe()` and file listing run.
  2. `verifySandboxFoundationTransition` runs exactly once. If Dataverse hasn't yet recalculated `akoya_countofrequests` in the background, the count is still N while the active Request list has N+1.
  3. That pushes the count-mismatch failure, `verifyClone` passes it on, and the receipt is written with `verification.ok=false`.
  4. The fixture helper only accepts `receipt.verification.ok === true`, so it refuses permanently.
- **Why it matters:** the only recheck command (`--run-recheck`) is production-only (`rehearse-test-request-sandbox.mjs:328`). So the planned read-only recheck of 1000366 can only produce evidence. Unless someone edits the original receipt, which must stay failed, it cannot unblock the fixture. Whether a run passes depends on timing: 1000365's rollup moved about 49s after create, and 1000366's hadn't moved by 60s. Each further attempt leaves another permanent marked Request and folder.
- **Fix (narrow, still fails closed):**
  - In `executeManifest`, poll the same check read-only for a bounded time, say every 15s for up to about 5 minutes. Keep polling only while the single failure is the count mismatch and the count, its `_date` fields and the version number are all unchanged from the saved baseline. Any other failure, or a timeout, ends it immediately.
  - For 1000366, add a Sandbox-only read-only recheck that:
    - reuses the baseline already saved in the receipt;
    - requires the original failures to be exactly `['Foundation active Request count rollup does not equal the complete active Request census.']`;
    - writes a separate recheck file tied to the receipt's SHA-256 and never mutates the receipt.
  - Have `assertFactoryPair` accept either an OK receipt, or that exact failure plus a matching passing recheck.
- **Minor, not blocking alone:** `verifiedAt` is taken before the reads run (`rehearse…:735`, and the default at `sandbox-foundation-verification.js:271`). If a rollup timestamp lands in that gap, line 330 rejects it as outside the window. Set the window end after the reads.

## Secondary: the 3-call provider cap depends on the operator reusing the same file

- **Where:** `tests/integration/writeup-regeneration-sandbox.test.js:128-135`, `:340-341`, `scripts/rehearse-writeup-regeneration-sandbox.mjs:37-50`.
- **Sequence:**
  1. Run 1 makes 3 provider calls and then fails late. Its checkpoint and report now exist.
  2. To rerun, the operator has to pick a new `--report` path. If they also pick a new `--budget` path, that file doesn't exist yet, so the count starts again at 0.
  3. That allows 3 more real provider calls against the same fixture Request.
- **Fix:** tie the budget and checkpoint to the fixture rather than to paths the operator chooses. For example, derive them from `FIXTURE_PATH` or store `fixture.request.id` inside the budget file and require a match. Then refuse to run if that fixture's budget is missing but a prior checkpoint exists.

## Confirmed in source
- **Baseline durability:**
  - The baseline is saved with fsync, an atomic rename and a directory sync before `createAttempted` and the POST.
  - The source check runs again after it is captured.
  - If baseline capture throws, the POST never happens (unit test). GoVerify is restored in `finally`.
- **Missing or unknown changes fail closed:**
  - There must be exactly the 15 reviewed rollups, with matching formula hashes and types.
  - Missing fields, a changed state, a changed protected rollup, a version change with no rollup change, changed non-rollup fields or `modifiedon`, or Contact drift all fail.
  - A read error throws, which leaves no `verification` in the receipt.
- **Request set:** after create, the active set must equal the baseline set plus exactly the reserved Request, and the live count must equal that set.
- **Write and email fences:**
  - Request, suggestion, document and audit writes are limited to the exact rehearsal records. Unparseable `$batch` bodies are refused.
  - Graph writes are limited to PUTs into the writeup folder. Graph POSTs (including sendMail) and Dataverse email/send paths are refused.
  - The handoff email path uses capture stubs at `:481, :642, :652`, and notifications are mocked.
- **Provider calls:** a budget slot is claimed before each call, retries included, and other provider hosts are refused.
- **Other checks:**
  - The manifest kind matches `MANIFEST_V3`.
  - No module in `lib/` saves its own copy of `fetch` at import time, so the network fence installed later still applies.
  - No third-party HTTP clients are used.

## Residual limits
- No run has yet passed the rollup check live. The `nonRollupDigest` and window logic have only been exercised by a probe that never creates a Request. An unexpected system-managed account field changing during a rollup recalculation would fail the run, safely.
- Client-side fences can't see server-side automation. That covers the Request status patch to Phase II Pending, the Site Visit activity whose organizer is the real lead Sandbox user, and the PI Contact and reviewer creates. Mailbox sync or flows could act on any of these. The fixture script also has no network fence of its own.
- Clock skew between this machine and Dataverse's rollup timestamps, or a lock directory left behind by a crash, would stop a run. Both fail closed.
- 1000366's original receipt stays failed. A recheck that passes later only shows the count caught up within the wider window. It does not prove what else happened during that time.
