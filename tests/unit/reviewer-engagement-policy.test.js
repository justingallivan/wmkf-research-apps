/**
 * Stage 2 — shared reviewer engagement policy module
 * (docs/REVIEWER_LIFECYCLE_STAGE2_BUILD_PLAN.md; Opus/Codex round-1 review
 * follow-ups: private Sets, explicit undefined guard, isClosedEngagementStatus
 * as its own predicate for the two status-only call sites).
 *
 * Table-drives all three predicates over every REVIEW_STATUS_MAP value plus
 * the edge cases the callers had to handle: null, undefined, an unknown
 * integer, a string status, and (for the row predicates) wmkf_completedat
 * set/unset. Also asserts the module stays browser-safe (no import from
 * lib/) and exports no Set instance (the two Sets are module-private; only
 * the predicates are the contract).
 *
 * @jest-environment node
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { REVIEW_STATUS_MAP } from '../../shared/config/reviewerLifecycle.js';
import * as reviewerEngagementPolicy from '../../shared/utils/reviewer-engagement-policy.js';

const {
  isClosedEngagementStatus,
  isClosedEngagementRow,
  isInvitationCorrectionSourceRow,
} = reviewerEngagementPolicy;

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

    test.each(cases)('%s (status %p) -> %p', (_label, status, expected) => {
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

  describe('isClosedEngagementStatus', () => {
    const cases = [
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

    test.each(cases)('%s (status %p) -> %p', (_label, status, expected) => {
      expect(isClosedEngagementStatus(status)).toBe(expected);
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

    test.each(statusOnlyCases)('%s (status %p), wmkf_completedat unset -> %p', (_label, status, expected) => {
      expect(isClosedEngagementRow({ wmkf_reviewstatus: status })).toBe(expected);
    });

    test.each(statusOnlyCases)('%s (status %p), wmkf_completedat set -> true (completedat forces closed)', (_label, status) => {
      expect(isClosedEngagementRow({ wmkf_reviewstatus: status, wmkf_completedat: '2026-09-05T00:00:00Z' })).toBe(true);
    });

    test('null row -> false', () => {
      expect(isClosedEngagementRow(null)).toBe(false);
    });

    test('undefined row -> false', () => {
      expect(isClosedEngagementRow(undefined)).toBe(false);
    });

    test('completedat forces closed even on an otherwise-open status (distinct from isClosedEngagementStatus)', () => {
      const row = { wmkf_completedat: '2026-01-01T00:00:00Z', wmkf_reviewstatus: REVIEW_STATUS_MAP.accepted };
      expect(isClosedEngagementRow(row)).toBe(true);
      expect(isClosedEngagementStatus(REVIEW_STATUS_MAP.accepted)).toBe(false);
    });
  });

  describe('module surface', () => {
    test('exports no Set instance - the two membership sets are module-private', () => {
      for (const [name, value] of Object.entries(reviewerEngagementPolicy)) {
        expect(value instanceof Set ? name : null).toBeNull();
      }
    });

    test('exports exactly the three predicates', () => {
      expect(Object.keys(reviewerEngagementPolicy).sort()).toEqual([
        'isClosedEngagementRow',
        'isClosedEngagementStatus',
        'isInvitationCorrectionSourceRow',
      ]);
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
