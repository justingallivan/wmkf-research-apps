/** @jest-environment jsdom */
import { EXPERTISE_MATCH_SCHEMA } from '../../shared/config/expertise-finder-output-schema';
import { rosterMatchSchema, validateRosterMatch } from '../../lib/services/expertise-finder/roster-match-validation';

test('imports in jsdom and clones the JSON schema without mutating legacy defaults', () => {
  expect(JSON.parse(JSON.stringify(EXPERTISE_MATCH_SCHEMA))).toEqual(EXPERTISE_MATCH_SCHEMA);
  expect(rosterMatchSchema.fields.staff_assignment.required).toBe(true);
  expect(EXPERTISE_MATCH_SCHEMA.fields.staff_assignment.required).toBe(false);
  expect(rosterMatchSchema.fields.proposal_summary).not.toBe(EXPERTISE_MATCH_SCHEMA.fields.proposal_summary);
  expect(validateRosterMatch({ staff_assignment: {} }, { rows: [], leadGuids: [], warnings: [] }))
    .toMatchObject({ no_lead_recommendation: true, staff_assignment: { primary: null, secondary: null } });
});
