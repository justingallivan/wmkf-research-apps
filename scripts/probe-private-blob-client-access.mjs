#!/usr/bin/env node

/**
 * Destructive-but-self-cleaning security preflight for portal upload staging.
 *
 * Proves whether a client token minted from UPLOADS_BLOB_RW_TOKEN can override
 * the intended private access mode. A successful public-mode PUT is a hard
 * failure: portal staging must not use this token mechanism if an untrusted
 * browser can create an anonymously readable object.
 *
 * The probe writes two disposable objects under an isolated security-smoke
 * namespace and deletes every successfully created object in finally blocks.
 * Pass `--file <path>` to exercise the exact payload used by a release smoke;
 * otherwise it uses 32 random bytes. It never prints credentials or signed
 * client tokens.
 */

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import nextEnv from '@next/env';
import { del } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken, put } from '@vercel/blob/client';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const rwToken = process.env.UPLOADS_BLOB_RW_TOKEN;
if (!rwToken) {
  console.error('UPLOADS_BLOB_RW_TOKEN is not configured.');
  process.exit(2);
}

const fileFlag = process.argv.indexOf('--file');
if (fileFlag >= 0 && !process.argv[fileFlag + 1]) {
  console.error('Usage: node scripts/probe-private-blob-client-access.mjs [--file <path>]');
  process.exit(2);
}

const filePath = fileFlag >= 0 ? path.resolve(process.argv[fileFlag + 1]) : null;
const payload = filePath ? readFileSync(filePath) : crypto.randomBytes(32);
const contentType = filePath && path.extname(filePath).toLowerCase() === '.png'
  ? 'image/png'
  : 'application/octet-stream';
const extension = contentType === 'image/png' ? 'png' : 'bin';
const prefix = `security-smoke/portal-staging/${crypto.randomUUID()}`;

async function mint(pathname) {
  return generateClientTokenFromReadWriteToken({
    pathname,
    token: rwToken,
    maximumSizeInBytes: payload.length,
    allowedContentTypes: [contentType],
    validUntil: Date.now() + 5 * 60 * 1000,
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 60,
  });
}

async function remove(pathname) {
  try {
    await del(pathname, { token: rwToken });
  } catch (error) {
    console.error(`Cleanup failed for ${pathname}: ${error?.message || error}`);
    process.exitCode = 1;
  }
}

async function publicOverrideProbe() {
  const pathname = `${prefix}-public.${extension}`;
  let created = false;
  try {
    const token = await mint(pathname);
    const blob = await put(pathname, payload, {
      access: 'public',
      token,
      contentType,
    });
    created = true;
    const response = await fetch(blob.url, { method: 'HEAD', cache: 'no-store' });
    throw new Error(
      `SECURITY FAILURE: public-mode PUT succeeded (anonymous HEAD ${response.status}).`,
    );
  } catch (error) {
    if (created) throw error;
    console.log('PASS: private-store client token rejected a public-mode PUT.');
  } finally {
    if (created) await remove(pathname);
  }
}

async function privateUploadProbe() {
  const pathname = `${prefix}-private.${extension}`;
  let created = false;
  try {
    const token = await mint(pathname);
    const blob = await put(pathname, payload, {
      access: 'private',
      token,
      contentType,
    });
    created = true;
    const response = await fetch(blob.url, {
      method: 'HEAD',
      redirect: 'manual',
      cache: 'no-store',
    });
    if (![401, 403].includes(response.status)) {
      throw new Error(
        `SECURITY FAILURE: private object anonymous HEAD returned ${response.status}, expected 401 or 403.`,
      );
    }
    console.log(`PASS: private-mode PUT succeeded and direct anonymous HEAD returned ${response.status}.`);
  } finally {
    if (created) await remove(pathname);
  }
}

await publicOverrideProbe();
await privateUploadProbe();

if (!process.exitCode) {
  const digest = crypto.createHash('sha256').update(payload).digest('hex');
  console.log(`Payload verified: ${payload.length} bytes, SHA-256 ${digest}.`);
  console.log('PASS: portal staging private-access prerequisite is satisfied.');
}
