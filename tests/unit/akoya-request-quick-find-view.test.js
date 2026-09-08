import {
  FIELD,
  planQuickFindViewUpdate,
} from '../../scripts/lib/akoya-request-quick-find-view.mjs';
import {
  VIEW_ID,
  VIEW_NAME,
  VIEW_QUERY_TYPE,
  SOLUTION_UNIQUE_NAME,
  runUncertainDataverseMutation,
  assertApplyEnvironment,
  assertProductionResource,
  parseArgs,
  parseDatedProdWriteAck,
  applyViewPlan,
  validateTargetView,
} from '../../scripts/add-akoya-request-programid-quick-find-column.mjs';

const FETCH = '<fetch version="1.0"><entity name="akoya_request"><attribute name="akoya_requestnum"/><attribute name="wmkf_abstract"/></entity></fetch>';
const LAYOUT = '<grid name="resultset" object="1" jump="akoya_requestnum" select="1" preview="1"><row name="result" id="akoya_requestid"><cell name="akoya_requestnum" width="100"/><cell name="wmkf_abstract" width="100"/></row></grid>';
const COMPLETE_FETCH = '<fetch version="1.0"><entity name="akoya_request"><attribute name="akoya_requestnum"/><attribute name="akoya_programid"/></entity></fetch>';
const COMPLETE_LAYOUT = '<grid name="resultset" object="1" jump="akoya_requestnum" select="1" preview="1"><row name="result" id="akoya_requestid"><cell name="akoya_requestnum" width="100"/><cell name="akoya_programid" width="100"/></row></grid>';

describe('akoya_request Quick Find XML plan', () => {
  test('adds projection attribute and layout cell without adding a condition', () => {
    const plan = planQuickFindViewUpdate({ fetchxml: FETCH, layoutxml: LAYOUT });
    expect(plan.changed).toBe(true);
    expect(plan.fetchxml).toContain(`<attribute name="${FIELD}"/>`);
    expect(plan.layoutxml).toContain(`<cell name="${FIELD}" width="100"/>`);
    expect(plan.fetchxml).not.toContain('<condition');
  });

  test('is idempotent when both XML documents already contain exactly one field', () => {
    const plan = planQuickFindViewUpdate({ fetchxml: COMPLETE_FETCH, layoutxml: COMPLETE_LAYOUT });
    expect(plan).toMatchObject({ changed: false, reason: 'already-present' });
    expect(plan.fetchxml).toBe(COMPLETE_FETCH);
    expect(plan.layoutxml).toBe(COMPLETE_LAYOUT);
  });

  test.each([
    ['one-sided presence', COMPLETE_FETCH, LAYOUT],
    ['duplicate attribute', COMPLETE_FETCH.replace('</entity>', '<attribute name="akoya_programid"/></entity>'), COMPLETE_LAYOUT],
    ['duplicate cell', COMPLETE_FETCH, COMPLETE_LAYOUT.replace('</row>', '<cell name="akoya_programid" width="100"/></row>')],
    ['existing search condition', FETCH.replace('</entity>', '<condition attribute="akoya_programid" operator="like" value="%x%"/></entity>'), LAYOUT],
    ['unexpected entity', FETCH.replace('name="akoya_request"', 'name="contact"'), LAYOUT],
    ['malformed layout', FETCH, LAYOUT.replace('</grid>', '')],
  ])('fails closed on %s', (_label, fetchxml, layoutxml) => {
    expect(() => planQuickFindViewUpdate({ fetchxml, layoutxml })).toThrow();
  });
});

