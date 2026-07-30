#!/usr/bin/env node

/**
 * Preflight smoke test for the grantee submit-visibility work
 * (docs/GRANTEE_SUBMIT_VISIBILITY_SPEC.md): the PD submit notification and the
 * Awardee-tab caption/image surface.
 *
 * Both features were shipped with unit coverage but never exercised against live
 * Dataverse. Every check here is a LIVE assumption that unit tests mock away and
 * that fails SILENTLY in production if wrong — a null PI name, an unresolvable PD,
 * a mis-named field, a link that renders broken.
 *
 * STRICTLY READ-ONLY. No writes, no emails, no residue. Exit 0 = every hard check
 * passed. Exit 1 = at least one hard check failed. Warnings never fail the run;
 * they flag configuration a human must decide about.
 *
 *   node scripts/smoke-grantee-submit-visibility.mjs
 *   node scripts/smoke-grantee-submit-visibility.mjs --request 1002794
 *   node scripts/smoke-grantee-submit-visibility.mjs --json
 *
 * NOT covered (cannot be, read-only / out-of-store):
 *   - the M365 send itself — use the /test-email page for that leg
 *   - the system_alerts (Postgres) insert — covered by unit tests + /admin alerts
 *   - waitUntil lifecycle behavior — only observable on a real Vercel invocation
 * A post-deploy submit against a real package remains the final gate.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const REQUEST_NUM = (() => {
  const i = args.indexOf('--request');
  return i >= 0 ? args[i + 1] : null;
})();

const BASE = `${process.env.DYNAMICS_URL}/api/data/v9.2`;
const results = [];
const log = (...a) => { if (!JSON_OUT) console.log(...a); };

/** Hard check: a failure means the feature is broken in this environment. */
function check(name, ok, detail) {
  results.push({ name, level: 'check', ok, detail });
  log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}
