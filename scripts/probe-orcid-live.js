#!/usr/bin/env node
/** READ-ONLY: directly exercise ORCIDService to see if auth/search works with the
 *  newly-added creds, surfacing the error the enrichment try/catch swallows. */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue; let [, k, v] = m; v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}
const { ORCIDService } = await import('../lib/services/orcid-service.js');
const clientId = process.env.ORCID_CLIENT_ID, clientSecret = process.env.ORCID_CLIENT_SECRET;
console.log(`clientId starts: ${clientId?.slice(0, 4)}…  secret len: ${clientSecret?.length}`);

console.log('\n1) getAccessToken …');
try {
  const tok = await ORCIDService.getAccessToken(clientId, clientSecret);
  console.log(`   OK — token len ${tok?.length}`);
} catch (e) { console.log(`   FAILED: ${e.message}`); process.exit(0); }

for (const [name, aff] of [['Ram Madabhushi', 'University of Texas Southwestern Medical Center'], ['Li-Huei Tsai', 'MIT']]) {
  console.log(`\n2) findContact("${name}", "${aff}") …`);
  try {
    const r = await ORCIDService.findContact({ name, affiliation: aff, clientId, clientSecret });
    console.log('   →', JSON.stringify(r, null, 2)?.slice(0, 600));
  } catch (e) { console.log(`   FAILED: ${e.message}`); }
}
