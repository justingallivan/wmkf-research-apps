/** @jest-environment node */
import { boundedFetch, collectSource, sourcesFor } from '../../lib/services/external-services/check-sources';
import { checkForUpdates } from '../../lib/services/external-services/checks';
import { claimCheck, finishCheck, interruptCheck } from '../../lib/services/external-services/check-store';
import { getCostReport, getMessagesUsageReport } from '../../lib/services/anthropic-admin';
import { sql } from '@vercel/postgres';
jest.mock('@vercel/postgres',()=>{const query=jest.fn();return {sql:{query},db:{connect:jest.fn(async()=>({query,release:jest.fn()}))}};});
jest.mock('../../lib/services/external-services/check-store',()=>({claimCheck:jest.fn(),interruptCheck:jest.fn().mockResolvedValue(undefined),finishCheck:jest.fn(async(id,token,snapshot)=>snapshot)}));
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
test('SerpAPI usage changes preserve the plan baseline until allowance becomes low',async()=>{
  process.env.SERP_API_KEY='test-key';const source=sourcesFor('serpapi')[0];
  const account={plan_name:'Starter',plan_monthly_price:25,searches_per_month:100,this_month_usage:20,total_searches_left:80,plan_renewal_date:null};
  fetch.mockResolvedValue(reply(account));const first=await collectSource(source,undefined,undefined,now);
  fetch.mockResolvedValue(reply({...account,this_month_usage:30,total_searches_left:70}));
  expect((await collectSource(source,first.baseline,undefined,now)).result).toMatchObject({status:'unchanged',attention:false});
  fetch.mockResolvedValue(reply({...account,this_month_usage:91,total_searches_left:9}));
  expect((await collectSource(source,first.baseline,undefined,now)).result).toMatchObject({status:'unchanged',attention:true});
  fetch.mockResolvedValue(reply({...account,plan_monthly_price:30}));
  expect((await collectSource(source,first.baseline,undefined,now)).result.status).toBe('changed');
});
test('incomplete local pricing census cannot replace a complete prior baseline',async()=>{
  const source=sourcesFor('anthropic')[1];
  sql.query.mockResolvedValue({rows:[{model:'unknown-example',count:3}]});
  const first=await collectSource(source,undefined,undefined,now);
  expect(first.result).toMatchObject({status:'baseline',attention:true});
  sql.query.mockResolvedValue({rows:Array.from({length:101},(_,i)=>({model:`unknown-${i}`,count:1}))});
  const next=await collectSource(source,first.baseline,undefined,now);
  expect(next.result.status).toBe('unavailable');expect(next.baseline).toEqual(first.baseline);
});

test('changed evidence remains pending on repeated checks until a recorded review',async()=>{
  const source=sourcesFor('assemblyai')[0];
  const page=price=>'# AssemblyAI Pricing\n'+'Official pricing notes. '.repeat(6)+`\nPre-recorded audio $${price}/hr`;
  fetch.mockResolvedValue(reply(page('0.21')));const first=await collectSource(source,undefined,undefined,now);
  fetch.mockImplementation(async()=>reply(page('0.20')));const changed=await collectSource(source,first.baseline,undefined,now);
  fetch.mockImplementation(async()=>reply(page('0.20')));const repeated=await collectSource(source,changed.baseline,undefined,now);
  expect(repeated.result).toMatchObject({status:'changed',attention:true});expect(repeated.result.previousLines.join()).toContain('0.21');
  claimCheck.mockResolvedValue({token:'lease',reviewAfterCheck:true,reviewRevision:'review-2',previous:{reviewRevision:'review-1',baselines:{pricing:repeated.baseline}},service:{version:3,data:{configuration:'current'}}});
  const checked=await checkForUpdates('assemblyai',42);expect(checked.sources[0].status).toBe('unchanged');expect(checked.baselines.pricing.pending).toBe(false);
});
test('known completion failure interrupts only the claimed attempt',async()=>{
  claimCheck.mockResolvedValue({token:'lease',previous:{},service:{version:3,data:{configuration:'current'}}});
  fetch.mockRejectedValue(new Error('offline'));finishCheck.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(checkForUpdates('assemblyai',42)).rejects.toThrow('storage unavailable');expect(interruptCheck).toHaveBeenCalledWith('assemblyai','lease');
});
const cohort={model:'claude-sonnet-5',service_tier:'standard',context_window:'0-200k',inference_geo:'global',workspace_id:null};
const bucket=results=>[{starting_at:'2026-11-01T00:00:00Z',ending_at:'2026-11-02T00:00:00Z',results}];
const cost=amount=>({...cohort,token_type:'output_tokens',amount,currency:'USD',cost_type:'tokens'});
const usage={...cohort,uncached_input_tokens:0,output_tokens:1000000,cache_read_input_tokens:0,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0}};
test('billing fingerprints ignore date shifts but preserve known drift with skipped rows',async()=>{
  process.env.ANTHROPIC_ADMIN_API_KEY='test-admin';getMessagesUsageReport.mockResolvedValue(bucket([usage]));
  getCostReport.mockResolvedValue(bucket([cost('1000')]));
  jest.useFakeTimers().setSystemTime(new Date('2026-11-21T20:00:00Z'));
  try {
    const source=sourcesFor('anthropic')[2];const first=await collectSource(source,undefined,undefined,now);
    expect(first.result).toMatchObject({status:'baseline',attention:false});
    jest.setSystemTime(new Date('2026-11-22T20:00:00Z'));
    expect((await collectSource(source,first.baseline,undefined,now)).result.status).toBe('unchanged');
    getCostReport.mockResolvedValue(bucket([cost('1200'),{...cost('1000'),service_tier:'batch'}]));
    const drift=await collectSource(source,first.baseline,undefined,now);
    expect(drift.result).toMatchObject({status:'changed',attention:true});expect(drift.result.lines.join()).toContain('1 unsupported or unmatched');expect(drift.result.lines.join()).toContain('20.0%');
  } finally {jest.useRealTimers();}
});

