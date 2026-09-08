/**
 * Cycle Dossier generation stages.
 *
 * This module deliberately owns no queue, lease, upload, or dossier persistence.
 * It freezes the source/configuration envelope, performs bounded research, and
 * returns an immutable entry payload for the caller to checkpoint.
 */
import { createHash } from 'crypto';
import * as grantRequestAdapter from '../dataverse/adapters/grant-request.js';
import { getAiProposalNarrativeText } from './workbench-proposal-documents.js';
import { fetchCurrentPrompt } from './prompt-store.js';
import { executePrompt } from './execute-prompt.js';
import { OpenAlexService } from './openalex-service.js';
import { PubMedService } from './pubmed-service.js';
import { isGuid } from '../utils/guid.js';
import { lookupPricing } from '../utils/model-pricing.js';
import * as researchDefinition from '../../shared/config/prompts/cycle-dossier-research-plan.js';
import * as entryDefinition from '../../shared/config/prompts/cycle-dossier-entry.js';

export const RESEARCH_PROMPT_NAME = 'cycle-dossier.research-plan';
export const ENTRY_PROMPT_NAME = 'cycle-dossier.entry';
export const MAX_RESEARCH_QUERIES = 3;
export const MAX_RESULTS_PER_SOURCE = 5;
export const MAX_EVIDENCE_ITEMS = 20;
export const MAX_NARRATIVE_CHARS = 100000;
export const MAX_EVIDENCE_CHARS = 60000;

const REQUEST_SELECT = [
  'akoya_requestid', 'akoya_requestnum', 'akoya_title', 'wmkf_organizationname',
  '_wmkf_projectleader_value', '_wmkf_programdirector_value',
  'wmkf_ai_fitrationale', 'wmkf_ai_summary', 'wmkf_ai_dataextract', 'wmkf_ai_fieldprimer',
].join(',');

export class CycleDossierInputError extends Error {
  constructor(message, code = 'cycle_dossier_input_invalid') {
    super(message);
    this.name = 'CycleDossierInputError';
    this.code = code;
  }
}

export class CycleDossierResearchError extends Error {
  constructor(message, code = 'cycle_dossier_research_unavailable') {
    super(message);
    this.name = 'CycleDossierResearchError';
    this.code = code;
  }
}

const text = (value, max = 20000) => String(value ?? '').trim().slice(0, max);
const sha256 = (value) => createHash('sha256').update(String(value || '')).digest('hex');

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function parseAiContext(value, maxChars = 10000) {
  if (!value) return null;
  const raw = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (raw.length > maxChars) return { truncated: true, originalChars: raw.length, text: raw.slice(0, maxChars) };
  if (typeof value === 'object') return clone(value);
  try { return JSON.parse(raw); } catch { return raw; }
}

/** Resolve and freeze the exact proposal narrative plus the request identity. */
export async function prepareRequestInput(requestId, { requestNumber = null } = {}) {
  if (!isGuid(requestId)) throw new CycleDossierInputError('requestId must be a valid GUID');
  const row = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
  if (!row) throw new CycleDossierInputError('Request was not found', 'cycle_dossier_request_missing');
  const number = text(requestNumber || row.akoya_requestnum, 120);
  if (!number) throw new CycleDossierInputError('Request is missing its request number');
  const narrative = await getAiProposalNarrativeText(requestId, number);
  if (!narrative?.text || narrative.text.trim().length < 100) {
    throw new CycleDossierInputError('The exact Proposal Narrative is missing or too short', 'cycle_dossier_narrative_missing');
  }
  if (narrative.text.length > MAX_NARRATIVE_CHARS) {
    throw new CycleDossierInputError('The exact Proposal Narrative exceeds the supported context bound', 'cycle_dossier_narrative_too_large');
  }
  const source = {
    type: 'sharepoint-proposal-narrative',
    filename: narrative.filename,
    siteId: narrative.siteId,
    driveId: narrative.driveId,
    itemId: narrative.itemId,
    versionId: narrative.versionId,
    contentHash: narrative.contentHash || sha256(narrative.text),
    text: narrative.text,
    capturedAt: new Date().toISOString(),
  };
  return freezeDeep({
    requestId,
    requestNumber: number,
    title: text(row.akoya_title, 1000),
    institution: text(row.wmkf_organizationname, 1000),
    pi: text(row._wmkf_projectleader_value_formatted || row._wmkf_projectleader_value, 500),
    programDirector: text(row._wmkf_programdirector_value_formatted || row._wmkf_programdirector_value, 500),
    narrative: source,
    priorAiContext: {
      fitRationale: parseAiContext(row.wmkf_ai_fitrationale, 10000),
      summary: parseAiContext(row.wmkf_ai_summary, 10000),
      dataExtract: parseAiContext(row.wmkf_ai_dataextract, 10000),
      fieldPrimer: parseAiContext(row.wmkf_ai_fieldprimer, 10000),
    },
  });
}

