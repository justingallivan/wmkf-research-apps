#!/usr/bin/env node
/**
 * Remediate phantom co-PI links created by a placeholder-email contact.
 *
 * BACKGROUND (S422). Request 1002132's grantee portal rendered the byline
 * "Heinrich Jaeger and Yvonne Mariajimenez". Yvonne is unrelated to the
 * proposal: a duplicate contact carrying the placeholder email `_@_._`, created
 * 2025-10-30T14:41:07Z — two minutes after the request itself, in the same
 * import batch. Whatever populated `akoya_request.wmkf_copi1` on import matched
 * that placeholder for co-PIs with no email, so ONE junk contact became Co-PI 1
 * on seven unrelated requests. The 2026-05-07 backfill
 * (scripts/backfill-request-person-junction.js) then faithfully copied each slot
 * into the wmkf_apprequestperson junction.
 *
 * The bad link therefore lives in TWO places per request, and clearing only one
 * is not a fix:
 *   - akoya_request._wmkf_copi{1..5}_value   (what CRM staff see on the form)
 *   - wmkf_apprequestperson row, role=Co-PI  (what the grantee portal reads —
 *     lib/services/grantee-document-assembly.js:117 → fetchCoPIs)
 *
 * This script clears both. It does NOT deactivate or merge the duplicate
 * contact (owner decision — her genuine record at nlsla.org must survive), and
 * it does NOT address the upstream importer that keeps creating these links.
 *
 * SAFETY
 *   - --dry-run (default) performs zero writes and prints the full plan.
 *   - --execute additionally requires the interlock's same-UTC-day
 *     DATAVERSE_PROD_WRITE_ACK="<purpose> <YYYY-MM-DD>" against production.
 *   - Every target contact's email is RE-READ and must match the placeholder
 *     pattern exactly before anything is touched — a contact holding a real
 *     address is refused, so a genuine co-PI can never be unlinked.
 *   - Refuses above MAX_ROWS affected rows; a larger blast radius means the
 *     assumption behind this script is wrong and wants a human first.
 *   - Nav property names are resolved from live metadata, never guessed
 *     (ReferencingEntityNavigationPropertyName — the relationship SchemaName is
 *     NOT it for custom lookups; see probe-akoya-potentialreviewer-slot-navprops).
 *
 * Usage:
 *   node scripts/remediate-placeholder-copi.js --dry-run
 *   DATAVERSE_PROD_WRITE_ACK="remediate placeholder co-PI 2026-08-12" \
 *     node scripts/remediate-placeholder-copi.js --execute
 *   node scripts/remediate-placeholder-copi.js --dry-run --email '_@_._'
 */

require('./../lib/dataverse/client').loadEnvLocal();

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const EXECUTE = args.includes('--execute');
const EMAIL = (() => {
  const i = args.indexOf('--email');
  return i >= 0 ? args[i + 1] : '_@_._';
})();

if (DRY === EXECUTE) {
  console.error('Pass exactly one of --dry-run or --execute. Refusing to guess.');
  process.exit(2);
}

const ROLE_COPI = 100000001;
const SLOTS = [1, 2, 3, 4, 5];
const MAX_ROWS = 25;

// A placeholder address is punctuation/underscores only — no real mailbox can
// match. Anything else is treated as a real contact and refused.
const PLACEHOLDER_RE = /^[_.\-@]+$/;

