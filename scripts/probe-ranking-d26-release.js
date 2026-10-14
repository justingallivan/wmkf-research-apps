#!/usr/bin/env node
/** Read-only Production D26 release inventory. No writes; no assessment content output.
 * Usage: node scripts/probe-ranking-d26-release.js /absolute/path/to/.env.local
 * Local credentials authenticate the app; local flags are not production deployment evidence.
 */
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const assert = require('node:assert/strict');
async function main() {
  assert(process.argv.length === 3, 'Explicit credential env file required');
  const env = parseEnv(fs.readFileSync(process.argv[2], 'utf8'));
  for (const key of ['DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET']) {
    assert(env[key], 'Required application credential missing'); process.env[key] = env[key];
  }
  Object.assign(process.env, { VERCEL_ENV: 'preview', DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on', DATAVERSE_ALLOW_PROD_READS: 'yes' });
  const target = 'https://wmkf.crm.dynamics.com';
  const { createClient, getAccessToken } = require('../lib/dataverse/client.js');
  const client = createClient({ resourceUrl: target, token: await getAccessToken(target) });
  async function get(path) {
    const response = await client.get(path);
    if (!response.ok) throw new Error(`Read failed: ${response.status}`);
    return response.body;
  }
  async function rows(path) {
    const result = [];
    for (let page = 0; path && page < 30; page++) {
      const body = await get(path); result.push(...body.value);
      path = body['@odata.nextLink'];
    }
    assert(!path, 'Incomplete pagination'); return result;
  }
  const who = await get('/WhoAmI');
  const roles = await rows(`/systemusers(${who.UserId})/systemuserroles_association?$select=name`);
  const schema = [];
  for (const [entity, field, length] of [['wmkf_proposalrankinground','wmkf_workflowjson',65536],['wmkf_proposalrankinglist','wmkf_assessmentjson',524288]]) {
    const response = await client.get(`/EntityDefinitions(LogicalName='${entity}')/Attributes(LogicalName='${field}')/Microsoft.Dynamics.CRM.MemoAttributeMetadata?$select=LogicalName,MaxLength`);
    schema.push({entity,field,status:response.status,expectedLength:length,actualLength:response.body?.MaxLength ?? null,exact:response.ok && response.body.MaxLength===length});
  }
  const settings = await rows("/wmkf_appsystemsettings?$select=wmkf_settingvalue&$filter=wmkf_settingkey eq 'proposal_ranking.default_facilitator_systemuser_id'");
  const grants = await rows("/wmkf_appuserappaccesses?$select=_wmkf_user_value,wmkf_appkey&$filter=wmkf_appkey eq 'proposal-ranking' or wmkf_appkey eq 'meeting-tracker'");
  const users = await rows('/systemusers?$select=systemuserid,fullname,isdisabled&$filter=isdisabled eq false');
  const name = id => users.find(u=>u.systemuserid===id)?.fullname || 'unavailable/disabled';
  const requests = await rows("/akoya_requests?$select=akoya_requestnum,_akoya_programid_value,_wmkf_programdirector_value,akoya_request,_transactioncurrencyid_value&$filter=wmkf_meetingdate ge 2026-12-01T00:00:00Z and wmkf_meetingdate lt 2027-01-01T00:00:00Z and akoya_requeststatus eq 'Phase II Pending' and (_akoya_programid_value eq 8dcab30b-958f-ee11-8179-000d3a341e8f or _akoya_programid_value eq 94cab30b-958f-ee11-8179-000d3a341e8f) and (wmkf_istestrequest eq false or wmkf_istestrequest eq null) and wmkf_testcreationrunid eq null");
  const cycles = await rows("/wmkf_proposalrankingcycles?$select=wmkf_activeroundid&$filter=wmkf_cyclecode eq 'D26'");
  const rounds = await rows("/wmkf_proposalrankingrounds?$select=wmkf_proposalrankingroundid,wmkf_state,wmkf_facilitatorsystemuserid,wmkf_snapshotjson&$filter=wmkf_cyclecode eq 'D26'");
  const roundSummaries = [];
  for (const round of rounds) {
    const snapshot = JSON.parse(round.wmkf_snapshotjson);
    const lists = await rows(`/wmkf_proposalrankinglists?$select=wmkf_status&$filter=wmkf_roundid eq '${round.wmkf_proposalrankingroundid}'`);
    roundSummaries.push({id:round.wmkf_proposalrankingroundid,activePointer:cycles.some(c=>c.wmkf_activeroundid===round.wmkf_proposalrankingroundid),state:round.wmkf_state,version:snapshot.version,proposalCount:snapshot.proposals?.length,facilitator:name(round.wmkf_facilitatorsystemuserid),listStatuses:lists.reduce((acc,r)=>{acc[r.wmkf_status]=(acc[r.wmkf_status]||0)+1;return acc;},{})});
  }
  console.log(JSON.stringify({checkedAt:new Date().toISOString(),target,writesPerformed:false,rankingRoleAssigned:roles.some(r=>r.name==='WMKF Proposal Ranking Application User'),v2Schema:schema,defaultFacilitator:settings.map(s=>name(s.wmkf_settingvalue)),rankingGrants:grants.filter(g=>g.wmkf_appkey==='proposal-ranking').map(g=>({name:name(g._wmkf_user_value),meetingTracker:grants.some(m=>m._wmkf_user_value===g._wmkf_user_value && m.wmkf_appkey==='meeting-tracker')})),d26:{ordinaryPendingCount:requests.length,excludedByTrialCutoff:requests.filter(r=>Number(r.akoya_requestnum)>=1003220).length,malformedNumbers:requests.filter(r=>!/^\d+$/.test(r.akoya_requestnum)).length,missingLead:requests.filter(r=>!r._wmkf_programdirector_value).length,missingAmount:requests.filter(r=>r.akoya_request==null).length,missingCurrency:requests.filter(r=>r.akoya_request!=null&&!r._transactioncurrencyid_value).length,leads:[...new Set(requests.map(r=>r._wmkf_programdirector_value))].map(name),rounds:roundSummaries}},null,2));
}
main().catch(error=>{console.error(`Read-only D26 probe failed (${error.name}): ${/^Read failed: \d+$/.test(error.message)?error.message:'No credentials or response content logged'}`);process.exitCode=1;});
