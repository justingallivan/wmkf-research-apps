#!/usr/bin/env node
/**
 * Read-only pre-merge checks for PR #561 (Board setup from the cycle calendar,
 * D47) and PR #562 (materials on acceptance, D46/D48/D49). Owner-run against
 * Production: Dataverse GETs only (the sole POST acquires the application's
 * OAuth token) and Postgres SELECTs only. Prints counts, dates and keys; no
 * reviewer names, emails or free text.
 *
 * Usage: node scripts/probe-reviewer-build-premerge.cjs <credential-env-file>
 *   The env file supplies DYNAMICS_TENANT_ID / DYNAMICS_CLIENT_ID /
 *   DYNAMICS_CLIENT_SECRET and POSTGRES_URL (the Production database).
 */
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const assert = require('node:assert/strict');

const TARGET = 'https://wmkf.crm.dynamics.com';
const BOARD_CYCLE = 'D26';
const EXPECTED_D26_BOARD_DATE = '2026-12-10';
const FINDER_CYCLE = 'J27';
const BOARD_PROGRAM_ID = 'c247b11a-a7cb-ee11-9078-000d3a341e8f';
const NEW_TEMPLATE_KEYS = ['email.reviewer_materials_acceptance.subject', 'email.reviewer_materials_acceptance.body'];