describe('Quick Find apply guards', () => {
  test('uses the canonical Dataverse solution unique name for modified artifacts', () => {
    expect(SOLUTION_UNIQUE_NAME).toBe('wmkfResearchReviewAppSuite');
  });

  test('accepts only the exact production origin and canonicalizes a trailing slash', () => {
    expect(assertProductionResource('https://wmkf.crm.dynamics.com')).toBe('https://wmkf.crm.dynamics.com');
    expect(assertProductionResource('https://wmkf.crm.dynamics.com/')).toBe('https://wmkf.crm.dynamics.com');
  });

  test.each([
    'https://orgd9e66399.crm.dynamics.com',
    'https://wmkf.crm.dynamics.com.evil.test',
    'https://wmkf.crm.dynamics.com:443',
    'https://user@wmkf.crm.dynamics.com',
    'https://:secret@wmkf.crm.dynamics.com',
    'https://user:secret@wmkf.crm.dynamics.com',
    'https://wmkf.crm.dynamics.com/api/data/v9.2',
    'https://wmkf.crm.dynamics.com?x=1',
    'https://wmkf.crm.dynamics.com#fragment',
  ])('rejects noncanonical production resource %s', (resourceUrl) => {
    expect(() => assertProductionResource(resourceUrl)).toThrow();
  });

  test('requires reads for all modes and interlock plus dated ack for apply', () => {
    const env = { DATAVERSE_ALLOW_PROD_READS: 'yes', DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_PROD_WRITE_ACK: 'purpose 2026-09-07' };
    expect(() => assertApplyEnvironment({ apply: false, env, date: '2026-09-07' })).not.toThrow();
    expect(() => assertApplyEnvironment({ apply: true, env, date: '2026-09-07' })).not.toThrow();
    expect(() => assertApplyEnvironment({ apply: true, env: { ...env, DATAVERSE_ALLOW_PROD_READS: 'no' }, date: '2026-09-07' })).toThrow();
    expect(() => assertApplyEnvironment({ apply: true, env: { ...env, DATAVERSE_PROD_WRITE_ACK: 'purpose 2026-09-06' }, date: '2026-09-07' })).toThrow();
    expect(() => assertApplyEnvironment({ apply: true, env: { ...env, DATAVERSE_TARGET_INTERLOCK: 'off' }, date: '2026-09-07' })).toThrow();
  });

  test('validates exact view identity, type, managed/customizable flags, and ETag', () => {
    const view = {
      savedqueryid: VIEW_ID,
      name: VIEW_NAME,
      returnedtypecode: 'akoya_request',
      querytype: VIEW_QUERY_TYPE,
      isquickfindquery: true,
      ismanaged: true,
      iscustomizable: { Value: true },
      '@odata.etag': 'W/"123"',
    };
    expect(validateTargetView(view)).toBe(view);
    expect(() => validateTargetView({ ...view, name: 'other' })).toThrow();
    expect(() => validateTargetView({ ...view, querytype: 0 })).toThrow();
    expect(() => validateTargetView({ ...view, '@odata.etag': '' })).toThrow();
  });

  test('parses only a current dated write acknowledgement', () => {
    expect(parseDatedProdWriteAck('metadata view 2026-09-07', '2026-09-07')).toEqual({ purpose: 'metadata view', date: '2026-09-07' });
    expect(parseDatedProdWriteAck('metadata view 2026-09-06', '2026-09-07')).toBeNull();
    expect(parseDatedProdWriteAck('2026-09-07', '2026-09-07')).toBeNull();
  });

  test('requires explicit apply or dry-run, never both', () => {
    expect(parseArgs(['node', 'script'])).toMatchObject({ apply: false });
    expect(parseArgs(['node', 'script', '--apply'])).toMatchObject({ apply: true });
    expect(() => parseArgs(['node', 'script', '--apply', '--dry-run'])).toThrow();
  });

  test.each(['Quick Find view PATCH', 'PublishXml for akoya_request'])('reports exact projection/layout readback after an uncertain %s throw without retrying', async (label) => {
    let attempts = 0;
    let readbacks = 0;
    await expect(runUncertainDataverseMutation({
      label,
      execute: async () => {
        attempts += 1;
        throw new Error('socket reset after write');
      },
      readback: async () => {
        readbacks += 1;
        return 'fetchxml="<attribute name=\\"akoya_programid\\"/>" layoutxml="<cell name=\\"akoya_programid\\"/>"';
      },
    })).rejects.toThrow(
      new RegExp(`PARTIAL/UNKNOWN OUTCOME: ${label}.*no retry attempted.*fetchxml=.*akoya_programid.*layoutxml=.*akoya_programid.*socket reset after write`),
    );
    expect(attempts).toBe(1);
    expect(readbacks).toBe(1);
  });

  test('treats a non-OK PATCH as partial/unknown, reads once, and never publishes', async () => {
    const calls = [];
    const current = {
      savedqueryid: VIEW_ID,
      name: VIEW_NAME,
      returnedtypecode: 'akoya_request',
      querytype: VIEW_QUERY_TYPE,
      isquickfindquery: true,
      ismanaged: true,
      iscustomizable: true,
      '@odata.etag': 'W/"current"',
      fetchxml: FETCH,
      layoutxml: LAYOUT,
    };
    const plan = planQuickFindViewUpdate(current);
    const client = {
      raw: async () => {
        calls.push('PATCH');
        return { ok: false, status: 500, text: 'server error' };
      },
      post: async () => {
        calls.push('PublishXml');
        return { ok: true, status: 204, text: '' };
      },
      get: async () => {
        calls.push('GET');
        return { ok: true, body: current };
      },
    };

    await expect(applyViewPlan({ client, current, plan })).rejects.toThrow(
      /PARTIAL\/UNKNOWN OUTCOME: Quick Find view PATCH returned non-OK HTTP 500.*fetchxml=.*layoutxml=.*server error/,
    );
    expect(calls).toEqual(['PATCH', 'GET']);
  });
});
