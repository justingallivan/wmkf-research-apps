#!/usr/bin/env node
/**
 * READ-ONLY probe for a `reviewer_email_reconcile_needs_merge` alert.
 *
 * Answers the question the alert itself cannot: **is this still true today?**
 * Nothing auto-resolves these alerts — `autoResolveKey` is used only to dedup
 * new ones (`lib/services/alert-service.js:22-32`), and the key appears exactly
 * once in the repo (`lib/services/reviewer-email-reconciler.js:44`). So an
 * active alert may describe a condition that was fixed weeks ago, and a silent
 * night means "suppressed by dedup", not "resolved". This probe replays the
 * reconciler's decision ladder against live Dataverse and reports the verdict.
 *
 * It performs NO writes. Every Dataverse call is a GET (the OAuth token
 * exchange is the only POST); every Postgres statement is a SELECT. There is
 * no execute mode.
 *
 * Verdicts:
 *   STILL_BLOCKED    — the duplicate persists; a human merge is still required.
 *   SELF_HEALING     — the blocker cleared; tonight's cron would fix it itself,
 *                      so just resolve the alert.
 *   ALREADY_RESOLVED — the person now has an email; the alert is stale.
 *   NOT_RECONCILABLE — the roster no longer offers a vetted email for this
 *                      candidate, so the cron will not act at all.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/probe-reviewer-email-reconcile-alert.mjs --alert 123
 *
 *   DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/probe-reviewer-email-reconcile-alert.mjs \
 *       --suggestion <guid> --request <guid> --email <addr>
 *
 *   ... --all        probe every ACTIVE alert of this type
 *
 * `DATAVERSE_ALLOW_PROD_READS=yes` is required by the target/write interlock for
 * a local read of production Dataverse (`lib/dataverse/core/interlock.js:326-330`).
 * It is a per-invocation operator act — do not persist it in `.env.local`.
 */

import { readFileSync } from 'node:fs';

