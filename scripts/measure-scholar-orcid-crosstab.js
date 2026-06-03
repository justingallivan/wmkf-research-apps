#!/usr/bin/env node
/**
 * READ-ONLY (S215): runs the Scholar-profile guard over the SAME reviewers the
 * ORCID measurement scored (scripts/.orcid-resolution.jsonl) and cross-tabulates
 * ORCID × Scholar to quantify, against the CURRENT resolver semantics:
 *   - already `probable` (captured today after the fix): ORCID-resolved AND Scholar-clean
 *   - NEW unlock if "institution-corroborated ORCID persists alone": ORCID-corroborated
 *       AND Scholar NOT clean (these are `unresolved` today)
 *   - still gated (lone uncorroborated ORCID, common-name risk): ORCID-lone AND Scholar not clean
 *   - Scholar-only (metrics; Connor doesn't value): Scholar-clean AND no usable ORCID
 *
 * Scholar classification mirrors contact-enrichment-service.js:362-380.
 * STRICTLY READ-ONLY. Costs ~1 SerpAPI Google call per reviewer.
 *   node scripts/measure-scholar-orcid-crosstab.js
 */
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
const SERP = process.env.SERP_API_KEY;
if (!SERP) { console.error('SERP_API_KEY missing — aborting.'); process.exit(1); }

const { SerpContactService } = await import('../lib/services/serp-contact-service.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const orcidRows = readFileSync(join(__dirname, '.orcid-resolution.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));
console.log(`Scoring Scholar for the same ${orcidRows.length} reviewers…\n`);

// ORCID bucket per row (from the prior measurement).
function orcidBucket(r) {
  if (r.status === 'resolved') return r.corroborated ? 'orcid_corrob' : 'orcid_lone';
  if (r.status === 'ambiguous') return 'orcid_ambiguous';
  if (r.status === 'error') return 'orcid_error';
  return 'orcid_none';
}

// Scholar bucket — mirror enrichment's classification.
async function scholarBucket(name, aff) {
  let s;
  try { s = await SerpContactService.findScholarProfile({ name, affiliation: aff }, SERP); }
  catch { return 'sch_error'; }
  if (!s || !s.scholarId) return 'sch_none';
  if (s.nameMismatch || s.institutionMismatch) return 'sch_rejected';
  return 'sch_clean';
}

const cross = {}; // `${orcid}|${scholar}` -> count
let i = 0;
for (const r of orcidRows) {
  i++;
  const ob = orcidBucket(r);
  const sb = await scholarBucket(r.name, r.aff);
  await sleep(220);
  const k = `${ob}|${sb}`;
  cross[k] = (cross[k] || 0) + 1;
  if (i % 25 === 0) console.log(`  …${i}/${orcidRows.length}`);
}

const n = orcidRows.length;
const get = (o, s) => cross[`${o}|${s}`] || 0;
const sum = (pred) => Object.entries(cross).reduce((a, [k, v]) => a + (pred(...k.split('|')) ? v : 0), 0);
const pct = (x) => `${x} (${((x / n) * 100).toFixed(1)}%)`;

const orcidResolved = (o) => o === 'orcid_corrob' || o === 'orcid_lone';
const schClean = (s) => s === 'sch_clean';

const capturedNow = sum((o, s) => orcidResolved(o) && schClean(s));               // probable today
const newUnlock   = sum((o, s) => o === 'orcid_corrob' && !schClean(s));          // corroborated-ORCID-alone rule
const stillGated  = sum((o, s) => o === 'orcid_lone' && !schClean(s));            // lone uncorroborated (risk)
const scholarOnly = sum((o, s) => !orcidResolved(o) && schClean(s));             // metrics only (not valued)
const ambiguous   = sum((o) => o === 'orcid_ambiguous');

console.log(`\n${'='.repeat(70)}\nORCID × Scholar cross-tab — ${n} reviewers\n${'='.repeat(70)}`);
const OB = ['orcid_corrob', 'orcid_lone', 'orcid_ambiguous', 'orcid_none', 'orcid_error'];
const SB = ['sch_clean', 'sch_rejected', 'sch_none', 'sch_error'];
console.log(`${''.padEnd(16)}${SB.map((s) => s.replace('sch_', '').padStart(11)).join('')}   total`);
for (const o of OB) {
  const tot = SB.reduce((a, s) => a + get(o, s), 0);
  console.log(`${o.padEnd(16)}${SB.map((s) => String(get(o, s)).padStart(11)).join('')}${String(tot).padStart(9)}`);
}

console.log(`\n${'='.repeat(70)}\nDECISION-RELEVANT (current resolver: probable = ORCID-resolved AND Scholar-clean)\n${'='.repeat(70)}`);
console.log(`Captured TODAY (probable, ORCID+Scholar both):        ${pct(capturedNow)}`);
console.log(`NEW unlock — corroborated ORCID, Scholar not clean:   ${pct(newUnlock)}`);
console.log(`Still gated — lone uncorroborated ORCID (risk set):   ${pct(stillGated)}`);
console.log(`Scholar-only (metrics; not valued by Connor):         ${pct(scholarOnly)}`);
console.log(`ORCID ambiguous (abstained):                          ${pct(ambiguous)}`);
console.log(`\nSo: capturing corroborated-ORCID-alone would take ORCID capture from`);
console.log(`   ${pct(capturedNow)}  →  ${pct(capturedNow + newUnlock)}  of reviewers,`);
console.log(`   leaving ${pct(stillGated)} appropriately gated.`);
