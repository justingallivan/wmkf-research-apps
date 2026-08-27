#!/usr/bin/env node
/**
 * READ-ONLY census of every contact linked as co-PI, classifying emails to
 * find placeholder/phantom links beyond the known `_@_._` contact.
 *
 * BACKGROUND (S422 → S464). The 2026-08-12 phantom co-PI incident
 * (outputs/phantom-copi-incident-2026-08-12.md) matched only the literal
 * email `_@_._`, so its seven-request count is a floor: other placeholder
 * shapes (`x@x.com`, blank, `noemail@…`) would not have appeared. Instead of
 * widening the regex — another floor — this probe enumerates EVERY co-PI
 * link in both stores and classifies every linked contact's email, so the
 * result is a complete census with an explicit denominator.
 *
 * Both co-PI stores are read (the incident showed the bad link lives in two
 * places per request):
 *   - akoya_request._wmkf_copi{1..5}_value slots (what CRM staff see)
 *   - wmkf_apprequestperson rows, role=Co-PI (what the grantee portal reads)
 *
 * Classification buckets (first match wins):
 *   placeholder      punctuation/underscore-only email (the incident shape)
 *   empty            null/blank email
 *   known-test       the Request 1002788 test byline recorded in the incident
 *   suspicious       malformed (no @, no dot after @, trailing dot) or
 *                    throwaway family (test/example/noemail/x@x/…)
 *   duplicate-name   same normalized fullname as another census contact under
 *                    a different contactid (how the original phantom surfaced)
 *   clean            none of the above (reported as a count only)
 *
 * Also reported: cross-store drift (slot links with no junction row and vice
 * versa — the 2026-05-07 backfill is static while the importer is live) and
 * the `_@_._` contact's current link counts vs the recorded 7+7.
 *
 * SAFETY: this script has NO write path — every Dataverse call is a read.
 * Full-list output goes to the terminal; only flagged rows belong in any
 * durable record (clean contacts are genuine people — keep PII out of git).
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-placeholder-copi-census.js
 */

require('./../lib/dataverse/client').loadEnvLocal();

const ROLE_COPI = 100000001;
const SLOTS = [1, 2, 3, 4, 5];
const PLACEHOLDER_RE = /^[_.\-@]+$/;
const KNOWN_TEST_EMAILS = new Set(['abc@uc.com', 'alex@alex.com', 'river@uc.com.']);
const THROWAWAY_TOKENS = new Set([
  'test', 'example', 'none', 'noemail', 'no-email', 'na', 'n/a', 'x', 'xx',
  'fake', 'dummy', 'unknown', 'placeholder', 'temp', 'tbd',
]);
const CONTACT_CHUNK = 15;
const KNOWN_PHANTOM_ID = '2a67a272-9eb5-f011-bbd3-6045bd0510d4';

function classifyEmail(raw) {
  const email = (raw || '').trim().toLowerCase();
  if (!email) return 'empty';
  if (PLACEHOLDER_RE.test(email)) return 'placeholder';
  if (KNOWN_TEST_EMAILS.has(email)) return 'known-test';
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return 'suspicious'; // no @ / multiple @
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (email.endsWith('.')) return 'suspicious'; // trailing dot
  if (!domain.includes('.')) return 'suspicious'; // no TLD
  const domainLabel = domain.split('.')[0];
  if (THROWAWAY_TOKENS.has(local) || THROWAWAY_TOKENS.has(domainLabel)) return 'suspicious';
  if (local.length === 1 && domainLabel.length === 1) return 'suspicious'; // x@y.com family
  if (local === domainLabel && local.length <= 4) return 'suspicious'; // alex@alex.com family
  return 'clean';
}

function assertComplete(label, result) {
  if (result.capped) {
    throw new Error(`${label}: query hit the 5000-record export cap — census would be incomplete. Refusing.`);
  }
  if (result.totalCount && result.records.length < result.totalCount) {
    throw new Error(`${label}: fetched ${result.records.length} of ${result.totalCount} — census would be incomplete. Refusing.`);
  }
}

