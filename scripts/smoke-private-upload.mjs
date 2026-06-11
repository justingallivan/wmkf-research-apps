#!/usr/bin/env node
/**
 * Smoke test for the private document-upload store (`wmkf-uploads-private`,
 * `store_WvoDkxrlWniAuJAj`, iad1) and its `UPLOADS_BLOB_RW_TOKEN`.
 *
 * Proves the end-to-end private contract the Phase 1 pilot depends on:
 *   1. PUT a blob with `access: 'private'` using the store token.
 *   2. Read it back server-side via `get(pathname, { access: 'private' })`.
 *   3. Assert the blob's own URL is NOT publicly fetchable (the whole point).
 *   4. Clean up.
 *
 * Run after provisioning, with the token in the environment:
 *   UPLOADS_BLOB_RW_TOKEN=vercel_blob_rw_... node scripts/smoke-private-upload.mjs
 * or pull it from Vercel first:
 *   vercel env pull .env.smoke --environment=preview && \
 *     env $(grep UPLOADS_BLOB_RW_TOKEN .env.smoke | xargs) node scripts/smoke-private-upload.mjs
 *
 * Exit 0 = private upload/read works and the blob is not public. Non-zero = a
 * real failure (bad token, wrong/public store, or the URL is fetchable).
 */

import { put, get, del } from '@vercel/blob';

const token = (process.env.UPLOADS_BLOB_RW_TOKEN || '').trim();
if (!token) {
  console.error('❌ FAIL: UPLOADS_BLOB_RW_TOKEN is not set.');
  process.exit(1);
}

const pathname = `smoke/private-upload-test-${Date.now()}.txt`;
const body = `private blob smoke ${new Date().toISOString()}`;

async function main() {
  // 1. PUT as a private blob.
  const putRes = await put(pathname, body, { access: 'private', token, addRandomSuffix: true });
  console.log('1. PUT ok      →', putRes.pathname);

  try {
    // 2. Read it back with the private get() path the app uses.
    const got = await get(putRes.pathname, { access: 'private', token });
    if (!got) throw new Error('get() returned null for a blob we just wrote');
    const text = await new Response(got.stream).text();
    if (text !== body) throw new Error(`content mismatch: got ${JSON.stringify(text)}`);
    console.log('2. GET ok      → content matches');

    // 3. The blob URL must NOT be publicly fetchable. This is the security
    //    property the whole migration exists for.
    const pub = await fetch(putRes.url);
    if (pub.ok) {
      throw new Error(
        `SECURITY: blob URL is publicly fetchable (HTTP ${pub.status}) — the store is NOT private`,
      );
    }
    console.log(`3. Public URL  → correctly blocked (HTTP ${pub.status})`);
  } finally {
    // 4. Always clean up the test blob.
    await del(putRes.url, { token });
    console.log('4. Cleanup ok  → test blob deleted');
  }

  console.log('\n✅ PASS — private upload/read works and the blob is not public.');
}

main().catch((e) => {
  console.error('\n❌ FAIL:', e.message);
  process.exit(1);
});
