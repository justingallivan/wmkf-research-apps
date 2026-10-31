#!/usr/bin/env node
/**
 * Reset a wmkf_appreviewersuggestion row to clean pre-materials Stage 2a
 * state. Clears engagement fields touched by accept/decline so the row
 * lands at view='stage2a' on the next /context load.
 *
 * Token hash + expiry are LEFT IN PLACE — the JWT you minted still works.
 *
 * Test rows only: refuses unless the parent request is positively marked as a
 * test request (wmkf_istestrequest or wmkf_testcreationrunid), and binds the
 * write to the row version it read. A real reviewer's response is never
 * cleared (INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31).
 *
 * Usage: node scripts/reset-stage2a-state.js <suggestionId>
 */

require('./../lib/dataverse/client').loadEnvLocal();

(async () => {
  const id = process.argv[2];
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    console.error('Usage: node scripts/reset-stage2a-state.js <suggestionId>');
    process.exit(2);
  }
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');

  return bypassDynamicsRestrictions('reset', async () => {
    const row = await DynamicsService.getRecord('wmkf_appreviewersuggestions', id, { select: '_wmkf_request_value' });
    if (!row?._wmkf_request_value || !row._etag) throw new Error('Refusing: suggestion has no parent request or no ETag.');
    const request = await DynamicsService.getRecord('akoya_requests', row._wmkf_request_value, {
      select: 'akoya_requestnum,wmkf_istestrequest,wmkf_testcreationrunid',
    });
    if (request?.wmkf_istestrequest !== true && !request?.wmkf_testcreationrunid) {
      throw new Error(`Refusing: request ${request?.akoya_requestnum || row._wmkf_request_value} is not a test request.`);
    }
    await DynamicsService.updateRecord('wmkf_appreviewersuggestions', id, {
      wmkf_accepted: false,
      wmkf_declined: false,
      wmkf_responsetype: null,
      wmkf_responsereceivedat: null,
      wmkf_declinereason: null,
      wmkf_declinereasonpicklist: null,
      wmkf_declinereferral: null,
      wmkf_coiackedat: null,
      wmkf_aiuseackedat: null,
      'wmkf_CoiPolicyVersion@odata.bind': null,
      'wmkf_AiUsePolicyVersion@odata.bind': null,
      wmkf_proposalfirstaccessed: null,
    }, { ifMatch: row._etag });
    console.log('Reset', id, 'to clean Stage 2a state.');
  });
})().catch((e) => { console.error(e.message); process.exit(1); });