function fail(message) {
  console.error(`PROBE ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { alertId: null, suggestionId: null, requestId: null, email: null, all: false, rosterLimit: 200 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--alert') out.alertId = Number(argv[++i]);
    else if (arg === '--suggestion') out.suggestionId = argv[++i];
    else if (arg === '--request') out.requestId = argv[++i];
    else if (arg === '--email') out.email = argv[++i];
    else if (arg === '--all') out.all = true;
    else if (arg === '--roster-limit') out.rosterLimit = Number(argv[++i]);
    else if (arg === '--execute' || arg.startsWith('--execute=')) {
      fail('This probe is read-only and has no execute mode.');
    } else fail(`Unknown argument: ${arg}`);
  }
  if (!out.all && !out.alertId && !out.suggestionId) {
    fail('Pass --alert <id>, --suggestion <guid> (+ --request/--email), or --all.');
  }
  if (!Number.isFinite(out.rosterLimit) || out.rosterLimit < 1 || out.rosterLimit > 1000) {
    fail('--roster-limit must be between 1 and 1000');
  }
  return out;
}

// ── env ──
try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { /* optional */ }
if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) {
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
}

const args = parseArgs(process.argv.slice(2));

if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
  fail(
    'Local reads of production Dataverse are denied by the target interlock.\n' +
    '  Re-run with the operator flag set for this invocation only:\n\n' +
    '    DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs \\\n' +
    `      scripts/probe-reviewer-email-reconcile-alert.mjs ${process.argv.slice(2).join(' ')}\n`
  );
}

const { sql } = await import('@vercel/postgres');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
enterDynamicsBypassForScript('probe-reviewer-email-reconcile-alert');

const suggestionAdapter = await import('../lib/dataverse/adapters/reviewer-suggestion.js');
const potentialReviewerAdapter = await import('../lib/dataverse/adapters/potential-reviewer.js');
const { pickVettedEmail } = await import('../lib/utils/reviewer-vetted-email.js');
const { findReconcilableCandidates } = await import('../lib/services/reviewer-roster-store.js');

const eq = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const short = (id) => (id ? `${String(id).slice(0, 8)}…` : '(none)');

// ── which alerts to probe ──
async function loadTargets() {
  if (args.suggestionId) {
    return [{
      alertId: null,
      suggestionId: args.suggestionId,
      requestId: args.requestId || null,
      email: args.email || null,
      kind: null,
      createdAt: null,
      status: null,
    }];
  }
  const where = args.all
    ? sql`SELECT id, metadata, created_at, status FROM system_alerts
           WHERE alert_type = 'reviewer_email_reconcile_needs_merge' AND status = 'active'
           ORDER BY created_at ASC`
    : sql`SELECT id, metadata, created_at, status FROM system_alerts
           WHERE id = ${args.alertId}`;
  const res = await where;
  if (!res.rows.length) fail(args.all ? 'No active alerts of this type.' : `No alert with id ${args.alertId}.`);
  return res.rows.map((row) => {
    const m = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
    return {
      alertId: row.id,
      suggestionId: m.suggestionId,
      requestId: m.requestId,
      email: m.email,
      kind: m.kind,
      createdAt: row.created_at,
      status: row.status,
    };
  });
}

// Is the candidate still in the set the cron actually processes? The service
// takes the most-recently-updated `maxBatch` rows, so a row can satisfy the
// predicate yet fall outside tonight's window — report both facts separately.
async function rosterState(suggestionId) {
  const row = await sql`
    SELECT request_id, status, updated_at,
           candidate->>'emailPersistAllowed'                      AS persist_top,
           candidate->'contactEnrichment'->>'emailPersistAllowed' AS persist_nested
      FROM reviewer_find_roster
     WHERE candidate->>'suggestionId' = ${suggestionId}
     LIMIT 1`;
  if (!row.rows.length) return { present: false };

  const batch = await findReconcilableCandidates(args.rosterLimit);
  const idx = batch.findIndex((r) => eq(r.candidate?.suggestionId, suggestionId));
  const inWindow = idx >= 0;
  return {
    present: true,
    rosterStatus: row.rows[0].status,
    updatedAt: row.rows[0].updated_at,
    persistAllowed: row.rows[0].persist_top === 'true' || row.rows[0].persist_nested === 'true',
    inWindow,
    rank: inWindow ? idx + 1 : null,
    windowSize: args.rosterLimit,
    vetted: inWindow ? pickVettedEmail(batch[idx].candidate) : null,
  };
}

async function probeOne(t) {
  console.log('\n' + '='.repeat(74));
  console.log(`ALERT ${t.alertId ?? '(ad-hoc)'}  kind=${t.kind || 'n/a'}  status=${t.status || 'n/a'}`);
  if (t.createdAt) console.log(`created: ${t.createdAt.toISOString?.() || t.createdAt}`);
  console.log(`request ${short(t.requestId)}  suggestion ${short(t.suggestionId)}  email ${t.email || '(none)'}`);
  console.log('='.repeat(74));

  if (!t.suggestionId) { console.log('VERDICT: UNKNOWN — alert metadata carries no suggestionId.'); return; }

  // 1. roster side — would the cron even consider this candidate?
  const roster = await rosterState(t.suggestionId);
  if (!roster.present) {
    console.log('roster: candidate row NOT FOUND in reviewer_find_roster');
  } else {
    console.log(`roster: status=${roster.rosterStatus} persistAllowed=${roster.persistAllowed} ` +
                `updated=${new Date(roster.updatedAt).toISOString()}`);
    console.log(`        in tonight's top-${roster.windowSize} window: ${roster.inWindow ? `yes (rank ${roster.rank})` : 'NO'}`);
    if (roster.inWindow) console.log(`        vetted email now: ${roster.vetted ? roster.vetted.email : 'NONE (projection not "ready")'}`);
  }
  const email = (roster.inWindow && roster.vetted?.email) || t.email;
  if (!email) { console.log('\nVERDICT: NOT_RECONCILABLE — no vetted email available.'); return; }

  // 2. replay the reconciler ladder against live Dataverse (all GETs)
  const sug = await suggestionAdapter.findById(t.suggestionId);
  if (!sug) { console.log('\nVERDICT: ALREADY_RESOLVED — suggestion no longer exists.'); return; }
  const belongs = !t.requestId || eq(sug._wmkf_request_value, t.requestId);
  console.log(`\nsuggestion: selected=${!!sug.wmkf_selected} belongsToRequest=${belongs}`);
  if (!belongs || !sug.wmkf_selected) {
    console.log('\nVERDICT: ALREADY_RESOLVED — the cron now skips this row (deselected or moved).');
    return;
  }

  const personId = sug._wmkf_potentialreviewer_value;
  const person = personId ? await potentialReviewerAdapter.getById(personId) : null;
  console.log(`person ${short(personId)}: name="${person?.wmkf_name || ''}" email=${person?.wmkf_emailaddress || '(empty)'} statecode=${person?.statecode}`);
  if (person?.wmkf_emailaddress) {
    console.log('\nVERDICT: ALREADY_RESOLVED — the person now has an email; the cron skips it. Resolve the alert.');
    return;
  }

  const owner = await potentialReviewerAdapter.findByEmailCandidates(email);
  if (owner.none) {
    console.log(`owner of ${email}: NONE`);
    console.log('\nVERDICT: SELF_HEALING — no competing owner; the next nightly run WRITES the email. Just resolve the alert.');
    return;
  }
  if (owner.ambiguous) {
    console.log(`owner of ${email}: AMBIGUOUS (${owner.count ?? '>1'} active owners)`);
    console.log('\nVERDICT: STILL_BLOCKED (ambiguous_owner) — more than one active record owns this email.');
    return;
  }
  if (eq(owner.id, personId)) {
    console.log('\nVERDICT: STILL_BLOCKED (contradictory) — the email resolves to this same person, who reads email-empty.');
    return;
  }
  const keeper = owner.row;
  const active = keeper?.statecode === undefined || keeper?.statecode === 0;
  console.log(`keeper ${short(owner.id)}: name="${keeper?.wmkf_name || ''}" statecode=${keeper?.statecode} active=${active}`);
  if (!active) {
    console.log('\nVERDICT: STILL_BLOCKED (inactive_owner) — the sole owner is deactivated; the cron never repoints to it.');
    return;
  }

  const keeperSug = await suggestionAdapter.findByPotentialReviewerAndRequest(owner.id, t.requestId || sug._wmkf_request_value);
  if (keeperSug) {
    console.log(`keeper's suggestion on this request: ${short(keeperSug.wmkf_appreviewersuggestionid)} selected=${!!keeperSug.wmkf_selected}`);
    console.log('\nVERDICT: STILL_BLOCKED (keeper_has_suggestion) — BOTH records hold a suggestion on this request.');
    console.log('  The (person,request) alt key would 412 on repoint. A human must collapse the duplicate.');
    console.log(`  Note: the keeper's row counts even when selected=false — a removed row still occupies the key.`);
    return;
  }
  console.log("keeper's suggestion on this request: NONE");
  console.log('\nVERDICT: SELF_HEALING — the blocker cleared; the next nightly run REPOINTS automatically. Just resolve the alert.');
}

const targets = await loadTargets();
console.log(`probing ${targets.length} alert(s) — READ-ONLY, no writes`);
for (const t of targets) {
  try {
    await probeOne(t);
  } catch (err) {
    console.error(`\nprobe failed for suggestion ${t.suggestionId}: ${err?.message || err}`);
  }
}
console.log('\ndone — no records were modified.');
