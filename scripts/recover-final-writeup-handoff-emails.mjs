#!/usr/bin/env node
/**
 * Owner-run recovery for group-review handoff emails
 * (final_writeup_handoff_emails, migration 072; Stage 4).
 *
 * Default is a dry run: it lists pending rows and performs no writes.
 * `--execute` retries each pending row through the same lease, stored
 * activity id and correlation key as the route, so it never sends twice.
 * Sending creates a Dynamics email activity, which is a Production Dataverse
 * write and needs the same-day write acknowledgement:
 *
 *   DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/recover-final-writeup-handoff-emails.mjs
 *
 *   DATAVERSE_ALLOW_PROD_READS=yes \
 *   DATAVERSE_PROD_WRITE_ACK="handoff email recovery $(date -u +%F)" \
 *     node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/recover-final-writeup-handoff-emails.mjs --execute
 *
 * NOTIFICATION_EMAIL_FROM, NEXTAUTH_URL (or VERCEL_PROJECT_PRODUCTION_URL)
 * and FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS must match Production.
 */
import './lib/use-extensionless.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadEnvLocal } = require('../lib/dataverse/client.js');

async function main() {
  const execute = process.argv.includes('--execute');
  loadEnvLocal();
  if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) process.env.POSTGRES_URL = process.env.DATABASE_URL;
  const host = (() => { try { return new URL(process.env.POSTGRES_URL).host; } catch { return 'unknown'; } })();
  const store = await import('../lib/services/final-writeup/handoff-email-store.js');
  const pending = await store.listPendingHandoffEmails({ limit: 100 });
  console.log(`Postgres host: ${host}`);
  console.log(`Pending handoff emails: ${pending.length}`);
  for (const row of pending) {
    console.log(`  final ${row.final_document_id} request ${row.request_id} attempts ${row.attempt_count} last error ${row.last_error_code || '-'} created ${new Date(row.created_at).toISOString()}`);
  }
  if (!execute) {
    console.log('Dry run. Pass --execute to retry these sends.');
    return;
  }
  const { withDalContext } = await import('../lib/dataverse/core/context.js');
  const { recoverPendingHandoffEmails } = await import('../lib/services/final-writeup/handoff-email-service.js');
  const results = await withDalContext('local-final-writeup-handoff-email-recovery', () => (
    recoverPendingHandoffEmails({ limit: 100 })
  ));
  for (const result of results) {
    console.log(`  final ${result.finalDocumentId}: ${result.status}${result.reason ? ` (${result.reason})` : ''}${result.code ? ` [${result.code}]` : ''}`);
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
