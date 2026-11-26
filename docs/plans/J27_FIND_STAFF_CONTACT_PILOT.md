# First 20 J27 proposals · staff-confirmed contact pilot

This is the optional comparison protocol. For ordinary use, follow the [J27 Research staff workflow](J27_STAFF_CONTACT_ROLLOUT.md). PDs can run Find independently.

The comparison starts with the first 20 distinct genuine Research submissions to GOApply opportunity 001024, by original submission time. The study unit is an initial Claude Find suggestion on a proposal. The decision under test is whether staff can save a verified contact for that exact person while retaining independent invitation holds. Existing primaries count in both workflows. Only an explicit staff decision can receive new clearance credit. There is no automated clearance, invite, CRM write or model call in the study runner.



## Before the first Find

The operator runs the commands below from the project root. Use the restricted study directory or a staff-access-controlled encrypted volume. Worksheets contain proposed reviewers and professional contact information. Keep exports, evidence and backups out of Git. Restrict access to the ledger and unmasked results to the study operator. Back up the closed SQLite file after each session. Shell redirections create files using the shell's umask.

```sh
umask 077
pilot() { python3 scripts/j27-contact-pilot/pilot.py "$@"; }
pilot init
pilot enroll intake.json
pilot manifest REQUEST_GUID actual-input-proposal.pdf
```

Use a complete GOApply original-submission export from the start of the cycle, reconciled to Dataverse request IDs and numbers. Supply an array in this shape, with an explicit boolean test classification. Do not use invited status, a folder listing, the Find queue or an unverified Dataverse test flag as the population. Where original times tie, the prespecified tie breakers are numeric request number then GUID. Repeat submissions retain their earliest position. Each import validates the already sealed prefix. Investigate corrections to the intake history before proceeding.

```json
[{"cycle":"J27","program":"Research","opportunity":"001024","request_id":"00000000-0000-4000-8000-000000000001","request_number":123,"original_submitted_at":"2027-01-01T09:00:00-08:00","test":false}]
```

Seal the exact PDF provided to Find before either arm starts. Retain the PDF and the original intake export privately. If a proposal or its source file is unavailable, retain its ordinal and record the outstanding reason in the intake log. Freeze the original Find output once. In the ordinary Workbench open browser Network before Find, then take only the request ID and ordered suggestion array from the first Discover request payload. The same array is in the preceding Analyze result. Omit proposal text, Blob URLs, cookies and other headers. Never use a later roster export to reconstruct this list. If the first analysis fails, record the failure as shown below. An empty successful list is recorded as an empty array. Later retries may serve normal operations, and do not replace this first observation.

```json
{"requestId":"00000000-0000-4000-8000-000000000001","analysisResult":{"reviewerSuggestions":[{"name":"Example Reviewer","suggestedInstitution":"Example University"}]}}
```

```sh
pilot freeze first-find.json ORIGINAL_PDF_SHA256
pilot starting-template > before.json
# Fill before.json from the untouched ordinary roster, then seal it.
pilot starting-state before.json
pilot worksheet STAFF_A STAFF_A STAFF_B > staff-a.json
pilot worksheet STAFF_B STAFF_A STAFF_B > staff-b.json
```

For an analysis failure, use `{"requestId":"…","failure":"first Analyze timed out"}`. The hash is available from `shasum -a 256 actual-input-proposal.pdf`. Keep the full original suggestion objects, including duplicates, with source order. Pair by request GUID and original position. Record a held/failed result for downstream suggestions that never became cards.

## Staff sessions

Use the same first-run roster/evidence snapshot for both arms. Capture it **before anyone changes a contact**. Take both before-state readings at this point. Run the baseline on an isolated staff test copy with its own roster persistence, using the existing standard contact workflow (reference revision `71481a3cd`). Reopen that copy to read the saved state. Use the staff-confirmed release (`e4faa92d5`, or an explicitly reconciled release of that revision) on the ordinary Find row for the run of record. Verify deployment and target before starting. Keep the new directory checker advisory. Never apply its suggested address in a batch. In particular, an address surfaced during ordinary enrichment is a candidate for staff verification, not a pilot decision. Do not promote a reviewer or send an invitation as part of measurement.

