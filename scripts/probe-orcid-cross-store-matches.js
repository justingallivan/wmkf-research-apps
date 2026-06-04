#!/usr/bin/env node
/**
 * READ-ONLY probe (S216): now that ~1,533 `wmkf_potentialreviewers` rows carry an
 * authoritative ORCID (S215 backfill), measure HOW MANY CROSS-STORE MATCHES ORCID
 * ACTUALLY RESOLVES — the input to the "de-fragment the disjoint reviewer identity
 * stores" decision ([[reviewer-identity-fragmentation]]).
 *
 * SUPERSEDED ASSUMPTION (kept for honesty): this probe was written believing the
 * GOapply-sourced stores carry no ORCID natively, so EMAIL is the only join. That was
 * FALSIFIED — `contact` HAS a native `wmkf_orcid` (423 populated) — see
 * `probe-orcid-contact-direct-join.js` and `probe-contact-orcid-provenance.js`. ORCID's
 * cross-store power is still two distinct things, measured separately here:
 *   (B) DIRECT: collapse duplicate person rows WITHIN the reviewer pool, where ORCID
 *       is present on both sides (ORCID catches dups that email/name miss).
 *   (C/D) BRIDGE: for the GOapply stores, ORCID can only become a durable join key
 *       AFTER it is back-propagated via the email/contact-pointer bridge. We measure
 *       how many reviewers that bridge would reach.
 *
 * Phases (all GETs except the OAuth token POST):
 *   A. Pool composition — total / has-email / has-ORCID / has-both / already-promoted.
 *   B. Within-pool ORCID dedup — group ORCID-bearing rows by normalized iD; how many
 *      humans are fragmented across >1 row, and how many of those email would MISS.
 *   C. reviewer -> contact — (1) already linked via _wmkf_contact_value; (2) of the
 *      rest, how many match an existing `contact` by email (batched OR filters) — the
 *      back-propagation target count. Also: does `contact` carry an ORCID attr at all?
 *   D. reviewer -> honorarium akoya_request — join the honorarium rows' primary
 *      contact back to the pool (by contactid and by email); how many paid reviewers
 *      are ORCID-resolved in our pool.
 *
 * STRICTLY READ-ONLY. No writes. Output: console summary + scripts/.orcid-cross-store.json
 *   node scripts/probe-orcid-cross-store-matches.js
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}

const API = `${process.env.DYNAMICS_URL}/api/data/v9.2`;

async function getToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET, scope: `${process.env.DYNAMICS_URL}/.default`,
    }),
  });
  if (!r.ok) throw new Error(`Token: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}

// Paginating GET that follows @odata.nextLink fully (no 5000 cap).
async function getAll(token, urlPath) {
  let next = `${API}${urlPath}`;
  const rows = [];
  while (next) {
    const r = await fetch(next, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0' },
    });
    const t = await r.text();
    let body; try { body = JSON.parse(t); } catch { body = t; }
    if (!r.ok) throw new Error(`GET ${urlPath.slice(0, 80)}: ${r.status} ${typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`);
    if (body.value) { for (const v of body.value) rows.push(v); next = body['@odata.nextLink']; }
    else return body;
  }
  return { value: rows };
}

// Normalize an ORCID value (bare iD or full URL) to its 19-char canonical iD, or null.
function normOrcid(v) {
  if (!v) return null;
  const m = String(v).match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i);
  return m ? m[1].toUpperCase() : null;
}
const normEmail = (e) => (e || '').trim().toLowerCase() || null;
const escOData = (s) => String(s).replace(/'/g, "''");

(async () => {
  const token = await getToken();
  const stamp = new Date().toISOString();
  console.log(`ORCID cross-store match probe — ${stamp} (READ-ONLY)\n${'='.repeat(70)}`);

  // ---- Phase A: pool composition --------------------------------------------
  const PR_SELECT = 'wmkf_potentialreviewersid,wmkf_name,wmkf_firstname,wmkf_lastname,wmkf_emailaddress,wmkf_orcid,_wmkf_contact_value';
  const reviewers = (await getAll(token, `/wmkf_potentialreviewerses?$select=${PR_SELECT}`)).value;
  const total = reviewers.length;
  for (const r of reviewers) { r._orcid = normOrcid(r.wmkf_orcid); r._email = normEmail(r.wmkf_emailaddress); }
  const withEmail = reviewers.filter((r) => r._email);
  const withOrcid = reviewers.filter((r) => r._orcid);
  const withBoth = reviewers.filter((r) => r._orcid && r._email);
  const promoted = reviewers.filter((r) => r._wmkf_contact_value);
  const orcidPromoted = withOrcid.filter((r) => r._wmkf_contact_value);

  console.log(`\nPHASE A — reviewer pool composition`);
  console.log(`  total rows:                 ${total}`);
  console.log(`  with email:                 ${withEmail.length} (${pct(withEmail.length, total)})`);
  console.log(`  with ORCID:                 ${withOrcid.length} (${pct(withOrcid.length, total)})`);
  console.log(`  with ORCID AND email:       ${withBoth.length}`);
  console.log(`  already promoted (->contact via _wmkf_contact_value): ${promoted.length}`);
  console.log(`     of which ORCID-bearing:  ${orcidPromoted.length}`);

  // ---- Phase B: within-pool ORCID dedup -------------------------------------
  const byOrcid = new Map();
  for (const r of withOrcid) {
    if (!byOrcid.has(r._orcid)) byOrcid.set(r._orcid, []);
    byOrcid.get(r._orcid).push(r);
  }
  const dupOrcidGroups = [...byOrcid.entries()].filter(([, rows]) => rows.length > 1);
  const dupRows = dupOrcidGroups.reduce((a, [, rows]) => a + rows.length, 0);
  const dupCollapsedTo = dupOrcidGroups.length;
  // Of the dup groups, how many would EMAIL miss (rows share ORCID but NOT a single email)?
  let emailWouldMiss = 0;
  for (const [, rows] of dupOrcidGroups) {
    const emails = new Set(rows.map((r) => r._email).filter(Boolean));
    const noEmail = rows.some((r) => !r._email);
    if (emails.size > 1 || (emails.size >= 1 && noEmail) || emails.size === 0) emailWouldMiss++;
  }

  console.log(`\nPHASE B — within-pool ORCID dedup (ORCID present on both sides = DIRECT match)`);
  console.log(`  distinct ORCID iDs:         ${byOrcid.size}`);
  console.log(`  ORCIDs on >1 row (frag humans): ${dupCollapsedTo}`);
  console.log(`  reviewer rows in those groups:  ${dupRows}  (collapse ${dupRows} rows -> ${dupCollapsedTo} humans, ${dupRows - dupCollapsedTo} merges)`);
  console.log(`  of those groups, email-join would MISS (no shared single email): ${emailWouldMiss}`);
  if (dupOrcidGroups.length) {
    console.log(`  sample dup groups:`);
    for (const [oid, rows] of dupOrcidGroups.slice(0, 8)) {
      console.log(`    ${oid}: ${rows.map((r) => `"${r.wmkf_name}"<${r._email || 'no-email'}>`).join('  |  ')}`);
    }
  }

  // ---- Phase C: reviewer -> contact (email bridge) --------------------------
  // Does `contact` carry an ORCID attribute natively? (metadata)
  let contactHasOrcidAttr = 'unknown';
  try {
    const attrs = (await getAll(token,
      `/EntityDefinitions(LogicalName='contact')/Attributes?$select=LogicalName`)).value || [];
    const hits = attrs.map((a) => a.LogicalName).filter((n) => /orcid/i.test(n));
    contactHasOrcidAttr = hits.length ? hits.join(',') : 'NONE';
  } catch (e) { contactHasOrcidAttr = `metadata-err: ${e.message.slice(0, 60)}`; }

  // For ORCID reviewers with email but NOT yet promoted: match an existing contact by email.
  const orcidEmailNoContact = withBoth.filter((r) => !r._wmkf_contact_value);
  const matchableEmails = [...new Set(orcidEmailNoContact.map((r) => r._email))];
  const contactByEmail = new Map(); // email -> contactid
  const BATCH = 15;
  for (let i = 0; i < matchableEmails.length; i += BATCH) {
    const slice = matchableEmails.slice(i, i + BATCH);
    const filter = slice.map((e) => `emailaddress1 eq '${escOData(e)}'`).join(' or ');
    const found = (await getAll(token,
      `/contacts?$select=contactid,emailaddress1&$filter=${encodeURIComponent(filter)}`)).value;
    for (const c of found) { const e = normEmail(c.emailaddress1); if (e && !contactByEmail.has(e)) contactByEmail.set(e, c.contactid); }
    if ((i / BATCH) % 10 === 0) process.stdout.write(`    …contact email-match ${Math.min(i + BATCH, matchableEmails.length)}/${matchableEmails.length}\r`);
  }
  const emailBridgeHits = orcidEmailNoContact.filter((r) => contactByEmail.has(r._email)).length;

  console.log(`\nPHASE C — reviewer -> contact bridge`);
  console.log(`  contact ORCID attribute present?  ${contactHasOrcidAttr}`);
  console.log(`  ORCID reviewers already linked to a contact: ${orcidPromoted.length}`);
  console.log(`  ORCID reviewers w/ email, not yet linked:    ${orcidEmailNoContact.length}`);
  console.log(`     of those, email matches an existing contact: ${emailBridgeHits} (${pct(emailBridgeHits, orcidEmailNoContact.length)})`);
  console.log(`  => total ORCID reviewers reachable to a contact (linked + email-match): ${orcidPromoted.length + emailBridgeHits}`);

  // ---- Phase D: reviewer -> honorarium akoya_request ------------------------
  let honorarium = { ok: false };
  try {
    const progs = (await getAll(token,
      `/akoya_programs?$select=akoya_programid,akoya_program&$filter=${encodeURIComponent("akoya_program eq 'Research Reviewer'")}`)).value;
    if (!progs.length) throw new Error('no Research Reviewer program');
    const pid = progs[0].akoya_programid;
    const honRows = (await getAll(token,
      `/akoya_requests?$select=akoya_requestid,_akoya_primarycontactid_value,createdon&$filter=${encodeURIComponent(`_akoya_programid_value eq ${pid}`)}`)).value;
    const honContactIds = new Set(honRows.map((h) => h._akoya_primarycontactid_value).filter(Boolean));
    // pull those contacts' emails
    const honContactEmail = new Map(); // contactid -> email
    const ids = [...honContactIds];
    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH);
      const filter = slice.map((id) => `contactid eq ${id}`).join(' or ');
      const found = (await getAll(token, `/contacts?$select=contactid,emailaddress1&$filter=${encodeURIComponent(filter)}`)).value;
      for (const c of found) honContactEmail.set(c.contactid, normEmail(c.emailaddress1));
    }
    // join honorarium contact -> reviewer pool, by contact pointer and by email
    const prByContact = new Map(reviewers.filter((r) => r._wmkf_contact_value).map((r) => [r._wmkf_contact_value, r]));
    const prByEmail = new Map();
    for (const r of withEmail) if (!prByEmail.has(r._email)) prByEmail.set(r._email, r);
    let matchedByContact = 0, matchedByEmail = 0, orcidResolved = 0;
    const matchedReviewerIds = new Set();
    for (const cid of honContactIds) {
      let r = prByContact.get(cid);
      if (r) matchedByContact++;
      if (!r) { const e = honContactEmail.get(cid); if (e && prByEmail.has(e)) { r = prByEmail.get(e); matchedByEmail++; } }
      if (r) { matchedReviewerIds.add(r.wmkf_potentialreviewersid); if (r._orcid) orcidResolved++; }
    }
    honorarium = {
      ok: true, honRows: honRows.length, honContacts: honContactIds.size,
      matchedByContact, matchedByEmail, matchedTotal: matchedReviewerIds.size, orcidResolved,
    };
    console.log(`\nPHASE D — reviewer -> honorarium akoya_request (paid Research Reviewers)`);
    console.log(`  honorarium request rows:        ${honRows.length}`);
    console.log(`  distinct primary contacts:      ${honContactIds.size}`);
    console.log(`  matched into reviewer pool:     ${honorarium.matchedTotal}  (by contact-ptr ${matchedByContact}, by email ${matchedByEmail})`);
    console.log(`     of which ORCID-resolved:     ${orcidResolved}`);
  } catch (e) {
    console.log(`\nPHASE D — honorarium join SKIPPED: ${e.message}`);
  }

  // ---- write machine-readable artifact --------------------------------------
  const out = {
    stamp,
    poolComposition: { total, withEmail: withEmail.length, withOrcid: withOrcid.length, withBoth: withBoth.length, promoted: promoted.length, orcidPromoted: orcidPromoted.length },
    withinPoolDedup: { distinctOrcids: byOrcid.size, dupGroups: dupCollapsedTo, rowsInDupGroups: dupRows, merges: dupRows - dupCollapsedTo, emailWouldMiss },
    contactBridge: { contactHasOrcidAttr, alreadyLinked: orcidPromoted.length, candidatesToMatch: orcidEmailNoContact.length, emailBridgeHits, totalReachable: orcidPromoted.length + emailBridgeHits },
    honorarium,
  };
  fs.writeFileSync(path.join(__dirname, '.orcid-cross-store.json'), JSON.stringify(out, null, 2));
  console.log(`\n${'='.repeat(70)}\nArtifact: scripts/.orcid-cross-store.json`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

function pct(x, n) { return n ? `${((x / n) * 100).toFixed(1)}%` : '0%'; }
