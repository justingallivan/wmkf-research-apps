# Proposal Ranking D26 — invited-amount correction to the open round

Date: 2026-10-23. Status: **Applied and verified in production 2026-10-23** (plan hash `7cccbe76`; owner-run). Verify: round holds the correction, #1002821 and #1003000 stored $1,300,000.00 (invited), D26 active round unchanged, no app activity since the plan. Owner decisions: merge the labelling branch first (done, `4a37f2f9b`); append a round log event (done). Plan file and journal are in the owner folder `~/Downloads/Ranking D26 invited amounts/`, outside git. Owner: Justin Gallivan.

## 1. Goal and decision

The D26 round froze `akoya_request` (requested amount) for each proposal when it
opened. The meeting should use `wmkf_invitedamount` (invited amount). Two of four
PDs have already submitted [owner-reported; step 4.1 records it], and the owner does not want anyone to
re-rank. So correct the amounts **inside the open round's frozen snapshot**, in
place, without touching any PD assessment, readiness, or workflow state.

Not in scope: reopening, restarting, or replacing the round; changing any
Dataverse request record; backfilling other cycles.

## 2. What changes

Two proposals, both lower when invited [VERIFIED 2026-10-23 via
`scripts/probe-ranking-invited-amounts.mjs --cycle=D26`, owner-authorized
production read: 23 ordinary Phase II Pending proposals, 2 differ, 0 blank
invited, 5 ZZTEST requests excluded]:

| Request | Program | Frozen (requested) | Correct (invited) | Change |
|---|---|---|---|---|
| #1002821 | MR | $1,600,000.00 | $1,300,000.00 | −$300,000 |
| #1003000 | SE | $1,500,000.00 | $1,300,000.00 | −$200,000 |

The other 21 proposals' invited and requested amounts match today, so their
frozen values are already correct.

That probe read live request records, not the round. Step 4.1 confirms these
two request numbers are in the frozen 23 and still hold the requested values.

## 3. Why an in-place snapshot edit is safe

Each claim was read in source on 2026-10-23.

- **Amounts live only in the snapshot.** The round's `wmkf_snapshotjson` holds
  each proposal's `amountMinorUnits` (integer cents) and currency. Card amounts,
  running totals, section totals and the workbook are all computed from it on
  every read. See `assessments.js:179-190` (section totals via
  `calculateCumulativeTotals`), `workbook.js:60-86`, and the v2 `publicSnapshot`
  in `workflow-service.js:274`. PD assessments, reveal records (`workflow.js:235`:
  individuals, baseline) and history rows store orders, grades and separators,
  not amounts. [VERIFIED via source]
- **The app never rewrites the snapshot after opening.** V2 round updates patch
  only `wmkf_workflowjson` plus the operation stamps (`workflow-service.js:734-738`).
  The snapshot is written at creation, and copied as-is into a replacement round
  on restart (`workflow-service.js:669`), so a corrected snapshot would carry into
  any later restart. The only other app writer is the v1 excuse-participant
  action (`service.js:968-974`). It spreads the *current* snapshot under
  `If-Match`, so it would keep the correction too. Reveal baselines hold order,
  boundaries, scores and ranges only (`workflow-service.js:316-322`). [VERIFIED
  via source; writer set from `grep wmkf_snapshotjson lib/`]
- **Concurrent writes can't silently overwrite each other.** Every app round write
  is conditional on the ETag (`If-Match`) (`proposal-ranking.js` adapter:106, 114,
  121, 146). A PD action carrying the old round ETag is refused as stale
  (`workflow-service.js:588`), and the UI's "Check and retry" path re-reads. The
  edit uses `If-Match` too, so it fails rather than overwriting a PD write that
  lands between plan and apply. [VERIFIED via source]
- **Readiness is unaffected.** Readiness and preparation versions live in
  `wmkf_workflowjson` and the list rows, which this edit does not touch.
  [VERIFIED via source: the edit writes only `wmkf_snapshotjson` and `wmkf_administrationlogjson`]
