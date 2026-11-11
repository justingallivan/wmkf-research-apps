#!/usr/bin/env node
/** Aggregate-only read probe. Usage: node --import ./scripts/lib/use-extensionless.mjs scripts/probe-recommendations-roster-read.mjs PRIVATE_ENV */
import fs from 'node:fs';
import dotenv from 'dotenv';

async function main() {
  const [envFile, ...extra] = process.argv.slice(2);
  if (!envFile || extra.length) throw Error('arguments');
  const config = dotenv.parse(fs.readFileSync(envFile));
  for (const key of ['DYNAMICS_URL','DYNAMICS_SANDBOX_URL','DYNAMICS_TENANT_ID','DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET','DATAVERSE_TARGET_INTERLOCK','DATAVERSE_DAL_ENFORCEMENT']) {
    if (config[key] !== undefined) process.env[key] = config[key];
  }
  const target = 'https://orgd9e66399.crm.dynamics.com';
  if (process.env.VERCEL_ENV || process.env.NODE_ENV === 'production' || process.env.DYNAMICS_URL !== target ||
    (process.env.DYNAMICS_SANDBOX_URL && process.env.DYNAMICS_SANDBOX_URL !== target) ||
    process.env.DATAVERSE_TARGET_INTERLOCK !== 'on' || process.env.DATAVERSE_DAL_ENFORCEMENT !== 'on') throw Error('target');
  const { withDalContext } = await import('../lib/dataverse/core/context.js');
  const { readRecommendationsRosterProjection } = await import('../lib/dataverse/adapters/expertise-recommendations-read.js');
  const { buildRecommendationsSnapshot } = await import('../lib/services/expertise-finder/recommendations-contract.js');
  return withDalContext('probe-recommendations-roster-read', async () => {
    const { targetHost, projection } = await readRecommendationsRosterProjection();
    const { snapshot, rosterBlock, rosterRecord } = buildRecommendationsSnapshot(projection);
    console.log(JSON.stringify({targetHost,checkedAt:new Date().toISOString(),profiles:projection.profiles.length,active:snapshot.rows.length,candidateUsers:projection.users.length,disabledCandidates:projection.users.filter(u=>u.disabled).length,eligibleLeads:snapshot.leadGuids.length,warnings:snapshot.warnings.length,complete:projection.complete,selectedFieldsAndEtagsValidated:true,rosterHash:snapshot.manifest.rosterHash,rosterTextBytes:Buffer.byteLength(rosterBlock),encodedRecordBytes:Buffer.byteLength(JSON.stringify(rosterRecord)),scope:'read-only strict adapter aggregate probe; no staff authorization or production readiness proof'},null,2));
  });
}
main().catch(error => {
  const code = ['expertise_roster_read_unavailable', 'expertise_roster_snapshot_invalid'].includes(error?.code)
    ? error.code : 'roster_probe_transport_or_configuration_failure';
  console.error(JSON.stringify({ success: false, code }));
  process.exitCode = 1;
});
