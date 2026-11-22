/** Public Cloudmersive plan reference only: no API key, scans, account requests or billing inference.
 * Extract bounded server-rendered plan cards, excluding navigation/scripts and signup links.
 * Pricing and limits have independent baselines; malformed references preserve prior success.
 */
import sanitizeHtml from 'sanitize-html';
export const CLOUDMERSIVE_PRICING_URL = 'https://cloudmersive.com/pricing-small-business';
const manual = 'Account usage and remaining quota: manual verification required in the Cloudmersive portal.';
const fail = () => { throw new Error('invalid_cloudmersive_reference'); };
const text = html => sanitizeHtml(html.replace(/<br\s*\/?\s*>/gi,' '),{allowedTags:[],allowedAttributes:{}})
  .replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const hasClass=(attributes,name)=>attributes.match(/\bclass="([^"]*)"/i)?.[1].split(/\s+/).includes(name);
function one(matches) { if (matches.length!==1) fail(); return matches[0]; }
function reference(raw) {
  const html=sanitizeHtml(raw,{allowedTags:['h2','ul','li','span','div','sup','select','option','br','input'],allowedAttributes:{'*':['class','id'],option:['selected','value'],input:['id','type','checked']}});
  if (!/<h2\b[^>]*>\s*Small Business Pricing\s*<\/h2>/i.test(html)) fail();
  const cards=[...html.matchAll(/<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi)].filter(m=>hasClass(m[1],'price')).map(m=>m[2]);
  const headers=[...html.matchAll(/<li\b([^>]*)>/gi)].filter(m=>hasClass(m[1],'header'));
  if (headers.length!==cards.length) fail();
  if (cards.length<2 || cards.length>20 || cards.some(c=>/<ul\b/i.test(c))) fail();
  const plans=cards.map(card=>{
    const name=text(one([...card.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)].filter(m=>hasClass(m[1],'header')))[2]);
    if (!name || name.length>60) fail();
    return {name,card};
  }).sort((a,b)=>a.name.localeCompare(b.name));
  if (new Set(plans.map(p=>p.name)).size!==plans.length || !plans.some(p=>p.name==='Free Tier') || !plans.some(p=>p.name==='Basic')) fail();
  return {html,plans};
}
export function createCloudmersiveSources({boundedFetch,observation}) {
  let pending;
  const load=signal=>pending ||= (async()=>{
    let raw;
    try { raw=await (await boundedFetch(CLOUDMERSIVE_PRICING_URL,{signal})).text(); }
    catch { throw new Error('cloudmersive_public_unavailable'); }
    return reference(raw);
  })();
  return [
    {key:'pricing',previousLinesLimit:40,label:'Cloudmersive public plan pricing',url:CLOUDMERSIVE_PRICING_URL,async collect(signal){
      const {html,plans}=await load(signal);
      const annual=one([...html.matchAll(/<input\b([^>]*\bid="MainContent_ctl00_chkAnnual"[^>]*)>/gi)])[1];
      if (!/\btype="checkbox"/.test(annual) || /\bchecked(?:=|\s|$)/.test(annual)) fail();
      const currency=one([...html.matchAll(/<select\b[^>]*id="MainContent_ctl00_cmbCurrency"[^>]*>([\s\S]*?)<\/select>/gi)])[1];
      const selected=one([...currency.matchAll(/<option\b([^>]*\bselected(?:="[^"]*")?[^>]*)>([\s\S]*?)<\/option>/gi)]);
      if (!/\bvalue="USD"/.test(selected[1])) fail();
      const prices=plans.map(({name,card})=>{
        const price=text(one([...card.matchAll(/<span\b[^>]*class="price"[^>]*>([\s\S]*?)<\/span>/gi)])[1]);
        if (price.length>60 || !/^(\$[\d,]+\.\d{2}\/Month|Contact Us)$/.test(price)) fail();
        return {name,price};
      });
      return observation([manual,...prices.map(p=>`${p.name}: ${p.price==='Contact Us'?'Contact vendor for pricing':`USD ${p.price}`}.`)],prices,false,'Public default monthly USD pricing, not your subscribed plan, negotiated price, annual discount or invoice. No account usage API is called. Public price changes require human review.');
    }},
    {key:'limits',previousLinesLimit:40,label:'Cloudmersive public plan limits',url:CLOUDMERSIVE_PRICING_URL,async collect(signal){
      const {html,plans}=await load(signal);
      const limits=plans.map(({name,card})=>{
        // Superscript markers are shown through the complete qualifications below, not mistaken for quantities.
        const rawRows=[...card.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(m=>m[1]);
        const rows=rawRows.map(row=>text(row.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi,'')));
        const monthly=one(rows.filter(r=>/Calls\/Month$/.test(r)));
        const rate=one(rows.filter(r=>/Calls\/Second$| Cores$/.test(r)));
        const file=one(rows.filter(r=>/Maximum File Size$/.test(r)));
        if ([monthly,rate,file].some(value=>value.length>60) || !/^([\d,]+|Unlimited\*) Calls\/Month$/.test(monthly) || !/^([\d,]+|Unlimited\*) (Calls\/Second|Cores)$/.test(rate) || !/^(\d+(\.\d+)? (MB|GB)|Unlimited) Maximum File Size$/.test(file)) fail();
        const markers=row=>[...rawRows[rows.indexOf(row)].matchAll(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi)].map(m=>text(m[1])).join(',');
        if (markers(monthly)!=='2' || markers(file)!=='‡' || markers(rate)!=='') fail();
        return {name,monthly,rate,file};
      });
      const qualifications=['','2','3'].map(suffix=>{const content=one([...html.matchAll(new RegExp(`<div\\b[^>]*id="MainContent_ctl00_divDetails${suffix}"[^>]*>([\\s\\S]*?)<\\/div>`,'gi'))])[1];if (/<div\b/i.test(content)) fail();return text(content);});
      const markers=['*','‡','2'];
      if (qualifications.some((q,i)=>q.length<30 || q.length>1000 || !q.startsWith(`${markers[i]} `))) fail();
      // Split long qualifications to avoid the shared 300-character display cap silently cutting them off.
      const notes=qualifications.flatMap((q,i)=>`[${markers[i]}] ${q.slice(1).trim()}`.match(/.{1,250}(?:\s|$)|.{1,250}/g).map(part=>part.trim()));
      if (1+limits.length+notes.length>40) fail();
      return observation([manual,...limits.map(p=>`${p.name}: ${p.monthly.replace(/\*/g," [*]")} [2]; ${p.rate.replace(/\*/g," [*]")}; ${p.file} [‡].`),...notes],{limits,qualifications},false,'Published plan ceilings, not measured usage or remaining allowance. API-specific limits and operation complexity apply; one file is not necessarily one billable call. These figures do not change our upload limits or scan configuration.');
    }}
  ];
}