- **V2 retries don't depend on the stamps.** V2 resolves retries through `o:<UUID>`
  receipt rows, not the round's `wmkf_lastoperationid`; that field is read only on
  the v1 path (`service.js:509`). The edit leaves all stamp fields as they are.
  [VERIFIED via source]

Side effect: the edit changes the round ETag. A PD with the page open who then
saves gets one stale-change prompt and retries. Their saved work is not lost.
Best to apply when no PD is actively editing.

## 4. Steps

### 4.0 Ordering choice — amount only, or amount and label

The edit sets `amountSource: 'invited'` on all 23 proposals (true for every one,
per §2). Whether the cards say so depends on what production is running:

- **Edit without merging the branch:** amounts and totals are correct. Production
  code drops `amountSource` (the v2 `publicSnapshot` allowlist) and labels every
  card "Requested", so the two cards would read "Requested $1,300,000.00".
- **Merge `proposal-ranking-invited-amount` first, then edit:** amounts are
  correct and every card reads **Invited**. This puts the branch's formal
  `/contract-reconcile` pass and deliberate promotion ahead of the edit.

Either order is safe. The key is harmless to code that ignores it.

**Decision (owner, 2026-10-23): merge first, then edit.**

### 4.1 Plan (read-only, owner runs)

`scripts/correct-ranking-invited-amounts.mjs --plan --dir=<owner folder> --approver="<name>"`
(pure logic in `scripts/lib/ranking-invited-correction.mjs`, tested in
`tests/unit/ranking-invited-correction.test.js`):

1. Reads the D26 cycle coordinator and its active round. Requires round
   `49279ac7-3ab9-41d8-b2d6-5aaf4085e642` to be the active pointer, active state,
   snapshot `version: 2`, exactly 23 proposals, each with a frozen currency, and a
   snapshot that round-trips through JSON unchanged.
2. For each frozen proposal, reads the live request by `requestId` and requires
   `wmkf_invitedamount` non-null and not a test request. Computes the new
   `amountMinorUnits` with the app's `moneyToMinorUnits(invited, precision)`
   (`calculations.js:102`), so it matches what a fresh preview would freeze.
3. Requires exactly the two changes in §2. Each must have its old value equal to
   the frozen requested amount, and nothing else may differ. Otherwise it stops
   and prints the difference.
4. Writes a local plan file (outside git, in the owner folder) containing:
   - round ID and ETag;
   - SHA-256 of the current snapshot JSON, and the full original JSON for rollback;
   - the new snapshot JSON and its SHA-256;
   - the per-proposal changes;
   - list-row statuses and versions, and the workflow stage/preparation version,
     as an unchanged-state baseline.

   It prints the plan hash and the before/after table. It prints no reviewer
   scores and no PD orders.

The new snapshot is the parsed original with only `amountMinorUnits` changed on
two proposals and `amountSource: 'invited'` added to all 23. Every other key and
value is identical.

### 4.2 Apply (owner runs; same-day write ack)

`--apply --dir=<folder> --confirm=<plan hash>` with `DATAVERSE_ALLOW_PROD_READS=yes`
and a same-UTC-day `DATAVERSE_PROD_WRITE_ACK`. It decides from the stored round,
not from the local journal (`decideApply`):

1. Round already holds the planned correction → nothing to do. This covers a PATCH
   that committed but whose response or readback was lost.
2. Round holds the planned original with the planned ETag → one
   `PATCH wmkf_proposalrankingrounds(<id>)` with `If-Match: <plan ETag>` and body
   `{ wmkf_snapshotjson, wmkf_administrationlogjson }` only, through the adapter's
   `patchRound`.
3. Anything else (the ETag moved, or the content matches neither state) → refuse.

If the PATCH or readback doesn't confirm, the script says the outcome is unknown.
Run `--verify`, then re-run `--apply`. The journal
(`ranking-invited-applied.jsonl`) is a record only.

