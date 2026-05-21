#!/usr/bin/env node
/**
 * READ-ONLY: count "stuck" reviewer suggestions per grant cycle, where
 * "stuck" = wmkf_invited=true (or wmkf_emailsentat populated) AND no
 * accepted / declined / responseType set.
 *
 * Reports per cycle so we can pick which cycle(s) to backfill to
 * wmkf_responsetype = no_response.
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

function meetingDateToCycle(d) {
  if (!d) return null;
  const date = new Date(d);
  const month = date.getUTCMonth() + 1;
  const yy = date.getUTCFullYear() % 100;
  const pad = (n) => String(n).padStart(2, '0');
  if (month === 6) return `J${pad(yy)}`;
  if (month === 12) return `D${pad(yy)}`;
  return `?${date.getUTCFullYear()}-${pad(month)}`;
}

(async () => {
  const token = await getToken();
  console.log(`Probe: stuck invites by cycle — ${new Date().toISOString()}\n`);

  // 1. Pull all selected suggestions with non-null wmkf_emailsentat (= invited).
  const sugs = await getAll(token, 'wmkf_appreviewersuggestions',
    new URLSearchParams({
      $select: 'wmkf_appreviewersuggestionid,wmkf_invited,wmkf_accepted,wmkf_declined,wmkf_responsetype,wmkf_grantcyclecode,wmkf_emailsentat,_wmkf_request_value',
      $filter: 'wmkf_emailsentat ne null and wmkf_selected eq true',
    }).toString());

  console.log(`Loaded ${sugs.length} selected suggestions with emailsentat populated.`);

  const stuck = sugs.filter((s) =>
    !s.wmkf_accepted && !s.wmkf_declined && (s.wmkf_responsetype === null || s.wmkf_responsetype === undefined),
  );
  console.log(`Of those, stuck (no accepted/declined/responsetype): ${stuck.length}\n`);

  // 2. Resolve cycle for each. Prefer suggestion-level wmkf_grantcyclecode;
  //    fall back to the request's meeting-date-derived cycle code.
  const needsRequestLookup = stuck.filter((s) => !s.wmkf_grantcyclecode).map((s) => s._wmkf_request_value).filter(Boolean);
  const uniqRequestIds = [...new Set(needsRequestLookup)];
  const reqCycle = {};
  if (uniqRequestIds.length) {
    const CHUNK = 25;
    for (let i = 0; i < uniqRequestIds.length; i += CHUNK) {
      const chunk = uniqRequestIds.slice(i, i + CHUNK);
      const filter = chunk.map((id) => `akoya_requestid eq ${id}`).join(' or ');
      const reqs = await getAll(token, 'akoya_requests',
        new URLSearchParams({
          $select: 'akoya_requestid,wmkf_meetingdate',
          $filter: filter,
        }).toString());
      for (const r of reqs) reqCycle[r.akoya_requestid] = meetingDateToCycle(r.wmkf_meetingdate);
    }
  }

  // 3. Group by cycle.
  const byCycle = {};
  for (const s of stuck) {
    const code = s.wmkf_grantcyclecode || reqCycle[s._wmkf_request_value] || '(unknown)';
    byCycle[code] = (byCycle[code] || 0) + 1;
  }

  const sortedCycles = Object.entries(byCycle).sort((a, b) => {
    // Sort by year then month: D26, J26, D25, J25, ...
    const parse = (c) => {
      const m = c.match(/^([JD])(\d{2})$/);
      if (!m) return { y: -1, mo: 0 };
      return { y: 2000 + parseInt(m[2], 10), mo: m[1] === 'D' ? 12 : 6 };
    };
    const pa = parse(a[0]), pb = parse(b[0]);
    return (pb.y - pa.y) || (pb.mo - pa.mo);
  });

  console.log(`Stuck-invite counts by cycle (most recent first):\n`);
  for (const [cycle, n] of sortedCycles) {
    console.log(`  ${cycle.padEnd(10)} : ${n}`);
  }
  console.log(`\n  total stuck                  : ${stuck.length}`);
  console.log(`  total emailed but selected   : ${sugs.length}`);
  console.log(`  share stuck                  : ${(100 * stuck.length / Math.max(1, sugs.length)).toFixed(1)}%`);
})().catch((e) => { console.error(e); process.exit(1); });
