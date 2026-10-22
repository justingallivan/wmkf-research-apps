#!/usr/bin/env node
/**
 * Read-only cycle/role foundations probe. Dataverse GETs only; the sole POST
 * acquires the application's OAuth token. No agent credentials or model calls.
 * Usage: node scripts/probe-cycle-foundations.cjs --env-file <local env> --output <json>
 * Reports selected non-secret settings, metadata, cycle rows, aggregate request
 * linkage and sanitized workflow facts. Does not invoke app routes or workers.
 */
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const assert = require('node:assert/strict');

async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 4 && args[0] === '--env-file' && args[2] === '--output', 'Use --env-file <path> --output <path>');
  const credentials = parseEnv(fs.readFileSync(args[1], 'utf8'));
  for (const name of ['DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET', 'DYNAMICS_TENANT_ID']) {
    assert(credentials[name], 'Required application credential missing');
    process.env[name] = credentials[name];
  }
  const target = 'https://wmkf.crm.dynamics.com';
  assert(new URL(credentials.DYNAMICS_URL).origin === target, 'Credential environment target differs from approved production hostname');
  delete process.env.VERCEL_ENV;
  delete process.env.DATAVERSE_PROD_WRITE_ACK;
  Object.assign(process.env, { NODE_ENV: 'development', DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on', DATAVERSE_ALLOW_PROD_READS: 'yes' });
  const { createClient, getAccessToken } = require('../lib/dataverse/client.js');
  const client = createClient({ resourceUrl: target, token: await getAccessToken(target) });
  let calls = 0;
  const report = { capturedAt: new Date().toISOString(), target, externalMethods: ['OAuth token POST', 'Dataverse GET'], errors: [], queries: [] };
  async function get(path) {
    const url = new URL(path, target + '/api/data/v9.2/');
    assert(url.origin === target, 'Refuse cross-origin pagination');
    calls++;
    const result = await client.get(path, { Prefer: 'odata.maxpagesize=500,odata.include-annotations="OData.Community.Display.V1.FormattedValue"' }, { timeoutMs: 30000 });
    if (!result.ok) throw new Error(`GET failed HTTP ${result.status}: ${result.body?.error?.code || 'unknown_code'}`);
    return result.body;
  }
  async function all(path) {
    const rows = []; let next = path; let pages = 0;
    while (next && pages < 100) {
      const body = await get(next); assert(Array.isArray(body.value), 'Expected collection');
      rows.push(...body.value); next = body['@odata.nextLink']; pages++;
    }
    assert(!next, 'Incomplete pagination');
    report.queries.push({ path: path.split('?')[0], pages, rows: rows.length, complete: true });
    return rows;
  }
  async function section(name, fn) {
    try { report[name] = await fn(); console.log(`${name}: complete`); }
    catch (error) { report.errors.push({ section: name, message: error.message }); console.log(`${name}: ${error.message}`); }
  }
  const entities = {};
  await section('metadata', async () => {
    const output = {};
    for (const logical of ['wmkf_grantcycle', 'wmkf_appgrantcycle', 'akoya_request', 'akoya_akoyaapply']) {
      const entity = await get(`/EntityDefinitions(LogicalName='${logical}')?$select=LogicalName,EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute`);
      const attributes = await all(`/EntityDefinitions(LogicalName='${logical}')/Attributes?$select=LogicalName,AttributeType,DisplayName,AttributeOf`);
      entities[logical] = { ...entity, attributes };
      output[logical] = { set: entity.EntitySetName, primaryId: entity.PrimaryIdAttribute,
        attributes: attributes.filter(a => logical.includes('grantcycle') ? a.LogicalName.startsWith('wmkf_') : /cycle|meetingdate|fiscalyear|deadline|duedate|cutoff/i.test(a.LogicalName))
          .map(a => ({ name: a.LogicalName, type: a.AttributeType, label: a.DisplayName?.UserLocalizedLabel?.Label || null })) };
    }
    return output;
  });
  for (const logical of ['wmkf_grantcycle', 'wmkf_appgrantcycle']) {
    await section(logical + '_records', async () => {
      const entity = entities[logical]; assert(entity, 'Metadata unavailable');
      const wanted = logical === 'wmkf_grantcycle'
        ? ['wmkf_name', 'wmkf_cyclecode', 'wmkf_cyclename', 'statecode']
        : ['wmkf_displayname', 'wmkf_shortcode', 'wmkf_fiscalyearcode', 'wmkf_programname', 'wmkf_isactive', 'statecode'];
      wanted.push(...entity.attributes.filter(a => a.AttributeType === 'DateTime' && a.LogicalName.startsWith('wmkf_')).map(a => a.LogicalName));
      const available = new Set(entity.attributes.map(a => a.LogicalName));
      const select = [...new Set([entity.PrimaryIdAttribute, ...wanted.filter(n => available.has(n))])];
      const rows = await all(`/${entity.EntitySetName}?$select=${select.join(',')}`);
      return rows.map(row => Object.fromEntries(select.map(key => [key, row[key] ?? null])));
    });
  }
  await section('settings', async () => {
    const roleKeys = ['president', 'cso', 'grants_manager', 'program_coordinator', 'systems_specialist'].map(k => 'board_writeups.' + k);
    const filter = [...roleKeys.map(key => `wmkf_settingkey eq '${key}'`), "wmkf_settingkey eq 'reviewer.campaign_timeline_defaults'", "startswith(wmkf_settingkey,'board_writeups.cycle.')"].join(' or ');
    const rows = await all('/wmkf_appsystemsettings?$select=wmkf_settingkey,wmkf_settingvalue,modifiedon&$filter=' + encodeURIComponent(filter));
    const output = [];
    for (const row of rows) {
      let value; try { value = JSON.parse(row.wmkf_settingvalue); } catch { output.push({ key: row.wmkf_settingkey, malformed: true }); continue; }
      if (roleKeys.includes(row.wmkf_settingkey)) {
        const id = value.systemUserId; let person = null;
        if (id) {
          assert(/^[0-9a-f-]{36}$/i.test(id), 'Invalid stored role identity');
          const user = await get(`/systemusers(${id})?$select=fullname,isdisabled`);
          person = { name: user.fullname, disabled: user.isdisabled };
        }
        output.push({ key: row.wmkf_settingkey, version: value.version, assigned: Boolean(id), person, modifiedOn: row.modifiedon });
      } else if (row.wmkf_settingkey === 'reviewer.campaign_timeline_defaults') {
        output.push({ key: row.wmkf_settingkey, value: Object.fromEntries(['cycleLabel', 'inviteStartDate', 'respondOffsetDays', 'proposalReleaseDate', 'reviewDueDate', 'desiredCount'].map(k => [k, value[k] ?? null])), modifiedOn: row.modifiedon });
      } else {
        output.push({ key: row.wmkf_settingkey, cycle: value.cycle, active: value.active, rosterConfirmed: value.rosterConfirmed, requestCount: value.requestIds?.length || 0, materialsDue: value.materialsDue, boardEnds: value.boardEnds, adminAssigned: Boolean(value.adminId), modifiedOn: row.modifiedon });
      }
    }
    return { rows: output, missingRoleKeys: roleKeys.filter(k => !rows.some(r => r.wmkf_settingkey === k)) };
  });
  async function aggregate(logical, attributes) {
    const entity = entities[logical]; assert(entity, 'Metadata unavailable');
    const xml = `<fetch aggregate="true"><entity name="${logical}"><attribute name="${entity.PrimaryIdAttribute}" alias="count" aggregate="count"/>${attributes}</entity></fetch>`;
    return (await all(`/${entity.EntitySetName}?fetchXml=${encodeURIComponent(xml)}`)).map(row => Object.fromEntries(Object.entries(row).filter(([k]) => k !== '@odata.etag')));
  }
  for (const logical of ['akoya_request', 'akoya_akoyaapply']) {
    await section(logical + '_cycle_link_counts', async () => aggregate(logical, '<attribute name="wmkf_grantcycle" alias="cycle" groupby="true"/>'));
  }
  await section('request_date_cycle_counts', async () => {
    const xml = '<attribute name="wmkf_grantcycle" alias="cycle" groupby="true"/><attribute name="wmkf_meetingdate" alias="year" groupby="true" dategrouping="year" usertimezone="false"/><attribute name="wmkf_meetingdate" alias="month" groupby="true" dategrouping="month" usertimezone="false"/><attribute name="wmkf_istestrequest" alias="test" groupby="true"/><attribute name="akoya_requeststatus" alias="status" groupby="true"/>';
    const entity = entities.akoya_request;
    const fetchXml = `<fetch aggregate="true"><entity name="akoya_request"><attribute name="akoya_requestid" alias="count" aggregate="count"/>${xml}<filter><condition attribute="wmkf_meetingdate" operator="on-or-after" value="2026-12-01"/><condition attribute="wmkf_meetingdate" operator="lt" value="2028-01-01"/></filter></entity></fetch>`;
    return (await all(`/${entity.EntitySetName}?fetchXml=${encodeURIComponent(fetchXml)}`)).map(row => Object.fromEntries(Object.entries(row).filter(([k]) => k !== '@odata.etag')));
  });
  await section('opportunity_calendar_records', async () => {
    const entity = entities.akoya_akoyaapply;
    const identityFields = entity.attributes.filter(a => a.AttributeType === 'String' && !a.AttributeOf && /^(akoya_|wmkf_)/.test(a.LogicalName) && /(name|title)$/.test(a.LogicalName)).map(a => a.LogicalName);
    const fields = [entity.PrimaryIdAttribute, entity.PrimaryNameAttribute, ...identityFields, 'statecode', 'statuscode', '_wmkf_grantcycle_value', ...entity.attributes.filter(a => a.AttributeType === 'DateTime' && /^(akoya_|wmkf_)/.test(a.LogicalName) && !a.LogicalName.endsWith('_date')).map(a => a.LogicalName)];
    const rows = await all(`/${entity.EntitySetName}?$select=${[...new Set(fields)].join(',')}`);
    return { dateFields: entity.attributes.filter(a => fields.includes(a.LogicalName)).map(a => ({name:a.LogicalName,label:a.DisplayName?.UserLocalizedLabel?.Label || null,type:a.AttributeType})), records: rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== '@odata.etag'))) };
  });
  await section('j27_request_context', async () => {
    const cycle = report.wmkf_grantcycle_records?.find(row => row.wmkf_cyclecode === 'J27');
    assert(cycle, 'J27 operations row unavailable');
    const attrs = '<attribute name="wmkf_grantprogram" alias="program" groupby="true"/><attribute name="akoya_requesttype" alias="type" groupby="true"/><attribute name="wmkf_meetingdate" alias="year" groupby="true" dategrouping="year" usertimezone="false"/><attribute name="wmkf_meetingdate" alias="month" groupby="true" dategrouping="month" usertimezone="false"/><attribute name="wmkf_istestrequest" alias="test" groupby="true"/>';
    const xml = `<fetch aggregate="true"><entity name="akoya_request"><attribute name="akoya_requestid" alias="count" aggregate="count"/>${attrs}<filter><condition attribute="wmkf_grantcycle" operator="eq" value="${cycle.wmkf_grantcycleid}"/></filter></entity></fetch>`;
    return all('/akoya_requests?fetchXml=' + encodeURIComponent(xml));
  });
  await section('meeting_date_attribute_metadata', async () => {
    const output = {};
    for (const logical of ['akoya_request','wmkf_grantcycle']) {
      output[logical] = await get(`/EntityDefinitions(LogicalName='${logical}')/Attributes(LogicalName='wmkf_meetingdate')?$select=LogicalName,SourceType,IsValidForUpdate,IsAuditEnabled`);
    }
    return output;
  });
  await section('calendar_plugin_steps', async () => {
    return all('/sdkmessageprocessingsteps?$select=name,stage,mode,statecode,filteringattributes&$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode)&$filter=' + encodeURIComponent("sdkmessagefilterid/primaryobjecttypecode eq 'wmkf_grantcycle'"));
  });
  await section('automation_metadata', async () => {
    const flowFilter = encodeURIComponent("type eq 1 and (category eq 5 or primaryentity eq 'wmkf_grantcycle' or primaryentity eq 'akoya_request' or primaryentity eq 'akoya_akoyaapply' or primaryentity eq 'akoya_goapplystatustracking')");
    const rows = await all('/workflows?$select=name,category,statecode,type,primaryentity,clientdata,xaml,triggeronupdateattributelist,triggeroncreate,triggerondelete,modifiedon&$filter=' + flowFilter);
    const patterns = ['wmkf_grantcycle', 'wmkf_meetingdate', 'akoya_akoyaapply', 'wmkf_reviewduedate', 'wmkf_reviewreturndeadline'];
    const matches = [];
    for (const row of rows) {
      const definitionText = [row.clientdata, row.xaml].filter(Boolean).join('\n');
      const fields = patterns.filter(p => definitionText.toLowerCase().includes(p));
      if (!fields.length && !/cycle|goapply|deadline|check.?in/i.test(row.name || '')) continue;
      let definition = null; try { const obj = JSON.parse(row.clientdata || '{}'); definition = obj?.properties?.definition || obj?.definition; } catch {}
      const triggers = Object.entries(definition?.triggers || {}).map(([name, t]) => ({ name, type: t.type || null, entity: t.inputs?.parameters?.entityName || t.inputs?.parameters?.subscriptionRequest?.entityname || null, filteringAttributes: t.inputs?.parameters?.subscriptionRequest?.filteringattributes || null }));
      matches.push({ name: row.name, category: row.category, state: row.statecode, primaryEntity: row.primaryentity, modifiedOn: row.modifiedon, matchedFields: fields, updateAttributes: row.triggeronupdateattributelist || null, onCreate: row.triggeroncreate || false, triggers });
    }
    return { visibleDefinitions: rows.length, matches, limit: 'Definition references and activation state do not prove execution, date propagation or GOApply portal-window configuration. Definitions are not saved.' };
  });
  report.dataverseGetCalls = calls;
  fs.writeFileSync(args[3], JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Saved non-secret evidence: ${args[3]}; Dataverse GETs: ${calls}; failed sections: ${report.errors.length}`);
  if (report.errors.length) process.exitCode = 2;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
