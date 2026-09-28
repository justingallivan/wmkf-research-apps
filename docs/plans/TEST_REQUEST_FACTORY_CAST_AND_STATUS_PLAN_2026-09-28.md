# Test Request Factory: synthetic cast and status setter (production)

Status: **DRAFT, revision 2 (2026-09-28, Session 547). Codex plan review round 1: needs-attention (four high, one medium) [DERIVED-FROM: the round-1 review output]; revised below; owner decisions recorded. Slice C (status setter) built on `claude/factory-status-setter` (S547), not merged; slices A + B not built.** Follows MVP item 5: run `7293496e`, Request 1003302, `ready` under the Foundation transition contract (`TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md`, MVP build list item 5). Scope below is the owner's, S547.

## What the owner needs (S547)

A production test Request must be usable for the workflows staff test, which means:

1. **A PI and a Liaison.** Both receive emails about the Request. Synthetic addresses are fine.
2. **An applicant-suggested reviewer.**
3. **Phase I Status and Phase II Status** settable to any live option, both when the clone is made and later, as the Request moves through the cycle. Option labels may change at single-phase submission; the fields will not. Request Status follows through business rules (platform owner).
4. The synthetic PI, Liaison and suggested reviewer are **reused** across clones.
5. The platform's reactions to status changes (draft emails, GoApply status tracking, payment rows) **should happen**, so they can be tested.

## Facts this plan rests on

