/** @jest-environment node */

import { RECONCILIATION_MAX_CANDIDATE_KEYS } from '../../shared/components/reviewers/ReviewerSearchSection';
import { MAX_REQUEST_CANDIDATES } from '../../lib/services/workbench/reviewer-stage-reconciliation-service';
const { PER_REQUEST_ACTIVE_CAP } = require('../../lib/services/reviewer-roster-store');

test('the browser continuation cap equals both server reconciliation and roster-store caps', () => {
  expect(RECONCILIATION_MAX_CANDIDATE_KEYS).toBe(PER_REQUEST_ACTIVE_CAP);
  expect(MAX_REQUEST_CANDIDATES).toBe(PER_REQUEST_ACTIVE_CAP);
});
