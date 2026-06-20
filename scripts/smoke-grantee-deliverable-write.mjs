#!/usr/bin/env node

/**
 * Write smoke test for the new wmkf_granteedeliverable table (Codex #7).
 * Confirms the app's service principal can create/read/update/delete a package
 * row (the identity used by the external submit + the cron claim, which are
 * SP-attributed, not impersonated). Creates ONE row bound to a real
 * akoya_request, then DELETES it — leaves no residue.
 *
 * READ + transient WRITE (self-cleaning). Exit 0 = SP can write the table.
 *   node scripts/smoke-grantee-deliverable-write.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
const BASE = `${process.env.DYNAMICS_URL}/api/data/v9.2`;

async function token() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET, scope: `${process.env.DYNAMICS_URL}/.default`,
    }),
  });
  if (!r.ok) throw new Error(`token ${r.status}`);
  return (await r.json()).access_token;
}

async function api(tok, method, urlPath, body) {
  const r = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${tok}`, Accept: 'application/json',
      'Content-Type': 'application/json', 'OData-Version': '4.0',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, ok: r.ok, body: text ? (text[0] === '{' ? JSON.parse(text) : text) : null,
    entityId: r.headers.get('OData-EntityId') };
}

(async () => {
  const tok = await token();

  // A real akoya_request to bind the required lookup (alt key is on wmkf_request).
  const reqRes = await api(tok, 'GET', `/akoya_requests?$select=akoya_requestid,akoya_requestnum&$top=1`);
  const reqId = reqRes.body?.value?.[0]?.akoya_requestid;
  if (!reqId) throw new Error('no akoya_request found to bind');
  console.log('bind request:', reqRes.body.value[0].akoya_requestnum, reqId);

  // CREATE
  const create = await api(tok, 'POST', '/wmkf_granteedeliverables', {
    wmkf_name: 'SMOKE TEST - delete me',
    'wmkf_Request@odata.bind': `/akoya_requests(${reqId})`,
    wmkf_deliverablestatus: 100000001,
  });
  console.log('CREATE:', create.status, create.ok ? 'OK' : create.body);
  if (!create.ok) { console.log('VERDICT: SP CANNOT write wmkf_granteedeliverable — privilege grant needed.'); process.exit(1); }
  const idMatch = (create.entityId || '').match(/\(([0-9a-f-]+)\)/i);
  const id = create.body?.wmkf_granteedeliverableid || (idMatch && idMatch[1]);

  // READ
  const read = await api(tok, 'GET', `/wmkf_granteedeliverables(${id})?$select=wmkf_deliverablestatus,_wmkf_request_value`);
  console.log('READ:  ', read.status, read.ok ? `status=${read.body.wmkf_deliverablestatus}` : read.body);

  // UPDATE
  const upd = await api(tok, 'PATCH', `/wmkf_granteedeliverables(${id})`, { wmkf_deliverablestatus: 100000002 });
  console.log('UPDATE:', upd.status, upd.ok ? 'OK' : upd.body);

  // DELETE (cleanup)
  const del = await api(tok, 'DELETE', `/wmkf_granteedeliverables(${id})`);
  console.log('DELETE:', del.status, del.ok ? 'OK (cleaned up)' : del.body);

  const allOk = create.ok && read.ok && upd.ok && del.ok;
  console.log(`\nVERDICT: ${allOk ? 'SP can fully CRUD wmkf_granteedeliverable — app writes work; no table privilege grant needed.' : 'partial — see above.'}`);
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('smoke error:', e.message); process.exit(2); });
