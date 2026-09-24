#!/usr/bin/env node

/**
 * Guard the Wave 24 Request Document explicit-actor write contract.
 *
 * - exactly ten runtime create seams are registered (the WRITERS table is the count);
 * - each create declares its approved actor policy beside the call;
 * - raw Request Document createRecord calls remain centralized in the adapter;
 * - immutable origin fields are not written by arbitrary services/changesets.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WRITERS = Object.freeze([
  ['lib/services/initial-assessment/artifact-service.js', 'requestDocumentAdapter.create(', 'ALLOW_UNATTRIBUTED'],
  // This seam's REQUIRED policy is this file's OWN production call, unchanged
  // -- but on the Test Request Factory sandbox rehearsal path ONLY (never a
  // real production caller), the sandbox transport
  // (lib/services/test-requests/ia-sandbox-deps.js `sandboxCreateDocument`)
  // substitutes SANDBOX_REHEARSAL for whatever `actorPolicy` this call
  // passes, because the rehearsal run never has a staff actor to resolve.
  // That substitution happens one layer below this call site, so it does not
  // change the text this gate scans and does not need a second WRITERS row.
  ['lib/services/initial-assessment/controls-service.js', 'dependencies.createDocument(', 'REQUIRED'],
  ['lib/services/pre-site-visit/artifact-service.js', 'dependencies.createDocument(', 'ALLOW_UNATTRIBUTED'],
  ['lib/services/pre-site-visit/reopen-service.js', 'dependencies.createDocument(', 'REQUIRED'],
  ['lib/services/pre-site-visit/distribution/retained-snapshot.js', 'dependencies.createDocument(', 'REQUIRED'],
  ['lib/services/final-writeup/transition-service.js', 'dependencies.createDocument(', 'REQUIRED'],
  ['lib/services/site-visit-materials/contributor-service.js', 'dependencies.createDocument(', 'EXTERNAL_CONTRIBUTOR'],
  ['lib/services/consultant-feedback-attachment-service.js', 'dependencies.createDocument(', 'ALLOW_UNATTRIBUTED'],
  ['lib/services/pre-rp-brief/artifact-service.js', 'dependencies.createDocument(', 'ALLOW_UNATTRIBUTED'],
  ['lib/services/test-requests/run-runner.js', 'dependencies.createDocument(', 'SANDBOX_REHEARSAL'],
]);

const ALLOWED_ORIGIN_FIELD_FILES = new Set([
  'lib/dataverse/adapters/request-document.js',
  'lib/services/request-document-actor-service.js',
]);

const RUNTIME_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);

function walkRuntime(relativeDir) {
  const absolute = path.join(ROOT, relativeDir);
  const out = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) out.push(...walkRuntime(relative));
    else if (entry.isFile() && RUNTIME_EXTENSIONS.has(path.extname(entry.name))) out.push(relative);
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
        && /(?:['"]wmkf_InitiatedBy@odata\.bind['"]|(?:['"])?wmkf_initiatedat(?:['"])?\s*:)/i.test(source)) {
      errors.push(`${relative}: immutable origin fields are written outside the actor/adapter seam`);
    }
  }
  return errors;
}

function liveSources() {
  const files = ['lib', 'pages', 'shared', 'modules']
    .filter((relative) => fs.existsSync(path.join(ROOT, relative)))
    .flatMap((relative) => walkRuntime(relative));
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

  const missingWriter = new Map(base);
  missingWriter.delete(WRITERS[0][0]);
  errors = validateSources(missingWriter);
  if (!errors.some((error) => error.includes('registered writer file is missing'))) {
    throw new Error('missing-writer fixture was not rejected');
  }

  const movedWriter = new Map(base);
  const [distributionRelative, distributionNeedle, distributionPolicy] = WRITERS.find(
    ([writerPath]) => writerPath === 'lib/services/pre-site-visit/distribution/retained-snapshot.js',
  );
  movedWriter.delete(distributionRelative);
  movedWriter.set('lib/services/pre-site-visit/distribution-service.js', base.get(distributionRelative));
  errors = validateSources(movedWriter);
  if (!errors.some((error) => error.includes('registered writer file is missing'))) {
    throw new Error('moved-writer fixture was not rejected');
  }

  const duplicateWriter = new Map(base);
  duplicateWriter.set(distributionRelative, `${base.get(distributionRelative)}\n${goodCall(distributionNeedle, distributionPolicy)}`);
  errors = validateSources(duplicateWriter);
  if (!errors.some((error) => error.includes('expected exactly one'))) {
    throw new Error('duplicate-writer fixture was not rejected');
  }

  const duplicateBinding = new Map(base);
  duplicateBinding.set('lib/services/duplicate-binding.js', 'requestDocumentAdapter.create({}, {});');
  errors = validateSources(duplicateBinding);
  if (!errors.some((error) => error.includes('wiring count'))) {
    throw new Error('duplicate-binding fixture was not rejected');
  }

  const wrongPolicy = new Map(base);
  wrongPolicy.set(distributionRelative, base.get(distributionRelative).replace(
    'actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED',
    'actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.ALLOW_UNATTRIBUTED',
  ));
  errors = validateSources(wrongPolicy);
  if (!errors.some((error) => error.includes('missing actor policy REQUIRED'))) {
    throw new Error('wrong-policy fixture was not rejected');
  }

  const missingActorContext = new Map(base);
  missingActorContext.set(distributionRelative, base.get(distributionRelative).replace('actorContext: {}', ''));
  errors = validateSources(missingActorContext);
  if (!errors.some((error) => error.includes('missing bounded actorContext'))) {
    throw new Error('missing-actor-context fixture was not rejected');
  }

  const bypass = new Map(base);
  bypass.set('lib/services/bypass.js', "DynamicsService.createRecord('wmkf_requestdocuments', {});");
  errors = validateSources(bypass);
  if (!errors.some((error) => error.includes('bypasses the adapter'))) {
    throw new Error('raw-create fixture was not rejected');
  }

  const immutablePatch = new Map(base);
  immutablePatch.set('lib/services/bypass.js', "const patch = { 'wmkf_initiatedat': 'x' };");
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
