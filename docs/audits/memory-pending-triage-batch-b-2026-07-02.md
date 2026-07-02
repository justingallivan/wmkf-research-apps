# Memory Pending/Finished-Work Triage - Batch B - 2026-07-02

Status: audit-only recommendation for deferred/todo intake and cleanup memories. No `.claude-memory` files were edited because Claude's nested worktree was active when this was drafted.

## Scope

Read and classified:

- `.claude-memory/project-intake-portal-ui-todo.md`
- `.claude-memory/project-intake-portal-virus-scan-e2e-deferred.md`
- `.claude-memory/project-deferred-code-cleanup.md`

## Code-Grounded Checks

- [VERIFIED] `/apply` still auto-starts Entra External ID sign-in when unauthenticated: `pages/apply/index.js:23-27`.
- [VERIFIED] Both current `/apply` sign-out buttons still call `signOut({ callbackUrl: '/apply' })`: `pages/apply/index.js:46-48` and `pages/apply/index.js:72-74`.
- [VERIFIED] No `pages/apply/signed-out.js` route exists in the current source tree.
- [VERIFIED] Applicant sessions still carry `contactOid`, `contactEmail`, and `contactName`: `pages/api/auth/[...nextauth].js:216-221` and `pages/api/auth/[...nextauth].js:282-284`.
- [VERIFIED] The applicant surface gate still requires applicant user type plus `contactOid`: `proxy.js:121-128`.
- [VERIFIED] Intake attachment scanning still calls `scanBytes` and maps infected results to Blob deletion, pending-removal, audit, `virus_detection_intake` notification, and HTTP 422 `infected`: `pages/api/intake/draft/attach.js:397-526`.
- [VERIFIED] Unit coverage still asserts infected attachment rejection, deletion, pending removal, audit, and `virus_detection_intake` notification: `tests/unit/intake-attach-endpoint.test.js:523-563`.
- [VERIFIED] Unit coverage still asserts the infected-plus-delete-failure audit path: `tests/unit/intake-attach-endpoint.test.js:565-585`.
- [VERIFIED] The intake EICAR fixture builder still exists and documents the `ContainsExecutable` / `embedded executable` expectation: `scripts/build-intake-eicar-fixture.py:1-21` and `scripts/build-intake-eicar-fixture.py:77-81`.
- [VERIFIED] `evaluateCrossFieldNamesakeGuard` still exists and is still called inside the PubMed verifier path: `lib/services/discovery-service.js:642-650` and `lib/services/discovery-service.js:1137-1157`.
- [VERIFIED] Clearly physical/engineering proposal areas now route suggestion verification to the OpenAlex/ORCID spine before the PubMed path: `lib/services/discovery-service.js:762-769` and `lib/services/discovery-service.js:1123-1125`.

Not verified here:

- Azure portal External ID user-flow attribute settings. That requires portal inspection.
- Federated logout behavior in a browser with a real Entra External ID session.
- Deployed `/apply` virus-scan EICAR upload through a real applicant session, real Blob, and Cloudmersive.
- Whether every possible input to the PubMed verifier can no longer trigger `evaluateCrossFieldNamesakeGuard`. The current source confirms the guard remains present and called, so deletion is not pre-approved.

## Classification

| Memory | Classification | Later action |
|---|---|---|
| `project-intake-portal-ui-todo.md` | `ACTIVE_NEEDS_PROBE` | Keep active. Current source confirms the sign-out loop risk and absence of a signed-out route. Before editing the memory, verify Azure user-flow attribute collection and browser logout behavior, or mark those pieces as needing portal/browser verification. |
| `project-intake-portal-virus-scan-e2e-deferred.md` | `ACTIVE_NEEDS_LIVE_E2E` | Keep active. Source and unit tests cover the intake infected branch, but the deployed applicant-session upload path remains the exact residual risk. Run the manual EICAR e2e before applicant go-live. |
| `project-deferred-code-cleanup.md` | `KEEP_ACTIVE` | Keep active as a destructive-cleanup registry. The named guard still exists and is still called; its entry should not be converted into a deletion task without a fresh caller/input proof. |

## Reconciliation

- No memory files were deleted, demoted, renamed, or edited in this batch.
- The queue doc should now treat Batch B as audit-classified, not untouched.
- Future memory edits should preserve the carryover warnings while refreshing `last_verified` and narrowing any platform claims that cannot be proven locally.

## Residual Risk

This pass was source/test grounded, not a live Azure, browser, Vercel, Blob, Cloudmersive, or Dataverse probe. The classifications intentionally reduce active deletion pressure; they do not prove the deferred platform work is complete.
