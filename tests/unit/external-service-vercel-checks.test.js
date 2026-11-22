/** @jest-environment node */
import { collectSource, sourcesFor } from '../../lib/services/external-services/check-sources';
import { CHECK_IDS, assertCheckId } from '../../lib/services/external-services/check-store';
jest.mock('@vercel/postgres',()=>({sql:{query:jest.fn()},db:{connect:jest.fn()}}));
const now='2026-11-22T00:00:00.000Z';
const reply=(value,status=200)=>({ok:status===200,status,body:new ReadableStream({start(c){c.enqueue(Buffer.from(value));c.close();}})});
const plan='# Vercel Pro Plan\n## Monthly credit\n- Monthly credit: $20.\n## Platform fee\n- $20/month platform fee.\nCredit expires each month.\n';
const runtime=`# Supported Node.js versions\nCurrent available versions are:\n\n- **${process.versions.node.split('.')[0]}.x** (default)\n- **20.x**\n\nOnly major versions are available. Vercel automatically rolls out minor and patch updates.\n`;
const row={ServiceProviderName:'Vercel',BillingCurrency:'USD',ChargeCategory:'Usage',ServiceName:'Function Invocations',ConsumedUnit:'Invocations',ConsumedQuantity:5,EffectiveCost:0.02,ChargePeriodStart:'2026-11-20T08:00:00.000Z',ChargePeriodEnd:'2026-11-21T08:00:00.000Z',Tags:{private:'do-not-retain'},SubAccountName:'private-account',ResourceName:'private-project',api_key:'private-key'};
const source=key=>sourcesFor('vercel-hosting').find(s=>s.key===key);
const collect=(key,baseline)=>collectSource(source(key),baseline,undefined,now);
beforeEach(()=>{global.fetch=jest.fn();delete process.env.VERCEL_SERVICE_CHECK_TOKEN;delete process.env.VERCEL_SERVICE_CHECK_TEAM_ID;});
test('only hosting is allowlisted, other Vercel inventory items remain manual',()=>{
  expect(CHECK_IDS).toContain('vercel-hosting');expect(()=>assertCheckId('vercel-hosting')).not.toThrow();
  for(const id of ['vercel-blob','vercel-workflow','vercel-sandbox','microsoft']){expect(()=>assertCheckId(id)).toThrow();expect(sourcesFor(id)).toEqual([]);}
});
test('public pricing works without a token, excludes generated navigation, and flags substantive changes',async()=>{
  fetch.mockResolvedValue(reply(plan));const first=await collect('pricing');expect(first.result.status).toBe('baseline');
  fetch.mockResolvedValue(reply(plan+'<!-- docsgraph:related -->\nNavigation changed\n<!-- /docsgraph:related -->'));
  expect((await collect('pricing',first.baseline)).result.status).toBe('unchanged');
  fetch.mockResolvedValue(reply(plan.replace('$20/month','$30/month')));const changed=await collect('pricing',first.baseline);
  expect(changed.result.status).toBe('changed');expect(changed.result.lines.join()).toContain('$30/month');
  expect(fetch).toHaveBeenCalledWith('https://vercel.com/docs/plans/pro-plan.md',expect.objectContaining({redirect:'error',cache:'no-store'}));
});
test('runtime comparison reports supported running major, notices and a deliberate upgrade boundary',async()=>{
  fetch.mockResolvedValue(reply(runtime+'- [Node.js 20 is being deprecated](https://vercel.com/changelog/node-js-20-is-being-deprecated)\n'));
  const result=(await collect('runtime')).result;expect(result.status).toBe('baseline');expect(result.attention).toBe(false);
  expect(result.lines.join()).toContain('listed as supported');expect(result.lines.join()).toContain('being deprecated');
  expect(result.summary).toContain('this running deployment only');
});
test('unsupported runtime is attention and malformed version lists preserve prior success',async()=>{
  fetch.mockResolvedValue(reply(runtime.replace(/- \*\*\d+\.x\*\*/g,'- **99.x**')));
  const first=await collect('runtime');expect(first.result.attention).toBe(true);
  fetch.mockResolvedValue(reply(runtime.replace('Current available versions are:','Format changed:')));
  const next=await collect('runtime',first.baseline);expect(next.result.status).toBe('unavailable');expect(next.baseline).toEqual(first.baseline);
});
test.each(['pricing','runtime'])('%s rejects HTML, missing headings, and oversized references',async key=>{
  for(const text of ['<html>'+plan, 'Changed content '.repeat(50), 'x'.repeat(1024*1024+1)]){
    fetch.mockResolvedValue(reply(text));expect((await collect(key)).result.status).toBe('unavailable');
  }
});
test('missing or malformed account setup never calls Vercel',async()=>{
  expect((await collect('usage')).result.summary).toContain('needs setup');
  process.env.VERCEL_SERVICE_CHECK_TOKEN='test-token';process.env.VERCEL_SERVICE_CHECK_TEAM_ID='https://attacker.invalid';
  expect((await collect('usage')).result).toMatchObject({status:'unavailable',summary:expect.stringContaining('needs setup')});expect(fetch).not.toHaveBeenCalled();
});
function configured(){process.env.VERCEL_SERVICE_CHECK_TOKEN='test-token';process.env.VERCEL_SERVICE_CHECK_TEAM_ID='team_test';}
test('FOCUS projection aggregates service/unit rows and never retains identity, tags, or secrets',async()=>{
  configured();fetch.mockResolvedValue(reply([row,{...row,ConsumedQuantity:7,EffectiveCost:0.03},{...row,ServiceName:'Pro',ChargeCategory:'Purchase',ConsumedUnit:'licenses',ConsumedQuantity:1,EffectiveCost:20}].map(r=>JSON.stringify(r)).join('\n')));
  const value=await collect('usage');expect(value.result.status).toBe('baseline');
  expect(value.result.lines.join()).toContain('12 Invocations; USD 0.0500');expect(value.result.lines.join()).toContain('USD 20.0500');
  expect(value.result.lines.join()).toContain('Team-wide reported rows only');expect(value.result.lines.join()).toContain('not an invoice');
  for(const hidden of ['private-account','private-project','private-key','do-not-retain','test-token','team_test'])expect(JSON.stringify(value)).not.toContain(hidden);
  const [url,options]=fetch.mock.calls[0];expect(url.origin+url.pathname).toBe('https://api.vercel.com/v1/billing/charges');expect(url.searchParams.get('teamId')).toBe('team_test');
  expect(Date.parse(url.searchParams.get('to'))-Date.parse(url.searchParams.get('from'))).toBe(7*86400000);
  expect(options).toMatchObject({headers:{Authorization:'Bearer test-token'},redirect:'error',cache:'no-store'});
});
test('routine usage, amounts and date changes do not create a pricing-change flag',async()=>{
  configured();fetch.mockResolvedValue(reply(JSON.stringify(row)));const first=await collect('usage');
  fetch.mockResolvedValue(reply(JSON.stringify({...row,ConsumedQuantity:100,EffectiveCost:12,ChargePeriodEnd:'2026-11-22T08:00:00.000Z'})));
  expect((await collect('usage',first.baseline)).result.status).toBe('unchanged');
  process.env.VERCEL_SERVICE_CHECK_TEAM_ID='team_different';fetch.mockResolvedValue(reply(JSON.stringify(row)));expect((await collect('usage',first.baseline)).result.status).toBe('changed');
});
test.each([{BillingCurrency:'EUR'},{EffectiveCost:'1'},{ConsumedQuantity:'1'},{ConsumedUnit:null},{ChargeCategory:'Unrecognized'},{ChargePeriodEnd:'bad'}, {ServiceProviderName:'Other'}])('malformed or unsupported billing row fails completely: %j',async patch=>{
  configured();fetch.mockResolvedValue(reply(JSON.stringify(row)));const first=await collect('usage');
  fetch.mockResolvedValue(reply(JSON.stringify(row)+'\n'+JSON.stringify({...row,...patch})));
  const next=await collect('usage',first.baseline);expect(next.result.status).toBe('unavailable');expect(next.baseline).toEqual(first.baseline);
});
test('empty, oversized, truncated JSONL, rejected credentials and group overflow are explicit failures',async()=>{
  configured();
  for(const text of ['',JSON.stringify(row)+'\n{', 'x'.repeat(8*1024*1024+1),Array.from({length:201},(_,i)=>JSON.stringify({...row,ServiceName:`Service ${i}`})).join('\n')]){
    fetch.mockResolvedValue(reply(text));expect((await collect('usage')).result.status).toBe('unavailable');
  }
  fetch.mockResolvedValue(reply('{}',403));expect((await collect('usage')).result.summary).toContain('rejected access');
});
test('billing accepts a response above 1 MiB within its own cap, while keeping the snapshot small',async()=>{
  configured();fetch.mockResolvedValue(reply(Array.from({length:3000},()=>JSON.stringify(row)).join('\n')));
  const value=await collect('usage');expect(value.result.status).toBe('baseline');expect(JSON.stringify(value).length).toBeLessThan(10000);
});

