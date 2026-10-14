#!/usr/bin/env node
/** Real-service entry bundled by ../probe-workbench-load-timing.js. */
const { createHash } = require('node:crypto');
async function main() {
const flag = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const email = flag('email');
const profileId = Number(flag('profile-id'));
const cycleCode = flag('cycle') || 'D26';
if (!email || !Number.isInteger(profileId) || profileId <= 0 || !/^[JD]\d{2}$/.test(cycleCode)) {
  throw new Error('Provide --email, positive --profile-id and valid --cycle.');
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
    const dashboard = await collectWorkbenchLoadTimings(() => loadDashboard({ azureEmail: email, profileId, callerSystemId: pd.systemuserid }));
    const deliberations = await collectWorkbenchLoadTimings(() => listPreSiteVisitDrafts({ cycleCode, programId: dashboard.value.programId, scope: 'my', callerSystemId: pd.systemuserid, writeupViewer }));
    runs.push({ dashboard: report(dashboard), deliberations: report(deliberations) });
  }
  console.log('WORKBENCH_TIMINGS=' + JSON.stringify({ targetHost: new URL(process.env.DYNAMICS_URL).hostname, runs }));
});

}
module.exports = { main };