(async () => {
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');

  await bypassDynamicsRestrictions('remediate-placeholder-copi', async () => {
    if (!PLACEHOLDER_RE.test(EMAIL)) {
      throw new Error(`Refusing: --email "${EMAIL}" does not look like a placeholder address.`);
    }

    // ── Resolve the offending contact(s) ──
    const { records: contacts } = await DynamicsService.queryRecords('contacts', {
      select: 'contactid,fullname,emailaddress1',
      filter: `emailaddress1 eq '${EMAIL}'`,
      top: 50,
    });
    if (!contacts.length) {
      console.log(`No contact carries the placeholder email "${EMAIL}". Nothing to do.`);
      return;
    }
    console.log(`Placeholder contacts matching "${EMAIL}": ${contacts.length}`);
    for (const c of contacts) console.log(`  ${c.fullname}  [${c.contactid}]`);

    // Re-verify each address rather than trusting the filter round-trip.
    for (const c of contacts) {
      if (!PLACEHOLDER_RE.test(c.emailaddress1 || '')) {
        throw new Error(`Refusing: contact ${c.contactid} has real-looking email "${c.emailaddress1}".`);
      }
    }

    // ── Resolve slot nav property names from live metadata ──
    const token = await DynamicsService.getAccessToken();
    const metaUrl = `${process.env.DYNAMICS_URL}/api/data/v9.2/EntityDefinitions(LogicalName='akoya_request')/ManyToOneRelationships`
      + '?$select=ReferencingAttribute,ReferencingEntityNavigationPropertyName';
    const metaResp = await fetch(metaUrl, { headers: DynamicsService.buildHeaders(token) });
    if (!metaResp.ok) throw new Error(`metadata fetch ${metaResp.status}: ${await metaResp.text()}`);
    const navByAttr = new Map();
    for (const r of (await metaResp.json()).value || []) {
      const m = /^_?(wmkf_copi[1-5])(_value)?$/i.exec(r.ReferencingAttribute || '');
      if (m) navByAttr.set(m[1].toLowerCase(), r.ReferencingEntityNavigationPropertyName);
    }
    console.log('\nResolved co-PI slot nav properties:');
    for (const s of SLOTS) console.log(`  wmkf_copi${s} → ${navByAttr.get(`wmkf_copi${s}`) || '(NOT FOUND)'}`);

    // ── Build the plan ──
    const slotOps = [];
    const junctionOps = [];
    for (const c of contacts) {
      const { records: reqs } = await DynamicsService.queryRecords('akoya_requests', {
        select: `akoya_requestid,akoya_requestnum,akoya_title,${SLOTS.map((n) => `_wmkf_copi${n}_value`).join(',')}`,
        filter: SLOTS.map((n) => `_wmkf_copi${n}_value eq ${c.contactid}`).join(' or '),
        top: 100,
      });
      for (const r of reqs) {
        for (const n of SLOTS) {
          if ((r[`_wmkf_copi${n}_value`] || '').toLowerCase() !== c.contactid.toLowerCase()) continue;
          const navProp = navByAttr.get(`wmkf_copi${n}`);
          if (!navProp) throw new Error(`No nav property resolved for wmkf_copi${n}; refusing to write.`);
          slotOps.push({
            requestId: r.akoya_requestid, requestNum: r.akoya_requestnum,
            title: r.akoya_title, slot: n, navProp, contact: c.fullname,
          });
        }
      }

      const { records: jrows } = await DynamicsService.queryRecords('wmkf_apprequestpersons', {
        select: 'wmkf_apprequestpersonid,_wmkf_request_value,wmkf_role',
        filter: `_wmkf_contact_value eq ${c.contactid} and wmkf_role eq ${ROLE_COPI}`,
        top: 100,
      });
      for (const j of jrows) {
        junctionOps.push({
          rowId: j.wmkf_apprequestpersonid,
          requestNum: j['_wmkf_request_value_formatted'] || j._wmkf_request_value,
          contact: c.fullname,
        });
      }
    }

    console.log(`\n=== PLAN: ${slotOps.length} slot clear(s), ${junctionOps.length} junction delete(s) ===`);
    for (const op of slotOps) {
      console.log(`  CLEAR  request ${op.requestNum} copi${op.slot} (${op.navProp}) — ${op.contact}`);
      console.log(`         ${String(op.title || '').slice(0, 70)}`);
    }
    for (const op of junctionOps) {
      console.log(`  DELETE junction ${op.rowId} — ${op.contact} on request ${op.requestNum}`);
    }

    const total = slotOps.length + junctionOps.length;
    if (total === 0) { console.log('\nNothing to remediate.'); return; }
    if (total > MAX_ROWS) {
      throw new Error(`Refusing: ${total} affected rows exceeds MAX_ROWS=${MAX_ROWS}. Review manually.`);
    }

    if (DRY) {
      console.log('\nDRY RUN — no writes performed. Re-run with --execute (and a same-UTC-day');
      console.log('DATAVERSE_PROD_WRITE_ACK) to apply exactly the plan above.');
      return;
    }

    // ── Execute ──
    console.log('\nExecuting...');
    let ok = 0; const failures = [];
    for (const op of slotOps) {
      try {
        await DynamicsService.disassociate('akoya_requests', op.requestId, op.navProp);
        console.log(`  cleared  request ${op.requestNum} copi${op.slot}`);
        ok++;
      } catch (e) {
        console.error(`  FAILED   request ${op.requestNum} copi${op.slot}: ${e.message}`);
        failures.push({ op, error: e.message });
      }
    }
    for (const op of junctionOps) {
      try {
        await DynamicsService.deleteRecord('wmkf_apprequestpersons', op.rowId);
        console.log(`  deleted  junction ${op.rowId}`);
        ok++;
      } catch (e) {
        console.error(`  FAILED   junction ${op.rowId}: ${e.message}`);
        failures.push({ op, error: e.message });
      }
    }
    console.log(`\n${ok}/${total} operations succeeded; ${failures.length} failed.`);
    if (failures.length) {
      console.log('Partial success — re-running is safe: the plan is rebuilt from live state,');
      console.log('so already-remediated rows simply drop out of it.');
      process.exitCode = 1;
    }
  });
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
