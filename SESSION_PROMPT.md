# Session 422 Prompt: decide the phantom co-PI remediation, then resume the SharePoint/Connor thread

## Session 421 Summary

An incident session. A grantee saw an unrelated person's name on their award page;
the session traced it end-to-end, proved no application bug, wrote and rehearsed
the remediation, and stopped short of executing it at the owner's direction.

### What Was Completed

1. **Diagnosed the phantom co-PI on request 1002132.** The grantee portal rendered
   the byline "Heinrich Jaeger and Yvonne Mariajimenez". Yvonne is unrelated to the
   proposal: a duplicate contact carrying the placeholder email `_@_._`
   (`2a67a272-9eb5-f011-bbd3-6045bd0510d4`), created 2025-10-30T14:41:07Z — two
   minutes after the request itself and sharing its GUID batch suffix.

   **No application code is at fault** `[VERIFIED via source]`. The
   `wmkf_apprequestperson` adapter is read-only (`queryCoPIs`/`queryPersons`/
   `queryAllPersons`); nothing in the repo writes co-PI or PI fields; the Dataverse
   read path has no result cache; and the abstract-request flow writes only
   `wmkf_abstractformatted`, the deliverable status, and an email activity. The
   portal is simply the first surface that ever *displayed* co-PIs.

   Origin chain: the 2025-10-30 import attached a placeholder contact to co-PIs
   lacking an email → `scripts/backfill-request-person-junction.js` copied the
   `wmkf_copi1..5` slots into the junction on 2026-05-07T22:37:21Z → the grantee
   portal read the junction on 2026-08-12.

2. **Scoped it to seven requests, one awardee exposed.** `1002132`, `1002262`,
   `1002363`, `1002367`, `1002865`, `1002880`, `1003053`. The slot is **not**
   always Co-PI 1 (`copi2` on 1002865, `copi4` on 1002367). Only `1002132` reached
   an awardee (invited 2026-08-12T18:26:49Z; Heinrich Jaeger replied twice). Owner
   reports the other six were not awarded, so no further abstract requests are
   expected. Exposure measured at 1 of 14 generated grantee packages.

3. **Wrote and rehearsed the remediation — NOT executed.** Dry-run only; **zero
   production writes this session**. All 7 slots and 7 junction rows are still live.

