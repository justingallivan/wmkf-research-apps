#!/usr/bin/env node

/** Additive D26 Proposal Ranking grants and verified default facilitator. */
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { sql } from '@vercel/postgres';
import { RESEARCH_PROGRAM_IDS } from '../shared/config/researchPrograms.js';
import { PHASE_II_PENDING } from '../shared/config/workbenchVisibility.js';
import { TEST_REQUEST_ORDINARY_OData_FILTER } from '../lib/services/test-requests/isolation.js';
import { applyProposalRankingTrialCutoff } from '../lib/services/proposal-ranking/trial-cutoff.js';
import { cycleCodeToOdataFilter } from '../lib/utils/cycle-code.js';
import { classifyDeployment, classifyTarget, resolveInterlockMode } from '../lib/dataverse/core/interlock.js';
import { PRODUCTION_HOSTS } from '../lib/dataverse/core/target-registry.js';
import { enterDynamicsBypassForScript } from '../lib/services/dynamics-context.js';
import { eq } from '../lib/dataverse/core/odata.js';

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
const { grantApps, listAllGrantsForAdmin } = require('../lib/services/app-access-service.js');
const { resolveSystemUserToProfile } = require('../lib/services/dataverse-identity-map.js');
const { readDefaultFacilitator, saveDefaultFacilitator } = await import('../lib/services/proposal-ranking/config.js');

const EXPECTED_REQUEST_COUNT = 23;
const FACILITATOR_NAME = 'Beth Pruitt';
const APP_KEY = 'proposal-ranking';
const PAGE_LIMIT = 100;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_SELECT = [
  'akoya_requestid', 'akoya_requestnum', 'wmkf_meetingdate', 'akoya_requeststatus',
  'wmkf_istestrequest', 'wmkf_testcreationrunid', '_akoya_programid_value',
  '_wmkf_programdirector_value',
].join(',');

export function isSystemUserGuid(value) {
  return typeof value === 'string' && GUID.test(value);
}

export function parseArgs(argv) {
  const args = { apply: false, expectedRosterHash: null };
  for (const arg of argv.slice(2)) {
    if (arg === '--target=production') args.target = 'production';
    else if (arg === '--apply') args.apply = true;
    else if (arg.startsWith('--expected-roster-sha256=')) args.expectedRosterHash = arg.slice('--expected-roster-sha256='.length);
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.help && args.target !== 'production') throw new Error('Pass exactly --target=production.');
  if (args.apply && !/^[a-f0-9]{64}$/i.test(args.expectedRosterHash || '')) {
    throw new Error('--apply requires --expected-roster-sha256 from the reviewed dry-run.');
  }
  if (!args.apply && args.expectedRosterHash) throw new Error('The roster hash is accepted only with --apply.');
  return args;
}

function fail(code) {
  throw new Error(code);
}

async function getCollection(client, resourceUrl, path) {
  let next = path;
  let pages = 0;
  const rows = [];
  while (next && pages < PAGE_LIMIT) {
    const url = new URL(next, resourceUrl);
    if (url.origin !== resourceUrl || url.pathname !== '/api/data/v9.2/akoya_requests') {
      fail('unexpected_source_continuation');
    }
    const response = await client.get(url.href);
    if (!response.ok || !Array.isArray(response.body?.value)) fail(`source_scan_failed_${response.status || 'unknown'}`);
    rows.push(...response.body.value);
    next = response.body['@odata.nextLink'] || null;
    pages += 1;
  }
  if (next) fail('source_scan_capped');
  return rows;
}

async function exactSystemUser(client, id) {
  if (!isSystemUserGuid(id)) fail('invalid_system_user_id');
  const result = await client.get(`/systemusers(${id})?$select=systemuserid,fullname,isdisabled,accessmode,applicationid`);
  if (!result.ok) fail(`system_user_read_failed_${result.status || 'unknown'}`);
  const user = result.body || {};
  if (String(user.systemuserid || '').toLowerCase() !== String(id).toLowerCase()
    || user.isdisabled !== false || user.accessmode !== 0 || user.applicationid) {
    fail('system_user_is_not_enabled_staff');
  }
  return {
    systemUserId: String(user.systemuserid).toLowerCase(),
    name: String(user.fullname || ''),
  };
}

