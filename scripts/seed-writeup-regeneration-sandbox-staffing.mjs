#!/usr/bin/env node

/**
 * Prepare or create the exact Sandbox-only staffing and handoff-copy rows for
 * the writeup-regeneration rehearsal. Dry-run is the default. Execute mode is
 * create-only, rechecks current state, and journals each write intent/result
 * outside the repository. It never assigns security roles; use the existing
 * apply-security-role.js command for that separately reviewed operation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SANDBOX_URL = 'https://orgd9e66399.crm.dynamics.com';
const SANDBOX_HOST = new URL(SANDBOX_URL).hostname;
const DEFAULT_PLAN = '/private/tmp/writeup-regen-staffing-plan.json';
const EMAIL_COPY_KEYS = Object.freeze([
  'email.final_writeup_handoff.subject',
  'email.final_writeup_handoff.body',
]);

function parseArgs(argv) {
  const options = { execute: false, plan: DEFAULT_PLAN, journal: null };
  for (const value of argv.slice(2)) {
    if (value === '--execute-sandbox-settings') options.execute = true;
    else if (value.startsWith('--plan=')) options.plan = value.slice('--plan='.length);
    else if (value.startsWith('--journal=')) options.journal = value.slice('--journal='.length);
    else if (value === '--help' || value === '-h') options.help = true;
    else throw new Error(`Unknown option: ${value}`);
  }
  if (options.execute && !options.journal) {
    throw new Error('Execute mode requires --journal=<absolute path outside the repository>.');
  }
  return options;
}

function appendJournal(journalPath, event) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`;
  fs.appendFileSync(journalPath, line, { mode: 0o600 });
  fs.chmodSync(journalPath, 0o600);
}

function requireOutsideRepository(filePath, repositoryRoot) {
  if (!path.isAbsolute(filePath)) {
    throw new Error('The journal path must be absolute and outside the repository.');
  }
  const resolved = path.resolve(filePath);
  const relative = path.relative(repositoryRoot, resolved);
  if (!path.isAbsolute(resolved) || (!relative.startsWith('..') && relative !== '')) {
    throw new Error('The journal must be an absolute path outside the repository.');
  }
  return resolved;
}

function validatePlan(plan, matrixModule, subjectSeed, bodySeed) {
  if (plan?.target !== 'sandbox' || plan?.operation !== 'create-missing-only') {
    throw new Error('The plan must target Sandbox and use create-missing-only semantics.');
  }
  if (plan.matrixSetting?.key !== matrixModule.FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY
    || plan.matrixSetting?.expectedRevision !== null
    || plan.matrixSetting?.found !== false) {
    throw new Error('The matrix candidate is not an absent-row create plan.');
  }
  const normalized = matrixModule.validateFinalWriteupMatrixAudienceConfig(
    plan.matrixSetting.value,
    { writableOnly: true },
  );
  if (normalized.programs.length !== 1 || normalized.personas.length !== 2
    || normalized.programs[0].reviewerIds.length !== 2
    || normalized.personas.some((person) => (
      person.roles.length !== 1 || person.roles[0] !== 'program-director'
    ))) {
    throw new Error('The rehearsal staffing plan must contain exactly two Program Directors on one program.');
  }
  const ids = new Set(normalized.personas.map((person) => person.reviewerId));
  if (ids.size !== 2 || normalized.programs[0].reviewerIds.some((id) => !ids.has(id))) {
    throw new Error('The program audience and persona assignments must use the same two identities.');
  }
  const expectedCopy = new Map([
    [EMAIL_COPY_KEYS[0], subjectSeed],
    [EMAIL_COPY_KEYS[1], bodySeed],
  ]);
  if (!Array.isArray(plan.emailCopy) || plan.emailCopy.length !== 2) {
    throw new Error('The plan must contain the two canonical handoff email keys.');
  }
  for (const row of plan.emailCopy) {
    if (!expectedCopy.has(row.key) || expectedCopy.get(row.key) !== row.value || row.found !== false) {
      throw new Error(`The email-copy plan is not an absent-row canonical seed for ${row.key}.`);
    }
  }
  return normalized;
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    console.log('Usage: node scripts/seed-writeup-regeneration-sandbox-staffing.mjs [--plan=/private/tmp/plan.json] [--journal=/private/tmp/journal.jsonl] [--execute-sandbox-settings]');
    return;
  }

  const repositoryRoot = process.cwd();
  let journalPath = null;
  if (options.execute) {
    journalPath = requireOutsideRepository(options.journal, repositoryRoot);
    fs.mkdirSync(path.dirname(journalPath), { recursive: true });
    if (fs.existsSync(journalPath)) throw new Error('Refusing to reuse an existing journal path.');
    fs.writeFileSync(journalPath, '', { mode: 0o600, flag: 'wx' });
  }

  // Load local app credentials, then pin both variables to the tracked
  // Sandbox hostname so a local env file cannot redirect this rehearsal.
  const { loadEnvLocal } = await import('../lib/dataverse/client.js');
  loadEnvLocal();
  process.env.DYNAMICS_URL = SANDBOX_URL;
  process.env.DYNAMICS_SANDBOX_URL = SANDBOX_URL;
  process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
  process.env.DATAVERSE_DAL_ENFORCEMENT = 'on';
  delete process.env.DATAVERSE_ALLOW_PROD_READS;

  const { classifyTarget } = await import('../lib/dataverse/core/interlock.js');
  const { SANDBOX_HOSTS } = await import('../lib/dataverse/core/target-registry.js');
  const { withDalContext } = await import('../lib/dataverse/core/context.js');
  const grantPrograms = await import('../lib/dataverse/adapters/grant-program.js');
  const systemUsers = await import('../lib/dataverse/adapters/system-user.js');
  const matrix = await import('../lib/services/final-writeup/matrix-audience-service.js');
  const settingsModule = await import('../lib/services/settings-service.js');
  const settings = settingsModule.default || settingsModule;
  const { FINAL_WRITEUP_HANDOFF_SEED_SUBJECT, FINAL_WRITEUP_HANDOFF_SEED_BODY } =
    await import('../lib/seed/email-defaults/final-writeup-handoff.js');

  if (!SANDBOX_HOSTS.includes(SANDBOX_HOST) || classifyTarget(SANDBOX_URL) !== 'sandbox'
    || process.env.DATAVERSE_TARGET_INTERLOCK !== 'on'
    || process.env.DATAVERSE_DAL_ENFORCEMENT !== 'on') {
    throw new Error('Sandbox target/interlock/DAL preconditions failed.');
  }
  if (process.env.DATAVERSE_ALLOW_PROD_READS) {
    throw new Error('Production read opt-in must be absent for this rehearsal.');
  }

  const plan = JSON.parse(fs.readFileSync(path.resolve(options.plan), 'utf8'));
  const normalized = validatePlan(
    plan,
    matrix,
    FINAL_WRITEUP_HANDOFF_SEED_SUBJECT,
    FINAL_WRITEUP_HANDOFF_SEED_BODY,
  );
  const reviewerIds = normalized.personas.map((person) => person.reviewerId).sort();
  const expectedProgramId = normalized.programs[0].grantProgramId;

  await withDalContext('writeup-regeneration-sandbox-staffing', async () => {
    const [programResult, reviewerResult, matrixState, subjectState, bodyState] = await Promise.all([
      grantPrograms.listActive({ top: 100 }),
      systemUsers.listEnabledBySecurityRoleName('WMKF Final Writeup Reviewer', { top: 100 }),
      settings.getSettingStrict(matrix.FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY),
      settings.getSettingStrict(EMAIL_COPY_KEYS[0]),
      settings.getSettingStrict(EMAIL_COPY_KEYS[1]),
    ]);
    const activePrograms = programResult?.records || [];
    const research = activePrograms.filter((row) => row.wmkf_name === 'Research');
    if (research.length !== 1 || String(research[0].wmkf_grantprogramid).toLowerCase() !== expectedProgramId) {
      throw new Error('The Research Grant Program identity changed since the plan was prepared.');
    }
    const directReviewerIds = (reviewerResult?.records || [])
      .map((row) => String(row.systemuserid || '').toLowerCase()).sort();
    if (directReviewerIds.length !== reviewerIds.length
      || directReviewerIds.some((id, index) => id !== reviewerIds[index])) {
      throw new Error('The enabled reviewer-role roster does not exactly match the two planned accounts.');
    }
    const current = new Map([
      [matrix.FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY, matrixState],
      [EMAIL_COPY_KEYS[0], subjectState],
      [EMAIL_COPY_KEYS[1], bodyState],
    ]);
    for (const [key, state] of current) {
      if (state.found && state.value !== (
        key === matrix.FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY
          ? JSON.stringify(normalized)
          : plan.emailCopy.find((row) => row.key === key).value
      )) {
        throw new Error(`Refusing to overwrite an existing different value for ${key}.`);
      }
    }

    const summary = {
      target: 'sandbox',
      activeResearchProgramMatches: 1,
      directEnabledReviewersMatch: true,
      alreadyMatching: [...current].filter(([, state]) => state.found).length,
      absent: [...current].filter(([, state]) => !state.found).map(([key]) => key),
      mode: options.execute ? 'execute' : 'dry-run',
    };
    if (!options.execute) {
      console.log(JSON.stringify(summary));
      return;
    }

    for (const row of plan.emailCopy) {
      const existing = await settings.getSettingStrict(row.key);
      if (existing.found) {
        if (existing.value !== row.value) throw new Error(`Refusing changed existing value for ${row.key}.`);
        appendJournal(journalPath, { event: 'already-matching', key: row.key });
        continue;
      }
      appendJournal(journalPath, { event: 'write-intent', key: row.key, method: 'createSettingStrict' });
      await settings.createSettingStrict(row.key, row.value, null);
      const readback = await settings.getSettingStrict(row.key);
      if (!readback.found || readback.value !== row.value) {
        appendJournal(journalPath, { event: 'readback-failed', key: row.key });
        throw new Error(`Readback did not match the canonical value for ${row.key}.`);
      }
      appendJournal(journalPath, { event: 'created-and-verified', key: row.key });
    }

    const existingMatrix = await settings.getSettingStrict(matrix.FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY);
    if (existingMatrix.found) {
      if (existingMatrix.value !== JSON.stringify(normalized)) {
        throw new Error('Refusing changed existing matrix setting.');
      }
      appendJournal(journalPath, { event: 'already-matching', key: matrix.FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY });
    } else {
      appendJournal(journalPath, {
        event: 'write-intent',
        key: matrix.FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY,
        method: 'writeFinalWriteupMatrixAudienceConfig',
        expectedRevision: null,
      });
      await matrix.writeFinalWriteupMatrixAudienceConfig(normalized, null, null);
      const readback = await settings.getSettingStrict(matrix.FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY);
      if (!readback.found || readback.value !== JSON.stringify(normalized)) {
        appendJournal(journalPath, { event: 'readback-failed', key: matrix.FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY });
        throw new Error('Matrix setting readback did not match the validated candidate.');
      }
      appendJournal(journalPath, { event: 'created-and-verified', key: matrix.FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY });
    }
    console.log(JSON.stringify({ ...summary, mode: 'execute', outcome: 'created-or-confirmed', journalPath }));
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
}
