#!/usr/bin/env node

/**
 * Reproduce the pinned ROR compact-index size/load experiment.
 *
 * All downloaded and generated artifacts live under the ignored .data/
 * directory unless --work-dir is supplied. Nothing is runtime-wired.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { spawnSync } = require('child_process');
const { performance } = require('perf_hooks');
const zlib = require('zlib');
const { buildCompactIndex, verifyPinnedFile } = require('./lib');
const releaseManifest = require('./release-manifest.json');

const BROTLI_QUALITY = 6;
const DOWNLOAD_ATTEMPTS = 4;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const SCRIPT_DIR = __dirname;

function parseArguments(argv) {
  const options = {
    workDir: path.join(SCRIPT_DIR, '.data'),
    sourceJson: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--work-dir') {
      options.workDir = path.resolve(argv[++index]);
    } else if (argument === '--source-json') {
      options.sourceJson = path.resolve(argv[++index]);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function verifyZip(zipPath) {
  verifyPinnedFile(zipPath, releaseManifest.zip, 'Pinned ZIP');
}

function verifySourceJson(jsonPath, label) {
  verifyPinnedFile(jsonPath, releaseManifest.json, label);
}

async function ensureZip(workDir) {
  const zipPath = path.join(workDir, releaseManifest.zip.name);
  if (fs.existsSync(zipPath)) {
    verifyZip(zipPath);
    return zipPath;
  }

  const partialPath = `${zipPath}.partial`;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      if (fs.existsSync(partialPath)) fs.rmSync(partialPath);
      process.stdout.write(
        `Downloading ${releaseManifest.doi} (attempt ${attempt}/${DOWNLOAD_ATTEMPTS})...\n`,
      );
      const response = await fetch(releaseManifest.zip.url, {
        headers: {
          'user-agent': 'WMKF-ROR-Index-Experiment/1.0 (research tooling)',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok || !response.body) {
        const error = new Error(`ROR download failed: HTTP ${response.status}`);
        error.retryable = [429, 500, 502, 503, 504].includes(response.status);
        throw error;
      }
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partialPath));
      verifyZip(partialPath);
      fs.renameSync(partialPath, zipPath);
      return zipPath;
    } catch (error) {
      if (fs.existsSync(partialPath)) fs.rmSync(partialPath);
      const finalAttempt = attempt === DOWNLOAD_ATTEMPTS;
      if (finalAttempt || error.retryable === false) throw error;
      const delayMs = 1000 * (2 ** (attempt - 1));
      process.stdout.write(`Retrying after ${delayMs} ms: ${error.message}\n`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error('ROR download attempts exhausted');
}

function ensureSourceJson(workDir, zipPath, suppliedSourceJson) {
  if (suppliedSourceJson) {
    verifySourceJson(suppliedSourceJson, 'Supplied ROR JSON');
    return suppliedSourceJson;
  }

  const jsonPath = path.join(workDir, releaseManifest.json.name);
  if (fs.existsSync(jsonPath)) {
    verifySourceJson(jsonPath, 'Pinned ROR JSON');
    return jsonPath;
  }

  const extraction = spawnSync(
    'unzip',
    ['-o', zipPath, releaseManifest.json.name, '-d', workDir],
    { encoding: 'utf8' },
  );
  if (extraction.status !== 0) {
    throw new Error(`unzip failed: ${extraction.stderr || extraction.stdout}`);
  }
  verifySourceJson(jsonPath, 'Extracted ROR JSON');
  return jsonPath;
}

function probeLoad(encoding, filePath) {
  const result = spawnSync(
    process.execPath,
    ['--expose-gc', path.join(SCRIPT_DIR, 'load-probe.js'), encoding, filePath],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`Load probe failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function compressSource(sourceJsonPath, workDir) {
  const gzipPath = path.join(workDir, `${releaseManifest.json.name}.gz`);
  const brotliPath = path.join(workDir, `${releaseManifest.json.name}.br`);
  const result = spawnSync(
    process.execPath,
    [path.join(SCRIPT_DIR, 'compress-probe.js'), sourceJsonPath, gzipPath, brotliPath],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`Source compression probe failed: ${result.stderr || result.stdout}`);
  }
  return {
    paths: { gzipPath, brotliPath },
    measurement: JSON.parse(result.stdout),
  };
}

function compressedSizes(value) {
  const json = Buffer.from(JSON.stringify(value));
  return {
    jsonBytes: json.length,
    gzipBytes: zlib.gzipSync(json).length,
    brotliBytes: zlib.brotliCompressSync(json, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
    }).length,
  };
}

function measureComponents(index) {
  return {
    catalogue: compressedSizes({
      format: index.format,
      release: index.release,
      layout: index.layout,
      dictionaries: index.dictionaries,
      records: index.records,
    }),
    exactNameLookup: compressedSizes(index.lookup.exactName),
    domainLookup: compressedSizes(index.lookup.domain),
    tokenLookup: compressedSizes(index.lookup.token),
    trigramLookup: compressedSizes(index.lookup.trigram),
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  fs.mkdirSync(options.workDir, { recursive: true });

  let zipPath = null;
  if (!options.sourceJson) zipPath = await ensureZip(options.workDir);
  const sourceJsonPath = ensureSourceJson(options.workDir, zipPath, options.sourceJson);

  process.stdout.write('Compressing and probing fresh-process loads of raw ROR JSON...\n');
  const sourceCompression = compressSource(sourceJsonPath, options.workDir);
  const sourceLoads = {
    json: probeLoad('json', sourceJsonPath),
    gzip: probeLoad('gzip', sourceCompression.paths.gzipPath),
    brotli: probeLoad('brotli', sourceCompression.paths.brotliPath),
  };

  const readStartedAt = performance.now();
  let rawText = fs.readFileSync(sourceJsonPath, 'utf8');
  const readFinishedAt = performance.now();
  let sourceRecords = JSON.parse(rawText);
  const parseFinishedAt = performance.now();
  rawText = null;

  process.stdout.write(`Building retrieval-only index for ${sourceRecords.length} records...\n`);
  const buildStartedAt = performance.now();
  const index = buildCompactIndex(sourceRecords, releaseManifest);
  const buildFinishedAt = performance.now();
  sourceRecords = null;

  const componentSizes = measureComponents(index);
  const serializeStartedAt = performance.now();
  const indexJson = Buffer.from(JSON.stringify(index));
  const serializeFinishedAt = performance.now();

  const indexBaseName = `${releaseManifest.release}-${releaseManifest.publicationDate}-compact-ror-index`;
  const indexJsonPath = path.join(options.workDir, `${indexBaseName}.json`);
  const indexGzipPath = `${indexJsonPath}.gz`;
  const indexBrotliPath = `${indexJsonPath}.br`;
  fs.writeFileSync(indexJsonPath, indexJson);

  const gzipStartedAt = performance.now();
  const gzip = zlib.gzipSync(indexJson);
  const gzipFinishedAt = performance.now();
  fs.writeFileSync(indexGzipPath, gzip);

  const brotliStartedAt = performance.now();
  const brotli = zlib.brotliCompressSync(indexJson, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
  });
  const brotliFinishedAt = performance.now();
  fs.writeFileSync(indexBrotliPath, brotli);

  process.stdout.write('Probing fresh-process loads of compact artifacts...\n');
  const compactLoads = {
    json: probeLoad('json', indexJsonPath),
    gzip: probeLoad('gzip', indexGzipPath),
    brotli: probeLoad('brotli', indexBrotliPath),
  };

  const measurement = {
    experimentVersion: 1,
    measuredAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      cpu: require('os').cpus()[0]?.model || null,
      totalMemoryBytes: require('os').totalmem(),
    },
    release: releaseManifest,
    source: {
      zipBytes: releaseManifest.zip.bytes,
      rawJsonBytes: fs.statSync(sourceJsonPath).size,
      artifactSizes: sourceCompression.measurement,
      freshProcessLoads: sourceLoads,
    },
    index: {
      stats: index.stats,
      componentSizes,
      artifactSizes: {
        jsonBytes: indexJson.length,
        gzipBytes: gzip.length,
        brotliBytes: brotli.length,
        brotliQuality: BROTLI_QUALITY,
      },
      artifactChecksums: {
        jsonSha256: crypto.createHash('sha256').update(indexJson).digest('hex'),
        gzipSha256: crypto.createHash('sha256').update(gzip).digest('hex'),
        brotliSha256: crypto.createHash('sha256').update(brotli).digest('hex'),
      },
      build: {
        sourceReadMs: readFinishedAt - readStartedAt,
        sourceParseMs: parseFinishedAt - readFinishedAt,
        indexBuildMs: buildFinishedAt - buildStartedAt,
        serializeMs: serializeFinishedAt - serializeStartedAt,
        gzipMs: gzipFinishedAt - gzipStartedAt,
        brotliMs: brotliFinishedAt - brotliStartedAt,
        maxRssKiB: process.resourceUsage().maxRSS,
      },
      freshProcessLoads: compactLoads,
    },
  };

  const measurementPath = path.join(options.workDir, 'measurement.json');
  fs.writeFileSync(measurementPath, `${JSON.stringify(measurement, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    measurementPath,
    indexJsonPath,
    indexGzipPath,
    indexBrotliPath,
    artifactSizes: measurement.index.artifactSizes,
    stats: measurement.index.stats,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
