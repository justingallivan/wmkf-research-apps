/**
 * Thin client for the Anthropic Admin API.
 *
 * Requires a separate `sk-ant-admin-...` key (NOT the regular CLAUDE_API_KEY).
 * Mint at https://console.anthropic.com/settings/admin-keys — only org admins
 * can. Store in env as ANTHROPIC_ADMIN_API_KEY. Production-fail-loud when
 * missing if any caller is actually wired (e.g. the monthly drift cron); dev
 * callers detect missing and skip.
 *
 * Today this only wraps `/v1/organizations/cost_report`. If we add more
 * endpoints (rate limits, key listing) they belong here too.
 *
 * Docs: https://platform.claude.com/docs/en/build-with-claude/usage-cost-api
 */

const BASE_URL = 'https://api.anthropic.com';

function getKey() {
  const key = process.env.ANTHROPIC_ADMIN_API_KEY;
  if (!key) {
    throw new Error('ANTHROPIC_ADMIN_API_KEY not set');
  }
  if (!key.startsWith('sk-ant-admin')) {
    throw new Error(
      'ANTHROPIC_ADMIN_API_KEY does not look like an admin key (must start with sk-ant-admin)',
    );
  }
  return key;
}

export function isAdminKeyConfigured() {
  return !!process.env.ANTHROPIC_ADMIN_API_KEY;
}

/**
 * Fetch /v1/organizations/cost_report. Returns the parsed `data` array, or
 * throws on non-2xx. Pagination is followed automatically; if the response
 * has more than 1000 buckets we cap to avoid runaway requests (the cron's
 * 30-day window with daily granularity is at most 31 buckets so this is a
 * sanity guard, not a real limit).
 *
 * @param {Object} opts
 * @param {string} opts.startingAt   RFC 3339 inclusive
 * @param {string} opts.endingAt     RFC 3339 exclusive
 * @param {string[]} [opts.groupBy]  e.g. ['description']
 */
export async function getCostReport({ startingAt, endingAt, groupBy = ['description'] }) {
  const key = getKey();
  const all = [];
  let page = null;
  const SAFETY_CAP = 50; // 50 paginated pages = far more than 30d/1d

  for (let i = 0; i < SAFETY_CAP; i++) {
    const params = new URLSearchParams();
    params.set('starting_at', startingAt);
    if (endingAt) params.set('ending_at', endingAt);
    params.set('bucket_width', '1d');
    for (const g of groupBy) params.append('group_by[]', g);
    if (page) params.set('page', page);

    const url = `${BASE_URL}/v1/organizations/cost_report?${params}`;
    const r = await fetch(url, {
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': key,
      },
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`cost_report ${r.status}: ${body.slice(0, 200)}`);
    }
    const data = await r.json();
    for (const bucket of data.data || []) all.push(bucket);
    if (!data.has_more || !data.next_page) break;
    page = data.next_page;
  }
  return all;
}
