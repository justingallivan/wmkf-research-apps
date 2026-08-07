#!/usr/bin/env node

'use strict';

const fs = require('fs');
const zlib = require('zlib');
const { performance } = require('perf_hooks');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const [, , encoding, filePath] = process.argv;
if (!['json', 'gzip', 'brotli'].includes(encoding) || !filePath) {
  fail('Usage: node load-probe.js <json|gzip|brotli> <path>');
}

const baseline = process.memoryUsage();
const readStartedAt = performance.now();
let encoded = fs.readFileSync(filePath);
const readFinishedAt = performance.now();

let decoded;
const decodeStartedAt = performance.now();
if (encoding === 'gzip') {
  decoded = zlib.gunzipSync(encoded);
} else if (encoding === 'brotli') {
  decoded = zlib.brotliDecompressSync(encoded);
} else {
  decoded = encoded;
}
const decodeFinishedAt = performance.now();

const parseStartedAt = performance.now();
const value = JSON.parse(decoded.toString('utf8'));
const parseFinishedAt = performance.now();
const immediatePostParse = process.memoryUsage();
const recordCount = Array.isArray(value) ? value.length : value.records?.length;
const encodedBytes = encoded.length;
const decodedBytes = decoded.length;

encoded = null;
decoded = null;
if (global.gc) {
  global.gc();
  global.gc();
}
const parsedOnly = process.memoryUsage();

const retainedRecordCount = Array.isArray(value) ? value.length : value.records?.length;
if (retainedRecordCount !== recordCount) fail('Parsed value was not retained through measurement');

process.stdout.write(`${JSON.stringify({
  encoding,
  encodedBytes,
  decodedBytes,
  recordCount,
  readMs: readFinishedAt - readStartedAt,
  decodeMs: decodeFinishedAt - decodeStartedAt,
  parseMs: parseFinishedAt - parseStartedAt,
  totalMs: parseFinishedAt - readStartedAt,
  immediatePostParseRssDeltaBytes: immediatePostParse.rss - baseline.rss,
  immediatePostParseHeapUsedDeltaBytes: immediatePostParse.heapUsed - baseline.heapUsed,
  immediatePostParseRssBytes: immediatePostParse.rss,
  immediatePostParseHeapUsedBytes: immediatePostParse.heapUsed,
  immediatePostParseExternalBytes: immediatePostParse.external,
  immediatePostParseArrayBuffersBytes: immediatePostParse.arrayBuffers,
  parsedOnlyRssDeltaBytes: parsedOnly.rss - baseline.rss,
  parsedOnlyHeapUsedDeltaBytes: parsedOnly.heapUsed - baseline.heapUsed,
  parsedOnlyRssBytes: parsedOnly.rss,
  parsedOnlyHeapUsedBytes: parsedOnly.heapUsed,
  parsedOnlyExternalBytes: parsedOnly.external,
  parsedOnlyArrayBuffersBytes: parsedOnly.arrayBuffers,
  maxRssKiB: process.resourceUsage().maxRSS,
})}\n`);
