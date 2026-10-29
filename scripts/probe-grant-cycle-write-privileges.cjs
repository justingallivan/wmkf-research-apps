#!/usr/bin/env node
/**
 * Read-only probe: can the cycle-calendar editors write the operations Grant
 * Cycle table (wmkf_grantcycle) in Production under impersonation?
 *
 * Impersonated writes run with the intersection of the app user's and the
 * impersonated user's privileges (lib/services/dynamics/write-core.js), so
 * this reports the wmkf_grantcycle Read/Write privileges (name + depth) of:
 *  - the app user (WhoAmI),
 *  - the assigned Grants Manager and Program Coordinator (shared role
 *    settings board_writeups.grants_manager / .program_coordinator),
 *  - optionally one more staff member by email (--also-email), e.g. the owner.
 *
 * Uses RetrieveUserPrivileges (GET). Dataverse GETs only; the sole POST
 * acquires the OAuth token. Output names roles, not people.
 *
 * Usage: node scripts/probe-grant-cycle-write-privileges.cjs --env-file <local env> --output <new json> [--also-email <address>]
 */
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const assert = require('node:assert/strict');

const ROLE_SETTINGS = {
  grantsManager: 'board_writeups.grants_manager',
  programCoordinator: 'board_writeups.program_coordinator',
};
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const args = process.argv.slice(2);
  assert((args.length === 4 || args.length === 6) && args[0] === '--env-file' && args[2] === '--output'
    && (args.length === 4 || args[4] === '--also-email'), 'Use --env-file <path> --output <path> [--also-email <address>]');
  const alsoEmail = args[5] || null;
  const credentials = parseEnv(fs.readFileSync(args[1], 'utf8'));
  for (const name of ['DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET', 'DYNAMICS_TENANT_ID']) {
    assert(credentials[name], 'Required application credential missing');
    process.env[name] = credentials[name];
  }
  const target = 'https://wmkf.crm.dynamics.com';
  assert(new URL(credentials.DYNAMICS_URL).origin === target, 'Credential environment target differs from approved production hostname');
  delete process.env.VERCEL_ENV;
  delete process.env.DATAVERSE_PROD_WRITE_ACK;
  Object.assign(process.env, { NODE_ENV: 'development', DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on', DATAVERSE_ALLOW_PROD_READS: 'yes' });
  const { createClient, getAccessToken } = require('../lib/dataverse/client.js');
  const client = createClient({ resourceUrl: target, token: await getAccessToken(target) });
  let calls = 0;
  async function get(path) {
    calls++;
    const result = await client.get(path);
    if (!result.ok) throw new Error(`GET failed HTTP ${result.status}: ${result.body?.error?.code || 'unknown_code'}`);
    return result.body;
  }

  const subjects = [];
  const whoami = await get('/WhoAmI');
  subjects.push({ subject: 'app user (WhoAmI)', systemUserId: whoami.UserId });
  for (const [role, key] of Object.entries(ROLE_SETTINGS)) {
    const body = await get(`/wmkf_appsystemsettings?$select=wmkf_settingvalue&$top=1&$filter=${encodeURIComponent(`wmkf_settingkey eq '${key}'`)}`);
    let systemUserId = null;
    try { systemUserId = JSON.parse(body.value?.[0]?.wmkf_settingvalue || 'null')?.systemUserId || null; } catch { systemUserId = null; }
    subjects.push({ subject: `${role} (assigned)`, systemUserId });
  }
  if (alsoEmail) {
    const safe = alsoEmail.replace(/'/g, "''");
    const body = await get(`/systemusers?$select=systemuserid&$top=2&$filter=${encodeURIComponent(`internalemailaddress eq '${safe}'`)}`);
    assert(body.value?.length === 1, 'Expected exactly one system user for --also-email');
    subjects.push({ subject: 'additional staff member (--also-email)', systemUserId: body.value[0].systemuserid });
  }

  const report = { capturedAt: new Date().toISOString(), target, externalMethods: ['OAuth token POST', 'Dataverse GET'], subjects: [] };
  for (const { subject, systemUserId } of subjects) {
    if (!systemUserId || !GUID.test(systemUserId)) { report.subjects.push({ subject, assigned: false }); continue; }
    const user = await get(`/systemusers(${systemUserId})?$select=isdisabled,accessmode`);
    const privileges = await get(`/systemusers(${systemUserId})/Microsoft.Dynamics.CRM.RetrieveUserPrivileges()`);
    const grantCycle = (privileges.RolePrivileges || [])
      .filter(p => /wmkf_grantcycle$/i.test(p.PrivilegeName || ''))
      .map(p => ({ privilege: p.PrivilegeName, depth: p.Depth }))
      .sort((a, b) => a.privilege.localeCompare(b.privilege));
    report.subjects.push({
      subject,
      assigned: true,
      disabled: user.isdisabled,
      accessMode: user.accessmode,
      totalPrivileges: (privileges.RolePrivileges || []).length,
      grantCyclePrivileges: grantCycle,
      canRead: grantCycle.some(p => /^prvRead/i.test(p.privilege)),
      canWrite: grantCycle.some(p => /^prvWrite/i.test(p.privilege)),
    });
  }
  report.dataverseGetCalls = calls;
  fs.writeFileSync(args[3], JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Saved non-secret evidence: ${args[3]}; Dataverse GETs: ${calls}`);
  for (const s of report.subjects) console.log(`${s.subject}: ${s.assigned === false ? 'not assigned' : `read=${s.canRead} write=${s.canWrite} disabled=${s.disabled}`}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
