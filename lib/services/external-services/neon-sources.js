/** Manual Neon Marketplace reads via customer-owned Vercel integration configuration.
 * No partner credentials, database queries, invoice writes or raw account/resource retention.
 * Billing fields are live-observed extensions of the documented configuration response;
 * missing/changed shapes fail closed. One request pair is shared only within one check.
 */
const sourceUrl = 'https://vercel.com/docs/rest-api/integrations/retrieve-an-integration-configuration';
const validText = (s, max=120) => typeof s === 'string' && s.trim().length > 0 && s.length <= max && !/[\u0000-\u001f]/.test(s);
const date = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(s) && Number.isFinite(Date.parse(s));
const money = s => typeof s === 'string' && /^\d{1,12}(\.\d{1,9})?$/.test(s) && Number.isFinite(Number(s));
const cents = n => Number.isSafeInteger(n) && n >= 0;
const fail = () => { throw new Error('invalid_neon_billing'); };
export function createNeonSources({ boundedFetch, observation }) {
  let pending;
  const load = signal => pending ||= (async()=>{
    const token=process.env.VERCEL_SERVICE_CHECK_TOKEN, team=process.env.VERCEL_SERVICE_CHECK_TEAM_ID;
    if (!token || !/^team_[a-zA-Z0-9]{1,100}$/.test(team || '')) throw new Error('missing_neon_configuration');
    const get = async path => {
      const url=new URL(`https://api.vercel.com${path}`);url.searchParams.set('teamId',team);
      return (await boundedFetch(url,{signal,headers:{Authorization:`Bearer ${token}`}})).json();
    };
    const configs=await get('/v1/integrations/configurations?view=account');
    if (!Array.isArray(configs) || configs.length>100) fail();
    const neon=configs.filter(c=>c?.slug==='neon' && c.installationType==='marketplace');
    if (neon.length!==1) throw new Error('neon_installation_ambiguous');
    const id=neon[0].id;
    if (!/^icfg_[a-zA-Z0-9]{1,100}$/.test(id || '') || neon[0].teamId!==team) fail();
    const data=await get(`/v1/integrations/configuration/${id}`);
    if (!data || data.id!==id || data.teamId!==team || data.slug!=='neon' || data.installationType!=='marketplace') fail();
    if (data.deletedAt || data.disabledAt) throw new Error('neon_installation_inactive');
    return {data,team,id};
  })();
  return [
    {key:'plan',label:'Neon Marketplace plan',url:sourceUrl,async collect(signal){
      const {data,team,id}=await load(signal);const p=data.billingPlan;
      if (!p || !validText(p.id) || !validText(p.name) || !validText(p.type) || !validText(p.scope) || !Array.isArray(p.details) || p.details.length>20 || p.details.some(d=>!validText(d?.label) || !validText(d?.value))) fail();
      const details=p.details.map(d=>({label:d.label,value:d.value})).sort((a,b)=>a.label.localeCompare(b.label)||a.value.localeCompare(b.value));
      return observation([`Billed through Vercel Marketplace. Plan: ${p.name} (${p.id}).`, `Plan type: ${p.type}; scope: ${p.scope}.`,...details.map(d=>`${d.label}: ${d.value}`)],{team,id,plan:{id:p.id,name:p.name,type:p.type,scope:p.scope,details}},false,'Account plan details reported by Vercel for the Neon installation. Plan changes need review; quoted rates are not a final invoice or effective blended usage rates. Covers the installation, not just this app.');
    }},
    {key:'usage',label:'Neon Marketplace spending — current reported period',comparison:'scope',url:sourceUrl,async collect(signal){
      const {data,team,id}=await load(signal);const s=data.billingData?.spending;
      if (!s || !date(s.timestamp) || !date(s.periodStart) || !date(s.periodEnd) || Date.parse(s.periodEnd)<=Date.parse(s.periodStart)
        || s.periodStart!==data.periodStart || s.periodEnd!==data.periodEnd || !cents(s.totalCent) || !cents(s.discountCent)
        || !money(data.billingTotal) || Math.round(Number(data.billingTotal)*100)!==s.totalCent || !Array.isArray(s.items) || s.items.length>30) fail();
      if (Date.parse(s.timestamp)>Date.now()+300000) fail();
      if (s.items.some(i=>!validText(i?.name) || !validText(i.units) || !money(i.price) || !money(i.total) || typeof i.quantity!=='number' || !Number.isFinite(i.quantity) || i.quantity<0 || i.quantity>1e15)) fail();
      // Keep provider decimal precision through aggregation, then round once to cents.
      const nanos=s.items.reduce((sum,i)=>{const [whole,fraction='']=i.total.split('.');return sum+BigInt(whole)*1000000000n+BigInt(fraction.padEnd(9,'0'));},0n);
      const itemCents=Number((nanos+5000000n)/10000000n);
      if (!Number.isSafeInteger(itemCents) || itemCents-s.discountCent!==s.totalCent) fail();
      const stale=Date.now()-Date.parse(s.timestamp)>48*3600000 || Date.parse(s.periodEnd)<=Date.now();
      return observation([
        `Reported spending: $${(s.totalCent/100).toFixed(2)}; billed through Vercel Marketplace, reported separately from the hosting check.`,
        `Reported period: ${s.periodStart} to ${s.periodEnd} (end excluded).`,
        `Provider updated: ${s.timestamp}${stale?' — stale; review in Vercel.':''}`,
        `Reported discounts: $${(s.discountCent/100).toFixed(2)}.`,
        ...s.items.map(i=>`Amount $${i.total}; ${i.name}: ${i.quantity} ${i.units}; reported rate $${i.price}.`)
      ],{team,id},stale,'Provider-reported interim spending for the whole Neon installation, across its databases. Dollar amounts follow Vercel billing; this response does not supply a currency code. Not a paid invoice, forecast, quota balance, or complete account bill. Routine spending and quantity changes are not pricing changes. Billing fields are live-observed API extensions and may change; malformed data is unavailable rather than estimated.');
    }}
  ];
}
