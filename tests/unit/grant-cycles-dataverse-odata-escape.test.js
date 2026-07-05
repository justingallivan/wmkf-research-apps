/**
 * @jest-environment node
 *
 * Stage 0 characterization pin (OData Escape Consolidation Plan, D1) for
 * lib/services/grant-cycles-dataverse.js findByShortCode: the built alt-key
 * URL both doubles an embedded single quote (OData literal) AND percent-encodes
 * a space via encodeURIComponent. The full URL is asserted byte-for-byte so the
 * D1 option-(b) refactor (encodeURIComponent(odata.escape(sc))) is provably
 * output-preserving.
 */
const get = jest.fn();
jest.mock('../../lib/dataverse/client', () => ({
  getAccessToken: jest.fn().mockResolvedValue('tok'),
  createClient: jest.fn(() => ({ get })),
}));

const { findByShortCode } = require('../../lib/services/grant-cycles-dataverse');

const SELECT_FIELDS = [
  'wmkf_appgrantcycleid',
  'wmkf_displayname',
  'wmkf_shortcode',
  'wmkf_programname',
  'wmkf_reviewreturndeadline',
  'wmkf_summarypages',
  'wmkf_reviewtemplateurl',
  'wmkf_reviewtemplatefilename',
  'wmkf_additionalattachments',
  'wmkf_customfields',
  'wmkf_isactive',
  'wmkf_fiscalyearcode',
  'createdon',
  'modifiedon',
].join(',');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
  // 404 → findByShortCode returns null after exactly one get() (URL captured).
  get.mockResolvedValue({ status: 404, ok: false });
});

test('findByShortCode builds the alt-key URL with doubled quote and %20-encoded space', async () => {
  // normalizeShortCode trims + uppercases → "O'BRIEN LAB"; the literal is
  // apostrophe-doubled then encodeURIComponent'd (space → %20, apostrophe kept).
  await findByShortCode("O'Brien Lab");
  const expected =
    `/wmkf_appgrantcycles(wmkf_shortcode='O''BRIEN%20LAB')?$select=${SELECT_FIELDS}`;
  expect(get).toHaveBeenCalledTimes(1);
  expect(get.mock.calls[0][0]).toBe(expected);
});
