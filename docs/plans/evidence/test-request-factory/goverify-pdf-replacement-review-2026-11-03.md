# GoVerify PDF replacement: narrow correction and review

Owner authorization: 2026-11-03; Claude Fable subscription review, followed by
resumption of the already-reserved bounded fixture. Merge/deployment remain held.

Contract-reconcile Mode B. Surface: optional private-file CLI evidence, pure
Foundation transition check, clone verification and readiness prerequisites.
Entry points: production CLI advance/recheck/finalize/recover. Persistence:
existing immutable `fence_source` projection digest and existing outcome journals;
no new schema or baseline writer. Consumers: runner, read-only Foundation recheck,
readiness finalizer/recovery; admin callers retain the default null-only path.

| Invariant | Surface | Verification |
|---|---|---|
| Only PDF replacement is conditionally accepted | Foundation evaluator | Substitute only the supplied prior PDF and reproduce the original whole-projection digest |
| Invalid/wrong prior evidence fails closed | Evaluator/CLI | Synthetic malformed, wrong-preimage, at/after-capture and null-baseline negative tests |
| Existing result/contact/rollup protection remains | Evaluator | Tests with actual additional drift present |
| New generated URL and trigger remain time-bound | Shared parser/evaluator | Existing and replacement timestamp/trigger tests |
| Every CLI verification path gets the same evidence | Runner/recheck/readiness/recovery | Runner and finalizer/recovery propagation tests; private-file parser tests |
| No ordinary request, baseline or URL persistence change | Existing fences/journals | Source trace; no new entity write, migration, receipt field or HTTP input |

Partial-success audit: `verify` still reports needs_attention on any failed
check; status/readiness operations cannot treat it as a completed clone.
Async audit: no new async persistence writer; existing run lease, status CAS,
readiness attempt CAS and ETag guards are unchanged. Helper audit: timestamp
parsing separates shape from old/new windows; supplied evidence never falls back
to null. Durable audit: no schema change; Atlas/runbook/production-plan statements
updated. Fan-out audit: all four CLI operations route the option; admin callers
supply none. No new browser/client/UI input or approval bypass exists.

The initial review prompt was rejected by automatic approval review because it
included live operational data. The submitted review used only repository source
and synthetic examples, with live identifiers/audit data redacted. Claude ran via
host Keychain-backed OAuth, safe mode, Read/Grep/Glob only, empty MCP configuration
and a credential-free environment whitelist. No API key or substitute product.

## Fable plan review

**Verdict: READY WITH NAMED CHANGES.**

The premise is correct. The baseline at `fence_source` holds only a projection digest, and `evaluateFoundationTransition` restores the PDF field to a hard-coded null before re-digesting (`lib/services/test-requests/foundation-transition.js:370`). A replacement therefore genuinely needs the prior URL as a preimage, and the proposal does not weaken any existing check. The named changes below are contract issues to fix before implementation.

**1. Recovery is a missed caller. Blocking.** `recoverReadiness` shares `prerequisites` with `finalizeReadiness`, and that function runs the Foundation recheck unconditionally (`lib/services/test-requests/readiness-finalizer.js:73`). With the option only on finalize, a run whose PDF was replaced can never be recovered after a failed readiness attempt. Extend the option to `--recover-readiness`, or state in the plan that recovery is blocked for such runs.

**2. A simpler equally safe design exists.** Replace the hard-coded null with the supplied value, defaulting to null, and re-digest once. The null-only path becomes the degenerate case when the option is absent. When the option is present, do not also try the null path. A wrong preimage must refuse, which is what "the supplied value proves a hash preimage" means. This also covers the existing "field absent from baseline row" test for free.

```js
const restored = { ...accountAfter, [GOVERIFY_PDF_FIELD]: previousGoverifyPdfUrl ?? null };
```

**3. Split parsing from the window check.** `goVerifyPdfTimestamp` validates shape and the run window together (`foundation-transition.js:272-299`). Separate them so the prior URL is checked for shape plus timestamp strictly before capture, and the new URL keeps the capture-to-verify window. New-after-prior ordering then follows without a separate rule. Keep the existing lower bound without clock skew for consistency with the new-URL check.

**4. Failure text must never carry the URL.** The runner joins failures into the thrown message (`lib/services/test-requests/run-runner.js:1071`), and the CLI writes that message to a private sidecar file. A distinct failure for an invalid prior link is useful and safe if it names the rule only. Preimage mismatch should keep the generic protected-columns message, since it is indistinguishable from other drift.

**5. Threading points to name in the plan.**
- `advanceRun` destructures `options` and passes named arguments to each handler (`run-runner.js:4194`, `4235`). The option rides alongside `bypassGoverify`, and the JSDoc options list at line 4174 needs updating. Only `stepVerify` consumes it, so a multi-step `--advance` loop is harmless.
- `runRecheck` in the CLI script has no options parameter today (`scripts/rehearse-test-request-sandbox.mjs:1358`).
- Finalizer and recovery inputs flow into `prerequisites` at line 55 of the finalizer.
- The admin form builds its own options and calls the recheck without one (`lib/services/test-requests/admin-run-service.js:762`, `832`). CLI-only holds by construction. Say so in the plan.

**6. Parser constraints.** The script already couples finalize and recover to production at line 326. Add refusals for a sandbox target, for any mode other than advance, run-recheck, finalize-readiness and recover-readiness, and for an empty value. Leave deep validation in `evaluateFoundationTransition` so the malformed-input tests live with the contract.

