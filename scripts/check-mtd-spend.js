#!/usr/bin/env node
// Inspect api_usage_log spend. By default month-to-date by day/model/app.
// Pass --backend90 to see what's been hitting the API as 'Backend' over 90d.

import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envFile of ['.env', '.env.local']) {
  try {
    const c = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of c.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  } catch (e) {}
}

const { sql } = await import('@vercel/postgres');
const mode = process.argv[2] || 'mtd';

if (mode === '--backend90') {
  console.log('Backend (user_profile_id IS NULL) spend over last 90 days:\n');
  const byApp = await sql`
    SELECT app_name, COUNT(*)::int req, SUM(estimated_cost_cents)::numeric cents,
           MIN(created_at)::date AS first_seen, MAX(created_at)::date AS last_seen
    FROM api_usage_log
    WHERE user_profile_id IS NULL
      AND created_at >= NOW() - INTERVAL '90 days'
    GROUP BY app_name ORDER BY cents DESC NULLS LAST
  `;
  for (const row of byApp.rows) {
    console.log('  ' + (row.app_name || '(null)').padEnd(40),
      'req=' + String(row.req).padStart(6),
      'cost=$' + (Number(row.cents||0)/100).toFixed(2).padStart(7),
      'first=' + row.first_seen.toISOString().slice(0,10),
      'last=' + row.last_seen.toISOString().slice(0,10));
  }

  const byDay = await sql`
    SELECT DATE_TRUNC('week', created_at)::date AS week,
           COUNT(*)::int req, SUM(estimated_cost_cents)::numeric cents
    FROM api_usage_log
    WHERE user_profile_id IS NULL
      AND created_at >= NOW() - INTERVAL '90 days'
    GROUP BY week ORDER BY week
  `;
  console.log('\nBackend spend by week:');
  for (const row of byDay.rows) {
    console.log('  ' + row.week.toISOString().slice(0,10),
      'req=' + String(row.req).padStart(6),
      'cost=$' + (Number(row.cents||0)/100).toFixed(2).padStart(7));
  }
  process.exit(0);
}

const byDay = await sql`
  SELECT
    DATE_TRUNC('day', created_at)::date AS day,
    COUNT(*)::int AS req,
    SUM(estimated_cost_cents)::numeric AS cents
  FROM api_usage_log
  WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
  GROUP BY day ORDER BY day
`;
let total = 0;
console.log('Month-to-date spend (local estimate):');
for (const row of byDay.rows) {
  total += Number(row.cents || 0);
  console.log('  ' + row.day.toISOString().slice(0,10), 'req=' + String(row.req).padStart(5), 'cost=$' + (Number(row.cents||0)/100).toFixed(4));
}
console.log('  --- MTD total: $' + (total/100).toFixed(2), 'across', byDay.rows.length, 'day(s) ---');

const byModel = await sql`
  SELECT model, COUNT(*)::int req, SUM(estimated_cost_cents)::numeric cents
  FROM api_usage_log
  WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
  GROUP BY model ORDER BY cents DESC NULLS LAST
`;
console.log('\nBy model:');
for (const row of byModel.rows) {
  console.log('  ' + (row.model || '(null)').padEnd(40), 'req=' + String(row.req).padStart(5), 'cost=$' + (Number(row.cents||0)/100).toFixed(4));
}

const byApp = await sql`
  SELECT app_name, COUNT(*)::int req, SUM(estimated_cost_cents)::numeric cents
  FROM api_usage_log
  WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
  GROUP BY app_name ORDER BY cents DESC NULLS LAST
`;
console.log('\nBy app:');
for (const row of byApp.rows) {
  console.log('  ' + (row.app_name || '(null)').padEnd(40), 'req=' + String(row.req).padStart(5), 'cost=$' + (Number(row.cents||0)/100).toFixed(4));
}

process.exit(0);
