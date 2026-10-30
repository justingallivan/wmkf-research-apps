#!/usr/bin/env node
/**
 * Smoke: validate the data shape /api/review-manager/reviewers would return,
 * by exercising the suggestion adapter's findAcceptedByPD directly.
 *
 * Usage:
 *   node scripts/smoke-review-manager.js [email] [cycleCode?]
 */

require('./../lib/dataverse/client').loadEnvLocal();

(async () => {
  const email = process.argv[2] || 'jgallivan@wmkeck.org';
  const cycleCode = process.argv[3] || null;

  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
  const suggestionAdapter = await import('../lib/dataverse/adapters/reviewer-suggestion.js');
  return bypassDynamicsRestrictions('smoke', async () => {

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

  const { suggestions, requestById } = await suggestionAdapter.findAcceptedByPD(pd.systemuserid, { cycleCode });
  console.log(`\nAccepted suggestions: ${suggestions.length} across ${Object.keys(requestById).length} request(s)`);

  const byReq = {};
  for (const s of suggestions) (byReq[s._wmkf_request_value] ||= []).push(s);

  for (const [rid, sgs] of Object.entries(byReq)) {
    const r = requestById[rid];
    console.log(`\n• ${r.title || '(no title)'} — request ${r.requestNumber} — ${r.cycleCode || 'no cycle'}`);
    for (const s of sgs) {
      const status = typeof s.wmkf_reviewstatus === 'number' ? `code=${s.wmkf_reviewstatus}` : '(none)';
      const lc = [
        s.wmkf_invited && 'invited',
        s.wmkf_accepted && 'accepted',
        s.wmkf_declined && 'declined',
      ].filter(Boolean).join(',') || 'pending';
      console.log(`    · ${s.wmkf_suggestionlabel}  [${lc}] status=${status} sent=${!!s.wmkf_materialssentat} received=${!!s.wmkf_reviewreceivedat}`);
    }
  }
  process.exit(0);
  });
})().catch((e) => { console.error(e.message); process.exit(1); });
