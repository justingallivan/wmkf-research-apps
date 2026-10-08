#!/usr/bin/env node
'use strict';

/**
 * GET-only privacy proof for retained Proposal Ranking rehearsal rows.
 * Requires the existing sandbox OAuth variables; it never writes Dataverse.
 */

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const requireFromHere = createRequire(__filename);
const { loadEnvLocal, getAccessToken, createClient } = requireFromHere('../lib/dataverse/client.js');

const SANDBOX_URL = 'https://orgd9e66399.crm.dynamics.com';
const DEFAULT_PERSISTENCE_RECEIPT = '/private/tmp/proposal-ranking-persistence-rehearsal.json';
const DEFAULT_OUTPUT = '/private/tmp/proposal-ranking-privacy-repro.json';
const ENTITY_ROWS = Object.freeze({
  cycle: { set: 'wmkf_proposalrankingcycles', id: 'wmkf_proposalrankingcycleid', logicalName: 'wmkf_proposalrankingcycle' },
  round: { set: 'wmkf_proposalrankingrounds', id: 'wmkf_proposalrankingroundid', logicalName: 'wmkf_proposalrankinground' },
  list: { set: 'wmkf_proposalrankinglists', id: 'wmkf_proposalrankinglistid', logicalName: 'wmkf_proposalrankinglist' },
});
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
  const args = { receiptPath: DEFAULT_PERSISTENCE_RECEIPT, outputPath: DEFAULT_OUTPUT };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--receipt=')) args.receiptPath = arg.slice('--receipt='.length);
    else if (arg.startsWith('--output=')) args.outputPath = arg.slice('--output='.length);
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  for (const key of ['receiptPath', 'outputPath']) {
    const resolved = path.resolve(args[key]);
    if (!resolved.startsWith('/private/tmp/')) throw new Error(`${key} must be under /private/tmp.`);
    args[key] = resolved;
  }
  return args;
}

function readFixtureReceipt(receipt) {
  if (!receipt || receipt.target !== new URL(SANDBOX_URL).hostname || receipt.cycleCode !== 'D99' || receipt.result !== 'verified-persistence') {
    throw new Error('The input is not a completed rehearsal receipt for the registered sandbox.');
  }
  const staffUserId = receipt.staffRead?.candidateSystemUserId;
  if (!GUID.test(staffUserId || '')) throw new Error('The rehearsal receipt has no valid staff candidate ID.');
  const retained = receipt.retained || {};
  const fixtureIds = {};
  for (const [key, spec] of Object.entries(ENTITY_ROWS)) {
    const id = retained[`${key}Id`];
    if (!GUID.test(id || '')) throw new Error(`The rehearsal receipt has no valid retained ${key} ID.`);
    fixtureIds[key] = id.toLowerCase();
    if (!spec.set || !spec.id || !spec.logicalName) throw new Error('Invalid code-owned table definition.');
  }
  return { staffUserId: staffUserId.toLowerCase(), fixtureIds };
}

function effectiveUserMatches(rows, expectedUserId, appUserId) {
  if (!Array.isArray(rows) || rows.length !== 1) return false;
  const rowId = String(rows[0]?.systemuserid || '').toLowerCase();
  return rowId === expectedUserId.toLowerCase() && rowId !== appUserId.toLowerCase();
}

function exactFixtureReadDenied(status) {
  return status === 403;
}

function hasCompletePrivilegeList(rolePrivileges) {
  return Array.isArray(rolePrivileges) && rolePrivileges.length > 0
    && rolePrivileges.every((privilege) => typeof privilege?.PrivilegeName === 'string' && privilege.PrivilegeName.trim().length > 0);
}

function privilegeNamesPresent(rolePrivileges) {
  const names = new Set((Array.isArray(rolePrivileges) ? rolePrivileges : [])
    .map((privilege) => String(privilege?.PrivilegeName || '').toLowerCase()));
  return Object.fromEntries(Object.values(ENTITY_ROWS).map(({ logicalName }) => {
    const name = `prvRead${logicalName}`;
    return [name, names.has(name.toLowerCase())];
  }));
}

function safeCode(result) {
  const code = result?.body?.error?.code;
  return typeof code === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(code) ? code : null;
}

async function getResult(client, requestPath, headers) {
  const result = await client.get(requestPath, headers);
  return { ok: result.ok, status: result.status, body: result.body || null, code: safeCode(result) };
}

