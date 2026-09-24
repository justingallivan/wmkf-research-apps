/**
 * @jest-environment node
 *
 * Postgres access layer migration Stage 1 item 2
 * (docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md):
 * scripts/check-route-service-boundary.js widened its LAW-mode boundary-source
 * recognition to Postgres (@vercel/postgres, pg, lib/postgres/*) alongside the
 * existing Dataverse recognition. Dataverse detection stays pure law with no
 * list. Postgres detection is law WITH a narrowly scoped, SHRINK-ONLY
 * carry-over: `POSTGRES_CARRYOVER` names the 17 pages/api routes that already
 * reached Postgres directly when the widened definition landed.
 *
 * That list is not self-limiting for growth on its own -- the gate's own
 * stale-entry check only stops a listed route from staying on the list once
 * it no longer reaches Postgres; nothing in the gate stops a PR from adding a
 * brand-new (genuinely Postgres-reaching) route to the array and staying
 * green. This test is the deliberate, separate guard against that: it pins
 * POSTGRES_CARRYOVER to its EXACT tracked contents (the same mechanism
 * tests/unit/reviewer-engagement-boundary-recorded-set.test.js uses for
 * RECORDED_IMPORTERS). Widening the list requires editing THIS test in the
 * same reviewed commit as the array change -- a silent addition fails here,
 * not the gate.
 *
 * The list must reach zero by the end of Stage 6
 * (docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md), at which
 * point POSTGRES_CARRYOVER and this test are both deleted and the gate
 * becomes pure law for Postgres too, mirroring Dataverse today.
 */

const { POSTGRES_CARRYOVER } = require('../../scripts/check-route-service-boundary.js');

describe('route-service-boundary POSTGRES_CARRYOVER (shrink-only pin)', () => {
  it('is exactly the 17 tracked Stage 1 item 2 direct-Postgres routes', () => {
    expect(POSTGRES_CARRYOVER).toEqual([
      'pages/api/admin/health-history.js',
      'pages/api/admin/stats.js',
      'pages/api/auth/[...nextauth].js',
      'pages/api/auth/link-profile.js',
      'pages/api/cron/drain-submissions.js',
      'pages/api/cron/health-check.js',
      'pages/api/cron/pricing-canary.js',
      'pages/api/cron/pricing-refresh.js',
      'pages/api/cron/secret-check.js',
      'pages/api/cron/spend-check.js',
      'pages/api/dynamics-explorer/restrictions.js',
      'pages/api/dynamics-explorer/roles.js',
      'pages/api/expertise-finder/history.js',
      'pages/api/expertise-finder/match.js',
      'pages/api/expertise-finder/roster.js',
      'pages/api/intake/submit.js',
      'pages/api/webhooks/bill.js',
    ]);
  });
});
