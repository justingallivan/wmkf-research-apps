#!/usr/bin/env node

/**
 * Guard the Wave 24 Request Document explicit-actor write contract.
 *
 * - exactly six runtime create seams are registered;
 * - each create declares its approved actor policy beside the call;
 * - raw Request Document createRecord calls remain centralized in the adapter;
 * - immutable origin fields are not written by arbitrary services/changesets.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WRITERS = Object.freeze([
  ['lib/services/initial-assessment/artifact-service.js', 'requestDocumentAdapter.create(', 'ALLOW_UNATTRIBUTED'],
  ['lib/services/initial-assessment/controls-service.js', 'dependencies.createDocument(', 'REQUIRED'],
  ['lib/services/pre-site-visit/artifact-service.js', 'dependencies.createDocument(', 'ALLOW_UNATTRIBUTED'],
  ['lib/services/pre-site-visit/reopen-service.js', 'dependencies.createDocument(', 'REQUIRED'],
  ['lib/services/pre-site-visit/distribution-service.js', 'dependencies.createDocument(', 'REQUIRED'],
  ['lib/services/final-writeup/transition-service.js', 'dependencies.createDocument(', 'REQUIRED'],
]);

const ALLOWED_ORIGIN_FIELD_FILES = new Set([
  'lib/dataverse/adapters/request-document.js',
  'lib/services/request-document-actor-service.js',
]);

function walkJs(relativeDir) {
  const absolute = path.join(ROOT, relativeDir);
  const out = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) out.push(...walkJs(relative));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(relative);
  }
  return out;
}

function occurrences(source, needle) {
  let count = 0;
  let cursor = 0;
  while ((cursor = source.indexOf(needle, cursor)) >= 0) {
    count += 1;
    cursor += needle.length;
  }
  return count;
}

function validateWriter(relative, source, callNeedle, expectedPolicy) {
  const errors = [];
  const count = occurrences(source, callNeedle);
  if (count !== 1) errors.push(`${relative}: expected exactly one ${callNeedle} call, found ${count}`);
  const callAt = source.indexOf(callNeedle);
  const callWindow = callAt >= 0 ? source.slice(callAt, callAt + 4000) : '';
  if (!callWindow.includes(`actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.${expectedPolicy}`)) {
    errors.push(`${relative}: create call is missing actor policy ${expectedPolicy}`);
  }
  if (!callWindow.includes('actorContext:')) {
    errors.push(`${relative}: create call is missing bounded actorContext`);
  }
  return errors;
}

function validateSources(sources) {
  const errors = [];
  for (const [relative, callNeedle, expectedPolicy] of WRITERS) {
    const source = sources.get(relative);
    if (source == null) {
      errors.push(`${relative}: registered writer file is missing`);
      continue;
    }
    errors.push(...validateWriter(relative, source, callNeedle, expectedPolicy));
  }

  const runtimeFiles = [...sources.entries()];
  const createSeamCount = runtimeFiles.reduce(
    (sum, [, source]) => sum + occurrences(source, 'requestDocumentAdapter.create'),
    0,
  );
  if (createSeamCount !== WRITERS.length) {
    errors.push(`requestDocumentAdapter.create wiring count ${createSeamCount} != ${WRITERS.length}`);
  }

  for (const [relative, source] of runtimeFiles) {
    if (relative !== 'lib/dataverse/adapters/request-document.js'
        && source.includes('createRecord(')
        && source.includes('wmkf_requestdocuments')) {
      errors.push(`${relative}: raw Request Document createRecord bypasses the adapter`);
    }
    if (!ALLOWED_ORIGIN_FIELD_FILES.has(relative)
        && /(?:['"]wmkf_InitiatedBy@odata\.bind['"]|\bwmkf_initiatedat\s*:)/i.test(source)) {
      errors.push(`${relative}: immutable origin fields are written outside the actor/adapter seam`);
    }
  }
  return errors;
}

function liveSources() {
  const files = [...walkJs('lib'), ...walkJs('pages')];
  return new Map(files.map((relative) => [
    relative,
    fs.readFileSync(path.join(ROOT, relative), 'utf8'),
  ]));
}

function runSelfTest() {
  const goodCall = (needle, policy) => `${needle}{}, { actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.${policy}, actorContext: {} });`;
  const base = new Map(WRITERS.map(([relative, needle, policy]) => [
    relative,
    `${needle === 'dependencies.createDocument(' ? 'createDocument: requestDocumentAdapter.create; ' : ''}`
      + goodCall(needle, policy),
  ]));
  base.set('lib/dataverse/adapters/request-document.js', 'export async function create() {}');
  base.set('lib/services/request-document-actor-service.js', "const f = 'wmkf_initiatedat';");
  let errors = validateSources(base);
  if (errors.length) throw new Error(`positive fixture failed: ${errors.join('; ')}`);

  const missingPolicy = new Map(base);
  const [relative, needle] = WRITERS[0];
  missingPolicy.set(relative, `${needle}{}, { actorContext: {} });`);
  errors = validateSources(missingPolicy);
  if (!errors.some((error) => error.includes('missing actor policy'))) {
    throw new Error('missing-policy fixture was not rejected');
  }

  const bypass = new Map(base);
  bypass.set('lib/services/bypass.js', "DynamicsService.createRecord('wmkf_requestdocuments', {});");
  errors = validateSources(bypass);
  if (!errors.some((error) => error.includes('bypasses the adapter'))) {
    throw new Error('raw-create fixture was not rejected');
  }

  const immutablePatch = new Map(base);
  immutablePatch.set('lib/services/bypass.js', "const patch = { wmkf_initiatedat: 'x' };");
  errors = validateSources(immutablePatch);
  if (!errors.some((error) => error.includes('immutable origin fields'))) {
    throw new Error('immutable-field fixture was not rejected');
  }
  console.log('request-document-writers self-test OK — positive and negative fixtures passed.');
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
} else {
  const errors = validateSources(liveSources());
  if (errors.length) {
    console.error('request-document-writers FAILED:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`request-document-writers OK — ${WRITERS.length} actor-aware create seams and immutable origin fields enforced.`);
}
