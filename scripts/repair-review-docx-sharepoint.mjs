#!/usr/bin/env node
/**
 * Guarded exact-item repair for one retained individual-review DOCX.
 *
 * Dry run is the default. Execute requires the exact reviewed manifest plus
 * the ordinary local Production-write interlocks. Relocation retains the prior
 * SharePoint item; content repair writes a new version of the exact current item
 * and verifies that the prior version remains downloadable.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withDalContext } from '../lib/dataverse/core/context.js';
import {
  classifyDeployment,
  classifyTarget,
  resolveInterlockMode,
} from '../lib/dataverse/core/interlock.js';
import {
  buildReviewDocxRepairManifest,
  executeReviewDocxRepair,
  validateRepairScope,
  validateReviewDocxRepairManifest,
} from '../lib/services/review-documents/repair-service.js';

function invariant(condition, message) {
  if (!condition) throw new Error(`Safety invariant failed: ${message}`);
}

function loadLocalEnv() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.join(scriptDir, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    const value = raw.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (!process.env[key]) process.env[key] = value;
  }
}

export function parseArgs(argv) {
  const out = {
    execute: false,
    cycleCode: null,
    requestNumber: null,
    suggestionId: null,
    manifestPath: null,
    outputPath: null,
  };
  const seen = new Set();
  const markOnce = (name) => {
    if (seen.has(name)) throw new Error(`${name} may be specified only once.`);
    seen.add(name);
  };
  const takeValue = (index, label) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${label} requires a value.`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute') { markOnce('--execute'); out.execute = true; }
    else if (arg === '--cycle') { markOnce('--cycle'); out.cycleCode = takeValue(index++, '--cycle'); }
    else if (arg.startsWith('--cycle=')) { markOnce('--cycle'); out.cycleCode = arg.slice('--cycle='.length); }
    else if (arg === '--request-number') { markOnce('--request-number'); out.requestNumber = takeValue(index++, '--request-number'); }
    else if (arg.startsWith('--request-number=')) { markOnce('--request-number'); out.requestNumber = arg.slice('--request-number='.length); }
    else if (arg === '--suggestion') { markOnce('--suggestion'); out.suggestionId = takeValue(index++, '--suggestion'); }
    else if (arg.startsWith('--suggestion=')) { markOnce('--suggestion'); out.suggestionId = arg.slice('--suggestion='.length); }
    else if (arg === '--manifest') { markOnce('--manifest'); out.manifestPath = path.resolve(takeValue(index++, '--manifest')); }
    else if (arg.startsWith('--manifest=')) {
      markOnce('--manifest');
      const value = arg.slice('--manifest='.length);
      if (!value) throw new Error('--manifest requires a value.');
      out.manifestPath = path.resolve(value);
    }
    else if (arg === '--output') { markOnce('--output'); out.outputPath = path.resolve(takeValue(index++, '--output')); }
    else if (arg.startsWith('--output=')) {
      markOnce('--output');
      const value = arg.slice('--output='.length);
      if (!value) throw new Error('--output requires a value.');
      out.outputPath = path.resolve(value);
    }
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  const scope = validateRepairScope({
    cycleCode: out.cycleCode,
    requestNumber: out.requestNumber,
    suggestionId: out.suggestionId,
  });
  if (out.execute && !out.manifestPath) throw new Error('--execute requires --manifest <path>.');
  if (!out.execute && out.manifestPath) throw new Error('--manifest is an execute-only input; use --output for a dry-run destination.');
  if (out.execute && out.outputPath) throw new Error('--output is valid only for dry run.');
  return { ...out, ...scope };
}

function defaultManifestPath(requestNumber, observedAt) {
  const stamp = observedAt.replace(/[:.]/g, '-');
  return path.resolve('outputs', 'review-docx-repair', `review-docx-repair-${requestNumber}-${stamp}.json`);
}

export function resultPathFor(manifestPath, generatedAt = new Date().toISOString()) {
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const base = /\.json$/i.test(manifestPath) ? manifestPath.slice(0, -5) : manifestPath;
  return `${base}.execute-result-${stamp}.json`;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8', mode: 0o600, flag: 'wx',
  });
}

function assertOperatorReadTarget() {
  invariant(classifyDeployment() === 'local', 'repair must run from a local operator process');
  invariant(resolveInterlockMode() === 'on', 'DATAVERSE_TARGET_INTERLOCK must equal literal "on"');
  invariant(process.env.DATAVERSE_ALLOW_PROD_READS === 'yes', 'DATAVERSE_ALLOW_PROD_READS must equal "yes"');
  invariant(classifyTarget(process.env.DYNAMICS_URL) === 'production', 'DYNAMICS_URL must resolve to the tracked Production Dataverse target');
}

export async function main(argv = process.argv.slice(2)) {
  loadLocalEnv();
  const args = parseArgs(argv);
  assertOperatorReadTarget();
  return withDalContext('repair-review-docx-sharepoint', async () => {
    if (!args.execute) {
      const observedAt = new Date().toISOString();
      const manifest = await buildReviewDocxRepairManifest({ ...args, observedAt });
      const manifestPath = args.outputPath || defaultManifestPath(args.requestNumber, observedAt);
      writeJson(manifestPath, manifest);
      console.log(JSON.stringify({
        mode: 'dry-run', manifestPath, manifestHash: manifest.manifestHash, ...manifest.summary,
      }, null, 2));
      process.exitCode = manifest.summary.blocking > 0 ? 1 : 0;
      return { manifestPath, manifest };
    }

    const manifest = validateReviewDocxRepairManifest(
      JSON.parse(fs.readFileSync(args.manifestPath, 'utf8')),
    );
    invariant(manifest.scope.cycleCode === args.cycleCode, '--cycle does not match the reviewed manifest');
    invariant(manifest.scope.requestNumber === args.requestNumber, '--request-number does not match the reviewed manifest');
    invariant(manifest.scope.suggestionId === args.suggestionId, '--suggestion does not match the reviewed manifest');
    const report = await executeReviewDocxRepair(manifest);
    const generatedAt = new Date().toISOString();
    const resultPath = resultPathFor(args.manifestPath, generatedAt);
    writeJson(resultPath, { generatedAt, ...report });
    console.log(JSON.stringify({ mode: 'execute', resultPath, ...report.summary }, null, 2));
    process.exitCode = report.summary.failed > 0 ? 1 : 0;
    return { resultPath, report };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
