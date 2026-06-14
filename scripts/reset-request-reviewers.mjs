/**
 * reset-request-reviewers.mjs — Clear a SINGLE request's reviewer working state
 * so you can search for reviewers from scratch in testing.
 *
 * SCOPE (per-request only — never global):
 *   1. Postgres `reviewer_find_roster`  — the Find-tab roster + cross-run dedup
 *      (request_id = akoya GUID). This is what suppresses previously-surfaced
 *      reviewers from new searches, so clearing it is what makes a search "fresh".
 *      Always cleared (hard DELETE — it is regenerable operational state).
 *   2. Dataverse `wmkf_appreviewersuggestion` — the saved/lifecycle ledger for the
 *      request. SOFT-deleted by default (wmkf_selected=false: disappears from the
 *      workbench, reversible, and re-save-safe). `--hard` truly deletes the rows.
 *      Skipped entirely with `--roster-only`.
 *      APPLICANT-SOURCED ROWS ARE PROTECTED BY DEFAULT — rows the applicant
 *      proposed (wmkf_applicantdisposition non-null, i.e. recommended/excluded, or
 *      `applicant` in wmkf_sources) are skipped, since they are applicant input, not
 *      test-generated surfaced state. Pass `--include-applicant` to clear them too.
 *   3. `akoya_request.wmkf_potentialreviewer1..5` invite slots — reported always;
 *      cleared only with `--include-slots` (best-effort $ref disassociation).
 *
 * NEVER TOUCHED: `wmkf_potentialreviewers` (the global vetted reviewer pool) or the
 * global `search_cache`. This script refuses to run without a single request id.
 *
 * SAFETY: dry-run by default — prints exactly what it WOULD change. Pass --execute
 * to act. .env.local points at the SAME Dataverse + Postgres that prod uses, so
 * only run this against a request you own as a test request.
 *
 * Usage:
 *   node scripts/reset-request-reviewers.mjs --request <akoya_requestnum|GUID> [flags]
 *     --execute         actually perform the changes (default: dry-run)
 *     --hard            hard-delete the Dataverse suggestions instead of soft-delete
 *     --roster-only     only clear the Postgres find-roster (leave Dataverse alone)
 *     --include-slots   also clear akoya_request.wmkf_potentialreviewer1..5 slots
 *     --include-applicant  ALSO clear applicant-sourced rows (default: protect them)
 *     --help
 */

import fs from 'fs';

// --- env: load .env.local (same pattern as the other scripts) -----------------
try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  }
} catch {
  console.error('Could not read .env.local — run from the repo root.');
  process.exit(2);
}

// --- args ---------------------------------------------------------------------
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

if (has('--help') || args.length === 0) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 40).join('\n').replace(/^ \*?/gm, ''));
  process.exit(0);
}

const requestArg = valOf('--request');
const EXECUTE = has('--execute');
const HARD = has('--hard');
const ROSTER_ONLY = has('--roster-only');
const INCLUDE_SLOTS = has('--include-slots');
const INCLUDE_APPLICANT = has('--include-applicant');

