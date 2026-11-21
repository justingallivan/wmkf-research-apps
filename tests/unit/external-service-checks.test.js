/** @jest-environment node */
import { boundedFetch, collectSource, sourcesFor } from '../../lib/services/external-services/check-sources';
import { checkForUpdates } from '../../lib/services/external-services/checks';
import { claimCheck, finishCheck } from '../../lib/services/external-services/check-store';
import { getCostReport, getMessagesUsageReport } from '../../lib/services/anthropic-admin';
import { sql } from '@vercel/postgres';
jest.mock('@vercel/postgres',()=>({sql:{query:jest.fn()}}));
jest.mock('../../lib/services/external-services/check-store',()=>({claimCheck:jest.fn(),finishCheck:jest.fn(async(id,token,snapshot)=>snapshot)}));
jest.mock('../../lib/services/anthropic-admin',()=>({getCostReport:jest.fn(),getMessagesUsageReport:jest.fn()}));
const now='2026-11-21T20:00:00.000Z';
const reply=(value,status=200)=>({ok:status===200,status,body:new ReadableStream({start(c){c.enqueue(Buffer.from(typeof value==='string'?value:JSON.stringify(value)));c.close();}})});
beforeEach(()=>{jest.clearAllMocks();global.fetch=jest.fn();delete process.env.SERP_API_KEY;delete process.env.CLAUDE_API_KEY;delete process.env.ANTHROPIC_ADMIN_API_KEY;});
test('public sources are fixed, redirect-blocked and compared with successful baseline',async()=>{
  const source=sourcesFor('assemblyai')[0];
  const text='# AssemblyAI Pricing\n'+('Official reference notes. '.repeat(5))+'\nRecorded audio: $0.21/hr; diarization $0.02/hr.';
  fetch.mockImplementation(async()=>reply(text));
  const first=await collectSource(source,undefined,undefined,now);
  expect(first.result.status).toBe('baseline');
  expect(fetch).toHaveBeenCalledWith('https://www.assemblyai.com/pricing.md',expect.objectContaining({redirect:'error',cache:'no-store'}));
  expect((await collectSource(source,first.baseline,undefined,now)).result.status).toBe('unchanged');
  fetch.mockImplementation(async()=>reply(text.replace('$0.21','$0.20')));
  const next=await collectSource(source,first.baseline,undefined,now);
  expect(next.result.status).toBe('changed');expect(next.result.previousLines.join()).toContain('$0.21');expect(next.result.lines.join()).toContain('$0.20');
});
test.each(['<html>sign in</html>','not a valid provider page'])('invalid public response never advances a successful baseline',async text=>{
  const baseline={fingerprint:'prior',lines:['prior'],observedAt:now};fetch.mockResolvedValue(reply(text));
  const result=await collectSource(sourcesFor('assemblyai')[0],baseline,undefined,now);
  expect(result.result.status).toBe('unavailable');expect(result.baseline).toBe(baseline);
});
test('SerpAPI allowlist drops echoed credentials and personal account fields',async()=>{
  process.env.SERP_API_KEY='test-secret-never-retain';
  fetch.mockResolvedValue(reply({api_key:'test-secret-never-retain',account_email:'private@example.org',account_id:'private-id',plan_name:'Starter',plan_monthly_price:25,searches_per_month:100,this_month_usage:92,total_searches_left:8,plan_renewal_date:'2026-12-20'}));
  const result=await collectSource(sourcesFor('serpapi')[0],undefined,undefined,now);
  expect(result.result.status).toBe('baseline');expect(result.result.attention).toBe(true);
  for(const secret of ['test-secret-never-retain','private@example.org','private-id'])expect(JSON.stringify(result)).not.toContain(secret);
  expect(result.result.lines.join()).toContain('remaining: 8');
});
test('missing credentials skip network and API failure is sanitized',async()=>{
  const source=sourcesFor('serpapi')[0];
  expect((await collectSource(source,undefined,undefined,now)).result.status).toBe('unavailable');expect(fetch).not.toHaveBeenCalled();
  process.env.SERP_API_KEY='test-credential';fetch.mockRejectedValue(new Error('https://serpapi.com/account?api_key=test-credential'));
  const result=await collectSource(source,undefined,undefined,now);expect(JSON.stringify(result)).not.toContain('test-credential');
});
test('oversized responses stop reading and cancel body',async()=>{
  fetch.mockResolvedValue(reply('a'.repeat(1024*1024+1)));
  await expect(boundedFetch('https://serpapi.com/account.json')).rejects.toThrow('response_too_large');
});
test('HTTP auth rejection never reads or returns provider error body',async()=>{
  const json=jest.fn();fetch.mockResolvedValue({ok:false,status:401,json});
  await expect(boundedFetch('https://serpapi.com/account.json')).rejects.toThrow('credential_rejected');expect(json).not.toHaveBeenCalled();
});
test('Anthropic registry follows pagination and fails closed on missing continuation',async()=>{
  process.env.CLAUDE_API_KEY='test-key';const source=sourcesFor('anthropic')[0];
  fetch.mockResolvedValueOnce(reply({data:[{id:'claude-new-model',created_at:'2026-11-21T00:00:00Z'}],has_more:true,last_id:'claude-new-model'})).mockResolvedValueOnce(reply({data:[{id:'claude-other-model',created_at:'2026-11-21T00:00:00Z'}],has_more:false}));
  const result=await collectSource(source,undefined,undefined,now);expect(result.result.status).toBe('baseline');expect(result.result.attention).toBe(true);expect(fetch.mock.calls[1][0].searchParams.get('after_id')).toBe('claude-new-model');
  fetch.mockResolvedValue(reply({data:[{id:'claude-new-model',created_at:'2026-11-21T00:00:00Z'}],has_more:true}));
  expect((await collectSource(source,result.baseline,undefined,now)).result.status).toBe('unavailable');
});
test('empty billing data is unavailable rather than no-change success',async()=>{
  process.env.ANTHROPIC_ADMIN_API_KEY='test-admin';getCostReport.mockResolvedValue([]);getMessagesUsageReport.mockResolvedValue([]);
  expect((await collectSource(sourcesFor('anthropic')[2],undefined,undefined,now)).result).toMatchObject({status:'unavailable',summary:expect.stringContaining('No complete billing comparison')});
});
test('partial failures persist independent successes without completing human review',async()=>{
  claimCheck.mockResolvedValue({token:'lease',previous:{},service:{version:3,data:{configuration:'current'}}});
  fetch.mockImplementation(async url=>String(url).includes('pricing')?reply('# AssemblyAI Pricing\n'+'Public pricing reference. '.repeat(10)+'\n$0.21 per pre-recorded hour.'):Promise.reject(new Error('timeout')));
  const snapshot=await checkForUpdates('assemblyai',42);
  expect(snapshot.sources.map(s=>s.status)).toEqual(['baseline','unavailable']);expect(Object.keys(snapshot.baselines)).toEqual(['pricing']);expect(snapshot).not.toHaveProperty('reviewedOn');
  expect(finishCheck).toHaveBeenCalledWith('assemblyai','lease',expect.objectContaining({serviceVersion:3}));expect(sql.query).not.toHaveBeenCalled();
});
test('cooldown reuse makes no provider calls',async()=>{
  claimCheck.mockResolvedValue({cached:{checkedAt:now,sources:[]}});expect(await checkForUpdates('serpapi',42)).toEqual({checkedAt:now,sources:[]});expect(fetch).not.toHaveBeenCalled();expect(finishCheck).not.toHaveBeenCalled();
});