const day = (v) => (typeof v === 'string' && v ? v.slice(0, 10) : null);
const q = (s) => s.replace(/'/g, "''");

async function getAll(client, path) {
  const rows = [];
  for (let page = 0; path && page < 30; page++) {
    const r = await client.get(path);
    assert(r.ok && Array.isArray(r.body?.value), `Read failed (${r.status}) for ${path.split('?')[0]}`);
    rows.push(...r.body.value);
    path = r.body['@odata.nextLink'];
  }
  assert(!path, 'Incomplete pagination');
  return rows;
}

async function main() {
  assert(process.argv.length === 3, 'Usage: node scripts/probe-reviewer-build-premerge.cjs <credential-env-file>');
  const env = parseEnv(fs.readFileSync(process.argv[2], 'utf8'));
  for (const key of ['DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET', 'POSTGRES_URL']) {
    assert(env[key], `${key} missing from the env file`);
  }
  for (const key of ['DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET']) process.env[key] = env[key];
  delete process.env.VERCEL_ENV;
  Object.assign(process.env, { NODE_ENV: 'development', DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on', DATAVERSE_ALLOW_PROD_READS: 'yes' });

  const { createClient, getAccessToken } = require('../lib/dataverse/client.js');
  const client = createClient({ resourceUrl: TARGET, token: await getAccessToken(TARGET) });
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: env.POSTGRES_URL, max: 1 });
  const out = { checkedAt: new Date().toISOString(), dataverse: TARGET, postgresHost: new URL(env.POSTGRES_URL).hostname, pr561: {}, pr562: {} };

  try {
    // ── PR #561 ────────────────────────────────────────────────────────────
    const cycles = await getAll(client, `/wmkf_grantcycles?$select=wmkf_cyclecode,wmkf_boardmailingdate,wmkf_meetingdate&$filter=wmkf_cyclecode eq '${q(BOARD_CYCLE)}'`);
    const mailing = day(cycles[0]?.wmkf_boardmailingdate);
    const meeting = day(cycles[0]?.wmkf_meetingdate);
    out.pr561.calendarRows = cycles.length;
    out.pr561.boardMailingDate = mailing;
    out.pr561.boardMeetingDate = meeting;
    out.pr561.check1_mailingSetAndNotAfterMeeting = Boolean(mailing && meeting && mailing <= meeting);
    out.pr561.check2_meetingIs20261210 = meeting === EXPECTED_D26_BOARD_DATE;

    const setupRows = await getAll(client, `/wmkf_appsystemsettings?$select=wmkf_settingvalue&$filter=wmkf_settingkey eq 'board_writeups.cycle.${q(BOARD_CYCLE)}'`);
    let setup = null;
    try { setup = setupRows[0] ? JSON.parse(setupRows[0].wmkf_settingvalue) : null; } catch { setup = 'unparseable'; }
    out.pr561.storedSetup = setup && typeof setup === 'object'
      ? { active: setup.active ?? null, typedMaterialsDue: setup.materialsDue ?? null, typedBoardEnds: setup.boardEnds ?? null }
      : setup;

    const run = (await pool.query('SELECT state FROM board_writeup_runs WHERE program_id = $1 AND cycle_code = $2', [BOARD_PROGRAM_ID, BOARD_CYCLE])).rows[0];
    const emails = Object.entries(run?.state?.emails || {});
    const unsent = emails.filter(([, e]) => !e?.acceptedAt).map(([key, e]) => ({ key, kind: e?.kind || null, createStarted: Boolean(e?.createStartedAt), sendStarted: Boolean(e?.sendStartedAt) }));
    out.pr561.journalFound = Boolean(run);
    out.pr561.pendingConfigIntent = Boolean(run?.state?.configIntent);
    out.pr561.unsentNoticeDrafts = unsent;
    out.pr561.check3_noIntentNoUnsentDraft = Boolean(run) ? !run.state.configIntent && unsent.length === 0 : 'no journal row';

    // ── PR #562 ────────────────────────────────────────────────────────────
    const migrations = (await pool.query("SELECT name FROM schema_migrations WHERE name LIKE '09%' ORDER BY name")).rows.map(r => r.name);
    out.pr562.migrations09x = migrations;
    out.pr562.check1_091NotApplied = !migrations.some(f => f.startsWith('091'));
    const releaseTable = (await pool.query("SELECT to_regclass('public.reviewer_materials_releases') AS t")).rows[0].t;
    out.pr562.releaseTableExists = Boolean(releaseTable);

    const keyRows = await getAll(client, `/wmkf_appsystemsettings?$select=wmkf_settingkey&$filter=${NEW_TEMPLATE_KEYS.map(k => `wmkf_settingkey eq '${q(k)}'`).join(' or ')}`);
    out.pr562.newTemplateKeysPresent = keyRows.map(r => r.wmkf_settingkey).sort();
    out.pr562.check2_templateKeysNotYetSeeded_seedBeforeDeploy = keyRows.length === 0;

    const open = await getAll(client, `/wmkf_appreviewersuggestions?$select=wmkf_appreviewersuggestionid,_wmkf_request_value,wmkf_externaltokenexpires,wmkf_externaltokenrevoked,wmkf_emailsentat,wmkf_reviewstatus&$filter=wmkf_grantcyclecode eq '${q(BOARD_CYCLE)}' and wmkf_invited eq true and wmkf_accepted ne true and wmkf_declined ne true and wmkf_responsetype eq null`);
    out.pr562.d26OpenInvitations = open.length;
    out.pr562.check3a_d26NoOpenInvitations = open.length === 0;
    // Can any of them still accept? An invitation link works only while it is
    // unrevoked and unexpired (the stored expiry mirrors the signed one).
    const now = Date.now();
    const live = open.filter(r => r.wmkf_externaltokenrevoked !== true && r.wmkf_externaltokenexpires && Date.parse(r.wmkf_externaltokenexpires) > now);
    const liveExpiries = live.map(r => day(r.wmkf_externaltokenexpires)).sort();
    const sent = open.map(r => day(r.wmkf_emailsentat)).filter(Boolean).sort();
    out.pr562.d26OpenInvitationLinks = {
      revoked: open.filter(r => r.wmkf_externaltokenrevoked === true).length,
      expired: open.filter(r => r.wmkf_externaltokenrevoked !== true && r.wmkf_externaltokenexpires && Date.parse(r.wmkf_externaltokenexpires) <= now).length,
      noStoredExpiry: open.filter(r => r.wmkf_externaltokenrevoked !== true && !r.wmkf_externaltokenexpires).length,
      stillValid: live.length,
      stillValidLatestExpiry: liveExpiries[liveExpiries.length - 1] || null,
      invitationsSentBetween: sent.length ? [sent[0], sent[sent.length - 1]] : null,
      reviewStatusSet: open.filter(r => r.wmkf_reviewstatus != null).length,
    };
    // Where to find the still-valid ones in the Review Manager (no names).
    out.pr562.d26StillValidInvitations = [];
    for (const r of live) {
      const req = (await client.get(`/akoya_requests(${r._wmkf_request_value})?$select=akoya_requestnum,akoya_requeststatus,wmkf_istestrequest,wmkf_testcreationrunid`)).body;
      out.pr562.d26StillValidInvitations.push({ requestNumber: req?.akoya_requestnum || null, suggestionId: r.wmkf_appreviewersuggestionid, invitationSent: day(r.wmkf_emailsentat), linkExpires: day(r.wmkf_externaltokenexpires),
        testRequest: req?.wmkf_istestrequest ?? null, testRunIdPresent: Boolean(req?.wmkf_testcreationrunid), requestStatus: req?.akoya_requeststatus || null });
    }
    out.pr562.check3c_noD26InviteeCanStillAccept = live.length === 0 && open.every(r => r.wmkf_externaltokenrevoked === true || r.wmkf_externaltokenexpires);

    const finder = await getAll(client, `/wmkf_appgrantcycles?$select=wmkf_shortcode&$filter=wmkf_shortcode eq '${q(FINDER_CYCLE)}'`);
    out.pr562.check3b_j27FinderCycleExists = finder.length === 1;

    const prefs = await getAll(client, "/wmkf_appuserpreferences?$select=wmkf_preferencevalue,wmkf_isencrypted&$filter=wmkf_preferencekey eq 'reviewer_email_templates'");
    let encrypted = 0; let unparseable = 0; let materialsOverrides = 0; let missingLink = 0;
    for (const row of prefs) {
      if (row.wmkf_isencrypted) { encrypted++; continue; }
      let parsed; try { parsed = JSON.parse(row.wmkf_preferencevalue); } catch { unparseable++; continue; }
      const m = parsed?.materials;
      if (!m || (!m.subject && !m.body)) continue;
      materialsOverrides++;
      if (!`${m.subject || ''}\n${m.body || ''}`.includes('{{externalLink}}')) missingLink++;
    }
    out.pr562.pdTemplatePreferences = { total: prefs.length, materialsOverrides, materialsOverridesWithoutExternalLink: missingLink, encrypted, unparseable };
    out.pr562.check4_noMaterialsOverrideDropsLink = missingLink === 0 && encrypted === 0 && unparseable === 0;
  } finally {
    await pool.end();
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch(error => { console.error(`Pre-merge probe failed: ${error.message}`); process.exitCode = 1; });
