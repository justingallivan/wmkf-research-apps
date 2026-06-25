#!/usr/bin/env node
/**
 * READ-ONLY probe (S289): how many active wmkf_potentialreviewers share an email
 * with a CRM contact — i.e. "already exist as a contact" by email — and of those,
 * how many already carry the _wmkf_contact_value link vs are UNLINKED (the silent
 * dedup gap). Prints counts + a small sample. No writes.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

function fail(m) { console.error(m); process.exit(1); }
function norm(e) { return String(e || '').trim().toLowerCase(); }

async function getAll(client, path, label) {
  const rows = [];
  let p = path;
  let pages = 0;
  while (p) {
    const res = await client.get(p);
    if (!res.ok) fail(`GET ${label} failed (${res.status}): ${res.text}`);
    rows.push(...(res.body?.value || []));
    const next = res.body?.['@odata.nextLink'];
    p = next ? next.replace(/^.*\/api\/data\/v9\.2/, '') : null;
    if (++pages % 10 === 0) process.stderr.write(`  ${label}: ${rows.length} so far…\n`);
  }
  return rows;
}

async function main() {
  loadEnvLocal();
  const url = process.env.DYNAMICS_URL || process.env.DATAVERSE_URL;
  if (!url) fail('Missing DYNAMICS_URL/DATAVERSE_URL');
  const token = await getAccessToken(url);
  const client = createClient({ resourceUrl: url, token });

  // Active potential reviewers with an email.
  const prs = await getAll(client,
    `/wmkf_potentialreviewerses?$select=wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,_wmkf_contact_value,statecode&$filter=statecode eq 0 and wmkf_emailaddress ne null`,
    'potentialreviewers');
  console.log(`Active potential-reviewer rows with email: ${prs.length}`);

  // All contacts with an email (active + inactive). Map normalized email -> [contactid].
  const contacts = await getAll(client,
    `/contacts?$select=contactid,fullname,emailaddress1,statecode&$filter=emailaddress1 ne null`,
    'contacts');
  console.log(`CRM contacts with an email: ${contacts.length}`);
  const contactByEmail = new Map();
  for (const c of contacts) {
    const e = norm(c.emailaddress1);
    if (!e) continue;
    if (!contactByEmail.has(e)) contactByEmail.set(e, []);
    contactByEmail.get(e).push(c);
  }

  // Intersect.
  let matched = 0, linked = 0, unlinked = 0, linkedToDifferent = 0;
  const unlinkedSamples = [];
  for (const pr of prs) {
    const e = norm(pr.wmkf_emailaddress);
    const hits = contactByEmail.get(e);
    if (!hits || hits.length === 0) continue;
    matched++;
    if (pr._wmkf_contact_value) {
      linked++;
      const linkedSame = hits.some((c) => String(c.contactid).toLowerCase() === String(pr._wmkf_contact_value).toLowerCase());
      if (!linkedSame) linkedToDifferent++;
    } else {
      unlinked++;
      if (unlinkedSamples.length < 25) {
        unlinkedSamples.push(`  "${(pr.wmkf_name || '').trim()}" <${pr.wmkf_emailaddress}> -> contact(s): ${hits.map((c) => `"${(c.fullname || '').trim()}" [${c.contactid}]`).join(', ')}`);
      }
    }
  }

  console.log(`\nPotential reviewers whose email matches a CRM contact: ${matched}`);
  console.log(`  already linked via _wmkf_contact_value: ${linked}`);
  console.log(`    (of those, linked to a DIFFERENT contact than the email match): ${linkedToDifferent}`);
  console.log(`  UNLINKED (email exists as a contact but no link set — the dedup gap): ${unlinked}`);
  if (unlinkedSamples.length) {
    console.log(`\nSample unlinked matches (up to 25):`);
    console.log(unlinkedSamples.join('\n'));
  }
}
main().catch((e) => fail(e?.stack || e?.message || String(e)));