if (!requestArg) {
  console.error('ERROR: --request <akoya_requestnum|GUID> is required. This script never runs globally.');
  process.exit(2);
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const pg = await import('@vercel/postgres');
const sql = pg.sql;

// Fail-closed Dynamics restriction layer needs an explicit context. This is a
// single-process CLI (no concurrent requests to leak into), so the script-only
// persistent bypass is the sanctioned shape — same as smoke-test-candidate.mjs.
enterDynamicsBypassForScript('reset-request-reviewers');

const mode = EXECUTE ? '\x1b[31mEXECUTE (live changes)\x1b[0m' : 'DRY-RUN (no changes)';
console.log(`\n=== reset-request-reviewers — ${mode} ===`);
console.log(`Target: ${requestArg}${ROSTER_ONLY ? '  [roster-only]' : ''}${HARD ? '  [hard-delete]' : ''}${INCLUDE_SLOTS ? '  [include-slots]' : ''}${INCLUDE_APPLICANT ? '  [include-applicant]' : '  [applicant-protected]'}\n`);

// --- resolve request → GUID + slot values -------------------------------------
const SLOT_VALUE_FIELDS = [1, 2, 3, 4, 5].map((n) => `_wmkf_potentialreviewer${n}_value`);
let requestGuid;
let requestNum;
let slotValues = {};
try {
  if (GUID_RE.test(requestArg)) {
    const rec = await DynamicsService.getRecord('akoya_requests', requestArg, {
      select: ['akoya_requestid', 'akoya_requestnum', ...SLOT_VALUE_FIELDS].join(','),
    });
    requestGuid = rec.akoya_requestid;
    requestNum = rec.akoya_requestnum;
    slotValues = rec;
  } else {
    const { records } = await DynamicsService.queryRecords('akoya_requests', {
      select: ['akoya_requestid', 'akoya_requestnum', ...SLOT_VALUE_FIELDS].join(','),
      filter: `akoya_requestnum eq '${String(requestArg).replace(/'/g, "''")}'`,
      top: 2,
    });
    if (records.length === 0) { console.error(`ERROR: no akoya_request found with akoya_requestnum '${requestArg}'.`); process.exit(2); }
    if (records.length > 1) { console.error(`ERROR: ${records.length} requests match '${requestArg}' — pass the GUID instead.`); process.exit(2); }
    requestGuid = records[0].akoya_requestid;
    requestNum = records[0].akoya_requestnum;
    slotValues = records[0];
  }
} catch (e) {
  console.error('ERROR resolving request:', e.message);
  process.exit(2);
}
console.log(`Resolved request: #${requestNum}  (GUID ${requestGuid})\n`);

// --- 1) Postgres reviewer_find_roster ----------------------------------------
console.log('--- [1] Postgres reviewer_find_roster (Find-tab roster + dedup) ---');
try {
  const { rows } = await sql`
    SELECT status, COUNT(*)::int AS n FROM reviewer_find_roster
    WHERE request_id = ${requestGuid} GROUP BY status ORDER BY status`;
  const total = rows.reduce((s, r) => s + r.n, 0);
  if (total === 0) {
    console.log('  (no roster rows for this request)\n');
  } else {
    for (const r of rows) console.log(`  ${r.status.padEnd(8)} ${r.n}`);
    console.log(`  total: ${total}`);
    if (EXECUTE) {
      const del = await sql`DELETE FROM reviewer_find_roster WHERE request_id = ${requestGuid}`;
      console.log(`  \x1b[31mDELETED ${del.rowCount} roster row(s).\x1b[0m\n`);
    } else {
      console.log(`  → would DELETE all ${total} roster row(s).\n`);
    }
  }
} catch (e) {
  console.error('  ERROR (Postgres):', e.message, '\n');
}

// --- 2) Dataverse wmkf_appreviewersuggestion ----------------------------------
if (ROSTER_ONLY) {
  console.log('--- [2] Dataverse suggestions: SKIPPED (--roster-only) ---\n');
} else {
  console.log(`--- [2] Dataverse wmkf_appreviewersuggestion (${HARD ? 'HARD delete' : 'soft-delete'}) ---`);
  try {
    // ALL rows for the request (no selected/excluded filter). Applicant-sourced
    // rows are partitioned out below and protected unless --include-applicant.
    const { records: allRows } = await DynamicsService.queryRecords('wmkf_appreviewersuggestions', {
      select: [
        'wmkf_appreviewersuggestionid', 'wmkf_suggestionlabel', 'wmkf_selected',
        'wmkf_invited', 'wmkf_accepted', 'wmkf_declined', 'wmkf_reviewfilename',
        'wmkf_reviewsharepointfolder', 'wmkf_applicantdisposition', 'wmkf_sources',
      ].join(','),
      filter: `_wmkf_request_value eq ${requestGuid}`,
      top: 500,
    });
    // Applicant-sourced = has an applicant disposition (recommended/excluded), or
    // carries the `applicant` token in wmkf_sources. These are applicant input,
    // not test-generated surfaced state — protected unless --include-applicant.
    const isApplicantSourced = (r) =>
      r.wmkf_applicantdisposition != null ||
      String(r.wmkf_sources || '').split(',').map((s) => s.trim()).includes('applicant');
    const applicantRows = allRows.filter(isApplicantSourced);
    if (applicantRows.length) {
      console.log(`  \x1b[36m${applicantRows.length} applicant-sourced row(s) ${INCLUDE_APPLICANT ? 'WILL be cleared (--include-applicant)' : 'PROTECTED (skipped)'}:\x1b[0m`);
      for (const r of applicantRows) console.log(`    ⊘ ${r.wmkf_suggestionlabel || '(no label)'}`);
    }
    const records = INCLUDE_APPLICANT ? allRows : allRows.filter((r) => !isApplicantSourced(r));
    if (records.length === 0) {
      console.log('  (no clearable suggestion rows for this request)\n');
    } else {
      let liveCount = 0;
      for (const r of records) {
        const live = r.wmkf_accepted || r.wmkf_invited || r.wmkf_reviewfilename || r.wmkf_reviewsharepointfolder;
        if (live) liveCount++;
        const flags = [
          r.wmkf_selected ? 'selected' : null,
          r.wmkf_invited ? 'INVITED' : null,
          r.wmkf_accepted ? 'ACCEPTED' : null,
          r.wmkf_declined ? 'declined' : null,
          r.wmkf_reviewfilename ? 'HAS-REVIEW' : null,
          r.wmkf_reviewsharepointfolder ? 'HAS-SHAREPOINT' : null,
        ].filter(Boolean).join(',') || 'none';
        console.log(`  • ${(r.wmkf_suggestionlabel || '(no label)').padEnd(32)} [${flags}]`);
      }
      console.log(`  total: ${records.length}${liveCount ? `  (\x1b[33m${liveCount} with live lifecycle/SharePoint state\x1b[0m)` : ''}`);
      if (liveCount && HARD) {
        console.log('  \x1b[33mWARNING: --hard will permanently delete rows that have invite/accept/review/SharePoint state.');
        console.log('  Hard delete can orphan linked SharePoint folders and may fail on Restrict-cascade lookups.\x1b[0m');
      }
      if (EXECUTE) {
        let ok = 0, fail = 0;
        for (const r of records) {
          try {
            if (HARD) await DynamicsService.deleteRecord('wmkf_appreviewersuggestions', r.wmkf_appreviewersuggestionid);
            else await DynamicsService.updateRecord('wmkf_appreviewersuggestions', r.wmkf_appreviewersuggestionid, { wmkf_selected: false });
            ok++;
          } catch (e) {
            fail++;
            console.error(`    FAILED ${r.wmkf_appreviewersuggestionid}: ${e.message}`);
          }
        }
        console.log(`  \x1b[31m${HARD ? 'DELETED' : 'SOFT-DELETED'} ${ok} suggestion(s)${fail ? `, ${fail} failed` : ''}.\x1b[0m\n`);
      } else {
        console.log(`  → would ${HARD ? 'HARD-DELETE' : 'soft-delete (selected=false)'} all ${records.length} suggestion(s).\n`);
      }
    }
  } catch (e) {
    console.error('  ERROR (Dataverse suggestions):', e.message, '\n');
  }
}

// --- 3) akoya_request invite slots 1..5 ---------------------------------------
console.log('--- [3] akoya_request.wmkf_potentialreviewer1..5 invite slots ---');
const populatedSlots = SLOT_VALUE_FIELDS
  .map((f, i) => ({ n: i + 1, value: slotValues[f] }))
  .filter((s) => s.value);
if (populatedSlots.length === 0) {
  console.log('  (no invite slots populated)\n');
} else {
  for (const s of populatedSlots) console.log(`  slot ${s.n}: ${s.value}`);
  if (!INCLUDE_SLOTS) {
    console.log('  → not cleared (pass --include-slots to clear these invite slots).\n');
  } else if (EXECUTE) {
    const baseUrl = process.env.DYNAMICS_URL;
    const token = await DynamicsService.getAccessToken();
    for (const s of populatedSlots) {
      const url = `${baseUrl}/api/data/v9.2/akoya_requests(${requestGuid})/wmkf_PotentialReviewer${s.n}/$ref`;
      try {
        const resp = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        if (resp.ok || resp.status === 204) console.log(`  \x1b[31mcleared slot ${s.n}.\x1b[0m`);
        else console.error(`  slot ${s.n}: HTTP ${resp.status} (nav-property name may differ; not cleared)`);
      } catch (e) {
        console.error(`  slot ${s.n}: ${e.message}`);
      }
    }
    console.log('');
  } else {
    console.log(`  → would clear ${populatedSlots.length} invite slot(s) (best-effort $ref disassociation).\n`);
  }
}

console.log('=== done ===');
if (!EXECUTE) console.log('Dry-run only. Re-run with --execute to apply.\n');
