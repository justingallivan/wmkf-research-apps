#!/usr/bin/env node
/**
 * Guarded historical review-DOCX SharePoint backfill.
 *
 * Dry run is the default and writes a redacted manifest under outputs/. Execute
 * requires that previously generated manifest and all service-level write
 * interlocks. Manifest and timestamped execution-result artifacts are written
 * create-only. There is no force or overwrite mode.
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
  buildReviewDocxBackfillManifest,
  executeReviewDocxBackfill,
  isBlockingReviewDocxBackfillManifest,
  validateBackfillScope,
  validateReviewDocxBackfillManifest,
} from '../lib/services/review-documents/backfill-service.js';

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
  const out = { execute: false, cycleCode: null, requestNumber: null, manifestPath: null, outputPath: null };
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
    else if (arg === '--manifest') { markOnce('--manifest'); out.manifestPath = path.resolve(takeValue(index++, '--manifest')); }
    else if (arg.startsWith('--manifest=')) {
      markOnce('--manifest');
      const value = arg.slice('--manifest='.length);
      if (!value) throw new Error('--manifest requires a value.');
      out.manifestPath = path.resolve(value);
    } else if (arg === '--output') { markOnce('--output'); out.outputPath = path.resolve(takeValue(index++, '--output')); }
    else if (arg.startsWith('--output=')) {
      markOnce('--output');
      const value = arg.slice('--output='.length);
      if (!value) throw new Error('--output requires a value.');
      out.outputPath = path.resolve(value);
    }
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  const scope = validateBackfillScope({ cycleCode: out.cycleCode, requestNumber: out.requestNumber });
  if (out.execute && !out.manifestPath) throw new Error('--execute requires --manifest <path>.');
  if (!out.execute && out.manifestPath) throw new Error('--manifest is an execute-only input; use --output for a dry-run destination.');
  return { ...out, ...scope };
}

function defaultManifestPath(cycleCode, observedAt) {
  const stamp = observedAt.replace(/[:.]/g, '-');
  return path.resolve('outputs', 'review-docx-backfill', `review-docx-${cycleCode}-${stamp}.json`);
}

export function resultPathFor(manifestPath, generatedAt = new Date().toISOString()) {
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const base = /\.json$/i.test(manifestPath) ? manifestPath.slice(0, -5) : manifestPath;
  return `${base}.execute-result-${stamp}.json`;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
}

export function backfillExitCode({ manifest = null, report = null } = {}) {
  if (manifest && isBlockingReviewDocxBackfillManifest(manifest)) return 1;
  if (report && Number(report.summary?.failed || 0) > 0) return 1;
  return 0;
}

function assertOperatorReadTarget() {
  invariant(classifyDeployment() === 'local', 'backfill must run from a local operator process');
  invariant(resolveInterlockMode() === 'on', 'DATAVERSE_TARGET_INTERLOCK must equal literal "on"');
  invariant(process.env.DATAVERSE_ALLOW_PROD_READS === 'yes', 'DATAVERSE_ALLOW_PROD_READS must equal "yes"');
  invariant(classifyTarget(process.env.DYNAMICS_URL) === 'production', 'DYNAMICS_URL must resolve to the tracked Production Dataverse target');
}

export async function main(argv = process.argv.slice(2)) {
  loadLocalEnv();
  const args = parseArgs(argv);
  assertOperatorReadTarget();

  return withDalContext('backfill-review-docx-sharepoint', async () => {
    if (!args.execute) {
      const observedAt = new Date().toISOString();
      const manifest = await buildReviewDocxBackfillManifest({
        cycleCode: args.cycleCode,
        requestNumber: args.requestNumber,
        observedAt,
      });
      const manifestPath = args.outputPath || defaultManifestPath(args.cycleCode, observedAt);
      writeJson(manifestPath, manifest);
      console.log(JSON.stringify({
        mode: 'dry-run',
        manifestPath,
        manifestHash: manifest.manifestHash,
        ...manifest.summary,
      }, null, 2));
      process.exitCode = backfillExitCode({ manifest });
      return { manifestPath, manifest };
    }

    invariant(!args.outputPath, '--output is valid only for dry run');
    const manifest = validateReviewDocxBackfillManifest(
      JSON.parse(fs.readFileSync(args.manifestPath, 'utf8')),
    );
    invariant(manifest.scope.cycleCode === args.cycleCode, '--cycle does not match the reviewed manifest');
    if (args.requestNumber !== null) {
      invariant(manifest.scope.requestNumber === args.requestNumber, '--request-number does not match the reviewed manifest');
    }
    const report = await executeReviewDocxBackfill(manifest);
    const generatedAt = new Date().toISOString();
    const resultPath = resultPathFor(args.manifestPath, generatedAt);
    writeJson(resultPath, { generatedAt, ...report });
    console.log(JSON.stringify({ mode: 'execute', resultPath, ...report.summary }, null, 2));
    process.exitCode = backfillExitCode({ report });
    return { resultPath, report };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