async function verifyProfileMapping(systemUser) {
  const { rows } = await sql`
    SELECT id, name, is_active, needs_linking, dynamics_systemuser_id
    FROM user_profiles
    WHERE dynamics_systemuser_id = ${systemUser.systemUserId}
      AND is_active = true
    LIMIT 2
  `;
  if (!Array.isArray(rows) || rows.length !== 1) fail('active_profile_mapping_missing_or_ambiguous');
  const profile = validateProfileMapping(rows, await resolveSystemUserToProfile(systemUser.systemUserId), systemUser.systemUserId);
  return profile;
}

export function validateProfileMapping(rows, reverseProfileId, systemUserId) {
  if (!Array.isArray(rows) || rows.length !== 1) fail('active_profile_mapping_missing_or_ambiguous');
  const profile = rows[0];
  const profileId = Number(profile.id);
  if (!Number.isSafeInteger(profileId) || profile.is_active !== true || profile.needs_linking === true
    || String(profile.dynamics_systemuser_id || '').toLowerCase() !== systemUserId) {
    fail('active_profile_mapping_invalid');
  }
  if (Number(reverseProfileId) !== profileId) fail('canonical_profile_mapping_disagrees');
  return { profileId, profileName: String(profile.name || '') };
}

async function resolveFacilitator(client) {
  const filter = eq('fullname', FACILITATOR_NAME);
  const result = await client.get(`/systemusers?$select=systemuserid,fullname&$filter=${encodeURIComponent(filter)}&$top=2`);
  const matches = result.body?.value;
  if (!result.ok || !Array.isArray(matches) || matches.length !== 1 || result.body?.['@odata.nextLink']) {
    fail('facilitator_identity_not_unique');
  }
  const user = await exactSystemUser(client, matches[0].systemuserid);
  if (user.name !== FACILITATOR_NAME) fail('facilitator_name_mismatch');
  const profile = await verifyProfileMapping(user);
  return { ...user, ...profile };
}

