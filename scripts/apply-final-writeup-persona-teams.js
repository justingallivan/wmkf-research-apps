#!/usr/bin/env node
/**
 * Idempotently provision the exact no-privilege Final Writeup persona teams.
 *
 * Safety:
 * - dry-run by default;
 * - Production writes require both --target=prod and --execute;
 * - every member must be an enabled holder of the acknowledgement role;
 * - unexpected existing members or any team security role fail closed;
 * - the script never removes a member or role automatically.
 *
 * Usage:
 *   node scripts/apply-final-writeup-persona-teams.js --target=prod
 *   node scripts/apply-final-writeup-persona-teams.js --target=prod --execute
 */

const fs = require('fs');
const path = require('path');
const {
  loadEnvLocal,
  getAccessToken,
  createClient,
} = require('../lib/dataverse/client');
const { getRootBusinessUnit } = require('../lib/dataverse/role-apply');

loadEnvLocal();

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPEC_PATH = path.join(
  __dirname,
  '..',
  'lib',
  'dataverse',
  'schema',
  'persona-teams',
  'final-writeup.json',
);

function parseArgs(argv) {
  const args = { target: 'sandbox', execute: false };
  for (const value of argv.slice(2)) {
    if (value === '--execute') args.execute = true;
    else if (value.startsWith('--target=')) args.target = value.slice('--target='.length);
    else if (value === '--help' || value === '-h') {
      console.log('Usage: node scripts/apply-final-writeup-persona-teams.js [--target=sandbox|prod] [--execute]');
      process.exit(0);
    } else {
      throw new Error(`Unknown flag: ${value}`);
    }
  }
  if (!['sandbox', 'prod'].includes(args.target)) {
    throw new Error(`Unknown target: ${args.target}`);
  }
  return args;
}

function resourceUrl(target) {
  const value = target === 'prod'
    ? process.env.DYNAMICS_URL
    : process.env.DYNAMICS_SANDBOX_URL;
  if (!value) throw new Error(`${target === 'prod' ? 'DYNAMICS_URL' : 'DYNAMICS_SANDBOX_URL'} is not set.`);
  return value.replace(/\/$/, '');
}

