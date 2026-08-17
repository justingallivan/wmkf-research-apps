#!/usr/bin/env node

/**
 * Create-only bootstrap for `pre-site-visit.proposal-core.generate`.
 *
 * Usage:
 *   node scripts/seed-pre-site-visit-proposal-core-prompt.js --dry-run
 *   node scripts/seed-pre-site-visit-proposal-core-prompt.js --execute
 *   node scripts/seed-pre-site-visit-proposal-core-prompt.js --execute --force
 *
 * --execute changes live Dataverse state. This file is a bootstrap/recovery
 * artifact; routine edits belong in the versioned Admin prompt publisher.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import './lib/use-extensionless.mjs';

for (const envFile of ['.env', '.env.local']) {
  try {
    const content = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of content.split('\n')) {
      const text = line.trim();
      if (!text || text.startsWith('#')) continue;
      const index = text.indexOf('=');
      if (index < 0) continue;
      const key = text.slice(0, index).trim();
      const value = text.slice(index + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

const DRY = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');
const FORCE = process.argv.includes('--force');
if (!DRY && !EXECUTE) {
  console.error('Pass --dry-run or --execute. Refusing to run without an explicit mode.');
  process.exit(2);
}

const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { planSeed, seedPromptRow, SeedRefused } = await import('../lib/services/prompt-seed.js');
const { validateReviewedClaudeModelValue } = await import('../lib/services/model-review-validation.js');
const {
  PROMPT_NAME,
  SYSTEM_PROMPT,
  USER_PROMPT_TEMPLATE,
  PROMPT_VARIABLES,
  PROMPT_OUTPUT_SCHEMA,
} = await import('../shared/config/prompts/pre-site-visit-proposal-core.js');

enterDynamicsBypassForScript('seed-pre-site-visit-proposal-core-prompt');

const MODEL = 'claude-sonnet-4-6';
const modelValidation = validateReviewedClaudeModelValue(MODEL);
if (!modelValidation.valid || modelValidation.kind !== 'claude'
    || modelValidation.capabilities.supportsStructuredOutput !== true) {
  throw new Error(`Bootstrap model ${MODEL} is not a reviewed native-structured-output model.`);
}

const PROMPTSTATUS_PUBLISHED = 682090001;
const recordData = {
  wmkf_ai_promptname: PROMPT_NAME,
  wmkf_ai_systemprompt: SYSTEM_PROMPT,
  wmkf_ai_promptbody: USER_PROMPT_TEMPLATE,
  wmkf_ai_promptvariables: JSON.stringify(PROMPT_VARIABLES, null, 2),
  wmkf_ai_promptoutputschema: JSON.stringify(PROMPT_OUTPUT_SCHEMA, null, 2),
  // Native JSON Schema is capability-sensitive, so bootstrap stores a concrete
  // reviewed model. Later model changes publish a new immutable version in Admin.
  wmkf_ai_model: MODEL,
  wmkf_ai_temperature: 0.3,
  wmkf_ai_maxtokens: 16384,
  wmkf_ai_promptstatus: PROMPTSTATUS_PUBLISHED,
  wmkf_ai_notes:
    'Pre-Site Visit proposal-core tracked bootstrap/recovery contract. Three untrusted overrides; exact narrative and bibliography inputs; eight pass-through narrative fields; '
    + 'target kind:none; full raw output retention. Caller must use requireNoPersistence:true and '
    + 'assertSystemIncludes from shared/config/prompts/pre-site-visit-proposal-core.js.',
};

console.log(`Seed: ${PROMPT_NAME}`);
console.log(`  model: ${MODEL}`);
console.log(`  systemprompt: ${SYSTEM_PROMPT.length} chars`);
console.log(`  promptbody: ${USER_PROMPT_TEMPLATE.length} chars`);

if (DRY) {
  const plan = await planSeed({ promptName: PROMPT_NAME, force: FORCE });
  console.log(`DRY RUN: action=${plan.action}${plan.targetVersion ? ` version=${plan.targetVersion}` : ''}.`);
  console.log(recordData.wmkf_ai_promptvariables);
  console.log(recordData.wmkf_ai_promptoutputschema);
  process.exit(0);
}

try {
  const result = await seedPromptRow({ promptName: PROMPT_NAME, recordData, force: FORCE });
  console.log(`✓ ${result.action} → v${result.version} (current row ${result.id})`);
} catch (err) {
  if (err instanceof SeedRefused) {
    console.error(`✗ ${err.message}`);
    process.exit(2);
  }
  throw err;
}
