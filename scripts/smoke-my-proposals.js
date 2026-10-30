#!/usr/bin/env node
/**
 * Smoke test: /api/reviewer-finder/my-proposals (without auth).
 * Validates resolver + cycle filter + projection by hitting Dynamics directly.
 *
 * Usage:
 *   node scripts/smoke-my-proposals.js [email]                       # list cycles
 *   node scripts/smoke-my-proposals.js [email] [cycleCode]           # actionable in cycle
 *   node scripts/smoke-my-proposals.js [email] [cycleCode] all       # all Phase II in cycle
 *
 * Defaults to jgallivan@wmkeck.org if email not specified.
 */

require('./../lib/dataverse/client').loadEnvLocal();

(async () => {
  const email = process.argv[2] || 'jgallivan@wmkeck.org';
  const cycleCode = process.argv[3];

  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
  const { parseCycleCode } = await import('../lib/utils/cycle-code.js');
  const { LINKED_CYCLE_ID_FIELD, linkedCycleCode, linkedCycleExpand, linkedCycleFilter } =
    await import('../lib/dataverse/adapters/operations-grant-cycle.js');

  return bypassDynamicsRestrictions('smoke', async () => {

  // Inline resolveByEmail: smoke script can't import `program-director-resolver`
  // because that module imports `./dynamics-service` without an extension —
  // Next.js resolves that fine, raw node ESM doesn't.
  const escaped = email.replace(/'/g, "''");
  const userQ = await DynamicsService.queryRecords('systemusers', {
    select: 'systemuserid,fullname',
    filter: `internalemailaddress eq '${escaped}' and isdisabled eq false`,
    top: 1,
  });
  const pd = userQ.records[0]
    ? { systemuserid: userQ.records[0].systemuserid, fullName: userQ.records[0].fullname }
    : null;
  if (!pd) {
    console.error(`No systemuser for ${email}`);
    process.exit(1);
  }
  console.log(`PD: ${pd.fullName} (${pd.systemuserid})\n`);

  if (!cycleCode) {
    // A request's cycle is its Grant Cycle link (meeting-date retirement), as in the service.
    const filter = `_wmkf_programdirector_value eq ${pd.systemuserid} and ${LINKED_CYCLE_ID_FIELD} ne null`;
    const { records } = await DynamicsService.queryAllRecords('akoya_requests', {
      select: 'akoya_requestid',
      expand: linkedCycleExpand(),
      filter,
      orderby: 'akoya_requestnum desc',
    });
    const seen = new Map();
    for (const r of records) {
      const code = linkedCycleCode(r);
      if (!code) continue;
      seen.set(code, (seen.get(code) || 0) + 1);
    }
    const sorted = Array.from(seen.entries()).sort((a, b) => {
      const [, ay] = a[0].match(/^[JD](\d+)$/);
      const [, by] = b[0].match(/^[JD](\d+)$/);
      if (ay !== by) return parseInt(by, 10) - parseInt(ay, 10);
      return a[0][0] < b[0][0] ? 1 : -1;
    });
    console.log(`Cycles for ${pd.fullName}:`);
    for (const [code, count] of sorted) {
      console.log(`  ${code}: ${count}`);
    }
    return;
  }

  if (!parseCycleCode(cycleCode)) {
    console.error(`Invalid cycle code: ${cycleCode}`);
    process.exit(1);
  }
  const cycleFilter = linkedCycleFilter(cycleCode.trim().toUpperCase());
  const status = process.argv[4] === 'all' ? 'all' : 'actionable';
  const statusFilter = status === 'actionable'
    ? `akoya_requeststatus eq 'Phase II Pending' and wmkf_phaseiistatus eq null`
    : `akoya_requeststatus eq 'Phase II Pending'`;
  const filter = `_wmkf_programdirector_value eq ${pd.systemuserid} and ${cycleFilter} and ${statusFilter}`;
  console.log(`Filter mode: ${status}\n`);
  const { records } = await DynamicsService.queryAllRecords('akoya_requests', {
    select: [
      'akoya_requestid',
      'akoya_requestnum',
      'akoya_requeststatus',
      '_akoya_applicantid_value',
      '_wmkf_projectleader_value',
      '_wmkf_potentialreviewer1_value',
      '_wmkf_potentialreviewer2_value',
      '_wmkf_potentialreviewer3_value',
      '_wmkf_potentialreviewer4_value',
      '_wmkf_potentialreviewer5_value',
    ].join(','),
    filter,
    orderby: 'akoya_requestnum asc',
  });
  console.log(`${cycleCode.toUpperCase()} proposals (${records.length}):\n`);
  for (const r of records) {
    const slots = ['1', '2', '3', '4', '5'].filter((n) => r[`_wmkf_potentialreviewer${n}_value`]).length;
    const status = r.akoya_requeststatus || '—';
    console.log(
      `  ${r.akoya_requestnum}  ${(r._akoya_applicantid_value_formatted || '?').padEnd(36)}  PI: ${(r._wmkf_projectleader_value_formatted || '?').padEnd(28)}  ${slots}/5  status: ${status}`,
    );
  }
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
