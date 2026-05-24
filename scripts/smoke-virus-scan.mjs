#!/usr/bin/env node
/**
 * Smoke test: Cloudmersive virus scanner round-trip.
 *
 * Posts two payloads against the real https://api.cloudmersive.com endpoint:
 *   1. The standard EICAR test string — every AV engine flags this; if our
 *      scanner reports it 'clean', the integration is mis-wired and a real
 *      virus would also slip through.
 *   2. A trivial clean string — confirms the happy path.
 *
 * Requires CLOUDMERSIVE_API_KEY in .env.local or env. Exits non-zero on any
 * assertion failure so this can wire into CI later.
 *
 * Why .mjs: lib/services/cloudmersive-scan.js is ESM (it imports
 * service-error.js, which is ESM). A CJS .js smoke would need dynamic import;
 * .mjs is simpler.
 *
 * Run: node scripts/smoke-virus-scan.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Minimal .env.local loader — same pattern as scripts/smoke-blob-upload.js.
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [k, ...rest] = t.split('=');
    if (!k || !rest.length) continue;
    let v = rest.join('=');
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

if (!process.env.CLOUDMERSIVE_API_KEY) {
  console.error('CLOUDMERSIVE_API_KEY missing — set in .env.local or env');
  process.exit(2);
}

const { scanBytes } = await import('../lib/services/cloudmersive-scan.js');

// The canonical EICAR anti-malware test file. Harmless ASCII string that
// every AV engine is required to detect. Source: https://www.eicar.org/
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

let pass = 0;
let fail = 0;
function check(label, cond, ...details) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.error(`  ✗ ${label}`, ...details);
    fail++;
  }
}

async function main() {
  console.log('1. scan a clean payload');
  const t0 = Date.now();
  const cleanOut = await scanBytes(Buffer.from('hello world, no virus here'), 'clean.txt');
  console.log(`   scanned in ${Date.now() - t0}ms`);
  check('clean payload → scan_result=clean', cleanOut.scan_result === 'clean', cleanOut);
  check('clean payload → foundViruses=[]', Array.isArray(cleanOut.foundViruses) && cleanOut.foundViruses.length === 0);
  check('clean payload → scanner=cloudmersive', cleanOut.scanner === 'cloudmersive');
  check('clean payload → scannedAt is ISO-8601', typeof cleanOut.scannedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(cleanOut.scannedAt));

  console.log('\n2. scan the EICAR test string');
  const t1 = Date.now();
  const eicarOut = await scanBytes(Buffer.from(EICAR), 'eicar.com');
  console.log(`   scanned in ${Date.now() - t1}ms`);
  check('EICAR payload → scan_result=infected', eicarOut.scan_result === 'infected', eicarOut);
  check('EICAR payload → foundViruses non-empty', Array.isArray(eicarOut.foundViruses) && eicarOut.foundViruses.length > 0, eicarOut.foundViruses);
  if (eicarOut.foundViruses?.length) {
    const v = eicarOut.foundViruses[0];
    check('EICAR finding → has virusName', typeof v.virusName === 'string' && v.virusName.length > 0, v);
    console.log(`   detection: ${v.virusName}`);
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('fatal:', e?.stack || e);
  // Print structured-error context if it's one of ours.
  if (e?.serviceName) {
    console.error('  serviceName:', e.serviceName);
    console.error('  status:', e.status);
    console.error('  isTransient:', e.isTransient);
    if (e.noResponse) console.error('  causeKind:', e.causeKind);
  }
  process.exit(1);
});
