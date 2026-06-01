/**
 * Read-only probe (S209) — verifies the live-Dataverse claims the memory audit
 * flagged NEEDS_PROBE / UNVERIFIABLE-FROM-CODE. No writes. Throwaway.
 */
const fs = require('fs'), path = require('path');
const ep = path.join('/Users/gallivan/Code/WMKF_Apps', '.env.local');
for (const line of fs.readFileSync(ep, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue;
  let [, k, v] = m; v = v.trim().replace(/^"(.*)"$/, '$1'); if (!process.env[k]) process.env[k] = v;
}
async function tok() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.DYNAMICS_CLIENT_ID, client_secret: process.env.DYNAMICS_CLIENT_SECRET, scope: `${process.env.DYNAMICS_URL}/.default` }),
  });
  if (!r.ok) throw new Error('token ' + r.status); return (await r.json()).access_token;
}
async function raw(t, urlPath) {
  const r = await fetch(`${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`, {
    headers: { Authorization: `Bearer ${t}`, Accept: 'application/json', Prefer: 'odata.include-annotations="*"', 'Consistency': 'Strong' },
  });
  const txt = await r.text(); let body; try { body = JSON.parse(txt); } catch { body = txt; }
  return { ok: r.ok, status: r.status, body };
}
async function count(t, set, filter) {
  const q = `/${set}?$count=true&$top=1${filter ? `&$filter=${encodeURIComponent(filter)}` : ''}`;
  const r = await raw(t, q);
  if (!r.ok) return `ERR ${r.status} ${typeof r.body === 'string' ? r.body.slice(0, 80) : JSON.stringify(r.body).slice(0, 120)}`;
  return r.body['@odata.count'];
}
async function exists(t, set) { const r = await raw(t, `/${set}?$top=1`); return r.ok ? `EXISTS (${r.status})` : `MISSING (${r.status})`; }

(async () => {
  const t = await tok();
  const P = (label, val) => console.log(`  ${label}: ${val}`);

  console.log('\n=== A. Entity existence (slice0 deployment claims) ===');
  for (const set of ['wmkf_proposalbudgetlines', 'wmkf_portalmemberships', 'wmkf_apprequestpersons', 'wmkf_ai_runs', 'wmkf_appgrantcycles', 'wmkf_appreviewersuggestions']) {
    P(set, await exists(t, set));
  }

  console.log('\n=== B. Row counts (refresh dated stats) ===');
  P('wmkf_ai_prompts (memory says 11)', await count(t, 'wmkf_ai_prompts'));
  P('wmkf_ai_runs (memory says 329)', await count(t, 'wmkf_ai_runs'));
  P('wmkf_appgrantcycles (memory says 10)', await count(t, 'wmkf_appgrantcycles'));
  P('wmkf_apprequestpersons (memory says 5561)', await count(t, 'wmkf_apprequestpersons'));

  console.log('\n=== C. akoya_request wmkf_ai_* attributes (field sets + cruft) ===');
  try {
    const r = await raw(t, `/EntityDefinitions(LogicalName='akoya_request')/Attributes?$select=LogicalName&$filter=startswith(LogicalName,'wmkf_ai')`);
    if (r.ok) {
      const names = (r.body.value || []).map(a => a.LogicalName).sort();
      P('count wmkf_ai_* attrs', names.length);
      P('double-underscore cruft wmkf__ai_*', names.filter(n => n.startsWith('wmkf__ai')).join(', ') || 'NONE');
      P('wmkf_ai_rundatetime present?', names.includes('wmkf_ai_rundatetime'));
      console.log('   all:', names.join(', '));
    } else P('attr metadata', `ERR ${r.status}`);
  } catch (e) { P('attr metadata', 'EXC ' + e.message); }

  console.log('\n=== D. wmkf_apprequestperson role distribution (slice0-role) ===');
  try {
    const r = await raw(t, `/wmkf_apprequestpersons?$apply=groupby((wmkf_role),aggregate($count as ct))`);
    if (r.ok) for (const g of (r.body.value || [])) P(`role ${g.wmkf_role}`, g.ct);
    else P('groupby', `ERR ${r.status} (will fall back)`);
  } catch (e) { P('groupby', 'EXC ' + e.message); }

  console.log('\n=== E. Payment semantics spot-check (akoya-payment) ===');
  try {
    const r = await raw(t, `/akoya_requests?$select=akoya_requestnum,akoya_folio,akoya_paymentsent,wmkf_vendorverified&$filter=akoya_folio eq 'PAID'&$top=6`);
    if (r.ok) for (const x of (r.body.value || [])) P(`#${x.akoya_requestnum}`, `folio=${x.akoya_folio} paymentsent=${x.akoya_paymentsent} vendorverified=${x.wmkf_vendorverified}`);
    else P('paid sample', `ERR ${r.status}`);
  } catch (e) { P('paid sample', 'EXC ' + e.message); }

  console.log('\n=== F. CRM users (memory: 16 licensed + ~180 service) ===');
  P('systemusers total', await count(t, 'systemusers'));
  P('systemusers isdisabled=false', await count(t, 'systemusers', 'isdisabled eq false'));
  P('systemusers applicationid ne null (app/service)', await count(t, 'systemusers', 'applicationid ne null'));

  console.log('\n=== G. D26 suggestion rows re-confirm (probed fresh today) ===');
  P('appreviewersuggestions total', await count(t, 'wmkf_appreviewersuggestions'));

  console.log('\n=== H. Research-Reviewer honorarium akoya_requests (reviewer-identity ~87) ===');
  try {
    const r = await raw(t, `/akoya_requests?$select=akoya_requestid&$filter=akoya_program eq 'Research Reviewer'&$count=true&$top=1`);
    P("akoya_program='Research Reviewer'", r.ok ? r.body['@odata.count'] : `ERR ${r.status}`);
  } catch (e) { P('research-reviewer', 'EXC ' + e.message); }
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
