#!/usr/bin/env node
/**
 * Read-only Production preflight for the Final Writeup persona-team rollout.
 *
 * The acknowledgement security role defines the eligible staff roster. PD and
 * PC candidates come only from exact akoya_request system-user lookups;
 * leadership remains owner-attested and is deliberately not inferred here.
 * Exact team names are inspected for collision detection, but runtime persona
 * resolution continues to use pinned team GUIDs only.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/preflight-final-writeup-persona-teams.mjs
 */

import { loadEnvLocal } from '../lib/dataverse/client.js';

loadEnvLocal();

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const systemUserAdapter = await import('../lib/dataverse/adapters/system-user.js');
const {
  FINAL_WRITEUP_PERSONA_TEAMS,
  FINAL_WRITEUP_REVIEWER_ROLE_NAME,
} = await import('../shared/config/finalWriteupPersonas.js');

const esc = (value) => String(value).replace(/'/g, "''");
const normalize = (value) => String(value || '').trim().toLowerCase();

function relationshipSummary(records, systemUserId) {
  const id = normalize(systemUserId);
  const pd = records.filter((row) => normalize(row._wmkf_programdirector_value) === id);
  const pc = records.filter((row) => normalize(row._wmkf_programcoordinator_value) === id);
  const summarizeRecent = (rows, relationship) => [...rows]
    .sort((left, right) => String(right.modifiedon || '').localeCompare(String(left.modifiedon || '')))
    .slice(0, 3)
    .map((row) => ({
      requestNumber: row.akoya_requestnum || null,
      fiscalYear: row.akoya_fiscalyear || null,
      status: row.akoya_requeststatus || null,
      modifiedOn: row.modifiedon || null,
      relationship,
    }));
  return {
    pdCount: pd.length,
    pcCount: pc.length,
    pdRecent: summarizeRecent(pd, 'PD'),
    pcRecent: summarizeRecent(pc, 'PC'),
  };
}

await bypassDynamicsRestrictions('preflight-final-writeup-persona-teams', async () => {
  const rosterResult = await systemUserAdapter.listEnabledBySecurityRoleName(
    FINAL_WRITEUP_REVIEWER_ROLE_NAME,
    { top: 50 },
  );
  if (rosterResult.totalCount !== rosterResult.records.length) {
    throw new Error('Reviewer-role roster was truncated; refusing a partial preflight.');
  }

  const exactNames = FINAL_WRITEUP_PERSONA_TEAMS.map((spec) => spec.teamName);
  const teamFilter = exactNames.map((name) => `name eq '${esc(name)}'`).join(' or ');
  const teamResult = await DynamicsService.queryRecords('teams', {
    select: 'teamid,name,teamtype,isdefault,_businessunitid_value',
    filter: teamFilter,
    orderby: 'name asc',
    top: 20,
  });
  if (teamResult.totalCount !== teamResult.records.length) {
    throw new Error('Exact-name team lookup was truncated; refusing a partial preflight.');
  }

  const relationships = [];
  for (const user of rosterResult.records) {
    const id = normalize(user.systemuserid);
    const result = await DynamicsService.queryAllRecords('akoya_requests', {
      select: [
        'akoya_requestid',
        'akoya_requestnum',
        'akoya_fiscalyear',
        'akoya_requeststatus',
        'modifiedon',
        '_wmkf_programdirector_value',
        '_wmkf_programcoordinator_value',
      ].join(','),
      filter: `_wmkf_programdirector_value eq ${id} or _wmkf_programcoordinator_value eq ${id}`,
      orderby: 'modifiedon desc',
    });
    if (result.capped || result.records.length !== result.totalCount) {
      throw new Error(`Request-relationship scan was incomplete for ${user.fullname}.`);
    }
    relationships.push({
      systemUserId: id,
      name: user.fullname,
      ...relationshipSummary(result.records, id),
    });
  }

  console.log(JSON.stringify({
    reviewerRole: FINAL_WRITEUP_REVIEWER_ROLE_NAME,
    reviewerCount: rosterResult.records.length,
    teams: exactNames.map((name) => ({
      expectedName: name,
      matches: teamResult.records
        .filter((team) => team.name === name)
        .map((team) => ({
          teamId: normalize(team.teamid),
          teamType: team.teamtype,
          isDefault: team.isdefault,
          businessUnitId: normalize(team._businessunitid_value),
        })),
    })),
    relationships,
  }, null, 2));
});
