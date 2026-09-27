# Test Request Factory: production enablement plan (item 7)

Status: **DRAFT (2026-09-27, Session 545). Not plan-reviewed; nothing built.** Parent design: `TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md`; its *Item 7 owner decisions* paragraph (Q1–Q5) and the slice 5a parking record are the inputs. Where this plan and the design disagree, the design's owner decisions win until this plan is reviewed and accepted.

## Why now

Owner decision 2026-09-27: sandbox live proofs stop after recipe 4. Deeper recipes spend most of their effort on gaps the sandbox has and production does not (staff-user parity, prompts, AI runs, source data), while the proof covers less. Recipes 5 and 3 are finished as production runs.

## Owner decisions this plan builds on

- **Q1** Local CLI first, under a daily `DATAVERSE_PROD_WRITE_ACK`; the admin form follows.
- **Q2** Ledger: local container for the CLI phase; shared Postgres when the form lands (recommended, owner undecided).
- **Q3** GoVerify is not bypassed in production; its warning is accepted.
- **Q4** Schema applies and isolation switches are done when a production run first needs them.
- **Q5** Platform owner reports no off-platform triggers. Known exceptions: two classic workflows on create (GoVerify; Copy Applicant to Payee), both acting on the new Request.

## Facts this plan relies on

[VERIFIED S545 against source unless marked]

- The interlock allows a local production write only with `DATAVERSE_PROD_WRITE_ACK="<purpose> <today UTC>"`, and then allows every write that process makes (`lib/dataverse/core/interlock.js:163-176`). A `DATAVERSE_REHEARSAL_GRANT` never covers `$batch` (`:303`), and the Factory's atomic writes are `$batch` changesets (`lib/dataverse/core/changeset.js:4`). So the ack is the only local route, and the Factory must supply its own narrower fence (P2 below).
- Source reads and SharePoint are already production (the shared `akoyago-shared` site). The ledger already accepts `destination_environment = 'production'` (`lib/db/migrations/054_test_request_runs.sql:104`).
- The sandbox binding is mostly a host and token setting: `SANDBOX_URL` (`basic-clone-steps.js:48`, refused at `:638`), `assertSandboxHost` in the three `*-sandbox-deps.js` builders, and the rehearsal CLI (`scripts/rehearse-test-request-sandbox.mjs:1094-1099`) [REPORTED S545, inventory pass].
- The sandbox-only behaviour that must be removed: the GoVerify bypass (`createRequestWithGoverifyBypass`, deactivates an org-wide workflow), the stub `wmkf_ai_run` (a production source run can bind), and the P6 materials-collection skip.
- Factory behaviour that must be kept in production: create-only uploads (`conflictBehavior: 'fail'`), throwing sentinels on every LLM entry point, the only sanctioned marker writer (raw client with `allowTestRequestMarkerWrites`), the synthetic PI/Co-PI, and the ownership fences.
- Every Factory document write uses the `SANDBOX_REHEARSAL` actor policy (`request-document-actor-service.js:97-116`; `run-runner.js:1245,3611`) [REPORTED S545]. The production default `REQUIRED` would refuse an unattributed write.
- Neither `TEST_REQUEST_ISOLATION` nor `SYNTHETIC_REVIEWER_ISOLATION` is set in production (`vercel env ls production`). The wave29 marker columns and wave30 are absent in production (`TEST_REQUEST_FACTORY_SCHEMA_PROPOSAL_2026-09-19.md:49-52`) [REPORTED; re-check by the owner-run probe in P0].

## Sandbox automation census (2026-09-27, S545)

