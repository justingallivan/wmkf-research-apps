#!/usr/bin/env node
/**
 * Smoke: validate the data shape /api/reviewer-finder/my-candidates would
 * return, by querying Dataverse directly. No auth, no adapter imports
 * (raw Node ESM can't resolve the extensionless DynamicsService import).
 *
 * Usage:
 *   node scripts/smoke-my-candidates.js [email] [cycleCode?]
 */

require('./../lib/dataverse/client').loadEnvLocal();

(async () => {
  const email = process.argv[2] || 'jgallivan@wmkeck.org';
  const cycleCode = process.argv[3] || null;

  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
  const { cycleCodeToLabel } = await import('../lib/utils/cycle-code.js');
  const { linkedCycleCode, linkedCycleExpand, linkedCycleFilter } =
    await import('../lib/dataverse/adapters/operations-grant-cycle.js');
  return bypassDynamicsRestrictions('smoke', async () => {

  // Resolve PD
  const escaped = email.replace(/'/g, "''");
  const userQ = await DynamicsService.queryRecords('systemusers', {
    select: 'systemuserid,fullname',
    filter: `internalemailaddress eq '${escaped}'`,
    top: 1,
  });
  const pd = userQ.records[0];
  if (!pd) { console.error(`No systemuser for ${email}`); process.exit(1); }
  console.log(`PD: ${pd.fullname} (${pd.systemuserid})`);
  if (cycleCode) console.log(`Cycle filter: ${cycleCode}`);

  // Step 1: requests where I'm lead PD
  const reqFilters = [`_wmkf_programdirector_value eq ${pd.systemuserid}`];
  // A request's cycle is its Grant Cycle link (meeting-date retirement), as in the service.
  if (cycleCode) reqFilters.push(linkedCycleFilter(String(cycleCode).trim().toUpperCase()));
  const { records: requests } = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestid,akoya_requestnum,akoya_title,_wmkf_programareaserved_value',
    expand: linkedCycleExpand(),
    filter: reqFilters.join(' and '),
    top: 500,
  });
  console.log(`Requests where I'm PD: ${requests.length}`);

  if (requests.length === 0) return;

  // Step 2: suggestions on those requests
  const reqIds = requests.map((r) => r.akoya_requestid);
  const orChain = reqIds.map((id) => `_wmkf_request_value eq ${id}`).join(' or ');
  const { records: suggestions } = await DynamicsService.queryRecords('wmkf_appreviewersuggestions', {
    select: 'wmkf_appreviewersuggestionid,wmkf_suggestionlabel,wmkf_relevancescore,wmkf_invited,wmkf_accepted,wmkf_declined,wmkf_selected,_wmkf_request_value,_wmkf_potentialreviewer_value,wmkf_sources,createdon',
    filter: `(${orChain}) and wmkf_selected eq true`,
    top: 500,
  });
  console.log(`Selected suggestions across them: ${suggestions.length}`);

  // Group + display
  const reqById = Object.fromEntries(requests.map((r) => [r.akoya_requestid, r]));
  const byReq = {};
  for (const s of suggestions) {
    (byReq[s._wmkf_request_value] ||= []).push(s);
  }
  console.log('');
  for (const [rid, sgs] of Object.entries(byReq)) {
    const r = reqById[rid];
    const cc = linkedCycleCode(r);
    console.log(`• ${r.akoya_title || '(no title)'} — request ${r.akoya_requestnum} — ${cc} (${cycleCodeToLabel(cc) || 'no cycle'})`);
    for (const s of sgs) {
      const lc = [
        s.wmkf_invited && 'invited',
        s.wmkf_accepted && 'accepted',
        s.wmkf_declined && 'declined',
      ].filter(Boolean).join(',') || 'pending';
      console.log(`    · ${s.wmkf_suggestionlabel}  [${lc}]  score=${s.wmkf_relevancescore}`);
    }
  }
  });
})().catch((e) => { console.error(e.message); process.exit(1); });
