# Claude Opus follow-up closure review — 2026-09-30

Scope: draft PR #375 follow-up to commit `d4a83fee1`; review performed before the follow-up commit. No production promotion or live writes.

The orchestrator independently hashed the unchanged worktree diff before persisting this receipt; the reviewer had read-only tools and did not execute tests.

Subscription OAuth verified as claude.ai; API-key source none. Model claude-opus-5-5.

I've finished reading the code. **APPROVE.** I found no blocking defects for fingerprint `eabd04f42e1d916248a31d57b0eac57261e0d62f22ff2dbbf83339f109dcc427`. I can't compute that hash with read-only tools, so it's the fingerprint you supplied, not one I checked myself. I didn't run the tests or lint, and I didn't write a plan file because you asked for no file edits.

## Findings

1. **The prior residual is closed.**
   - `hasRecordedCandidate: true` is set in only one place: the validated `file.candidate` branch at `material-service.js:1843-1846`.
   - That candidate comes from the server-side ledger row (`claim.row?.candidate_result`, `finalize.js:129`), not from anything the client sends.
   - On a rejected recorded retry, the renew and record steps at `material-service.js:1669-1672` are skipped and the call throws a permanent 409. The route then rejects the staging row (`finalize.js:171-174`), so the earlier attested receipt stays in place.
   - Cleanup then checks that receipt against the edited item. Size and ETag differ (`portal-upload-staging.js:450-458`), and the hash fallback also fails (`:459-462`), so it returns `null` and nothing is deleted. Edited bytes never get deletion authority.

2. **Fresh orphan tracking isn't blocked.**
   - A fresh upload (`:1896`) and a path-conflict recovery (`:1875` → `:1748`) both pass `uploadContext` without the flag.
   - A rejected stable package in either case still renews the lease and records its exact stored-byte receipt before the 409 (`:1670-1671`).
   - `hasRecordedCandidate` is spread into a new object only in the recorded branch. The shared `uploadContext` (`:1837`) is never changed, so the flag can't leak into other paths.

3. **Source proof isn't bypassed.**
   - The flag is read only inside the `catch` after `attestDocxPackageAgainstSource` (`:1658-1674`). Every path, including the recorded retry, still attests.
   - The strict comparator and the metadata/download stability checks (`:1623-1648`) are unchanged.
   - Publication happens only through `return receipt` after a successful attestation.

4. **Lease and error handling don't regress.**
   - On fresh/conflict paths, a failure in renew or record propagates instead of the 409. A `PortalUploadStagingError` leads to release (`finalize.js:163-167`), and other errors release at `:182-184`, so staging is kept.
   - On the recorded path, no lease-fenced write happens on rejection, which is correct because nothing needs writing.
   - A missing or zero size still returns 503 before any download (`:1623-1625`).

5. **Diagnostics expose no private data.** The flag doesn't touch them. The warning at `:1661-1665` still logs only the request/staging IDs and the fixed part/kind categories.

6. **The regression test is adequate.** It builds the prior receipt from a real successful finalize, changes the bytes, ETag, version and size, and checks for no record write, no create, and that the prior receipt's hash still differs from the edited bytes.

## Residual limitations (non-blocking)

- **Unattested bytes can still be recorded on a conflict retry.** If an earlier attempt uploaded but crashed before recording a receipt, and someone edited the file at this staging's unique path before the retry, the conflict path records a receipt for whatever bytes are there then. Exposure is limited because the filename includes the staging GUID and cleanup still requires zero registry rows plus an exact byte/ETag match. This is the fresh/conflict receipt behaviour you already intended.
- **A retained prior receipt can mean retained orphans.** After a rejected recorded retry, an edited orphan won't match the old receipt, so automatic cleanup keeps it and it needs manual cleanup. This follows from the safer choice and matches the docs ("outside automatic deletion authority").
- **The retry test doesn't check the log or lease calls.** It doesn't assert that `renewPortalUploadLease` was skipped on the rejection path. The record-not-called assertion covers what matters, so this is optional.
