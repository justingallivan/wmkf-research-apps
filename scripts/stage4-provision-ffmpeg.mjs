#!/usr/bin/env node
/**
 * One-time, owner-run: copy the pinned FFmpeg build into the private uploads Blob store for the Stage 4 worker
 * (docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md, decision B4). Downloads the exact BtbN release asset, verifies the
 * SHA-256 the worker pins (FFMPEG_TARBALL_SHA256), and only with --execute uploads it privately, without overwrite.
 * Prints the pathname to set as PRESENTATION_VIDEO_FFMPEG_BLOB_PATHNAME. Never prints the token.
 *
 * Usage (from the checkout whose .env.local holds UPLOADS_BLOB_RW_TOKEN):
 *   node scripts/stage4-provision-ffmpeg.mjs            # dry run: download + verify only
 *   node scripts/stage4-provision-ffmpeg.mjs --execute  # also upload to private Blob
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { put } from '@vercel/blob';

// Must equal FFMPEG_TARBALL_SHA256 in presentation-video-split-worker.js (pinned by tests/unit/stage4-provision-ffmpeg.test.js).
export const FFMPEG_TARBALL_SHA256 = '14020417ff8ef01470e8cb771355e65c37aff62b80fb0be41eeb7611d1360902';
const URL_ = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-08-13-05/'
  + 'ffmpeg-n9.0.2-23-g27b46f0fbc-linux64-gpl-9.0.tar.xz';
const PATHNAME = 'stage4/ffmpeg-n9.0.2-23-g27b46f0fbc-linux64-gpl-9.0.tar.xz';
const execute = process.argv.includes('--execute');

if (!process.env.UPLOADS_BLOB_RW_TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^UPLOADS_BLOB_RW_TOKEN=(.*)$/);
    if (m) process.env.UPLOADS_BLOB_RW_TOKEN = m[1].replace(/^"|"$/g, '');
  }
}

const response = await fetch(URL_);
if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
console.log(`Downloaded ${bytes.length} bytes; sha256 ${sha}`);
if (sha !== FFMPEG_TARBALL_SHA256) {
  console.error('SHA-256 does not match the pinned value. Nothing uploaded.');
  process.exit(1);
}
console.log('SHA-256 matches the pinned value.');
if (!execute) {
  console.log(`Dry run. With --execute this uploads privately to: ${PATHNAME}`);
  process.exit(0);
}
const token = process.env.UPLOADS_BLOB_RW_TOKEN;
if (!token) {
  console.error('UPLOADS_BLOB_RW_TOKEN is not set. Nothing uploaded.');
  process.exit(1);
}
const result = await put(PATHNAME, bytes, {
  access: 'private', token, contentType: 'application/x-xz', addRandomSuffix: false, allowOverwrite: false,
});
console.log(`Uploaded. Set PRESENTATION_VIDEO_FFMPEG_BLOB_PATHNAME=${result.pathname} in Vercel Production.`);
