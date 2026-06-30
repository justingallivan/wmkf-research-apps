#!/usr/bin/env node
/**
 * READ-ONLY probe: confirm the navigation-property (SchemaName) for each of the
 * five akoya_request applicant-reviewer slot lookups
 * (_wmkf_potentialreviewer1..5_value), so a reviewer-merge slot-repoint can PATCH
 * them via `<NavProp>@odata.bind`. Mutates nothing — every call is a GET except
 * the OAuth token POST.
 *
 *   node scripts/probe-akoya-potentialreviewer-slot-navprops.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');

// Direct metadata select for ReferencingEntityNavigationPropertyName — the exact
// single-valued nav prop used in `<NavProp>@odata.bind` (the relationship
// SchemaName is NOT it for custom lookups). getEntityRelationships doesn't select
// this column, so query EntityDefinitions directly.
const rows = await bypassDynamicsRestrictions('probe-slot-navprops', async () => {
  const token = await DynamicsService.getAccessToken();
  const baseUrl = process.env.DYNAMICS_URL;
  const url = `${baseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='akoya_request')/ManyToOneRelationships`
    + `?$select=SchemaName,ReferencingAttribute,ReferencedEntity,ReferencingEntityNavigationPropertyName`;
  const resp = await fetch(url, { headers: DynamicsService.buildHeaders(token) });
  if (!resp.ok) throw new Error(`metadata fetch ${resp.status}: ${await resp.text()}`);
  return (await resp.json()).value || [];
});

console.log(`akoya_request many-to-one relationships scanned: ${rows.length}`);
const slots = rows
  .filter((r) => /^_?wmkf_potentialreviewer[1-5](_value)?$/i.test(r.ReferencingAttribute || ''))
  .sort((a, b) => String(a.ReferencingAttribute).localeCompare(String(b.ReferencingAttribute)));

console.log('--- applicant-reviewer slot lookups (NavPropName = the @odata.bind name) ---');
for (const r of slots) {
  console.log(JSON.stringify({
    referencingAttribute: r.ReferencingAttribute,
    navPropName: r.ReferencingEntityNavigationPropertyName,
    schemaName: r.SchemaName,
    referencedEntity: r.ReferencedEntity,
  }));
}
if (!slots.length) {
  console.log('NO slot relationships matched. First raw record for shape debugging:');
  console.log(JSON.stringify(rows[0], null, 2));
}
process.exit(0);
