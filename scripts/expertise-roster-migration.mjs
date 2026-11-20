#!/usr/bin/env node
/** Production-only operator tool. Never loads env files or enables interlock flags.
 * node --import ./scripts/lib/use-extensionless.mjs scripts/expertise-roster-migration.mjs
 *   export|plan|import|verify --source=/private/... --mapping=/private/... --out=/private/...
 * import also requires --apply. Source export is exclusive-create; retain its dataset ID.
 * All artifacts contain private roster data: keep them outside the repo, mode 0600.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Client, types } = require('pg');
// Keep timestamp-without-zone provenance literal across operator timezones.
types.setTypeParser(1114, value => value);
const { planImport, fingerprint, applyContactHealth } = require('./lib/expertise-roster-import-plan.cjs');
const { executeImport } = require('./lib/expertise-roster-import-execute.cjs');
const { resolveTargetResource } = require('./lib/dataverse-script-target.cjs');
const { getAccessToken, createClient } = require('../lib/dataverse/client.js');
const contract = require('../lib/services/expertise-finder/roster-contract.cjs');
const spec = require('../lib/dataverse/schema/wave-expertise-roster/wmkf_expertiseprofile.json');
const args = process.argv.slice(2);
const mode = args[0];
if (!['export', 'plan', 'import', 'verify'].includes(mode)) throw Error('Choose export, plan, import, or verify; see the production runbook.');
for (const arg of args.slice(1)) if (!/^--(source|mapping|out)=.+$/.test(arg) && arg !== '--apply') throw Error('Unknown argument.');
const option = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
function privatePath(name) {
  const file = option(name);
  if (!file || !path.isAbsolute(file)) throw Error(`--${name} requires an absolute private path.`);
  const parent = fs.realpathSync(path.dirname(file));
  if (parent === repo || parent.startsWith(repo + path.sep)) throw Error('Keep roster artifacts outside the repository.');
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw Error('Artifact symlinks are not allowed.');
  return path.join(parent, path.basename(file));
}
const out = privatePath('out');
if (fs.existsSync(out)) throw Error('Choose a new output receipt path; existing evidence is never overwritten.');
function writeReceipt(value) { fs.writeFileSync(out, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); }
const pg = new Client({ connectionString: process.env.POSTGRES_URL });
if (!(process.env.POSTGRES_URL)) throw Error('Explicit production Postgres configuration required.');
await pg.connect();
try {
  const rows = (await pg.query('SELECT * FROM expertise_roster ORDER BY id')).rows;
  const feedback = (await pg.query('SELECT DISTINCT consultant_roster_id FROM consultant_feedback WHERE consultant_roster_id IS NOT NULL ORDER BY consultant_roster_id')).rows.map(r => r.consultant_roster_id);
  if (mode === 'export') {
    writeReceipt({ version: 1, datasetId: randomUUID(), exportedAt: new Date().toISOString(), rows, feedbackIds: feedback,
      sequence: (await pg.query('SELECT last_value, is_called FROM expertise_roster_id_seq')).rows[0] });
    console.log('Private source export saved. Retain this dataset identity for retries.');
  } else {
    const source = JSON.parse(fs.readFileSync(privatePath('source'), 'utf8'));
    const mapping = JSON.parse(fs.readFileSync(privatePath('mapping'), 'utf8'));
    // JSON dates normalize pg Date objects identically to the saved export.
    if (fingerprint(JSON.parse(JSON.stringify(rows))) !== fingerprint(source.rows)) throw Error('Source roster changed since export; reconcile before import or cutover.');
    if (feedback.some(id => !source.rows.some(r => r.id === id))) throw Error('Feedback references an identity outside the export.');
    const write = mode === 'import';
    if (write && !args.includes('--apply')) throw Error('Import requires --apply.');
    const resourceUrl = resolveTargetResource({ target: 'prod', write });
    const host = new URL(resourceUrl).hostname;
    if (process.env.EXPERTISE_ROSTER_BACKEND !== 'dataverse') throw Error('This operator process requires EXPERTISE_ROSTER_BACKEND=dataverse (app deployment remains Postgres until cutover).');
    const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
    const checked = async p => { const r = await client.get(p); if (!r.ok) throw Error(`Preflight read failed (${r.status}).`); return r.body; };
    const metadata = await checked("/EntityDefinitions(LogicalName='wmkf_expertiseprofile')?$select=EntitySetName,IsAuditEnabled,OwnershipType&$expand=Keys($select=SchemaName,EntityKeyIndexStatus,KeyAttributes),Attributes($select=LogicalName,IsAuditEnabled,AttributeType)");
    if (metadata.EntitySetName !== 'wmkf_expertiseprofiles' || metadata.OwnershipType !== 'OrganizationOwned' || metadata.IsAuditEnabled?.Value !== true) throw Error('Table ownership, entity set, or auditing does not match the schema.');
    for (const key of spec.alternateKeys) {
      if (!metadata.Keys?.some(k => k.SchemaName.toLowerCase() === key.schemaName.toLowerCase() && k.EntityKeyIndexStatus === 'Active' && fingerprint(k.KeyAttributes) === fingerprint(key.keyAttributes))) throw Error('A required alternate key is missing, different, or not Active.');
    }
    for (const name of ['wmkf_name', 'statecode', 'wmkf_staffuser', ...spec.attributes.map(a => a.schemaName.toLowerCase())]) {
      if (!metadata.Attributes?.some(a => a.LogicalName === name && a.IsAuditEnabled?.Value === true)) throw Error(`Auditing is not enabled for ${name}.`);
    }
    const organization = await checked('/organizations?$select=isauditenabled&$top=2');
    if (organization.value?.length !== 1 || organization.value[0].isauditenabled !== true) throw Error('Organization auditing must be enabled before import.');
    for (const attr of spec.attributes) {
      const actual = metadata.Attributes.find(a => a.LogicalName === attr.schemaName.toLowerCase());
      if (actual?.AttributeType !== attr.type) throw Error(`Attribute type differs: ${attr.schemaName}.`);
      if (attr.maxLength) {
        const detail = await checked(`/EntityDefinitions(LogicalName='wmkf_expertiseprofile')/Attributes(LogicalName='${attr.schemaName.toLowerCase()}')/Microsoft.Dynamics.CRM.${attr.type}AttributeMetadata?$select=MaxLength`);
        if (detail.MaxLength !== attr.maxLength) throw Error(`Attribute length differs: ${attr.schemaName}.`);
      }
    }
    const category = await checked("/EntityDefinitions(LogicalName='wmkf_expertiseprofile')/Attributes(LogicalName='wmkf_category')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet");
    const expectedOptions = spec.attributes.find(a => a.schemaName === 'wmkf_Category').options;
    if (category.OptionSet?.Options?.length !== expectedOptions.length || expectedOptions.some(o => !category.OptionSet.Options.some(a => a.Value === o.value && a.Label?.LocalizedLabels?.some(l => l.LanguageCode === 1033 && l.Label === o.label)))) throw Error('Category option values/labels differ from the schema.');
    const staffLookup = await checked("/EntityDefinitions(LogicalName='wmkf_expertiseprofile')/Attributes(LogicalName='wmkf_staffuser')/Microsoft.Dynamics.CRM.LookupAttributeMetadata?$select=Targets");
    if (fingerprint(staffLookup.Targets) !== fingerprint(['systemuser'])) throw Error('Staff lookup target differs from systemuser.');
    const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
    enterDynamicsBypassForScript('expertise-roster-migration');
    const profiles = await import('../lib/dataverse/adapters/expertise-profile.js');
    const projected = record => ({ profileGuid: record.wmkf_expertiseprofileid, values: {
      ...Object.fromEntries(['wmkf_name','wmkf_category','wmkf_leadpdeligible','wmkf_contactguid','wmkf_creationkey','statecode',...contract.TEXT.map(contract.column)].map(k => [k, record[k] ?? null])),
      wmkf_staffuser: record._wmkf_staffuser_value ?? null,
    } });
    const target = { version: 1, targetHost: host, complete: true, profiles: (await profiles.list()).map(projected) };
    const plan = planImport(source, target, mapping, [host]);
    // Check all links before writes. Inactive/deleted Contacts must be explicitly
    // resolved with the owner; never substitute or clear them here.
    for (const row of plan.rows.filter(r => r.action !== 'blocked' && r.action !== 'exclude')) {
      if (row.values.wmkf_contactguid) {
        const contact = await client.get(`/contacts(${row.values.wmkf_contactguid})?$select=contactid,statecode`);
        applyContactHealth(row, { ok: contact.ok, status: contact.status, statecode: contact.body?.statecode }, { verify: mode === 'verify' });
        if (row.action === 'blocked') plan.blocked = true;
      }
      if (row.values.wmkf_staffuser) {
        const user = await checked(`/systemusers(${row.values.wmkf_staffuser})?$select=systemuserid,isdisabled`);
        if (row.values.wmkf_leadpdeligible && user.isdisabled !== false) throw Error(`Lead-eligible source ${row.legacyId} has a disabled User.`);
      }
    }
    for (const action of ['create', 'unchanged', 'blocked', 'exclude']) plan.summary[action] = plan.rows.filter(r => r.action === action).length;
    if (plan.blocked && mode === 'import') { writeReceipt(plan); throw Error('Import blocked; see the private per-row report.'); }
    if (mode === 'plan') { writeReceipt(plan); if (plan.blocked) process.exitCode = 1; }
    else if (mode === 'verify') {
      const bindings = (await pg.query('SELECT * FROM expertise_roster_binding WHERE target_host=$1', [host])).rows;
      const identities = new Set((await pg.query('SELECT id FROM expertise_roster_identity')).rows.map(r => r.id));
      const verified = !plan.blocked && plan.rows.every(r => r.action === 'exclude' ? identities.has(r.legacyId) : r.action === 'unchanged' && bindings.some(b => b.dataverse_profile_guid === r.profileGuid && (r.legacyId == null || b.roster_id === r.legacyId)))
        && feedback.every(id => identities.has(id)) && target.profiles.length === plan.rows.filter(r => r.action !== 'exclude').length;
      writeReceipt({ ...plan, verified, feedbackIds: feedback }); if (!verified) process.exitCode = 1;
    } else {
      const actor = process.env.EXPERTISE_ROSTER_ACTOR_ID;
      if (!contract.guid(actor) || process.env.DYNAMICS_IMPERSONATION_ENABLED !== 'true') throw Error('Explicit mapped operator User and impersonation are required.');
      const { ensureProfileBinding } = await import('../lib/services/expertise-finder/roster-binding.js');
      const receipt = await executeImport(plan, {
        async prepareIdentities(ids) {
          await pg.query('BEGIN');
          try {
            for (const id of ids) await pg.query('INSERT INTO expertise_roster_identity(id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
            await pg.query("SELECT setval('expertise_roster_id_seq', GREATEST((SELECT last_value FROM expertise_roster_id_seq), COALESCE((SELECT MAX(id) FROM expertise_roster_identity), 1)), true)");
            await pg.query('COMMIT');
          } catch (e) { await pg.query('ROLLBACK'); throw e; }
        },
        async byKey(key) { const r = await profiles.byCreationKey(key); return r ? projected(r) : null; },
        async create(values) {
          const { wmkf_staffuser, ...body } = values;
          await profiles.create({ ...body, statuscode: body.statecode === 0 ? 1 : 2, ...(wmkf_staffuser ? { 'wmkf_StaffUser@odata.bind': `/systemusers(${wmkf_staffuser})` } : {}) }, actor);
        },
        async bind(id, guid, key) {
          if (id == null) return ensureProfileBinding(host, guid, key);
          await pg.query('INSERT INTO expertise_roster_binding(roster_id,target_host,dataverse_profile_guid) VALUES ($1,$2,$3) ON CONFLICT (roster_id,target_host) DO NOTHING', [id,host,guid]);
          const actual = (await pg.query('SELECT dataverse_profile_guid FROM expertise_roster_binding WHERE roster_id=$1 AND target_host=$2', [id,host])).rows[0];
          if (actual?.dataverse_profile_guid !== guid) throw Error('Existing numeric binding conflicts; reconcile without overwriting.');
          return id;
        },
        saveReceipt: writeReceipt,
      }, { apply: true });
      if (!receipt.verified) process.exitCode = 1;
    }
    console.log('Private report saved. A successful import is not deployment/cutover authorization.');
  }
} finally { await pg.end(); }
