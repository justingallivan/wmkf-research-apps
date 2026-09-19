#!/usr/bin/env node
/**
 * S0 mutation proof runner.
 *
 * Each mutant is loaded from a disposable copy of the facade and graph
 * modules, so the tracked runtime is never edited. A mutant is successful
 * only when the named
 * characterization invariant rejects its changed behavior.
 */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const facadePath = path.join(root, 'lib/services/graph-service.js');
const graphDir = path.join(root, 'lib/services/graph');
const source = await fs.readFile(facadePath, 'utf8');
const graphSources = new Map();
for (const entry of await fs.readdir(graphDir, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.js')) {
    graphSources.set(entry.name, await fs.readFile(path.join(graphDir, entry.name), 'utf8'));
  }
}
const originalFetch = globalThis.fetch;
const envKeys = ['DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET'];

function response(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => Buffer.from(body.bytes || ''),
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
  };
}

function requireMutation(name, changed, original) {
  if (changed === original) throw new Error(`${name}: mutation did not change source`);
  return changed;
}

async function runMutant(name, mutate, exercise) {
  const changed = mutate(graphSources);
  if (!(changed instanceof Map) || [...changed].every(([file, text]) => text === graphSources.get(file))) {
    throw new Error(`${name}: mutation did not change source`);
  }
  const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  try {
    for (const [mode, files] of [['control', graphSources], ['mutant', changed]]) {
      const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-service-s0-'));
      const runtimeServices = path.join(runtimeRoot, 'lib/services');
      const runtimeGraph = path.join(runtimeServices, 'graph');
      try {
        await fs.mkdir(runtimeGraph, { recursive: true });
        await fs.symlink(path.join(root, 'lib/utils'), path.join(runtimeRoot, 'lib/utils'), 'dir');
        await fs.symlink(path.join(root, 'lib/observability'), path.join(runtimeRoot, 'lib/observability'), 'dir');
        // Keep the facade and every operation in the same disposable module
        // graph so each control/mutant gets fresh module state.
        await fs.writeFile(path.join(runtimeServices, 'graph-service.js'), source);
        for (const [file, text] of files) await fs.writeFile(path.join(runtimeGraph, file), text);
        const mutantPath = path.join(runtimeServices, 'graph-service.js');
        let failure;
        globalThis.fetch = async () => { throw new Error('Unexpected network call in mutation exercise'); };
        for (const key of envKeys) delete process.env[key];
        const loaded = await import(`${pathToFileURL(mutantPath).href}?s0=${encodeURIComponent(name)}-${mode}-${Date.now()}`);
        try { await exercise(loaded.GraphService); } catch (error) { failure = error; }
        if (mode === 'control') {
          if (failure) throw new Error(`${name}: unmodified control failed`, { cause: failure });
          console.log(`PASS ${name}: unmodified control`);
        } else {
          if (!failure) throw new Error(`${name}: mutant survived its intended characterization`);
          if (failure.code !== 'ERR_ASSERTION' || !failure.message.includes(`[${name}]`)) {
            throw new Error(`${name}: mutant failed for an unexpected reason`, { cause: failure });
          }
          console.log(`PASS ${name}: mutant rejected by named assertion`);
        }
      } finally {
        await fs.rm(runtimeRoot, { recursive: true, force: true });
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
}

async function tokenFenceMutant(GraphService) {
  Object.assign(process.env, {
    DYNAMICS_TENANT_ID: 'tenant', DYNAMICS_CLIENT_ID: 'client', DYNAMICS_CLIENT_SECRET: 'secret',
  });
  let resolveOld;
  let resolveNew;
  globalThis.fetch = jestLikeQueue([
    new Promise(resolve => { resolveOld = resolve; }),
    new Promise(resolve => { resolveNew = resolve; }),
  ]);
  const old = GraphService.getAccessToken();
  GraphService.clearCaches();
  const newer = GraphService.getAccessToken();
  resolveNew(response(200, { access_token: 'new-token', expires_in: 3600 }));
  await newer;
  resolveOld(response(200, { access_token: 'old-token', expires_in: 3600 }));
  await old;
  const cached = await GraphService.getAccessToken();
  assert.equal(cached, 'new-token', '[token-generation-fence] newest generation must own the cache');
}

function jestLikeQueue(promises) {
  let index = 0;
  return async () => {
    if (index >= promises.length) throw new Error('Unexpected extra request in token fixture');
    return promises[index++];
  };
}

async function cdnAuthMutant(GraphService) {
  GraphService.getAccessToken = async () => 'token';
  let call = 0;
  let cdnHeaders;
  globalThis.fetch = async (_url, init = {}) => {
    call += 1;
    if (call === 1) return response(200, {
      name: 'file.pdf', size: 1, file: { mimeType: 'application/pdf' },
      '@microsoft.graph.downloadUrl': 'https://cdn.example/file',
    });
    if (call !== 2) throw new Error('Unexpected extra CDN request');
    cdnHeaders = init.headers;
    return response(200, { bytes: 'ok' });
  };
  await GraphService.downloadFile('drive', 'item');
  assert.equal(cdnHeaders?.Authorization, undefined, '[cdn-bearer-forwarding] CDN must receive no bearer token');
}

async function continuation404Mutant(GraphService) {
  GraphService.getAccessToken = async () => 'token';
  let call = 0;
  globalThis.fetch = async (url) => {
    call += 1;
    if (call === 1) return response(200, { id: 'item', file: {}, publication: { versionId: '2.0' } });
    if (call === 2) return response(200, { id: '2.0' });
    if (call === 3) return response(200, {
      value: [{ id: '1.0' }],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/drive/items/item/versions?$skiptoken=next',
    });
    if (String(url).includes('/versions?')) return response(404, { error: 'page gone' });
    throw new Error(`unexpected URL ${url}`);
  };
  let result;
  let failure;
  try { result = await GraphService.listFileVersions('drive', 'item'); } catch (error) { failure = error; }
  assert.equal(failure, undefined, '[continuation-404-null] continuation404 must salvage prior pages');
  assert.ok(result?.versions?.some(version => version.versionId === '1.0'), '[continuation-404-null] salvaged history must retain first page');
}

async function uploadReceiverMutant(GraphService) {
  class Receiver extends GraphService {}
  GraphService.uploadFile = async () => ({ id: 'base-upload' });
  Receiver.uploadFile = async () => ({ id: 'receiver-upload' });
  globalThis.fetch = async () => { throw new Error('facade upload bypassed receiver'); };
  const result = await Receiver.uploadFileLarge('akoya_request', 'Folder', 'small.txt', Buffer.from('x'));
  assert.equal(result.id, 'receiver-upload', '[upload-receiver-forwarding] subclass override must receive upload');
}

async function downloadReceiverMutant(GraphService) {
  class Receiver extends GraphService {}
  Receiver.getDriveId = async () => 'drive';
  Receiver.getAccessToken = async () => 'token';
  GraphService.downloadFile = async () => ({ buffer: Buffer.from('base') });
  Receiver.downloadFile = async () => ({ buffer: Buffer.from('receiver') });
  let call = 0;
  globalThis.fetch = async (url) => {
    call += 1;
    if (call === 1 && String(url).includes('/root:/Folder/file.txt')) return response(200, { id: 'item' });
    throw new Error('facade download bypassed receiver');
  };
  const result = await Receiver.downloadFileByPath('akoya_request', 'Folder', 'file.txt');
  assert.equal(result.buffer.toString(), 'receiver', '[download-receiver-forwarding] subclass override must receive download');
}

async function ifMatchMutant(GraphService) {
  GraphService.getAccessToken = async () => 'token';
  let seen;
  globalThis.fetch = async (_url, init) => {
    seen = init.headers;
    return response(200, { id: 'item', name: 'file', size: 1 });
  };
  await GraphService.replaceFileContent('drive', 'item', Buffer.from('x'), 'text/plain', { ifMatch: 'etag' });
  assert.equal(seen['If-Match'], 'etag', '[replace-if-match] replacement must forward conditional ETag');
}

async function chunkFailureMutant(GraphService) {
  GraphService.getSiteId = async () => 'site';
  GraphService.getDriveId = async () => 'drive';
  GraphService.getAccessToken = async () => 'token';
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    if (call === 1) return response(200, { uploadUrl: 'https://upload.example/session' });
    if (call === 2) return response(500, { error: 'chunk failed' });
    return response(204);
  };
  try {
    await GraphService.uploadFileLarge('akoya_request', 'Folder', 'large.bin', Buffer.alloc(60 * 1024 * 1024 + 1));
  } catch (error) {
    assert.equal(error.status, 500, '[chunk-failure-propagation] failed chunk must preserve service error');
    return;
  }
  assert.fail('[chunk-failure-propagation] failed chunk must reject');
}

const mutations = [
  ['token-generation-fence', sources => new Map([...sources, ['auth.js', requireMutation('token-generation-fence', sources.get('auth.js').replace('if (generation === tokenGeneration) {', 'if (true) {'), sources.get('auth.js'))]]), tokenFenceMutant],
  ['cdn-bearer-forwarding', sources => new Map([...sources, ['downloads.js', requireMutation('cdn-bearer-forwarding', sources.get('downloads.js').replace("      presignedUrl,\n      { redirect: 'follow' },", "      presignedUrl,\n      { redirect: 'follow', headers: svc.buildHeaders(token) },"), sources.get('downloads.js'))]]), cdnAuthMutant],
  ['continuation-404-null', sources => new Map([...sources, ['versions.js', requireMutation('continuation-404-null', sources.get('versions.js').replace('      if (pagesFetched > 0\n', '      if (pagesFetched > 0 && resp.status === 404) return null;\n      if (pagesFetched > 0\n'), sources.get('versions.js'))]]), continuation404Mutant],
  ['upload-receiver-forwarding', sources => new Map([...sources, ['upload-session.js', requireMutation('upload-receiver-forwarding', sources.get('upload-session.js').replace('return svc.uploadFile(libraryName, folderPath, filename, content, contentType, { conflictBehavior });', 'return Object.getPrototypeOf(svc).uploadFile(libraryName, folderPath, filename, content, contentType, { conflictBehavior });'), sources.get('upload-session.js'))]]), uploadReceiverMutant],
  ['download-receiver-forwarding', sources => new Map([...sources, ['downloads.js', requireMutation('download-receiver-forwarding', sources.get('downloads.js').replace('return svc.downloadFile(driveId, item.id);', 'return Object.getPrototypeOf(svc).downloadFile(driveId, item.id);'), sources.get('downloads.js'))]]), downloadReceiverMutant],
  ['replace-if-match', sources => new Map([...sources, ['writes.js', requireMutation('replace-if-match', sources.get('writes.js').replace("        'If-Match': ifMatch,\n", ''), sources.get('writes.js'))]]), ifMatchMutant],
  ['chunk-failure-propagation', sources => new Map([...sources, ['upload-session.js', requireMutation('chunk-failure-propagation', sources.get('upload-session.js').replace('    if (!resp.ok) {', '    if (false && !resp.ok) {'), sources.get('upload-session.js'))]]), chunkFailureMutant],
];

for (const [name, mutate, exercise] of mutations) {
  await runMutant(name, mutate, exercise);
}
