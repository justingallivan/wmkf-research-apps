/**
 * Thin client for the Anthropic Admin API.
 *
 * Requires a separate `sk-ant-admin-...` key, not the regular CLAUDE_API_KEY.
 * Mint at https://console.anthropic.com/settings/admin-keys; only org admins
 * can. Store in env as ANTHROPIC_ADMIN_API_KEY. Production callers that wire
 * this service should fail loudly when the key is missing; dev callers can
 * detect the missing key and skip.
 *
 * Wraps the organization cost and Messages usage reports with identical
 * time windows and complete pagination for comparable pricing audits.
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
 * Fetch `/v1/organizations/cost_report`. Returns the parsed `data` array, or
 * throws on non-2xx. Pagination is followed automatically; if the response has
 * more than 50 pages we cap to avoid runaway requests. The cron's 30-day
 * window with daily granularity should be far below that.
 *
 * @param {Object} opts
 * @param {string} opts.startingAt RFC 3339 inclusive
 * @param {string} opts.endingAt RFC 3339 exclusive
 * @param {string[]} [opts.groupBy] e.g. ['description']
 */
export async function getCostReport(options) {
  return getReport('cost_report', { groupBy: ['description'], ...options });
}

export async function getMessagesUsageReport(options) {
  return getReport('usage_report/messages', {
    groupBy: ['model', 'service_tier', 'context_window', 'inference_geo', 'workspace_id'],
    ...options,
  });
}

async function getReport(endpoint, { startingAt, endingAt, groupBy }) {
  const key = getKey();
  const all = [];
  let page = null;
  const safetyCap = 50;

  for (let i = 0; i < safetyCap; i++) {
    const params = new URLSearchParams();
    params.set('starting_at', startingAt);
    if (endingAt) params.set('ending_at', endingAt);
    params.set('bucket_width', '1d');
    for (const group of groupBy) params.append('group_by[]', group);
    if (page) params.set('page', page);

    const url = `${BASE_URL}/v1/organizations/${endpoint}?${params}`;
    const response = await fetch(url, {
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': key,
      },
    });

    if (!response.ok) {
      throw new Error(`Anthropic report ${endpoint} returned HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data.data) || typeof data.has_more !== 'boolean'
        || data.data.some(bucket => !bucket.starting_at || !bucket.ending_at || !Array.isArray(bucket.results))) {
      throw new Error('Invalid Anthropic report response');
    }
    all.push(...data.data);
    if (!data.has_more) return all;
    if (!data.next_page || data.next_page === page) throw new Error('Incomplete Anthropic report pagination');
    page = data.next_page;
  }

  throw new Error('Anthropic report pagination limit reached');
}
