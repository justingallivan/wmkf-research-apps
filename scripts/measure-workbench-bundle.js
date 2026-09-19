#!/usr/bin/env node

/*
 * Measure the already-built Pages Router assets for the two Workbench entry
 * points. This is intentionally read-only: it consumes .next/build-manifest.json
 * and the referenced static files, then writes one JSON document to stdout.
 *
 * Usage:
 *   node scripts/measure-workbench-bundle.js
 *   node scripts/measure-workbench-bundle.js --manifest=/path/to/build-manifest.json
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DASHBOARD_ROUTE = '/workbench';
const REQUEST_ROUTE = '/workbench/[requestId]';

function readManifestPath(argv) {
  const value = argv.find((arg) => arg.startsWith('--manifest='));
  return path.resolve(value ? value.slice('--manifest='.length) : '.next/build-manifest.json');
}

function fail(message) {
  console.error(`measure-workbench-bundle: ${message}`);
  process.exitCode = 1;
}

function assetSetFor(manifest, route) {
  const assets = manifest.pages?.[route];
  if (!Array.isArray(assets)) throw new Error(`manifest has no asset list for ${route}`);
  return new Set(assets.filter((asset) => asset.endsWith('.js')));
}

function initialEntryAssetSet(manifest, route) {
  const assets = assetSetFor(manifest, route);
  for (const list of [manifest.pages?.['/_app'], manifest.rootMainFiles, manifest.lowPriorityFiles]) {
    if (!Array.isArray(list)) continue;
    for (const asset of list) {
      if (asset.endsWith('.js')) assets.add(asset);
    }
  }
  return assets;
}

function assetInfo(manifestPath, asset) {
  const buildDir = path.dirname(manifestPath);
  const absolute = path.resolve(buildDir, asset);
  if (absolute !== buildDir && !absolute.startsWith(`${buildDir}${path.sep}`)) {
    throw new Error(`manifest asset escapes build directory: ${asset}`);
  }
  const bytes = fs.readFileSync(absolute);
  return {
    path: asset,
    rawBytes: bytes.length,
    gzipBytes: zlib.gzipSync(bytes, { level: 9 }).length,
  };
}

function summarize(manifestPath, assets) {
  const files = [...assets].sort().map((asset) => assetInfo(manifestPath, asset));
  return {
    assetCount: files.length,
    rawBytes: files.reduce((total, file) => total + file.rawBytes, 0),
    gzipBytes: files.reduce((total, file) => total + file.gzipBytes, 0),
    assets: files,
  };
}

function main() {
  const manifestPath = readManifestPath(process.argv.slice(2));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const dashboardAssets = assetSetFor(manifest, DASHBOARD_ROUTE);
  const requestAssets = assetSetFor(manifest, REQUEST_ROUTE);
  const dashboardInitialAssets = initialEntryAssetSet(manifest, DASHBOARD_ROUTE);
  const requestInitialAssets = initialEntryAssetSet(manifest, REQUEST_ROUTE);
  const compare = (left, right) => ({
    common: new Set([...left].filter((asset) => right.has(asset))),
    leftOnly: new Set([...left].filter((asset) => !right.has(asset))),
    rightOnly: new Set([...right].filter((asset) => !left.has(asset))),
  });
  const routeComparison = compare(dashboardAssets, requestAssets);
  const initialComparison = compare(dashboardInitialAssets, requestInitialAssets);

  const output = {
    schemaVersion: 1,
    manifest: path.relative(process.cwd(), manifestPath) || path.basename(manifestPath),
    manifestMtime: fs.statSync(manifestPath).mtime.toISOString(),
    compression: { algorithm: 'gzip', level: 9 },
    initialEntryDefinition: [
      'route page JavaScript assets',
      'pages/_app JavaScript assets',
      'rootMainFiles JavaScript assets',
      'lowPriorityFiles JavaScript assets',
    ],
    excludedNomodulePolyfills: summarize(manifestPath, new Set(
      (Array.isArray(manifest.polyfillFiles) ? manifest.polyfillFiles : [])
        .filter((asset) => asset.endsWith('.js')),
    )),
    routes: {
      dashboard: {
        route: DASHBOARD_ROUTE,
        routeAssets: summarize(manifestPath, dashboardAssets),
        initialEntryAssets: summarize(manifestPath, dashboardInitialAssets),
      },
      request: {
        route: REQUEST_ROUTE,
        routeAssets: summarize(manifestPath, requestAssets),
        initialEntryAssets: summarize(manifestPath, requestInitialAssets),
      },
    },
    comparison: {
      routeAssets: {
        common: summarize(manifestPath, routeComparison.common),
        dashboardOnly: summarize(manifestPath, routeComparison.leftOnly),
        requestOnly: summarize(manifestPath, routeComparison.rightOnly),
      },
      initialEntryAssets: {
        common: summarize(manifestPath, initialComparison.common),
        dashboardOnly: summarize(manifestPath, initialComparison.leftOnly),
        requestOnly: summarize(manifestPath, initialComparison.rightOnly),
      },
    },
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
