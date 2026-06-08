/**
 * Read-only: dump reviewer_find_roster candidate blobs for one request, with the
 * identity/provenance/contact fields needed to diagnose a wrong-person surfacing.
 * Usage: node --import ./scripts/lib/use-extensionless.mjs scripts/probe-roster-dump.mjs --guid <request_guid> [--grep fazakerley]
 */
import { readFileSync } from 'node:fs';
try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch {}
const args = process.argv.slice(2);
const guid = args[args.indexOf('--guid') + 1];
const grepIdx = args.indexOf('--grep');
const grep = grepIdx >= 0 ? args[grepIdx + 1].toLowerCase() : null;
if (!guid) { console.error('--guid required'); process.exit(2); }

const pg = await import('@vercel/postgres');
const { rows } = await pg.sql`SELECT status, display_name, source_kind, candidate FROM reviewer_find_roster WHERE request_id = ${guid} ORDER BY display_name`;
console.log(`${rows.length} roster row(s) for ${guid}\n`);
for (const r of rows) {
  const c = r.candidate || {};
  const e = c.contactEnrichment || {};
  const blob = JSON.stringify(c).toLowerCase();
  if (grep && !blob.includes(grep)) continue;
  const links = [c.website, c.orcidUrl, c.googleScholarUrl, e.website, e.orcidUrl, e.googleScholarUrl].filter(Boolean);
  const linkedin = (blob.match(/https?:\/\/[^"]*linkedin[^"]*/g) || []);
  console.log('─'.repeat(80));
  console.log(`NAME        ${c.name}   [${r.status} / source_kind=${r.source_kind}]`);
  console.log(`provenance  kind=${c.provenance?.kind} sources=${JSON.stringify(c.provenance?.sources)} seedRole=${c.provenance?.seedRole}`);
  console.log(`identity    verificationStatus=${c.verificationStatus} identityStatus=${c.identityStatus} isClaudeSuggestion=${c.isClaudeSuggestion} source=${c.source}`);
  console.log(`area        affiliation=${c.affiliation || e.affiliation || '—'}  expertise=${JSON.stringify(c.expertiseAreas || c.keywords)}`);
  console.log(`contact     email=${c.email || e.email || '—'} (src=${e.emailSource || '—'})  orcid=${c.orcid || e.orcid || '—'}`);
  console.log(`links       ${links.join('  |  ') || '—'}`);
  if (linkedin.length) console.log(`LINKEDIN    ${linkedin.join('  ')}`);
  if (c.reasoning) console.log(`reasoning   ${String(c.reasoning).slice(0, 200)}`);
}
