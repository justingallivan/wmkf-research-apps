#!/usr/bin/env node
/**
 * PR4 e2e CLEANUP — best-effort teardown of a setup run. Revokes the token (kills
 * the link), then tries to DELETE the suggestion + person; if the app user lacks
 * DeleteAccess, falls back to deactivating (statecode=1) and reports what to clean
 * up by hand. The promoted CONTACT is intentionally left (no DeleteAccess; use a
 * fresh proxy email per run so contacts don't collide).
 *
 *   node scripts/pr4-e2e-cleanup.js --person <GUID> --suggestion <GUID>
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue; let [, k, v] = m; v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 ? process.argv[i + 1] : d; };
const PERSON = arg('person'), SUGGESTION = arg('suggestion');
if (!PERSON && !SUGGESTION) { console.error('Usage: --person <GUID> --suggestion <GUID>'); process.exit(1); }

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const { revoke } = await import('../lib/external/token-lifecycle.js');

// statecode/statuscode for Inactive on these entities (1/2).
async function deleteOrDeactivate(entitySet, id, label) {
  if (!id) return;
  try {
    await DynamicsService.deleteRecord(entitySet, id);
    console.log(`✓ deleted ${label} ${id}`);
  } catch (delErr) {
    try {
      await DynamicsService.updateRecord(entitySet, id, { statecode: 1, statuscode: 2 });
      console.log(`• deactivated ${label} ${id} (delete failed: ${delErr.message?.slice(0, 70)})`);
    } catch (deactErr) {
      console.log(`✗ could not delete OR deactivate ${label} ${id} — clean up by hand. (${deactErr.message?.slice(0, 70)})`);
    }
  }
}

await bypassDynamicsRestrictions('pr4-e2e-cleanup', async () => {
  if (SUGGESTION) {
    try { await revoke(SUGGESTION); console.log(`✓ revoked token on suggestion ${SUGGESTION}`); }
    catch (e) { console.log(`• token revoke skipped: ${e.message?.slice(0, 70)}`); }
    await deleteOrDeactivate('wmkf_appreviewersuggestions', SUGGESTION, 'suggestion');
  }
  if (PERSON) await deleteOrDeactivate('wmkf_potentialreviewerses', PERSON, 'person');
  console.log('\nNote: the promoted contact (if any) is left in place — app user has no contact DeleteAccess. Use a fresh proxy email next run.');
});
