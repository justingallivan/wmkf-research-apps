#!/usr/bin/env node
/** Read-only D26/J27 Production visibility comparison. Only Dataverse GETs.
 * Owner authorization 2026-11-02: verify unchanged D26 and hidden unready J27.
 * Usage: DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-j27-readiness-visibility.cjs <verified-program-guid>
 * Emits counts, request numbers and ID-set digests, not applicant/PD content.
 */
const crypto = require('node:crypto');
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
async function main() {
  loadEnvLocal();
  const { PRODUCTION_HOSTS } = await import('../lib/dataverse/core/target-registry.js');
  const { isVisibleRequestRow } = await import('../shared/config/workbenchVisibility.js');
  const { isRequestReadyForStaff } = await import('../shared/config/requestReadiness.js');
  const program = process.argv[2];
  if (!/^[0-9a-f-]{36}$/i.test(program || '')) throw new Error('Verified Grant Program GUID required.');
  const resourceUrl = process.env.DYNAMICS_URL;
  if (!PRODUCTION_HOSTS.includes(new URL(resourceUrl).hostname.toLowerCase()) || process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') throw new Error('Explicit registered Production read required.');
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
  const filter = `_wmkf_grantprogram_value eq ${program} and (wmkf_GrantCycle/wmkf_cyclecode eq 'D26' or wmkf_GrantCycle/wmkf_cyclecode eq 'J27')`;
  const qs = new URLSearchParams({ $select: 'akoya_requestid,akoya_requestnum,akoya_requeststatus,wmkf_triagestatus,wmkf_readyforreview,wmkf_istestrequest', $filter: filter, $expand: 'wmkf_GrantCycle($select=wmkf_cyclecode)', $top: '5000' });
  const result = await client.get(`/akoya_requests?${qs}`);
  if (!result.ok) throw new Error(`Read failed HTTP ${result.status}`);
  if (!Array.isArray(result.body?.value) || result.body['@odata.nextLink']) throw new Error('Incomplete read; no conclusions.');
  const set = (rows) => rows.map(r => r.akoya_requestid).sort();
  const digest = (rows) => crypto.createHash('sha256').update(JSON.stringify(set(rows))).digest('hex');
  const numbers = (rows) => rows.map(r => r.akoya_requestnum).sort();
  const summary = { observedAt: new Date().toISOString(), target: 'production', dataverseMethods: ['GET'], cycles: {} };
  for (const code of ['D26', 'J27']) {
    const rows = result.body.value.filter(r => r.wmkf_GrantCycle?.wmkf_cyclecode === code);
    const modes = {};
    for (const includeSetAside of [false, true]) {
      const before = rows.filter(r => isVisibleRequestRow(r, includeSetAside));
      const after = before.filter(isRequestReadyForStaff);
      modes[includeSetAside ? 'includeSetAside' : 'default'] = {
        oldEligible: before.length, gatedEligible: after.length,
        oldOrdinary: before.filter(r => r.wmkf_istestrequest !== true).length,
        gatedOrdinary: after.filter(r => r.wmkf_istestrequest !== true).length,
        removedByGate: before.length - after.length, idsIdentical: JSON.stringify(set(before)) === JSON.stringify(set(after)),
        oldIdDigest: digest(before), gatedIdDigest: digest(after),
        gatedRequestNumbers: numbers(after),
      };
    }
    summary.cycles[code] = { total: rows.length, ready: rows.filter(r => r.wmkf_readyforreview === true).length, unready: rows.filter(r => r.wmkf_readyforreview !== true).length, modes };
  }
  summary.examples = result.body.value.filter(r => ['1003391', '1003384'].includes(r.akoya_requestnum)).map(r => ({ requestNumber: r.akoya_requestnum, cycle: r.wmkf_GrantCycle?.wmkf_cyclecode, ready: r.wmkf_readyforreview, oldEligible: isVisibleRequestRow(r, true), gatedEligible: isVisibleRequestRow(r, true) && isRequestReadyForStaff(r) }));
  console.log(JSON.stringify(summary, null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