The two worksheets alternate which staff member gets which arm on consecutive proposals. Use the staff profile IDs shown in Workbench receipts. For each frozen slot, the starting-state template requires the ordinary roster candidate key, starting email, five hold categories and SHA-256 of the privately preserved roster evidence. Explain a missing card in its assigned slot. Both worksheets inherit the same immutable starting evidence. Each staff member sees only their assigned packet and private workspace, with no access to the other decision. Use the same ownership standard in both arms. Inspect a current, independently grounded institutional source linking the person and exact mailbox. For the treatment, use **Verify contact only**, save, refresh the ordinary Find roster and reload. In both arms compare address and evidence to the readback; staff must be able to see the evidence again. Record the contact outcome separately from invitation holds.

- Use a stopwatch. Start when opening a slot, pause when idle, resume for lookup, checks, corrections, escalation, save and reload. Enter total active seconds, including failures and abstentions. Zero means measured zero. Keep later correction time in the total before sealing.
- Enter the initial mailbox and the mailbox seen after reload, or empty strings for observed empty fields. For each hold snapshot enter an object such as `{"contact":["ownership review"],"identity":[],"eligibility":[],"crm":[],"relationship":["coauthor"]}`. Preserve each individual reason, including same-institution and coauthor reasons. Empty arrays mean checked and clear. Use null for an unavailable snapshot and explain it in notes. Never substitute empty arrays for unavailable evidence.
- Mark `ready` only after a staff-confirmed exact address and evidence URL survive reload with the contact hold resolved. Record `held` or `failed` with a reason otherwise. Copy the persisted contactOnlyVerification receipt into staff_receipt for a newly saved treatment contact. The ledger checks the request, candidate, mailbox, evidence URL, staff profile and attestation. If an unsafe clearance was proposed as ready and intercepted, set `intercepted_unsafe` to true. Retain the observed error even if later corrected.
- Import completed rows, or a subset as each pair closes. The ledger rejects edits to sealed records. Do not rerun an arm using information from the other arm.

```sh
pilot decisions staff-a-completed.json
pilot decisions staff-b-completed.json
pilot blind > independent-review.json
pilot judgments completed-independent-review.json
pilot report
```

## Independent review and decision

The adjudicator sees randomly ordered case IDs, proposed person and address, and original institution. Arm names, staff decisions and treatment rationale are withheld. Independently check current ownership. Enter the eligibility boolean or `"unknown"`, a stable person ID across proposals, observation date, source and SHA-256 of the saved evidence. Use `correct`, `wrong`, or `unsubstantiated` for claimed ready contacts and `no_clearance` for abstentions. Staff should leave the proposed email field empty for held/failed cases; the separate readback fields preserve what the card actually showed. Escalate disagreements to a second independent adjudicator before sealing. If sealed records disagree, retain the originals, log a signed adjudication addendum separately and treat the scorecard as provisional. Never silently rewrite a sealed result.

Review every wrong or unsubstantiated ready address, intercepted unsafe clearance, unexpected mailbox change, missing hold readback or change in a noncontact hold immediately. Pause new treatment saves pending investigation. Distinguish an independent staff/CRM update from a release caused by contact verification using the underlying receipts. A correct email on a reviewer with a coauthor hold still leaves invitation blocked.

At 20 proposals report correct-contact transitions, active minutes per paired eligible slot, all recorded labor including excluded/pending cases, wrong recipients, all hold changes and missing readbacks. Report pending or unknown cases and per-proposal effects alongside the pooled figures. Proposed benefit thresholds are at least **4 percentage points** more correct contacts and **20% less mean active staff time**, with zero unsafe clearances and zero improper releases. These measures guide continued staff-supervised use. Any relaxation of confirmation requires a separate owner decision after at least 300 distinct independently adjudicated new recipients across at least 20 untouched proposals, with zero unsafe clearances or improper hold releases.