/** Soft check: configuration a human must decide about; never fails the run. */
function warn(name, ok, detail) {
  results.push({ name, level: 'warn', ok, detail });
  log(`  ${ok ? 'ok  ' : 'WARN'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

async function token() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET,
      scope: `${process.env.DYNAMICS_URL}/.default`,
    }),
  });
  if (!r.ok) throw new Error(`token ${r.status}`);
  return (await r.json()).access_token;
}

/**
 * GET with the SAME Prefer header the app sends (lib/services/dynamics/http.js).
 * That header is what produces the FormattedValue annotations the PI name depends
 * on, so probing without it would prove nothing about the app's behavior.
 */
async function get(tok, urlPath) {
  const r = await fetch(`${BASE}${urlPath}`, {
    headers: {
      Authorization: `Bearer ${tok}`,
      Accept: 'application/json',
      'OData-Version': '4.0',
      Prefer: 'odata.include-annotations="*",odata.maxpagesize=100',
    },
  });
  const text = await r.text();
  return { status: r.status, ok: r.ok, body: text && text[0] === '{' ? JSON.parse(text) : text };
}

const FORMATTED = '@OData.Community.Display.V1.FormattedValue';
const isAbsoluteHttp = (ref) => {
  try {
    const u = new URL(String(ref));
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch { return false; }
};

(async () => {
  for (const v of ['DYNAMICS_URL', 'DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET']) {
    if (!process.env[v]) {
      console.error(`Missing ${v} — cannot run. See docs/CREDENTIALS_RUNBOOK.md.`);
      process.exit(2);
    }
  }
  const tok = await token();

  // Which Dataverse this run actually probed. A green result means nothing if the
  // reader assumes production and the env pointed somewhere else — the same
  // hostname ambiguity the target/write interlock exists to police.
  log(`\nTarget: ${process.env.DYNAMICS_URL}`);
  results.push({ name: 'target', level: 'info', ok: true, detail: process.env.DYNAMICS_URL });

  // ── 1. Environment contract ────────────────────────────────────────────────
  // Neither of these throws at runtime; each degrades silently, which is exactly
  // why they belong in a smoke test rather than a code guard.
  log('\nEnvironment');
  warn(
    'NOTIFICATION_EMAIL_FROM is set',
    Boolean(process.env.NOTIFICATION_EMAIL_FROM),
    process.env.NOTIFICATION_EMAIL_FROM
      ? 'sender configured'
      : 'UNSET → notify() logs "skipped (no sender configured)" and NO email is sent; the alert row still writes',
  );
  const origin = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
  const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(origin);
  warn(
    'NEXTAUTH_URL is set (Awardee-tab deep link origin)',
    Boolean(origin),
    origin
      ? `links will read ${origin}/workbench/<id>?tab=awardee`
      : 'UNSET → the deep link degrades to a relative path, which is not clickable from an email client',
  );
  if (origin) {
    // "Set" is not the bar: a localhost origin is correct locally and useless in a
    // real inbox, and nothing at runtime will complain about it.
    warn(
      'NEXTAUTH_URL is a reachable origin for an email recipient',
      !localOrigin,
      localOrigin
        ? `LOCAL origin (${origin}) — fine for a local run, but if this is what Preview/Production carries, every deep link in a sent notification points at the recipient's own machine`
        : 'non-local origin',
    );
  }

  // ── 2. Alert routing for the new category ──────────────────────────────────
  log('\nAlert routing');
  const settings = await get(
    tok,
    "/wmkf_appsystemsettings?$select=wmkf_settingkey,wmkf_settingvalue&$filter=wmkf_settingkey eq 'alertRecipientsByCategory'&$top=1",
  );
  check('alertRecipientsByCategory setting is readable', settings.ok, settings.ok ? undefined : `HTTP ${settings.status}`);
  let categoryRecipients = null;
  if (settings.ok) {
    const raw = settings.body?.value?.[0]?.wmkf_settingvalue;
    let cfg = null;
    try { cfg = raw ? JSON.parse(raw) : null; } catch { /* reported below */ }
    check('alertRecipientsByCategory parses as JSON', !raw || cfg !== null, raw ? undefined : 'no setting row yet');
    categoryRecipients = cfg?.['grantee-deliverables'] || null;
    warn(
      "'grantee-deliverables' category has configured recipients",
      Array.isArray(categoryRecipients) && categoryRecipients.length > 0,
      categoryRecipients?.length
        ? `${categoryRecipients.length} recipient(s)`
        : "unconfigured → routing falls back to default/superuser roster. The PD still receives it via explicitRecipients; configure in /admin → Alert Recipients if a shared mailbox should also get it",
    );
  }

  // ── 3. Pick a live research award to probe ─────────────────────────────────
  log('\nSample award');
  const filter = REQUEST_NUM
    ? `akoya_requestnum eq '${String(REQUEST_NUM).replace(/'/g, "''")}'`
    : "akoya_requeststatus eq 'Active' and _wmkf_projectleader_value ne null and _wmkf_programdirector_value ne null";
  const sample = await get(
    tok,
    `/akoya_requests?$select=akoya_requestid,akoya_requestnum,akoya_title&$filter=${encodeURIComponent(filter)}&$top=1`,
  );
  const award = sample.body?.value?.[0];
  if (!check('found an award to probe', Boolean(award?.akoya_requestid), award ? `request ${award.akoya_requestnum}` : (REQUEST_NUM ? `no request ${REQUEST_NUM}` : 'no Active award with both a PI and a PD'))) {
    return finish();
  }
  const requestId = award.akoya_requestid;

  // ── 4. Feature 1 — the recipient path ──────────────────────────────────────
  // These are the exact two reads lib/services/grantee-submit-notification.js
  // makes. If either shape differs live, the notification degrades in silence:
  // a null PI name, or an empty explicitRecipients that nobody notices.
  log('\nFeature 1 — notification recipients');
  const piRead = await get(tok, `/akoya_requests(${requestId})?$select=_wmkf_projectleader_value`);
  check('request read for the PI lookup succeeds', piRead.ok, piRead.ok ? undefined : `HTTP ${piRead.status}`);
  const piFormatted = piRead.body?.[`_wmkf_projectleader_value${FORMATTED}`];
  check(
    'PI name arrives as a FormattedValue annotation',
    Boolean(piFormatted),
    piFormatted
      ? `metadata.pi = "${piFormatted}"`
      : 'MISSING → notification says "The grantee" and records pi: null. The app relies on the Prefer: odata.include-annotations header producing this',
  );

  const pdRead = await get(tok, `/akoya_requests(${requestId})?$select=_wmkf_programdirector_value`);
  const pdId = pdRead.body?._wmkf_programdirector_value;
  check('request has an assigned Program Director', Boolean(pdId), pdId ? undefined : 'no PD → explicitRecipients is empty and only category recipients are emailed');
  if (pdId) {
    const pd = await get(tok, `/systemusers(${pdId})?$select=internalemailaddress,isdisabled`);
    check('PD systemuser read succeeds', pd.ok, pd.ok ? undefined : `HTTP ${pd.status}`);
    const email = pd.body?.internalemailaddress;
    check('PD has an internalemailaddress', Boolean(email), email || 'MISSING → PD cannot be an explicit recipient');
    check('PD account is enabled', pd.body?.isdisabled === false, pd.body?.isdisabled === false ? undefined : 'disabled → resolver returns null by design');
    if (email) {
      // The resolver lowercases; AlertRecipients lowercases category addresses; the
      // union dedupe is case-SENSITIVE. A mixed-case stored address is fine BECAUSE
      // the resolver normalizes — this reports whether that normalization is load-
      // bearing for this PD rather than incidental.
      const normalized = String(email).trim().toLowerCase();
      warn(
        'PD address needs normalization to dedupe correctly',
        true,
        normalized === email
          ? 'stored address is already lowercase'
          : `stored "${email}" → normalized "${normalized}" (the resolver's lowercasing is what prevents a double-send here)`,
      );
    }
  }

  // ── 5. Feature 2 — the Awardee-tab read ────────────────────────────────────
  // The select must include wmkf_waiverackedat: a wrong field name is a 400, not
  // a null, so this proves the field exists under the name the code uses.
  log('\nFeature 2 — Awardee-tab submission fields');
  const DELIVERABLE_SELECT = [
    'wmkf_granteedeliverableid', 'wmkf_deliverablestatus',
    'wmkf_imagefileref', 'wmkf_imagecaption', 'wmkf_waiverackedat',
  ].join(',');
  const deliverables = await get(
    tok,
    `/wmkf_granteedeliverables?$select=${DELIVERABLE_SELECT}&$orderby=modifiedon desc&$top=50`,
  );
  check(
    'deliverable select incl. wmkf_waiverackedat is valid',
    deliverables.ok,
    deliverables.ok ? undefined : `HTTP ${deliverables.status} — a 400 here means a field name in DELIVERABLE_SELECT is wrong`,
  );

  const rows = deliverables.body?.value || [];
  const withImage = rows.filter((r) => r.wmkf_imagefileref);
  log(`  ...  ${rows.length} deliverable row(s) sampled, ${withImage.length} with an image ref`);

  if (withImage.length === 0) {
    warn(
      'live image refs available to classify',
      false,
      'no submitted package with an image yet — the imageUrl branch is unproven against real data. Re-run after the first real submission',
    );
  } else {
    // THE TRAP the unit tests were written for: grantee-upload falls back to a
    // RELATIVE library path when Graph returns no webUrl. Absolute refs become
    // links; relative ones must render as text. Classify what actually exists.
    const absolute = withImage.filter((r) => isAbsoluteHttp(r.wmkf_imagefileref));
    const relative = withImage.filter((r) => !isAbsoluteHttp(r.wmkf_imagefileref));
    check(
      'every stored image ref is classifiable',
      absolute.length + relative.length === withImage.length,
      `${absolute.length} absolute (render as a link) / ${relative.length} relative (render as text)`,
    );
    if (relative.length) {
      warn(
        'some refs are relative paths',
        false,
        `${relative.length} row(s) — these correctly render as plain text, NOT links. Expected only when Graph returned no webUrl; e.g. "${relative[0].wmkf_imagefileref}"`,
      );
    }
    const waiverStamped = withImage.filter((r) => r.wmkf_waiverackedat);
    warn(
      'submitted packages carry a waiver timestamp',
      waiverStamped.length === withImage.length,
      `${waiverStamped.length}/${withImage.length} — rows without one show no date line (the tab labels it "Waiver acknowledged", never "Submitted")`,
    );
  }

  return finish();
})().catch((e) => {
  console.error(`\nsmoke-grantee-submit-visibility FAILED to run: ${e.message}`);
  process.exit(2);
});

function finish() {
  const hard = results.filter((r) => r.level === 'check');
  const failed = hard.filter((r) => !r.ok);
  const warned = results.filter((r) => r.level === 'warn' && !r.ok);

  if (JSON_OUT) {
    console.log(JSON.stringify({
      ok: failed.length === 0,
      checks: hard.length,
      failed: failed.length,
      warnings: warned.length,
      results,
    }, null, 2));
  } else {
    console.log(`\n${failed.length === 0 ? 'PASS' : 'FAIL'} — ${hard.length - failed.length}/${hard.length} hard check(s) passed, ${warned.length} warning(s).`);
    if (warned.length) console.log('Warnings are configuration decisions, not breakage:');
    for (const w of warned) console.log(`  - ${w.name}: ${w.detail}`);
    if (failed.length) {
      console.log('Failures:');
      for (const f of failed) console.log(`  - ${f.name}: ${f.detail || ''}`);
    }
    console.log('\nNot covered here: the M365 send (use /test-email), the system_alerts insert, and waitUntil lifecycle. A real submitted package remains the final gate.');
  }
  process.exit(failed.length === 0 ? 0 : 1);
}
