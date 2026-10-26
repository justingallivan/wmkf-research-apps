#!/usr/bin/env node

/**
 * One-purpose, exact-row test-marker correction for request 1001931, an
 * unflagged placeholder request found by the Research request file corpus
 * pilot (docs/plans/RESEARCH_REQUEST_FILE_CORPUS_PLAN_2026-10-25.md, section 2b;
 * owner-approved 2026-10-25). Uses the fixed local-only allowlist in
 * lib/dataverse/client.js; dry run by default, --apply to write.
 */
import { createRequire } from 'node:module';
import { PRODUCTION_HOSTS } from '../lib/dataverse/core/target-registry.js';
import { resolveInterlockMode } from '../lib/dataverse/core/interlock.js';

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
const REQUEST_NUMBERS = Object.freeze(['1001931']);

async function main() {
  const apply = process.argv.slice(2).length === 1 && process.argv[2] === '--apply';
  if (process.argv.length > 2 + (apply ? 1 : 0)) throw new Error('Usage: node scripts/mark-test-request-1001931.mjs [--apply]');
  loadEnvLocal();
  if (resolveInterlockMode() !== 'on') throw new Error('DATAVERSE_TARGET_INTERLOCK must be explicitly on.');
  if (PRODUCTION_HOSTS.length !== 1) throw new Error('The Production target registry is ambiguous.');
  const resourceUrl = `https://${PRODUCTION_HOSTS[0]}`;
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
  console.log(JSON.stringify({ target: new URL(resourceUrl).hostname, mode: apply ? 'apply' : 'dry-run' }));
  for (const requestNumber of REQUEST_NUMBERS) {
    const result = await client.maintainD26TrialTestMarker(requestNumber, { apply });
    console.log(JSON.stringify(result));
  }
}

main().catch((error) => {
  console.error(`Test-marker correction for 1001931 stopped (${error?.name || 'Error'}): ${error?.message || 'unknown error'}`);
  process.exitCode = 1;
});
