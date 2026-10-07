# Proposal Ranking — Opus revision-2 review

Date: 2026-10-07. Actual model: `claude-opus-5-5`.
Reviewed design revision 2 via OAuth, with the owner's external review approval.
Read-only Read/Grep/Glob review; no implementation or live-system probes.
This is historical review evidence; revision 3 incorporates its named changes.

## Reviewer output (verbatim)

**Verdict: READY WITH NAMED CHANGES**

Revision 2 now implements the owner's decisions faithfully. I found no reason to rework it. The storage model is the right size: a coordinator row, a round row, and one list row per list with a JSON order array, each guarded by its ETag. The pool predicate, the frozen snapshot, and the round fencing all hold up. Six small changes would remove the remaining places where a builder would have to guess or could ship a silent hazard.

This is a review of design contracts only. Nothing below is verified behaviour, because no implementation exists. I used Read/Grep/Glob on the design, the first review and the cited sources, and made no edits.

## Design changes needed before build

**N1. Coordinator creation must never be an upsert, and the pointer should be a plain GUID column.**
- *Creation:* `executeChangeset` ops only support `ifMatch`, with no `If-None-Match` (`lib/services/dynamics/changeset.js:61,205`). A PATCH by alternate key is an upsert (`review-answer-snapshot.js:65-69`), so the losing opener could silently overwrite the winner. The fix is to state that the first coordinator row is created by POST. The unique cycle key then makes the loser fail, and that failure is treated as "lost race, reload the winner."
- *Pointer:* if the active-round pointer is a Dataverse lookup, it can't be cleared by PATCH; it needs a separate `$ref` DELETE (`write-core.js:324-330`). That makes the cancel changeset more complicated. Store the active round ID and the actor IDs as plain GUID columns, not lookups. This also removes relationships into `systemuser` (see N4).

**N2. Remove the hedge in the write-path wording: the existing transport already does what the design wants.**
- Calling `executeChangeset` without `actingUserSystemId` sends no `MSCRMCallerID` header (`write-core.js:77-82`). With no caller ID, the 403-fallback branch never runs (`write-core.js:103-104`).
- The DAL check still runs (`changeset.js:106`), and so does the interlock (`http.js:60`).
- So delete "If the existing shared transport cannot express this…" and replace it with: "The ranking adapter never passes `actingUserSystemId`." Add a unit test that pins this.

**N3. Don't treat a thrown changeset as proof of rollback, and record an operation ID on every row.**
- The `executeChangeset` docs say "a throw means NOTHING was committed" (`changeset.js:80-84`). That isn't true for timeouts or for the "could not confirm" parser path (`changeset.js:151-169`). The design gets this right, but the code comment contradicts it.
- State the classification:
  - An embedded 4xx (including 412) means the change was confirmed as rolled back.
  - A timeout, 5xx, or unconfirmed parse means the result is uncertain, so read back.
- The design only gives the round a creation operation UUID. Add a "last operation UUID" column to the round and every list row. Readback can then resolve uncertain saves, submissions, generation, publication, transfer, excusal and cancellation exactly, without comparing order contents.

**N4. Make the generic-reader exclusion specific.**
- **Precedent:** `OPERATIONAL_LOG_TABLES` (`dynamics-explorer/result-shaping.js:19,57`) is already an unconditional, server-owned exclusion, used by validation, describe and search. But it only checks `table_name`. It does not inspect `$expand` (`tool-errors.js:20-26`).
- **Existing restriction check:** the `$expand` check in user restrictions matches tables by substring of the navigation-property name (`restriction-guard.js:62`).
- **Required in the design:**
  - One shared sensitive-table registry, used by Explorer validation, describe/discover, search entity filtering and export.
  - `$expand` targets resolved through relationship metadata, failing closed when a target is unknown.
  - The ranking tables never enabled for Dataverse relevance search.
  - Explicit coverage of the automatic `createdby`/`modifiedby` relationships from `systemuser`. With app-only writes, expanding the app user's own record would otherwise reach every ranking row.

**N5. Warn before closing the escape hatches, so a program can't get stuck without anyone noticing.**
- The owner's rules combine like this: excusal ends once either program generates, and cancellation ends once either program publishes. If SE is published and an MR PD then becomes unavailable or is deactivated, MR can never be generated.
- I'm not asking to change those rules. The fix is to show a confirmation at the first generation and at the first publication. It should name the PDs whose lists in the other program are still outstanding, and say that this step ends excusal or cancellation. The stuck state should then be documented as an accepted residual risk.

**N6. Close small gaps in the excusal and transfer rules that tests need.**
- Excusal is irreversible in v1.
- An excused PD's lists become read-only.
- Whether an excused PD may receive facilitation.
- After transferring away, a facilitator who is not on the roster (the CSO) has no participant access.
- The facilitator and the roster together may edit the published list.

## Optional simplification (not a blocker)

Every save writes to the round row, so all saves contend on that one row. Saves currently retry only if the policy revision is unchanged. That means one PD's transfer or excusal forces 409-and-refresh on every other PD's next autosave. Retrying when this actor's permission decision is unchanged, rather than when the revision number is unchanged, would avoid that. The events are rare, so this is cosmetic. The overall approach is safe and simple.

## Areas assessed with no change needed

- **Pool:** the predicate is exact and reuses the existing literal, which only needs exporting (`workbenchVisibility.js:9`). Test and synthetic-review isolation helpers already exist (`test-requests/isolation.js`).
- **Opening:** the fingerprint check before opening and the rule that any failed read aborts opening are both sound.
- **Ratings with missing or older data:**
  - Missing ratings contribute nothing.
  - Stored options are compared against the 5→1 scale (`review-form-schema.js:134-140`).
  - The label+value fallback for older rows fails closed, so it can block opening but can never mis-score.
- **Race handling:** excuse vs generate, cancel vs publish, and transfer vs publish are all serialized through the round's version check. Submission is a single conditional write.

## Implementation and rehearsal tasks (not design blockers)

- Find out which status Dataverse returns for a duplicate alternate key inside a changeset (412 or 409), and treat both as a lost race.
- Probe the target cycle for older rating rows without stored options, check their label formats, and check currency (`transactioncurrencyid`) across the pool.
- In rehearsal, confirm that System Customizer and every staff role has no privileges on the new tables, and that an ordinary PD's direct Dataverse access is denied.
- Set limits on snapshot and event-log size, and a bound on save retries. Test autosave contention and the races in the two-browser rehearsal.

## Residual risks

- Tenant administrators can still read the tables.
- A former facilitator keeps whatever they saw before a transfer.
- Dataverse's own audit history shows the app user as the author, so the actor columns are the only record of who acted.
- A pending review fixed at opening can only be added by cancelling and reopening, and only before any publication.
- Fixing an older rating row that doesn't match the scale is a manual step that blocks opening.
