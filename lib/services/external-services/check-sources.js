/** Read-only, fixed-destination collectors. Never infer, purchase, transcribe, or send alerts.
 * Untrusted provider text is plain display evidence, never instructions or generated HTML.
 * Account responses are projected to explicit fields before retention; no raw bodies/URLs logged.
 */
import crypto from 'node:crypto';
import { db } from '@vercel/postgres';
import { LAST_REVIEWED_AT, lookupPricing } from '../../utils/model-pricing';
import { LAST_CAPABILITY_REVIEWED_AT } from '../model-capabilities';
import { findUnreviewedLiveClaudeModels, buildPricingAuditRows } from '../pricing-checks';
import { getCostReport, getMessagesUsageReport } from '../anthropic-admin';

const MAX_BYTES = 1024 * 1024;
const safeText = value => String(value).replace(/[\u0000-\u001f]/g, ' ').slice(0, 300);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
export async function boundedFetch(url, options = {}) {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000);
  const response = await fetch(url, { ...options, signal, redirect: 'error', cache: 'no-store' });
  if (!response.ok) throw new Error([401,403].includes(response.status) ? 'credential_rejected' : 'source_unavailable');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('invalid_response');
  let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('response_too_large');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  const body = Buffer.concat(chunks).toString('utf8');
  return { ok: true, status: response.status, text: async () => body, json: async () => JSON.parse(body) };
}
function observation(lines, fingerprint = lines, attention = false, summary = '') {
  return { fingerprint: digest(JSON.stringify(fingerprint)), lines: lines.slice(0, 40).map(safeText), attention, summary };
}
function markdownSource(key, label, url, required) {
  return { key, label, url, async collect(signal) {
    const text = await (await boundedFetch(url, { signal })).text();
    if (text.length < 100 || /<html|<!doctype/i.test(text) || !required.test(text)) throw new Error('invalid_response');
    const normalized = text.split('\n').map(s => s.trim().replace(/\s+/g,' ')).filter(Boolean);
    const relevant = normalized.filter(s => /pre.recorded|speech.model|diari[sz]|deprecat|retir|\$|current model family/i.test(s));
    if (!relevant.length) throw new Error('invalid_response');
    return observation(relevant.slice(0, 12), normalized, false, 'Official reference checked. Excerpts are limited; open the source for complete rates, scope, and qualifications.');
  }};
}
export const assemblySources = [
  markdownSource('pricing', 'Public pricing', 'https://www.assemblyai.com/pricing.md', /AssemblyAI.*Pricing/i),
  markdownSource('models', 'Models and retirement guidance', 'https://www.assemblyai.com/llms/models.md', /AssemblyAI.*Models/i),
];
const anthropicSources = [
  { key: 'registry', label: 'Available Claude models', url: 'https://platform.claude.com/docs/en/api/models/list', async collect(signal) {
    if (!process.env.CLAUDE_API_KEY) throw new Error('missing_credential');
    const models = []; let after;
    for (let page = 0; page < 10; page++) {
      const url = new URL('https://api.anthropic.com/v1/models'); url.searchParams.set('limit','100');
      if (after) url.searchParams.set('after_id',after);
      const data = await (await boundedFetch(url, { signal, headers: { 'x-api-key': process.env.CLAUDE_API_KEY, 'anthropic-version':'2023-06-01' } })).json();
      if (!Array.isArray(data.data) || !data.data.length || typeof data.has_more !== 'boolean' || data.data.some(m => typeof m.id !== 'string' || !/^claude-[a-zA-Z0-9.-]{1,100}$/.test(m.id) || !Number.isFinite(Date.parse(m.created_at)))) throw new Error('invalid_response');
      models.push(...data.data);
      if (!data.has_more) {
        const unreviewed = findUnreviewedLiveClaudeModels(models);
        const lines = [`${models.length} available models; ${unreviewed.length} newer models need registry review.`, `Capability registry reviewed: ${LAST_CAPABILITY_REVIEWED_AT}.`, ...unreviewed.map(m=>m.id).sort()];
        return observation(lines, { models: models.map(m=>[m.id,m.created_at]).sort(), unreviewed: unreviewed.map(m=>m.id).sort() }, unreviewed.length > 0, 'Uses the existing pricing-canary model coverage comparison. No model settings were changed.');
      }
      if (typeof data.last_id !== 'string' || data.last_id === after) throw new Error('invalid_response');
      after = data.last_id;
    }
    throw new Error('incomplete_response');
  }},
  { key: 'pricing', label: 'Local pricing coverage', url: 'https://github.com/justingallivan/wmkf-research-apps/blob/main/lib/utils/model-pricing.js', async collect() {
    const client = await db.connect();
    let rows;
    try {
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout='10s'");
      ({ rows } = await client.query("SELECT model,count(*)::int AS count FROM api_usage_log WHERE created_at >= now()-interval '7 days' AND model IS NOT NULL GROUP BY model ORDER BY model LIMIT 101"));
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
    finally { client.release(); }
    if (rows.length > 100) throw new Error('incomplete_response');
    const unknown = rows.filter(r=>!lookupPricing(r.model));
    const age = Math.floor((Date.now()-Date.parse(`${LAST_REVIEWED_AT}T00:00:00Z`))/86400000);
    return observation([`Pricing table reviewed: ${LAST_REVIEWED_AT} (${age} days ago).`,`${rows.length} models used in the last 7 days; ${unknown.length} without local pricing.`,...unknown.map(r=>`${safeText(r.model)}: ${r.count} requests`)], { reviewed: LAST_REVIEWED_AT, unknown: unknown.map(r=>r.model).sort() }, age>60 || unknown.length>0, 'Same 60-day threshold and pricing lookup as the weekly canary. This checks local coverage, not current vendor list prices.');
  }},
  { key: 'billing', label: 'Anthropic billing comparison', url: 'https://platform.claude.com/docs/en/manage-claude/usage-cost-api', async collect(signal) {
    if (!process.env.ANTHROPIC_ADMIN_API_KEY) throw new Error('missing_admin_credential');
    const end = new Date(); end.setUTCHours(0,0,0,0); const start = new Date(end.getTime()-30*86400000);
    const options = { startingAt:start.toISOString(), endingAt:end.toISOString(), signal, fetchImpl:boundedFetch };
    const [cost, usage] = await Promise.all([getCostReport({...options,groupBy:['description','workspace_id']}),getMessagesUsageReport(options)]);
    const {auditRows,skippedCount} = buildPricingAuditRows(cost,usage);
    const flagged = auditRows.filter(r=>r.flagged);
    if (!flagged.length && (skippedCount || !auditRows.length)) throw new Error('incomplete_comparison');
    const lines = [`Period: ${start.toISOString().slice(0,10)} to ${end.toISOString().slice(0,10)} (UTC; end excluded).`,`${auditRows.length} comparable model/token rates; ${flagged.length} unknown or more than 5% from local pricing; ${skippedCount} unsupported or unmatched rows excluded.`,...flagged.map(r=>`${safeText(r.model)} / ${r.tokenType}: ${r.deltaPct == null ? 'No local rate' : `${(r.deltaPct*100).toFixed(1)}% difference`}`)];
    const fingerprint = flagged.map(r=>[r.model,r.tokenType,r.deltaPct == null ? null : Number(r.deltaPct.toFixed(3))]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return observation(lines, fingerprint, flagged.length>0, 'Reuses the monthly comparison and existing legacy Admin API. Discounts and billing modifiers require interpretation; this is not a recommendation to change models.');
  }},
];
const serpSources = [{ key:'account', label:'SerpAPI plan and allowance', url:'https://serpapi.com/account-api', async collect(signal) {
  if (!process.env.SERP_API_KEY) throw new Error('missing_credential');
  const url = new URL('https://serpapi.com/account.json'); url.searchParams.set('api_key',process.env.SERP_API_KEY);
  const data = await (await boundedFetch(url,{signal})).json();
  const fields = ['plan_monthly_price','searches_per_month','this_month_usage','total_searches_left'];
  if (data.error || typeof data.plan_name !== 'string' || data.plan_name.length>120 || fields.some(k=>typeof data[k]!=='number'||!Number.isFinite(data[k])||data[k]<0) || (data.plan_renewal_date!=null && (typeof data.plan_renewal_date !== 'string'||!/^\d{4}-\d{2}-\d{2}$/.test(data.plan_renewal_date)))) throw new Error('invalid_response');
  // Explicit projection: response can contain api_key, account_email and account_id. Never retain them.
  const plan = {name:data.plan_name,monthlyPrice:data.plan_monthly_price,limit:data.searches_per_month,renewal:data.plan_renewal_date??null};
  const low = data.searches_per_month>0 && data.total_searches_left<=data.searches_per_month*0.1;
  return observation([`Plan: ${plan.name}; $${plan.monthlyPrice}/month.`,`Monthly searches: ${plan.limit}; used: ${data.this_month_usage}; total remaining: ${data.total_searches_left}.`,`Next renewal: ${plan.renewal || 'Not provided'}.`], {plan, low}, low, 'Plan/renewal changes and remaining allowance ≤10% are flagged. Routine usage changes alone are not a plan change. Account API calls do not consume search quota.');
}}];
export function sourcesFor(id) { return { assemblyai:assemblySources, anthropic:anthropicSources, serpapi:serpSources }[id] || []; }
const errors = {
  missing_credential:'The required provider credential is not configured.',
  missing_admin_credential:'The Anthropic Admin API credential is not configured.',
  credential_rejected:'The provider rejected access. Check account permissions.',
  incomplete_comparison:'No complete billing comparison was possible. No matching data or unsupported billing rows; the previous successful result is retained.',
};
export async function collectSource(source, baseline, signal, now) {
  try {
    const value = await source.collect(signal);
    const pending = !!baseline && (baseline.pending || value.fingerprint !== baseline.fingerprint);
    const changeFrom = pending ? baseline.changeFrom || {lines:baseline.lines,observedAt:baseline.observedAt} : undefined;
    const status = !baseline ? 'baseline' : pending ? 'changed' : 'unchanged';
    const changedLines = changeFrom ? value.lines.filter(line=>!changeFrom.lines.includes(line)) : [];
    return { result: {key:source.key,label:source.label,url:source.url,status,attention:value.attention || pending,summary:value.summary,lines:value.lines,previousLines:changeFrom?.lines.slice(0,12)||[],changedLines:changedLines.slice(0,12),observedAt:now,comparedAt:changeFrom?.observedAt||baseline?.observedAt||null}, baseline:{fingerprint:value.fingerprint,lines:value.lines,observedAt:now,pending,changeFrom} };
  } catch (error) {
    return { result:{key:source.key,label:source.label,url:source.url,status:'unavailable',summary:errors[error.message] || 'Could not check this source. It may be unavailable, incomplete, or have changed format. Retry later.',lines:[],observedAt:null,comparedAt:baseline?.observedAt||null}, baseline };
  }
}