### 4.3 Verify (owner runs; read-only)

`--verify --dir=<folder>` reports:

- whether the round holds the original, the correction, or neither;
- the two stored amounts and their `amountSource`;
- whether D26's active round is still this one;
- any app activity since the plan (round last-operation stamp, workflow, list rows).

Then the owner opens the round in the app. The two cards should show
**Invited $1,300,000.00**, and the Recommended total and running totals should
reflect it.

### 4.4 Rollback

`--rollback --dir=<folder>` restores the original snapshot and log byte-for-byte
(`decideRollback`). It runs only if the round holds the correction **and** shows no
app write since the plan. Every app round write stamps `wmkf_lastoperationid`
(`service.js` `actorPatch`, at all four round write sites; `workflow-service.js:734-738`
`stamp`), and v2 actions also rewrite `wmkf_workflowjson` and list rows. This
script's own PATCH changes none of them, so the fence doesn't depend on capturing
the ETag after the write. [VERIFIED via source; writer set from `grep patchRound\|patchRoundAndList\|cancelRoundChangeset\|commitAssessmentChanges lib/services/proposal-ranking`]
If the round already holds the original, rollback is done. If a PD has acted
since the plan, it refuses: plan a reverse edit from the current state rather than
forcing it. Re-planning in the same folder is refused while the round still
holds that plan's correction, so the only copy of the original is never
overwritten (dated copies are also kept as `ranking-invited-plan-<hash>.json`).

Codex adversarial review, 2026-10-23, found two gaps, both fixed before any apply:
- rollback trusted an ETag read after the write, which a PD action could already
  have advanced;
- a committed write with a lost response could not be reconciled.

Both are tested in `tests/unit/ranking-invited-correction.test.js`.

## 5. Open questions and assumptions

1. **Write privilege.** The local application identity's ability to PATCH
   `wmkf_proposalrankingrounds` in production is [ASSUMED — needs
   verification]. The ranking role is Create/Read/Write for the app user, and the
   Atlas notes that ordinary staff must not gain direct privileges. If the local
   identity lacks it, the apply fails closed with 403, and we decide then. No
   role change without a separate decision.
2. **Write context.** Plan, apply, verify and rollback run inside
   `bypassDynamicsRestrictions(<purpose>, …)`, the same trusted script context
   `scripts/apply-research-copi-stage-b.mjs` used for production writes on
   2026-10-23. [VERIFIED via source, `apply-research-copi-stage-b.mjs:341`]
3. **Interlock.** That the target interlock permits a local, acknowledged PATCH
   on this entity set is [ASSUMED]. The Stage B co-PI apply used the same ack
   path for other entities. The apply surfaces a refusal as an error, not a
   bypass.
4. **Dataverse audit** on `wmkf_proposalrankinground` is [ASSUMED — not
   probed]. The plan file and apply log are the record of this change either way.
5. **In-round record (owner decision).** The round has
   `wmkf_administrationlogjson`. V2 creates it as `[]`
   (`workflow-service.js:677`), and no V2 action appends to it. The plan as
   written leaves it alone and keeps the record in the local plan file and apply
   log. Alternative: append one `invited-amount-correction` event in the same
   PATCH, so the round itself shows the change. **Decision (owner, 2026-10-23):
   append the event.** Log readers match events by operation ID and type
   (`service.js:72-75`, `523-526`, `883-884`), so a new type with a fresh UUID
   cannot collide. [VERIFIED via source]
6. **Timing.** The two PDs not yet ready will see the corrected amounts on their
   next load. The two already ready will see them too, but their readiness and
   orders are unchanged. The owner may want to tell all four that these two
   amounts changed.
7. **Workbook already shared?** If anyone exported a workbook before the edit, it
   has the old amounts. Reveal hasn't happened (2 of 4 ready), so no collective
   workbook should exist yet [ASSUMED; step 4.1 reports the workflow stage].
