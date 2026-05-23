#!/usr/bin/env node
/**
 * Smoke test for IntakeDraftService and IntakeAuditService.
 * Exercises upsert/get/list/append/remove/delete + audit logging
 * against the local Postgres. Cleans up after itself.
 *
 * Usage: node scripts/smoke-intake-draft.js
 */

const fs = require('fs');
const path = require('path');

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
    process.env[k] = v;
  }
}

const { sql } = require('@vercel/postgres');
const IntakeDraftService = require('../lib/services/intake-draft-service');
const IntakeAuditService = require('../lib/services/intake-audit-service');

const ACCOUNT = '00000000-0000-0000-0000-000000000aaa';
const REQUEST = '00000000-0000-0000-0000-000000000bbb';
const CONTACT_OID = 'smoke-test-oid-' + Date.now();
const FORM_KEY = 'phase-ii-research-2026-06';

// Second contact for the contact-scoped requestless-branch tests added in P3.
const CONTACT_OID_2 = 'smoke-test-oid-2-' + Date.now();

async function cleanup() {
  await sql`DELETE FROM intake_drafts WHERE account_id = ${ACCOUNT}`;
  await sql`DELETE FROM intake_audit WHERE actor_oid IN (${CONTACT_OID}, ${CONTACT_OID_2})`;
}

