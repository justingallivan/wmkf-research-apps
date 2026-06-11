#!/usr/bin/env node
/**
 * Smoke test for the Phase 1 private-blob READ CHOKEPOINT that
 * `phase-i-dynamics` and `grant-reporting` both depend on:
 *   `lib/utils/file-loader.js` → `lib/utils/uploaded-blob.js`
 *   (`readUploadedBlobBuffer`) → `@vercel/blob` `get(pathname,{access:'private'})`.
 *
 * The generic `scripts/smoke-private-upload.mjs` proves the raw SDK private
 * put/get/403 contract for the `wmkf-uploads-private` store. This script goes
 * one layer deeper: it round-trips a real DOCX through the ACTUAL application
 * code path (`loadFile`) and asserts the document's text extracts correctly,
 * which is the new, shared behavior neither the mocked unit/integration tests
 * nor the raw-SDK smoke exercise. Passing here means a private upload from
 * either app's `FileUploaderSimple` would be read + extracted server-side.
 *
 * What it does:
 *   1. Generate a small DOCX in-memory (with a unique marker string).
 *   2. PUT it to the private store as `access:'private'` (mirrors what the
 *      client `upload({access:'private'})` flow lands in the store).
 *   3. Read it back through `loadFile({source:'upload', access:'private',
 *      pathname, filename})` — the exact chokepoint both apps call — and assert
 *      the extracted text contains the marker.
 *   4. Assert the blob's own URL is NOT publicly fetchable (HTTP 4xx).
 *   5. Clean up.
 *
 * Run after provisioning, passing the SENSITIVE token directly (it pulls back
 * EMPTY from `vercel env pull` — see memory project-vercel-sensitive-env-pull-empty):
 *   UPLOADS_BLOB_RW_TOKEN=vercel_blob_rw_... node scripts/smoke-private-file-loader.mjs
 *
 * `loadFile` reads the token from `process.env.UPLOADS_BLOB_RW_TOKEN`, so the
 * inline env assignment above is required (not just a CLI arg to `put`).
 *
 * Exit 0 = a private blob is read + text-extracted via the real app chokepoint
 * and is not publicly fetchable. Non-zero = a real failure.
 */

import { put, del } from '@vercel/blob';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { loadFile } from '../lib/utils/file-loader.js';

const token = (process.env.UPLOADS_BLOB_RW_TOKEN || '').trim();
if (!token) {
  console.error('❌ FAIL: UPLOADS_BLOB_RW_TOKEN is not set (it is SENSITIVE — paste the value from the store dashboard).');
  process.exit(1);
}
// Guard against a placeholder/truncated paste BEFORE any network call: the SDK
// puts the token into an HTTP header, and a non-ASCII char (e.g. the "…"
// ellipsis from a copied example or an elided dashboard display, U+2026) blows
// up deep in undici with an opaque "Cannot convert argument to a ByteString"
// error. Real tokens are ASCII and start with `vercel_blob_rw_`.
const badChar = [...token].find((c) => c.charCodeAt(0) > 127);
if (badChar) {
  console.error(
    `❌ FAIL: UPLOADS_BLOB_RW_TOKEN contains a non-ASCII character (${JSON.stringify(badChar)}, U+${badChar.charCodeAt(0).toString(16).toUpperCase()}).`,
  );
  console.error('   This is almost always a copied placeholder ("…") or a truncated/elided value. Paste the FULL real token.');
  process.exit(1);
}
if (!token.startsWith('vercel_blob_rw_')) {
  console.error('❌ FAIL: UPLOADS_BLOB_RW_TOKEN does not start with "vercel_blob_rw_" — it looks wrong. Paste the full store token.');
  process.exit(1);
}

const marker = `WMKF-PRIVATE-SMOKE-${Date.now()}`;

async function buildDocx() {
  const para = (t) => new Paragraph({ children: [new TextRun(t)] });
  const doc = new Document({
    sections: [
      {
        children: [
          para(`Smoke marker: ${marker}`),
          para('Synthetic grant proposal document generated for the private-blob file-loader smoke test.'),
          para('It carries well over one hundred characters of extractable text so loadFile() clears its minimum-length guard.'),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

async function main() {
  const buf = await buildDocx();
  const pathname = `smoke/private-file-loader-${Date.now()}.docx`;

  // 1. PUT as a private blob (what the client upload({access:'private'}) lands).
  const putRes = await put(pathname, buf, { access: 'private', token, addRandomSuffix: true });
  console.log('1. PUT private    →', putRes.pathname);

  try {
    // 2. Read + extract through the REAL app chokepoint both apps call.
    const ref = {
      source: 'upload',
      access: 'private',
      pathname: putRes.pathname,
      filename: 'smoke.docx',
    };
    const loaded = await loadFile(ref);
    if (!loaded.text.includes(marker)) {
      throw new Error(`loadFile() text is missing the marker — extraction or read is wrong. Got: ${JSON.stringify(loaded.text.slice(0, 120))}`);
    }
    console.log(`2. loadFile() ok  → extracted ${loaded.text.length} chars, marker present`);

    // 3. The blob URL must NOT be publicly fetchable.
    const pub = await fetch(putRes.url);
    if (pub.ok) {
      throw new Error(`SECURITY: blob URL is publicly fetchable (HTTP ${pub.status}) — the store is NOT private`);
    }
    console.log(`3. Public URL     → correctly blocked (HTTP ${pub.status})`);
  } finally {
    // 4. Always clean up.
    await del(putRes.url, { token });
    console.log('4. Cleanup ok     → test blob deleted');
  }

  console.log('\n✅ PASS — a private upload is read + text-extracted via the real file-loader chokepoint, and is not public.');
  console.log('   This covers the shared read path for BOTH phase-i-dynamics and grant-reporting.');
}

main().catch((e) => {
  console.error('\n❌ FAIL:', e.message);
  process.exit(1);
});
