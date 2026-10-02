---
title: Meeting transcription Sol implementation review
domain: transcription
kind: evidence
status: source-review-passed
summary: "Capped integration and Fable-remediation checks completed; Sol verified the final two exact fixes. Source-only verdict, not release approval or live database proof."
owner: product-engineering
---

# Sol implementation review — 2026-10-01

Read-only review by `gpt-6-sol`, following the owner's Luna-build/Sol-review
cadence. These are findings against the work-in-progress snapshot, not claims
that the final source still contains them. Root accepted all four and assigned
the fixes to the sole backend owner, Luna. No external state was changed.

## First bounded pass

Verdict: **needs named changes before the integrated review can pass**.

1. **High: duplicate publication race.** The service allocated a fresh operation
   ID, while the job freeze accepted an expired lease without excluding an
   unresolved prior publication. Require a transactionally enforced unresolved
   receipt guard, not only a UI restriction. Test a timed-out publication followed
   by a second Publish from the same job.
2. **Medium: Start did not dispatch promptly.** Meeting Tracker queued and returned;
   the existing pilot route dispatched immediately. Exercise both healthy dispatch
   and a truthful dispatch-failure response without duplicate provider submission.
3. **Medium: incomplete saved speaker suggestions.** Include the saved organizer,
   exclude email-only fallback names, and report an absent saved attendee map as
   unavailable rather than a successful empty directory lookup.
4. **Medium: maintenance starvation.** The oldest twenty unresolved receipts were
   repeatedly selected, while attention-only checks did not update their ordering.
   Require durable check rotation; exercise twenty persistent-attention receipts
   plus a twenty-first receipt that must eventually be checked.

Source surfaces: `lib/services/meeting-tracker-transcription/{service,binding}.js`,
`lib/services/transcription-pilot/store.js`, the existing pilot Start route, and
`lib/services/site-visit/recipient-directory-service.js`.

## Disconfirming checks

- The recipient reader uses the primary material descriptor and does not opt into
  the bundle manifest. No manifest/source exposure was found in that path.
- The new publication foreign key does not obstruct temporary receipt purging:
  the existing purge updates/redacts the job row rather than deleting it.
- The new optional SharePoint download limit checks streamed bytes and cancels
  oversized bodies; a missing or inaccurate size claim cannot bypass that cap.
- Normal invitation saving already prevents repeated attendee roles. No separate
  duplicate-invitation finding was asserted from a hypothetical malformed input.

## Stable second pass and dispositions

Sol verified all four first-pass fixes in source. The second pass additionally
found and root fixed:

- Recovery had depended on the original mapped publisher. The route now passes
  the current authenticated profile and mapped actor. Another authorized staff
  member can resume, and the registry write is attributed to that current actor;
  original receipt publisher fields remain intent provenance only.
- Same-byte SharePoint version/ETag changes could silently alter the resumed
  manifest. Recovery now compares the complete verified descriptors to the
  persisted receipt before registry activation. Negative tests cover changed
  version, ETag and site identity with unchanged bytes.
- Correction-name UPDATE reused the version placeholder for JSON labels. The
  labels now use parameter four and the expected version parameter five; the
  store test asserts both bindings.

Luna added actual candidate-receipt failure, remote registry commit followed by
a lost response, and original-fence denial/newer-winner tests. Root added
initial/correction recovery by another staff actor, incomplete-file retention,
maintenance's no-publication boundary, source-read failure, and a twenty-one
receipt fairness test. Root also made primary TXT manifest validation compare
the registry's content hash, not just its file identity fields.

**[VERIFIED via Sol's capped final read-only verdict]** No remaining material
finding in the assigned source contract. Root's integrated focused runs passed
twenty suites / 222 tests. Implementation is committed as `46ac68a62`, with the
opt-in bounded Graph download helper in `abca28759` and panel foundation in
`0f7639b5a`.

## Fable remediation and final exact-fix verification

After Fable implementation round 1, Luna implemented zero-write closure,
explicit acknowledged retained-file closure, pre-freeze gates, and terminal
superseded-receipt recovery. Root added persisted crash-safe quarantine on
freeze/renew/reclaim, matching lease quarantine checks, and unrelated cleanup
token protection. A temporary agent-thread limit initially prevented Sol's
reactivation; it subsequently recovered and Sol reviewed the stable delta.

Sol's bounded delta review required exactly two further fixes:

1. Run the transactional zero-write proof before releasing its slot. An
   ambiguous attempt retains its natural lease; a failed slot release after a
   successful close does not reopen the receipt or conceal the original error.
2. After failed Publish, reload the selected job detail/version under the
   existing active-context guards while retaining local name edits and the
   original error. Merely refreshing the collection leaves the detail version
   stale. Preserve a visible reload option when detail refresh fails.

Root implemented both. **[VERIFIED via Sol's final exact-fix read-only pass]**
Both fixes pass, with no new material defect. Job/correction tests cover closed,
unproven, proof-error, unrelated-slot and slot-release-error outcomes, including
call order and rethrowing the original error. The UI test retries without
navigation and sends the refreshed versions `[1, 3]`.

The final source commit is `c8c90af9a`. Root's final run passed **20 suites /
251 tests**, scoped ESLint, the disabled Next.js build, and the relevant
route/security/migration gates and sequential self-tests. Sol did not rerun
those commands; the test/build evidence is root's. Fable implementation round
2 returned **READY FOR DISABLED SOURCE** and requested the catch-path tests now
included; see its separate full evidence record.

No real PostgreSQL execution, physical schema apply, external provider call or
deployment was performed. SQL-string/mocked-store tests are not database
concurrency proof; that remains a separately authorized release gate. Partial
verified-file sets remain retained, not automatically deleted; an acknowledged
quarantined no-registry-match attempt can now be closed without erasing files.
This evidence grants no deployment, schema-apply, enablement or recording-test
authorization.
