# Bounded automatic Short Title trial — approval packet

Status: PREPARED, NOT APPROVED OR EXECUTED. Read-only deployment inspection and
Factory preparation only. Connor’s existing deployment/job/credentials remain unchanged.

## Timing evidence

[VERIFIED 2026-11-13 UTC via Vercel deployment Resources UI] Deployment
`dpl_EPwhUcrNtffRY3X6u7bbDrqqobGS`, route `/api/cron/drain-machine-prompt-jobs`:
Node.js 22.x, IAD1, 48.4 MB, **Max Duration ≤300s**. The Resources table is the
function-level evidence, not the deployment’s 120-second wildcard configuration.
[Deployment Resources](https://vercel.com/justin-gallivans-projects/wmkf_research_apps/EPwhUcrNtffRY3X6u7bbDrqqobGS/resources).
Read-only Vercel API independently confirmed READY Preview and mapped the output path
to function `team_bAyoqgvSJhFJC3blheJgTMXQ-c6371cb8cb7d062aea0d8a5fa77159a3b2`.
CLI inspect alone returned no lambda detail; alternate API lookups returned 404, not
function-duration evidence. No worker invocation was made to measure a timeout.

[VERIFIED source] `machine-worker.js` supplies a 240,000 ms lease. `worker.js`
sets the Executor absolute deadline to lease end minus 5,000 ms. The transport
uses the smaller of its own budget and remaining deadline. Provider retries,
parameter repair and fallback are disabled for these profiled jobs. This is a
configured deadline, not a measured maximum wall time or latency guarantee.
A live original invocation can outlast its lease; store fencing must make reclaim
unknown and prevent redispatch. The trial will not force a timeout or test that
race with paid calls; existing offline lease tests are the evidence for that path.

A fresh deployment must independently show 300 seconds before its driver config
may set `serverBudgetMs: 300000`, `budgetVerified: true`. The client timeout becomes
310 seconds. Eight ticks / ten minutes / expiry remain hard operator limits, with
310 seconds reserved before each request. Slow calls may cause a safe incomplete
stop before the next tick. Never extend the budget or retry within this approval.
The five-stage previous success is a planning observation, not a promise.

## Exact proposed effects

1. Create **one new Sandbox Test Request** through the existing basic Factory recipe,
   attached to the existing W. M. Keck Foundation test account. No people or roles
   are created. No Production Dataverse write. Source fixture 1000339 is read-only;
   its title, abstract, output, ETag, job and receipts must not be changed.
2. The basic Factory recipe may correct the new Request’s meeting date, create one
   new SharePoint Request folder and one Dataverse document-location row. These are
   explicit side effects even though this task uses no document. No files copied or
   uploaded. **No GoVerify bypass or workflow/permission changes**: stop if ordinary
   create is rejected. Retain the new test objects for evidence; no deletion authorized.
3. Conditionally set the new Request’s initially blank abstract to the same 536-character
   fabricated optical-imaging abstract used in the first engineering test. Preserve
   its TEST title. Confirm its Short Title destination is blank and it is not Invited.
4. Deploy **one additional immutable Vercel Preview**, no alias, with deployment-only
   pins for the new Request/event/pilot. Reuse the existing isolated Neon branch,
   schema, published Short Title v1/profile, and app registration. Create no database,
   role, Entra app, app secret or schema. Reuse the still-valid operator app credential;
   stop if it was revoked. Use a separate deployment-specific protection cookie and
   a separate deployment-only cron secret. Do not change Connor’s access or shared envs.
5. Submit one `preflight.short-title` initialize job with the exact new key. Run the
   bounded operator driver once after its new immutable deployment/job pins are
   reviewed and its private config is prepared. At most eight sequential worker POSTs,
   at most one Anthropic `claude-sonnet-5-5` call, max 4,096 output tokens, no provider
   retry/fallback, one content-free AI-run audit and one conditional output PATCH.
   Vercel build/hosting and Neon compute/storage may incur charges; Anthropic may
   charge for the model call. This is an operation bound, not a dollar billing cap.
6. Replay the same submit key and GET final status; no further worker ticks after
   success. Verify counts and field/ETag readback, then stop. No schedule is installed.

## Prepared identity and payload

Read-only Factory command: `scripts/rehearse-test-request-sandbox.mjs --prepare=…`
with `--source-request-number=1000339` and the test label below. The helper initially
failed to resolve an extensionless import before network work; a local read-only
preload supplied Node resolution and refused non-token writes. Preparation then
succeeded. No execute/reserve/advance mode was invoked.

| Pin | Value |
| --- | --- |
| requestId | `a92c0f69-90ec-4c24-bc19-f26a0bfc18b6` |
| factoryRunId | `13f05e86-4649-4151-ad99-c4dd51ae3ba0` |
| locationId | `421617a8-a823-491c-aab7-165b21bf92bd` |
| pilotId | `d43a9644-3d09-40cb-b9ec-3d264b8c51c9` |
| sourceEventId | `667bd07c-1e58-4f12-876f-2cdd2c7afaea` |
| idempotencyKey | `e0e068e8-e480-4fa6-880d-1c4ad1213acb` |
| createBodySha256 | `90b7ebbab2e04771f07f33389f918ff950053608731778b81e5b94670541af63` |

Create body (reviewable, no secrets):

```json
{
  "akoya_requestid": "a92c0f69-90ec-4c24-bc19-f26a0bfc18b6",
  "akoya_applicantid@odata.bind": "/accounts(537e3b60-c18f-ee11-8179-000d3a341e8f)",
  "akoya_title": "TEST: PA bounded automatic worker synthetic trial 2026-11-13",
  "akoya_fiscalyear": "December 2099",
  "akoya_requesttype": 100000000,
  "wmkf_meetingdate": "2099-12-01",
  "wmkf_istestrequest": true,
  "wmkf_testcreationrunid": "13f05e86-4649-4151-ad99-c4dd51ae3ba0",
  "wmkf_respondreminderenabled": false,
  "wmkf_reviewduereminderenabled": false
}
```

The local preparation manifest expires at 2026-11-13T04:20:47.598Z. If approval comes
later, re-run Factory read-only preflight and its manifest builder with the same
preallocated IDs. Require identical create-body hash and pinned account/app/source
identity. Do not edit an expired manifest or silently substitute a different payload.
Changed preconditions stop execution for review. The Request number and deployment
URL/job ID are assigned by the services after approved creation/admission, so they
cannot be preallocated here. The prepared Request GUID is the recovery key.

Synthetic abstract:

> Synthetic sandbox proposal for an engineering test. This project will develop and evaluate an optical imaging method for measuring changes in living cells. The team will build a laboratory prototype, compare its measurements with established microscopy methods, and quantify sensitivity and reproducibility using controlled cell samples. The intended result is a validated method for observing cellular processes with improved temporal resolution. This fabricated abstract is test data and is not a claim about an actual grant proposal.

## Isolation, stopping rules and acceptance

- Before/after read-only receipts capture Connor’s original job/version, one attempt,
  one publication and selected Request fields/ETag. No raw credentials in receipts.
- The new scope is `pa-short-title:<new pilotId>` in the same Neon database. Verify
  the new scope has zero jobs before admission, one afterward, and the old scope’s
  counters remain one/one/one. Shared database total after success should be two
  jobs/two attempts/two publications, subject to a fresh preflight confirming baseline.
- Inspect actual deployed policy: new Request and source event, new scope, exact
  prompt/profile/database pins, expiry exactly `2026-11-18T19:30:00.000Z` and the registered
  Sandbox target with DAL/interlock on. Existing worker selects only that scope.
  Client job-ID checks alone cannot constrain its server-selected POST.
- Keep private operator-only status token/cookie/cron secret in mode-0600 config;
  new driver pins must use a distinct per-user retained receipt. Never remove the old
  receipt or use another machine to bypass an uncertain result. Driver code pin
  changes and a fake-HTTP test run are required before live execution.
- Factory create, source seed, submit or worker timeout/non-200 stops mutations;
  read-only recovery determines whether a result committed. Never retry blindly,
  create another Request/job, clear an output, refresh an ETag, disable a workflow,
  widen permissions or allow a second model call.
- No runtime configuration changes are needed for the observed 300-second budget.
  If the new deployment differs, stop before admission rather than patching runtime
  as part of this approval. Verify current prompt pins/source before the paid tick.
- Pass requires observed queued then running then succeeded, one validated attempt,
  delivered audit, applied publication, output equal to retained validated result,
  same-key replay returning the identical job, no subsequent output/ETag change,
  and unchanged Connor receipts. A stage response alone is not a pass.
- If it stops safely, report the exact durable stopping stage without calling the
  trial passed. Content/receipts remain under existing retention; no scheduled cleanup
  is added. New Preview access expires no later than the current November 18 cutoff;
  do not revoke the shared app credential while Connor still needs it.

This trial proves automatic sequential stage advancement on an operator machine,
not unattended Production scheduling, Power Automate end-to-end generation, or
Executive Summary delivery. Source choice for future proposal prompts stays open.

## Executable preparation and deployment pins

Factory execute command, after approval and only with an unexpired verified manifest:

```sh
DYNAMICS_SANDBOX_URL=https://orgd9e66399.crm.dynamics.com DYNAMICS_URL=https://orgd9e66399.crm.dynamics.com node --require=./scripts/rehearsal/pa-factory-node-loader.cjs --env-file=/Users/gallivan/Code/WMKF_Apps/.env.local scripts/rehearse-test-request-sandbox.mjs --execute=/private/tmp/wmkf-pa-auto-trial-manifest-20261113.json --receipt=/private/tmp/wmkf-pa-auto-trial-factory-receipt-20261113.json
```

The committed resolution-only loader has been checked with the actual Factory CLI
`--help`; it changes neither authorization nor HTTP behavior. The earlier read-only
fetch guard is not the execution loader. A fresh execute receipt must not exist.
No `--bypass-goverify` flag is permitted. Refresh an expired manifest using the
existing `buildCloneManifest` API with the same `ids` and values after fresh preflight;
its standard one-hour lifetime must be recomputed by the builder, not hand-edited.

Seed only `akoya_request.wmkf_abstract` through `grant-request.updateById` in a trusted
script DAL context, with the fresh concrete If-Match and exact Sandbox expectedOrigin.
Verify empty abstract/destination first; write the literal abstract above exactly once.
Abstract SHA-256: `0d0ab1f89b107d6fed29e8f1363e347802cb25585d685f9f819a5d7d812a2721` (536 characters).
After Factory corrections and abstract seeding, take two read-only Request observations
five seconds apart and require identical selected source fields and ETag before submit.
This reduces avoidable plugin races but does not prove no later change; original-ETag
publication remains the final concurrency check.

Deploy runtime source **`23f71d2b54bb325f61626aa9f8dc1e402011ecf0`**, the already tested
runtime commit. Use a clean source export and one Preview deployment, no git push,
production promotion or alias reassignment. Deployment-only env overrides (`--env`
through the operator process, never printed in command logs) are:

- `DYNAMICS_URL` and `DYNAMICS_SANDBOX_URL`: `https://orgd9e66399.crm.dynamics.com`.
- `DATAVERSE_TARGET_INTERLOCK=on`, `DATAVERSE_DAL_ENFORCEMENT=on`,
  `DATAVERSE_ALLOW_PROD_READS=false`.
- `PROMPT_JOB_MACHINE_PILOT`: exact JSON below.
- `PROMPT_JOB_NONCE_SECRET`: new private stable value for this deployment.
- `CRON_SECRET`: new private deployment-only value, never shared with Connor.
- `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`,
  `POSTGRES_URL_NO_SSL`, `POSTGRES_PRISMA_URL`, `PGHOST`, `PGHOST_UNPOOLED`,
  `POSTGRES_HOST`, `PGUSER`, `POSTGRES_USER`, `PGPASSWORD`, `POSTGRES_PASSWORD`,
  `PGDATABASE`, `POSTGRES_DATABASE`: the existing isolated `pa-prompt-sandbox`
  connections and identities (private values reused without rotation).
- Existing application provider/Dataverse app configuration is inherited exactly as
  for the first tested Preview. Verify required presence and Sandbox interlock before
  admission. Never write project-wide/Preview-default environment settings.

```json
{
  "enabled": true,
  "pilotId": "d43a9644-3d09-40cb-b9ec-3d264b8c51c9",
  "requestId": "a92c0f69-90ec-4c24-bc19-f26a0bfc18b6",
  "promptId": "25d6d5db-cfde-f111-84ea-70a8a59af221",
  "promptVersion": 1,
  "promptHash": "fbdaec1ecabfad178bbf0c9d18a564aee3964d78ee31be6578c94e368f4570eb",
  "profileHash": "1efb08237a271e43b9a5a7c5aeb9f7769fd3b0c355d03527b6452a6eae215b8d",
  "sourceEventId": "667bd07c-1e58-4f12-876f-2cdd2c7afaea",
  "tenantId": "baea89d4-d4a9-449a-b1d6-ec31fb5b380c",
  "audience": "e4493960-9701-4c0b-ae21-7a9716af67ba",
  "clientId": "e4493960-9701-4c0b-ae21-7a9716af67ba",
  "servicePrincipalId": "f3ed2ad8-f171-4c03-bfa3-5e5db934eff0",
  "role": "PromptJobs.Invoke",
  "databaseEndpoint": "ep-nameless-shape-afytiwop-pooler.c-2.us-west-2.aws.neon.tech:5432",
  "databaseIdentity": "b318c52894cf1405fd4af799541a7505c54e2e103f162768f3c2fce626dbad48",
  "expiresAt": "2026-11-18T19:30:00.000Z"
}
```

Authentication: acquire a fresh short-lived client-credentials token using the existing
sandbox app ID/secret, tenant and API audience, using the already-tested Entra token
path. Use it for submit and `statusToken`. No token is copied from Connor and no app
credential, grant or role is changed. **The application principal is deliberately the
same**, and JWTs are not scope- or deployment-bound. The server binds that principal
to its own deployment policy’s new scope. Separate cookie and cron-secret values are
not Entra grants. This clarification corrects the review’s suggestion that a fresh
principal or scope-bearing JWT is necessary; that would require needless new access.

[VERIFIED source: `store.js` `assertMachineDatabase`, `verifyMachineTitleDatabase`,
`listJobs`, and `admitJob`] Database verification checks cluster/database identity,
not a global singleton. Listing predicates include environment, principal, authorization
scope and Request. Quota counts the authorization scope, after exact idempotency replay.
A new scope/job therefore does not invalidate the old deployment’s reads or quota.
The new Request also avoids the per-Request initialization/lease predicates. These
are source proofs; pre/post live readbacks remain required.

Mechanical post-admission checkpoint (covered by the proposed approval, no extra
owner sign-off): change only driver constants `BASE`, `JOB` and `LOCK` to the returned
immutable Preview URL, admitted job GUID and a unique home-directory receipt for
that Preview. Keep `CUTOFF` unchanged. Reconcile local documentation pins and rerun
all 20 fake-HTTP tests; failure stops before any worker POST. No arbitrary runtime
logic change is included. The current driver reserves 310 seconds even for a status
GET, so it cannot start any request after roughly t=290 seconds of its ten-minute
window. This intentionally conservative bound may leave a committed output needing
read-only verification. Do not weaken it or mark that run passed automatically.

## Pinned abstract-seed snippet (execution requires approval)

Save the exact snippet below to a private local file after approval; run its contents
via stdin from the worktree root so relative imports resolve there. Use Node 26 with
`--require=./scripts/rehearsal/pa-factory-node-loader.cjs`, the same private
`--env-file=/Users/gallivan/Code/WMKF_Apps/.env.local`, and these explicit environment
overrides: `DYNAMICS_URL=https://orgd9e66399.crm.dynamics.com`,
`DYNAMICS_SANDBOX_URL=https://orgd9e66399.crm.dynamics.com`,
`DATAVERSE_TARGET_INTERLOCK=on`, `DATAVERSE_DAL_ENFORCEMENT=on`.
The intent file must not exist. The snippet is not an approval mechanism; it is the
exact proposed write. No current source or destination may be overwritten.

```javascript
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { withDalContext } = require('./lib/dataverse/core/context.js');
const { getById, updateById } = require('./lib/dataverse/adapters/grant-request.js');
const origin = 'https://orgd9e66399.crm.dynamics.com';
const requestId = "a92c0f69-90ec-4c24-bc19-f26a0bfc18b6";
const runId = "13f05e86-4649-4151-ad99-c4dd51ae3ba0";
const abstract = "Synthetic sandbox proposal for an engineering test. This project will develop and evaluate an optical imaging method for measuring changes in living cells. The team will build a laboratory prototype, compare its measurements with established microscopy methods, and quantify sensitivity and reproducibility using controlled cell samples. The intended result is a validated method for observing cellular processes with improved temporal resolution. This fabricated abstract is test data and is not a claim about an actual grant proposal.";
const digest = "0d0ab1f89b107d6fed29e8f1363e347802cb25585d685f9f819a5d7d812a2721";
const receipt = '/private/tmp/wmkf-pa-auto-trial-abstract-intent-20261113.json';
const options = { expectedOrigin: origin, strictRead: true,
  select: 'akoya_requestid,akoya_title,wmkf_testcreationrunid,wmkf_istestrequest,wmkf_abstract,wmkf_wmkfprojectdescription,wmkf_phaseistatus' };
(async () => {
  if (process.env.DYNAMICS_URL !== origin || process.env.DYNAMICS_SANDBOX_URL !== origin
    || process.env.DATAVERSE_TARGET_INTERLOCK !== 'on' || process.env.DATAVERSE_DAL_ENFORCEMENT !== 'on'
    || createHash('sha256').update(abstract).digest('hex') !== digest || abstract.length !== 536) throw Error('pin_mismatch');
  await withDalContext('approved-pa-automatic-trial-source-seed', async () => {
    const row = await getById(requestId, options);
    if (row.akoya_requestid !== requestId || row.wmkf_testcreationrunid !== runId
      || row.wmkf_istestrequest !== true || row.akoya_title !== 'TEST: PA bounded automatic worker synthetic trial 2026-11-13'
      || row.wmkf_phaseistatus === 100000003
      || ![null, ''].includes(row.wmkf_abstract) || ![null, ''].includes(row.wmkf_wmkfprojectdescription)
      || !/^(?:W\/)?"[^"\r\n]+"$/.test(row._etag || '')) throw Error('source_not_eligible');
    const fd = fs.openSync(receipt, 'wx', 0o600);
    try {
      fs.writeSync(fd, JSON.stringify({ requestId, runId, etag: row._etag, abstractSha256: digest, state: 'seed_intent' }));
      fs.fsyncSync(fd);
      await updateById(requestId, { wmkf_abstract: abstract }, { expectedOrigin: origin, ifMatch: row._etag, noFallback: true });
      const after = await getById(requestId, options);
      if (after.wmkf_abstract !== abstract || after.wmkf_wmkfprojectdescription !== row.wmkf_wmkfprojectdescription
        || after.akoya_title !== row.akoya_title) throw Error('seed_readback_mismatch');
      console.log(JSON.stringify({ requestId, abstractSha256: digest, state: 'verified' }));
    } finally { fs.closeSync(fd); }
  });
})().catch(() => { console.error('Seed stopped; inspect read-only before any further mutation. Do not rerun.'); process.exitCode = 1; });

```

## Review closure

Opus 5.5 reviewed the packet twice through subscription OAuth, tools disabled.
Initial packet SHA-256 `9d24b171b6f634763410069974e31cfee7e1246c1fb8b0baca18ea9ce31ecfe1`.
Closure packet SHA-256 `cffadbfeed33ab1280737d204df29e22c6c697c01b0c23e3d826f3ad6e5c6931`.
Final verdict: GO with the condition to pin the abstract seed. Root closed that
condition with the exact snippet above (Sandbox/interlock pins, factory identity,
blank checks for both named fields, abstract hash, concrete If-Match, one PATCH,
exclusive intent receipt, exact readback, no retry). It passed Node syntax checking;
no seed call was made. The loader passed the real Factory CLI help load and ESLint.
Documentation/fact/secret gates passed. Do not represent these checks as a live trial.
No additional review cycle is needed for this named closure.
