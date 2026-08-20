#!/usr/bin/env node

/**
 * Destructive-but-self-cleaning security preflight for portal upload staging.
 *
 * Proves whether a client token minted from UPLOADS_BLOB_RW_TOKEN can override
 * the intended private access mode. A successful public-mode PUT is a hard
 * failure: portal staging must not use this token mechanism if an untrusted
 * browser can create an anonymously readable object.
 *
 * The probe writes two tiny random objects under an isolated security-smoke
 * namespace and deletes every successfully created object in finally blocks.
 * It never prints credentials or signed client tokens.
 */

import crypto from 'node:crypto';
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

const payload = crypto.randomBytes(32);
const prefix = `security-smoke/portal-staging/${crypto.randomUUID()}`;

async function mint(pathname) {
  return generateClientTokenFromReadWriteToken({
    pathname,
    token: rwToken,
    maximumSizeInBytes: payload.length,
    allowedContentTypes: ['application/octet-stream'],
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
  const pathname = `${prefix}-public.bin`;
  let created = false;
  try {
    const token = await mint(pathname);
    const blob = await put(pathname, payload, {
      access: 'public',
      token,
      contentType: 'application/octet-stream',
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
  const pathname = `${prefix}-private.bin`;
  let created = false;
  try {
    const token = await mint(pathname);
    const blob = await put(pathname, payload, {
      access: 'private',
      token,
      contentType: 'application/octet-stream',
    });
    created = true;
    const response = await fetch(blob.url, { method: 'HEAD', cache: 'no-store' });
    if (response.status !== 403) {
      throw new Error(
        `SECURITY FAILURE: private object anonymous HEAD returned ${response.status}, expected 403.`,
      );
    }
    console.log('PASS: private-mode PUT succeeded and anonymous HEAD returned 403.');
  } finally {
    if (created) await remove(pathname);
  }
}

await publicOverrideProbe();
await privateUploadProbe();

if (!process.exitCode) {
  console.log('PASS: portal staging private-access prerequisite is satisfied.');
}
