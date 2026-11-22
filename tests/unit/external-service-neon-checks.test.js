/** @jest-environment node */
import {sourcesFor,collectSource} from '../../lib/services/external-services/check-sources';
import {CHECK_IDS} from '../../lib/services/external-services/check-store';
jest.mock('@vercel/postgres',()=>({sql:{query:jest.fn()},db:{connect:jest.fn()}}));
const now=new Date().toISOString();
const base={id:'icfg_test',slug:'neon',installationType:'marketplace',teamId:'team_test',periodStart:'2026-11-01T00:00:00Z',periodEnd:'2026-12-01T00:00:00Z',billingTotal:'2.50',billingPlan:{id:'launch',name:'Launch',type:'subscription',scope:'installation',details:[{label:'Compute',value:'$0.10/CU-hour'}]},billingData:{spending:{timestamp:now,periodStart:'2026-11-01T00:00:00Z',periodEnd:'2026-12-01T00:00:00Z',totalCent:250,discountCent:0,items:[{name:'Compute',price:'0.1',quantity:25,units:'CU-hours',total:'2.50',resourceId:'private-resource'}]},usage:{private:'private-usage'}},ownerId:'private-owner',secret:'private-secret'};
const reply=data=>({ok:true,status:200,body:new ReadableStream({start(c){c.enqueue(Buffer.from(JSON.stringify(data)));c.close();}})});
const fixture=()=>JSON.parse(JSON.stringify(base));
function mock(data=fixture(),list=[base]){fetch.mockImplementation(async url=>reply(new URL(url).pathname.endsWith('/configurations')?list:data));}
async function run(data=fixture(),baseline){mock(data);return Promise.all(sourcesFor('neon').map((s,i)=>collectSource(s,baseline?.[i]?.baseline,undefined,now)));}
beforeEach(()=>{global.fetch=jest.fn();process.env.VERCEL_SERVICE_CHECK_TOKEN='test-token';process.env.VERCEL_SERVICE_CHECK_TEAM_ID='team_test';});
test('discovers the owned installation, shares two bounded GETs, and projects no identifiers',async()=>{
 const result=await run();expect(CHECK_IDS).toContain('neon');expect(result.map(r=>r.result.status)).toEqual(['baseline','baseline']);expect(fetch).toHaveBeenCalledTimes(2);
 expect(result[1].result.lines.join()).toContain('$2.50');expect(result[0].result.lines.join()).toContain('Launch');
 for(const text of ['icfg_test','team_test','test-token','private-owner','private-secret','private-resource','private-usage'])expect(JSON.stringify(result)).not.toContain(text);
 for(const [url,opts] of fetch.mock.calls){expect(url.origin).toBe('https://api.vercel.com');expect(url.searchParams.get('teamId')).toBe('team_test');expect(opts).toMatchObject({redirect:'error',cache:'no-store',headers:{Authorization:'Bearer test-token'}});}
 expect(fetch.mock.calls[0][0].searchParams.get('view')).toBe('account');
});
test('no credential means no network, not zero billing',async()=>{delete process.env.VERCEL_SERVICE_CHECK_TOKEN;const result=await run();expect(result.every(r=>r.result.status==='unavailable')).toBe(true);expect(fetch).not.toHaveBeenCalled();expect(result[0].result.summary).not.toContain('Public reference');});
test.each([[],[base,base],[{...base,id:'../bad'}],[{...base,teamId:'team_other'}],[{...base,installationType:'external'}]].map(list=>[list]))('rejects absent, ambiguous, or unsafe discovery %j',async list=>{mock(fixture(),list);const r=await collectSource(sourcesFor('neon')[1],null,undefined,now);expect(r.result.status).toBe('unavailable');expect(fetch).toHaveBeenCalledTimes(1);});
test.each([{teamId:'team_other'},{id:'icfg_other'},{slug:'other'},{disabledAt:1},{deletedAt:1}])('rejects mismatched or inactive installation %j',async patch=>{const r=await run({...fixture(),...patch});expect(r.every(x=>x.result.status==='unavailable')).toBe(true);});
test('missing spending preserves its prior baseline while plan succeeds',async()=>{const first=await run();const data=fixture();delete data.billingData;const result=await run(data,first);expect(result[0].result.status).toBe('unchanged');expect(result[1].result.status).toBe('unavailable');expect(result[1].baseline).toEqual(first[1].baseline);});
test('spend changes are not plan changes; changed quoted plan rates remain pending',async()=>{
 const first=await run();const data=fixture();data.billingTotal='3.00';data.billingData.spending.totalCent=300;Object.assign(data.billingData.spending.items[0],{total:'3.00',quantity:30});
 const second=await run(data,first);expect(second.map(r=>r.result.status)).toEqual(['unchanged','unchanged']);expect(second[1].result.lines.join()).toContain('$3.00');
 data.billingPlan.details[0].value='$0.12/CU-hour';const third=await run(data,second);expect(third[0].result.status).toBe('changed');expect((await run(data,third))[0].result.status).toBe('changed');
});
test.each(['null','total','period','timestamp','items','sum','price','quantity','discount'])('invalid %s fails spending only',async kind=>{
 const data=fixture();const s=data.billingData.spending;
 if(kind==='null')data.billingData.spending=null;
 if(kind==='total')s.totalCent='250';
 if(kind==='period')s.periodEnd=s.periodStart;
 if(kind==='timestamp')s.timestamp='not-date';
 if(kind==='items')s.items=[];
 if(kind==='sum')s.items[0].total='9.00';
 if(kind==='price')s.items[0].price='NaN';
 if(kind==='quantity')s.items[0].quantity=-1;
 if(kind==='discount')s.discountCent=100;
 const r=await run(data);expect(r[0].result.status).toBe('baseline');expect(r[1].result.status).toBe('unavailable');
});
test('discounts reconcile and stale provider timestamp requires attention',async()=>{const d=fixture();d.billingData.spending.discountCent=50;d.billingData.spending.totalCent=200;d.billingTotal='2.00';d.billingData.spending.timestamp=new Date(Date.now()-72*3600000).toISOString();const r=await run(d);expect(r[1].result.status).toBe('baseline');expect(r[1].result.attention).toBe(true);expect(r[1].result.lines.join()).toContain('$0.50');});
test('malformed plan does not block spending; extra response properties do not affect fingerprints',async()=>{const first=await run();const d=fixture();d.billingPlan.details=[{label:'invalid',value:null}];const r=await run(d,first);expect(r[0].result.status).toBe('unavailable');expect(r[1].result.status).toBe('unchanged');});
test('HTTP rejection and interrupted network never replace successful baselines',async()=>{const first=await run();fetch.mockRejectedValue(new DOMException('private-secret','AbortError'));const result=await Promise.all(sourcesFor('neon').map((s,i)=>collectSource(s,first[i].baseline,undefined,now)));expect(result.every(r=>r.result.status==='unavailable')).toBe(true);expect(result.map(r=>r.baseline)).toEqual(first.map(r=>r.baseline));expect(JSON.stringify(result)).not.toContain('private-secret');});

test('valid zero-spend period may have no items',async()=>{const d=fixture();d.billingTotal='0';Object.assign(d.billingData.spending,{totalCent:0,items:[]});const r=await run(d);expect(r[1].result.status).toBe('baseline');expect(r[1].result.lines.join()).toContain('$0.00');});
test('sub-cent line amounts round after exact aggregation',async()=>{const d=fixture();d.billingTotal='2.01';d.billingData.spending.totalCent=201;const item={...d.billingData.spending.items[0],total:'1.004'};d.billingData.spending.items=[item,item];expect((await run(d))[1].result.status).toBe('baseline');});
test('long item metadata cannot truncate its amount and plan type changes are visible',async()=>{const d=fixture();Object.assign(d.billingData.spending.items[0],{name:'N'.repeat(120),units:'U'.repeat(120)});const r=await run(d);expect(r[1].result.lines.at(-1)).toContain('Amount $2.50');expect(r[0].result.lines.join()).toContain('subscription');expect(r[0].result.lines.join()).toContain('launch');});