test('signed corrections and null-quantity subscription charges preserve costs without inventing quantities',async()=>{
  configured();
  fetch.mockResolvedValue(reply([row,{...row,ConsumedQuantity:-2,EffectiveCost:-0.01},{...row,ServiceName:'Pro',ChargeCategory:'Purchase',ConsumedUnit:null,ConsumedQuantity:null,EffectiveCost:1}].map(r=>JSON.stringify(r)).join('\n')));
  const value=await collect('usage');expect(value.result.status).toBe('baseline');
  expect(value.result.lines.join()).toContain('3 Invocations');expect(value.result.lines.join()).toContain('USD 1.0100');
  expect(value.result.lines.join()).toContain('Pro (Purchase): quantity not supplied');
});

test('valid oversized bodies prove the byte limits independently of parsing and row caps',async()=>{
  configured();
  const large=Array.from({length:2100},()=>JSON.stringify({...row,Tags:{padding:'a'.repeat(4000)}})).join('\n');
  expect(Buffer.byteLength(large)).toBeGreaterThan(8*1024*1024);
  fetch.mockResolvedValue(reply(large));await expect(source('usage').collect()).rejects.toThrow('response_too_large');
  for(const [key,body] of [['pricing',plan],['runtime',runtime]]){
    fetch.mockResolvedValue(reply(body+'\n'+'Ordinary text. '.repeat(80000)));
    await expect(source(key).collect()).rejects.toThrow('response_too_large');
    fetch.mockResolvedValue(reply('<html>'+body));await expect(source(key).collect()).rejects.toThrow('invalid_response');
  }
});
test('row bound rejects otherwise valid JSONL below the byte cap',async()=>{
  configured();const body=Array.from({length:12001},()=>JSON.stringify(row)).join('\n');
  expect(Buffer.byteLength(body)).toBeLessThan(8*1024*1024);fetch.mockResolvedValue(reply(body));
  await expect(source('usage').collect()).rejects.toThrow('vercel_usage_bounds');
});
test('an aborted Vercel read fails without replacing the last success',async()=>{
  configured();fetch.mockResolvedValue(reply(JSON.stringify(row)));const first=await collect('usage');
  const controller=new AbortController();
  fetch.mockImplementation(async(_url,{signal})=>{controller.abort();if(signal.aborted)throw new Error('aborted');return reply(JSON.stringify(row));});
  const next=await collectSource(source('usage'),first.baseline,controller.signal,now);
  expect(next.result.status).toBe('unavailable');expect(next.baseline).toBe(first.baseline);
  expect(fetch.mock.calls.at(-1)[1].signal.aborted).toBe(true);
});

test.each([400,404,410,429,500,503])('HTTP %s is actionable without retaining provider body',async status=>{
  configured();fetch.mockResolvedValue(reply('private-account private-key',status));
  const result=(await collect('usage')).result;
  expect(result.summary).toContain(`HTTP ${status}`);
  expect(JSON.stringify(result)).not.toMatch(/private-account|private-key|test-token/);
});
test.each([['TimeoutError','time limit'],['AbortError','interrupted'],['TypeError','network access'],['SyntaxError','malformed']])('classifies %s without exposing error details',async(name,message)=>{
  configured();const error=name==='TypeError'?new TypeError('private-key'):name==='SyntaxError'?new SyntaxError('private-key'):Object.assign(new Error('private-key'),{name});
  fetch.mockRejectedValue(error);const result=(await collect('usage')).result;
  expect(result.summary).toContain(message);expect(JSON.stringify(result)).not.toContain('private-key');
});

test.each(['null','[]','1'])('non-object JSONL %s is a malformed response, not a network error',async body=>{configured();fetch.mockResolvedValue(reply(body));expect((await collect('usage')).result.summary).toContain('malformed response');});