function check(label, cond, ...details) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}`, ...details);
    process.exitCode = 1;
  }
}

(async () => {
  try {
    await cleanup();

    console.log('1. upsert (insert path, with request_id)');
    const created = await IntakeDraftService.upsert({
      contactOid: CONTACT_OID,
      accountId: ACCOUNT,
      requestId: REQUEST,
      formKey: FORM_KEY,
      draftJson: { title: 'first' },
      attachments: [],
    });
    check('row created', !!created?.id);
    check('draft_json.title=first', created.draft_json.title === 'first');

    console.log('2. upsert again with same key updates in place');
    const updated = await IntakeDraftService.upsert({
      contactOid: CONTACT_OID,
      accountId: ACCOUNT,
      requestId: REQUEST,
      formKey: FORM_KEY,
      draftJson: { title: 'second' },
      attachments: [],
    });
    check('same row id (no duplicate)', updated.id === created.id);
    check('draft_json.title=second', updated.draft_json.title === 'second');

    console.log('3. getByKey round-trip');
    const fetched = await IntakeDraftService.getByKey({
      accountId: ACCOUNT,
      requestId: REQUEST,
      formKey: FORM_KEY,
    });
    check('fetched matches', fetched?.id === created.id);

    console.log('4. appendAttachment');
    const a1 = { filename: 'a.pdf', blob_url: 'blob://a', sha256: 'aa', size: 100, uploaded_at: new Date().toISOString() };
    const a2 = { filename: 'b.pdf', blob_url: 'blob://b', sha256: 'bb', size: 200, uploaded_at: new Date().toISOString() };
    await IntakeDraftService.appendAttachment(created.id, a1);
    const afterAppend = await IntakeDraftService.appendAttachment(created.id, a2);
    check('attachments has 2', afterAppend.attachments.length === 2);
    check('first is a.pdf', afterAppend.attachments[0].filename === 'a.pdf');

    console.log('5. removeAttachment by blob_url');
    const afterRemove = await IntakeDraftService.removeAttachment(created.id, 'blob://a');
    check('attachments has 1', afterRemove.attachments.length === 1);
    check('remaining is b.pdf', afterRemove.attachments[0].filename === 'b.pdf');

    console.log('6. listByContact / listByAccount');
    const byContact = await IntakeDraftService.listByContact(CONTACT_OID);
    check('listByContact returns 1', byContact.length === 1);
    const byAccount = await IntakeDraftService.listByAccount(ACCOUNT);
    check('listByAccount returns 1', byAccount.length === 1);

    console.log('7. second draft against the same account but a different request_id');
    const REQUEST_2 = '00000000-0000-0000-0000-000000000ccc';
    const second = await IntakeDraftService.upsert({
      contactOid: CONTACT_OID,
      accountId: ACCOUNT,
      requestId: REQUEST_2,
      formKey: FORM_KEY,
      draftJson: { title: 'sibling' },
      attachments: [],
    });
    check('sibling row got distinct id', second.id !== created.id);
    const byAccount2 = await IntakeDraftService.listByAccount(ACCOUNT);
    check('listByAccount now returns 2', byAccount2.length === 2);

    console.log('8. audit log + retrieval');
    const auditId = await IntakeAuditService.log({
      actorOid: CONTACT_OID,
      actorType: 'applicant',
      action: 'draft.upsert',
      targetEntity: 'intake_drafts',
      targetId: String(created.id),
      payload: { title: 'second' },
      metadata: { ip: '127.0.0.1' },
    });
    check('audit row inserted', !!auditId);

    const auditRows = await IntakeAuditService.queryByActor(CONTACT_OID);
    check('audit queryable', auditRows.length === 1);
    check('payload_digest is sha256-hex', /^[0-9a-f]{64}$/.test(auditRows[0].payload_digest));
    check('payload bytes NOT stored', !('payload' in auditRows[0]));

    console.log('9. invalid actorType returns null without throwing');
    const bad = await IntakeAuditService.log({ actorType: 'nonsense', action: 'x' });
    check('bad actorType → null', bad === null);

    console.log('10. P3 — requestless drafts are contact-scoped');
    // Two contacts at the same institution can both hold active requestless drafts
    // for the same form. Pre-P3, the second upsert would have collided with the first
    // because the partial-unique was (account_id, form_key) — collapsing both contacts'
    // drafts into one row. After P3, the index is (contact_oid, account_id, form_key).
    const c1Requestless = await IntakeDraftService.upsert({
      contactOid: CONTACT_OID,
      accountId: ACCOUNT,
      requestId: null,
      formKey: FORM_KEY,
      draftJson: { title: 'contact-1-draft' },
      attachments: [],
    });
    check('contact 1 requestless draft created', !!c1Requestless?.id);

    const c2Requestless = await IntakeDraftService.upsert({
      contactOid: CONTACT_OID_2,
      accountId: ACCOUNT,
      requestId: null,
      formKey: FORM_KEY,
      draftJson: { title: 'contact-2-draft' },
      attachments: [],
    });
    check('contact 2 requestless draft created at same (account,form)', !!c2Requestless?.id);
    check('contact-scoped: distinct rows, not collapsed', c1Requestless.id !== c2Requestless.id);

    // Repeated upsert from contact 1 updates contact 1's row only — does not
    // touch contact 2's parallel row.
    const c1Again = await IntakeDraftService.upsert({
      contactOid: CONTACT_OID,
      accountId: ACCOUNT,
      requestId: null,
      formKey: FORM_KEY,
      draftJson: { title: 'contact-1-updated' },
      attachments: [],
    });
    check('contact 1 re-upsert hits same row', c1Again.id === c1Requestless.id);
    check('contact 1 row now has updated title', c1Again.draft_json.title === 'contact-1-updated');

    const c2Untouched = await IntakeDraftService.getByKey({
      contactOid: CONTACT_OID_2,
      accountId: ACCOUNT,
      requestId: null,
      formKey: FORM_KEY,
    });
    check('contact 2 row untouched by contact 1 upsert',
      c2Untouched?.draft_json?.title === 'contact-2-draft');

    // getByKey requestless branch requires contactOid (P3 contract).
    let threw = null;
    try {
      await IntakeDraftService.getByKey({ accountId: ACCOUNT, requestId: null, formKey: FORM_KEY });
    } catch (e) { threw = e; }
    check('getByKey requestless without contactOid throws', threw?.message?.includes('contactOid'));

    await IntakeDraftService.delete(c1Requestless.id);
    await IntakeDraftService.delete(c2Requestless.id);

    console.log('11. delete + listByContact empty');
    await IntakeDraftService.delete(created.id);
    await IntakeDraftService.delete(second.id);
    const empty = await IntakeDraftService.listByContact(CONTACT_OID);
    check('listByContact returns 0 after delete', empty.length === 0);

    await cleanup();
    if (process.exitCode) {
      console.log('\nFAIL');
    } else {
      console.log('\nOK');
    }
    process.exit(process.exitCode || 0);
  } catch (e) {
    console.error('threw:', e.message);
    console.error(e.stack);
    await cleanup().catch(() => {});
    process.exit(1);
  }
})();
