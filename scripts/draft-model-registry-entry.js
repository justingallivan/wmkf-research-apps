#!/usr/bin/env node
/**
 * Draft reviewed-registry entries for a new Claude model id.
 *
 * Usage:
 *   node scripts/draft-model-registry-entry.js --model=claude-fable-5-2
 *   node scripts/draft-model-registry-entry.js --model=<id> --model-json=<file>
 *
 * Reads the model from Anthropic's /v1/models/{id} (CLAUDE_API_KEY from the
 * environment or .env.local), or from a saved model object with --model-json.
 * Prints draft MODEL_CAPABILITIES and MODEL_PRICING entries plus a review
 * checklist. It never edits source files: an exact key in both registries is
 * what lets a tier resolve to the model, so entries are pasted by hand only
 * after every CONFIRM field is checked against Anthropic's docs.
 *
 * Fields the Models API answers are filled from it. Fields it cannot answer
 * (temperature, default effort, refusal semantics, retention, pricing) are
 * copied from the most recently reviewed entry in the same family and marked
 * CONFIRM. The draft's reviewedAt is 'UNREVIEWED', which check:model-registry
 * rejects until a reviewer sets the review date.
 */

const fs = require('fs');
const path = require('path');
const { findConstObject } = require('./check-model-registry');

const ANTHROPIC_VERSION = '2023-06-01';
const DOCS_BASE = 'https://platform.claude.com/docs/en';

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--model=')) args.model = arg.slice('--model='.length).trim();
    else if (arg.startsWith('--model-json=')) args.modelJson = arg.slice('--model-json='.length).trim();
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function loadEnvLocal(root) {
  try {
    const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
      }
    }
  } catch {
    // Fall through: CLAUDE_API_KEY may already be in the environment.
  }
}

async function fetchModel(modelId) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY not set; pass --model-json=<file> to draft offline');
  const response = await fetch(`https://api.anthropic.com/v1/models/${encodeURIComponent(modelId)}`, {
    headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
  });
  if (!response.ok) throw new Error(`/v1/models/${modelId} returned HTTP ${response.status}`);
  return response.json();
}

// Most recently reviewed capability entry in the same family; longest key breaks ties.
function pickAncestor(capabilities, family, modelId) {
  const candidates = Object.entries(capabilities)
    .filter(([key, entry]) => key !== modelId && entry?.provider === 'anthropic' && entry?.family === family);
  candidates.sort(([ka, a], [kb, b]) =>
    String(b.reviewedAt || '').localeCompare(String(a.reviewedAt || '')) || kb.length - ka.length);
  return candidates.length ? candidates[0][0] : null;
}

// Only the always-on shape is unambiguous from the API; other modes need review.
function thinkingModeFromApi(thinking) {
  if (!thinking) return undefined;
  if (thinking.supported === false) return 'none';
  if (thinking.types?.adaptive?.supported && thinking.types?.disabled?.supported === false) {
    return 'adaptive_always_on';
  }
  return undefined;
}

function docsSlug(modelId) {
  return modelId.replace(/^claude-/, '');
}

/**
 * Build the draft. Returns { capabilityKey, ancestorKey, entry, pricing, fields }
 * where each field records { name, value, origin: 'api' | 'ancestor', confirm, note }.
 */
function draftEntries(model, capabilities, pricingTable) {
  const modelId = model.id;
  const family = model.line || null;
  const ancestorKey = family ? pickAncestor(capabilities, family, modelId) : null;
  const ancestor = ancestorKey ? capabilities[ancestorKey] : {};
  const caps = model.capabilities || {};
  const fields = [];

  function fromApi(name, apiValue) {
    const ancestorValue = ancestor[name];
    if (apiValue === undefined || apiValue === null) {
      fields.push({ name, value: ancestorValue, origin: 'ancestor', confirm: true, note: 'not in Models API response' });
      return;
    }
    const changed = ancestorKey && ancestorValue !== undefined && ancestorValue !== apiValue;
    fields.push({
      name,
      value: apiValue,
      origin: 'api',
      confirm: false,
      note: changed ? `differs from ${ancestorKey} (${JSON.stringify(ancestorValue)})` : null,
    });
  }

  function fromAncestor(name, note) {
    fields.push({ name, value: ancestor[name], origin: 'ancestor', confirm: true, note });
  }

  fields.push({ name: 'provider', value: 'anthropic', origin: 'api', confirm: false, note: null });
  fromApi('family', family);
  fromAncestor('supportsTemperature', 'Models API does not report sampling parameters');
  fromApi('supportsEffort', caps.effort?.supported);
  fromAncestor('defaultEffort', 'see "Default effort" on the model overview page');
  fromApi('thinkingMode', thinkingModeFromApi(caps.thinking));
  fromApi('supportsStructuredOutput', caps.structured_outputs?.supported);
  fromApi('maxInputTokens', model.max_input_tokens);
  fromApi('maxOutputTokens', model.max_tokens);
  fromAncestor('refusalSemantics', 'see the migration guide and Refusals and fallback');
  fromAncestor('requiresRefusalHandling', 'see the migration guide and Refusals and fallback');
  fromAncestor('zeroDataRetentionEligible', 'see "Good to know" on the model overview page');
  fromAncestor('dataRetentionClass', 'see "Good to know" on the model overview page');
  fields.push({ name: 'reviewedAt', value: 'UNREVIEWED', origin: 'ancestor', confirm: true, note: 'set to the review date (YYYY-MM-DD)' });
  fields.push({
    name: 'source',
    value: `${DOCS_BASE}/models/${docsSlug(modelId)}/overview`,
    origin: 'api',
    confirm: true,
    note: 'confirm the page exists',
  });

  const entry = {};
  for (const field of fields) {
    if (field.value !== undefined) entry[field.name] = field.value;
  }

  const ancestorPricing = ancestorKey ? pricingTable[ancestorKey] : null;
  const pricing = ancestorPricing ? { ...ancestorPricing } : { input: null, output: null };

  return {
    capabilityKey: modelId,
    ancestorKey,
    existingCapability: Object.prototype.hasOwnProperty.call(capabilities, modelId),
    existingPricing: Object.prototype.hasOwnProperty.call(pricingTable, modelId),
    entry,
    pricing,
    fields,
  };
}