export function rosterFingerprint(rows, participants, facilitator) {
  const canonical = rows.map((row) => [
    String(row.akoya_requestid || '').toLowerCase(),
    String(row.akoya_requestnum || ''),
    String(row.wmkf_meetingdate || ''),
    String(row._akoya_programid_value || '').toLowerCase(),
    String(row._wmkf_programdirector_value || '').toLowerCase(),
  ]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const mappedParticipants = participants
    .map(({ systemUserId, profileId }) => [systemUserId, profileId])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const resolved = {
    requests: canonical,
    participants: mappedParticipants,
    facilitator: [facilitator.systemUserId, facilitator.profileId],
  };
  return crypto.createHash('sha256').update(JSON.stringify(resolved)).digest('hex');
}

async function buildPlan(client, resourceUrl) {
  const cycleFilter = cycleCodeToOdataFilter('D26', 'wmkf_meetingdate');
  const programFilter = RESEARCH_PROGRAM_IDS.map((id) => `_akoya_programid_value eq ${id}`).join(' or ');
  const filter = `(${cycleFilter}) and (${programFilter}) and akoya_requeststatus eq '${PHASE_II_PENDING}' and ${TEST_REQUEST_ORDINARY_OData_FILTER}`;
  const path = `/api/data/v9.2/akoya_requests?$select=${REQUEST_SELECT}&$filter=${encodeURIComponent(filter)}&$orderby=akoya_requestnum asc,akoya_requestid asc`;
  const scanned = await getCollection(client, resourceUrl, path);
  const { requests, excludedRequestCount } = applyProposalRankingTrialCutoff(scanned);
  if (requests.some((row) => row.akoya_requeststatus !== PHASE_II_PENDING)) fail('unexpected_request_status');
  if (requests.length !== EXPECTED_REQUEST_COUNT) fail(`eligible_request_count_${requests.length}_expected_${EXPECTED_REQUEST_COUNT}`);
  if (requests.some((row) => !row._wmkf_programdirector_value)) fail('eligible_request_missing_program_director');

  const byId = new Map();
  for (const row of requests) {
    const id = String(row._wmkf_programdirector_value).toLowerCase();
    byId.set(id, id);
  }
  if (!byId.size) fail('empty_participant_roster');

  const participantUsers = [];
  for (const systemUserId of [...byId.keys()].sort()) {
    const user = await exactSystemUser(client, systemUserId);
    const profile = await verifyProfileMapping(user);
    participantUsers.push({ ...user, ...profile });
  }
  const profileIds = participantUsers.map((item) => item.profileId);
  if (new Set(profileIds).size !== profileIds.length) fail('participant_profile_mapping_ambiguous');

  const facilitator = await resolveFacilitator(client);
  const allTargets = new Map([...participantUsers, facilitator].map((item) => [item.systemUserId, item]));
  const targets = [...allTargets.values()].sort((a, b) => a.systemUserId.localeCompare(b.systemUserId));
  if (new Set(targets.map((item) => item.profileId)).size !== targets.length) {
    // Beth may also be a participant, in which case Map de-duplication above
    // leaves one target. Distinct system users may never share one profile.
    fail('target_profile_mapping_ambiguous');
  }

  const grants = await listAllGrantsForAdmin({ throwOnError: true });
  const activeProfiles = new Map(grants.map((row) => [Number(row.user_profile_id), row]));
  for (const target of targets) {
    const active = activeProfiles.get(target.profileId);
    if (!active || active.user_name !== target.profileName) fail('profile_not_in_active_grant_directory');
    target.hasProposalRanking = active.apps.includes(APP_KEY);
    target.otherAppGrantCount = active.apps.filter((app) => app !== APP_KEY).length;
  }
  const facilitatorSetting = await readDefaultFacilitator();
  const distribution = {
    se: requests.filter((row) => String(row._akoya_programid_value || '').toLowerCase() === RESEARCH_PROGRAM_IDS[0]).length,
    mr: requests.filter((row) => String(row._akoya_programid_value || '').toLowerCase() === RESEARCH_PROGRAM_IDS[1]).length,
  };
  if (distribution.se + distribution.mr !== requests.length) fail('unknown_program_in_roster');
  return {
    requestCount: requests.length,
    scannedRequestCount: scanned.length,
    excludedByTrialCutoff: excludedRequestCount,
    distribution,
    rosterHash: rosterFingerprint(requests, participantUsers, facilitator),
    participants: participantUsers,
    facilitator,
    targets,
    facilitatorChangeRequired: facilitatorSetting.systemUserId !== facilitator.systemUserId,
    currentFacilitatorSystemUserId: facilitatorSetting.systemUserId,
    facilitatorRevision: facilitatorSetting.revision,
  };
}

function printPlan(plan, mode, target) {
  console.log(JSON.stringify({
    target,
    mode,
    activationChanged: false,
    requestRowsPrinted: false,
    scannedRequestCount: plan.scannedRequestCount,
    eligibleD26RequestCount: plan.requestCount,
    excludedByTrialCutoff: plan.excludedByTrialCutoff,
    programCounts: plan.distribution,
    rosterSha256: plan.rosterHash,
    facilitator: {
      systemUserId: plan.facilitator.systemUserId,
      profileId: plan.facilitator.profileId,
      profileName: plan.facilitator.profileName,
      verifiedName: plan.facilitator.name,
      settingChangeRequired: plan.facilitatorChangeRequired,
    },
    participants: plan.participants.map(({ systemUserId, profileId, profileName, name, hasProposalRanking, otherAppGrantCount }) => ({
      systemUserId, profileId, profileName, name, hasProposalRanking, otherAppGrantCount,
    })),
    targetGrants: plan.targets.map(({ systemUserId, profileId, profileName, name, hasProposalRanking, otherAppGrantCount }) => ({
      systemUserId, profileId, profileName, name, hasProposalRanking, otherAppGrantCount,
    })),
    currentFacilitatorSystemUserId: plan.currentFacilitatorSystemUserId,
  }, null, 2));
}

async function applyPlan(plan) {
  for (const target of plan.targets) {
    const result = await grantApps(target.profileId, [APP_KEY], null);
    const success = !result.error && (result.granted.includes(APP_KEY) || target.hasProposalRanking);
    console.log(JSON.stringify({ operation: 'grant', systemUserId: target.systemUserId, profileId: target.profileId, granted: success }));
    if (!success) fail('participant_grant_failed');
  }
  const grantsAfter = await listAllGrantsForAdmin({ throwOnError: true });
  const byProfileAfter = new Map(grantsAfter.map((row) => [Number(row.user_profile_id), row]));
  if (plan.targets.some((target) => !byProfileAfter.get(target.profileId)?.apps?.includes(APP_KEY))) {
    fail('grant_readback_failed_facilitator_setting_not_changed');
  }
  if (plan.facilitatorChangeRequired) {
    await saveDefaultFacilitator(plan.facilitator.systemUserId, plan.facilitatorRevision, null);
  }
  const settingAfter = await readDefaultFacilitator();
  if (settingAfter.systemUserId !== plan.facilitator.systemUserId) fail('facilitator_setting_readback_failed');
  console.log(JSON.stringify({ operation: 'facilitator-setting', verified: true, systemUserId: settingAfter.systemUserId }));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: node scripts/configure-proposal-ranking-d26-access.mjs --target=production [--apply --expected-roster-sha256=<dry-run-hash>]');
    return;
  }
  loadEnvLocal();
  if (classifyDeployment() !== 'local') fail('local_operator_process_required');
  if (resolveInterlockMode() !== 'on') fail('DATAVERSE_TARGET_INTERLOCK_must_be_on');
  if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') fail('DATAVERSE_ALLOW_PROD_READS_must_be_yes');
  if (PRODUCTION_HOSTS.length !== 1) fail('production_registry_ambiguous');
  const resourceUrl = `https://${PRODUCTION_HOSTS[0]}`;
  if (classifyTarget(resourceUrl) !== 'production') fail('registered_production_target_required');
  if (args.apply && (!args.expectedRosterHash || !/^[a-f0-9]{64}$/i.test(args.expectedRosterHash))) fail('reviewed_dry_run_hash_required');

  // Existing app-access/settings helpers select DYNAMICS_SANDBOX_URL first.
  // Pin this process to the explicitly selected Production target; no feature
  // readiness or activation flag is read or changed by this script.
  process.env.DYNAMICS_URL = resourceUrl;
  delete process.env.DYNAMICS_SANDBOX_URL;
  enterDynamicsBypassForScript('configure-proposal-ranking-d26-access');
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
  const plan = await buildPlan(client, resourceUrl);
  printPlan(plan, args.apply ? 'apply-preflight' : 'dry-run', new URL(resourceUrl).hostname);

  if (!args.apply) {
    if (plan.requestCount !== EXPECTED_REQUEST_COUNT) process.exitCode = 2;
    return;
  }
  if (plan.requestCount !== EXPECTED_REQUEST_COUNT) fail('eligible_roster_changed');
  if (plan.rosterHash.toLowerCase() !== args.expectedRosterHash.toLowerCase()) fail('eligible_roster_does_not_match_reviewed_dry_run');
  await applyPlan(plan);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Proposal Ranking D26 access command failed (${error?.name || 'Error'}): ${error?.message || 'unknown error'}`);
    process.exitCode = 1;
  });
}
