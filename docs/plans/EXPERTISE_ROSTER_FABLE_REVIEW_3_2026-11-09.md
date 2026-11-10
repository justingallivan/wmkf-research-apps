# Expertise roster migration — third Claude Fable review

November 9, 2026; host OAuth; model `claude-fable-5-2`; session `7f84031b-07ef-4bbb-896e-8a02edaeeb68`. Reviewed the uncommitted B1–B5 repairs atop `c0530f345`. Read-only source review; no external systems or implementation.

Verification is finished; here is the third-review report.

## Verdict: READY WITH NAMED CHANGES

B1–B5 and all six rehearsal gates are resolved in the revised text. Two new plan-text defects remain, both at the boundary between rehearsal and the Production switch. Neither reopens an owner decision, and nothing supports NEEDS REWORK.

## B1–B5

| # | Status | Evidence |
|---|---|---|
| B1 Two allocators on shared DB | **Resolved in text; residual N1** | §5B requires a dedicated rehearsal Postgres and confines all work-package-4 mutations to it. §3 forbids bridge allocation or FK change on shared Postgres before cutover. §5C enables the allocator only after the freeze and high-water capture. |
| B2 Prompt gate not wired in | **Resolved as a gate; residual N2** | §5C has an entry gate that leaves Production wholly on current code, prompt and roster if the contract is not ready. §4.3 adds the GUID token, server-side validation against run-specific sets, raw-import parity and the row/fallback version contract. §6 carries the gate. This matches source: output is name-only (`expertise-finder-output-schema.js:26-34`) and the prompt labels all staff assignable (`expertise-finder-dynamics.js:21,42,156`). |
| B3 Per-consumer rule | **Resolved** | The §3 table covers six consumers for both unbound and invalid rows, and separates whole-read failure from row-level omission. Matching needs no numeric binding, consistent with `match.js:80-82`. The fail-the-send rule matches the current 409 at `recipient-directory-service.js:178-183`. |
| B4 Contact key wording | **Resolved** | §3 names a 36-character text column, canonical lowercase storage, null not empty string, and its own alternate key. The null-key gate now names both column types. |
| B5 Import idempotency key | **Resolved** | §3 defines `legacy_<source-dataset UUID>_<legacy ID>` with a fixed lineage UUID, create-if-absent, read-back comparison and stop on mismatch. §5B exercises the unlinked Board row. |

The review-2 optional items were also adopted. §4.5's pre-check now covers the second replay key, which matches `consultant-feedback-service.js:470-514`.

## Missing rehearsal gates

All six are resolved in §5B and §4.3:
- **Sandbox reference census:** every test reference gets an explicit sandbox binding.
- **Per-target link mapping:** verified counterpart, labelled synthetic identity, or unlinked fixture; no name guessing.
- **Sandbox refresh:** suspend, invalidate receipts, recensus, rebind and rerun parity.
- **Prompt row rollout:** row, fallback, code and fixtures rehearsed as one release, including mismatch and zero lead candidates.
- **Freeze guard:** installed and removed on the dedicated database, with an old-code Preview writer.
- **Sort parity:** Postgres collation and order parity required in §4.3 and §6.

## New blocking defects

**N1. The normal migration runner would apply the bridge migrations to shared Production early.**
- `scripts/apply-migrations.js:75-80,118-131` applies every untracked `.sql` file in `lib/db/migrations`, with no target check.
- The Atlas records the owner running it against the shared database for unrelated migrations (`postgres-infra-tables.md:313,326`).
- Once the bridge and FK-retarget files are merged, any routine run applies them before the §5C freeze. That contradicts §3 and §5C.
- Change: state how these migrations stay out of the shared apply path until §5C. For example, hold them off the release branch, or split inert DDL from population, FK retarget and allocator enablement.

**N2. Old code will run the new prompt row with no version check.**
- `match.js:106-115` and `batch-match-service.js:167-176` use whatever the fixed-name row `expertise-finder.match` resolves to. The fail-closed mismatch check in §4.3 exists only in new code.
- §5C says "stop new matching submissions" but names no mechanism that the currently deployed code honours.
- §5C's old-code Preview sentence covers roster writes and the roster surface, not matching. An old Preview on the same Dataverse target would send the new prompt with the old roster block and save the result to `expertise_matches`.
- Change: state the mechanism or ordering that keeps old code from resolving the new row, in Production and in old-code Previews, and add it to the §5B rehearsal.

## Non-blocking notes

- `lib/services/meeting-tracker/attendee-service.js` has the most roster-reference hits among the service-layer readers but is absent from the §5A trace list.
- Raw-import hash parity should say it uses the existing `buildRosterContext` formatter, before GUIDs enter the block.
- Match queries sort by `role_type, name` with no tiebreak, so duplicate names would make the hash unstable.
- The plan does not sequence how sandbox bindings reach the shared database for new-code Previews after cutover.

## Limits

- I could not confirm HEAD or the uncommitted state with read-only tools; I reviewed the file as it is on disk.
- I did not re-read `finalize.js`, the attachment service, the four meeting readers, `pages/expertise-finder.js` or `interlock.js` in full. Those findings are inherited from review 2.
- Which Dataverse and Postgres the Preview deployments use is unverified, and N2's Preview half depends on it.
- Dataverse behaviour for null keys, text keys, merge and attribution remains a sandbox gate, as do the owner-reviewed prompt contract and the dedicated database.
- No live schema, database, tests or external sources were consulted.

## Codex disposition

B1–B5 and six rehearsal gates are confirmed resolved by Fable. N1/N2 accepted and repaired after this verdict: normal migration files contain inert DDL only, with data/FK/sequence changes in an explicit freeze-gated operational script; a separate v2 prompt name prevents old code resolving the new contract, and verified platform admission/drain controls protect both legacy matching paths and direct deployment URLs. If those controls cannot be proved, cutover is blocked. Nonblocking notes addressed: attendee-service inventory, existing-formatter raw parity and tied-name comparison, and dedicated Postgres retained for new-code Previews. The subsequent final plan check confirmed these N1/N2 repairs; see `EXPERTISE_ROSTER_FABLE_REVIEW_4_2026-11-09.md` for the READY verdict and its limits. No schema or runtime has been deployed.
