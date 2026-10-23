#!/usr/bin/env node
/** Read-only CLI store metadata; no object listing, content or secret export. */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
if (!process.argv.includes('--execute')) {
  console.log('Plan only: vercel blob list-stores --all --json; retain matching local-store/export metadata only.');
} else {
  try {
    const link = JSON.parse(fs.readFileSync(path.join(root, '.vercel/project.json'), 'utf8'));
    if (link.projectId !== 'prj_56SJKzNer1aV38kKVoP8tl3X0lf3') throw new Error('target_mismatch');
    let token = process.env.BLOB_READ_WRITE_TOKEN || '';
    if (!token) for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
      const match = line.match(/^BLOB_READ_WRITE_TOKEN=(.*)$/);
      if (match) token = match[1].trim().replace(/^['"](.*)['"]$/, '$1');
    }
    // Same format parsing as the installed SDK; never emit or pass the token.
    const localId = token.split('_')[3] || '';
    const child = cp.spawnSync('vercel', ['blob','list-stores','--all','--json','--non-interactive'], { cwd: root, encoding: 'utf8', timeout: 30000 });
    if (child.status !== 0) throw new Error('cli_metadata_unavailable');
    const body = JSON.parse(child.stdout);
    if (!Array.isArray(body.stores)) throw new Error('unexpected_shape');
    const stores = body.stores.filter(store => String(store.id || '').replace(/^store_/, '') === localId || /dvx|export/i.test(store.name || '')).map(store => ({
      localConfiguredPublicTokenMatches: String(store.id || '').replace(/^store_/, '') === localId,
      exportNameCandidateOnly: /dvx|export/i.test(store.name || ''),
      storeFingerprint: crypto.createHash('sha256').update(String(store.id)).digest('hex').slice(0,12),
      linkedToCurrentProject: (store.projects || []).some(project => project.id === link.projectId),
      reportedCount: Number.isSafeInteger(store.count) && store.count >= 0 ? store.count : null,
      reportedBytes: Number.isSafeInteger(store.size) && store.size >= 0 ? store.size : null,
    }));
    const result = { observedAt: new Date().toISOString(), mode: 'Vercel account-authenticated store metadata read only', inspectedStoreMetadataRows: body.stores.length, stores, limitation: 'Store-wide cached metadata, not prefix object inventory, environment credential binding or effective cleanup-target proof. Name matching does not establish DVX token ownership.' };
    fs.writeFileSync(path.join(root, 'docs/audits/blob-store-binding-evidence-2026-10-22.json'), `${JSON.stringify(result,null,2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify(result,null,2));
  } catch {
    console.error('Store metadata probe unavailable; details suppressed.');
    process.exitCode = 1;
  }
}