test('a pending change remains visible and reviewable when its source fails',async()=>{
  const baseline={fingerprint:'changed',lines:['Current changed rate'],observedAt:now,pending:true,changeFrom:{lines:['Old rate'],observedAt:'2026-11-20T00:00:00Z'}};
  fetch.mockRejectedValue(new Error('offline'));
  const failed=await collectSource(sourcesFor('assemblyai')[0],baseline,undefined,now);
  expect(failed.result).toMatchObject({status:'unavailable',pending:true,attention:true,lines:['Current changed rate'],previousLines:['Old rate'],retainedObservedAt:now,summary:expect.stringContaining('still unreviewed')});expect(failed.baseline).toBe(baseline);
});
test('a review saved during the previous check cannot acknowledge its unseen findings',async()=>{
  const page='# AssemblyAI Pricing\n'+'Official pricing notes. '.repeat(6)+'\nPre-recorded $0.20/hr';
  fetch.mockImplementation(async()=>reply(page));
  const baseline=(await collectSource(sourcesFor('assemblyai')[0],undefined,undefined,now)).baseline;
  claimCheck.mockResolvedValue({token:'lease',reviewRevision:'new-review',reviewAfterCheck:false,previous:{reviewRevision:'old-review',baselines:{pricing:{...baseline,pending:true,changeFrom:{lines:['Prior rate'],observedAt:now}}}},service:{version:3,data:{configuration:'current'}}});
  const checked=await checkForUpdates('assemblyai',42);expect(checked.sources[0].status).toBe('changed');
});
test('routine SerpAPI renewal and recovered allowance do not change the plan fingerprint',async()=>{
  process.env.SERP_API_KEY='test-key';const account={plan_name:'Starter',plan_monthly_price:25,searches_per_month:100,this_month_usage:95,total_searches_left:5,plan_renewal_date:'2026-11-22'};
  fetch.mockResolvedValue(reply(account));const first=await collectSource(sourcesFor('serpapi')[0],undefined,undefined,now);
  fetch.mockResolvedValue(reply({...account,this_month_usage:0,total_searches_left:100,plan_renewal_date:'2026-12-22'}));
  expect((await collectSource(sourcesFor('serpapi')[0],first.baseline,undefined,now)).result).toMatchObject({status:'unchanged',attention:false});
});
test('blended billing percentage movement does not create another finding',async()=>{
  process.env.ANTHROPIC_ADMIN_API_KEY='test-admin';getMessagesUsageReport.mockResolvedValue(bucket([usage]));getCostReport.mockResolvedValue(bucket([cost('1200')]));
  const first=await collectSource(sourcesFor('anthropic')[2],undefined,undefined,now);
  getCostReport.mockResolvedValue(bucket([cost('1210')]));
  expect((await collectSource(sourcesFor('anthropic')[2],first.baseline,undefined,now)).result).toMatchObject({status:'unchanged',attention:true});
});
