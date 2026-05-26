#!/usr/bin/env node

/**
 * Seed the Phase I v2 prompt into the scratch `wmkf_ai_run` record Connor
 * gave us for testing Dynamics-backed prompts.
 *
 *   Entity: wmkf_ai_runs
 *   Record GUID: a03f77d9-913a-f111-88b5-000d3a3065b8
 *   wmkf_ai_notes     → system prompt (role, format, guidelines, examples)
 *   wmkf_ai_rawoutput → user prompt template (with {{proposal_text}} slot)
 *
 * Prompt text is imported from shared/config/prompts/phase-i-dynamics.js so
 * the Dynamics-seeded copy and the PromptResolver fallback stay identical.
 *
 * Usage:
 *   node scripts/seed-phase-i-prompt.js        - writes & verifies
 *   node scripts/seed-phase-i-prompt.js --dry  - print what would be written
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envFile of ['.env', '.env.local']) {
  try {
    const c = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of c.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } = await import('../shared/config/prompts/phase-i-dynamics.js');
enterDynamicsBypassForScript('seed-phase-i-prompt');

const SCRATCH_GUID = 'a03f77d9-913a-f111-88b5-000d3a3065b8';
const DRY = process.argv.includes('--dry');

console.log(`System prompt: ${SYSTEM_PROMPT.length.toLocaleString()} chars`);
console.log(`User template: ${USER_PROMPT_TEMPLATE.length.toLocaleString()} chars`);
console.log(`Target record: wmkf_ai_runs(${SCRATCH_GUID})\n`);

if (DRY) {
  console.log('--- SYSTEM PROMPT PREVIEW ---');
  console.log(SYSTEM_PROMPT.substring(0, 400) + '\n...\n');
  console.log('--- USER TEMPLATE ---');
  console.log(USER_PROMPT_TEMPLATE);
  console.log('\n(dry run - no write performed)');
  process.exit(0);
}

try {
  await DynamicsService.updateRecord('wmkf_ai_runs', SCRATCH_GUID, {
    wmkf_ai_notes: SYSTEM_PROMPT,
    wmkf_ai_rawoutput: USER_PROMPT_TEMPLATE,
  });
  console.log('✓ Wrote prompts to Dynamics');

  const verified = await DynamicsService.getRecord('wmkf_ai_runs', SCRATCH_GUID, {
    select: 'wmkf_ai_notes,wmkf_ai_rawoutput',
  });
  const notesLen = (verified?.wmkf_ai_notes || '').length;
  const rawLen = (verified?.wmkf_ai_rawoutput || '').length;
  console.log(`✓ Verified: wmkf_ai_notes=${notesLen.toLocaleString()} chars, wmkf_ai_rawoutput=${rawLen.toLocaleString()} chars`);

  if (notesLen !== SYSTEM_PROMPT.length || rawLen !== USER_PROMPT_TEMPLATE.length) {
    console.warn('⚠ Length mismatch - Dynamics may be truncating. Check field max-length on the entity.');
    console.warn(`  Expected notes=${SYSTEM_PROMPT.length}, got ${notesLen}`);
    console.warn(`  Expected raw=${USER_PROMPT_TEMPLATE.length}, got ${rawLen}`);
    process.exit(2);
  }
} catch (err) {
  console.error('✗ Failed:', err.message);
  process.exit(1);
}
