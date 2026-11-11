/** @jest-environment node */
// Opt-in: ROSTER_LIVE_SQL_TEST_ENV points to the pinned rehearsal env file.
// Real SQL in transaction-local TEMP tables; every external/app-auth dependency
// is controlled. No inference, Graph, Dataverse writes or persistent DDL.
jest.mock('../../lib/services/expertise-finder/roster-sql.cjs',()=>({sql:jest.fn()}));
jest.mock('../../lib/services/expertise-finder/roster-rehearsal-target.cjs',()=>({enabled:()=>true,assertTarget:jest.fn()}));
jest.mock('../../lib/utils/auth',()=>({requireAppAccess:jest.fn()}));
jest.mock('pdf-parse',()=>jest.fn(async()=>({text:'Synthetic proposal text. '.repeat(20)})));
jest.mock('../../lib/utils/public-blob-fetch',()=>({fetchPublicBlob:jest.fn(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)}))}));
jest.mock('../../lib/dataverse/adapters/sharepoint-document-location.js',()=>({findByRegardingObject:jest.fn(async()=>({records:[{relativeurl:'synthetic'}]})),findByParentIds:jest.fn()}));
jest.mock('../../lib/services/graph-service',()=>({GraphService:{listFiles:jest.fn(async()=>[{name:'Phase_I_Staff_Version.pdf'}]),downloadFileByPath:jest.fn(async()=>({buffer:Buffer.from('synthetic')}))}}));
jest.mock('../../lib/services/llm-client',()=>({LLMClient:jest.fn()}));
jest.mock('../../lib/utils/usage-logger',()=>({logUsage:jest.fn(),estimateCostCents:()=>0}));
jest.mock('../../lib/services/tool-prompt-resolver',()=>({resolveToolPrompt:jest.fn(async(_name,d)=>({...d,model:'controlled-fixture',maxTokens:1000})),toolPromptUnavailable:()=>null}));
jest.mock('../../lib/services/expertise-finder/roster-match-contract',()=>({...jest.requireActual('../../lib/services/expertise-finder/roster-match-contract'),matchRosterSnapshot:jest.fn()}));
import fs from 'node:fs';
import path from 'node:path';
import {Client} from 'pg';
import dotenv from 'dotenv';
import {sql} from '../../lib/services/expertise-finder/roster-sql.cjs';
import {requireAppAccess} from '../../lib/utils/auth';
import {LLMClient} from '../../lib/services/llm-client';
import {resolveToolPrompt} from '../../lib/services/tool-prompt-resolver';
import {matchRosterSnapshot} from '../../lib/services/expertise-finder/roster-match-contract';
import {batchMatch} from '../../lib/services/expertise-finder/batch-match-service';
import match from '../../pages/api/expertise-finder/match';
import history from '../../pages/api/expertise-finder/history';
const run=process.env.ROSTER_LIVE_SQL_TEST_ENV?describe:describe.skip;
const staff='11111111-1111-4111-8111-111111111111';
const consultant='22222222-2222-4222-8222-222222222222';
const request='33333333-3333-4333-8333-333333333333';
const response=()=>{const r={statusCode:null,body:null};r.status=n=>(r.statusCode=n,r);r.json=b=>(r.body=b,r);return r;};
const output=()=>({proposal_summary:{title:'Synthetic SQL rehearsal'},staff_assignment:{primary:{profile_guid:staff,name:'Spoofed'},secondary:null},consultant_overlap:[{profile_guid:consultant,name:'Spoofed'}]});
run('roster v2 real SQL persistence and history',()=>{
 let client,complete,oldKey,connected=false;
 beforeAll(async()=>{
  const env=dotenv.parse(fs.readFileSync(process.env.ROSTER_LIVE_SQL_TEST_ENV));
  const guard=jest.requireActual('../../lib/services/expertise-finder/roster-rehearsal-target.cjs');
  const {connectionString}=guard.assertTarget(env);
  client=new Client({connectionString,query_timeout:5000});await client.connect();connected=true;await client.query('BEGIN');
  // Shadow dependencies too: no dependency on mutable fixture actor rows.
  await client.query('CREATE TEMP TABLE user_profiles(id INTEGER PRIMARY KEY) ON COMMIT DROP');
  await client.query('INSERT INTO user_profiles(id) VALUES(1),(2)');
  const migration=fs.readFileSync(path.join(process.cwd(),'lib/db/migrations/004_expertise_finder.sql'),'utf8');
  const ddl=migration.match(/CREATE TABLE IF NOT EXISTS expertise_matches \([\s\S]*?\n\);/)[0];
  await client.query(ddl.replace('CREATE TABLE IF NOT EXISTS','CREATE TEMP TABLE').replace(/\);$/,' ) ON COMMIT DROP;'));
  sql.mockImplementation((strings,...values)=>client.query(strings.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values));
  oldKey=process.env.CLAUDE_API_KEY;process.env.CLAUDE_API_KEY='controlled-no-provider-call';
 });
 afterAll(async()=>{if(oldKey===undefined)delete process.env.CLAUDE_API_KEY;else process.env.CLAUDE_API_KEY=oldKey;if(client){try{if(connected)await client.query('ROLLBACK');}finally{await client.end();}}});
 beforeEach(()=>{
  jest.clearAllMocks();requireAppAccess.mockResolvedValue({profileId:1});
  matchRosterSnapshot.mockResolvedValue({rows:[{profile_guid:staff,id:staff,name:'Canonical staff',role_type:'Research Program Staff'},{profile_guid:consultant,id:consultant,name:'Canonical consultant',role_type:'Consultant'}],leadGuids:[staff],warnings:['Synthetic exclusion warning']});
  complete=jest.fn(async()=>({content:[{text:JSON.stringify(output())}],usage:{inputTokens:0,outputTokens:0},model:'controlled-fixture'}));
  LLMClient.mockImplementation(()=>({complete}));
 });
 test('single and batch save canonical GUID results; history is actor-scoped',async()=>{
  const res=response();await match({method:'POST',body:{file:{url:'https://fixture.invalid/proposal.pdf',filename:'synthetic.pdf'},profileId:2}},res);
  expect(res.statusCode).toBe(200);
  const batch=await batchMatch({requestId:request,profileId:1});expect(batch.success).toBe(true);
  await client.query("INSERT INTO expertise_matches(user_profile_id,proposal_title,match_results) VALUES(2,'Other actor','{}')");
  const h=response();await history({method:'GET',query:{profileId:2}},h);
  expect(h.statusCode).toBe(200);expect(h.body.total).toBe(2);expect(h.body.matches).toHaveLength(2);
  for(const row of h.body.matches){expect(row.match_results.staff_assignment.primary).toMatchObject({profile_guid:staff,name:'Canonical staff'});expect(row.match_results.consultant_overlap[0].name).toBe('Canonical consultant');expect(row.match_results.roster_warnings).toEqual(['Synthetic exclusion warning']);}
  expect(resolveToolPrompt.mock.calls.every(([name])=>name==='expertise-finder.match.roster-v2')).toBe(true);
 });
 test('invalid returned identities cannot persist in either entry point',async()=>{
  const before=(await client.query('SELECT count(*) FROM expertise_matches')).rows[0].count;
  complete.mockResolvedValue({content:[{text:JSON.stringify({...output(),staff_assignment:{primary:{profile_guid:consultant}}})}],usage:{inputTokens:0,outputTokens:0}});
  const r=response();await match({method:'POST',body:{file:{url:'https://fixture.invalid/p.pdf'}}},r);expect(r.statusCode).toBe(503);
  await expect(batchMatch({requestId:request,profileId:1})).rejects.toMatchObject({httpStatus:503});
  expect((await client.query('SELECT count(*) FROM expertise_matches')).rows[0].count).toBe(before);
 });
 test('no lead persists explicitly while staff remains available for consultation',async()=>{
  const snapshot=await matchRosterSnapshot();matchRosterSnapshot.mockResolvedValue({...snapshot,leadGuids:[]});
  complete.mockResolvedValue({content:[{text:JSON.stringify({staff_assignment:{primary:null,secondary:null},staff_consultation:[{profile_guid:staff}]})}],usage:{inputTokens:0,outputTokens:0}});
  const result=await batchMatch({requestId:request,profileId:1});
  const row=(await client.query('SELECT match_results FROM expertise_matches WHERE id=$1',[result.matchId])).rows[0];
  expect(row.match_results.no_lead_recommendation).toBe(true);expect(row.match_results.staff_consultation[0].name).toBe('Canonical staff');
 });
 test('incompatible prompt bytes refuse both paths before model execution or SQL writes',async()=>{
  const before=(await client.query('SELECT count(*) FROM expertise_matches')).rows[0].count;
  resolveToolPrompt.mockResolvedValueOnce({systemPrompt:'incompatible',body:'incompatible'}).mockResolvedValueOnce({systemPrompt:'incompatible',body:'incompatible'});
  const r=response();await match({method:'POST',body:{file:{url:'https://fixture.invalid/p.pdf'}}},r);expect(r.statusCode).toBe(503);
  await expect(batchMatch({requestId:request,profileId:1})).rejects.toMatchObject({httpStatus:503});
  expect(complete).not.toHaveBeenCalled();expect(sql).not.toHaveBeenCalled();
  expect((await client.query('SELECT count(*) FROM expertise_matches')).rows[0].count).toBe(before);
 });
 test('an active staff profile outside the exact eligible lead set cannot be saved as lead',async()=>{
  const snapshot=await matchRosterSnapshot();matchRosterSnapshot.mockResolvedValue({...snapshot,leadGuids:[]});
  await expect(batchMatch({requestId:request,profileId:1})).rejects.toMatchObject({httpStatus:503});
  expect(sql).not.toHaveBeenCalled();
 });
 test('history refuses unauthorized access without touching SQL',async()=>{
  requireAppAccess.mockResolvedValue(null);const r=response();await history({method:'GET',query:{}},r);
  expect(sql).not.toHaveBeenCalled();expect(r.body).toBeNull();
 });

});