- **PI** = `akoya_request.wmkf_projectleader` → contact; **Liaison** = `akoya_request.akoya_primarycontactid` → contact [VERIFIED `lib/services/workbench/grantee-deliverables/recipients-service.js:8-9`]. Both are valid for create and update [VERIFIED probe section 12].
- Setting the Liaison fires *WMKF_Update Org Primary Contact from Request* (background, update of `akoya_primarycontactid`), which copies it onto the **Foundation account's** Primary Contact on a Foundation-applicant Request [VERIFIED P0b: succeeded on 1003220, 2026-08-03].
- The one app code path that reads an **account's** Primary Contact as a recipient is `lib/services/site-visit/applicant-contacts.js:24-38`, and only for a Request whose own Liaison is blank; every other app reader uses the Request's own `_akoya_primarycontactid_value` [VERIFIED: repo-wide search of `lib`, `pages`, `shared` for `_primarycontactid_value` outside `_akoya_primarycontactid_value`]. For the Foundation account that fallback reaches only Foundation-applicant Requests, which are test Requests by the existing convention (`TEST_RECORD_APPLICANT_NAME`). Dynamics Explorer and AkoyaGO account views can also display it.
- `wmkf_projectleader` is in no classic workflow's update list [VERIFIED probe section 4, 2026-09-28]; the any-column steps (`CalculatedFieldsAsync`, the rollup trigger, `ObjectModel Implementation`) still fire. Plug-in behaviour on it is not known.
- An applicant-suggested reviewer is a `wmkf_potentialreviewers` person plus a `wmkf_appreviewersuggestion` row on the Request with `wmkf_applicantdisposition = 100000000` [VERIFIED `scripts/demote-applicant-suggested-reviewers.js`]. Production lacks the wave30 marker `wmkf_issyntheticreviewer` [VERIFIED probe section 1: absent].
- The suggestion-creating adapter operations call `assertPersonBindable`, which refuses a marker-true person once `SYNTHETIC_REVIEWER_ISOLATION=on` [VERIFIED `lib/dataverse/adapters/reviewer-suggestion.js:52-68`]. The sandbox `reviews` recipe binds synthetic persons through its own Factory module (`lib/services/test-requests/reviews-sandbox-deps.js`: person create through the opted-out raw client, suggestion create through `write-core.js`, sandbox hosts only, exempt from `check:dataverse-access-layer` by name) [VERIFIED from that module's header]. Whether any other module binds synthetic persons is not established [ASSUMED none].
- Phase I Status (`wmkf_phaseistatus`) and Phase II Status (`wmkf_phaseiistatus`) are picklists on global option sets, with 13 and 8 live options [DERIVED-FROM: probe section 11 output]; Request Status is a text field set by business rules [VERIFIED probe section 11; platform owner].
- That the Request Status rules run on API updates is [ASSUMED]: their synchronous rule steps filter on these fields (probe section 4); the API does not expose their scope (probe section 12).
- What reacts to the status fields is recorded in the production plan (*Status fields a test Request will need to move*).
- No Factory marker column exists on `contact`: wave29 covers `akoya_request` and wave30 `wmkf_potentialreviewers` [VERIFIED `scripts/probe-test-request-factory-production-readiness.js` `MARKERS`].

## Probe results (section 12, owner-run, 2026-09-28)

[VERIFIED via the probe output and the exported rule definitions, within the probe's limits below.]

- **Contact create** runs 4 classic workflows and 20 plug-in steps [DERIVED-FROM: probe section 12 output]: *Alternate Address 2*, *Alternate Address 3*, *WMKF_Update Saluation* (real-time), *Update Mailing List Member Info (Contact)*; among the steps `AkoyaGo.Sync_BusinessCentral` (async), `AkoyaGo.AsyncContactCoupling` (async), `AkoyaGo.CalculatedFields`, `AkoyaGo.AddressPopulationByZipCode`, `AkoyaGo.Populate990Region` and `AkoyaGo.AsyncEntityCreated`. **`Sync_BusinessCentral` suggests a new contact is pushed to Business Central** [ASSUMED from its name]; this is the one reaction that may leave the platform, and it **blocks contact creation** until the platform owner says what it does.
- **`wmkf_potentialreviewers` create:** one real-time workflow (*WMKF_Set Full Name on Potential Reviewer*). **`wmkf_appreviewersuggestion` create:** no classic workflows. For both, no entity-registered plug-in step beyond the platform's own, and no cloud flow whose readable definition names the entity.
- **Parentless contacts are normal:** 4,628 active contacts have no parent account [DERIVED-FROM: probe section 12 aggregate count].
- **Request Status business rules:** 6 name Request Status [DERIVED-FROM: probe section 12 output]. Value mapping read from the definitions, in branch order: *Program Phase II*: Phase II Pending Committee Review → `Phase II Pending`; Phase II Declined → `Phase II Declined`; Phase II Deferred → `Phase II Deferred`; Approved → `Approved` (another Approved branch with a second condition → `Closed`); Recommended → `Phase II Pending`. *Program Phase I Invite/Do Not Invite*: Phase I Invited → `Proposal Invited`; Not Invited → `Proposal Not Invited`. So a clone reaches `Phase II Pending`, and Workbench visibility, through Phase II Status = Phase II Pending Committee Review, which creates no payment (*Create Payment* needs Recommended).
- **Limits (Codex round 1, medium).** Flows were matched by substring on readable definitions, so "no flow" means no readable definition named the entity; plug-in steps were listed by entity message filter, so a Create step registered for every entity would not appear. Section 12 is strengthened before the cast is built (see *Order*), and each safety-relevant probe run is kept as a sanitized, dated receipt.

## Design

### A. Synthetic cast (created once, reused)

- One synthetic PI contact, one synthetic Liaison contact, and one synthetic suggested-reviewer person, each with an owner-supplied allowlisted address.
- **Ownership by journal, not by lookup (Codex round 1).** A cast ledger record preallocates each GUID and records the intended identity (name, address digest) before any create. The create POST names that GUID. A lost response is recovered by reading that GUID with a strict projection readback, never by re-POSTing. Any existing contact or person matching the name or address that the ledger did not create is an **ownership collision**: the mode stops and adopts nothing.
- Contacts are created with **no parent account** (normal in production, see *Probe results*), so the Foundation's contact list is unchanged.
- The person carries the wave30 marker: wave30 is applied in production and `SYNTHETIC_REVIEWER_ISOLATION=on` set, then production redeployed, before the cast mode runs (owner decision 2).
- **Contact creation is blocked** until the platform owner explains `AkoyaGo.Sync_BusinessCentral`. The person create does not depend on it.

### B. Binding the cast to a clone

- **PI and Liaison in the create body.** Both lookups are create-valid, so the production create body binds `wmkf_projectleader` and `akoya_primarycontactid` to the journaled cast contacts, resolved through live relationship metadata like the program director, and re-checked at the create lease.
- **The Foundation Primary Contact copy is accepted (owner decision 1).** The transition contract gains exactly one allowed change: `_primarycontactid_value` may become the run's journaled Liaison contact ID, and nothing else. This supersedes the production plan's rule that the Factory never sets a Request primary contact; that plan is reconciled in the same build. Reach: see *Facts* (the one app fallback reaches only Foundation-applicant test Requests); the previous value, set by hand on 2026-09-19, is overwritten.
- **Suggested reviewer through a Factory-only production writer (Codex round 1).** Ordinary adapter operations keep refusing synthetic persons. A Factory-only module, modelled on `reviews-sandbox-deps.js` but bound to the production host and wrapped by the production write fence, creates the suggestion only when: the person is marker-true and journaled in the cast ledger; the destination Request is marker-true with this run's run ID; and the suggestion GUID is preallocated and journaled. It is exempt from `check:dataverse-access-layer` by name, and a boundary test pins that no ordinary module imports it (the D5 script-writer gate also applies).

### C. Status setter

- **One field per change, never both in one write.** A change names one field (Phase I or Phase II Status) and a target option chosen by label from live metadata; a label that does not resolve to exactly one option is refused. Setting both fields is two ordered changes, Phase I first, each completed before the next starts (*Create Payment* reads both).
- **Transition matrix.** The mode reads the current pair (Phase I, Phase II) and looks the requested change up in a tracked matrix of current-pair → target-pair transitions. Each row names the workflows it is expected to fire (from the production plan's reaction table). A transition not in the matrix is refused; the matrix grows by reviewed commits. A change to the value the field already holds is refused as a no-op.
- **Guarded write.** The PATCH carries the Request's current ETag (`If-Match`), so a concurrent change fails instead of racing. It refuses any Request not carrying the test marker with a run ID the ledger owns.
- **Journal and replay protection.** Before the write: the before-pair, the target, and the ETag. After it: every effect created regarding the Request (background jobs, draft emails, GoApply status-tracking rows, payment rows), by ID. A retry of a change whose write may have landed first reads the Request: if the field already holds the target, the change is recovered, not repeated. A transition whose recorded effects include a payment or a status-tracking row is refused on replay unless the owner explicitly re-runs it.
- **Completion.** A change is complete only when every background job regarding the Request since the write is terminal, followed by a delayed recheck of Request Status and the effect census (as the basic run's `--run-recheck`). A failed or waiting job stops the change `needs_attention`, with the recovery (inspect, then deactivate the clone) written in the runbook.
- **Characterize first.** The first production status change, Phase II Status = Phase II Pending Committee Review on a clone, runs under a snapshot and the owner's Audit History read, and establishes whether the Request Status rules run on API updates. Until it does, Request Status is recorded, not asserted.
- Also accepted at clone time as ordered changes after `verify`.

### Ledger

The cast record, the status-change journal and the new resource kinds (contact, person, suggestion, status change) extend migration 054 in place, as it is applied only to the local `ledger_prod` and `ledger` databases (P6's rule), each with its receipt keys in the JS grammar and the parity test.

## Owner decisions (2026-09-28, S547)

1. **Foundation Primary Contact copy: accepted**, including overwriting the value set by hand on 2026-09-19 (reaffirmed after Codex round 1). The transition contract allows exactly one change to the Foundation's `_primarycontactid_value`: to the run's journaled Liaison contact.
2. **Suggested reviewer: apply wave30 in production** and set `SYNTHETIC_REVIEWER_ISOLATION=on`, then redeploy (the wave29 sequence). With the switch on, identity resolution excludes synthetic persons, the suggestion-creating adapter operations refuse to bind one, and reviewer merge refuses one [VERIFIED `lib/dataverse/adapters/potential-reviewer.js` `isPersonSynthetic` and read fence; `lib/dataverse/adapters/reviewer-suggestion.js:52-68`; `lib/services/reviewer-merge.js:249-252`]. That every production reviewer read path passes through these fences rests on the sandbox 6c audit [ASSUMED for production until re-checked in the build].
3. **Synthetic addresses: the owner has created them** and put them on the Admin → Test Requests allowlist. They are supplied to the cast mode at run time, not committed to the repository.

## Open questions

1. **Platform owner:** what `AkoyaGo.Sync_BusinessCentral` does on contact create, and whether a new contact joins any mailing list (*Update Mailing List Member Info*). Blocks contact creation.
2. Whether the Request Status business rules run on API updates (answered by the characterization change in C).

## Order

1. **Slice C, status setter** (does not create contacts): transition matrix, guarded write, journal, completion; one Codex review; the characterization change under snapshot and Audit History read. **BUILT 2026-09-28 (S547) on `claude/factory-status-setter`, not merged:** ledger table `test_request_status_changes` (054 in place); `lib/services/test-requests/status-transitions.js` (every current Phase I/II option by value with its allowed effect classes, from the workflow definitions: invite and not-invited draft emails, GoApply status tracking on Invited, a payment on Recommended with Phase I Invited); `fenceStatusChangeClient` (one PATCH shape, concrete `If-Match` required, since a PATCH without it is an upsert); `lib/services/test-requests/status-change-runner.js`; CLI `--target=production --set-status=<runId> --field=phase1|phase2 --option="<label>" [--rerun]` and `--status-recheck=<runId>`. Completion waits up to 10 minutes for background jobs; jobs still running leave the change `applied` so the same command re-checks. Before its first use, 054 is re-applied to `ledger_prod`.
2. **Probe section 12 strengthened:** fail as incomplete when an activated flow definition is missing or unreadable, list Create steps registered for all entities, and write a sanitized dated receipt.
3. **wave30 in production** (owner-run apply, switch, redeploy).
4. **Slice A + B, cast and binding,** after open question 1 is answered: cast ledger and mode, create-body binding, Factory-only suggestion writer, transition-contract change; one Codex review; first use under snapshot and Audit History read.
