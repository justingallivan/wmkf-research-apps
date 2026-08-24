#!/usr/bin/env node

/**
 * Read-only release probe for frozen Pre-Site Dynamics email distribution.
 *
 * Verifies the live email subject/body metadata, state/status option values, and
 * the tenant's unresolved-recipient setting without creating an activity or
 * sending mail.
 *
 * Usage:
 *   node scripts/probe-dynamics-email-distribution-contract.mjs \
 *     --target=production --confirm-production-read
 *   node scripts/probe-dynamics-email-distribution-contract.mjs --target=sandbox
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const envFile of ['.env', '.env.local']) {
  try {
    const contents = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator < 0) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Missing env file is allowed; the required-key check below is authoritative.
  }
}

const targetArg = process.argv.find((arg) => arg.startsWith('--target='));
const target = targetArg ? targetArg.slice('--target='.length) : 'production';
if (!['production', 'sandbox'].includes(target)) {
  console.error('ERROR: --target must be production or sandbox.');
  process.exit(2);
}
if (target === 'production' && !process.argv.includes('--confirm-production-read')) {
  console.error('ERROR: Production metadata reads require --confirm-production-read.');
  process.exit(2);
}

const resourceUrl = target === 'sandbox'
  ? process.env.DYNAMICS_SANDBOX_URL
  : process.env.DYNAMICS_URL;
const {
  DYNAMICS_TENANT_ID,
  DYNAMICS_CLIENT_ID,
  DYNAMICS_CLIENT_SECRET,
} = process.env;

if (!resourceUrl || !DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
  console.error(`ERROR: Missing Dynamics credentials or URL for target=${target}.`);
  process.exit(2);
}

const targetUrl = new URL(resourceUrl);
const expectedHost = target === 'production'
  ? 'wmkf.crm.dynamics.com'
  : 'orgd9e66399.crm.dynamics.com';
if (targetUrl.hostname.toLowerCase() !== expectedHost) {
  console.error(`ERROR: target=${target} resolved to an unregistered hostname.`);
  process.exit(2);
}

async function getToken() {
  const response = await fetch(
    `https://login.microsoftonline.com/${DYNAMICS_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: DYNAMICS_CLIENT_ID,
        client_secret: DYNAMICS_CLIENT_SECRET,
        scope: `${resourceUrl}/.default`,
      }).toString(),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(`Dynamics token request failed (${response.status}).`);
  }
  return body.access_token;
}

async function getJson(token, path) {
  const response = await fetch(`${resourceUrl}/api/data/v9.2${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-Version': '4.0',
      'OData-MaxVersion': '4.0',
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `HTTP ${response.status}`;
    throw new Error(`${path} failed: ${String(message).slice(0, 300)}`);
  }
  return body;
}

function options(rows) {
  return (rows || []).map((option) => ({
    value: option.Value,
    label: option.Label?.UserLocalizedLabel?.Label || null,
    state: Number.isInteger(option.State) ? option.State : null,
  }));
}

async function main() {
  const token = await getToken();
  const attributeBase = "/EntityDefinitions(LogicalName='email')/Attributes";
  const [subject, description, state, status, organizations] = await Promise.all([
    getJson(token,
      `${attributeBase}(LogicalName='subject')/Microsoft.Dynamics.CRM.StringAttributeMetadata`
      + '?$select=LogicalName,MaxLength,IsValidForCreate,IsValidForRead,IsValidForUpdate'),
    getJson(token,
      `${attributeBase}(LogicalName='description')/Microsoft.Dynamics.CRM.MemoAttributeMetadata`
      + '?$select=LogicalName,MaxLength,IsValidForCreate,IsValidForRead,IsValidForUpdate'),
    getJson(token,
      `${attributeBase}(LogicalName='statecode')/Microsoft.Dynamics.CRM.StateAttributeMetadata`
      + '?$expand=OptionSet'),
    getJson(token,
      `${attributeBase}(LogicalName='statuscode')/Microsoft.Dynamics.CRM.StatusAttributeMetadata`
      + '?$expand=OptionSet'),
    getJson(token, '/organizations?$select=allowunresolvedpartiesonemailsend&$top=2'),
  ]);

  if (organizations.value?.length !== 1) {
    throw new Error(`Expected one organization row, found ${organizations.value?.length || 0}.`);
  }

  console.log(JSON.stringify({
    target,
    hostname: targetUrl.hostname.toLowerCase(),
    email: {
      subject: {
        maxLength: subject.MaxLength,
        validForCreate: subject.IsValidForCreate,
        validForRead: subject.IsValidForRead,
        validForUpdate: subject.IsValidForUpdate,
      },
      description: {
        maxLength: description.MaxLength,
        validForCreate: description.IsValidForCreate,
        validForRead: description.IsValidForRead,
        validForUpdate: description.IsValidForUpdate,
      },
      stateOptions: options(state.OptionSet?.Options),
      statusOptions: options(status.OptionSet?.Options),
    },
    allowUnresolvedEmailRecipient: organizations.value[0].allowunresolvedpartiesonemailsend,
    probedAt: new Date().toISOString(),
  }, null, 2));
}

main().catch((error) => {
  console.error('ERROR:', error?.message || error);
  process.exit(2);
});