(async () => {
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');

  await bypassDynamicsRestrictions('probe-placeholder-copi-census', async () => {
    // ── Store 1: co-PI slots on requests ──
    const slotFilter = SLOTS.map((n) => `_wmkf_copi${n}_value ne null`).join(' or ');
    const slotResult = await DynamicsService.queryAllRecords('akoya_requests', {
      select: `akoya_requestid,akoya_requestnum,${SLOTS.map((n) => `_wmkf_copi${n}_value`).join(',')}`,
      filter: slotFilter,
    });
    assertComplete('akoya_requests slot scan', slotResult);

    const slotPairs = []; // { requestId, requestNum, slot, contactId }
    for (const r of slotResult.records) {
      for (const n of SLOTS) {
        const cid = (r[`_wmkf_copi${n}_value`] || '').toLowerCase();
        if (cid) slotPairs.push({ requestId: r.akoya_requestid, requestNum: r.akoya_requestnum, slot: n, contactId: cid });
      }
    }

    // ── Store 2: junction rows, role Co-PI ──
    const junctionResult = await DynamicsService.queryAllRecords('wmkf_apprequestpersons', {
      select: 'wmkf_apprequestpersonid,_wmkf_contact_value,_wmkf_request_value',
      filter: `wmkf_role eq ${ROLE_COPI}`,
    });
    assertComplete('wmkf_apprequestpersons co-PI scan', junctionResult);

    const junctionRows = junctionResult.records.map((j) => ({
      rowId: j.wmkf_apprequestpersonid,
      contactId: (j._wmkf_contact_value || '').toLowerCase(),
      requestId: (j._wmkf_request_value || '').toLowerCase(),
      requestNum: j['_wmkf_request_value_formatted'] || j._wmkf_request_value,
    }));

    // ── Distinct contacts across both stores ──
    const contactIds = [...new Set([
      ...slotPairs.map((p) => p.contactId),
      ...junctionRows.map((j) => j.contactId).filter(Boolean),
    ])];

    const contacts = new Map();
    for (let i = 0; i < contactIds.length; i += CONTACT_CHUNK) {
      const chunk = contactIds.slice(i, i + CONTACT_CHUNK);
      const res = await DynamicsService.queryAllRecords('contacts', {
        select: 'contactid,fullname,emailaddress1,createdon',
        filter: chunk.map((id) => `contactid eq ${id}`).join(' or '),
      });
      assertComplete(`contacts chunk ${i / CONTACT_CHUNK + 1}`, res);
      for (const c of res.records) contacts.set(c.contactid.toLowerCase(), c);
    }

    // ── Classify ──
    const buckets = { placeholder: [], empty: [], 'known-test': [], suspicious: [], clean: [] };
    for (const [id, c] of contacts) {
      buckets[classifyEmail(c.emailaddress1)].push({ id, name: c.fullname, email: c.emailaddress1 || '(empty)', created: c.createdon });
    }

    // Duplicate-identity pass (independent of email bucket; reported separately).
    const byName = new Map();
    for (const [id, c] of contacts) {
      const key = (c.fullname || '').trim().toLowerCase();
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push({ id, email: c.emailaddress1 || '(empty)' });
    }
    const duplicateNames = [...byName.entries()].filter(([, rows]) => rows.length > 1);

    // Cross-store drift on (requestId, contactId) pairs.
    const slotKeySet = new Set(slotPairs.map((p) => `${p.requestId.toLowerCase()}|${p.contactId}`));
    const junctionKeySet = new Set(junctionRows.filter((j) => j.contactId).map((j) => `${j.requestId}|${j.contactId}`));
    const slotOnly = slotPairs.filter((p) => !junctionKeySet.has(`${p.requestId.toLowerCase()}|${p.contactId}`));
    const junctionOnly = junctionRows.filter((j) => j.contactId && !slotKeySet.has(`${j.requestId}|${j.contactId}`));
    const junctionNullContact = junctionRows.filter((j) => !j.contactId);

    // Known phantom's current link counts.
    const phantomSlots = slotPairs.filter((p) => p.contactId === KNOWN_PHANTOM_ID);
    const phantomJunctions = junctionRows.filter((j) => j.contactId === KNOWN_PHANTOM_ID);

    // ── Report ──
    const linkCount = slotPairs.length + junctionRows.length;
    console.log('=== CO-PI CENSUS (read-only) ===');
    console.log(`Requests with ≥1 co-PI slot set: ${slotResult.records.length} (totalCount ${slotResult.totalCount})`);
    console.log(`Slot links: ${slotPairs.length} · Junction co-PI rows: ${junctionRows.length} · Total links: ${linkCount}`);
    console.log(`Distinct linked contacts: ${contactIds.length} (${contacts.size} resolved; ${contactIds.length - contacts.size} unresolvable)`);
    console.log(`\nBuckets: placeholder=${buckets.placeholder.length} empty=${buckets.empty.length} known-test=${buckets['known-test'].length} suspicious=${buckets.suspicious.length} clean=${buckets.clean.length}`);

    for (const bucket of ['placeholder', 'empty', 'known-test', 'suspicious']) {
      if (!buckets[bucket].length) continue;
      console.log(`\n-- ${bucket.toUpperCase()} --`);
      for (const c of buckets[bucket]) {
        const links = [
          ...slotPairs.filter((p) => p.contactId === c.id).map((p) => `slot copi${p.slot}@${p.requestNum}`),
          ...junctionRows.filter((j) => j.contactId === c.id).map((j) => `junction@${j.requestNum}`),
        ];
        console.log(`  ${c.name}  [${c.id}]  ${c.email}  created ${c.created}`);
        console.log(`    links: ${links.join(', ')}`);
      }
    }

    console.log(`\n-- DUPLICATE NAMES within census (${duplicateNames.length} group(s)) --`);
    for (const [name, rows] of duplicateNames) {
      console.log(`  ${name}: ${rows.map((r) => `${r.id} <${r.email}>`).join(' · ')}`);
    }

    console.log(`\n-- CROSS-STORE DRIFT --`);
    console.log(`Slot links with no junction row: ${slotOnly.length}`);
    for (const p of slotOnly) console.log(`  copi${p.slot}@${p.requestNum} → ${p.contactId}`);
    console.log(`Junction rows with no slot link: ${junctionOnly.length}`);
    for (const j of junctionOnly) console.log(`  junction ${j.rowId} @${j.requestNum} → ${j.contactId}`);
    if (junctionNullContact.length) {
      console.log(`Junction co-PI rows with NULL contact: ${junctionNullContact.length}`);
      for (const j of junctionNullContact) console.log(`  junction ${j.rowId} @${j.requestNum}`);
    }

    console.log(`\n-- KNOWN PHANTOM ${KNOWN_PHANTOM_ID} --`);
    console.log(`Current links: ${phantomSlots.length} slot(s), ${phantomJunctions.length} junction row(s) (incident recorded 7+7)`);

    console.log('\nRead-only census complete. No writes were performed.');
  });
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
