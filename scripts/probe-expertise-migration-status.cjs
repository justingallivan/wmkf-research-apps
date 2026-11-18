#!/usr/bin/env node
/** Read-only migration status: aggregate Postgres evidence and Dataverse schema/profile census.
 * No names, emails, GUIDs, credentials or expertise text are printed.
 * Usage: node scripts/probe-expertise-migration-status.cjs [--target=sandbox|prod]
 * Production requires the OWNER to enable DATAVERSE_ALLOW_PROD_READS=yes.
 */
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client');
const { classifyTarget } = require('../lib/dataverse/core/interlock.js');
const { SANDBOX_HOSTS } = require('../lib/dataverse/core/target-registry.js');
const { Client } = require('pg');
let sourceRows = [];

async function postgres() {
  const raw = process.env.POSTGRES_URL;
  if (!raw) return { unavailable: 'POSTGRES_URL missing' };
  const url = new URL(raw);
  const client = new Client({ connectionString: raw, connectionTimeoutMillis: 15000 });
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '20s'");
    const query = async (sql, args) => (await client.query(sql, args)).rows;
    const result = {
      host: url.hostname,
      identity: await query('SELECT current_database() AS database, current_schema() AS schema, current_setting(\'transaction_read_only\') AS read_only, version() AS version'),
      tables: await query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE 'expertise%' OR table_name='consultant_feedback') ORDER BY table_name"),
    };
    const exists = name => result.tables.some(t => t.table_name === name);
    if (exists('expertise_roster')) {
      sourceRows = await query('SELECT * FROM expertise_roster ORDER BY id');
      result.roster = await query('SELECT role_type, is_active, count(*)::int AS rows, count(dataverse_contact_id)::int AS linked_contacts FROM expertise_roster GROUP BY role_type,is_active ORDER BY role_type,is_active');
      result.rosterDates = await query('SELECT count(*)::int AS rows, min(created_at) AS first_created, max(created_at) AS last_created, max(updated_at) AS last_updated, max(id) AS highest_id FROM expertise_roster');
      result.duplicateLinks = await query('SELECT count(*)::int AS duplicate_contact_groups FROM (SELECT dataverse_contact_id FROM expertise_roster WHERE dataverse_contact_id IS NOT NULL GROUP BY dataverse_contact_id HAVING count(*)>1) x');
      result.duplicateNames = await query('SELECT count(*)::int AS duplicate_name_groups FROM (SELECT lower(trim(name)) FROM expertise_roster GROUP BY lower(trim(name)) HAVING count(*)>1) x');
      result.rosterTriggers = await query("SELECT tgname, pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid='expertise_roster'::regclass AND NOT tgisinternal");
    }
    if (exists('consultant_feedback')) {
      result.feedback = await query('SELECT count(*)::int AS total, count(consultant_roster_id)::int AS roster_references, count(DISTINCT consultant_roster_id)::int AS distinct_roster_ids, count(*) FILTER (WHERE consultant_roster_id=35)::int AS excluded_placeholder_references FROM consultant_feedback');
      result.feedbackForeignKeys = await query("SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='consultant_feedback'::regclass AND contype='f'");
    }
    if (exists('expertise_matches')) result.matchHistory = await query('SELECT count(*)::int AS rows, max(created_at) AS latest FROM expertise_matches');
    result.migrations = await query("SELECT name, applied_at FROM schema_migrations WHERE name ILIKE '%expertise%' OR name ILIKE '%roster%' ORDER BY name");
    for (const table of ['expertise_roster_identity', 'expertise_roster_binding']) {
      if (exists(table)) result[table] = await query(`SELECT count(*)::int AS rows FROM ${table}`);
    }
    await client.query('ROLLBACK');
    return result;
  } finally { await client.end(); }
}

