#!/usr/bin/env node
/**
 * Governed bootstrap for the tool-app prompt rows (convergence plan Stage 0):
 * expertise-finder, funding-gap, expense-reporter, literature-analyzer,
 * multi-perspective. One generalized CLI; each app supplies a manifest.
 *
 * Usage:
 *   node scripts/seed-tool-prompts.js --app <key>                  # dry run (default)
 *   node scripts/seed-tool-prompts.js --app <key> --execute        # create-only
 *   node scripts/seed-tool-prompts.js --app <key> --execute --force  # publish max+1 recovery version
 *
 * Manifest: shared/config/prompts/<file>-dynamics.js exporting TOOL_PROMPT_ROWS, an
 * array of row definitions in the shape of scripts/seed-peer-review-summarizer-prompts.js
 * ({ promptName, systemPrompt, body, model, maxTokens, variables, outputSchema, notes }).
 * No temperature column is written (D10).
 *
 * Governance is lib/services/prompt-seed.js: create-only by default; --force is a
 * version-preserving recovery publish, never an in-place overwrite. --execute requires
 * DATAVERSE_TARGET_INTERLOCK=on (same guard as seed-review-panel-prompts.js).
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export const PROMPTSTATUS_PUBLISHED = 682090001;

/** App key -> manifest module (shared/config/prompts/<file>-dynamics.js). */
export const APP_MANIFEST_FILES = Object.freeze({
  'expertise-finder': 'expertise-finder',
  'funding-gap': 'funding-gap',
  'expense-reporter': 'expense-reporter',
  'literature-analyzer': 'literature-analyzer',
  'multi-perspective': 'multi-perspective',
});

/** Content fields only; prompt-seed sets iscurrent / version / publisheddatetime. */
export function recordDataFor(row) {
  return {
    wmkf_ai_promptname: row.promptName,
    wmkf_ai_systemprompt: row.systemPrompt,
    wmkf_ai_promptbody: row.body,
    wmkf_ai_promptvariables: JSON.stringify(row.variables, null, 2),
    wmkf_ai_promptoutputschema: JSON.stringify(row.outputSchema, null, 2),
    wmkf_ai_model: row.model,
    wmkf_ai_maxtokens: row.maxTokens,
    wmkf_ai_promptstatus: PROMPTSTATUS_PUBLISHED,
    wmkf_ai_notes: row.notes,
  };
}

export async function loadManifestRows(appKey) {
  const file = APP_MANIFEST_FILES[appKey];
  if (!file) {
    throw new Error(`Unknown app "${appKey}". Valid: ${Object.keys(APP_MANIFEST_FILES).join(', ')}`);
  }
  let mod;
  try {
    mod = await import(`../shared/config/prompts/${file}-dynamics.js`);
  } catch (err) {
    // Only a missing manifest itself means "not built yet"; a broken import inside an
    // existing manifest must surface as-is.
    const manifestMissing = (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'MODULE_NOT_FOUND')
      && (err?.message || '').includes(`${file}-dynamics.js`)
      && !existsSync(new URL(`../shared/config/prompts/${file}-dynamics.js`, import.meta.url));
    if (manifestMissing) {
      throw new Error(`No manifest for "${appKey}": shared/config/prompts/${file}-dynamics.js does not exist yet.`);
    }
    throw err;
  }
  if (!Array.isArray(mod.TOOL_PROMPT_ROWS) || mod.TOOL_PROMPT_ROWS.length === 0) {
    throw new Error(`Manifest ${file}-dynamics.js must export a non-empty TOOL_PROMPT_ROWS array.`);
  }
  return mod.TOOL_PROMPT_ROWS;
}

function variableNames(row) {
  return (row.variables?.variables || []).map((v) => v.name);
}

