#!/usr/bin/env node
/**
 * Create the governed J27 intake P6 prompt. Existing rows are edited through
 * Admin versioned publication. Select the Dataverse environment explicitly:
 * node --env-file=<target-env> --import ./scripts/lib/use-extensionless.mjs scripts/seed-j27-fit-concerns-prompt.js --dry-run
 * Use --execute instead of --dry-run to bootstrap the prompt.
 */

import {
  PROMPT_NAME,
  SYSTEM_PROMPT,
  USER_PROMPT_TEMPLATE,
  PROMPT_VARIABLES,
  PROMPT_OUTPUT_SCHEMA,
} from '../shared/config/prompts/j27-fit-concerns.js';

const [mode, ...extraArgs] = process.argv.slice(2);
if (!['--dry-run', '--execute'].includes(mode) || extraArgs.length) {
  throw new Error('Choose exactly one of --dry-run or --execute.');
}
if (mode === '--execute' && process.env.DATAVERSE_TARGET_INTERLOCK !== 'on') {
  throw new Error('Refusing --execute: DATAVERSE_TARGET_INTERLOCK must be on.');
}

const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { planSeed, seedPromptRow } = await import('../lib/services/prompt-seed.js');
enterDynamicsBypassForScript('seed-j27-fit-concerns-prompt');

const recordData = {
  wmkf_ai_promptname: PROMPT_NAME,
  wmkf_ai_systemprompt: SYSTEM_PROMPT,
  wmkf_ai_promptbody: USER_PROMPT_TEMPLATE,
  wmkf_ai_promptvariables: JSON.stringify(PROMPT_VARIABLES),
  wmkf_ai_promptoutputschema: JSON.stringify(PROMPT_OUTPUT_SCHEMA),
  wmkf_ai_model: 'claude-sonnet-4-6',
  wmkf_ai_maxtokens: 4096,
  wmkf_ai_promptstatus: 682090001, // Published
  wmkf_ai_notes: 'J27 intake P6. Returns six intake fit concerns and source-attributed evidence. The trusted comparison caller validates and saves the paired snapshot.',
};

if (mode === '--dry-run') {
  const plan = await planSeed({ promptName: PROMPT_NAME });
  console.log(`${PROMPT_NAME}: ${plan.action} (${plan.rows.length} existing rows)`);
} else {
  const result = await seedPromptRow({ promptName: PROMPT_NAME, recordData });
  console.log(`${PROMPT_NAME}: ${result.action} v${result.version} (${result.id})`);
}
