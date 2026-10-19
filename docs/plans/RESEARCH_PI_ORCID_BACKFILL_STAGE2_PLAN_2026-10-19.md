# Research PI/co-PI ORCID backfill — stage 2 (write) plan

Date: 2026-10-19. Status: **DRAFT FOR REVIEW — not built, no production writes.** Owner: Justin Gallivan.

## 1. Context

Stage 1 is read-only and lives on branch `claude/session-2026-10-19`:

- `scripts/export-research-orcid-backfill-pool.mjs` (owner-run, reads production Dataverse) exports PIs and co-PIs on awarded Research requests (Approved/Active/Closed, `wmkf_meetingdate` within 10 years) whose `contact.wmkf_orcid` is empty.
- `scripts/match-orcid-backfill-candidates.mjs` reads that file plus the public ORCID and ROR APIs and writes a review CSV. Every graded row names one `selected_orcid`; grades are `high`, `review` or `none` (rules in the script header).

A wrong contact ORCID is worse than a missing one. `contact.wmkf_orcid` feeds PI exclusion and conflict-of-interest checks (`lib/services/proposal-pi-identity.js`), honorarium contact matching, and reviewer acceptance, where a later self-reported ORCID that disagrees only records a silent conflict and never corrects the contact. [ASSUMED per `docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md` and a delegated source survey; not re-traced this session] The prior contact-ORCID backfill (`scripts/backfill-contact-orcid.js`, completed S217, 162 writes) is the structural template; it must not be rerun. [VERIFIED via `scripts/backfill-contact-orcid.js:1-36`]

## 2. Inputs and approval

1. Staff review the stage-1 CSV and add two columns: `approve` (`yes` only) and `approved_by`. Only rows with `approve=yes`, a `selected_orcid`, and a non-empty `approved_by` are eligible. An approver may change `selected_orcid` to another candidate they verified; the row then records `selection_overridden=yes`.
2. The script hashes (SHA-256) the approved CSV and the stage-1 pool JSON, and records them with the Dataverse host and run id in every checkpoint line. Apply refuses to run if the approved CSV hash, pool hash or host differs from the resolve checkpoint.
3. Grade is advisory. `review` rows may be approved; `none` rows cannot.

## 3. Phases (one owner-run script, modeled on `backfill-contact-orcid.js`)

`--resolve` (read-only, default), `--summary`, `--apply --confirm=<first 8 chars of resolve hash>`, `--verify`, `--rollback --ids=<file>`.

All Dataverse calls run inside `bypassDynamicsRestrictions('<label>', …)` and through the existing adapters; production reads and writes are owner-run only.

### 3.1 Resolve — classify every approved row, write nothing

Per row, in order; the first failure sets the action:

1. **Shape:** `normalizeOrcid(selected_orcid)` is `valid` → else `malformed`.
2. **Batch uniqueness:** the same ORCID approved for two contacts, or two ORCIDs approved for one contact → every involved row becomes `batch_conflict`.
3. **Contact state:** re-read the contact by id. Missing or inactive → `nocontact`. Current `wmkf_orcid` equals the ORCID → `noop`. Non-empty and different → `conflict`. Name differs from the pool snapshot (first/last) → `changed_since_export`.
4. **Cross-store uniqueness:** no other contact and no potential-reviewer row may already hold this ORCID in any form. `contact.findByOrcidCandidates` and `potentialReviewer.findByOrcidCandidates` match only the canonical `0000-0000-0000-0000` string. [VERIFIED via `lib/dataverse/adapters/contact.js:187-210`, `lib/dataverse/adapters/potential-reviewer.js:209`] So the script adds `contains(wmkf_orcid, '<id>')` and `contains(wmkf_orcid, '<16 digits>')` queries, normalizes each hit, and compares. A hit on another contact → `held_by_other_contact`. A reviewer row linked to a different contact, or unlinked → `held_by_reviewer`. A reviewer row linked to this contact with a different valid ORCID → `reviewer_disagrees`.
5. **Registry re-check:** `ORCIDService.getProfile(orcid)` still resolves, and `forenamesContradict(contactName, profileName)` is false, with the surname matching → else `registry_mismatch`.
6. Otherwise → `write`.

The resolve checkpoint (`scripts/.research-pi-orcid-resolve.jsonl`, gitignored) stores per row: contact id, ORCID, action, the contact's current value, approver, grade, reason, signals, override flag, hashes, host and run id.

### 3.2 Apply — write only `write` rows

For each `write` row:

1. Append an `intent` line to `scripts/.research-pi-orcid-applied.jsonl` (contact id, ORCID, before-value `null`, approver, evidence, hashes, run id, timestamp).
2. Repeat the contact-state and cross-store checks from 3.1 (state can change between resolve and apply).
3. Call `contactAdapter.setOrcidIfAbsent(contactId, orcid)`: fill-only, `noop` for the same value, `conflict` for a different one, conditional on the record's ETag with up to two 412 retries. [VERIFIED via `lib/dataverse/adapters/contact.js:357-403`]
4. Append a `result` line (`write | noop | conflict | malformed | failed` plus error text).

**Crash recovery:** on restart, an `intent` with no `result` is re-read. If the contact now holds the intended ORCID, the script records `result=write (recovered)`. If the contact is still empty, it re-runs the row. Anything else is recorded as `conflict`, with no write.

**Gap — ETag fail-closed:** `setOrcidIfAbsent` falls back to an unconditional PATCH when the re-read returns no ETag [VERIFIED via `lib/dataverse/adapters/contact.js:380-382`]. Proposed additive option `{ requireEtag: true }` that returns `failed` instead of falling back. It is a shared-adapter change, so it needs its own test and review.

### 3.3 Verify

Re-read every contact with a `write` result. Report counts where `normalizeOrcid(current) === intended`, and list every mismatch.

### 3.4 Rollback (conditional, owner-run)

For listed contact ids from the applied log: re-read the contact. Clear `wmkf_orcid` only if its normalized value still equals the ORCID this run wrote, using a conditional PATCH with that read's ETag. Any other value, or a 412, is reported and left alone, so a later legitimate edit is never erased. Each rollback appends a `rollback` line with before and after values.

## 4. Provenance and attribution

- Writes run as the application user. `actingUserSystemId` impersonation is inactive unless `DYNAMICS_IMPERSONATION_ENABLED=true` [VERIFIED via `lib/services/dynamics/write-core.js:78`], and the S217 backfill passed none. Dataverse native auditing on `contact.wmkf_orcid` [ASSUMED per `docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md`; not probed] records the before and after values and the time, but not the human approver.
- The human approval and evidence live in the applied JSONL. The owner keeps a copy outside the repo with the approved CSV; both contain names and emails.
- **Owner decision (open):** add a contact column such as `wmkf_orcidsource` (`backfill-2026-10` / `reviewer-backprop` / `self-report`) so provenance is visible in Dataverse. That is a schema change, outside this plan unless approved.

## 5. Explicit non-goals

- No contact creation, merge or reviewer-row change, and no `_wmkf_contact_value` linking.
- No writes for `none` rows or unapproved rows. No automatic approval of `high`.
- No OpenAlex calls (the key's daily budget is shared with production).

## 6. Before any apply

1. Codex adversarial review of this plan and of the stage-1 fixes.
2. Owner approves the batch (CSV `approve` column) and the `requireEtag` decision.
3. The resolve summary is reviewed. Apply runs first on a small batch (about 10 rows), then `--verify`, then the remainder.