function formatValue(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 10_000) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '_');
  }
  return typeof value === 'string' ? `'${value}'` : JSON.stringify(value);
}

function renderReport(model, draft) {
  const slug = docsSlug(model.id);
  const lines = [];
  lines.push(`Draft registry entries for ${model.id} (${model.display_name || 'no display name'})`);
  lines.push(`Created: ${model.created_at || 'unknown'} · lifecycle: ${model.lifecycle || 'unknown'} · line: ${model.line || 'none'}`);
  lines.push(`Defaults copied from: ${draft.ancestorKey || 'none (no reviewed entry in this family)'}`);
  if (draft.existingCapability || draft.existingPricing) {
    lines.push('');
    lines.push(`WARNING: ${model.id} already has ${[
      draft.existingCapability && 'a capability entry',
      draft.existingPricing && 'a pricing entry',
    ].filter(Boolean).join(' and ')}. Compare before replacing.`);
  }

  lines.push('');
  lines.push('// lib/services/model-capabilities.js — MODEL_CAPABILITIES');
  lines.push(`  '${draft.capabilityKey}': {`);
  for (const field of draft.fields) {
    if (field.value === undefined) {
      lines.push(`    // ${field.name}: CONFIRM — no value from the API or ${draft.ancestorKey || 'an ancestor'}`);
      continue;
    }
    const tags = [field.confirm ? 'CONFIRM' : null, field.note].filter(Boolean).join(' — ');
    lines.push(`    ${field.name}: ${formatValue(field.value)},${tags ? ` // ${tags}` : ''}`);
  }
  lines.push('  },');

  lines.push('');
  lines.push('// lib/utils/model-pricing.js — MODEL_PRICING (cents per million tokens)');
  const pricingBody = Object.entries(draft.pricing).map(([k, v]) => `${k}: ${v === null ? 'null' : v}`).join(', ');
  lines.push(`  '${draft.capabilityKey}': { ${pricingBody} }, // CONFIRM every rate — copied from ${draft.ancestorKey || 'nothing'}`);

  lines.push('');
  lines.push('Review checklist:');
  lines.push(`  1. Overview (temperature, default effort, retention): ${DOCS_BASE}/models/${slug}/overview`);
  lines.push(`  2. Migration guide (breaking changes, refusals): ${DOCS_BASE}/models/${slug}/migration-guide`);
  lines.push(`  3. Pricing (input, output, cache-read multiplier): ${DOCS_BASE}/about-claude/pricing`);
  lines.push('  4. Resolve every CONFIRM, set reviewedAt, paste both entries, bump pricing LAST_REVIEWED_AT.');
  lines.push('  5. Run npm run check:model-registry && npm run check:model-registry:self-test.');
  lines.push('  6. Once deployed, the tier for this family can resolve to the new id; see');
  lines.push('     docs/MODEL_CHANGE_STRATEGY.md §5 before advancing fallbacks or pinned seats.');
  return lines.join('\n');
}

async function main() {
  const root = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.model) {
    console.log('Usage: node scripts/draft-model-registry-entry.js --model=<claude model id> [--model-json=<file>]');
    process.exit(args.help ? 0 : 2);
  }

  let model;
  if (args.modelJson) {
    model = JSON.parse(fs.readFileSync(args.modelJson, 'utf8'));
  } else {
    loadEnvLocal(root);
    model = await fetchModel(args.model);
  }
  if (model?.id !== args.model) throw new Error(`model object id ${JSON.stringify(model?.id)} does not match --model=${args.model}`);

  const capabilities = findConstObject(root, 'lib/services/model-capabilities.js', 'MODEL_CAPABILITIES');
  const pricingTable = findConstObject(root, 'lib/utils/model-pricing.js', 'MODEL_PRICING');
  console.log(renderReport(model, draftEntries(model, capabilities, pricingTable)));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(2);
  });
}

module.exports = { draftEntries, pickAncestor, thinkingModeFromApi, renderReport };