function snapshotPrompt(row, expectedName) {
  if (!row || row.wmkf_ai_promptname !== expectedName || !isGuid(row.wmkf_ai_promptid)) {
    throw new CycleDossierInputError(`Missing valid published prompt snapshot for ${expectedName}`, 'cycle_dossier_prompt_missing');
  }
  if (!Number.isInteger(Number(row.wmkf_promptversion)) || Number(row.wmkf_promptversion) < 1) {
    throw new CycleDossierInputError(`Invalid prompt version for ${expectedName}`, 'cycle_dossier_prompt_invalid');
  }
  if (!/^claude-[a-z0-9]+(?:-[a-z0-9]+)+$/.test(String(row.wmkf_ai_model || ''))) {
    throw new CycleDossierInputError(`Prompt ${expectedName} must pin a concrete model id`, 'cycle_dossier_prompt_invalid');
  }
  if (typeof row.wmkf_ai_systemprompt !== 'string' || typeof row.wmkf_ai_promptbody !== 'string') {
    throw new CycleDossierInputError(`Prompt ${expectedName} has no prompt text`, 'cycle_dossier_prompt_invalid');
  }
  if (!Number.isInteger(Number(row.wmkf_ai_maxtokens)) || Number(row.wmkf_ai_maxtokens) < 1 || Number(row.wmkf_ai_maxtokens) > 16000) {
    throw new CycleDossierInputError(`Prompt ${expectedName} requires a token limit from 1 to 16000`, 'cycle_dossier_prompt_invalid');
  }
  // Admin may edit prose, model, and token/temperature settings. The pilot's
  // frozen-input and result contracts remain fixed: no live variable reads,
  // persistent output targets, or removable untrusted-content boundaries.
  const definition = expectedName === RESEARCH_PROMPT_NAME ? researchDefinition : entryDefinition;
  let variables, schema;
  try {
    variables = JSON.parse(row.wmkf_ai_promptvariables);
    schema = JSON.parse(row.wmkf_ai_promptoutputschema);
  } catch { throw new CycleDossierInputError(`Invalid JSON contract for ${expectedName}`, 'cycle_dossier_prompt_invalid'); }
  if (JSON.stringify(variables) !== JSON.stringify(definition.VARIABLES)
      || JSON.stringify(schema) !== JSON.stringify(definition.OUTPUT_SCHEMA)) {
    throw new CycleDossierInputError(`Prompt ${expectedName} must retain its seeded variable and output contracts`, 'cycle_dossier_prompt_invalid');
  }
  const declared = new Set(variables.variables.map(v => v.name));
  const placeholders = [...`${row.wmkf_ai_systemprompt}\n${row.wmkf_ai_promptbody}`.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map(m => m[1]);
  if (placeholders.some(name => !declared.has(name)) || [...declared].some(name => !placeholders.includes(name))) {
    throw new CycleDossierInputError(`Prompt ${expectedName} must include exactly its declared input names`, 'cycle_dossier_prompt_invalid');
  }
  return clone(row);
}

/** Capture the exact published prompt/model/schema rows for one generation. */
export async function snapshotConfiguration({ budget = {}, pricing = null } = {}) {
  const [researchRow, entryRow] = await Promise.all([
    fetchCurrentPrompt(RESEARCH_PROMPT_NAME),
    fetchCurrentPrompt(ENTRY_PROMPT_NAME),
  ]);
  const resolvedPricing = pricing || {
    researchPlan: pricingForModel(researchRow?.wmkf_ai_model),
    entry: pricingForModel(entryRow?.wmkf_ai_model),
  };
  return freezeDeep({
    schema: 'cycle-dossier-config/v1',
    capturedAt: new Date().toISOString(),
    prompts: {
      researchPlan: snapshotPrompt(researchRow, RESEARCH_PROMPT_NAME),
      entry: snapshotPrompt(entryRow, ENTRY_PROMPT_NAME),
    },
    budget: clone(budget) || {},
    pricing: clone(resolvedPricing),
  });
}

function pricingForModel(model) {
  const value = lookupPricing(model);
  return value ? { inputUsdPer1k: value.input / 100000, outputUsdPer1k: value.output / 100000 } : null;
}

function usageCostUsd(result, rate) {
  const usage = result?.usage;
  if (!usage || !rate) return null;
  const input = usage.input_tokens ?? usage.inputTokens;
  const output = usage.output_tokens ?? usage.outputTokens;
  if (!Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) return null;
  const writes = Number(usage.cache_creation_input_tokens || usage.cacheCreationTokens || 0);
  const hourWrites = Number(usage.cache_creation_input_tokens_1h || usage.cacheCreationTokens1h || 0);
  const reads = Number(usage.cache_read_input_tokens || usage.cacheReadTokens || 0);
  return ((input + Math.max(0, writes - hourWrites) * 1.25 + hourWrites * 2 + reads * 0.1) * rate.inputUsdPer1k + output * rate.outputUsdPer1k) / 1000;
}

function configPrompt(config, key, name) {
  const row = config?.prompts?.[key];
  return snapshotPrompt(row, name);
}

async function paidCall(beforePaidCall, details) {
  if (typeof beforePaidCall === 'function') await beforePaidCall(details);
}

function parseQueries(result) {
  const parsed = result?.parsed ?? result;
  const queries = Array.isArray(parsed?.queries) ? parsed.queries : [];
  return queries.map((q) => ({ query: text(q?.query, 240), reason: text(q?.reason, 500) }))
    .filter((q) => q.query)
    .slice(0, MAX_RESEARCH_QUERIES);
}

function mapOpenAlex(record, query, retrievedAt) {
  const abstract = text(record?.abstract, 5000);
  return {
    sourceId: record?.openAlexId || record?.doi || record?.url || sha256(`${query}:${record?.title}`),
    source: 'openalex', query, title: text(record?.title, 500), url: text(record?.url || record?.openAlexId, 1000),
    year: record?.year ?? null, abstract, retrievedAt,
  };
}

function mapPubmed(record, query, retrievedAt) {
  const abstract = text(record?.abstract, 5000);
  return {
    sourceId: record?.pmid ? `pmid:${record.pmid}` : record?.doi || sha256(`${query}:${record?.title}`),
    source: 'pubmed', query, title: text(record?.title, 500),
    url: record?.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(record.pmid)}/` : text(record?.doi, 1000),
    year: record?.year ?? null, abstract, retrievedAt,
  };
}

function dedupeEvidence(items) {
  const seen = new Set();
  let chars = 2;
  return items.filter((item) => {
    const key = item.url || `${item.source}:${item.title.toLowerCase()}`;
    if (!item.title || !item.url || !item.abstract || item.abstract.length < 80 || seen.has(key)) return false;
    seen.add(key);
    const size = JSON.stringify(item).length + 1;
    if (chars + size > MAX_EVIDENCE_CHARS) return false;
    chars += size;
    return true;
  }).slice(0, MAX_EVIDENCE_ITEMS);
}

/** Run the bounded plan and free literature adapters. */
export async function generateResearch(input, config, { beforePaidCall, deadlineMs = null, actingUserSystemId = null, execute = executePrompt, openAlexSearch = (...args) => OpenAlexService.searchWorks(...args), pubmedSearch = (...args) => PubMedService.search(...args) } = {}) {
  if (!input?.narrative?.text) throw new CycleDossierInputError('Research requires a frozen narrative');
  const prompt = configPrompt(config, 'researchPlan', RESEARCH_PROMPT_NAME);
  await paidCall(beforePaidCall, { stage: 'research-plan', promptName: RESEARCH_PROMPT_NAME, model: prompt.wmkf_ai_model });
  const planResult = await execute({
    promptName: RESEARCH_PROMPT_NAME, promptSnapshot: prompt, requestId: input.requestId,
    overrideVariables: { proposal_narrative: input.narrative.text }, runSource: 'Vercel Interactive',
    forceOverwrite: true, requireNoPersistence: true,
    deadlineMs, actingUserSystemId,
    timeoutMsOverride: boundedLlmTimeout(config),
  });
  const queries = parseQueries(planResult);
  if (!queries.length) throw new CycleDossierResearchError('Research planner returned no usable queries', 'cycle_dossier_research_plan_empty');

  const evidence = [];
  const failures = [];
  for (const planned of queries) {
    const remaining = deadlineMs == null ? 20000 : Math.min(20000, deadlineMs - Date.now());
    if (remaining <= 0) { failures.push({ source: 'literature', query: planned.query, reason: 'research deadline reached' }); break; }
    const signal = AbortSignal.timeout(remaining);
    const retrievedAt = new Date().toISOString();
    await paidCall(beforePaidCall, { stage: 'research-search', query: planned.query, source: 'openalex' });
    const [openAlex, pubmed] = await Promise.allSettled([
      openAlexSearch(planned.query, { limit: MAX_RESULTS_PER_SOURCE, signal }),
      (async () => {
        await paidCall(beforePaidCall, { stage: 'research-search', query: planned.query, source: 'pubmed' });
        return pubmedSearch(planned.query, MAX_RESULTS_PER_SOURCE, { throwOnError: true, signal });
      })(),
    ]);
    if (openAlex.status === 'fulfilled') {
      const records = openAlex.value?.records || [];
      evidence.push(...records.map((r) => mapOpenAlex(r, planned.query, retrievedAt)));
      if (!records.length) failures.push({ source: 'openalex', query: planned.query, reason: 'no results' });
    }
    else failures.push({ source: 'openalex', query: planned.query, reason: text(openAlex.reason?.message, 240) });
    if (pubmed.status === 'fulfilled') {
      const records = Array.isArray(pubmed.value) ? pubmed.value : [];
      evidence.push(...records.map((r) => mapPubmed(r, planned.query, retrievedAt)));
      if (!records.length) failures.push({ source: 'pubmed', query: planned.query, reason: 'no results' });
    }
    else failures.push({ source: 'pubmed', query: planned.query, reason: text(pubmed.reason?.message, 240) });
  }
  const usable = dedupeEvidence(evidence);
  if (JSON.stringify(evidence).length > MAX_EVIDENCE_CHARS) failures.push({ source: 'literature', reason: 'Evidence size bound reached; retained complete source records only' });
  if (!usable.length) throw new CycleDossierResearchError('No retrieved source contained adequate context', 'cycle_dossier_research_empty');
  const result = freezeDeep({
    schema: 'cycle-dossier-research/v1', queries, evidence: usable,
    failures, partial: failures.length > 0,
    coverage: `${usable.length} sources with abstracts retained; ${failures.length} adapter failures.`,
    planner: { runId: planResult?.runId || null, usage: clone(planResult?.usage) || null, promptVersion: prompt.wmkf_promptversion, model: prompt.wmkf_ai_model },
  });
  return { research: result, usage: { planner: planResult?.usage || null }, costUsd: usageCostUsd(planResult, config.pricing?.researchPlan) };
}

function validateEntry(parsed, research) {
  const value = parsed?.entry && typeof parsed.entry === 'object' ? parsed.entry : parsed;
  const fields = ['projectAtAGlance', 'whyItMatters', 'fieldAroundIt', 'backgroundForOutsideField'];
  for (const field of fields) if (typeof value?.[field] !== 'string' || !value[field].trim()) throw new CycleDossierInputError(`Entry missing ${field}`, 'cycle_dossier_entry_schema_invalid');
  const known = new Map(research.evidence.map((r) => [r.sourceId, r]));
  const references = Array.isArray(value.references) ? value.references : [];
  if (!references.length) throw new CycleDossierInputError('Entry must cite at least one retrieved reference', 'cycle_dossier_entry_reference_invalid');
  const normalizedRefs = references.map((ref) => {
    const source = known.get(ref?.sourceId);
    if (!source) throw new CycleDossierInputError(`Entry cited unknown source ${ref?.sourceId}`, 'cycle_dossier_entry_reference_invalid');
    return { sourceId: source.sourceId, title: source.title, url: source.url, retrievedAt: source.retrievedAt };
  });
  return { ...Object.fromEntries(fields.map((field) => [field, value[field].trim().slice(0, 10000)])), references: normalizedRefs };
}

export async function generateEntry(input, research, config, { beforePaidCall, deadlineMs = null, actingUserSystemId = null, execute = executePrompt } = {}) {
  if (!input?.narrative?.text || !research?.evidence?.length) throw new CycleDossierResearchError('Entry requires frozen narrative and retrieved evidence');
  const prompt = configPrompt(config, 'entry', ENTRY_PROMPT_NAME);
  const overrideVariables = {
    proposal_narrative: input.narrative.text,
    prior_ai_context: JSON.stringify(input.priorAiContext || {}),
    research_evidence: JSON.stringify(research.evidence),
    research_coverage: research.coverage,
  };
  for (const decl of entryDefinition.VARIABLES.variables) {
    if (typeof overrideVariables[decl.name] !== 'string' || overrideVariables[decl.name].length > decl.maxChars) {
      throw new CycleDossierInputError(`Entry input ${decl.name} exceeds its frozen contract`, 'cycle_dossier_input_too_large');
    }
  }
  await paidCall(beforePaidCall, { stage: 'entry', promptName: ENTRY_PROMPT_NAME, model: prompt.wmkf_ai_model });
  const result = await execute({
    promptName: ENTRY_PROMPT_NAME, promptSnapshot: prompt, requestId: input.requestId,
    overrideVariables, runSource: 'Vercel Interactive', forceOverwrite: true, requireNoPersistence: true,
    deadlineMs, actingUserSystemId,
    timeoutMsOverride: boundedLlmTimeout(config),
  });
  const entry = validateEntry(result?.parsed ?? result, research);
  const payload = freezeDeep({
    schema: 'cycle-dossier-entry/v1', requestId: input.requestId, requestNumber: input.requestNumber,
    title: input.title, institution: input.institution, pi: input.pi, programDirector: input.programDirector,
    entry, research, source: { narrative: clone(input.narrative), narrativeHash: input.narrative.contentHash },
    provenance: {
      runId: result?.runId || null, usage: clone(result?.usage) || null,
      promptName: ENTRY_PROMPT_NAME, promptId: prompt.wmkf_ai_promptid,
      promptVersion: prompt.wmkf_promptversion, model: prompt.wmkf_ai_model,
      generatedAt: new Date().toISOString(),
    },
  });
  return { payload, usage: result?.usage || null, costUsd: usageCostUsd(result, config.pricing?.entry) };
}

function boundedLlmTimeout(config) {
  const requested = Number(config?.budget?.llmTimeoutMs || 85000);
  return Number.isFinite(requested) && requested > 0 ? Math.min(requested, 90000) : 85000;
}

/** Conservative reservation estimate. Unknown pricing stays unknown. */
export function estimateGenerationCost(input, config) {
  const pricing = config?.pricing;
  const queries = Math.min(MAX_RESEARCH_QUERIES, Math.max(1, Math.ceil((input?.narrative?.text || '').length / 50000)));
  const rate = pricing?.researchPlan || pricing;
  const entryRate = pricing?.entry || rate;
  if (!rate || !entryRate
      || [rate.inputUsdPer1k, rate.outputUsdPer1k, entryRate.inputUsdPer1k, entryRate.outputUsdPer1k].some(value => !Number.isFinite(value) || value < 0)) {
    return { lowUsd: null, highUsd: null, calls: 2, searchRequests: queries * 2, reason: 'model pricing is unavailable' };
  }
  const narrative = input?.narrative?.text || '';
  // UTF-8 bytes are a conservative token ceiling (one token cannot encode
  // fewer than one byte). Include stored prompt text, payload boundaries,
  // JSON escaping, and the full configured output budget.
  const bytes = (value) => Buffer.byteLength(String(value || ''), 'utf8');
  const inputCeiling = (row, sizes) => {
    const template = `${row.wmkf_ai_systemprompt}\n${row.wmkf_ai_promptbody}`;
    const placeholders = [...template.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)];
    // Count every occurrence: Admin can repeat an input in either message.
    // Extra room covers A7 wrappers, preambles, message framing, and schema.
    return Math.ceil((bytes(template) + 8192 + placeholders.reduce((sum, match) => sum + (sizes[match[1]] || 0) + 4096, 0)) / 1000);
  };
  const sizes = { proposal_narrative: bytes(narrative), prior_ai_context: bytes(JSON.stringify(input?.priorAiContext || {})), research_evidence: MAX_EVIDENCE_CHARS * 4, research_coverage: 6000 * 4 };
  const plannerInput = inputCeiling(config.prompts.researchPlan, sizes);
  const entryInput = inputCeiling(config.prompts.entry, sizes);
  const researchOutput = Math.ceil(Number(config.prompts.researchPlan.wmkf_ai_maxtokens || 0) / 1000);
  const entryOutput = Math.ceil(Number(config.prompts.entry.wmkf_ai_maxtokens || 0) / 1000);
  const callCost = (inTokens, outTokens, r) => {
    const regular = inTokens * Number(r.inputUsdPer1k) + outTokens * Number(r.outputUsdPer1k);
    const cacheWrite = inTokens * Number(r.inputUsdPer1k) * 1.25;
    return regular + cacheWrite;
  };
  const low = callCost(plannerInput, researchOutput, rate) + callCost(entryInput, entryOutput, entryRate);
  // LLMClient's default has maxRetries=3 plus its one deprecated-parameter
  // correction retry; dossier calls do not configure a fallback model.
  const maxAttempts = 5;
  const high = low * maxAttempts;
  return { lowUsd: Number(low.toFixed(6)), highUsd: Number(high.toFixed(6)), calls: 2, searchRequests: queries * 2, maxAttempts };
}
