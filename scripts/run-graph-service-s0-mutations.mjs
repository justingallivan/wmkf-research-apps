#!/usr/bin/env node
/**
 * S0 mutation proof runner.
 *
 * Each mutant is loaded from a disposable sibling copy of graph-service.js,
 * so the tracked runtime is never edited. Relative imports still resolve to
 * the real dependency graph. A mutant is successful only when the named
 * characterization invariant rejects its changed behavior.
 */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const sourcePath = path.join(root, 'lib/services/graph-service.js');
const mutantPath = path.join(root, 'lib/services/.s0-graph-service-mutant.js');
const source = await fs.readFile(sourcePath, 'utf8');
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
  const changed = requireMutation(name, mutate(source), source);
  const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  try {
    for (const [mode, text] of [['control', source], ['mutant', changed]]) {
      await fs.writeFile(mutantPath, text, { flag: 'wx' });
      let failure;
      try {
        globalThis.fetch = async () => { throw new Error('Unexpected network call in mutation exercise'); };
        for (const key of envKeys) delete process.env[key];
        const loaded = await import(`${pathToFileURL(mutantPath).href}?s0=${encodeURIComponent(name)}-${mode}`);
        try { await exercise(loaded.GraphService); } catch (error) { failure = error; }
      } finally {
        await fs.rm(mutantPath, { force: true });
      }
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
  ['token-generation-fence', sourceText => sourceText.replace('if (generation === tokenGeneration) {', 'if (true) {'), tokenFenceMutant],
  ['cdn-bearer-forwarding', sourceText => sourceText.replace(
    '        { redirect: \'follow\' },\n        DOWNLOAD_TIMEOUT,',
    '        { redirect: \'follow\', headers: this.buildHeaders(token) },\n        DOWNLOAD_TIMEOUT,',
  ), cdnAuthMutant],
  ['continuation-404-null', sourceText => sourceText.replace('        if (pagesFetched > 0\n', '        if (pagesFetched > 0 && resp.status === 404) return null;\n        if (pagesFetched > 0\n'), continuation404Mutant],
  ['upload-receiver-forwarding', sourceText => sourceText.replace('return this.uploadFile(libraryName, folderPath, filename, content, contentType, { conflictBehavior });', 'return GraphService.uploadFile(libraryName, folderPath, filename, content, contentType, { conflictBehavior });'), uploadReceiverMutant],
  ['download-receiver-forwarding', sourceText => sourceText.replace('return this.downloadFile(driveId, item.id);', 'return GraphService.downloadFile(driveId, item.id);'), downloadReceiverMutant],
  ['replace-if-match', sourceText => sourceText.replace("          'If-Match': ifMatch,\n", ''), ifMatchMutant],
  ['chunk-failure-propagation', sourceText => {
    const marker = '      const chunk = content.subarray(start, end + 1);';
    const start = sourceText.indexOf(marker);
    const tail = sourceText.slice(start);
    return sourceText.slice(0, start) + tail.replace(
      '      if (!resp.ok) {',
      '      if (false && !resp.ok) {',
    );
  }, chunkFailureMutant],
];

for (const [name, mutate, exercise] of mutations) {
  await runMutant(name, mutate, exercise);
}
