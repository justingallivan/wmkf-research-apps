#!/usr/bin/env node
/** Read-only: show how the Keywords table `wmkf_programlevel3` is shaped and how a Request
 * reaches it, so proposal lists can be grouped by discipline branch and group.
 * Prints: the table's custom columns; every relationship to or from it; Request columns
 * whose name mentions keyword/discipline/programlevel; and the Type / Branch / Group
 * combinations in use with keyword counts. Reads keyword rows only, never Request rows.
 * Owner-run only (production reads need DATAVERSE_ALLOW_PROD_READS=yes set by the owner).
 * Usage: node scripts/probe-keyword-taxonomy.cjs --target=prod */
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const TABLE = 'wmkf_programlevel3';
const COLUMNS = ['wmkf_keyworddisciplinebranch', 'wmkf_keyworddisciplinegroup', 'wmkf_keywordtype'];
(async () => {
  if (arg('target') !== 'prod') throw new Error('Specify --target=prod');
  loadEnvLocal();
  const resourceUrl = process.env.DYNAMICS_URL;
  if (!resourceUrl) throw new Error('Target URL is not configured');
  const c = createClient({ resourceUrl, token: await getAccessToken(resourceUrl), dryRun: true });
  const get = async (path, headers) => {
    const r = await c.get(path, headers);
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${path.split('?')[0]}`);
    return r.body;
  };
  const def = `/EntityDefinitions(LogicalName='${TABLE}')`;

  const entity = await get(`${def}?$select=EntitySetName,PrimaryNameAttribute,PrimaryIdAttribute`);
  console.log(`# ${TABLE}: entity set ${entity.EntitySetName}, name column ${entity.PrimaryNameAttribute}`);

  const attrs = (await get(`${def}/Attributes?$select=LogicalName,AttributeType,IsCustomAttribute`)).value;
  console.log('\n## Custom columns');
  for (const a of attrs.filter((x) => x.IsCustomAttribute).sort((x, y) => x.LogicalName.localeCompare(y.LogicalName))) {
    console.log(`  ${a.LogicalName}  (${a.AttributeType})`);
  }
  const present = new Set(attrs.map((a) => a.LogicalName));
  const missing = COLUMNS.filter((n) => !present.has(n));
  if (missing.length) console.log(`  NOT FOUND under these logical names: ${missing.join(', ')}`);

  console.log('\n## Relationships');
  const m2o = (await get(`${def}/ManyToOneRelationships?$select=ReferencingAttribute,ReferencedEntity`)).value;
  for (const r of m2o.filter((x) => /^(wmkf_|akoya_)/.test(x.ReferencingAttribute))) {
    console.log(`  keyword.${r.ReferencingAttribute} -> ${r.ReferencedEntity}`);
  }
  const o2m = (await get(`${def}/OneToManyRelationships?$select=ReferencingEntity,ReferencingAttribute`)).value;
  for (const r of o2m.filter((x) => /^(wmkf_|akoya_)/.test(x.ReferencingEntity))) {
    console.log(`  ${r.ReferencingEntity}.${r.ReferencingAttribute} -> keyword`);
  }
  const m2m = (await get(`${def}/ManyToManyRelationships?$select=Entity1LogicalName,Entity2LogicalName,IntersectEntityName,SchemaName`)).value;
  for (const r of m2m) {
    console.log(`  many-to-many ${r.Entity1LogicalName} <-> ${r.Entity2LogicalName} via ${r.IntersectEntityName} (${r.SchemaName})`);
  }
  if (!o2m.length && !m2m.length) console.log('  (no table points at keywords)');

  console.log('\n## Request columns that mention keywords');
  const reqAttrs = (await get("/EntityDefinitions(LogicalName='akoya_request')/Attributes?$select=LogicalName,AttributeType")).value;
  const hits = reqAttrs.filter((a) => /keyword|discipline|programlevel/.test(a.LogicalName)).sort((x, y) => x.LogicalName.localeCompare(y.LogicalName));
  for (const a of hits) console.log(`  akoya_request.${a.LogicalName}  (${a.AttributeType})`);
  if (!hits.length) console.log('  (none)');

  console.log('\n## Keyword rows by Type / Branch / Group');
  const selectable = COLUMNS.filter((n) => present.has(n));
  const select = [entity.PrimaryNameAttribute, 'statecode', ...selectable].join(',');
  const rows = [];
  let next = `/${entity.EntitySetName}?$select=${select}`;
  while (next && rows.length < 5000) {
    const page = await get(next, { Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"' });
    rows.push(...page.value);
    next = page['@odata.nextLink'] || null;
  }
  const fmt = (r, k) => r[`${k}@OData.Community.Display.V1.FormattedValue`] ?? r[k] ?? '(blank)';
  console.log(`  ${rows.length} keyword row(s), ${rows.filter((r) => r.statecode === 0).length} active`);
  const combos = new Map();
  for (const r of rows) {
    const key = ['wmkf_keywordtype', 'wmkf_keyworddisciplinebranch', 'wmkf_keyworddisciplinegroup']
      .map((k) => (present.has(k) ? fmt(r, k) : '(no column)')).join('  |  ');
    const entry = combos.get(key) || { n: 0, example: r[entity.PrimaryNameAttribute] };
    entry.n += 1;
    combos.set(key, entry);
  }
  console.log('  Type  |  Branch  |  Group  ->  keywords (one example)');
  for (const [key, v] of [...combos.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${key}  ->  ${v.n} (${v.example})`);
  }
})().catch((e) => { console.error(`Probe failed: ${/HTTP|Specify|Target/.test(e.message) ? e.message : 'authentication or transport failure'}`); process.exitCode = 1; });