4. **Recorded it for followup** in three places: the work queue, a tracked incident
   brief, and a shareable artifact
   (https://claude.ai/code/artifact/bd6881e6-7fbf-4e1a-8c6c-bb4b6e96ab14).

### Commits

- `64dd4bf4` - Add remediation script for placeholder-email phantom co-PI links
- `f9defa6d` - Record the phantom co-PI incident and its seven affected requests
- `e6d5b54e` - Log the phantom co-PI cleanup as verified-open, nothing executed

### Gotchas Worth Carrying

- **`queryRecords` renames OData annotations to a `_formatted` suffix**
  (`lib/services/dynamics/annotations.js:33`). Reading the raw
  `…@OData.Community.Display.V1.FormattedValue` key returns `undefined` for every
  lookup field. This produced two false findings mid-session ("request has no PI",
  "co-PI slots are empty") that the owner caught from the CRM UI. Use
  `row['_x_value_formatted']` in probes.
- **Production reads from local need `DATAVERSE_ALLOW_PROD_READS=yes`**, and writes
  need it *plus* a same-UTC-day `DATAVERSE_PROD_WRITE_ACK="<purpose> <YYYY-MM-DD>"`.
  The ack date is **UTC**, which rolls over mid-evening Pacific — a locally-correct
  date fails closed.
- Setting `DATAVERSE_ALLOW_PROD_READS=yes` inline was blocked by the auto-mode
  permission classifier; the owner ran every probe via `!`.

## Next Items

### Owner Decision Needed

1. **Execute the phantom co-PI remediation?** Deliberately not run — the owner chose
   not to delete data. Evidence: `outputs/phantom-copi-incident-2026-08-12.md`;
   `docs/CURRENT_WORK_QUEUE.md` audit follow-ups; `scripts/remediate-placeholder-copi.js`.

   Trade-off to settle first: deleting removes a demonstrably wrong name but does
   **not** recover the right one. The placeholder likely stood in for real co-PIs
   who had no email in the source — the `copi2`/`copi4` occupancies imply genuine
   co-PIs hold the earlier slots on those two requests. Program staff may want to
   check the seven proposals against source documents first, so the correct person
   can be entered rather than the row simply removed.

2. **Carried from Session 420 — two of three now closed (2026-08-12, S422):**
   - ~~Is reviewer activity history operational convenience or evidence?~~
     **DECIDED: operational convenience.** It must not feed reviewer-reliability or
     payment decisions; imperfect labels are acceptable where stamps are ambiguous.
     Recorded in `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`. Re-opens only
     if someone proposes using this data in a decision.
   - ~~Should Phase 1's disputed receipt evidence be reduced?~~ **ALREADY DONE** in
     `19bd000a` (2026-08-12), before this prompt was written — the S421 prompt listed it
     as open in error. `isSyntheticReceipt` is now same-instant-only; `reviewFilename`,
     `answers`, and `reviewUploadedByStaff` no longer strengthen provenance; the label is
     the neutral "Review receipt recorded".
   - **STILL OPEN — should `merge-candidates` remain organization-open?**
     (`.claude-memory/project-merge-candidates-authorization-gap.md`) The route takes no
     `requestId` and never checks membership, so any reviewer-finder user can merge
     arbitrary GUID pairs; the UI gate is documented fail-open. Deliberate per S289, but
     the S207 org-open rationale predates this destructive primitive.

### Verified Open

1. **[VERIFIED OPEN] Connor owns the phantom co-PI root cause.** The akoyaGO import
   attaches a placeholder contact to emailless co-PIs. Until that changes, new
   requests keep acquiring the phantom and any future backfill/sync copies it
   forward. Also ask whether a Power Automate flow currently syncs
   `wmkf_copi1..5` → junction on create/update — that determines whether clearing a
   slot cascades on its own. Shareable brief is written and ready to send.

2. **[VERIFIED OPEN] Run the read-only PnP.PowerShell SharePoint audit with Connor.**
   Unchanged from S420 and independent of the above — the two can go to Connor
   together. Evidence: `outputs/sharepoint-permission-audit-primer-for-connor-2026-08-12.md`.
   Still gated on a tenant-consented Entra app client ID and on whether Connor is a
   Site Collection Administrator.

3. **[VERIFIED OPEN] SharePoint durability evidence — Purview/holds.** Belongs with
   the M365 compliance administrator, not Connor; §11 of the S415 brief has the
   message ready and has no dependency on the Connor thread.

4. **[VERIFIED OPEN] Board milestone snapshot producer.** Copy-the-bytes selected
   2026-08-10. Explicitly not blocked by any SharePoint question.

5. **Reviewer drawer visual coverage — CLOSED, the layout was verified.** An
   authenticated Production smoke on Request `1002959` (S419, PR #120) checked the
   drawer, the evidence caveat, and the neutral invitation wording; owner confirms it
   looked fine [VERIFIED via `DEVELOPMENT_LOG.md:32-46`]. The S418 brief's "not
   verified: the rendered layout" was true when written and has been overtaken —
   **read `DEVELOPMENT_LOG.md`, not the brief, for ship state.** Any residual item here
   would be *automated* visual-regression coverage, which nobody has asked for; do not
   re-raise the manual check as an open risk.

   **Reviewer history persistence limits** — the gate is resolved, not merely still
   closed. This was waiting on the convenience-vs-evidence decision; convenience means
   the mutable-row limits (a staff withdrawal overwriting the original acceptance date,
   no way to prove a genuine portal submission) are **accepted as-is** rather than
   remedied. Re-open only if the scope decision changes.

### Verify Before Acting

1. **The seven-request count is a floor, not a ceiling.**
   `[VERIFIED for email exactly `_@_._`; other placeholder shapes UNTESTED]` The
   sweep matched that one literal. `x@x.com`, blank, or `noemail@…` variants would
   not have appeared. Widen the pattern (`--email` on the script, or a broader
   query) before anyone calls this cleanup complete.

2. **Re-run the dry-run before acting on the seven rows.** The recorded slot and
   junction ids are a 2026-08-12 snapshot. If a PA flow or manual edit has since
   touched them, live state has moved. `deleteRecord` does **not** tolerate 404
   (unlike `disassociate`, `write-core.js:327`) — cascaded deletes would surface as
   404 "failures" that are actually successes.

3. **Request `1002788` "To Explore the Universe" looks like test data in
   production.** Byline "Paige Kelley and UC SB and CU SD and A B and alex dragos
   and ray meyer", emails `abc@uc.com` / `alex@alex.com` / malformed
   `river@uc.com.`; marked Submitted with an invite recorded 2026-08-10. Unrelated
   to the placeholder contact and not acted on. Confirm it is a sandbox record
   before assuming so — note it is also cited as pilot evidence in
   `docs/CURRENT_WORK_QUEUE.md` order 1.

4. **SharePoint policy branch disposition.** `[RE-VERIFIED 2026-08-12]`
   `origin/codex/sharepoint-storage-policy-questions` is still unmerged: 4 commits
   ahead, `main` now 52 ahead (was 48). It strands a documented correction —
   `main` still contradicts itself on the version limit
   (`docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md:616` says 500 major versions, but
   `docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md:209` still says "Version
   limits — still open" and `docs/CURRENT_WORK_QUEUE.md:37` still says "the
   configured limit unanswered"). No gate catches it. Merge, cherry-pick the doc
   correction, or fix `main` directly — owner's call. Only the *version-limit*
   phrasing is stale.

5. **`codex/initial-assessment-pilot` disposition.** `[RE-VERIFIED 2026-08-12]`
   Still exactly 2 commits not in `main`. Sibling branches with similar names *are*
   merged — do not let a substring match report this one as merged.

### Parked

1. **Invite-tab surfacing of needs-merge alerts.** Re-open only if a new alert probes
   `STILL_BLOCKED`.
2. **Exact activity ledger and deferred-load API (Phase 2).** Stays parked, and the
   reason is now settled rather than pending: the activity-history scope decision came
   back **convenience**, so there is no evidentiary requirement to justify building a
   persisted ledger. Re-open only if that scope decision changes.
3. **Staff review step before the grantee portal shows co-PIs.** The portal displays
   the co-PI list to an external awardee with no staff confirmation, which is why a
   data error surfaced in front of a grantee rather than internally. A product
   question, not a bug — re-open only on an owner decision.

### Do Not Reopen Without New Decision

1. Launching a merge from a stored alert (`initialMerge`).
2. Changing the accepted-reviewer 90-day token policy for ordinary extensions.
3. Materializing a derived reviewer-history backfill.
4. Modifying load-bearing reviewer write paths merely to improve drawer labels.
5. **Changing application code for the phantom co-PI.** The app read and rendered
   correctly at every step; this is data remediation plus an upstream import fix.

## Key Files Reference

| File | Purpose |
|------|---------|
| `outputs/phantom-copi-incident-2026-08-12.md` | Incident record: contact GUIDs, all 7 requests with slot + junction row ids, timeline, open items |
| `scripts/remediate-placeholder-copi.js` | Dry-run-by-default remediation; resolves slot nav props from live metadata |
| `lib/services/grantee-document-assembly.js` | Builds the award byline (PI + `fetchCoPIs`) — why the portal shows co-PIs |
| `lib/dataverse/adapters/app-request-person.js` | Read-only junction adapter (proves the app never wrote these rows) |
| `lib/services/dynamics/annotations.js` | The `_formatted` annotation rename that produced two false probe findings |
| `outputs/sharepoint-permission-audit-primer-for-connor-2026-08-12.md` | Paste-in primer for Connor's SharePoint audit |

## Continuity Notes

- **`outputs/` is gitignored** (`.gitignore:55`) while its briefs are tracked. A new
  document there needs `git add -f` or it stays invisible and `git status` prints clean.
- **The other Mac may carry the `.bashrc` PATH clobber** fixed in S420. This machine
  was checked in S421 and is clean — it has no `~/.bashrc` at all, and its
  `~/.bash_profile` appends correctly. The S420 remedy is per-machine and was
  deliberately not mirrored here (owner: leave it alone).
- **Scratchpad probes die with the session.** `probe-exposure.js` (which answered
  "how many packages would render a bad byline") was scratchpad-only. The committed
  dry-run is the surviving verification path.

## Testing

```bash
npm run check:doc-currency
npm run check:docs-catalog
npm run check:doc-symbol-refs

# Read-only; requires the prod-read flag. Expect a 7-slot / 7-junction plan
# until the owner decides to execute.
DATAVERSE_ALLOW_PROD_READS=yes node scripts/remediate-placeholder-copi.js --dry-run
```
