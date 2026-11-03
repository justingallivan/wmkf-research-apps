# Prepared J27 Factory — final Fable review

Verdict: **READY FOR OWNER REVIEW**. Plan and code reviewed using the user-authorized Claude OAuth subscription. Model `claude-fable-5-1`; Read/Grep/Glob, safe mode, empty MCP configuration, credential-free environment whitelist. No permission denials, API-key model authentication or substitute review product. Earlier findings and closures are retained in adjacent dated review receipts. No managed migration, Production write, merge or Production deployment was performed.

**READY FOR OWNER REVIEW.** The preview-order correction closes the operating-note mismatch.

**What the code now does.** The read-only return sits directly after the journal read and ahead of abandoned normalization, the already-true adoption guard and the needs_attention refusal (`lib/services/test-requests/readiness-finalizer.js:85-92`). It carries attempt, journal status, error and effects, so a 412 conflict, a refused PATCH, unexpected post-stamp effects and an abandoned attempt are all distinguishable from the preview output. The runbook sentence that names the preview as the inspection command is now accurate. The confirmed path is unchanged: abandoned still normalizes to a fresh plan, an outside true stamp still refuses adoption, needs_attention still refuses, and the write permit, fresh ETag read, plan and attempt-bound dispatch follow in the same order as before.

**Tests match.** The new parameterized case covers needs_attention with readiness true and unexpected effects, needs_attention with readiness false and an ETag conflict, and an abandoned attempt with a refused-PATCH error (`tests/unit/test-request-readiness-finalizer.test.js:152-157`). Each asserts the preview returns the diagnostics with no plan call and no PATCH, and the two needs_attention cases also assert the confirmed run still refuses with the owner-inspection message.

**One behavior change to note, not a defect.** A preview on a run whose readiness reads true with no journal entry now returns a read-only plan showing ready true and null journal status, where it previously threw the adoption refusal. The refusal still fires on confirm, so no write is possible, and the preview result is more useful for diagnosis. Prerequisite failures such as package integrity or identity mismatch still throw before the preview, which is pre-existing and outside the named gap.

## Reviewed runtime fingerprint

SHA-256 of the final corrected source, recorded after the bounded closure.

| File | SHA-256 |
|---|---|
| `lib/services/test-requests/readiness-finalizer.js` | `88f44031f04314abe41b54f52e3eb42d10e95138618f82eabc02b2b41d68ceb8` |
| `lib/services/test-requests/readiness-journal.js` | `f2051ec303b43baf5f735b314c8ab343a208aaf5d406d41f306e793bc7fec5d9` |
| `lib/services/test-requests/prepared-fixture-contract.js` | `c4e1f3ff48fab47e1a0bbec2f209e7c455cb5f20967de5b849af3fc6b97dd179` |
| `lib/services/test-requests/admin-run-service.js` | `73955ffea39f2ff06ec9203aa84bbdf758b92d42523979da1375e0265eac2150` |
| `lib/services/test-requests/basic-clone-steps.js` | `3e5c9a53a7565280459f286fff795c731c6762cc8f1a7594e050176b4dfdad7a` |
| `lib/services/test-requests/policy.js` | `651e44a24ff4a4a98f28aabfd8550fc78f45d5a7eacebdeb06c524609e046ead` |
| `lib/services/test-requests/production-write-fence.js` | `7a45ceeb398b2d65e236f5d2e3748508d7ad02d8caae2bc380b5fb47f6d23c94` |
| `lib/services/test-requests/run-runner.js` | `796007b037ad4d65d1a39910a237f63382b73e94ca6c500debc83397acf046db` |
| `lib/services/test-requests/sandbox-clone.js` | `703f109d62e9ea770bd875ce05434dda8469f1f8e2d023a56097db0ce41e1158` |
| `lib/services/test-requests/status-change-runner.js` | `92ebff46e3cfefbe8e096c8af6d43fcc49c5d76fd473c01e14eff8f2b5825b69` |
| `scripts/rehearse-test-request-sandbox.mjs` | `c9b5b969b493409eebb312d77bc9456407aa0a89e12122814f7c80a84a45e335` |
| `lib/db/migrations/094_test_request_readiness_finalizations.sql` | `318cbd5b237d04509c7899e22d1c8ee228d64836cd39d3b879e2330ed5cccb38` |