function escapeOData(value) {
  return String(value).replace(/'/g, "''");
}

function normalizeGuid(value, label) {
  if (!GUID_RE.test(String(value || ''))) throw new Error(`${label} must be a GUID.`);
  return String(value).toLowerCase();
}

function loadSpec() {
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
  if (!spec.reviewerRoleName || !Array.isArray(spec.teams) || spec.teams.length !== 3) {
    throw new Error('Persona-team spec must define one reviewer role and exactly three teams.');
  }
  const expectedPersonas = new Set(['program-director', 'program-coordinator', 'leadership']);
  const seenPersonas = new Set();
  const seenNames = new Set();
  const allMembers = new Set();
  for (const team of spec.teams) {
    if (!expectedPersonas.has(team.persona) || seenPersonas.has(team.persona)) {
      throw new Error(`Invalid or duplicate persona: ${team.persona}`);
    }
    if (!team.name || seenNames.has(team.name)) throw new Error(`Invalid or duplicate team name: ${team.name}`);
    if (!Array.isArray(team.members) || team.members.length === 0) {
      throw new Error(`Team ${team.name} must have at least one member.`);
    }
    seenPersonas.add(team.persona);
    seenNames.add(team.name);
    const teamMembers = new Set();
    for (const member of team.members) {
      const id = normalizeGuid(member.systemUserId, `${team.name} member`);
      if (!member.name || teamMembers.has(id)) throw new Error(`Invalid or duplicate member in ${team.name}.`);
      member.systemUserId = id;
      teamMembers.add(id);
      allMembers.add(id);
    }
  }
  if (seenPersonas.size !== expectedPersonas.size) throw new Error('Persona-team spec is incomplete.');
  spec.allMemberIds = allMembers;
  return spec;
}

async function getJson(client, route, label) {
  const response = await client.get(route);
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${response.text}`);
  return response.body?.value || [];
}

async function exactTeamMatches(client, name) {
  const filter = encodeURIComponent(`name eq '${escapeOData(name)}'`);
  return getJson(
    client,
    `/teams?$select=teamid,name,teamtype,isdefault,_businessunitid_value&$filter=${filter}`,
    `Team lookup for ${name}`,
  );
}

async function resolveEligibleUsers(client, spec) {
  const filter = encodeURIComponent(
    `isdisabled eq false and systemuserroles_association/any(role:role/name eq '${escapeOData(spec.reviewerRoleName)}')`,
  );
  const users = await getJson(
    client,
    `/systemusers?$select=systemuserid,fullname,isdisabled&$filter=${filter}`,
    'Reviewer-role user lookup',
  );
  const byId = new Map(users.map((user) => [String(user.systemuserid).toLowerCase(), user]));
  for (const team of spec.teams) {
    for (const member of team.members) {
      const user = byId.get(member.systemUserId);
      if (!user) throw new Error(`${member.name} is not an enabled holder of ${spec.reviewerRoleName}.`);
      if (user.fullname !== member.name) {
        throw new Error(`Pinned user ${member.systemUserId} resolved as '${user.fullname}', not '${member.name}'.`);
      }
    }
  }
  const missingFromSpec = [...byId.keys()].filter((id) => !spec.allMemberIds.has(id));
  if (missingFromSpec.length > 0 || byId.size !== spec.allMemberIds.size) {
    throw new Error('Persona-team membership spec must cover every exact reviewer-role member.');
  }
  return byId;
}

async function ensureTeam(client, { team, businessUnitId, resource, execute }) {
  let matches = await exactTeamMatches(client, team.name);
  if (matches.length > 1) throw new Error(`Multiple teams have the exact name '${team.name}'.`);
  if (matches.length === 0) {
    if (!execute) {
      console.log(`  [dry-run] would create owner team '${team.name}' in business unit ${businessUnitId}`);
      for (const member of team.members) {
        console.log(`    [dry-run] would add member: ${member.name}`);
      }
      return null;
    }
    const response = await client.post('/teams', {
      name: team.name,
      description: `No-privilege Final Writeup persona marker: ${team.persona}.`,
      teamtype: 0,
      'businessunitid@odata.bind': `/businessunits(${businessUnitId})`,
    });
    if (!response.ok) throw new Error(`Creating ${team.name} failed (${response.status}): ${response.text}`);
    matches = await exactTeamMatches(client, team.name);
    if (matches.length !== 1) throw new Error(`Could not read back exactly one '${team.name}' after creation.`);
    console.log(`  ✓ created ${team.name} (${matches[0].teamid})`);
  } else {
    console.log(`  · exists  ${team.name} (${matches[0].teamid})`);
  }

  const resolved = matches[0];
  if (resolved.teamtype !== 0 || resolved.isdefault === true) {
    throw new Error(`${team.name} must be a non-default owner team (teamtype 0).`);
  }
  if (String(resolved._businessunitid_value).toLowerCase() !== businessUnitId) {
    throw new Error(`${team.name} belongs to the wrong business unit.`);
  }

  const roles = await getJson(
    client,
    `/teams(${resolved.teamid})/teamroles_association?$select=roleid,name`,
    `Role readback for ${team.name}`,
  );
  if (roles.length > 0) throw new Error(`${team.name} is not no-privilege; it has ${roles.length} security role(s).`);

  const currentMembers = await getJson(
    client,
    `/teams(${resolved.teamid})/teammembership_association?$select=systemuserid,fullname,isdisabled`,
    `Member readback for ${team.name}`,
  );
  const expectedIds = new Set(team.members.map((member) => member.systemUserId));
  const unexpected = currentMembers.filter((member) => !expectedIds.has(String(member.systemuserid).toLowerCase()));
  if (unexpected.length > 0) {
    throw new Error(`${team.name} has unexpected existing member(s): ${unexpected.map((member) => member.fullname).join(', ')}.`);
  }
  const currentIds = new Set(currentMembers.map((member) => String(member.systemuserid).toLowerCase()));
  for (const member of team.members) {
    if (currentIds.has(member.systemUserId)) {
      console.log(`    · member exists: ${member.name}`);
      continue;
    }
    if (!execute) {
      console.log(`    [dry-run] would add member: ${member.name}`);
      continue;
    }
    const response = await client.post(
      `/teams(${resolved.teamid})/teammembership_association/$ref`,
      { '@odata.id': `${resource}/api/data/v9.2/systemusers(${member.systemUserId})` },
    );
    if (!response.ok) throw new Error(`Adding ${member.name} to ${team.name} failed (${response.status}): ${response.text}`);
    console.log(`    ✓ added member: ${member.name}`);
  }
  return String(resolved.teamid).toLowerCase();
}

(async () => {
  const args = parseArgs(process.argv);
  const spec = loadSpec();
  const resource = resourceUrl(args.target);
  console.log(`Target: ${args.target} (${resource})`);
  console.log(`Mode:   ${args.execute ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`Spec:   ${path.relative(process.cwd(), SPEC_PATH)}`);

  const token = await getAccessToken(resource);
  const client = createClient({ resourceUrl: resource, token, dryRun: false });
  const businessUnit = await getRootBusinessUnit(client);
  const businessUnitId = String(businessUnit.businessunitid).toLowerCase();
  console.log(`Root business unit: ${businessUnit.name} (${businessUnitId})`);
  await resolveEligibleUsers(client, spec);
  console.log(`Eligible roster: ${spec.allMemberIds.size} exact reviewer-role member(s)`);

  const teamIds = {};
  for (const team of spec.teams) {
    console.log(`\n${team.name}`);
    teamIds[team.persona] = await ensureTeam(client, {
      team,
      businessUnitId,
      resource,
      execute: args.execute,
    });
  }

  if (!args.execute) {
    console.log('\nDry run complete; no Dataverse write was issued.');
    return;
  }

  console.log('\nPinned team IDs:');
  console.log(JSON.stringify(teamIds, null, 2));
})().catch((error) => {
  console.error(`\nFATAL: ${error.message}`);
  process.exit(1);
});
