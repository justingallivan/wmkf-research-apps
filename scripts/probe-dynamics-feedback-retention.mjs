#!/usr/bin/env node

/**
 * Read-only, aggregate-only probe for the Dynamics feedback retention policy.
 *
 * Reports status counts and timestamp eligibility without emitting feedback
 * text, user identifiers, row ids, or environment values.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envFile of ['.env', '.env.local']) {
  try {
    const contents = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

const { sql } = await import('@vercel/postgres');

const result = await sql`
  SELECT
    status,
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE reviewed_at IS NULL)::int AS without_ack,
    COUNT(*) FILTER (
      WHERE reviewed_at < NOW() - INTERVAL '20 days'
    )::int AS ack_older_than_20_days,
    MIN(created_at) AS oldest_created_at,
    MAX(created_at) AS newest_created_at,
    MIN(reviewed_at) AS oldest_ack_at,
    MAX(reviewed_at) AS newest_ack_at
  FROM dynamics_feedback
  GROUP BY status
  ORDER BY status
`;

console.log(JSON.stringify({ retentionDays: 20, byStatus: result.rows }, null, 2));
