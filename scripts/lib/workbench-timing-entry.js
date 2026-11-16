#!/usr/bin/env node
/** Real-service entry bundled by ../probe-workbench-load-timing.js. */
const { createHash } = require('node:crypto');
async function main() {
const flag = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const email = flag('email');
const profileId = Number(flag('profile-id'));
const cycleCode = flag('cycle') || 'D26';
const scope = flag('scope') || 'my';
const laterFacts = flag('later-facts') === 'yes';
if (!email || !Number.isInteger(profileId) || profileId <= 0 || !/^[JD]\d{2}$/.test(cycleCode) || !['my', 'all'].includes(scope)) {
  throw new Error('Provide --email, positive --profile-id, valid --cycle and --scope=my|all.');
}
if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') throw new Error('Explicit production-read opt-in required.');
if (process.env.VERCEL_ENV === 'production') throw new Error('Run as local/preview, never production.');
process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
const { enterDynamicsBypassForScript } = await import('../../lib/services/dynamics-context.js');
const { withDalContext } = await import('../../lib/dataverse/core/context.js');
const { resolveByEmail } = await import('../../lib/services/program-director-resolver.js');
const { getUserRole } = await import('../../lib/utils/auth.js');
const { resolveWriteupViewer } = await import('../../lib/services/pre-site-visit/writeup-visibility.js');
const { loadDashboard } = await import('../../lib/services/workbench/dashboard-service.js');
const { listPreSiteVisitDrafts } = await import('../../lib/services/pre-site-visit/cycle-list-service.js');
const { collectWorkbenchLoadTimings } = await import('../../lib/services/workbench/load-timing.js');
const { loadJ27LaterFacts } = await import('../../lib/services/workbench/j27-later-facts.js');
enterDynamicsBypassForScript('probe-workbench-load-timing');
const digest = (value) => createHash('sha256').update(JSON.stringify(value, (key, item) => key === 'serverNowIso' ? undefined : item)).digest('hex');
const report = ({ value, milliseconds, steps }) => ({
  milliseconds: Math.round(milliseconds),
  steps: steps.map((step) => ({ name: step.name, milliseconds: Math.round(step.milliseconds) })),
  digest: digest(value),
  requestCounts: value.requestCounts,
});
await withDalContext('probe-workbench-load-timing', async () => {
  const pd = await resolveByEmail(email);
  if (!pd?.systemuserid) throw new Error('Active staff identity not resolved.');
  const role = await getUserRole(profileId);
  const writeupViewer = await resolveWriteupViewer({ isSuperuser: role === 'superuser', actingUserSystemId: pd.systemuserid });
  const runs = [];
  for (let index = 0; index < 2; index += 1) {
    // The cycle's request list (2026-11-12: earlier runs timed only the cycle picker).
    const dashboard = await collectWorkbenchLoadTimings(() => loadDashboard({ azureEmail: email, profileId, callerSystemId: pd.systemuserid, cycleCode, scope }));
    const rows = (dashboard.value.proposals || []).map((row) => ({ akoya_requestid: row.requestId }));
    // --later-facts=yes: the J27 list's three batched later-phase reads, timed over
    // this cycle's request ids so their cost is seen at real volume (the list
    // itself runs them only for 2027-or-later rows). Counts only.
    let later = null;
    if (laterFacts && rows.length) {
      const started = performance.now();
      const facts = await loadJ27LaterFacts(rows);
      const unavailable = [...facts.values()].filter((entry) => Object.values(entry).some((fact) => fact?.status === 'unavailable')).length;
      later = { rows: rows.length, milliseconds: Math.round(performance.now() - started), rowsWithAnUnavailableFact: unavailable };
    }
    const deliberations = await collectWorkbenchLoadTimings(() => listPreSiteVisitDrafts({ cycleCode, programId: dashboard.value.programId, scope: 'my', callerSystemId: pd.systemuserid, writeupViewer }));
    runs.push({ rows: rows.length, dashboard: report(dashboard), deliberations: report(deliberations), later });
  }
  console.log('WORKBENCH_TIMINGS=' + JSON.stringify({ targetHost: new URL(process.env.DYNAMICS_URL).hostname, cycleCode, scope, runs }));
});

}
module.exports = { main };
