#!/usr/bin/env node
/**
 * One-off backfill: close J26 reviewer invitations that never received a
 * response. After the J26 invite window closed, 27 selected suggestions
 * had wmkf_emailsentat populated but no accepted / declined / responsetype
 * — leaving them stuck in "pending" forever in the My Candidates UI. This
 * script flips them to wmkf_responsetype=no_response with
 * wmkf_responsereceivedat=<today>.
 *
 * Re-derives the J26 stuck set at runtime (does NOT hardcode ids) so it's
 * idempotent — re-running after a partial failure or after a new stuck row
 * appears will only touch suggestions still in the stuck state.
 *
 * Dry-run by default. Pass --execute to apply.
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}

const EXECUTE = process.argv.includes('--execute');
const TARGET_CYCLE = 'J26';
const NO_RESPONSE_OPTION = 100000002; // RESPONSE_TYPE_MAP.no_response
const NOW_ISO = new Date().toISOString();

async function getToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET, scope: `${process.env.DYNAMICS_URL}/.default`,
    }),
  });
  if (!r.ok) throw new Error(`Token: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}

async function getAll(token, entitySet, query) {
  let url = `${process.env.DYNAMICS_URL}/api/data/v9.2/${entitySet}?${query}`;
  const out = [];
  while (url) {
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0',
        Prefer: 'odata.maxpagesize=5000',
      },
    });
    const t = await r.text();
    let body; try { body = JSON.parse(t); } catch { body = t; }
    if (!r.ok) throw new Error(`GET ${url}: ${r.status} ${typeof body === 'string' ? body.slice(0, 240) : JSON.stringify(body).slice(0, 240)}`);
    out.push(...(body.value || []));
    url = body['@odata.nextLink'] || null;
  }
  return out;
}

async function patch(token, urlPath, payload) {
  const r = await fetch(`${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      Accept: 'application/json', 'OData-Version': '4.0', 'If-Match': '*',
    },
    body: JSON.stringify(payload),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`PATCH ${urlPath}: ${r.status} ${t.slice(0, 400)}`);
}

function meetingDateToCycle(d) {
  if (!d) return null;
  const date = new Date(d);
  const month = date.getUTCMonth() + 1;
  const yy = date.getUTCFullYear() % 100;
  const pad = (n) => String(n).padStart(2, '0');
  if (month === 6) return `J${pad(yy)}`;
  if (month === 12) return `D${pad(yy)}`;
  return null;
}

(async () => {
  const token = await getToken();
  console.log(`backfill-j26-stuck-invites-no-response — mode=${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}\n`);
  console.log(`target cycle              : ${TARGET_CYCLE}`);
  console.log(`wmkf_responsetype         : ${NO_RESPONSE_OPTION}  (no_response)`);
  console.log(`wmkf_responsereceivedat   : ${NOW_ISO}\n`);

  const sugs = await getAll(token, 'wmkf_appreviewersuggestions',
    new URLSearchParams({
      $select: 'wmkf_appreviewersuggestionid,wmkf_invited,wmkf_accepted,wmkf_declined,wmkf_responsetype,wmkf_grantcyclecode,wmkf_emailsentat,_wmkf_request_value',
      $filter: 'wmkf_emailsentat ne null and wmkf_selected eq true',
    }).toString());

  // Stuck = no accepted / declined / responsetype.
  const stuck = sugs.filter((s) =>
    !s.wmkf_accepted && !s.wmkf_declined && (s.wmkf_responsetype === null || s.wmkf_responsetype === undefined),
  );

  // Cycle resolution: prefer suggestion-level wmkf_grantcyclecode, fall back to
  // the request's meeting date.
  const needsLookup = stuck.filter((s) => !s.wmkf_grantcyclecode).map((s) => s._wmkf_request_value).filter(Boolean);
  const uniq = [...new Set(needsLookup)];
  const reqCycle = {};
  if (uniq.length) {
    const CHUNK = 25;
    for (let i = 0; i < uniq.length; i += CHUNK) {
      const chunk = uniq.slice(i, i + CHUNK);
      const filter = chunk.map((id) => `akoya_requestid eq ${id}`).join(' or ');
      const reqs = await getAll(token, 'akoya_requests',
        new URLSearchParams({
          $select: 'akoya_requestid,wmkf_meetingdate,akoya_requestnum',
          $filter: filter,
        }).toString());
      for (const r of reqs) reqCycle[r.akoya_requestid] = { cycle: meetingDateToCycle(r.wmkf_meetingdate), num: r.akoya_requestnum };
    }
  }

  const targets = stuck.filter((s) => {
    const cycle = s.wmkf_grantcyclecode || reqCycle[s._wmkf_request_value]?.cycle;
    return cycle === TARGET_CYCLE;
  });

  console.log(`Found ${stuck.length} stuck suggestion(s) overall; ${targets.length} in ${TARGET_CYCLE}.\n`);

  if (targets.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  for (const s of targets) {
    const req = reqCycle[s._wmkf_request_value];
    const reqLabel = req?.num ? `req #${req.num}` : `req ${s._wmkf_request_value.slice(0, 8)}`;
    console.log(`  ${s.wmkf_appreviewersuggestionid}  ${reqLabel}  emailsentat=${s.wmkf_emailsentat?.slice(0, 10)}`);
  }

  if (!EXECUTE) {
    console.log(`\nDry run. Re-run with --execute to apply.`);
    return;
  }

  console.log(`\nExecuting ${targets.length} PATCH(es)...`);
  let ok = 0, failed = 0;
  for (const s of targets) {
    try {
      await patch(token, `/wmkf_appreviewersuggestions(${s.wmkf_appreviewersuggestionid})`, {
        wmkf_responsetype: NO_RESPONSE_OPTION,
        wmkf_responsereceivedat: NOW_ISO,
      });
      ok++;
    } catch (e) {
      failed++;
      console.error(`  ✗ ${s.wmkf_appreviewersuggestionid}: ${e.message.slice(0, 200)}`);
    }
  }
  console.log(`\nDone. ok=${ok} failed=${failed}`);
})().catch((e) => { console.error(e); process.exit(1); });
