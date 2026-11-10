#!/usr/bin/env node
/** Owner-scoped read-only roster inventory. No database/Dataverse mutations.
 * Usage: node scripts/inventory-expertise-roster.cjs ENV_FILE NEW_PRIVATE_DIR SOURCE_DATASET_UUID
 * Reads roster, feedback IDs, attendee refs, linked Contacts and User identities.
 * Outputs private evidence only; never prints rows or credentials.
 */
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { fingerprint } = require('./lib/expertise-roster-import-plan.cjs');
async function main() {
  const [envFile, out, datasetId, ...extra] = process.argv.slice(2);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(datasetId || '')) throw Error('Stable source-lineage UUID required; reuse across exports');
  if (!envFile || !out || extra.length || !path.isAbsolute(out)) throw Error('ENV_FILE and absolute NEW_PRIVATE_DIR required');
  const parent = fs.realpathSync(path.dirname(out));
  const git = require('node:child_process').spawnSync('git', ['-C', parent, 'rev-parse', '--is-inside-work-tree'], {encoding:'utf8'});
  if (git.error || git.status === 0) throw Error('Evidence must be outside every Git worktree');
  if (parent !== path.dirname(path.resolve(out))) throw Error('Symlinked evidence parent refused');
  const env = require('dotenv').parse(fs.readFileSync(envFile));
  const connectionString = env.POSTGRES_URL || env.DATABASE_URL;
  if (!connectionString) throw Error('No database connection configured');
  fs.mkdirSync(out, { mode: 0o700 });
  const write = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2)+'\n', { flag: 'wx', mode: 0o600 });
  const aliasIdentities = {};
  for (const key of ['POSTGRES_URL','POSTGRES_URL_NON_POOLING','POSTGRES_PRISMA_URL','DATABASE_URL']) {
    if (!env[key]) { aliasIdentities[key] = {configured:false}; continue; }
    const probe=new Client({connectionString:env[key],connectionTimeoutMillis:15000,statement_timeout:15000,options:'-c default_transaction_read_only=on'});
    try { await probe.connect(); aliasIdentities[key]=(await probe.query("SELECT current_database() AS database, inet_server_addr()::text AS server, current_setting('transaction_read_only') AS read_only")).rows[0]; } finally { await probe.end(); }
  }
  const pg = new Client({ connectionString, application_name: 'roster-readonly-inventory', statement_timeout: 30000, connectionTimeoutMillis: 15000, options: '-c default_transaction_read_only=on' });
  await pg.connect();
  let rows;
  try {
    await pg.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = (await pg.query("SELECT current_database() AS database, inet_server_addr()::text AS server, current_setting('transaction_read_only') AS read_only, version() AS version")).rows[0];
    const columns = (await pg.query("SELECT column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='expertise_roster' ORDER BY ordinal_position")).rows;
    rows = (await pg.query('SELECT * FROM expertise_roster ORDER BY id')).rows;
    const feedback = (await pg.query('SELECT id, consultant_roster_id FROM consultant_feedback WHERE consultant_roster_id IS NOT NULL ORDER BY id')).rows;
    const constraints = (await pg.query("SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('expertise_roster'::regclass,'consultant_feedback'::regclass)")).rows;
    const sequence = (await pg.query('SELECT last_value, is_called FROM expertise_roster_id_seq')).rows;
    const ledger = (await pg.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
    write('source.json', {version:1,datasetId,rows});
    write('postgres-evidence.json', {checkedAt:new Date().toISOString(), identity, aliasIdentities, columns, feedback, constraints, sequence, ledger, sourceHash:fingerprint(rows)});
    for (const [label,host] of [['production','wmkf.crm.dynamics.com'],['sandbox','orgd9e66399.crm.dynamics.com']]) write(`mapping-${label}.json`, {version:1,datasetId,targetHost:host,rows:rows.map(r=>({legacyId:r.id,confirmed:false,staffUserGuid:null,contactGuid:null,leadPdEligible:false,active:r.is_active}))});
    await pg.query('ROLLBACK');
  } finally { await pg.end(); }
  for (const key of ['DYNAMICS_TENANT_ID','DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET']) { if (!env[key]) throw Error(`Missing ${key}`); process.env[key]=env[key]; }
  process.env.DATAVERSE_ALLOW_PROD_READS='yes'; process.env.DATAVERSE_TARGET_INTERLOCK='on'; process.env.DATAVERSE_DAL_ENFORCEMENT='on';
  const {getAccessToken,createClient}=require('../lib/dataverse/client.js');
  const evidence={};
  for (const host of ['wmkf.crm.dynamics.com','orgd9e66399.crm.dynamics.com']) {
    const resourceUrl=`https://${host}`;
    const client=createClient({resourceUrl,token:await getAccessToken(resourceUrl)});
    const get=async p=>{const u=new URL(p,client.baseUrl+'/');if(u.origin!==resourceUrl || !u.pathname.startsWith('/api/data/v9.2/')) throw Error('Unexpected pagination target');const r=await client.get(u.href);if(!r.ok) throw Error(`Dataverse read failed ${host} ${u.pathname.split('/').pop()} HTTP ${r.status}: ${r.body?.error?.code || 'unknown'}`);return r.body;};
    const all=async p=>{let result=[],seen=new Set();while(p){if(seen.has(p)||seen.size>=100)throw Error('Pagination incomplete');seen.add(p);const b=await get(p);if(!Array.isArray(b.value))throw Error('Missing collection');result.push(...b.value);p=b['@odata.nextLink'];}return result;};
    const base=client.baseUrl+'/';
    const metadata=await all(base+"EntityDefinitions?$select=LogicalName,EntitySetName,PrimaryIdAttribute&$filter=LogicalName eq 'wmkf_expertiseprofile' or LogicalName eq 'wmkf_sitevisit' or LogicalName eq 'wmkf_deliberationsession' or LogicalName eq 'wmkf_deliberationslot'");
    const refs={};
    for(const entity of metadata.filter(e=>e.LogicalName!=='wmkf_expertiseprofile')) {
      const attrs=await all(base+`EntityDefinitions(LogicalName='${entity.LogicalName}')/Attributes?$select=LogicalName&$filter=LogicalName eq 'wmkf_attendeerefsjson'`);
      if(!attrs.length) { refs[entity.LogicalName]={unavailable:'wmkf_attendeerefsjson absent in live metadata'}; continue; }
      refs[entity.LogicalName]=await all(base+entity.EntitySetName+'?'+new URLSearchParams({$select:entity.PrimaryIdAttribute+',wmkf_attendeerefsjson'}));
    }
    const users=await all(base+'systemusers?'+new URLSearchParams({$select:'systemuserid,fullname,internalemailaddress,isdisabled',$filter:'isdisabled eq false'}));
    const contacts=[];
    // Production links only belong to Production; never presume sandbox counterparts.
    if(host==='wmkf.crm.dynamics.com') for(const id of [...new Set(rows.map(r=>r.dataverse_contact_id).filter(Boolean))]) {if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('Malformed source Contact GUID');const response=await client.get(`/contacts(${id})?$select=contactid,fullname,emailaddress1,statecode`);if(response.status===404)contacts.push({contactid:id,missing:true});else if(response.ok)contacts.push(response.body);else throw Error(`Contact read HTTP ${response.status}`);}
    evidence[host]={metadata,refs,users,contacts,profileTablePresent:metadata.some(e=>e.LogicalName==='wmkf_expertiseprofile')};
    write(`dataverse-${host}.json`,evidence[host]);
  }
  const summary={checkedAt:new Date().toISOString(),readOnly:true,rosterRows:rows.length,byCategory:{},active:rows.filter(r=>r.is_active).length,linkedContacts:rows.filter(r=>r.dataverse_contact_id).length,sourceHash:fingerprint(rows),dataverse:Object.fromEntries(Object.entries(evidence).map(([h,e])=>[h,{profileTablePresent:e.profileTablePresent,enabledUsers:e.users.length,attendeeRows:Object.fromEntries(Object.entries(e.refs).map(([k,v])=>[k,Array.isArray(v)?v.length:v]))}]))};
  for(const r of rows)summary.byCategory[r.role_type]=(summary.byCategory[r.role_type]||0)+1;
  write('summary.json',summary); console.log(JSON.stringify(summary));
}
main().catch(e=>{console.error(`Inventory incomplete: ${String(e.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]').slice(0,200)}`);process.exitCode=1;});
