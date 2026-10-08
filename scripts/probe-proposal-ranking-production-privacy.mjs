#!/usr/bin/env node
'use strict';

/**
 * GET-only Production privacy probe for Proposal Ranking.
 * Staff IDs must come from an already verified roster; this script never
 * discovers staff, reads ranking records, or performs writes.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { PRODUCTION_HOSTS } from '../lib/dataverse/core/target-registry.js';
import { classifyTarget, resolveInterlockMode } from '../lib/dataverse/core/interlock.js';

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLES = Object.freeze([
  { entitySet: 'wmkf_proposalrankingcycles', logicalName: 'wmkf_proposalrankingcycle', primaryId: 'wmkf_proposalrankingcycleid' },
  { entitySet: 'wmkf_proposalrankingrounds', logicalName: 'wmkf_proposalrankinground', primaryId: 'wmkf_proposalrankingroundid' },
  { entitySet: 'wmkf_proposalrankinglists', logicalName: 'wmkf_proposalrankinglist', primaryId: 'wmkf_proposalrankinglistid' },
]);
const equalUserIdPath = "/systemusers?$select=systemuserid&$filter=Microsoft.Dynamics.CRM.EqualUserId(PropertyName=@p1)&@p1='systemuserid'";

function parseArgs(argv) {
  if (argv.slice(2).some((arg) => arg === '--help' || arg === '-h')) return { help: true, staffIds: [] };
  const staffArguments = argv.slice(2).filter((arg) => arg.startsWith('--staff-ids='));
  if (staffArguments.length !== 1) throw new Error('Provide exactly one --staff-ids=GUID,GUID argument using IDs from the verified roster.');
  const [raw] = staffArguments;
  const values = raw.slice('--staff-ids='.length).split(',').map((value) => value.trim());
  if (!values.length || values.some((id) => !GUID.test(id))) throw new Error('--staff-ids must be a comma-separated list of GUIDs.');
  if (new Set(values.map((id) => id.toLowerCase())).size !== values.length) throw new Error('--staff-ids contains duplicate IDs.');
  for (const arg of argv.slice(2)) {
    if (arg === '--help' || arg === '-h') return { help: true, staffIds: [] };
    if (!arg.startsWith('--staff-ids=')) throw new Error(`Unknown option: ${arg.split('=')[0]}`);
  }
  return { staffIds: values.map((id) => id.toLowerCase()) };
}

function parseSearchStatus(body) {
  let payload;
  try { payload = typeof body?.response === 'string' ? JSON.parse(body.response) : body?.response; }
  catch { return { status: 'unverified', rankingEntityStatusListed: null, rankingTablesAbsentFromSearchStatus: null }; }
  const value = payload?.value;
  const status = typeof value?.status === 'string' ? value.status : 'unverified';
  const entries = Array.isArray(value?.entitystatusresults) ? value.entitystatusresults : null;
  if (!entries) return { status, rankingEntityStatusListed: null, rankingTablesAbsentFromSearchStatus: null };
  const names = new Set(entries.map((entry) => String(entry?.entitylogicalname || '').toLowerCase()));
  const listed = Object.fromEntries(TABLES.map(({ logicalName }) => [logicalName, names.has(logicalName)]));
  return {
    status,
    rankingEntityStatusListed: listed,
    rankingTablesAbsentFromSearchStatus: status === 'provisioned' && Object.values(listed).every((present) => !present),
  };
}

async function get(client, requestPath, headers) {
  const response = await client.get(requestPath, headers);
  return { ok: response.ok, status: response.status, body: response.body || null };
}

async function readAppRankingCollections(client) {
  const result = {};
  for (const table of TABLES) {
    const response = await get(client, `/${table.entitySet}?$select=${table.primaryId}&$top=1`);
    result[table.logicalName] = {
      status: response.status,
      rowCount: response.ok && Array.isArray(response.body?.value) ? response.body.value.length : null,
      noRows: response.ok && Array.isArray(response.body?.value) && response.body.value.length === 0,
    };
  }
  return result;
}

function completePrivileges(rows) {
  return Array.isArray(rows) && rows.length > 0
    && rows.every((item) => typeof item?.PrivilegeName === 'string' && item.PrivilegeName.trim().length > 0);
}

async function inspectStaff(client, id, index, appUserId) {
  const label = `staff${index + 1}`;
  const result = {
    label,
    systemUserIdValid: GUID.test(id),
    systemUserStatus: null,
    systemUserMatchesRequestedId: false,
    enabled: false,
    accessMode0: false,
    nonApplicationUser: false,
    azureObjectIdValid: false,
    effectiveIdentityVerified: false,
    effectiveIdentityStatus: null,
    privilegeListComplete: false,
    privilegeStatus: null,
    privilegeCount: null,
    rankingReadPrivilegesAbsent: false,
    rankingCollectionReads: {},
    passed: false,
  };
  const user = await get(client,
    `/systemusers(${id})?$select=systemuserid,isdisabled,accessmode,applicationid,azureactivedirectoryobjectid`);
  const row = user.body || {};
  const exact = String(row.systemuserid || '').toLowerCase() === id;
  result.systemUserStatus = user.status;
  result.systemUserMatchesRequestedId = user.ok && exact;
  result.enabled = user.ok && exact && row.isdisabled === false;
  result.accessMode0 = user.ok && exact && row.accessmode === 0;
  result.nonApplicationUser = user.ok && exact && (row.applicationid === null || row.applicationid === undefined || row.applicationid === '');
  const objectId = String(row.azureactivedirectoryobjectid || '').toLowerCase();
  result.azureObjectIdValid = user.ok && exact && GUID.test(objectId);
  if (!result.enabled || !result.accessMode0 || !result.nonApplicationUser || !result.azureObjectIdValid) return result;

  const identity = await get(client, equalUserIdPath, { CallerObjectId: objectId });
  const identities = identity.body?.value;
  result.effectiveIdentityStatus = identity.status;
  result.effectiveIdentityVerified = identity.ok && Array.isArray(identities) && identities.length === 1
    && String(identities[0]?.systemuserid || '').toLowerCase() === id
    && id !== appUserId;
  if (!result.effectiveIdentityVerified) return result;

  const privileges = await get(client, `/systemusers(${id})/Microsoft.Dynamics.CRM.RetrieveUserPrivileges`, { CallerObjectId: objectId });
  const privilegeRows = privileges.body?.RolePrivileges;
  result.privilegeStatus = privileges.status;
  result.privilegeCount = Array.isArray(privilegeRows) ? privilegeRows.length : null;
  result.privilegeListComplete = privileges.ok && completePrivileges(privilegeRows);
  if (result.privilegeListComplete) {
    const names = new Set(privilegeRows.map((item) => item.PrivilegeName.toLowerCase()));
    result.rankingReadPrivilegesAbsent = TABLES.every(({ logicalName }) => !names.has(`prvread${logicalName}`));
  }
  if (!result.privilegeListComplete || !result.rankingReadPrivilegesAbsent) return result;

  for (const table of TABLES) {
    const response = await get(client,
      `/${table.entitySet}?$select=${table.primaryId}&$top=1`, { CallerObjectId: objectId });
    result.rankingCollectionReads[table.logicalName] = {
      status: response.status,
      rowCount: response.ok && Array.isArray(response.body?.value) ? response.body.value.length : null,
      denied: response.status === 403,
    };
  }
  const allRankingCollectionsDenied = TABLES.every(({ logicalName }) => result.rankingCollectionReads[logicalName]?.denied);
  result.passed = result.effectiveIdentityVerified && result.privilegeListComplete
    && result.rankingReadPrivilegesAbsent && allRankingCollectionsDenied;
  return result;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: DATAVERSE_TARGET_INTERLOCK=on DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-proposal-ranking-production-privacy.mjs --staff-ids=GUID,GUID');
    return;
  }
  loadEnvLocal();
  if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') throw new Error('Production reads require DATAVERSE_ALLOW_PROD_READS=yes.');
  if (resolveInterlockMode() !== 'on') throw new Error('DATAVERSE_TARGET_INTERLOCK must be explicitly on.');
  if (PRODUCTION_HOSTS.length !== 1) throw new Error('Production target registry must contain exactly one host.');
  const resourceUrl = `https://${PRODUCTION_HOSTS[0]}`;
  if (classifyTarget(resourceUrl) !== 'production') throw new Error('Pinned target is not classified as registered Production.');
  const token = await getAccessToken(resourceUrl);
  const client = createClient({ resourceUrl, token });

  const appWhoAmI = await get(client, '/WhoAmI');
  const appUserId = String(appWhoAmI.body?.UserId || '').toLowerCase();
  const appIdentity = {
    status: appWhoAmI.status,
    valid: appWhoAmI.ok && GUID.test(appUserId),
  };
  if (!appIdentity.valid) throw new Error('Application identity could not be verified.');
  const appRankingCollections = await readAppRankingCollections(client);
  const searchStatusResponse = await get(client, '/searchstatus');
  const searchStatus = searchStatusResponse.ok
    ? { httpStatus: searchStatusResponse.status, ...parseSearchStatus(searchStatusResponse.body) }
    : { httpStatus: searchStatusResponse.status, status: 'unverified', rankingEntityStatusListed: null, rankingTablesAbsentFromSearchStatus: null };
  const staff = [];
  for (let i = 0; i < args.staffIds.length; i += 1) staff.push(await inspectStaff(client, args.staffIds[i], i, appUserId));

  const result = {
    target: new URL(resourceUrl).hostname,
    mode: 'GET-only',
    appIdentity,
    appRankingCollections,
    searchStatus,
    staff,
    passed: Object.values(appRankingCollections).every((entry) => entry.status === 200 && entry.noRows)
      && searchStatus.status === 'provisioned' && searchStatus.rankingTablesAbsentFromSearchStatus === true
      && staff.length > 0 && staff.every((entry) => entry.passed),
    completedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('FATAL: Production Proposal Ranking privacy probe failed closed; details omitted.');
    process.exitCode = 1;
  });
}

export { inspectStaff, parseArgs, parseSearchStatus, readAppRankingCollections };
