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
