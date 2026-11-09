---
title: Test Request Factory Admin Form Runbook
domain: test-request-factory
kind: runbook
status: active
summary: "Operating the admin Test Request form in Production: what it needs, what each stop means, what a retry does, and how to turn it off."
canonical: false
cataloged: 2026-10-02
last_verified: 2026-11-03
owner: product-engineering
related:
  - docs/plans/TEST_REQUEST_FACTORY_ADMIN_FORM_PLAN_2026-10-01.md
  - docs/atlas/postgres-test-request-runs.md
  - docs/CREDENTIALS_RUNBOOK.md
  - lib/services/test-requests/admin-run-service.js
  - lib/services/test-requests/run-runner.js
  - scripts/rehearse-test-request-sandbox.mjs
---

# Test Request Factory admin form: runbook

The form is at Admin → Test Requests → "Create a test Request". It creates one marked test Request from a source Request (the `basic` recipe: seven steps) and can set its Phase I or Phase II status. Superusers only.

Evidence labels: **[RUN]** was seen in a production or Preview run on 2026-10-02. **[SOURCE]** was read from the source that day and has not been seen live. Paths without a directory are under `lib/services/test-requests/`.

## What it needs in Production

| Thing | Value | Notes |
|---|---|---|
| `TEST_REQUEST_FACTORY_FORM` | `on` | Gates source lookup, Confirm, advance, status change and status recheck (`requireWritable`, `admin-run-service.js`). The run list, run detail, artifacts download, Foundation recheck and status options work without it. |
| `TEST_REQUEST_LEDGER_URL` | `ledger_prod` in Neon project `wmkf-factory-ledger` | Never the app database; the registry guard refuses anything else. |
| `FACTORY_BLOB_RW_TOKEN` | store `wmkf-factory-private` | Source bundles and run manifests. |
| `TEST_REQUEST_ISOLATION`, `SYNTHETIC_REVIEWER_ISOLATION` | `on` | A production advance is refused unless both are on (`factory_isolation_off`, `assertIsolation`). |

A variable change takes effect only in a new deployment. Details and rotation: `docs/CREDENTIALS_RUNBOOK.md`.

## Normal run

1. **Look up** the source Request number. The form reads the Request and its documents from production and saves a bundle. Limits (`TEST_REQUEST_PREVIEW_READ_LIMITS`, `admin-preview-service.js`): at most 7 documents, 25 MB each, 50 MB in total; PDF and XLSX only.
2. **Confirm and reserve run.** Writes the bundle and manifest to the Blob store and one row to the ledger. Nothing exists in Dynamics yet.
3. **Start production run.** One request per step; the form keeps going until the run is ready or a step stops. `copy_file` runs once per document. `observe` waits about a minute.
4. **Status:** available once the run is `ready` (clone provisioning complete).
   For prepared J27+ reviewer fixtures, Phase I Invited followed by Phase II
   Pending Committee Review and owner readiness finalization are required.
   Earlier-cycle clone behavior is unchanged.

The bundle is valid for file copying for 6 hours from lookup (`BUNDLE_MAX_AGE_MS`, `bundle-file-copy.js`). Finish the copy steps within that window. Completed verified copies do not expire for later status/readiness finalization because of that TTL or subsequent edits to the real source.

Reference run **[RUN]**: `a5161f47-7b02-5ad3-8f20-3f645ec3c254`, source 1002988, test Request 1003310, seven documents, under three minutes from Confirm to ready.

## When a step stops

The panel shows "Stopped at …", plain copy for the recorded reason, and the raw error under "Technical detail". The raw error is kept only in the page and in the Vercel function log (`admin test-request run step stopped: <runId> <step> <outcome> <message>`); the ledger stores a reason code only. Read the log if the page has been reloaded:

```
vercel logs --environment production --since 1h -q "admin test-request run" -x
```

