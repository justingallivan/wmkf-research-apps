#!/usr/bin/env node
/**
 * Local-only Node 22 memory benchmark for the site-visit materials finalize
 * byte path. It calls the production staging loader, validator, scanner, and
 * Graph large-upload helper while replacing only Blob/Postgres/network edges.
 * Large fixtures are generated in a separate child process and live in os.tmpdir.
 *
 * Usage:
 *   /tmp/package/bin/node --import ./scripts/lib/use-extensionless.mjs \
 *     ./scripts/benchmark-materials-upload-memory.mjs [--size-mib 499]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const BASELINE = '6d5618af65298b884ad3056b59b9be4016a4662d';
const SCRIPT = fileURLToPath(import.meta.url);
const NODE_MAJOR = Number(process.versions.node.split('.')[0]);

function fail(message) {
  console.error(`benchmark error: ${message}`);
  process.exit(2);
}

function runChild(args, label) {
  const result = spawnSync(process.execPath, [
    '--no-warnings', '--import', path.join(REPO, 'scripts/lib/use-extensionless.mjs'), SCRIPT, ...args,
  ], {
    cwd: REPO,
    stdio: 'inherit',
    env: {
      PATH: process.env.PATH || '',
      TMPDIR: process.env.TMPDIR || os.tmpdir(),
      TMP: process.env.TMP || os.tmpdir(),
      TEMP: process.env.TEMP || os.tmpdir(),
      LANG: process.env.LANG || 'C',
    },
  });
  if (result.error) fail(`${label}: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} exited ${result.status ?? result.signal}`);
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

function parseSizeMiB(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 499) {
    fail('--size-mib must be a whole number from 1 to 499');
  }
  return number * 1024 * 1024;
}

if (process.argv.includes('--fixture-child')) {
  await writeFixture(process.argv[process.argv.indexOf('--fixture-child') + 1], Number(process.argv[process.argv.indexOf('--fixture-child') + 2]));
} else if (process.argv.includes('--scenario-child')) {
  await runScenario(
    process.argv[process.argv.indexOf('--scenario-child') + 1],
    process.argv[process.argv.indexOf('--scenario-child') + 2],
    process.argv[process.argv.indexOf('--scenario-child') + 3],
  );
} else {
  if (NODE_MAJOR !== 22) fail(`requires Node 22.x; found ${process.version}`);
  console.log(`runtime: ${process.version} (${process.platform}/${process.arch})`);
  console.log(`baseline source: ${BASELINE}`);
  const bytes = parseSizeMiB(argValue('--size-mib', '499'));
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'materials-memory-bench-'));
  const fixture = path.join(scratch, `synthetic-valid-pptx-${bytes}.pptx`);
  const smallFixture = path.join(scratch, 'synthetic-valid-pptx-8mib.pptx');
  try {
    runChild(['--fixture-child', fixture, String(bytes)], 'fixture generation');
    runChild(['--fixture-child', smallFixture, String(Math.min(bytes, 8 * 1024 * 1024))], 'small fixture generation');
    const sizeLabel = `${(bytes / 1024 / 1024).toFixed(0)} MiB`;
    console.log(`fixture: ${sizeLabel} ZIP/PPTX-shaped package at ${fixture} (temporary)`);
    const scenarios = [
      ['optimized-known-single', 'optimized', 'known'],
      ['optimized-unknown-small', 'optimized', 'unknown-small'],
      ['optimized-timeout-retry', 'optimized', 'retry'],
      ['baseline-known-single', 'baseline', 'known'],
      ['baseline-timeout-retry', 'baseline', 'retry'],
      ['baseline-two-concurrent', 'baseline', 'concurrent'],
      ['optimized-two-concurrent', 'optimized', 'concurrent'],
    ];
    for (const [label, mode, shape] of scenarios) {
      console.log(`\n=== ${label} ===`);
      runChild(['--scenario-child', mode, shape, shape === 'unknown-small' ? smallFixture : fixture], label);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function writeFixture(filename, payloadBytes) {
  const { open } = await import('node:fs/promises');
  const handle = await open(filename, 'w');
  const entries = [];
  let offset = 0;
  const payloadName = 'ppt/media/benchmark-padding.bin';
  const payloadNameBytes = Buffer.from(payloadName);
  const padding = Buffer.allocUnsafe(1024 * 1024);
  for (let index = 0; index < padding.length; index += 1) padding[index] = (index * 31 + 17) & 0xff;
  const crcTable = makeCrcTable();
  try {
    for (const [name, data] of [
      ['[Content_Types].xml', Buffer.from('<Types/>')],
      ['ppt/presentation.xml', Buffer.from('<presentation/>')],
    ]) {
      const nameBytes = Buffer.from(name);
      const entry = makeZipEntry(nameBytes, data, data.length, crc32(data, crcTable), offset);
      entries.push(entry.central);
      await handle.write(entry.local);
      await handle.write(data);
      offset += entry.local.length + data.length;
    }

    const payloadCrc = crc32Stream(payloadBytes, padding, crcTable);
    const localHeader = zipLocalHeader(payloadNameBytes, payloadBytes, payloadCrc);
    const payloadOffset = offset;
    await handle.write(localHeader);
    offset += localHeader.length;
    let remaining = payloadBytes;
    while (remaining > 0) {
      const take = Math.min(remaining, padding.length);
      const view = take === padding.length ? padding : padding.subarray(0, take);
      await handle.write(view);
      remaining -= take;
      offset += take;
    }
    entries.push(zipCentralEntry(payloadNameBytes, payloadBytes, payloadCrc, payloadOffset));

    const centralOffset = offset;
    for (const entry of entries) {
      await handle.write(entry);
      offset += entry.length;
    }
    const centralSize = offset - centralOffset;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(centralOffset, 16);
    eocd.writeUInt16LE(0, 20);
    await handle.write(eocd);
    await handle.sync();
    console.log(JSON.stringify({ fixtureBytes: offset + eocd.length }));
  } finally {
    await handle.close();
  }
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(buffer, table, seed = 0xffffffff) {
  let crc = seed;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function crc32Stream(length, block, table) {
  let crc = 0xffffffff;
  const view = block.subarray(0, Math.min(length, block.length));
  let remaining = length;
  while (remaining > 0) {
    const take = Math.min(remaining, view.length);
    const part = take === view.length ? view : view.subarray(0, take);
    for (const byte of part) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    remaining -= take;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipLocalHeader(name, data, checksum) {
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(data, 18);
  header.writeUInt32LE(data, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  name.copy(header, 30);
  return header;
}

function zipCentralEntry(name, dataBytes, checksum, localOffset) {
  const header = Buffer.alloc(46 + name.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(dataBytes, 20);
  header.writeUInt32LE(dataBytes, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(localOffset, 42);
  name.copy(header, 46);
  return header;
}

function makeZipEntry(name, data, dataBytes, checksum, localOffset) {
  return {
    local: zipLocalHeader(name, dataBytes, checksum),
    central: zipCentralEntry(name, dataBytes, checksum, localOffset),
  };
}

async function runScenario(mode, shape, fixturePath) {
  if (NODE_MAJOR !== 22) fail(`child requires Node 22.x; found ${process.version}`);
  if (!['optimized', 'baseline'].includes(mode)) fail(`unknown mode ${mode}`);
  if (!['known', 'unknown-small', 'retry', 'concurrent'].includes(shape)) fail(`unknown shape ${shape}`);
  const { stat } = await import('node:fs/promises');
  const { createReadStream } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const { registerHooks } = await import('node:module');
  const fixtureStat = await stat(fixturePath);
  const expectedHash = await hashFile(fixturePath, createReadStream, createHash);
  const moduleStubs = mkdtempSync(path.join(os.tmpdir(), 'materials-memory-modules-'));
  const postgresStub = path.join(moduleStubs, 'vercel-postgres.cjs');
  const blobStub = path.join(moduleStubs, 'vercel-blob.cjs');
  const blobClientStub = path.join(moduleStubs, 'vercel-blob-client.cjs');
  const postgresEsmStub = path.join(moduleStubs, 'vercel-postgres.mjs');
  const blobEsmStub = path.join(moduleStubs, 'vercel-blob.mjs');
  const blobClientEsmStub = path.join(moduleStubs, 'vercel-blob-client.mjs');
  writeFileSync(postgresStub, "exports.sql = async function () { return { rows: [{ id: 'bench-staging-row' }] }; };\n");
  writeFileSync(blobStub, `
    const fs = require('node:fs'); const { Readable } = require('node:stream');
    exports.get = async function (pathname) {
      const c = globalThis.__materialsBenchmark;
      const stream = Readable.toWeb(fs.createReadStream(c.fixturePath, { highWaterMark: c.streamHighWaterMark }));
      return { statusCode: 200, stream, headers: { has: (name) => name === 'content-length' ? c.lengthKnown : false, get: () => null },
        blob: { pathname, contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          size: c.lengthKnown ? c.fixtureBytes : 0, url: 'http://blob-object.invalid/private', etag: 'benchmark-etag' } };
    };
    exports.del = async function () { return {}; };
  `);
  writeFileSync(blobClientStub, "exports.generateClientTokenFromReadWriteToken = async function () { return 'local-benchmark-token'; };\n");
  writeFileSync(postgresEsmStub, "export const sql = async function () { return { rows: [{ id: 'bench-staging-row' }] }; };\n");
  writeFileSync(blobEsmStub, `
    import fs from 'node:fs'; import { Readable } from 'node:stream';
    export async function get(pathname) {
      const c = globalThis.__materialsBenchmark;
      const stream = Readable.toWeb(fs.createReadStream(c.fixturePath, { highWaterMark: c.streamHighWaterMark }));
      return { statusCode: 200, stream, headers: { has: (name) => name === 'content-length' ? c.lengthKnown : false, get: () => null },
        blob: { pathname, contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          size: c.lengthKnown ? c.fixtureBytes : 0, url: 'http://blob-object.invalid/private', etag: 'benchmark-etag' } };
    }
    export async function del() { return {}; }
  `);
  writeFileSync(blobClientEsmStub, "export async function generateClientTokenFromReadWriteToken() { return 'local-benchmark-token'; }\n");
  globalThis.__materialsBenchmark = {
    fixturePath,
    fixtureBytes: fixtureStat.size,
    lengthKnown: shape !== 'unknown-small',
    streamHighWaterMark: 1024 * 1024,
    databaseUpdates: 0,
  };

  registerHooks({
    resolve(specifier, context, nextResolve) {
      const requireMode = context.conditions?.includes('require');
      if (specifier === '@vercel/postgres') return { url: pathToFileURL(requireMode ? postgresStub : postgresEsmStub).href, format: requireMode ? 'commonjs' : 'module', shortCircuit: true };
      if (specifier === '@vercel/blob') return { url: pathToFileURL(requireMode ? blobStub : blobEsmStub).href, format: requireMode ? 'commonjs' : 'module', shortCircuit: true };
      if (specifier === '@vercel/blob/client') return { url: pathToFileURL(requireMode ? blobClientStub : blobClientEsmStub).href, format: requireMode ? 'commonjs' : 'module', shortCircuit: true };
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (mode === 'baseline' && url.endsWith('/lib/services/portal-upload-staging.js')) {
        return { format: 'module', source: gitShow(`${BASELINE}:lib/services/portal-upload-staging.js`), shortCircuit: true };
      }
      if (mode === 'baseline' && url.endsWith('/lib/services/cloudmersive-scan.js')) {
        return { format: 'module', source: gitShow(`${BASELINE}:lib/services/cloudmersive-scan.js`), shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });

  const localServer = await startSinkServer({ createHash, expectedSize: fixtureStat.size, expectedHash });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.hostname === 'blob-object.invalid') return new Response(null, { status: 403 });
    if (url.hostname === 'api.cloudmersive.com') {
      return originalFetch(`http://127.0.0.1:${localServer.port}/scan`, init);
    }
    if (url.hostname === 'graph.microsoft.com') {
      if (url.pathname.endsWith('/createUploadSession')) {
        const sessionId = localServer.newGraphSession();
        return jsonResponse({ uploadUrl: `http://127.0.0.1:${localServer.port}/graph-upload/${sessionId}` }, 200);
      }
      if (url.pathname.includes('/items/')) {
        return jsonResponse({ id: 'benchmark-item', size: fixtureStat.size, name: 'benchmark.pptx',
          webUrl: 'http://local.invalid/item', eTag: 'bench-etag', lastModifiedDateTime: new Date(0).toISOString() }, 200);
      }
    }
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return originalFetch(input, init);
    throw new Error(`blocked non-local fetch target: ${url.origin}${url.pathname}`);
  };
  process.env.UPLOADS_BLOB_RW_TOKEN = 'local-only-fake-staging-token';
  process.env.CLOUDMERSIVE_API_KEY = 'local-only-fake-scanner-key';

  const originalSetTimeout = globalThis.setTimeout;
  const originalInfo = console.info;
  const originalLog = console.log;
  console.info = (...args) => {
    if (String(args[0] || '').includes('workbench.dependency')) return;
    originalInfo(...args);
  };
  console.log = (...args) => {
    if (String(args[0] || '').startsWith('{"event":"workbench.dependency"')) return;
    originalLog(...args);
  };
  if (shape === 'retry') {
    // Keep the retry mechanism real while compressing the production 90s
    // timeout to 5s. This leaves enough time to stream the full local fixture.
    globalThis.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, delay === 90_000 ? 5_000 : delay, ...args);
    localServer.retryFirstScan = true;
  }

  const { loadClaimedPortalDocument } = await import('../lib/services/portal-upload-staging.js');
  const { validateSiteVisitMaterial } = await import('../lib/utils/site-visit-material-file.js');
  const { scanBytes } = await import('../lib/services/cloudmersive-scan.js');
  const { GraphService } = await import('../lib/services/graph-service.js');
  const { acquireLargeUploadAdmission, releaseLargeUploadAdmission } = await import('../lib/services/large-upload-admission.js');
  const row = {
    id: 'bench-staging-row', pathname: 'portal-staging/site_visit_material/bench/id',
    declared_content_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    max_bytes: Math.max(fixtureStat.size, 500 * 1024 * 1024), filename: 'benchmark.pptx',
  };
  const samples = {};
  const rssNormalizer = 1024;
  const stage = async (name, operation) => {
    const before = process.memoryUsage.rss();
    let sampledPeak = before;
    const interval = setInterval(() => { sampledPeak = Math.max(sampledPeak, process.memoryUsage.rss()); }, 20);
    const started = performance.now();
    try {
      const value = await operation();
      sampledPeak = Math.max(sampledPeak, process.memoryUsage.rss());
      samples[name] = {
        elapsedMs: Math.round(performance.now() - started),
        startRssMiB: mib(before),
        sampledPeakRssMiB: mib(sampledPeak),
        processMaxRssMiB: Math.round((process.resourceUsage().maxRSS / rssNormalizer) * 10) / 10,
        externalMiB: mib(process.memoryUsage().external),
        arrayBuffersMiB: mib(process.memoryUsage().arrayBuffers),
      };
      return value;
    } finally {
      clearInterval(interval);
    }
  };

  try {
    if (shape === 'concurrent') {
      await stage('two_concurrent_pipelines', async () => {
        const results = mode === 'optimized'
          ? await Promise.all([runAdmitted('a'), runAdmitted('b')])
          : await Promise.all([runPipeline('a'), runPipeline('b')]);
        if (results.some((r) => !r.uploaded)) throw new Error('concurrent pipeline failed');
        return results;
      });
    } else {
      if (mode === 'optimized') await runAdmitted('single');
      else await runPipeline('single');
    }
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    console.info = originalInfo;
    console.log = originalLog;
    await new Promise((resolve) => localServer.server.close(resolve));
    rmSync(moduleStubs, { recursive: true, force: true });
  }
  for (const request of localServer.stats.scannerRequests) {
    if (request.parseError || request.contentLength !== request.bodyBytes
      || request.transferEncoding !== null || request.fileBytes !== fixtureStat.size
      || request.fileHashMatchesFixture !== true) {
      throw new Error('scanner multipart wire framing did not match Content-Length');
    }
  }
  if (shape === 'retry' && localServer.stats.scannerRequests.length !== 2) {
    throw new Error('timeout-retry case did not emit exactly two complete scanner requests');
  }
  for (const graphSession of localServer.stats.graphSessions) {
    if (!graphSession.uploadRangesValid || !graphSession.hashMatchesFixture) {
      throw new Error('Graph upload bytes or ranges did not match the fixture');
    }
  }
  console.log(JSON.stringify({ mode, shape, fixtureBytes: fixtureStat.size, samples, sinks: localServer.stats }, null, 2));

  async function runPipeline(id) {
    let file = await stage(`loader_${id}`, () => loadClaimedPortalDocument({ row: { ...row, id: `bench-${id}` }, leaseToken: `lease-${id}` }));
    await stage(`validator_${id}`, async () => {
      const validation = validateSiteVisitMaterial(file.filename, file.buffer, 'presentation_source');
      if (!validation.ok) throw new Error(`PPTX validation failed: ${validation.reason}`);
      if (file.sha256 !== expectedHash) throw new Error('loader digest does not match streamed fixture digest');
    });
    await stage(`scanner_${id}`, async () => {
      localServer.expectedFilename = file.filename;
      const scan = await scanBytes(file.buffer, file.filename, { timeoutMs: 90_000, maxAttempts: shape === 'retry' ? 2 : 1 });
      if (scan.scan_result !== 'clean') throw new Error('local scanner sink did not return clean');
    });
    if (shape === 'unknown-small') {
      const edgeFilename = 'quoted"\r\n-💠.pptx';
      await stage('scanner_filename_edge_protocol', async () => {
        localServer.expectedFilename = edgeFilename;
        const scan = await scanBytes(file.buffer, edgeFilename, { timeoutMs: 90_000, maxAttempts: 1 });
        if (scan.scan_result !== 'clean') throw new Error('filename protocol scan failed');
      });
      localServer.expectedFilename = file.filename;
    }
    const svc = {
      async getSiteId() { return 'benchmark-site'; },
      async getDriveId() { return 'benchmark-drive'; },
      async getAccessToken() { return 'local-only-fake-graph-token'; },
      buildHeaders() { return { Authorization: 'Bearer local-only-fake-graph-token' }; },
      async uploadFile(_library, _folder, name, content) { return { id: 'benchmark-small-item', size: content.length, name }; },
    };
    const uploaded = await stage(`graph_upload_${id}`, () => GraphService.uploadFileLarge.call(
      svc, 'akoya_request', 'Site Visit Materials', 'benchmark.pptx', file.buffer,
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ));
    file = null;
    return { uploaded: uploaded.size === fixtureStat.size };
  }

  async function runAdmitted(id) {
    let admission = acquireLargeUploadAdmission();
    let waiting = 0;
    while (!admission) {
      waiting += 1;
      await new Promise((resolve) => originalSetTimeout(resolve, 25));
      admission = acquireLargeUploadAdmission();
    }
    localServer.stats.admissionWaitPolls = (localServer.stats.admissionWaitPolls || 0) + waiting;
    localServer.stats.admittedPipelines = (localServer.stats.admittedPipelines || 0) + 1;
    try { return await runPipeline(id); }
    finally { releaseLargeUploadAdmission(admission.token); }
  }

  function mib(bytes) { return Math.round((bytes / 1024 / 1024) * 10) / 10; }
}

function gitShow(spec) {
  return execFileSync('git', ['show', spec], { cwd: REPO, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}

async function hashFile(filename, createReadStream, createHash) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filename, { highWaterMark: 1024 * 1024 })) digest.update(chunk);
  return digest.digest('hex');
}

function jsonResponse(value, status) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

async function startSinkServer({ createHash, expectedSize, expectedHash }) {
  const http = await import('node:http');
  const stats = { scannerRequests: [], graphBytes: 0, graphChunks: 0, graphSessions: [] };
  const sessions = new Map();
  let nextSession = 0;
  let scans = 0;
  let retryFirstScan = false;
  let expectedScannerFilename = 'benchmark.pptx';
  const server = http.createServer(async (req, res) => {
    if (req.url === '/scan' && req.method === 'POST') {
      scans += 1;
      const headers = req.headers;
      const record = { contentLength: Number(headers['content-length'] || 0), transferEncoding: headers['transfer-encoding'] || null,
        contentType: headers['content-type'] || null, expectedFilename: expectedScannerFilename, bodyBytes: 0 };
      try {
        await consumeScannerMultipart(req, record, { createHash, expectedSize, expectedHash });
      } catch (error) {
        record.aborted = true;
        record.parseError = error.message;
      }
      stats.scannerRequests.push(record);
      if (record.parseError) {
        res.writeHead(400);
        res.end('invalid benchmark multipart');
        return;
      }
      if (retryFirstScan && scans === 1) {
        // Timeout this attempt after its complete body arrives; retry gets a
        // clean response. A first request aborted during transfer is recorded.
        record.delayedResponse = true;
        setTimeout(() => { if (!res.destroyed) res.end(JSON.stringify({ CleanResult: true })); }, 5_200);
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ CleanResult: true }));
      }
      return;
    }
    if (req.url.startsWith('/graph-upload/') && req.method === 'PUT') {
      const sessionId = req.url.slice('/graph-upload/'.length);
      const session = sessions.get(sessionId);
      if (!session) { res.writeHead(404); res.end(); return; }
      const range = String(req.headers['content-range'] || '').match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if (!range) session.uploadRangesValid = false;
      let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; session.digest.update(chunk); }
      stats.graphBytes += bytes;
      stats.graphChunks += 1;
      session.bytes += bytes;
      session.chunks += 1;
      const start = range ? Number(range[1]) : -1;
      const end = range ? Number(range[2]) : -1;
      const total = range ? Number(range[3]) : -1;
      if (end - start + 1 !== bytes || total !== expectedSize) session.uploadRangesValid = false;
      if (start !== session.nextOffset) session.uploadRangesValid = false;
      session.nextOffset = end + 1;
      res.writeHead(end + 1 === total ? 201 : 202, { 'content-type': 'application/json' });
      if (end + 1 === total) {
        session.sha256 = session.digest.digest('hex');
        session.hashMatchesFixture = session.sha256 === expectedHash;
        stats.graphSessions.push({ bytes: session.bytes, chunks: session.chunks,
          sha256: session.sha256, hashMatchesFixture: session.hashMatchesFixture,
          uploadRangesValid: session.uploadRangesValid });
        res.end(JSON.stringify({ id: 'benchmark-item', size: expectedSize, name: 'benchmark.pptx', webUrl: 'http://local.invalid/item', eTag: 'bench-etag' }));
      }
      else res.end('{}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    server,
    port: address.port,
    stats,
    newGraphSession() {
      const id = String(++nextSession);
      sessions.set(id, { bytes: 0, chunks: 0, nextOffset: 0, uploadRangesValid: true, digest: createHash('sha256') });
      return id;
    },
    set expectedFilename(value) { expectedScannerFilename = value; },
    set retryFirstScan(value) { retryFirstScan = value; },
  };
}

async function consumeScannerMultipart(req, record, { createHash, expectedSize, expectedHash }) {
  const match = String(record.contentType || '').match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i);
  if (!match) throw new Error('missing multipart boundary');
  const boundary = match[1] || match[2];
  const opening = Buffer.from(`--${boundary}\r\n`);
  const headerEnd = Buffer.from('\r\n\r\n');
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  const expectedDisposition = `name="inputFile"; filename="${record.expectedFilename.replace(/"/g, '%22').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}"`;
  const digest = createHash('sha256');
  let prefix = Buffer.alloc(0);
  let tail = Buffer.alloc(0);
  let headersParsed = false;
  let payloadLength = 0;

  function appendPayload(chunk) {
    if (!chunk.length) return;
    const emitLength = tail.length + chunk.length - suffix.length;
    if (emitLength <= 0) {
      tail = Buffer.concat([tail, chunk]);
      return;
    }
    const fromTail = Math.min(emitLength, tail.length);
    if (fromTail) digest.update(tail.subarray(0, fromTail));
    const fromChunk = emitLength - fromTail;
    if (fromChunk) digest.update(chunk.subarray(0, fromChunk));
    tail = Buffer.concat([tail.subarray(fromTail), chunk.subarray(fromChunk)]);
    payloadLength += emitLength;
  }

  for await (const chunk of req) {
    record.bodyBytes += chunk.length;
    if (headersParsed) {
      appendPayload(chunk);
      continue;
    }
    prefix = Buffer.concat([prefix, chunk]);
    const end = prefix.indexOf(headerEnd);
    if (end < 0) {
      if (prefix.length > 64 * 1024) throw new Error('multipart part headers exceeded 64 KiB');
      continue;
    }
    const partHeaders = prefix.subarray(0, end);
    if (!partHeaders.subarray(0, opening.length).equals(opening)) throw new Error('multipart opening boundary mismatch');
    const disposition = partHeaders.toString('utf8').split('\r\n').find((line) => /^content-disposition:/i.test(line)) || '';
    if (!disposition.includes(expectedDisposition)) throw new Error('multipart filename/disposition mismatch');
    record.disposition = disposition;
    headersParsed = true;
    appendPayload(prefix.subarray(end + headerEnd.length));
    prefix = Buffer.alloc(0);
  }

  if (!headersParsed) throw new Error('multipart part headers incomplete');
  if (!tail.equals(suffix)) throw new Error('multipart closing boundary mismatch');
  record.fileBytes = payloadLength;
  record.fileSha256 = digest.digest('hex');
  record.fileHashMatchesFixture = record.fileSha256 === expectedHash;
  if (payloadLength !== expectedSize || !record.fileHashMatchesFixture) throw new Error('multipart file payload differs from fixture');
}
