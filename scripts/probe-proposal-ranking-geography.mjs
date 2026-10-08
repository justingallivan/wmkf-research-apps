#!/usr/bin/env node

/**
 * Read-only metadata discovery for the institution geography field used by
 * Proposal Ranking. Queries only Dataverse metadata on the registered sandbox;
 * it does not read business rows or call a Production target.
 *
 * Run from a checkout whose .env.local supplies the existing OAuth variables:
 *   node scripts/probe-proposal-ranking-geography.mjs
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { classifyTarget, resolveInterlockMode } from '../lib/dataverse/core/interlock.js';
import { SANDBOX_HOSTS } from '../lib/dataverse/core/target-registry.js';

const require = createRequire(import.meta.url);
const { createClient, getAccessToken } = require('../lib/dataverse/client.js');
const CANDIDATE = /geograph|east|west|region/i;

function loadEnvFiles() {
  for (const name of ['.env', '.env.local']) {
    try {
      for (const line of readFileSync(resolve(process.cwd(), name), 'utf8').split(/\r?\n/)) {
        const text = line.trim();
        if (!text || text.startsWith('#')) continue;
        const index = text.indexOf('=');
        if (index < 1) continue;
        const key = text.slice(0, index).trim();
        const value = text.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!(key in process.env)) process.env[key] = value;
      }
    } catch {}
  }
}

async function getJson(client, path) {
  const normalized = path.startsWith('http') ? path : `/${path.replace(/^\/+/, '')}`;
  const response = await client.get(normalized);
  if (!response.ok) {
    const errorCode = response.body?.error?.code;
    return {
      ok: false,
      status: response.status,
      errorCode: typeof errorCode === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(errorCode) ? errorCode : undefined,
      body: null,
    };
  }
  return { ok: true, status: response.status, body: response.body || {} };
}

function labelText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value?.LocalizedLabels)) {
    return value.LocalizedLabels.map((entry) => ({ languageCode: entry.LanguageCode, label: entry.Label }));
  }
  return value?.UserLocalizedLabel?.Label || null;
}

function optionDetails(option) {
  return {
    value: option?.Value ?? null,
    label: labelText(option?.Label),
    description: labelText(option?.Description),
  };
}

async function inspectField(client, attribute) {
  const type = attribute.AttributeType;
  const casts = {
    Picklist: ['PicklistAttributeMetadata', 'OptionSet($select=Options)'],
    Boolean: ['BooleanAttributeMetadata', 'OptionSet($select=TrueOption,FalseOption)'],
    State: ['StateAttributeMetadata', 'OptionSet($select=Options)'],
    Status: ['StatusAttributeMetadata', 'OptionSet($select=Options)'],
  };
  const [cast, expand] = casts[type] || [null, null];
  let detail = null;
  if (cast) {
    const result = await getJson(client,
      `EntityDefinitions(LogicalName='account')/Attributes(LogicalName='${attribute.LogicalName}')/Microsoft.Dynamics.CRM.${cast}?`
      + `$select=LogicalName,SchemaName,AttributeType&$expand=${expand}`);
    detail = result.ok ? result.body : { metadataStatus: result.status, errorCode: result.errorCode };
  }
  const options = type === 'Boolean'
    ? [detail?.OptionSet?.TrueOption, detail?.OptionSet?.FalseOption].filter(Boolean).map(optionDetails)
    : (detail?.OptionSet?.Options || []).map(optionDetails);
  return {
    logicalName: attribute.LogicalName,
    schemaName: attribute.SchemaName,
    attributeType: type,
    displayName: labelText(attribute.DisplayName),
    description: labelText(attribute.Description),
    isCustomAttribute: attribute.IsCustomAttribute ?? null,
    options: options.length ? options : undefined,
    metadataStatus: detail?.metadataStatus,
    metadataErrorCode: detail?.errorCode,
  };
}

async function main() {
  loadEnvFiles();
  if (resolveInterlockMode() !== 'on') throw new Error('DATAVERSE_TARGET_INTERLOCK must be explicitly on.');
  const resourceUrl = process.env.DYNAMICS_SANDBOX_URL || `https://${SANDBOX_HOSTS[0]}`;
  if (classifyTarget(resourceUrl) !== 'sandbox') throw new Error('Refusing target outside the registered Dataverse sandbox.');
  if (!process.env.DYNAMICS_TENANT_ID || !process.env.DYNAMICS_CLIENT_ID || !process.env.DYNAMICS_CLIENT_SECRET) {
    throw new Error('Missing OAuth credential variable names required for Dataverse access.');
  }
  const hostname = new URL(resourceUrl).hostname;
  const token = await getAccessToken(resourceUrl);
  const client = createClient({ resourceUrl, token });

  const relationships = await getJson(client,
    "EntityDefinitions(LogicalName='akoya_request')/ManyToOneRelationships?"
    + '$select=SchemaName,ReferencingAttribute,ReferencedEntity,ReferencingEntityNavigationPropertyName'
    + "&$filter=ReferencedEntity eq 'account'");
  const accountLink = (relationships.body?.value || []).map((item) => ({
    schemaName: item.SchemaName,
    referencingAttribute: item.ReferencingAttribute,
    referencedEntity: item.ReferencedEntity,
    referencingNavigationProperty: item.ReferencingEntityNavigationPropertyName,
  }));

  const accountAttributes = await getJson(client,
    "EntityDefinitions(LogicalName='account')/Attributes?"
    + '$select=LogicalName,SchemaName,AttributeType,DisplayName,Description,IsCustomAttribute'
    + '&$filter=IsCustomAttribute eq true');
  const candidates = (accountAttributes.body?.value || []).filter((attribute) => {
    const searchable = [attribute.LogicalName, attribute.SchemaName,
      attribute.DisplayName?.UserLocalizedLabel?.Label,
      ...(attribute.DisplayName?.LocalizedLabels || []).map((label) => label.Label),
      attribute.Description?.UserLocalizedLabel?.Label,
      ...(attribute.Description?.LocalizedLabels || []).map((label) => label.Label)]
      .filter(Boolean).join(' ');
    return CANDIDATE.test(searchable);
  });
  const fields = [];
  for (const attribute of candidates) fields.push(await inspectField(client, attribute));

  console.log(JSON.stringify({
    target: hostname,
    writesPerformed: false,
    businessRowsRead: false,
    requestAccountRelationships: {
      available: relationships.ok,
      status: relationships.status,
      errorCode: relationships.errorCode,
      matchingAccountLinks: accountLink,
    },
    accountCustomAttributes: {
      available: accountAttributes.ok,
      status: accountAttributes.status,
      errorCode: accountAttributes.errorCode,
      candidateCount: fields.length,
      candidates: fields,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(`Proposal Ranking geography metadata probe stopped safely (${error?.name || 'Error'}).`);
  process.exitCode = 1;
});