async function dataverse(target) {
  const resource = target === 'sandbox'
    ? (process.env.DYNAMICS_SANDBOX_URL || `https://${SANDBOX_HOSTS[0]}`)
    : process.env.DYNAMICS_URL;
  if (!resource || classifyTarget(resource) !== (target === 'prod' ? 'production' : 'sandbox')) throw Error('Unregistered target');
  if (process.env.DATAVERSE_TARGET_INTERLOCK !== 'on') throw Error('Interlock must be on');
  const base = { target, host: new URL(resource).hostname };
  if (target === 'prod' && process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') return { ...base, blocked: 'Owner must enable DATAVERSE_ALLOW_PROD_READS=yes; no Production Dataverse requests made' };
  const client = createClient({ resourceUrl: resource.replace(/\/$/, ''), token: await getAccessToken(resource), dryRun: true });
  const get = async path => {
    const r = await client.getWithOptions(path, {}, { timeoutMs: 30000 });
    if (!r.ok) throw Error(`Dataverse GET HTTP ${r.status}`);
    return r.body;
  };
  const meta = await get("/EntityDefinitions?$select=LogicalName,EntitySetName,IsAuditEnabled,IsOptimisticConcurrencyEnabled&$filter=LogicalName eq 'wmkf_expertiseprofile'");
  base.entities = meta.value.map(r => ({logicalName:r.LogicalName,entitySet:r.EntitySetName,auditing:r.IsAuditEnabled?.Value,optimisticConcurrency:r.IsOptimisticConcurrencyEnabled}));
  if (!meta.value.length) {
    base.absenceChecks = [];
    for (const path of ["/EntityDefinitions(LogicalName='wmkf_expertiseprofile')?$select=LogicalName,EntitySetName", '/wmkf_expertiseprofiles?$top=1&$select=wmkf_creationkey']) {
      const response = await client.getWithOptions(path, {}, { timeoutMs: 30000 });
      base.absenceChecks.push({ path, httpStatus: response.status });
    }
    return base;
  }
  base.keys = (await get("/EntityDefinitions(LogicalName='wmkf_expertiseprofile')/Keys?$select=LogicalName,KeyAttributes,EntityKeyIndexStatus")).value.map(r=>({name:r.LogicalName,fields:r.KeyAttributes,status:r.EntityKeyIndexStatus}));
  base.attributes = (await get("/EntityDefinitions(LogicalName='wmkf_expertiseprofile')/Attributes?$select=LogicalName,AttributeType,IsAuditEnabled")).value.filter(r=>r.LogicalName.startsWith('wmkf_')&&r.AttributeType!=='Virtual').map(r=>({name:r.LogicalName,type:r.AttributeType,auditing:r.IsAuditEnabled?.Value}));
  const rows = [];
  const textFields=['role','affiliation','orcid','preferred_email','primary_fields','keywords','subfields_specialties','methods_techniques','distinctions','expertise','keck_affiliation','keck_affiliation_details'];
  const fieldName=k=>'wmkf_'+k.replaceAll('_','');
  let next = `/${meta.value[0].EntitySetName}?$select=wmkf_creationkey,wmkf_name,statecode,wmkf_category,wmkf_contactguid,_wmkf_staffuser_value,wmkf_leadpdeligible,createdon,modifiedon,${textFields.map(fieldName).join(',')}`;
  for (let page=0; next; page++) {
    if (page >= 20) throw Error('Profile census exceeded bound; incomplete');
    if (next.startsWith('http') && new URL(next).origin !== new URL(resource).origin) throw Error('Cross-origin pagination refused');
    const body = await get(next); rows.push(...body.value); next = body['@odata.nextLink'];
  }
  const count = predicate => rows.filter(predicate).length;
  base.profiles = { total: rows.length, active: count(r=>r.statecode===0), inactive: count(r=>r.statecode===1), importedLegacy: count(r=>r.wmkf_creationkey?.startsWith('legacy_')), interactive: count(r=>r.wmkf_creationkey?.startsWith('app_')), direct: count(r=>r.wmkf_creationkey?.startsWith('direct_')), missingCreationKey: count(r=>!r.wmkf_creationkey), contactLinks: count(r=>!!r.wmkf_contactguid), userLinks: count(r=>!!r._wmkf_staffuser_value), leadEligible: count(r=>r.wmkf_leadpdeligible===true), latestModified: rows.map(r=>r.modifiedon).sort().at(-1)||null };
  const legacy=rows.filter(r=>/^legacy_[0-9a-f-]{36}_\d+$/.test(r.wmkf_creationkey));
  const byId=new Map(legacy.map(r=>[Number(r.wmkf_creationkey.split('_').at(-1)),r]));
  const mismatches=[];
  for(const source of sourceRows){
    const r=byId.get(source.id);if(!r)continue;
    const fields=['name',...textFields].filter(k=>source[k]!==r[fieldName(k)]);
    if(fields.length)mismatches.push({legacyId:source.id,fields});
  }
  base.sourceComparison={sourceRows:sourceRows.length,recognizedLegacyRows:legacy.length,distinctLegacyIds:byId.size,sourceIdsNotImported:sourceRows.filter(r=>!byId.has(r.id)).map(r=>r.id),importedIdsAbsentFromSource:[...byId.keys()].filter(id=>!sourceRows.some(r=>r.id===id)),textMismatches:mismatches,legacyInactive:legacy.filter(r=>r.statecode===1).map(r=>Number(r.wmkf_creationkey.split('_').at(-1))),legacyLeadEligible:legacy.filter(r=>r.wmkf_leadpdeligible===true).map(r=>Number(r.wmkf_creationkey.split('_').at(-1))),legacyUserLinked:legacy.filter(r=>r._wmkf_staffuser_value).map(r=>Number(r.wmkf_creationkey.split('_').at(-1)))};
  return base;
}

(async()=>{
  loadEnvLocal();
  const target=process.argv.find(a=>a.startsWith('--target='))?.split('=')[1]||'sandbox';
  if (!['sandbox','prod'].includes(target)) throw Error('Use --target=sandbox or --target=prod');
  const report={observedAt:new Date().toISOString()};
  for (const [name,probe] of [['postgres',postgres],['dataverse',()=>dataverse(target)]]) {
    try { report[name]=await probe(); }
    catch(e) { report[name]={failed:true,code:e.code||null,message:/HTTP|Interlock|target|bound|pagination/.test(e.message)?e.message:'Connection, authentication, or query failed; no secret-bearing error printed'};process.exitCode=1; }
  }
  const output=JSON.stringify(report,null,2);
  const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6);
  if(out)require('fs').writeFileSync(out,output+'\n',{mode:0o600});
  console.log(output);
})().catch(()=>{console.error('Probe configuration failed');process.exitCode=1;});
