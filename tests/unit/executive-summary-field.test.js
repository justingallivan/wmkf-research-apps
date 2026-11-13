/** @jest-environment node */
import { EXECUTIVE_SUMMARY_FIELD, EXECUTIVE_SUMMARY_TASK, assertNoExecutiveSummaryTarget } from '../../lib/services/executive-summary-field';
import { getTaskCapability, isTaskEnabled } from '../../lib/services/prompt-jobs/capabilities';
import { REQUEST_NARRATIVE_FIELDS } from '../../shared/config/requestNarratives';

test('Executive Summary retains the existing column and stable API key', () => {
  expect(EXECUTIVE_SUMMARY_FIELD).toBe('wmkf_layabstract');
  expect(REQUEST_NARRATIVE_FIELDS).toEqual({ lay_abstract: { label: 'Executive Summary', column: EXECUTIVE_SUMMARY_FIELD } });
});
test('Summary remains a destination-free draft; no machine scope or source is enabled', () => {
  expect(getTaskCapability(EXECUTIVE_SUMMARY_TASK)).toMatchObject({ kind: 'proposal', outputName: 'summary', destinationField: null, maxWords: 200 });
  for (const prefix of ['pa-short-title:', 'pa-executive-summary:']) {
    expect(isTaskEnabled(EXECUTIVE_SUMMARY_TASK, { environment: 'preview-sandbox', authorizationScope: prefix + '11111111-1111-4111-8111-111111111111' })).toBe(false);
  }
});
test('reserving Summary leaves legacy summary and pass-through outputs available', () => {
  expect(() => assertNoExecutiveSummaryTarget([
    { target: { kind: 'akoya_request', field: 'wmkf_ai_summary' } },
    { target: { kind: 'none', field: EXECUTIVE_SUMMARY_FIELD } },
  ])).not.toThrow();
});

test('malformed non-array output declarations fail closed', () => {
  expect(() => assertNoExecutiveSummaryTarget({ target: { field: EXECUTIVE_SUMMARY_FIELD } })).toThrow('array');
});
