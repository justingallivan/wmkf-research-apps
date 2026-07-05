#!/usr/bin/env node
/**
 * Self-test for scripts/check-model-registry.js.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { registerTmpFixture } = require('./lib/selftest-fixture');

const CHECK = path.resolve(__dirname, 'check-model-registry.js');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function fixture({ appModel = 'claude-opus-4-8', fallback = 'claude-opus-4-8', capability = true, pricing = true, badCapability = '' } = {}) {
  const { dir: root } = registerTmpFixture('model-registry-');
  write(path.join(root, 'shared/config/baseConfig.js'), `
export const BASE_CONFIG = {
  CLAUDE: { DEFAULT_MODEL: 'sonnet', FALLBACK_MODEL: 'haiku' },
  APP_MODELS: {
    'reviewer-finder': { model: '${appModel}', fallback: 'sonnet' },
    'qa': { model: 'sonnet', fallback: 'haiku' },
  },
};
`);
  write(path.join(root, 'lib/services/model-resolver.js'), `
const TIER_FALLBACK_IDS = {
  opus: '${fallback}',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};
module.exports = { TIER_FALLBACK_IDS };
`);
  write(path.join(root, 'lib/services/model-capabilities.js'), `
export const MODEL_CAPABILITIES = {
${capability ? `  'claude-opus-4-8': ${badCapability || cap('opus', false, true)},` : ''}
  'claude-sonnet-4-6': ${cap('sonnet', true, true)},
  'claude-haiku-4-5': ${cap('haiku', true, false)},
};
`);
  write(path.join(root, 'lib/utils/model-pricing.js'), `
export const MODEL_PRICING = {
${pricing ? "  'claude-opus-4-8': { input: 500, output: 2500 }," : ''}
  'claude-sonnet-4-6': { input: 300, output: 1500 },
  'claude-haiku-4-5': { input: 100, output: 500 },
};
`);
  return root;
}

function cap(family, supportsTemperature, supportsEffort) {
  return `{
    provider: 'anthropic',
    family: '${family}',
    supportsTemperature: ${supportsTemperature},
    supportsEffort: ${supportsEffort},
    thinkingMode: 'none',
    maxInputTokens: 200000,
    maxOutputTokens: 64000,
    refusalSemantics: 'standard_stop_reason',
    requiresRefusalHandling: false,
    dataRetentionClass: 'standard',
    reviewedAt: '2026-06-25',
    source: 'https://example.test/${family}',
  }`;
}

function run(root) {
  return spawnSync(process.execPath, [CHECK, '--root', root], {
    encoding: 'utf8',
  });
}

function expectPass(name, root) {
  const r = run(root);
  if (r.status !== 0) {
    throw new Error(`${name}: expected pass, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  }
  console.log(`  ok   ${name}`);
}

function expectFail(name, root, pattern) {
  const r = run(root);
  if (r.status === 0) {
    throw new Error(`${name}: expected failure, got pass\n${r.stdout}`);
  }
  const out = `${r.stdout}\n${r.stderr}`;
  if (pattern && !pattern.test(out)) {
    throw new Error(`${name}: failure did not match ${pattern}\n${out}`);
  }
  console.log(`  ok   ${name}`);
}

function main() {
  expectPass('clean fixture passes', fixture());
  expectFail(
    'configured concrete model missing capability fails',
    fixture({ capability: false }),
    /missing from MODEL_CAPABILITIES/,
  );
  expectFail(
    'configured concrete model missing pricing fails',
    fixture({ pricing: false }),
    /missing from MODEL_PRICING|has no matching MODEL_PRICING/,
  );
  expectFail(
    'tier fallback missing capability fails',
    fixture({ fallback: 'claude-opus-4-9' }),
    /TIER_FALLBACK_IDS\.opus.*MODEL_CAPABILITIES/,
  );
  expectFail(
    'capability entry missing reviewedAt fails',
    fixture({
      badCapability: `{
        provider: 'anthropic',
        family: 'opus',
        supportsTemperature: false,
        supportsEffort: true,
        thinkingMode: 'adaptive',
        maxInputTokens: 1000000,
        maxOutputTokens: 128000,
        refusalSemantics: 'standard_stop_reason',
        requiresRefusalHandling: false,
        dataRetentionClass: 'standard',
        source: 'https://example.test/opus',
      }`,
    }),
    /missing required field "reviewedAt"/,
  );
  console.log('model-registry self-test OK - 5/5 cases.');
}

main();
