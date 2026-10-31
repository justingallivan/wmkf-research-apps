/**
 * @jest-environment node
 *
 * Wave 35 reviewer outcomes: the "Ended By" schema spec, the shared runtime
 * constants and the owner-run provisioning scripts must agree exactly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  ENDED_BY_VALUES, ENDED_BY_BY_VALUE, DID_NOT_SUBMIT_REVIEW_STATUS_VALUE,
} from '../../shared/config/reviewerOutcome.js';
import { TERMINAL_REVIEW_STATUS_VALUES } from '../../shared/config/reviewerStatus.js';
import { REVIEW_STATUS_MAP } from '../../shared/config/reviewerLifecycle.js';

const root = path.resolve(__dirname, '../..');
const spec = JSON.parse(fs.readFileSync(path.join(root,
  'lib/dataverse/schema/wave35-reviewer-outcomes/01_wmkf_appreviewersuggestion_ended_by.json'), 'utf8'));

test('the Ended By spec options are exactly the runtime values', () => {
  const [attribute] = spec.attributes;
  expect(attribute.schemaName).toBe('wmkf_EndedBy');
  expect(attribute.defaultValue).toBe(-1);
  expect(attribute.options.map((o) => o.value)).toEqual(Object.values(ENDED_BY_VALUES));
  expect(ENDED_BY_BY_VALUE[ENDED_BY_VALUES.foundation]).toBe('foundation');
});

test('Did not submit is the next review status value and is not yet terminal', () => {
  const used = [...Object.values(REVIEW_STATUS_MAP), ...Object.values(TERMINAL_REVIEW_STATUS_VALUES)];
  expect(DID_NOT_SUBMIT_REVIEW_STATUS_VALUE).toBe(Math.max(...used) + 1);
  // Wired into the terminal set only with an explicit terminal-transition branch.
  expect(Object.values(TERMINAL_REVIEW_STATUS_VALUES)).not.toContain(DID_NOT_SUBMIT_REVIEW_STATUS_VALUE);
});

test.each([
  'scripts/preflight-reviewer-outcomes-schema.mjs',
  'scripts/extend-reviewstatus-picklist-did-not-submit.mjs',
])('%s self-test passes', (script) => {
  expect(() => execFileSync(process.execPath, [script, '--self-test'], { cwd: root, stdio: 'pipe' })).not.toThrow();
});
