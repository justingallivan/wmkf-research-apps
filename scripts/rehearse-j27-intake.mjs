#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyDeployment, classifyTarget } from '../lib/dataverse/core/interlock.js';

const [mode, packetPath, bindingPath, receiptPath, ...extra] = process.argv.slice(2);
if (mode === '--fixtures' && !packetPath) {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../node_modules/jest/bin/jest.js', import.meta.url)),
    '--runInBand', '--runTestsByPath', 'tests/unit/j27-intake-runner.test.js',
  ], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
if (extra.length || !packetPath || !bindingPath
  || (mode === '--preflight' ? receiptPath : mode !== '--execute-anthropic' || !receiptPath)) {
  throw new Error('Use --fixtures, --preflight <packet> <binding>, or --execute-anthropic <packet> <binding> <receipt>.');
}

const target = process.env.DYNAMICS_URL;
if (classifyTarget(target) !== 'sandbox' || classifyDeployment() === 'production'
  || process.env.DATAVERSE_TARGET_INTERLOCK !== 'on' || process.env.DATAVERSE_ALLOW_PROD_READS !== 'no') {
  throw new Error('Refusing to connect without a registered sandbox target, interlock on, and production reads disabled.');
}
const url = new URL(target);
if (url.protocol !== 'https:' || url.href !== `https://${url.hostname}/`) {
  throw new Error('DYNAMICS_URL must be the bare HTTPS sandbox origin.');
}
if (mode === '--execute-anthropic' && !process.env.CLAUDE_API_KEY) {
  throw new Error('Anthropic credentials are required for the authorized live rehearsal.');
}

const packet = JSON.parse(readFileSync(packetPath, 'utf8'));
const binding = JSON.parse(readFileSync(bindingPath, 'utf8'));
const { withDalContext } = await import('../lib/dataverse/core/context.js');
const { preflightJ27Intake, runJ27Intake } = await import('./lib/j27-intake-runner.js');

await withDalContext('j27-intake-sandbox-rehearsal', async () => {
  if (mode === '--preflight') {
    const { prompts } = await preflightJ27Intake(packet, binding);
    console.log(JSON.stringify({ packetId: packet.id, target: url.hostname, prompts }, null, 2));
    return;
  }

  const receipt = { packetId: packet.id, requestId: binding.requestId, target: url.hostname, status: 'running', results: {} };
  const save = (options) => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', options);
  save({ flag: 'wx', mode: 0o600 });
  try {
    const result = await runJ27Intake(packet, binding, {
      onStage(stage, value) {
        receipt.results[stage] = value;
        save();
        console.log(`${stage}: ${value.state || 'completed'}`);
      },
    });
    Object.assign(receipt, result, { status: 'completed' });
    save();
  } catch (error) {
    receipt.status = 'failed';
    receipt.failedRunId = error.runId ?? null;
    save();
    throw error;
  }
});
