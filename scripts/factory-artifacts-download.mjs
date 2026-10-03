#!/usr/bin/env node

/**
 * Owner-run fallback: download one Test Request Factory run's stored manifest
 * and bundle from the private Factory Blob store, for the CLI's --advance
 * (which needs both files) when the admin form's artifacts route is
 * unavailable, e.g. after a full deployment rollback.
 *
 *   node --env-file=/absolute/.env.local scripts/factory-artifacts-download.mjs \
 *     --run=<runId> --out=/absolute/new/dir --target=production|sandbox
 *
 * FACTORY_BLOB_RW_TOKEN comes from the loaded env and is never printed. Files
 * are written create-only (mode 0600) as manifest.json and bundle.json under
 * --out; stdout carries only pathnames, sizes and sha256 prefixes, never
 * source text. A bundle holds source text: keep --out outside the repository.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArgs(argv) {
  const parsed = { run: null, out: null, target: null };
  for (const arg of argv) {
    if (arg.startsWith('--run=')) parsed.run = arg.slice('--run='.length);
    else if (arg.startsWith('--out=')) parsed.out = arg.slice('--out='.length);
    else if (arg.startsWith('--target=')) parsed.target = arg.slice('--target='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!GUID.test(parsed.run || '')) throw new Error('--run must be a run GUID.');
  if (parsed.target !== 'production' && parsed.target !== 'sandbox') throw new Error('--target must be production or sandbox.');
  if (!parsed.out || !path.isAbsolute(parsed.out)) throw new Error('--out must be an absolute directory path.');
  return { ...parsed, run: parsed.run.toLowerCase() };
}

async function readBytes(get, pathname, token) {
  const result = await get(pathname, { access: 'private', token, useCache: false });
  if (!result?.stream) throw new Error(`Not found: ${pathname}`);
  const reader = result.stream.getReader();
  const chunks = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(Buffer.from(next.value));
  }
  return Buffer.concat(chunks);
}

export async function downloadArtifacts({ run, target, out }, { env = process.env, get = null } = {}) {
  const token = env.FACTORY_BLOB_RW_TOKEN;
  if (!token) throw new Error('FACTORY_BLOB_RW_TOKEN is not set in the loaded env.');
  const blobGet = get ?? (await import('@vercel/blob')).get;
  fs.mkdirSync(out, { recursive: true });
  const written = [];
  for (const file of ['manifest', 'bundle']) {
    const pathname = `${target}/runs/${run}/${file}.json`; // minted here from validated parts only
    const bytes = await readBytes(blobGet, pathname, token);
    const destination = path.join(out, `${file}.json`);
    fs.writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 });
    written.push({
      pathname, written: destination, size: bytes.length, sha256Prefix: crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12),
    });
  }
  return written;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(JSON.stringify(await downloadArtifacts(args), null, 2));
}

// Guarded so a test can import parseArgs/downloadArtifacts without a live run.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[factory-artifacts-download] ${error.message}`);
    process.exit(1);
  });
}