/** Dry run: read-only plan per row. */
export async function planToolSeed({ rows, planSeed, force = false }) {
  const out = [];
  for (const row of rows) {
    const plan = await planSeed({ promptName: row.promptName, force });
    out.push({
      promptName: row.promptName,
      model: row.model,
      maxTokens: row.maxTokens,
      variables: variableNames(row),
      action: plan.action,
      targetVersion: plan.targetVersion ?? null,
    });
  }
  return out;
}

/** Execute: preflight every row first so a refusal leaves nothing half-seeded. */
export async function executeToolSeed({ rows, planSeed, seedPromptRow, SeedRefused, force = false }) {
  for (const row of rows) {
    const plan = await planSeed({ promptName: row.promptName, force });
    if (plan.action === 'refuse' || plan.action === 'refuse-duplicate') {
      throw new SeedRefused(`Cannot seed ${row.promptName}: existing prompt state requires /admin publication or --force.`, plan);
    }
  }
  const results = [];
  for (const row of rows) {
    const result = await seedPromptRow({ promptName: row.promptName, recordData: recordDataFor(row), force });
    results.push({ promptName: row.promptName, action: result.action, version: result.version, id: result.id });
  }
  return results;
}

function loadDotEnvOnce() {
  for (const envFile of ['.env', '.env.local']) {
    try {
      const content = readFileSync(resolve(process.cwd(), envFile), 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const index = trimmed.indexOf('=');
        if (index < 0) continue;
        const key = trimmed.slice(0, index).trim();
        const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = value;
      }
    } catch { /* file may not exist */ }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--') && a !== '--app'));
  const appIdx = argv.indexOf('--app');
  const appKey = appIdx >= 0 ? argv[appIdx + 1] : null;
  for (const f of flags) {
    if (!['--dry-run', '--execute', '--force'].includes(f)) { console.error(`Unknown argument: ${f}`); process.exit(2); }
  }
  if (!appKey || appKey.startsWith('--')) { console.error('Usage: seed-tool-prompts.js --app <key> [--execute] [--force]'); process.exit(2); }
  if (flags.has('--dry-run') && flags.has('--execute')) { console.error('Choose exactly one of --dry-run or --execute.'); process.exit(2); }
  const EXECUTE = flags.has('--execute');
  const FORCE = flags.has('--force');
  if (FORCE && !EXECUTE) { console.error('--force requires --execute.'); process.exit(2); }

  let rows;
  try {
    rows = await loadManifestRows(appKey);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }

  loadDotEnvOnce();
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  const { resolveInterlockMode } = await import('../lib/dataverse/core/interlock.js');
  const { planSeed, seedPromptRow, SeedRefused } = await import('../lib/services/prompt-seed.js');
  if (EXECUTE && resolveInterlockMode() !== 'on') {
    throw new Error('Refusing --execute: DATAVERSE_TARGET_INTERLOCK must be exactly "on".');
  }
  enterDynamicsBypassForScript('seed-tool-prompts');

  console.log(`Tool prompt seed for ${appKey} (${EXECUTE ? 'EXECUTE' : 'DRY RUN'})`);
  if (!EXECUTE) {
    for (const p of await planToolSeed({ rows, planSeed, force: FORCE })) {
      console.log(`  ${p.promptName}: model=${p.model} maxTokens=${p.maxTokens} variables=[${p.variables.join(', ')}] action=${p.action}${p.targetVersion ? ` version=${p.targetVersion}` : ''}`);
    }
    console.log('Dry run complete. Re-run with --execute only after reviewing the planned rows.');
    return;
  }
  try {
    for (const r of await executeToolSeed({ rows, planSeed, seedPromptRow, SeedRefused, force: FORCE })) {
      console.log(`  ✓ ${r.promptName}: ${r.action} → v${r.version} (${r.id})`);
    }
  } catch (err) {
    if (err instanceof SeedRefused) { console.error(`✗ ${err.message}`); process.exit(2); }
    throw err;
  }
}

const isDirectRun = typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('seed-tool-prompts.js');
if (isDirectRun) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
