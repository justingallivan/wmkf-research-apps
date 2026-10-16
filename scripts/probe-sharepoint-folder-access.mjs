#!/usr/bin/env node
/** Explicit operator probe: resolve supplied SharePoint folder links with the
 * application's Graph identity; optionally create/read/delete one unique test
 * file per resolved folder. Never edits existing files or site permissions.
 * Usage: node scripts/probe-sharepoint-folder-access.mjs --env /path/.env.local [--write] URL...
 */
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
const args = process.argv.slice(2);
const envIndex = args.indexOf('--env');
if (envIndex < 0 || !args[envIndex + 1]) throw new Error('--env is required');
const env = parseEnv(readFileSync(args[envIndex + 1], 'utf8'));
args.splice(envIndex, 2);
for (const key of ['DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET']) {
  if (!env[key]) throw new Error(`Missing ${key}`);
  process.env[key] = env[key];
}
const write = args.includes('--write');
const urls = args.filter(arg => arg !== '--write');
for (const value of urls) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'appriver3651007194.sharepoint.com') throw new Error('Unexpected site host');
}
const { GraphService } = await import('../lib/services/graph-service.js');
const token = await GraphService.getAccessToken();
async function call(path, options = {}) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers },
    signal: AbortSignal.timeout(30000), redirect: 'error',
  });
  const raw = await response.text();
  let data; try { data = JSON.parse(raw); } catch { data = raw; }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${data?.error?.code || 'request failed'} ${data?.error?.message || ''}`);
    error.status = response.status;
    throw error;
  }
  return data;
}
console.log(JSON.stringify({ authentication: 'PASS', appId: env.DYNAMICS_CLIENT_ID, writeProbe: write }));
for (const link of urls) {
  const url = new URL(link);
  console.log(`Target link path: ${url.pathname}`);
  let item;
  try {
    item = await call(`/shares/u!${Buffer.from(link).toString('base64url')}/driveItem`);
    console.log(JSON.stringify({ folderResolution: 'PASS', name: item.name, webUrl: item.webUrl, folder: Boolean(item.folder), parentReference: item.parentReference }));
  } catch (error) {
    console.log(`Folder resolution: ${error.message}`);
    const match = url.pathname.match(/^\/:f:\/s\/([^/]+)/);
    const sitePath = match ? `/sites/${match[1]}` : '/';
    try {
      const site = await call(`/sites/${url.hostname}:${sitePath}`);
      console.log(JSON.stringify({ siteRead: 'PASS', id: site.id, name: site.displayName, webUrl: site.webUrl }));
      const drives = await call(`/sites/${site.id}/drives?$select=id,name,webUrl`);
      console.log(JSON.stringify({ libraries: drives.value }));
    } catch (siteError) { console.log(`Site read (${sitePath}${match ? '' : ', root candidate'}): ${siteError.message}`); }
    continue;
  }
  if (!item.folder || !item.parentReference?.driveId) { console.log('Not a resolved folder; no write attempted.'); continue; }
  const drive = encodeURIComponent(item.parentReference.driveId);
  const children = await call(`/drives/${drive}/items/${encodeURIComponent(item.id)}/children?$top=1&$select=id`);
  console.log(JSON.stringify({ folderRead: 'PASS', returnedItems: children.value.length }));
  if (!write) continue;
  const filename = `WMKF-access-test-${randomUUID()}.txt`;
  const body = 'Temporary WMKF app SharePoint read/write access test. Safe to remove.\n';
  let created;
  try {
    created = await call(`/drives/${drive}/items/${encodeURIComponent(item.id)}:/${filename}:/content?@microsoft.graph.conflictBehavior=fail`, {
      method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body,
    });
    console.log(JSON.stringify({ write: 'PASS', name: created.name, id: created.id, webUrl: created.webUrl }));
    // Graph supplies a preauthenticated download URL; never log it or send the Graph token to it.
    const metadata = await call(`/drives/${drive}/items/${encodeURIComponent(created.id)}`);
    const downloadUrl = metadata['@microsoft.graph.downloadUrl'];
    if (!downloadUrl || new URL(downloadUrl).protocol !== 'https:') throw new Error('No HTTPS download URL returned');
    const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(30000) });
    if (!response.ok || await response.text() !== body) throw new Error('Readback mismatch');
    console.log('Readback: PASS');
  } catch (error) { console.log(`Write/readback: ${error.message}; candidate filename: ${filename}`); }
  finally {
    if (created?.id) {
      try {
        await call(`/drives/${drive}/items/${encodeURIComponent(created.id)}`, { method: 'DELETE', headers: created.eTag ? { 'If-Match': created.eTag } : {} });
        console.log('Test file cleanup: PASS');
      } catch (error) { console.log(`CLEANUP REQUIRED: ${created.webUrl}; ${error.message}`); }
    }
  }
}
