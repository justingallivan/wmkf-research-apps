'use strict';

/**
 * NODE_OPTIONS=--require preload used ONLY when spawning
 * `scripts/setup-database.js` as a child process for the pg-contract
 * harness (tests/pg-contract/support/global-setup.js). Never loaded by the
 * app or by any other test lane.
 *
 * setup-database.js is fresh-install-only and is not owned by this harness
 * (CLAUDE.md Universal Safety Invariants), so it is run unmodified. Two
 * things stand between it and a real Postgres container:
 *
 * 1. It `require('@vercel/postgres')`, which is Neon's WebSocket driver and
 *    cannot reach a plain container. Redirect that one specifier to the
 *    pg-backed shim, which itself reads PG_CONTRACT_URL exclusively (never
 *    POSTGRES_URL) — see vercel-postgres-pg-shim.js.
 * 2. Its first lines (scripts/setup-database.js:25-39) unconditionally read
 *    `<repoRoot>/.env.local` before looking at any env var, with two
 *    failure modes the `fs` mask below covers:
 *      - file MISSING → `process.exit(1)` immediately (`No .env.local file
 *        found`), regardless of what's already in the environment. This is
 *        the harness's own repo root, where no .env.local exists, so
 *        without the mask the child would exit(1) before ever running.
 *      - file PRESENT → every `KEY=value` line is applied with
 *        `process.env[key] = value` **unconditionally** (no `if
 *        (!process.env[k])` guard, unlike apply-migrations.js:43). In a
 *        checkout that does have a .env.local with a real `POSTGRES_URL=`
 *        (e.g. the main checkout at the repo's own root, as opposed to a
 *        worktree — Opus verified `/Users/gallivan/Code/WMKF_Apps/.env.local`
 *        carries one), that line would silently overwrite whatever
 *        POSTGRES_URL/env this process set, before setup-database.js ever
 *        runs a query.
 *    The mask makes `fs.existsSync`/`fs.readFileSync` report an empty file
 *    at that exact path, so neither failure mode is reachable: no exit(1),
 *    and no env var gets overwritten because the "file" has no lines.
 *    Belt-and-suspenders with item 1 above: even if some future edit here
 *    let a real POSTGRES_URL leak into this process's env, the shim would
 *    still ignore it and only ever open PG_CONTRACT_URL.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

const repoRoot = path.join(__dirname, '..', '..', '..');
const envLocalPath = path.join(repoRoot, '.env.local');
const shimPath = path.join(__dirname, 'vercel-postgres-pg-shim.js');

const originalExistsSync = fs.existsSync;
fs.existsSync = function existsSync(target) {
  if (target === envLocalPath) return true;
  return originalExistsSync.call(fs, target);
};

const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function readFileSync(target, ...args) {
  if (target === envLocalPath) return '';
  return originalReadFileSync.call(fs, target, ...args);
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function _resolveFilename(request, ...rest) {
  if (request === '@vercel/postgres') return shimPath;
  return originalResolveFilename.call(this, request, ...rest);
};
