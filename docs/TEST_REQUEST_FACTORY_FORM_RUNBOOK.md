---
title: Test Request Factory Admin Form Runbook
domain: test-request-factory
kind: runbook
status: active
summary: "Operating the admin Test Request form in Production: what it needs, what each stop means, what a retry does, and how to turn it off."
canonical: false
cataloged: 2026-10-02
last_verified: 2026-10-03
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
4. **Status** (optional): available once the run is `ready`.

The bundle is valid for 6 hours from the lookup (`BUNDLE_MAX_AGE_MS`, `bundle-file-copy.js`). A run not finished by then cannot be finished.

Reference run **[RUN]**: `a5161f47-7b02-5ad3-8f20-3f645ec3c254`, source 1002988, test Request 1003310, seven documents, under three minutes from Confirm to ready.

## When a step stops

The panel shows "Stopped at …", plain copy for the recorded reason, and the raw error under "Technical detail". The raw error is kept only in the page and in the Vercel function log (`admin test-request run step stopped: <runId> <step> <outcome> <message>`); the ledger stores a reason code only. Read the log if the page has been reloaded:

```
vercel logs --environment production --since 1h -q "admin test-request run" -x
```

When available, "Retry step" sends the same advance again. What that does depends on whether a write had already been attempted. The table describes the existing backend runner (also used by the CLI), not a guarantee that the branch diagnosis enables every form retry. The table is **[SOURCE]** (a delegated trace of `run-runner.js`, `basic-clone-steps.js`, `bundle-file-copy.js` and `run-ledger.js` on 2026-10-02, spot-checked) except where a row is marked **[RUN]**.

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

Owner decision 2026-10-03: retain this partly built marked test record; no cleanup or recovery is authorized by that decision. Factory v2 is a separate [proposal](plans/TEST_REQUEST_FACTORY_V2_PLAN_2026-10-03.md).

Parked **[RUN]**: run `20407283-c279-5e0c-b396-210ad6842482`, test Request 1003308, two PDFs verified, one XLSX uploaded and unverified.

## Read-only diagnosis — branch implementation, not deployed

[SOURCE, October 3] The `codex/factory-run-diagnosis` branch adds guidance to the existing actor-owned run-detail GET. It reads only the saved run row and resource receipts. It does not read private artifacts, inspect live Dataverse/SharePoint records, claim a lease, run status recheck or write anything. Normal runner checks remain authoritative when an existing Advance is requested.

Named existing retries remain available for Request/location readback after an uncertain create and for `verification_failed` at Basic verification. These use the unchanged runner safeguards; the diagnosis neither performs recovery nor promises it. Receipts from known earlier completed steps do not block the current step, while unknown/future evidence stays blocked.

For Basic runs, the panel explains a live lease (wait and inspect again), expired source evidence (a new run is needed), an unverified copied item (readback investigation), a supported retry with no unresolved dispatch, or an unknown state (operator investigation). A new run neither repairs nor deletes the partial destination of an old run. Request 1003308 remains retained and unchanged. The six-hour check is based on the saved export timestamp; it does not establish artifact integrity or availability.

The Basic Advance control is enabled only when the current diagnosis permits retry and the existing write switch permits it. A new selection, an advance response or a failed refresh clears the previous diagnosis; responses from an old selection cannot replace the current view. Other known recipes are reported as not assessed and retain their existing controls after inspection succeeds; a failed or missing inspection disables Advance until the run can be inspected again. The form is deliberately more conservative than the backend runner for unclassified Basic failures. Unknown errors, source/preflight failures, and pre-upload failures without a positively classified retry remain disabled in the form; investigate first rather than treating a disabled button as proof the backend cannot recover. Any owner-directed CLI action still uses the existing runner checks and requires its own operational authorization. Later recovery, status operations and retirement are outside this slice. This section describes branch code, not a production release.

## Status changes

Only a `ready` production run. One change may be open per run. The form confirms before sending and shows the result.

| Result | Meaning | What to do |
|---|---|---|
| Status changed **[RUN]** | Written, read back, background jobs settled | Nothing |
| Background jobs still finishing (`jobs_open`) | Written; jobs on the Request were still running when the wait ended | "Check again" (it resumes the same change; it never sends a new one) |
| Result could not be read (`unconfirmed`) | Sent; the read-back failed | "Check again". Do not start a different change |
| Being sent (`in_progress`) | Another request is sending it, or one was cut off after sending | Do not retry. If it never resolves, establish that no sender is still running, then close it from the CLI with the command the form shows (`--status-abandon … --change-id …`); that writes the ledger only |
| Refusals | Already set; another change open; the Request changed since it was read; transition not allowed from the current status; would repeat a payment or tracking row | Nothing was sent. Reload and choose again. A repeat that would create a payment or tracking row needs the CLI `--set-status … --rerun` after inspection |

## The command-line tool

`scripts/rehearse-test-request-sandbox.mjs --target=production`, owner-run, reads `.env.local`.

| Mode | What it does |
|---|---|
| `--run-inspect=<runId>` | Read-only: the run row and every resource receipt. No Dataverse. Its output on 2026-10-02 did not include status changes **[RUN]**. |
| `--run-recheck=<runId>` | Read-only: the Foundation account against the run's baseline. |
| `--advance=<runId> --manifest=<file> --bundle=<file>` | The same advance the form performs, so it cannot pass a stop the form cannot pass. Needs the run's manifest and bundle as local files. |
| `--set-status`, `--status-recheck`, `--status-abandon` | The status setter, its recheck, and closing a change stuck `dispatched`. |
| `--ledger-check` | Ledger schema against the tracked fingerprint. |

To get a form run's manifest and bundle: the run panel's artifacts download, or `scripts/factory-artifacts-download.mjs` (owner-run, reads `FACTORY_BLOB_RW_TOKEN` locally).

## Artifacts and the daily sweep

The daily maintenance cron deletes Factory Blob objects (`sweepFactoryArtifacts`, `factory-artifact-store.js`) **[SOURCE; aggregate Production execution observed 2026-10-03]**: saved lookups older than 6 hours; a run's bundle and manifest once the run is `ready`; objects with no ledger row once older than 24 hours. It keeps everything for a run that is `prepared`, `creating` or `needs_attention`. Download a finished run's artifacts the same day if they will be wanted.

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
