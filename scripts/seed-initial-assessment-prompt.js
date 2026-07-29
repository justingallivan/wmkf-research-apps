#!/usr/bin/env node

/**
 * Create-only bootstrap for `initial-assessment.generate` in wmkf_ai_prompts.
 *
 * Usage:
 *   node scripts/seed-initial-assessment-prompt.js --dry-run
 *   node scripts/seed-initial-assessment-prompt.js --execute
 *
 * This script changes live state only with --execute. The proposal text is an
 * untrusted override and the parsed object is returned to the producer through
 * target kind:none; no akoya_request field is written by the Executor.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

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
if (!DRY && !EXECUTE) {
  console.error('Pass --dry-run or --execute. Refusing to run without an explicit mode.');
  process.exit(2);
}

const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { planSeed, seedPromptRow } = await import('../lib/services/prompt-seed.js');
const { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } = await import(
  '../shared/config/prompts/initial-assessment.js'
);
enterDynamicsBypassForScript('seed-initial-assessment-prompt');

const PROMPT_NAME = 'initial-assessment.generate';
const PROMPTSTATUS_PUBLISHED = 682090001;
const required = ['summary', 'significance_impact', 'research_plan', 'team_expertise'];

const promptVariables = {
  variables: [{
    name: 'proposal_text',
    source: { kind: 'override' },
    required: true,
    cacheable: true,
    placement: 'user',
    dataClass: 'proposal_text',
    maxChars: 100000,
    untrusted: true,
  }],
};

const promptOutputSchema = {
  outputs: [{ name: 'assessment', type: 'object', target: { kind: 'none' } }],
  parseMode: 'json',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required,
    properties: Object.fromEntries(required.map((key) => [key, { type: 'string' }])),
  },
  rawOutputRetention: 'hash',
};

const recordData = {
  wmkf_ai_promptname: PROMPT_NAME,
  wmkf_ai_systemprompt: SYSTEM_PROMPT,
  wmkf_ai_promptbody: USER_PROMPT_TEMPLATE,
  wmkf_ai_promptvariables: JSON.stringify(promptVariables, null, 2),
  wmkf_ai_promptoutputschema: JSON.stringify(promptOutputSchema, null, 2),
  wmkf_ai_model: 'sonnet',
  wmkf_ai_temperature: 0.2,
  wmkf_ai_maxtokens: 2200,
  wmkf_ai_promptstatus: PROMPTSTATUS_PUBLISHED,
  wmkf_ai_notes:
    'Initial Assessment v1. Four proposal-grounded sections only; Foundation Opportunity is staff-owned in the code-backed DOCX template. Proposal text is untrusted; output target kind:none; raw output retained as hash.',
};

console.log(`Seed: ${PROMPT_NAME}`);
console.log(`  systemprompt: ${SYSTEM_PROMPT.length} chars`);
console.log(`  promptbody: ${USER_PROMPT_TEMPLATE.length} chars`);
console.log(`  required outputs: ${required.join(', ')}`);

const plan = await planSeed({ promptName: PROMPT_NAME });

if (DRY) {
  console.log(`DRY RUN: action=${plan.action}${plan.targetVersion ? ` version=${plan.targetVersion}` : ''}.`);
  if (plan.action !== 'create') {
    console.log('No write would occur. Existing prompts must be changed through versioned /admin publish.');
  }
  console.log(recordData.wmkf_ai_promptvariables);
  console.log(recordData.wmkf_ai_promptoutputschema);
  process.exit(0);
}

const seeded = await seedPromptRow({
  promptName: PROMPT_NAME,
  recordData,
});
if (seeded.version !== 1 || !seeded.id) {
  throw new Error(`Prompt bootstrap returned unexpected version/id: ${JSON.stringify(seeded)}`);
}
console.log(`✓ Created and verified wmkf_ai_prompts(${seeded.id}) version ${seeded.version}.`);