When available, "Retry step" sends the same advance again. What that does depends on whether a write had already been attempted. The table describes the existing backend runner (also used by the CLI), not a guarantee that the diagnosis enables every form retry. The table is **[SOURCE]** (a delegated trace of `run-runner.js`, `basic-clone-steps.js`, `bundle-file-copy.js` and `run-ledger.js` on 2026-10-02, spot-checked) except where a row is marked **[RUN]**.

| Step | What you see | What a retry does | Can it continue? |
|---|---|---|---|
| any | `timeout`, `network`, `upstream_http`, `unknown_error` **before** the step's write was attempted | Re-attempts the step | Yes |
| `fence_source` | `source_fence_failed`, `preflight_identity_changed`, `manifest_digest_mismatch`, `preallocated_request_present` | Re-reads; stops again unless the cause was a transient read failure | Only if it clears. Nothing was created; look up the source again and start a new run |
| `create_request` | first stop after the create was sent and refused or lost; a refusal is recorded as `unknown_error` **[RUN: Preview]** | Looks for the Request by its reserved ID. Found and owned: recovered, continues. Not found: `ambiguous_create_outcome` | Only if the create actually landed |
| `create_request` | `ambiguous_create_outcome` **[RUN: Preview]** | Reads the reserved ID again; never sends a second create. Found and owned: recovered, continues. Still absent: stops again | Only if the create eventually landed. Otherwise start a new run |
| `create_request` | `preallocated_request_present_not_owned` | Stops again. Never sends a second create | No. Start a new run |
| `correct_meeting_date` | `meeting_date_readback_mismatch` | Production never writes the date; stops again | No |
| `provision_location` | `location_preexisting` | Re-reads; stops again | No |
| `provision_location` | `location_readback_mismatch` | Re-reads; never creates a second location. A late-appearing location this run owns is recorded as recovered and the run continues; otherwise it stops again | Only if the location appears |
| `provision_location` | a transient error | Re-reads the location. If it exists and is this run's, continues; if a create was journaled and nothing exists, `location_readback_mismatch` | Depends |
| `copy_file` | an error before the upload was attempted (source changed since lookup, source hash mismatch, destination file already exists) | Re-attempts that file | Only if the cause is gone |
| `copy_file` | an error after the upload was attempted with no item recorded; the next retry shows `file_ambiguous_unrecovered` | Stops again. Never uploads again | No |
| `copy_file` | an error after the file was uploaded (failed comparison, "did not settle"); the next retry shows `file_journal_unverified` **[RUN: production run `20407283`]** | Stops again. Never uploads again | No |
| `copy_file` | `bundle_stale` | Stops again | No. The 6 hours have passed, or the copy policy changed since the bundle was saved (`bundleSourceOf` refuses both) |
| `observe` | a transient error | Repeats the wait; reads only | Yes |
| `verify` | `verification_failed` | Re-reads everything; no write | Only if the cause was transient (for example a failed folder listing) |

A stale bundle shows under a different code at each step: `source_fence_failed` at `fence_source`, `unknown_error` at `create_request`, `bundle_stale` at `copy_file`, `verification_failed` at `verify`.

A request that outlives the 300-second lease is not recorded as a stop: the run stays `creating` and can be advanced again once the lease has expired.

### What "cannot continue" leaves behind

A run that cannot continue stays `needs_attention` in the ledger. Whatever it created stays in production as a marked test record: possibly a Request, its document location and folder, and some copied documents. Its two Blob objects are never swept. No mode of the command-line tool abandons, resets or force-advances a run, or resolves an unverified upload or an ambiguous create [SOURCE: the mode dispatch in `scripts/rehearse-test-request-sandbox.mjs`]. The practical path is a new run from a fresh lookup.

Owner decision 2026-10-03: retain this partly built marked test record; no cleanup or recovery is authorized by that decision. Factory v2’s first diagnosis slice shipped in #426; later operations remain in the [plan](plans/TEST_REQUEST_FACTORY_V2_PLAN_2026-10-03.md).

