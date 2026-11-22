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
function markdownSource(key, label, url, required, summary = 'Official reference checked. Excerpts are limited; open the source for complete rates, scope, and qualifications.') {
  return { key, label, url, async collect(signal) {
    const text = await (await boundedFetch(url, { signal })).text();
    if (text.length < 100 || /<html|<!doctype/i.test(text) || !required.test(text)) throw new Error('invalid_response');
    const normalized = text.split('\n').map(s => s.trim().replace(/\s+/g,' ')).filter(Boolean);
    const relevant = normalized.filter(s => /pre.recorded|speech.model|diari[sz]|deprecat|retir|\$|current model family/i.test(s));
    if (!relevant.length) throw new Error('invalid_response');
    return observation(relevant.slice(0, 12), normalized, false, summary);
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
    const fingerprint = flagged.map(r=>[r.model,r.tokenType,r.localCentsPerMtok != null]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return observation(lines, fingerprint, flagged.length>0, 'Reuses the monthly comparison and existing legacy Admin API. Discounts and billing modifiers require interpretation; this is not a recommendation to change models.');
  }},
];
// Provider identity is not stored in api_usage_log; prefix matching is a bounded
// telemetry view, not a complete inventory of configured models or account spend.
const openaiSources = [
  { key:'models', label:'Available OpenAI models', url:'https://developers.openai.com/api/docs/models', async collect(signal, baseline) {
    if (!process.env.OPENAI_API_KEY) throw new Error('missing_credential');
    const data = await (await boundedFetch('https://api.openai.com/v1/models', {signal, headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`}})).json();
    if (data.object !== 'list' || !Array.isArray(data.data) || !data.data.length || data.data.length > 3000 || data.has_more === true || data.data.some(m=>typeof m?.id !== 'string' || m.id.length > 200)) throw new Error('invalid_response');
    // Fine-tuned model IDs can encode private organization/job names. Never retain them.
    const ids = [...new Set(data.data.map(m=>m.id).filter(id=>/^(gpt-|chatgpt-|o[1-9][0-9]*[-.]|o[1-9][0-9]*$|text-embedding-|whisper-|tts-|dall-e-)/.test(id) && /^[a-zA-Z0-9._-]+$/.test(id)))].sort();
    if (!ids.length || ids.length > 500 || ids.some(id=>id.length>100)) throw new Error('invalid_response');
    const priorIds = baseline?.pending ? baseline.changeFrom?.modelIds : baseline?.modelIds;
    const changes=[];
    if (priorIds) {
      const added=ids.filter(id=>!priorIds.includes(id));
      const removed=priorIds.filter(id=>!ids.includes(id));
      if (baseline?.pending && !added.length && !removed.length) changes.push('No net model-list difference from the pending baseline; the earlier change still awaits review.');
      if (added.length) changes.push(`Added (${added.length}; showing up to 12):`, ...added.slice(0,12).map(id=>`Added: ${id}`));
      if (removed.length) changes.push(`Removed (${removed.length}; showing up to 12):`, ...removed.slice(0,12).map(id=>`Removed: ${id}`));
    }
    const value=observation([...changes, `${ids.length} public model IDs visible to the configured API key.`, 'Model preview follows; excerpts are bounded. Comparison covers all filtered IDs.', ...ids.slice(0,35)], ids, false, 'Availability changes need review; availability does not establish pricing, suitability, or configured use. Private fine-tuned IDs are excluded. No inference requests were made.');
    return {...value, modelIds:ids};
  }},
  { key:'pricing', label:'Recent OpenAI usage and local pricing coverage', url:'https://github.com/justingallivan/wmkf-research-apps/blob/main/lib/utils/model-pricing.js', async collect() {
    const client = await db.connect(); let rows;
    try {
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout='10s'");
      ({rows} = await client.query("SELECT model,count(*)::int AS count FROM api_usage_log WHERE created_at >= now()-interval '7 days' AND model ~ '^(gpt-|chatgpt-|o[1-9][0-9]*($|[-.])|text-embedding-|whisper-|tts-|dall-e-)' GROUP BY model ORDER BY model LIMIT 101"));
      await client.query('COMMIT');
    } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
    finally {client.release();}
    if (rows.length > 100) throw new Error('incomplete_response');
    const unknown=rows.filter(r=>!lookupPricing(r.model));
    const age=Math.floor((Date.now()-Date.parse(`${LAST_REVIEWED_AT}T00:00:00Z`))/86400000);
    return observation([`Pricing table reviewed: ${LAST_REVIEWED_AT} (${age} days ago).`, `${rows.length} matching model IDs logged in the last 7 days; ${unknown.length} without local pricing.`, ...[...unknown,...rows.filter(r=>lookupPricing(r.model))].map(r=>`${safeText(r.model)}: ${r.count} logged requests; ${lookupPricing(r.model)?'local rate available':'NO LOCAL RATE'}`)], {reviewed:LAST_REVIEWED_AT,unknown:unknown.map(r=>r.model).sort()}, age>60||unknown.length>0, 'Partial local telemetry: Executor OpenAI runs appear only when their caller logs usage, so configured models may be missing. Model-prefix matching and zero rows do not establish complete OpenAI usage. Fine-tuned IDs are excluded. These are local estimates, not current vendor prices or organization billing. Request-count changes are not pricing changes.');
  }},
  markdownSource('deprecations', 'Official OpenAI retirement notices', 'https://developers.openai.com/api/docs/deprecations.md', /^# Deprecations/m, 'Provider-wide retirement notices; not matched to configured models. Excerpts are limited and may include past retirements. Read the complete source before deciding.'),
];
const serpSources = [{ key:'account', label:'SerpAPI plan and allowance', url:'https://serpapi.com/account-api', async collect(signal) {
  if (!process.env.SERP_API_KEY) throw new Error('missing_credential');
  const url = new URL('https://serpapi.com/account.json'); url.searchParams.set('api_key',process.env.SERP_API_KEY);
  const data = await (await boundedFetch(url,{signal})).json();
  const fields = ['plan_monthly_price','searches_per_month','this_month_usage','plan_searches_left','extra_credits','total_searches_left'];
  if (data.error || typeof data.plan_name !== 'string' || data.plan_name.length>120 || fields.some(k=>typeof data[k]!=='number'||!Number.isFinite(data[k])||data[k]<0) || (data.plan_renewal_date!=null && (typeof data.plan_renewal_date !== 'string'||!/^\d{4}-\d{2}-\d{2}$/.test(data.plan_renewal_date)))) throw new Error('invalid_response');
  // Explicit projection: response can contain api_key, account_email and account_id. Never retain them.
  const plan = {name:data.plan_name,monthlyPrice:data.plan_monthly_price,limit:data.searches_per_month,renewal:data.plan_renewal_date??null};
  const low = data.searches_per_month>0 && data.total_searches_left<=data.searches_per_month*0.1;
  return observation([`Plan: ${plan.name}; $${plan.monthlyPrice}/month.`,`Monthly searches: ${plan.limit}; used: ${data.this_month_usage}; monthly remaining: ${data.plan_searches_left}.`,`Extra credits: ${data.extra_credits}; total remaining: ${data.total_searches_left}.`,`Next renewal: ${plan.renewal || 'Not provided'}.`], {name:plan.name,monthlyPrice:plan.monthlyPrice,limit:plan.limit}, low, 'Plan changes are flagged; total remaining searches ≤10% of the monthly allowance needs attention. Routine usage, extra-credit balance changes, and monthly resets are not plan changes. Account API calls do not consume search quota.');
}}];
export function sourcesFor(id) { return { assemblyai:assemblySources, anthropic:anthropicSources, serpapi:serpSources, openai:openaiSources }[id] || []; }
const errors = {
  missing_credential:'The required provider credential is not configured.',
  missing_admin_credential:'The Anthropic Admin API credential is not configured.',
  credential_rejected:'The provider rejected access. Check account permissions.',
  incomplete_comparison:'No complete billing comparison was possible. No matching data or unsupported billing rows; the previous successful result is retained.',
};
export async function collectSource(source, baseline, signal, now) {
  try {
    const value = await source.collect(signal, baseline);
    const pending = !!baseline && (baseline.pending || value.fingerprint !== baseline.fingerprint);
    const changeFrom = pending ? baseline.changeFrom || {lines:baseline.lines,observedAt:baseline.observedAt,...(baseline.modelIds ? {modelIds:baseline.modelIds} : {})} : undefined;
    const status = !baseline ? 'baseline' : pending ? 'changed' : 'unchanged';
    const changedLines = changeFrom ? value.lines.filter(line=>!changeFrom.lines.includes(line)) : [];
    return { result: {key:source.key,label:source.label,url:source.url,status,pending,attention:value.attention || pending,summary:value.summary,lines:value.lines,previousLines:changeFrom?.lines.slice(0,12)||[],changedLines:changedLines.slice(0,12),observedAt:now,comparedAt:changeFrom?.observedAt||baseline?.observedAt||null}, baseline:{fingerprint:value.fingerprint,lines:value.lines,observedAt:now,pending,changeFrom,...(value.modelIds ? {modelIds:value.modelIds} : {})} };
  } catch (error) {
    const pending = !!baseline?.pending;
    const failure = errors[error.message] || 'Could not check this source. It may be unavailable, incomplete, or have changed format. Retry later.';
    return { result:{key:source.key,label:source.label,url:source.url,status:'unavailable',pending,attention:pending,
      summary:pending ? `${failure} A previously detected change is still unreviewed. The evidence below is from the last successful check, not a fresh result.` : failure,
      lines:pending ? baseline.lines : [],previousLines:pending ? baseline.changeFrom?.lines.slice(0,12)||[] : [],
      observedAt:null,retainedObservedAt:pending ? baseline.observedAt : null,comparedAt:baseline?.changeFrom?.observedAt||baseline?.observedAt||null}, baseline };
  }
}