[VERIFIED S545 by read-only sandbox queries: the P0 probe's queries run against the sandbox, `asyncoperations` on clones 1000338–1000348, and the exported workflow XAML]

- The sandbox has **62 activated classic workflows and business rules on `akoya_request`**, 12 of them triggered on create, plus 59 enabled Create/Update plug-in steps (including the vendor's `AkoyaGo.RequestUpdate`, sync). No activated cloud flows are visible to the app user (0 of 0 in category 5).
- **The sandbox org is in "Disable Background Processing" mode.** Every background workflow queued by the clones ended Canceled with "The async operation was skipped because the org is in Disable Background Processing mode". So the sandbox proofs exercised only the real-time workflows and sync plug-ins. The six background create workflows have **never run on a Factory Request**. In production they will.
- The six background create workflows:
  - *WMKF_Research Application Received Email Flow* creates a **draft** acknowledgment email (never sends). It does so only when status is Pending, Phase I received has a value, the program is Research and it is not yet acknowledged. Otherwise it waits until the submit date has a value.
  - *WMKF_Set Co-PI Field on Contact* updates **Contact** rows only when the Request's Co-PI fields have values. The clone sets none.
  - *WMKF_Update CA FTB Status on Org* writes the **applicant account**: Yes when the Request's `wmkf_caftb` is Yes, otherwise No when it equals No. New Requests default `wmkf_caftb` to `false` (column default, and every sandbox clone), so this write fires on every production create.
  - *wmkf_set Write Up Type on Create*, *WMKF_Set Request Status for Discretionary* and *WMKF_Set Concept Call to Yes* update only the Request.
- The seven real-time create workflows ran on every clone. Six update only the Request. *GOverify- check Publication 78* updates the **applicant account**.
- **The clone's applicant is always the W. M. Keck Foundation account** (`FOUNDATION_NAME`, `basic-clone-steps.js:49,245-253`). So in production two workflows write the Foundation's own account on every Factory create: GoVerify (accepted, Q3) and the CA FTB workflow.
- The runner baselines that account (`foundationBaselineDigest`, `basic-clone-steps.js:270`), so a production run would stop `needs_attention` on those writes. That is safe, but no run could reach `ready`. P1 must decide this (open question 4).
- The Q5 statement that nothing triggers is contradicted for the sandbox.

**Production P0 run (owner-run, 2026-09-27, S545) — the sandbox definitions are NOT production's.** [VERIFIED via the owner's run of `scripts/probe-test-request-factory-production-readiness.js`]

- Marker columns: `wmkf_istestrequest`, `wmkf_testcreationrunid` and `wmkf_issyntheticreviewer` are all absent.
- App-suite application user `53e97fb3-a006-f111-8406-000d3a352682`, enabled. Roles: Delegate, System Customizer, WMKF AI Elevated TEMP, WMKF AI Tools, WMKF Custom Entities, WMKF Research Review App Suite - Staff, akoyaGO Team User (no accounting). It has **no System Administrator role**; the sandbox app user has one, so no sandbox run exercised the Factory's writes under production's narrower roles.
- The program director (the owner, `29b0de0d-4ff7-ee11-a1fd-000d3a3621c7`) is enabled.
- 68 activated workflows, business rules and dialogs on `akoya_request` (sandbox 62). 8 are create-triggered (sandbox 12):
  - background: *WMKF_Set Payee Payment Contact from Request*, *WMKF_Set Request Status for Discretionary*, *WMKF_Set Co-PI Field on Contact*, *WMKF_Create SoCal draft Phase II Ack*, *WMK_Set Type for Roll up Field*;
  - real-time: *WMKF_Update Payment Contact from Org*, *Default a Request Title*, *Set GOapply Settings on Request*.
- **Not active in production:** *GOverify- check Publication 78*, *Copy Applicant to Payee when Grant is Entered* and *WMKF_Update CA FTB Status on Org*, so neither Foundation-account write in the sandbox census happens there. *WMKF_Research Application Received Email Flow* triggers on update of `akoya_submissionaccepted`, not on create. Production's GoVerify warning therefore comes from another mechanism [ASSUMED: possibly an AkoyaGo plug-in].
- 67 enabled Create/Update plug-in steps, including four vendor plug-ins the sandbox lacks: `AkoyaGo.RequestSetGrantAndStatus` (sync create and update), `AkoyaGo.CalculatedFieldsAsync` (async create and update), `AkoyaGo.AsyncRequestGoApplyRequirementsUpdate` (async update) and `AkoyaGo.AsyncEntityCreated` (async create). Their effects cannot be read from metadata.
- 4 of 14 activated cloud flows mention `akoya_request`: *Bill.com - Push Payments*, *Bill.com Pull Payments*, *GOapply Add Request to Review Group (Deprecated)*, *GOapply AutoFill Next Phase (Deprecated)*. Their triggers are not yet read; the probe's `--detail` mode prints them.
- Consequence: the sandbox is not a reliable model of production automation in either direction, and every sandbox-derived automation claim above is sandbox-only.

**Production create automation, characterized (owner-run `--detail` and `--export-xaml`, 2026-09-27, S545).** [VERIFIED from production's exported workflow definitions and flow client data]

- **Cloud flows:** none reacts to a Request create. *Bill.com - Push Payments* and *GOapply Add Request to Review Group (Deprecated)* are manual triggers. *Bill.com Pull Payments* is a daily recurrence over `akoya_requestpayments`. *GOapply AutoFill Next Phase (Deprecated)* triggers on `akoya_goapplystatustracking` create. The Factory creates no payment or GOapply rows. The Bill.com gate (open question 6) is satisfied for the flows.
- **The 8 create-triggered workflows, against what a clone's create body sets** (`CREATE_FIELDS`, `basic-clone-steps.js:67-80`, which sets no grant program, payee, payment contact or Co-PI):
  - Six write only the Request: *Update Payment Contact from Org*, *Set Request Status for Discretionary*, *Default a Request Title*, *WMK_Set Type for Roll up Field*, *Set GOapply Settings on Request*, and *Set Co-PI Field on Contact*, which writes Contacts only when a Co-PI field has a value. *Default a Request Title* may overwrite the copied title, which is fidelity, not safety.
  - *WMKF_Set Payee Payment Contact from Request* updates the **payee account's** `wmkf_paymentcontact` only when three things hold: `wmkf_grantprogram` equals program `86e6422b-a7cb-ee11-9078-000d3a341e8f`, the Request's payment contact is set, and the payee account's is empty. It fills an empty field and never clears one. A clone meets none of the three.
  - *WMKF_Create SoCal draft Phase II Ack* creates a **draft** email (not sent) only when `wmkf_grantprogram` equals program `8cf9c61d-a7cb-ee11-9079-000d3a341fd9` and `wmkf_phaseiicheckincomplete` equals option `100000001`. A clone sets neither.
- **Consequence:** no production create workflow writes outside the new Request for a clone as the create body stands. A later change that copies the grant program, payee, payment contact or Co-PIs must re-check these conditions (see open question 5).
- **What remains unknown are the four AkoyaGo plug-ins**, whose effects metadata cannot show: `RequestSetGrantAndStatus` could set fields such as the grant program that the conditions above read. The first production `basic` run (P5) observes them. Its check list adds the Request's grant program and payee, email activities regarding it, `asyncoperations` regarding it, and the Foundation account's `versionnumber`.

## New hazards in production

1. **Source and destination are the same org.** In the sandbox, "never write to the source" (decision 10) held because there were two orgs. In production it holds only because of ID checks.
2. **The isolation switches live on Vercel; the CLI runs locally.** A marked Request created while Vercel's switches are off is treated as ordinary by cron jobs, email and reports. The CLI cannot see Vercel's environment.
3. **The daily ack is blanket.** The interlock no longer narrows anything for the process that holds it.

## Phases

### P0 — Owner-run read-only production probe (before any build commitment)

The owner runs it with `DATAVERSE_ALLOW_PROD_READS=yes` set inline on that one command; Claude never sets or exports it. It reports:
- whether `wmkf_istestrequest`, `wmkf_testcreationrunid` and `wmkf_issyntheticreviewer` exist;
- the production app-suite application user's `systemuserid`, enabled state and roles;
- that the owner's systemuser (1003222's program director) is enabled;
- the classic workflows and Power Automate flows registered on `akoya_request` create and update (name, mode sync/async, state), so the Q5 list is complete rather than inferred from one sandbox failure.

### P1 — Target parameterization (sandbox path kept)

- One `target` value (`sandbox` | `production`) chosen at reservation, pinned in the manifest and plan digest, and re-checked at every lease. Every host check derives from it; nothing infers it from the environment.
- The sandbox path stays working: the admin preview and existing sandbox runs use it.
- The three dependency builders become target-bound builders. The host and token binding shrinks to the app's defaults for production; the Factory wrappers listed above stay.
- The GoVerify bypass is unreachable in production: the CLI refuses `--bypass-goverify` with a production target, and `create_request` refuses a journaled bypass intent for one. Tests cover both.
- The stub AI run is replaced by binding the source's own `wmkf_ai_run` for production (recipe 4). Whether copying the link is enough, or the Final Writeup forward-copy needs anything else, is checked in the build.

### P2 — Run-scoped write fence at the transport

Replaces the two-org guarantee. Every write the Factory's client, changeset or Graph wrapper sends in a production run must target:
- the destination Request;
- a row or item this run journaled before the write (I1);
- or a create on an entity set the recipe declares.

The fence refuses the source Request's ID and every source document's ID outright, even if something else allowed them. At the end of each run `fence_source` re-reads the source's `versionnumber` and `modifiedon` and fails the run if either moved. The bundle-vs-live source check still runs even though export and clone now read the same org.

### P3 — Production actor

First check whether the production default `REQUIRED` policy works unchanged when the runner passes the production app-suite user (from P0) as the acting user. If it does, no new actor policy and no writer-gate change. Only if it does not, design a Factory actor policy with its own writer-gate registration. The P3 Final Writeup actor becomes that production app user.

### P4 — Reservation preflights (production target only)

A production reservation refuses unless all of these hold, each recorded in the manifest and plan digest:
- the marker columns are present, read live at reservation (production read);
- for recipes that seed reviewers, the wave30 column is present;
- an operator attestation flag that `TEST_REQUEST_ISOLATION=on` (and, for reviewer recipes, `SYNTHETIC_REVIEWER_ISOLATION=on`) is set in Vercel production. The CLI cannot read Vercel env, so this is an attestation; the form phase replaces it with a server-side check.

Order for the owner (Q4): apply the schema, set the switch, then run.

### P5 — First production run: `basic` only, then observe

This is Q5's disconfirming test. After the run, before any deeper recipe, check and record in evidence:
- email activities regarding the new Request (expect none);
- classic workflow and Power Automate run history on it (expect only the P0-listed create workflows);
- its `modifiedon` and vendor-touched fields over the following day;
- its appearance in AkoyaGO, and in Workbench with the TEST badge.

Deeper recipes follow one at a time: IA, reviews, Pre-Site, then recipe 5 (slice 5a rebased onto this plan, with the program director copied by GUID), then recipe 3 with its materials collection.

### P6 — Migration 054 sequencing

Slice 5a edits 054 in place on its parked branch (two steps, three reason codes, a receipt key). Either 5a's ledger changes land on `main` before 054's first shared apply, or they ship as migration 055. Decide before the form phase applies 054 to the shared Postgres.

### P7 — Admin form (after the CLI phase is proven)

This is the designed lease-based step endpoint under `pages/api/admin/test-requests/`:
- a superuser-only creation form with editable reviewer addresses and the program director;
- resume and inspect;
- retire.

It needs the Q2 shared ledger, and it replaces P4's attestation with a server check of the isolation switches. It carries the S544 requirement of deterministic reservation identity per actor plus an idempotency key. Its own plan review happens then.

## Process

- The owner runs every production command. Claude hands over commands and never sets `DATAVERSE_PROD_WRITE_ACK` or `DATAVERSE_ALLOW_PROD_READS` (memory `feedback-never-self-authorize-prod-dataverse-reads`). The ack is set inline on the one command, never exported.
- The plan gets `/contract-reconcile`, then a Codex plan review, before any build. The build follows the S543/S544 slice process (invariant table and mutation checks before review, Codex capped at three rounds per slice).
- Findings are weighed as safety versus fidelity (memory `feedback-factory-safe-not-full-fidelity`). P2 and P4 are safety; bypass removal is safety; the AI-run binding is fidelity.

## Open questions

1. Q2, the ledger database for the form phase.
2. Whether the 1000338 folder provisioner exists in production, and what it is (P0's workflow listing may answer it).
3. Retire semantics for production residue: which rows can be deleted versus deactivated, given append-only tables such as `wmkf_ai_run`.
4. **Foundation-account writes: decided on sandbox evidence, then MOOT for production (2026-09-27, S545).** The owner accepted the two sandbox workflows' account writes (`akoya_goverifytrigger`, `wmkf_caftb`) and a narrowed baseline check. The production P0 run then showed neither workflow is active in production. The Foundation baseline check stays on `versionnumber` unless the first production `basic` run (P5) shows a production mechanism writing the Foundation account, most likely an AkoyaGo plug-in. If it does, the same approach applies: a field projection with a reviewed exclusion list.
6. **Production create automation: characterized except for the four AkoyaGo plug-ins** (see *Production create automation, characterized*). The flows and the workflows are cleared for a clone as its create body stands. The plug-ins are observed on the first production `basic` run.
5. Whether any other create workflow's condition can become true through a later recipe's writes (for example the email flow's wait on submit date, or Co-PI fields), which would re-trigger it mid-run.
