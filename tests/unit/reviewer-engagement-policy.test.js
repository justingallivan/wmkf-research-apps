/**
 * Stage 2 — shared reviewer engagement policy module
 * (docs/REVIEWER_LIFECYCLE_STAGE2_BUILD_PLAN.md).
 *
 * Table-drives both predicates over every REVIEW_STATUS_MAP value plus the
 * edge cases the two pre-refactor callers had to handle: null, undefined, an
 * unknown integer, a string status, and wmkf_completedat set/unset. Also
 * asserts the module stays browser-safe (no import from lib/).
 *
 * @jest-environment node
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { REVIEW_STATUS_MAP } from '../../shared/config/reviewerLifecycle.js';
import { TERMINAL_REVIEW_STATUS_VALUES } from '../../shared/config/reviewerStatus.js';
import {
  INVITATION_CORRECTION_SOURCE_STATUSES,
  CLOSED_ENGAGEMENT_STATUSES,
  isClosedEngagementRow,
  isInvitationCorrectionSourceRow,
} from '../../shared/utils/reviewer-engagement-policy.js';

const UNKNOWN_INTEGER = 999999999;
const STRING_STATUS = 'accepted';

describe('reviewer-engagement-policy', () => {
  describe('isInvitationCorrectionSourceRow', () => {
    const cases = [
      ['accepted', REVIEW_STATUS_MAP.accepted, true],
      ['materials_sent', REVIEW_STATUS_MAP.materials_sent, true],
      ['under_review', REVIEW_STATUS_MAP.under_review, true],
      ['review_received', REVIEW_STATUS_MAP.review_received, true],
      ['complete', REVIEW_STATUS_MAP.complete, false],
      ['withdrew', REVIEW_STATUS_MAP.withdrew, false],
      ['released', REVIEW_STATUS_MAP.released, false],
      ['null', null, true],
      ['undefined', undefined, false],
      ['unknown integer', UNKNOWN_INTEGER, false],
      ['string status', STRING_STATUS, false],
    ];

    test.each(cases)('%s -> %s', (_label, status, expected) => {
      expect(isInvitationCorrectionSourceRow({ wmkf_reviewstatus: status })).toBe(expected);
    });

    test('missing wmkf_reviewstatus key behaves like undefined -> false', () => {
      expect(isInvitationCorrectionSourceRow({})).toBe(false);
    });

    test('null row -> false', () => {
      expect(isInvitationCorrectionSourceRow(null)).toBe(false);
    });

    test('undefined row -> false', () => {
      expect(isInvitationCorrectionSourceRow(undefined)).toBe(false);
    });
  });

  describe('isClosedEngagementRow', () => {
    const statusOnlyCases = [
      ['accepted', REVIEW_STATUS_MAP.accepted, false],
      ['materials_sent', REVIEW_STATUS_MAP.materials_sent, false],
      ['under_review', REVIEW_STATUS_MAP.under_review, false],
      ['review_received', REVIEW_STATUS_MAP.review_received, false],
      ['complete', REVIEW_STATUS_MAP.complete, true],
      ['withdrew', REVIEW_STATUS_MAP.withdrew, true],
      ['released', REVIEW_STATUS_MAP.released, true],
      ['null', null, false],
      ['undefined', undefined, false],
      ['unknown integer', UNKNOWN_INTEGER, false],
      ['string status', STRING_STATUS, false],
    ];

    test.each(statusOnlyCases)('%s, wmkf_completedat unset -> %s', (_label, status, expected) => {
      expect(isClosedEngagementRow({ wmkf_reviewstatus: status })).toBe(expected);
    });

    test.each(statusOnlyCases)('%s, wmkf_completedat set -> true (completedat forces closed)', (_label, status) => {
      expect(isClosedEngagementRow({ wmkf_reviewstatus: status, wmkf_completedat: '2026-09-05T00:00:00Z' })).toBe(true);
    });

    test('null row -> false', () => {
      expect(isClosedEngagementRow(null)).toBe(false);
    });

    test('undefined row -> false', () => {
      expect(isClosedEngagementRow(undefined)).toBe(false);
    });
  });

  describe('exported sets', () => {
    test('INVITATION_CORRECTION_SOURCE_STATUSES matches the plan membership', () => {
      expect([...INVITATION_CORRECTION_SOURCE_STATUSES].sort()).toEqual([
        null,
        REVIEW_STATUS_MAP.accepted,
        REVIEW_STATUS_MAP.materials_sent,
        REVIEW_STATUS_MAP.under_review,
        REVIEW_STATUS_MAP.review_received,
      ].sort());
    });

    test('CLOSED_ENGAGEMENT_STATUSES matches the plan membership', () => {
      expect([...CLOSED_ENGAGEMENT_STATUSES].sort()).toEqual([
        REVIEW_STATUS_MAP.complete,
        TERMINAL_REVIEW_STATUS_VALUES.withdrew,
        TERMINAL_REVIEW_STATUS_VALUES.released,
      ].sort());
    });
  });

  describe('browser-safety', () => {
    test('module source imports nothing from lib/', () => {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const modulePath = path.join(here, '../../shared/utils/reviewer-engagement-policy.js');
      const source = fs.readFileSync(modulePath, 'utf8');
      const importLines = source.match(/^import .*from\s+['"][^'"]+['"];?\s*$/gm) || [];
      expect(importLines.length).toBeGreaterThan(0);
      for (const line of importLines) {
        expect(line).not.toMatch(/from\s+['"](?:\.\.\/)*lib\//);
        expect(line).not.toMatch(/from\s+['"]lib\//);
      }
      expect(source).not.toMatch(/from\s+['"][^'"]*\/lib\/[^'"]*['"]/);
    });
  });
});
