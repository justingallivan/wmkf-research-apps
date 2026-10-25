#!/usr/bin/env node
/** Slice 2 release: exact-key create-only seed and strict subject/body readback.
 * No other setting, preference, business record or email is written.
 * Production reads require explicit owner-authorized DATAVERSE_ALLOW_PROD_READS=yes.
 * node --env-file=.env.local scripts/seed-reviewer-deadline-subject.mjs --target=production
 * Add --execute --receipt=/absolute/new-receipt.json only after preflight.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validateDeadlineTemplate } from '../shared/config/reviewerDeadlineEmail.js';
import { REVIEWER_EXTENSION_SEED_SUBJECT } from '../lib/seed/email-defaults/reviewer-actions.js';
import { classifyTarget } from '../lib/dataverse/core/interlock.js';
const SUBJECT = 'email.reviewer_extension.subject';
const BODY = 'email.reviewer_extension.body';
const TARGETS = { production: 'https://wmkf.crm.dynamics.com', sandbox: 'https://orgd9e66399.crm.dynamics.com' };
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function seedDeadlineSubject({ read, create, execute = false, journal = () => {} }) {
  const beforeSubject = await read(SUBJECT);
  const beforeBody = await read(BODY);
  const candidate = { subject: beforeSubject.found ? beforeSubject.value : REVIEWER_EXTENSION_SEED_SUBJECT, body: beforeBody.value ?? '' };
  if (!beforeBody.found || !validateDeadlineTemplate(candidate).valid) throw new Error('Existing deadline defaults do not satisfy the candidate validator; nothing was written.');
  const before = { subjectFound: beforeSubject.found, subjectHash: hash(beforeSubject.value), bodyHash: hash(beforeBody.value) };
  journal({ stage: 'preflight', ...before, expectedSubject: beforeSubject.found ? 'preserve-existing' : REVIEWER_EXTENSION_SEED_SUBJECT });
  if (!execute) return { action: beforeSubject.found ? 'preserve-existing' : 'would-create-subject', ...before, valid: true };
  let created = false;
  if (!beforeSubject.found) {
    journal({ stage: 'creating-subject', key: SUBJECT });
    await create(SUBJECT, REVIEWER_EXTENSION_SEED_SUBJECT, null);
    created = true;
  }
  const afterSubject = await read(SUBJECT);
  const afterBody = await read(BODY);
  if (!afterSubject.found || afterSubject.value !== candidate.subject || !afterBody.found
    || hash(afterBody.value) !== before.bodyHash
    || !validateDeadlineTemplate({ subject: afterSubject.value, body: afterBody.value ?? '' }).valid) {
    throw new Error('Readback differs from the exact expected subject/body. Do not retry or overwrite; inspect the reserved receipt.');
  }
  const result = { action: created ? 'created-subject' : 'preserved-existing', valid: true,
    subjectHash: hash(afterSubject.value), bodyHash: hash(afterBody.value), bodyUnchanged: true };
  journal({ stage: 'verified', ...result });
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((v) => !/^--(?:target=(production|sandbox)|execute|receipt=.+)$/.test(v))) throw new Error('Only --target, --execute and --receipt are supported.');
  const target = args.find((v) => v.startsWith('--target='))?.slice(9);
  const execute = args.includes('--execute');
  const receiptPath = args.find((v) => v.startsWith('--receipt='))?.slice(10);
  if (!TARGETS[target]) throw new Error('Explicit --target=production or --target=sandbox required.');
  if (target === 'production' && process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') throw new Error('Production access needs the owner-authorized read flag.');
  if (execute && (!receiptPath || !path.isAbsolute(receiptPath))) throw new Error('Execute requires a new absolute --receipt path.');
  const url = TARGETS[target];
  if (classifyTarget(url) !== target) throw new Error('Target registry mismatch.');
  // Explicit URLs, no inferred target from an environment-variable name.
  process.env.DYNAMICS_URL = url;
  process.env.DYNAMICS_SANDBOX_URL = url;
  process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
  if (execute) process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({ purpose: 'slice-2-exact-subject-seed', ops: ['POST'], entitySets: ['wmkf_appsystemsettings'], recordIds: [], expiresAt: new Date(Date.now() + 300000).toISOString() });
  let receipt;
  if (execute) { receipt = { target, host: new URL(url).hostname, startedAt: new Date().toISOString(), events: [] }; fs.writeFileSync(receiptPath, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 }); }
  const journal = (event) => { if (receipt) { receipt.events.push(event); fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 }); } };
  const context = await import('../lib/services/dynamics-context.js');
  context.enterDynamicsBypassForScript('seed-reviewer-deadline-subject');
  const settings = (await import('../lib/services/settings-service.js')).default;
  const result = await seedDeadlineSubject({ read: settings.getSettingStrict, create: settings.createSettingStrict, execute, journal });
  console.log(JSON.stringify({ target, host: new URL(url).hostname, execute, ...result }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
