# Test Request Factory: synthetic cast and status setter (production)

Status: **DRAFT (2026-09-28, Session 547). Not reviewed; not built.** Follows MVP item 5, which is proven: run `7293496e`, Request 1003302, `ready` under the Foundation transition contract (`TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md`, MVP build list item 5). Scope below is the owner's, S547.

## What the owner needs (S547)

A production test Request must be usable for the workflows staff test, which means:

1. **A PI and a Liaison.** Both receive emails about the Request. Synthetic addresses are fine.
2. **An applicant-suggested reviewer.**
3. **Phase I Status and Phase II Status** settable to any live option, both when the clone is made and later, as the Request moves through the cycle. Option labels may change at single-phase submission; the fields will not. Request Status follows through business rules (platform owner).
4. The synthetic PI, Liaison and suggested reviewer are **reused** across clones.
5. The platform's reactions to status changes (draft emails, GoApply status tracking, payment rows) **should happen**, so they can be tested.

## Facts this plan rests on

- **PI** = `akoya_request.wmkf_projectleader` → contact; **Liaison** = `akoya_request.akoya_primarycontactid` → contact [VERIFIED `lib/services/workbench/grantee-deliverables/recipients-service.js:8-9`].
- Setting the Liaison fires *WMKF_Update Org Primary Contact from Request* (background, update of `akoya_primarycontactid`), which copies it onto the **Foundation account's** Primary Contact on a Foundation-applicant Request [VERIFIED P0b: succeeded on 1003220, 2026-08-03]. The transition contract protects that column, so today it fails `verify`.
- `wmkf_projectleader` is in no classic workflow's update list [VERIFIED probe section 4, 2026-09-28]; the any-column steps (`CalculatedFieldsAsync`, the rollup trigger, `ObjectModel Implementation`) still fire. Plug-in behaviour on it is not known.
- An applicant-suggested reviewer is a `wmkf_potentialreviewers` person plus a `wmkf_appreviewersuggestion` row on the Request with `wmkf_applicantdisposition = 100000000` [VERIFIED `scripts/demote-applicant-suggested-reviewers.js`]. The sandbox `reviews` recipe already seeds synthetic persons and suggestions (`lib/services/reviewer-engagement/seed-synthetic-review.js`, `lib/services/test-requests/reviews-sandbox-deps.js`). Production lacks the wave30 marker `wmkf_issyntheticreviewer` [VERIFIED probe section 1: absent].
- Phase I Status (`wmkf_phaseistatus`, global option set, 13 options) and Phase II Status (`wmkf_phaseiistatus`, global option set, 8 options) are picklists; Request Status is a text field set by business rules [VERIFIED probe section 11; platform owner]. That those rules run on API updates is [ASSUMED]: their synchronous rule steps filter on these fields (probe section 4).
- What reacts to the status fields is recorded in the production plan (*Status fields a test Request will need to move*): payment only on Phase II = Recommended with Phase I = Invited (not pushed to Bill.com); draft emails (none sent); a GoApply status-tracking row on Phase I = Invited.
- No Factory marker column exists on `contact`: wave29 covers `akoya_request` and wave30 `wmkf_potentialreviewers` [VERIFIED `scripts/probe-test-request-factory-production-readiness.js` `MARKERS`].

## Design

### A. Synthetic cast (created once, reused)

- One synthetic PI contact, one synthetic Liaison contact, and one synthetic suggested-reviewer person, each with an allowlisted address (`@wmkeck.org` plus-addresses, or entries on the admin allowlist).
- Made by a separate owner-run CLI mode that is idempotent: it finds each by a fixed identity (exact name and address) and creates only what is missing. It never edits an existing contact it did not create.
- Contacts are created with **no parent account**, so the Foundation's contact list, which the contract protects, is unchanged. [Open: whether a contact without a parent is acceptable in AkoyaGO.]
- The suggested-reviewer person needs the wave30 marker in production (apply wave30 and set `SYNTHETIC_REVIEWER_ISOLATION=on`, as the sandbox did), or an owner decision to use an unmarked person identified by address.

### B. Binding the cast to a clone

- **PI:** `wmkf_projectleader` set at create if `CREATE_FIELDS` can carry the lookup (checked against live metadata, like the program director), otherwise one update after create.
- **Liaison:** `akoya_primarycontactid`. Because of the Foundation Primary Contact copy, one of: (i) the owner accepts that each clone sets the Foundation's Primary Contact to the synthetic Liaison, and the contract allows exactly that change, to exactly that contact; (ii) the platform owner narrows the workflow to skip Foundation-applicant Requests; (iii) the Factory restores the Foundation's Primary Contact afterwards (another Foundation write).
- **Suggested reviewer:** one `wmkf_appreviewersuggestion` row on the clone with applicant disposition *recommended*, through the reviewer-engagement adapter's named operations (the D5 script-writer gate applies).

### C. Status setter

- A CLI mode (admin form later) that sets Phase I Status and/or Phase II Status on a marked test Request to an option chosen by label from live metadata, refusing a label that does not resolve to exactly one option.
- Also accepted at clone time, applied as a step after create.
- One field write per change, then a bounded observation that records what the platform did: Request Status readback, background jobs regarding the Request, new draft emails, GoApply status-tracking rows, payment rows. Names, states and counts only.
- Refuses any Request not carrying the test marker (`wmkf_istestrequest = true` with a run ID).
- Setting Phase I = Invited is also how a clone reaches `Phase II Pending` and becomes visible in Workbench and My Proposals [ASSUMED until the first status change confirms the business rule].

## Probes needed before building

1. Contact create automation: workflows and plug-in steps on `contact` create, and whether a contact without a parent account breaks any AkoyaGO view.
2. Plug-in steps and flows on `wmkf_potentialreviewers` and `wmkf_appreviewersuggestion` create in production.
3. Whether `wmkf_projectleader` and `akoya_primarycontactid` are valid for create on `akoya_request`.
4. The business rules that set Request Status: scope (entity or form) and the Phase I/II values they map.

## Open questions for the owner

1. The Foundation Primary Contact copy (B, Liaison): (i), (ii) or (iii).
2. The suggested reviewer: apply wave30 in production, or an unmarked synthetic person.
3. The synthetic addresses to use.

## Order

1. Probes 1–4 (owner-run, read-only).
2. This plan reviewed once (Codex), then built in slices: C (status setter), A + B (cast), with one Codex review each.
3. Each slice's first production use runs under a snapshot and the owner's Audit History read, as the basic run did.