Parked **[RUN]**: run `20407283-c279-5e0c-b396-210ad6842482`, test Request 1003308, two PDFs verified, one XLSX uploaded and unverified.

## Read-only diagnosis — shipped in PR #426

[SOURCE, October 3; owner-reported clean deployment after #426] The diagnosis adds guidance to the existing actor-owned run-detail GET. It reads only the saved run row and resource receipts. It does not read private artifacts, inspect live Dataverse/SharePoint records, claim a lease, run status recheck or write anything. Normal runner checks remain authoritative when an existing Advance is requested.

Named existing retries remain available for Request/location readback after an uncertain create and for `verification_failed` at Basic verification. These use the unchanged runner safeguards; the diagnosis neither performs recovery nor promises it. Receipts from known earlier completed steps do not block the current step, while unknown/future evidence stays blocked.

For Basic runs, the panel explains a live lease (wait and inspect again), expired source evidence (a new run is needed), an unverified copied item (readback investigation), a supported retry with no unresolved dispatch, or an unknown state (operator investigation). A new run neither repairs nor deletes the partial destination of an old run. Request 1003308 remains retained and unchanged. The six-hour check is based on the saved export timestamp; it does not establish artifact integrity or availability.

The Basic Advance control is enabled only when the current diagnosis permits retry and the existing write switch permits it. A new selection, an advance response or a failed refresh clears the previous diagnosis; responses from an old selection cannot replace the current view. Other known recipes are reported as not assessed and retain their existing controls after inspection succeeds; a failed or missing inspection disables Advance until the run can be inspected again. The form is deliberately more conservative than the backend runner for unclassified Basic failures. Unknown errors, source/preflight failures, and pre-upload failures without a positively classified retry remain disabled in the form; investigate first rather than treating a disabled button as proof the backend cannot recover. Any owner-directed CLI action still uses the existing runner checks and requires its own operational authorization. Later recovery, status operations and retirement are outside this slice. This diagnosis shipped in #426; later operations remain separately reviewed work.

## Status changes

Only a `ready` production run. One change may be open per run. The form confirms before sending and shows the result.

| Result | Meaning | What to do |
|---|---|---|
| Status changed **[RUN]** | Written, read back, background jobs settled | Nothing |
| Background jobs still finishing (`jobs_open`) | Written; jobs on the Request were still running when the wait ended | "Check again" (it resumes the same change; it never sends a new one) |
| Result could not be read (`unconfirmed`) | Sent; the read-back failed | "Check again". Do not start a different change |
| Being sent (`in_progress`) | Another request is sending it, or one was cut off after sending | Do not retry. If it never resolves, establish that no sender is still running, then close it from the CLI with the command the form shows (`--status-abandon … --change-id …`); that writes the ledger only |
| Refusals | Already set; another change open; the Request changed since it was read; transition not allowed from the current status; would repeat a payment or tracking row | Nothing was sent. Reload and choose again. A repeat that would create a payment or tracking row needs the CLI `--set-status … --rerun` after inspection |

### Recheck status effects and Check again are different

[SOURCE, October 3] **Check again** reloads the open change and resumes only that same change through the existing status setter. **Recheck status effects** inspects effects and background jobs since the latest dispatched change. It never sends another status PATCH or settles a `dispatched` change. For an already `complete` or `needs_attention` change, it may record newly observed email, tracking and payment IDs in the saved history. It is therefore not a wholly read-only operation, even though it does not write Dataverse.

The recheck's `ok` means this pass found no newly unrecorded effects and no open or failed jobs. It does not establish that the change had no effects, that an email was delivered, or that a sender has stopped. A change still marked `dispatched` remains unresolved. No new web closure, rerun or recovery action is authorized by rechecking.

[VERIFIED via merged PR #427 and `TestRequestStatusControl.js`; included in the later verified Production release] The status-outcome explanation displays the returned change number and recorded status beside per-pass counts, keeps unresolved results visually distinct from complete results, and discards results when a later journal read identifies a different change or status. Starting another status action clears the old recheck result. The existing actor/superuser checks and operation semantics remain unchanged.

## The command-line tool

`scripts/rehearse-test-request-sandbox.mjs --target=production`, owner-run, reads `.env.local`.

| Mode | What it does |
|---|---|
| `--run-inspect=<runId>` | Read-only: the run row and every resource receipt. No Dataverse. Its output on 2026-10-02 did not include status changes **[RUN]**. |
| `--run-recheck=<runId>` | Read-only: the Foundation account against the run's baseline. |
| `--advance=<runId> --manifest=<file> --bundle=<file>` | Uses the same backend runner. The form may withhold Advance when diagnosis is uncertain; an owner CLI retry remains subject to runner checks and separate operational authorization. Needs the run's manifest and bundle as local files. |
| `--set-status`, `--status-recheck`, `--status-abandon` | The status setter, its recheck, and closing a change stuck `dispatched`. |
| `--finalize-readiness=<runId> --manifest=<file>` | Deployed owner-only prepared J27+ readiness preview; add `--confirm` for the single journaled true stamp after all checks. Requires migration 094 on the operational ledger. No web finalization action. |
| `--recover-readiness=<runId> --manifest=<file>` | Read-only recovery preview; exact-destination confirmation can abandon only an unready attempt after all senders stop (procedure below). |
| `--bind-reviewer=<runId>`, `--bind-reviewer-slot=<runId>` | Owner cast suggestion binding and separate read-only slot preview; only exact Request confirmation enables the slot operation. |
| `--ledger-check` | Ledger schema against the tracked fingerprint. |

To get a form run's manifest and bundle: the run panel's artifacts download, or `scripts/factory-artifacts-download.mjs` (owner-run, reads `FACTORY_BLOB_RW_TOKEN` locally).

## Prepared J27 reviewer fixtures

The Basic recipe remains unchanged. Newly reserved Production J27+ manifests
explicitly select `j27-reviewer-fixture/v1`, start with readiness false, and omit
a direct Request Status write. A source must supply its applicant abstract and
canonical reviewer proposal; other recognized Basic
files are copied normally. This is a prepared reviewer package, not proof that
intake assembly or AI processing ran. Production does not seed later recipes.

Download the manifest and bundle **before the final clone step**, since the daily
sweep may delete them once the run is internally ready. Complete the clone, use
the existing status setter for Phase I `Invited` and then Phase II `Phase II
Pending Committee Review`, and inspect each result. Invited may create a draft
email and GoApply tracking row. The bounded 2026-11-03 fixture had no unexpected provisioning effects; future runs still require observation. The derived Request Status must read `Phase II Pending`.

Preview `--finalize-readiness=<runId> --manifest=<local manifest>` read-only.
Only an owner-authorized invocation with `--confirm` can stamp readiness true.
It rechecks the run-owned test identity, cycle, phase/status journal, metadata,
saved source, Foundation isolation and copied destination files. Completed copies
are not expired by the original export TTL or later edits to the real source. A dispatched result is reconciled
by reading; it is never resent. Already-true readiness without this operation's
journal is refused. Unexpected post-stamp effects stop for owner inspection,
even if readiness already reads true. No rollback or ordinary-request editor is provided.

For an unready failed/ambiguous attempt, `--recover-readiness=<runId>
--manifest=<file>` previews a ledger-only recovery. Stop/disable form dispatch,
establish all form invocations have ended, and stop/account for every CLI,
including paused senders. A timer or unchanged readiness is not proof. Only
`--confirm-readiness-request=<exact destination GUID>` affirms that checklist
and abandons the old attempt, retaining its original error/ETag/timestamps.
The next finalization verifies the package first and only then plans a fresh
attempt with the current ETag. An already-true
readiness flag cannot be reset or its unexpected effects approved this way. Local code/tests do not authorize Production fixture writes or emails.

[VERIFIED 2026-11-03 via `apply-ledger-migrations.js`, `check:factory-ledger` and Production deployment] Migration 094 is applied to BOTH managed operational ledgers; each matches the 054+058+094 fingerprint. Compatible Factory code shipped in PR #617, closing the accepted temporary interruption between migration and promotion. Future ledger migrations use `ledger:apply`, never the app database runner.

[VERIFIED 2026-11-03 bounded CLI test] Prepared Request **1003456** (run `c2da75d4-a737-4d81-8db1-96aca62e12a6`) completed clone verification, both phase changes and readiness finalization after the reviewed prior-PDF proof correction. Readiness is true, Phase I Invited, Phase II Pending Committee Review and derived status Phase II Pending. Seven copied files passed; both phase changes and readiness showed no unexpected effects; read-only Foundation recheck passes. The original baseline is unchanged. That provisioning receipt predates the separately authorized reviewer rehearsal below. See the [live receipt](plans/evidence/test-request-factory/j27-prepared-live-proof-2026-11-03.md).

For an audited replacement of an existing generated GOverify PDF, deployed
owner CLI assistance is `--previous-goverify-pdf-file=<absolute private file>`
on production `--advance`, `--run-recheck`, `--finalize-readiness` or
`--recover-readiness`. Put only the prior URL in that small local file; do not
commit it or paste it into a command argument. The prior URL must have the
tracked generated shape and predate baseline capture. Substituting only that
field must reproduce the original whole-projection digest; the current PDF and
trigger must pass their existing timing checks. No baseline reset, URL fetch,
ledger schema change or form bypass is added. Use the same private evidence for
later CLI rechecks/finalization/recovery. The form supplies no evidence and may
still refuse a replaced-PDF run. All other isolation checks remain unchanged.

Use the finalization preview to inspect readiness journal status; ordinary
`--run-inspect` still shows the existing run/resource history, not readiness
attempts. A Phase status change closed by `--status-abandon` remains unknown
history and blocks finalization. Only an exact definitive no-write 412 status
refusal can be ignored alongside a later complete corroborating transition;
other needs_attention status history requires owner inspection.

## Repeatable prepared-fixture rehearsal

[VERIFIED via the CLI parser/guards, deployed UI and the bounded 2026-11-03 rehearsal] The supported MVP is Admin cloning followed by owner phase/readiness operations. A web readiness button is not required for this increment. These steps describe the procedure; each new Production write, communication or metered analysis needs its own authorized scope.

1. Choose a completed source with its applicant abstract and canonical reviewer PDF. Copying a D26 package into J27 tests reviewer mechanics, not new J27 intake assembly or AI output. Confirm the destination cycle and test marker in the preview.
2. If the Foundation already has a generated GOverify PDF, retain the authorized pre-run URL in a private local file before cloning. Use mode 0600; never commit it or put the URL in shell arguments. The optional prior-PDF proof must reproduce the original baseline digest exactly. If that proof is unavailable or fails, stop for inspection rather than resetting the baseline.
3. Reserve through Admin and download the manifest and bundle before the final clone step. Finish copying within the six-hour bundle window. Inspect any refusal; owner CLI assistance uses the same runner and isolation checks. Retain the local artifacts privately after internal run `ready`.
4. Use the guarded status setter separately for Phase I `Invited`, then Phase II `Phase II Pending Committee Review`. Inspect each result and its jobs/effects before proceeding. Never set `akoya_requeststatus` directly; read back derived `Phase II Pending`.
5. Preview readiness with the local manifest; inspect package, Foundation, phase/status and journal checks. Only then run the separately authorized confirmation. Read back readiness true and the completed journal. CLI modes below use `--target=production`; reads require `DATAVERSE_ALLOW_PROD_READS=yes`, writes require `DATAVERSE_PROD_WRITE_ACK="<purpose> YYYY-MM-DD"` and configured interlocks. Use the current UTC date required by the guard.

```text
node --import ./scripts/lib/use-extensionless.mjs scripts/rehearse-test-request-sandbox.mjs --target=production --set-status=<runId> --field=phase1 --option="Invited"
node --import ./scripts/lib/use-extensionless.mjs scripts/rehearse-test-request-sandbox.mjs --target=production --set-status=<runId> --field=phase2 --option="Phase II Pending Committee Review"
node --import ./scripts/lib/use-extensionless.mjs scripts/rehearse-test-request-sandbox.mjs --target=production --finalize-readiness=<runId> --manifest=<absolute manifest path>
```

Add `--confirm` only to the finalization command after its preview passes. Supply `--previous-goverify-pdf-file=<absolute private file>` on supported modes when the exact prior-PDF proof is needed. The status setter has no such flag. Do not reuse another run's artifacts or automation assessment.

6. For the isolated applicant-recommended reviewer path, use the existing controlled cast and owner-only `--bind-reviewer=<runId>`. The separate `--bind-reviewer-slot=<runId>` is a read-only preview; before authorizing a write, the owner must complete a fresh automation preflight and assess its dispositions. This is an operator procedure, not a check enforced by the CLI. The CLI separately requires `--confirm-slot-request=<exact destination GUID>`, the same-UTC-day write acknowledgment and its ownership/occupancy/journal fences. See the historical [cast/slot assessment contract](plans/TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md); a previous rehearsal's assessment is not authorization for a new slot write.
7. In Find, use the explicit **Add Factory reviewer to Invite** action. Keep the synthetic identity unchanged and use only an approved controlled test inbox. Any automatic application analysis is separately metered and needs authorization. Send a clearly labeled test invitation with no payment promise; complete policy acknowledgments only with the reviewer's action-time consent and select honorarium opt-out for this no-payment rehearsal.
8. Test isolation skips ordinary automatic acceptance follow-up. Manually release materials through staff controls, using the exact subject prefix `TEST ONLY — Review materials:` if the link-recovery helper will be needed. That prefix is an operator convention required by this diagnostic, not an automatic send-template rule. Open the latest materials email link: release rotates the token, so the invitation URL becomes stale. If needed, `scripts/read-test-materials-email-link.mjs` can recover exactly one existing marked-test materials link to a new private file, without minting or sending. It does not prove inbox delivery or cryptographically validate the token; the portal performs token validation.
9. Check the canonical PDF and submit one clearly labeled test review with test placeholders. Verify staff Track/Reviews and all nine answers. `scripts/probe-factory-reviewer-rehearsal.mjs` provides a read-only paired-request census, including email/payment counts. Do not infer ordinary honorarium, automatic follow-up or synthesis coverage from this isolated test. Remove temporary local proposal copies after inspection; retain sanitized receipts, not bearer links or proposal bodies, in the repository.

[VERIFIED 2026-11-03 via Production browser flow and read-only census] Request 1003456 completed this bounded rehearsal after PRs #617, #618 and #623 deployed. The copied 24-page PDF matched the saved source hash; one test review reached staff with nine answers, honorarium declined and no linked honorarium request. The final census found two sent emails and zero request-payment rows. Materials inbox delivery was not independently verified. [Full receipt](plans/evidence/test-request-factory/j27-reviewer-rehearsal-proof-2026-11-03.md). Broader PD workflow and earlier intake-stage testing remain deferred.

## Artifacts and the daily sweep

The daily maintenance cron deletes Factory Blob objects (`sweepFactoryArtifacts`, `factory-artifact-store.js`) **[SOURCE; aggregate Production execution observed 2026-10-03]**: saved lookups older than 6 hours; a run's bundle and manifest once the run is `ready`; objects with no ledger row once older than 24 hours. It keeps everything for a run that is `prepared`, `creating` or `needs_attention`. Download the manifest and bundle before the final clone step if they will be needed for owner finalization or later inspection.

[VERIFIED via read-only `maintenance_runs` record] The 2026-10-03 03:00 UTC daily pass completed with Factory totals of 4 deleted, 2 kept, 0 errors, and neither scan nor deletion truncated. These aggregate counts do not establish which exact objects were deleted or retained. See [follow-up evidence](audits/OPEN_ITEMS_FOLLOWUP_2026-10-03.md).

## Turning the form off

1. `vercel env rm TEST_REQUEST_FACTORY_FORM production`
2. Redeploy Production. The switch is read from the deployment's own variables, so removing it does nothing until then.

Promoting an older deployment also works but takes older code with it: the last deployment built before the variable existed is `wmkfresearchapps-om04yoqhp` (`cd0d6ebe6`), which predates the XLSX fix.

With the form off, the run list, run detail and artifacts download still work.

## Rehearsing on Preview

`.claude-memory/project-preview-rehearsal-venue-limits.md` has the procedure. A Preview rehearsal writes to the sandbox and ends at `create_request`, because the sandbox refuses the create without the GoVerify bypass, which the form never offers.

## Known gaps

- **First lookup refused once.** The first lookup of source 1002988 (Preview) and of source 1002860 (Production) was refused with "changed while its bytes were being verified" and passed on retry; the production log named an XLSX **[RUN]**. A later lookup of 1002988 passed first time. Cause not established. Retry the lookup. Since S564 the refusal log line names each comparison that failed with its before → after values (metadata eTag/versionId/size, the download's metadata size, the content length) and the cTag, which moves only when the bytes change; read it from the function log (`admin test-request run refusal: 409 test_request_preview_source_changed …`) at the next occurrence.
- **XLSX verification** is characterized for one SharePoint rewrite (`docProps/custom.xml`). A spreadsheet rewritten in another way, or one over the package limits, stops at `copy_file` after upload and cannot continue.
- **Not checked in a browser:** long-label wrapping, the selected-row tint, a narrow window.

## J27 sandbox Initial Assessment scenarios (local owner CLI)

[VERIFIED via local source and unit tests, 2026-11-08; not deployed or confirmed live]
`scripts/rehearse-j27-factory-scenarios.mjs` implements eight basic-clone scenarios through `j27-sandbox-scenarios.js`. This is separate from the Production prepared-fixture flow above. It requires literal `DATAVERSE_TARGET_INTERLOCK=on`, `DATAVERSE_DAL_ENFORCEMENT=on`, registered sandbox authentication, and `TEST_REQUEST_SANDBOX_LEDGER_URL` matching the existing ledger fingerprint. No schema application is performed.

```text
node --import ./scripts/lib/use-extensionless.mjs scripts/rehearse-j27-factory-scenarios.mjs --target=sandbox --all --batch-key=<key> --source-request-number=<number> --director=<sign-in-email> --reviewers=<synthetic-guid-1>,<synthetic-guid-2> --bundle=<private-sandbox-bundle.json> --manifest-dir=<absolute-private-directory>
```

Default mode reads only and prints intended creates, changes, no-ops/skips, identities, ETags, effects and a confirmation digest. Missing prerequisites are reported per scenario without reservation or filesystem writes. A source bundle is required by the existing bounded clone runner; sandbox basic bundles explicitly carry `sandboxScenarioSource: true`. Produce that input first with the exporter’s explicit sandbox branch (GETs only, applicant abstract, no documents):

```bash
node --env-file=.env.local --import ./scripts/lib/use-extensionless.mjs scripts/export-test-request-source-bundle.mjs --target=sandbox --sandbox-scenario-source --source-request-number=<number> --out=<absolute-private-sandbox-bundle.json>
```

The branch refuses production targets and never invokes production export dependencies. Keep bundles/manifests private, outside the repository. The PD email must resolve unambiguously to an enabled sandbox user; reviewer GUIDs are reread and must be active synthetic people without Contact bindings.

| Scenario | Phase I | Readiness | Memo / roster |
|---|---|---|---|
| 1 Intake | Retain unset or Pending Committee Review | true | Empty; no roster |
| 2 Rationale saved | Retain unset or Pending Committee Review | true | Fixed synthetic rationale |
| 3 First Cut No | Not Scored | true | Fixed synthetic rationale |
| 4 First Cut Yes | Scored | true | Fixed synthetic rationale |
| 5 Semi-finalist No | Recommended Do Not Invite | true | Fixed synthetic rationale |
| 6 Semi-finalist Yes | Recommended Invite | true | Fixed synthetic rationale; no roster |
| 7 Chairs approved | Invited | true | Phase II Pending Committee Review, two selected uninvited suggestions; the derived request status is reported as observed, not asserted (the sandbox's 2024 status rules differ from production's, which derive `Phase II Pending`) |
| 8 Unready control | Retain unset or Pending Committee Review | false/null, never written | Empty; no roster |

Only a separately authorized `--confirm=<exact-preview-digest>` can create/resume/finalize. One confirmation authorizes provisioning **and finalization of every selected scenario**. After provisioning, the CLI computes a fresh finalizer preview with the actual ETag and internally confirms its digest. Each result includes that `finalizerPreview`, including when finalization fails after the preview; later scenarios remain unattempted. **The 2026-11-08 build authorization permits preview only; do not confirm before owner code review and separate authorization.** For one existing scenario use `--scenario=N --run-id=<guid>` with its private manifest directory. Same actor, exact manifest, destination/test/run markers, Research, J27, PD and disabled reminders are reverified. Ready-run operations serialize through a dedicated database lock; dispatch CAS is committed before the remote write. Ambiguous writes reconcile by exact identity/readback and never resend. A failed scenario stops the batch with per-scenario identities; there is no rollback, deletion or readiness reset.

[VERIFIED via the 2026-11-09 UTC owner-authorized confirm attempt and `scripts/probe-sandbox-request-create-failure.mjs`] Without a bypass, the sandbox rejects the scenario Request POST transactionally with HTTP 400 / `0x80040265` wrapping a remote 500, exactly as on 2026-09-21: the synchronous `GOverify- check Publication 78 on create of a request record` and `Copy Applicant to Payee when Grant is Entered` sessions fail during an internal Update. Readback found no Request, location, payment, email or suggestion; the ledger run stays `needs_attention` at `create_request` and refuses re-POST, so a retry needs a new `--batch-key`. Add the bare `--bypass-goverify` flag to reuse the existing journaled, restore-guarded sandbox-only GoVerify deactivation around each Request POST (`stepCreateRequest`); the runner refuses it on any production target. The flag is part of the preview digest, so preview and confirm must both carry it. The six-hour bundle age check is waived only when every selected scenario's run is already reserved and `ready`, since no clone can then occur; the manifest's bundle hash check still applies, so a finalize-only rerun must pass the batch's original bundle.

Confirmed absence of the rationale Memo attribute records an undispatched `memo_absent` receipt. Metadata errors or wrong types block. Ledger memo values are typed hashes, never rationale text. Readiness is stamped last and only true; already-true without this operation's journal blocks. Passive Draft emails and expected tracking are censused, not generated by this CLI. Draft status and its associated state come from sandbox metadata; sent/unknown states, payments, incomplete census and unsettled jobs block completion. No email send, screening, AI generation or workflow dispatch exists in the scenario service.

Accepted fidelity limits: the Foundation organization is reused, no PI/cast contacts are created, and retained Phase I values are reported rather than cleared. Workbench visibility remains an integration check for the owner-approved Workbench build; the Factory never sets triage to compensate. A successful observation cannot guarantee later external automation stays unchanged.
