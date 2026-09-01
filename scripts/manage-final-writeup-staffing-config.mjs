#!/usr/bin/env node
/**
 * Dry-run-first operator command for the Final Writeup staffing setting.
 *
 * Modes:
 * - upgrade: build the reviewed v2 draft from a valid stored v1 setting and
 *   publish it through the same roster/program validation as Admin.
 * - downgrade: replace the row with an operator-supplied audited v1 projection.
 * - repair: replace malformed/future JSON with an operator-supplied valid v1 or
 *   v2 document by exact row ETag, without parsing the current value first.
 *
 * No mode enables persona lenses. Execute mode remains subject to the normal
 * Dataverse target interlock and Production-write acknowledgement.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

export function parseArgs(argv) {
  const options = {
    mode: 'upgrade',
    execute: false,
    expectedRevision: null,
    inputPath: null,
  };
  for (const value of argv.slice(2)) {
    if (value === '--execute') options.execute = true;
    else if (value.startsWith('--mode=')) options.mode = value.slice('--mode='.length);
    else if (value.startsWith('--expected-revision=')) {
      options.expectedRevision = value.slice('--expected-revision='.length);
    } else if (value.startsWith('--input=')) options.inputPath = value.slice('--input='.length);
    else if (value === '--help' || value === '-h') options.help = true;
    else throw new Error(`Unknown flag: ${value}`);
  }
  if (!['upgrade', 'downgrade', 'repair'].includes(options.mode)) {
    throw new Error(`Unknown mode: ${options.mode}`);
  }
  if (options.mode !== 'upgrade' && !options.inputPath) {
    throw new Error(`${options.mode} mode requires --input=<audited-config.json>.`);
  }
  if (options.execute && !options.expectedRevision) {
    throw new Error('Execute mode requires --expected-revision=<current Dataverse ETag>.');
  }
  return options;
}

export function readInputConfig(inputPath) {
  return JSON.parse(readFileSync(resolve(process.cwd(), inputPath), 'utf8'));
}

export async function buildStaffingOperationPlan({
  mode,
  inputConfig = null,
  getAdminState,
  getRawSetting,
  validateConfig,
} = {}) {
  if (mode === 'upgrade') {
    const state = await getAdminState();
    if (state.migrationRequired !== true || state.storedVersion !== 1) {
      throw new Error('Upgrade mode requires one valid stored version-1 setting.');
    }
    return {
      mode,
      currentRevision: state.revision,
      config: validateConfig(state.config, { writableOnly: true }),
    };
  }

  const raw = await getRawSetting();
  if (!raw?.found || typeof raw.revision !== 'string' || !raw.revision) {
    throw new Error(`${mode} mode requires one existing setting row with a Dataverse ETag.`);
  }
  const config = validateConfig(inputConfig);
  if (mode === 'downgrade' && config.version !== 1) {
    throw new Error('Downgrade mode requires a version-1 projection.');
  }
  return { mode, currentRevision: raw.revision, config };
}

export async function executeStaffingOperationPlan({
  plan,
  execute,
  expectedRevision,
  publishUpgrade,
  replaceByRevision,
} = {}) {
  if (!execute) return { executed: false, ...plan };
  if (expectedRevision !== plan.currentRevision) {
    throw new Error('The supplied expected revision does not match the freshly loaded Dataverse ETag.');
  }
  const result = plan.mode === 'upgrade'
    ? await publishUpgrade(plan.config, expectedRevision)
    : await replaceByRevision(plan.config, expectedRevision);
  return { executed: true, mode: plan.mode, result };
}

function usage() {
  return [
    'Usage:',
    '  node scripts/manage-final-writeup-staffing-config.mjs --mode=upgrade',
    '  node scripts/manage-final-writeup-staffing-config.mjs --mode=upgrade --execute --expected-revision=<etag>',
    '  node scripts/manage-final-writeup-staffing-config.mjs --mode=downgrade --input=<v1.json>',
    '  node scripts/manage-final-writeup-staffing-config.mjs --mode=repair --input=<v1-or-v2.json>',
    '',
    'Dry run is the default. Execute mode never changes the persona feature flag.',
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    console.log(usage());
    return;
  }

  const { loadEnvLocal } = await import('../lib/dataverse/client.js');
  loadEnvLocal();
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  enterDynamicsBypassForScript('manage-final-writeup-staffing-config');
  const settingsModule = await import('../lib/services/settings-service.js');
  const staffingModule = await import('../lib/services/final-writeup/matrix-audience-service.js');
  const settings = settingsModule.default || settingsModule;

  const inputConfig = options.inputPath ? readInputConfig(options.inputPath) : null;
  const plan = await buildStaffingOperationPlan({
    mode: options.mode,
    inputConfig,
    getAdminState: () => staffingModule.getFinalWriteupMatrixAudienceAdminState(),
    getRawSetting: () => settings.getSettingStrict(
      staffingModule.FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY,
    ),
    validateConfig: staffingModule.validateFinalWriteupMatrixAudienceConfig,
  });

  console.log(`Mode: ${options.mode}`);
  console.log(`Action: ${options.execute ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`Current revision: ${plan.currentRevision}`);
  console.log(`Replacement version: ${plan.config.version}`);
  console.log(JSON.stringify(plan.config, null, 2));

  const outcome = await executeStaffingOperationPlan({
    plan,
    execute: options.execute,
    expectedRevision: options.expectedRevision,
    publishUpgrade: (config, revision) => (
      staffingModule.writeFinalWriteupMatrixAudienceConfig(config, revision, null)
    ),
    replaceByRevision: (config, revision) => (
      staffingModule.replaceFinalWriteupMatrixAudienceConfigByRevision(config, revision, null)
    ),
  });
  if (!outcome.executed) {
    console.log('Dry run complete; no Dataverse write was issued.');
    return;
  }
  console.log(`Write/readback complete for ${outcome.mode}.`);
  console.log(JSON.stringify(outcome.result, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
}
