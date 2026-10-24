# Proposal Ranking D26 — invited-amount correction to the open round

Date: 2026-10-23. Status: **Plan approved 2026-10-23 (merge branch first; append a round log event). Script `scripts/correct-ranking-invited-amounts.mjs` written; nothing written to production.** Owner: Justin Gallivan.

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

`--apply --plan=<file>` with `DATAVERSE_ALLOW_PROD_READS=yes` and a same-UTC-day
`DATAVERSE_PROD_WRITE_ACK`:

1. Re-reads the round. Refuses if the ETag or snapshot hash differs from the plan.
2. Issues one `PATCH wmkf_proposalrankingrounds(<id>)` with `If-Match: <plan ETag>`
   and body `{ wmkf_snapshotjson, wmkf_administrationlogjson }` only, through the
   adapter's `patchRound`.
3. Appends the outcome (old/new hash, new ETag, time) to an apply log beside the
   plan.

### 4.3 Verify (owner runs; read-only)

`--verify --plan=<file>`:

- the stored snapshot hash equals the planned new hash;
- the two amounts read back as $1.3M with `amountSource: 'invited'`;
- `wmkf_workflowjson`, every list row's version and status, and the active
  pointer equal the baseline.

Then the owner opens the round in the app. The two cards should show
**Invited $1,300,000.00**, and the Recommended total and running totals should
reflect it.

### 4.4 Rollback

`--rollback --plan=<file>`: `If-Match` on the post-apply ETag. It restores the
original snapshot JSON byte-for-byte, and refuses if the round changed since
apply. If a PD has saved since then, the ETag has moved and rollback refuses.
In that case re-plan a reverse edit from the current state; don't force it.

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
