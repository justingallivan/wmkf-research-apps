/**
 * One-shot probe: find any attribute on contact / account / wmkf_potentialreviewer
 * whose LogicalName or DisplayName contains "bill" or "vendor".
 *
 * Read-only. Outputs to stdout only.
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (!fs.existsSync(envPath)) {
  console.error('No .env.local file found.');
  process.exit(1);
}
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const [rawKey, ...valueParts] = trimmed.split('=');
  const key = rawKey.trim();
  if (!key || valueParts.length === 0) return;
  let value = valueParts.join('=').trim();
  if (value.startsWith('"')) {
    const end = value.indexOf('"', 1);
    if (end > 0) value = value.substring(1, end);
  } else if (value.startsWith("'")) {
    const end = value.indexOf("'", 1);
    if (end > 0) value = value.substring(1, end);
  } else {
    const c = value.indexOf('#');
    if (c > 0) value = value.substring(0, c).trim();
  }
  process.env[key] = value;
});

const DYNAMICS_URL = process.env.DYNAMICS_URL;
const TENANT_ID = process.env.DYNAMICS_TENANT_ID;
const CLIENT_ID = process.env.DYNAMICS_CLIENT_ID;
const CLIENT_SECRET = process.env.DYNAMICS_CLIENT_SECRET;

if (!DYNAMICS_URL || !TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing DYNAMICS_URL / DYNAMICS_TENANT_ID / DYNAMICS_CLIENT_ID / DYNAMICS_CLIENT_SECRET');
  process.exit(1);
}

async function getToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: `${DYNAMICS_URL}/.default`,
  });
  const resp = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) throw new Error(`Token request failed (${resp.status}): ${await resp.text()}`);
  return (await resp.json()).access_token;
}

async function dynamicsGet(urlPath, token) {
  const resp = await fetch(`${DYNAMICS_URL}/api/data/v9.2/${urlPath}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'OData-Version': '4.0',
      Accept: 'application/json',
    },
  });
  if (!resp.ok) throw new Error(`GET ${urlPath} failed (${resp.status}): ${(await resp.text()).substring(0, 300)}`);
  return resp.json();
}

const KEYWORDS = ['bill', 'vendor', 'remit', 'payee', 'payment'];
const TABLES = ['contact', 'account', 'wmkf_potentialreviewer', 'wmkf_appresearcher', 'akoya_request'];

function matches(attr) {
  const ln = (attr.LogicalName || '').toLowerCase();
  const dn = (attr.DisplayName?.UserLocalizedLabel?.Label || '').toLowerCase();
  return KEYWORDS.some(k => ln.includes(k) || dn.includes(k));
}

(async () => {
  const token = await getToken();
  console.log('✓ Authenticated\n');

  for (const table of TABLES) {
    console.log(`━━━ ${table} ━━━`);
    let data;
    try {
      data = await dynamicsGet(
        `EntityDefinitions(LogicalName='${table}')/Attributes?$select=LogicalName,AttributeType,DisplayName,Description,IsCustomAttribute,AttributeOf`,
        token
      );
    } catch (err) {
      console.log(`  ✗ ${err.message}\n`);
      continue;
    }
    const attrs = (data.value || []).filter(a => !a.AttributeOf).filter(matches);
    if (attrs.length === 0) {
      console.log('  (no matches)\n');
      continue;
    }
    attrs.sort((a, b) => a.LogicalName.localeCompare(b.LogicalName));
    for (const a of attrs) {
      const custom = a.IsCustomAttribute ? '*' : ' ';
      const display = a.DisplayName?.UserLocalizedLabel?.Label || '';
      const desc = (a.Description?.UserLocalizedLabel?.Label || '').substring(0, 120);
      console.log(`  ${custom} ${a.LogicalName.padEnd(50)} [${a.AttributeType.padEnd(12)}] "${display}"${desc ? ' — ' + desc : ''}`);
    }
    console.log('');
  }
})().catch(err => {
  console.error('\n✗ Failed:', err.message);
  process.exit(1);
});
