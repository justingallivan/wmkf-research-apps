#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checker = path.join(root, 'scripts', 'check-reviewer-find-cold-no-send.mjs');

const clean = spawnSync(process.execPath, [checker], {
  cwd: root,
  encoding: 'utf8',
  env: process.env,
});
if (clean.status !== 0) {
  console.error('Cold no-send self-test could not establish a clean positive control.');
  process.exit(1);
}

for (const injection of ['send_call', 'aliased_call', 'destructured_call', 'computed_call']) {
  const injected = spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, REVIEWER_FIND_COLD_NO_SEND_TEST_INJECT: injection },
  });
  if (injected.status === 0 || !injected.stderr.includes('forbidden call sendEmail')) {
    console.error(`Cold no-send self-test failed: ${injection} was not rejected.`);
    process.exit(1);
  }
}

for (const injection of ['forbidden_module', 'aliased_forbidden_module', 'dynamic_forbidden_module']) {
  const injected = spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, REVIEWER_FIND_COLD_NO_SEND_TEST_INJECT: injection },
  });
  if (injected.status === 0 || !injected.stderr.includes('forbidden module reachable')) {
    console.error(`Cold no-send self-test failed: ${injection} was not rejected as a forbidden module.`);
    process.exit(1);
  }
}

const unresolvedLocalImport = spawnSync(process.execPath, [checker], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, REVIEWER_FIND_COLD_NO_SEND_TEST_INJECT: 'unresolvable_local_import' },
});
if (unresolvedLocalImport.status === 0
  || !unresolvedLocalImport.stderr.includes('unresolvable local import')) {
  console.error('Cold no-send self-test failed: an unresolvable local import was not rejected.');
  process.exit(1);
}

const unresolvedRepositoryAlias = spawnSync(process.execPath, [checker], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, REVIEWER_FIND_COLD_NO_SEND_TEST_INJECT: 'unresolvable_repository_alias' },
});
if (unresolvedRepositoryAlias.status === 0
  || !unresolvedRepositoryAlias.stderr.includes('unresolvable repository alias import')) {
  console.error('Cold no-send self-test failed: an unresolvable repository alias was not rejected.');
  process.exit(1);
}

const unsupportedRepositoryAlias = spawnSync(process.execPath, [checker], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, REVIEWER_FIND_COLD_NO_SEND_TEST_INJECT: 'unsupported_repository_alias' },
});
if (unsupportedRepositoryAlias.status === 0
  || !unsupportedRepositoryAlias.stderr.includes('unsupported repository alias import')) {
  console.error('Cold no-send self-test failed: an unsupported repository alias was not rejected.');
  process.exit(1);
}

console.log('Reviewer Find cold no-send self-test passed.');