async function run() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: node scripts/probe-proposal-ranking-staff-privacy.js [--receipt=/private/tmp/persistence.json] [--output=/private/tmp/privacy.json]');
    return;
  }
  loadEnvLocal();
  process.env.DYNAMICS_URL = SANDBOX_URL;
  if (process.env.DATAVERSE_TARGET_INTERLOCK !== 'on') throw new Error('DATAVERSE_TARGET_INTERLOCK must be explicitly on.');
  const { classifyTarget } = requireFromHere('../lib/dataverse/core/interlock.js');
  if (classifyTarget(SANDBOX_URL) !== 'sandbox') throw new Error('The pinned host is not classified as a registered sandbox.');

  const receipt = JSON.parse(fs.readFileSync(args.receiptPath, 'utf8'));
  const fixture = readFixtureReceipt(receipt);
  const token = await getAccessToken(SANDBOX_URL);
  const client = createClient({ resourceUrl: SANDBOX_URL, token });

  const appWhoAmI = await getResult(client, '/WhoAmI');
  const appUserId = String(appWhoAmI.body?.UserId || '').toLowerCase();
  if (!appWhoAmI.ok || !GUID.test(appUserId)) throw new Error('Sandbox app identity could not be verified.');

  const baselineRows = {};
  for (const [key, spec] of Object.entries(ENTITY_ROWS)) {
    const result = await getResult(client, `/${spec.set}(${fixture.fixtureIds[key]})?$select=${spec.id}`);
    baselineRows[key] = {
      status: result.status,
      idMatched: String(result.body?.[spec.id] || '').toLowerCase() === fixture.fixtureIds[key],
      code: result.code,
    };
  }
  const baselinePassed = Object.values(baselineRows).every((row) => row.status === 200 && row.idMatched);

  const staff = await getResult(client,
    `/systemusers(${fixture.staffUserId})?$select=systemuserid,isdisabled,accessmode,applicationid,azureactivedirectoryobjectid`);
  const staffRow = staff.body || {};
  const objectId = String(staffRow.azureactivedirectoryobjectid || '').toLowerCase();
  if (!staff.ok || String(staffRow.systemuserid || '').toLowerCase() !== fixture.staffUserId
    || staffRow.isdisabled !== false || staffRow.accessmode !== 0 || staffRow.applicationid
    || !GUID.test(objectId)) {
    throw new Error('The recorded staff candidate did not pass the identity, enabled, non-application preflight.');
  }

  const equalUserIdPath = "/systemusers?$select=systemuserid&$filter=Microsoft.Dynamics.CRM.EqualUserId(PropertyName=@p1)&@p1='systemuserid'";
  const identity = await getResult(client, equalUserIdPath, { CallerObjectId: objectId });
  const identityRows = identity.body?.value;
  const identityVerified = identity.ok && effectiveUserMatches(identityRows, fixture.staffUserId, appUserId);

  const privileges = await getResult(client,
    `/systemusers(${fixture.staffUserId})/Microsoft.Dynamics.CRM.RetrieveUserPrivileges`);
  const customReadPrivilegePresent = privilegeNamesPresent(privileges.body?.RolePrivileges);
  const privilegeProofAvailable = privileges.ok && hasCompletePrivilegeList(privileges.body?.RolePrivileges);
  const noCustomReadPrivileges = privilegeProofAvailable && Object.values(customReadPrivilegePresent).every((present) => !present);

  const impersonatedRows = {};
  if (identityVerified && baselinePassed) {
    for (const [key, spec] of Object.entries(ENTITY_ROWS)) {
      const result = await getResult(client,
        `/${spec.set}(${fixture.fixtureIds[key]})?$select=${spec.id}`,
        { CallerObjectId: objectId });
      impersonatedRows[key] = { status: result.status, denied: exactFixtureReadDenied(result.status), code: result.code };
    }
  }
  const deniedAll = Object.keys(ENTITY_ROWS).length === Object.keys(impersonatedRows).length
    && Object.values(impersonatedRows).every((row) => row.denied);
  const result = {
    target: new URL(SANDBOX_URL).hostname,
    receiptPath: args.receiptPath,
    appBaseline: { whoAmIStatus: appWhoAmI.status, fixtureRows: baselineRows, passed: baselinePassed },
    staff: {
      systemUserId: fixture.staffUserId,
      enabled: staffRow.isdisabled === false,
      accessMode: staffRow.accessmode,
      applicationIdPresent: Boolean(staffRow.applicationid),
      effectivePrivilegeReadStatus: privileges.status,
      effectivePrivilegeCount: Array.isArray(privileges.body?.RolePrivileges) ? privileges.body.RolePrivileges.length : null,
      effectivePrivilegeProofAvailable: privilegeProofAvailable,
      customReadPrivilegePresent,
      noCustomReadPrivileges,
    },
    impersonation: {
      header: 'CallerObjectId',
      equalUserIdStatus: identity.status,
      selectedStaffIdentityVerified: identityVerified,
      whoAmIUsedForImpersonationCheck: false,
      fixtureRows: impersonatedRows,
      allFixtureReadsDenied: deniedAll,
    },
    proofPassed: baselinePassed && identityVerified && noCustomReadPrivileges && deniedAll,
    completedAt: new Date().toISOString(),
  };
  fs.writeFileSync(args.outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
  console.log(`sanitizedReceipt=${args.outputPath}`);
  if (!result.proofPassed) process.exitCode = 1;
}

if (require.main === module) {
  run().catch((error) => {
    const status = Number.isInteger(error?.status) ? `HTTP ${error.status}` : 'preflight failed';
    console.error(`FATAL: Proposal Ranking privacy proof ${status}; details omitted.`);
    process.exitCode = 1;
  });
}

module.exports = {
  run,
  parseArgs,
  readFixtureReceipt,
  effectiveUserMatches,
  exactFixtureReadDenied,
  hasCompletePrivilegeList,
  privilegeNamesPresent,
};
