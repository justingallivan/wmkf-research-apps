#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const zlib = require('zlib');
const { performance } = require('perf_hooks');

const BROTLI_QUALITY = 6;
const [, , sourcePath, gzipPath, brotliPath] = process.argv;
if (!sourcePath || !gzipPath || !brotliPath) {
  process.stderr.write('Usage: node compress-probe.js <source> <gzip-output> <brotli-output>\n');
  process.exit(1);
}

const source = fs.readFileSync(sourcePath);

const gzipStartedAt = performance.now();
const gzip = zlib.gzipSync(source);
const gzipFinishedAt = performance.now();
fs.writeFileSync(gzipPath, gzip);

const brotliStartedAt = performance.now();
const brotli = zlib.brotliCompressSync(source, {
  params: { [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
});
const brotliFinishedAt = performance.now();
fs.writeFileSync(brotliPath, brotli);

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

process.stdout.write(`${JSON.stringify({
  jsonBytes: source.length,
  gzipBytes: gzip.length,
  brotliBytes: brotli.length,
  brotliQuality: BROTLI_QUALITY,
  checksums: {
    jsonSha256: sha256(source),
    gzipSha256: sha256(gzip),
    brotliSha256: sha256(brotli),
  },
  gzipMs: gzipFinishedAt - gzipStartedAt,
  brotliMs: brotliFinishedAt - brotliStartedAt,
  maxRssKiB: process.resourceUsage().maxRSS,
})}\n`);