**7. Tests beyond the listed set.**
- Option supplied but the baseline PDF was null. Refused as a wrong preimage.
- Prior URL equals the new URL. Refused.
- Prior timestamp at or after capture. Refused.
- Finalizer propagation. The finalizer test mocks the recheck entirely (`tests/unit/test-request-readiness-finalizer.test.js:17`), so assert the mock's call argument carries the option, for both finalize and recover.
- Runner propagation through the `verifyWith` helper (`tests/unit/test-request-run-runner.test.js:755`).
- Admin service recheck still passes no option.

**Non-blocking.** The verify outcome receipt records only kind and outcome (`run-runner.js:1130`). A boolean noting that the assist was used, never the URL, would explain a later form recheck failure, but the receipt grammar is allowlisted and that is the owner's call.

Synthetic example of the accepted shape, reusing the test fixture pattern: prior `GOverifyUpdate_20260803181512000.pdf` in the same folder, new `GOverifyUpdate_20260928180115945.pdf`, capture at 18:00:00Z and verify at 18:05:00Z on 2026-09-28, trigger moved into the window.

Named changes incorporated: recovery caller, one candidate/no null fallback,
separate shape parser, sanitized failure text, production/mode/parser limits,
private-file input, and propagation/complement tests.

## Fable code review

**Verdict: READY FOR LIVE TEST.** The prior-PDF path matches the plan verdict, fails closed on every drift class I could construct, and the evidence string never reaches a log, ledger row, or error message.

**What I confirmed in the code**

- **Evidence is used only as a digest input.** `previousGoVerifyPdf` is consumed at `lib/services/test-requests/foundation-transition.js:378` by the timestamp parser and at `:381` by the projection digest. No failure string interpolates it. The verify outcome row at `lib/services/test-requests/run-runner.js:1130` holds kind and outcome only. The finalizer collapses any failure to a fixed sentence at `lib/services/test-requests/readiness-finalizer.js:74`. The CLI recheck prints names only at `scripts/rehearse-test-request-sandbox.mjs:1389`. The advance sidecar at `:1145` carries the joined failure list, which is value-free.
- **No null fallback when supplied.** At `foundation-transition.js:379` a supplied value must parse and be strictly before capture. The restored row at `:381` always uses the supplied value, never null. The test at `tests/unit/test-request-foundation-transition.test.js:178` pins this with a null baseline plus valid prior evidence.
- **Exact whole-row digest, no baseline mutation.** The restored projection is built from the full after-row with one field substituted, then compared to the stored digest. Tests at `:156` through `:161` cover other-column drift, tax status, rollup, contacts, trigger not moved, and after-PDF null. The recheck test at `:447` asserts the baseline object is unchanged.
- **Prior-URL shape and time are checked independently of the digest.** Test at `:164` through `:173` shows a matching preimage still fails for wrong host, future stamp, invalid date, or query string. At-capture equality fails at `:181`.
- **Threading is real end to end for advance.** `advanceRun` at `run-runner.js:4196` and `stepVerify` at `:1047` pass it through. The runner test at `tests/unit/test-request-run-runner.test.js:778` runs the real evaluator with a non-null baseline PDF, so the `ready` outcome proves the evidence arrived. The finalizer tests mock the recheck and prove only that both finalize and recover forward the value to the shared prerequisite.
- **CLI scope.** `parseArgs` at `scripts/rehearse-test-request-sandbox.mjs:338` rejects the flag unless target is production and the mode is advance, recheck, finalize, or recover, and requires an absolute path. The reader at `:1077` requires a regular file of at most 2048 bytes and trims. The parser test covers all four modes plus sandbox, run-inspect, relative, and empty rejections.

**Non-blocking notes, no change required before the live test**

- The evidence file is read after token acquisition in the finalize and recheck callers at `rehearse-test-request-sandbox.mjs:1430` and `:1463`. Only advance at `:1101` reads it first. A bad path wastes one token fetch, nothing more.
- Help text at `:474` names the flag only under advance, while the parser accepts it for recheck, finalize, and recover.
- The new JSDoc at `run-runner.js:4191` sits between the existing `advanceRun` doc block and the function.
- The PDF filename stamp window at `foundation-transition.js:303` has no clock-skew tolerance, while the trigger stamp at `:270` allows five minutes. Both stamps appear to be server time per the observed fixture at test `:114`. A local clock running ahead of Dataverse would fail a legitimate refresh, closed not open. This is pre-existing from the null path and is only a false-negative risk for the live test.
- The reader bounds size by stat, then reads the whole file and re-checks string length. A file swapped between stat and read is still rejected by the second check.

Nothing in the admin form path was touched, and no code path outside the owner CLI supplies the evidence.

## Reviewed runtime fingerprints

```text
5436195dcd39f1a470e4b8706b5d378b9afd46843f7562d03e3b946c432b1806  lib/services/test-requests/foundation-transition.js
0d74e93db961b71fbfa7afe6fc00ffe37a489f92e3d5bdade3802252424cf775  lib/services/test-requests/run-runner.js
726059acdc40a6d4601b5b415a26d7e1b28a4508a92abb95353480753ab73e9b  lib/services/test-requests/readiness-finalizer.js
b661f7ab122f47495d8a6932a566420e8026a6bc3d8ef5c48f5dd74bb06b6667  scripts/rehearse-test-request-sandbox.mjs
```

Validation: 192 focused tests passed; expanded Factory run: 23 suites /
1,089 tests passed (two suites / 20 tests skipped by existing configuration).
Types, scoped lint (zero errors; one existing unused-disable warning), production
build, DAL/OData/secret gates and sequential self-tests, Atlas/docs gates and
self-tests passed. No baseline/schema writer or web input was added.
