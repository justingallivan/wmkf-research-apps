#!/usr/bin/env node
/**
 * Guarded Contact parent-Account linker for an explicitly approved manifest.
 *
 * Dry run is the default. Production execution requires all of:
 *   --execute
 *   --confirm=link-9-newly-promoted-accepted-reviewers
 *   --manifest-sha256=<exact current manifest hash>
 *   DATAVERSE_ALLOW_PROD_READS=yes
 *   DATAVERSE_PROD_WRITE_ACK="link accepted reviewer contacts to parent accounts 2026-08-10"
 *
 * Every row is re-read before PATCH, requires an empty parentcustomerid and a
 * current ETag, and is verified after PATCH. The script records named per-row
 * results and stops after the first unexpected conflict/failure.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { v5 as uuidv5 } from 'uuid';
import { DynamicsService } from '../lib/services/dynamics-service.js';
import { fetchWithTimeout } from '../lib/services/dynamics/http.js';
import { withDalContext } from '../lib/dataverse/core/context.js';
import * as accountAdapter from '../lib/dataverse/adapters/account.js';
import * as contactAdapter from '../lib/dataverse/adapters/contact.js';
import * as potentialReviewerAdapter from '../lib/dataverse/adapters/potential-reviewer.js';
import * as reviewerSuggestionAdapter from '../lib/dataverse/adapters/reviewer-suggestion.js';
import { isGuid } from '../lib/utils/guid.js';
import { normalizeOrcid } from '../lib/utils/orcid-normalize.js';

const EXPECTED_TARGET_HOST = 'wmkf.crm.dynamics.com';
const EXPECTED_COUNT = 9;
const EXPECTED_CONFIRM = 'link-9-newly-promoted-accepted-reviewers';
const EXPECTED_ACK = 'link accepted reviewer contacts to parent accounts 2026-08-10';
const EXPECTED_NAVIGATION_PROPERTY = 'parentcustomerid_account';
const ACCEPTED_REVIEWER_CONTACT_GUID_NAMESPACE = '17834a61-9e55-5ce6-a0df-f08b53a73dd1';

function loadLocalEnv() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.join(scriptDir, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    const value = raw.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (!process.env[key]) process.env[key] = value;
  }
}

function argValue(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function invariant(condition, message) {
  if (!condition) throw new Error(`Safety invariant failed: ${message}`);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sameId(left, right) {
  return Boolean(left) && Boolean(right) && String(left).toLowerCase() === String(right).toLowerCase();
}

function resultPathFor(manifestPath) {
  const explicit = argValue('result');
  if (explicit) return path.resolve(explicit);
  return manifestPath.replace(/\.json$/i, '.apply-result.json');
}

function validateInvocation({ execute, manifest, manifestHash }) {
  invariant(process.env.DATAVERSE_ALLOW_PROD_READS === 'yes', 'DATAVERSE_ALLOW_PROD_READS must equal "yes"');
  invariant(process.env.DATAVERSE_TARGET_INTERLOCK === 'on', 'DATAVERSE_TARGET_INTERLOCK must equal "on"');
  let targetHost = null;
  try {
    targetHost = new URL(process.env.DYNAMICS_URL).hostname.toLowerCase();
  } catch {}
  invariant(targetHost === EXPECTED_TARGET_HOST, `DYNAMICS_URL must target ${EXPECTED_TARGET_HOST}`);
  invariant(manifest?.summary?.approvedLinks === EXPECTED_COUNT, `manifest approvedLinks must equal ${EXPECTED_COUNT}`);
  invariant(Array.isArray(manifest.links) && manifest.links.length === EXPECTED_COUNT, `manifest must contain ${EXPECTED_COUNT} links`);
  invariant(String(manifest.authorizationStatus || '').startsWith('AUTHORIZED'), 'manifest must carry explicit authorization status');
  invariant(manifest.exclusions?.some((row) => row.reviewer === 'Martha Cat'), 'manifest must explicitly exclude Martha Cat');
  invariant(!manifest.links.some((row) => row.reviewer === 'Martha Cat'), 'Martha Cat must not be in the write set');

  const contacts = manifest.links.map((row) => row.contactId);
  invariant(new Set(contacts.map((id) => String(id).toLowerCase())).size === EXPECTED_COUNT, 'Contact IDs must be unique');
  for (const row of manifest.links) {
    invariant(isGuid(row.contactId), `invalid Contact ID for ${row.reviewer}`);
    invariant(isGuid(row.accountId), `invalid Account ID for ${row.reviewer}`);
    invariant(Array.isArray(row.potentialReviewerIds) && row.potentialReviewerIds.length > 0, `missing potential reviewer IDs for ${row.reviewer}`);
    invariant(row.potentialReviewerIds.every(isGuid), `invalid potential reviewer ID for ${row.reviewer}`);
    invariant(row.acceptanceCategory === 'currently_accepted', `${row.reviewer} is not marked currently accepted`);
    invariant(row.contactOrigin === 'acceptance_promotion_created', `${row.reviewer} is not marked acceptance-promoted`);
    invariant(typeof row.promotionIdentityKey === 'string' && /^(orcid|reviewer):/.test(row.promotionIdentityKey), `invalid promotion identity key for ${row.reviewer}`);
  }

  if (!execute) return;
  invariant(argValue('confirm') === EXPECTED_CONFIRM, `--confirm must equal ${EXPECTED_CONFIRM}`);
  invariant(argValue('manifest-sha256') === manifestHash, 'manifest SHA-256 confirmation does not match current file bytes');
  invariant(process.env.DATAVERSE_PROD_WRITE_ACK === EXPECTED_ACK, `DATAVERSE_PROD_WRITE_ACK must equal "${EXPECTED_ACK}"`);
}

async function resolveParentAccountNavigationProperty() {
  const token = await DynamicsService.getAccessToken();
  const filter = encodeURIComponent("ReferencingAttribute eq 'parentcustomerid' and ReferencedEntity eq 'account'");
  const select = 'SchemaName,ReferencedEntity,ReferencingAttribute,ReferencingEntityNavigationPropertyName';
  const url = `${process.env.DYNAMICS_URL}/api/data/v9.2/EntityDefinitions(LogicalName='contact')/ManyToOneRelationships?$select=${select}&$filter=${filter}`;
  const response = await fetchWithTimeout(url, { method: 'GET', headers: DynamicsService.buildHeaders(token) }, 30_000);
  invariant(response.ok, `contact relationship metadata read failed (${response.status})`);
  const rows = (await response.json()).value || [];
  invariant(rows.length === 1, `expected exactly one Contact parent Account relationship, found ${rows.length}`);
  const navigationProperty = rows[0].ReferencingEntityNavigationPropertyName;
  invariant(navigationProperty === EXPECTED_NAVIGATION_PROPERTY,
    `live navigation property ${navigationProperty || '(missing)'} does not equal ${EXPECTED_NAVIGATION_PROPERTY}`);
  return navigationProperty;
}

function identityKeyMatchesReviewer(identityKey, reviewer) {
  if (identityKey.startsWith('reviewer:')) {
    return sameId(identityKey.slice('reviewer:'.length), reviewer.wmkf_potentialreviewersid);
  }
  if (identityKey.startsWith('orcid:')) {
    const normalized = normalizeOrcid(reviewer.wmkf_orcid);
    return normalized.state === 'valid' && `orcid:${normalized.id}` === identityKey;
  }
  return false;
}

async function readAndPlan(row) {
  const [contact, account, reviewers] = await Promise.all([
    contactAdapter.getInstitutionById(row.contactId),
    accountAdapter.getById(row.accountId, { select: 'accountid,name,statecode' }),
    Promise.all(row.potentialReviewerIds.map((id) => potentialReviewerAdapter.getById(id))),
  ]);

  if (!contact?.contactid || !sameId(contact.contactid, row.contactId)) {
    return { action: 'conflict', reason: 'contact_missing_or_changed' };
  }
  if (!account?.accountid || !sameId(account.accountid, row.accountId)) {
    return { action: 'conflict', reason: 'account_missing_or_changed' };
  }
  if (account.statecode !== undefined && account.statecode !== 0) {
    return { action: 'conflict', reason: 'account_inactive' };
  }
  if (String(account.name || '') !== String(row.accountName || '')) {
    return { action: 'conflict', reason: 'account_name_changed', currentAccountName: account.name || null };
  }
  if (reviewers.some((reviewer) => !reviewer?.wmkf_potentialreviewersid)) {
    return { action: 'conflict', reason: 'potential_reviewer_missing' };
  }
  if (!reviewers.every((reviewer) => sameId(reviewer._wmkf_contact_value, row.contactId))) {
    return { action: 'conflict', reason: 'reviewer_contact_link_changed' };
  }
  if (!reviewers.some((reviewer) => identityKeyMatchesReviewer(row.promotionIdentityKey, reviewer))) {
    return { action: 'conflict', reason: 'promotion_identity_key_changed' };
  }
  const expectedContactId = uuidv5(row.promotionIdentityKey, ACCEPTED_REVIEWER_CONTACT_GUID_NAMESPACE);
  if (!sameId(expectedContactId, row.contactId)) {
    return { action: 'conflict', reason: 'contact_not_acceptance_promotion_uuid' };
  }

  const suggestions = (await Promise.all(row.potentialReviewerIds.map((id) =>
    reviewerSuggestionAdapter.findAllByPotentialReviewer(id)))).flat();
  if (!suggestions.some((suggestion) => suggestion.wmkf_accepted === true && suggestion.wmkf_declined !== true)) {
    return { action: 'conflict', reason: 'no_current_acceptance' };
  }

  if (contact._parentcustomerid_value) {
    if (sameId(contact._parentcustomerid_value, row.accountId)) {
      return { action: 'noop', reason: 'already_linked_to_target', contact, account };
    }
    return {
      action: 'conflict',
      reason: 'parentcustomerid_already_populated',
      existingParentId: contact._parentcustomerid_value,
    };
  }
  if (!contact._etag) return { action: 'conflict', reason: 'contact_etag_missing' };
  return { action: 'write', contact, account };
}

function publicPlan(row, plan) {
  return {
    reviewer: row.reviewer,
    contactId: row.contactId,
    accountId: row.accountId,
    accountName: row.accountName,
    action: plan.action,
    reason: plan.reason || null,
    existingParentId: plan.existingParentId || null,
    currentAccountName: plan.currentAccountName || null,
  };
}

function writeResult(filePath, report) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export async function main() {
  loadLocalEnv();
  const execute = process.argv.includes('--execute');
  const manifestArg = argValue('manifest');
  invariant(manifestArg, '--manifest=<path> is required');
  const manifestPath = path.resolve(manifestArg);
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifestHash = sha256(manifestBytes);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const resultPath = resultPathFor(manifestPath);
  validateInvocation({ execute, manifest, manifestHash });

  const report = await withDalContext('apply-reviewer-contact-parent-accounts', async () => {
    const navigationProperty = await resolveParentAccountNavigationProperty();
    const preflight = [];
    for (const row of manifest.links) preflight.push(publicPlan(row, await readAndPlan(row)));
    const blocked = preflight.filter((row) => row.action === 'conflict');
    const base = {
      generatedAt: new Date().toISOString(),
      mode: execute ? 'execute' : 'dry-run',
      manifestPath,
      manifestSha256: manifestHash,
      navigationProperty,
      preflight,
      results: [],
      summary: null,
    };
    if (blocked.length > 0 || !execute) {
      const ready = preflight.filter((row) => row.action === 'write').length;
      const noop = preflight.filter((row) => row.action === 'noop').length;
      base.summary = { ready, noop, conflicts: blocked.length, written: 0, success: !execute && blocked.length === 0 };
      return base;
    }

    let halted = false;
    for (const row of manifest.links) {
      if (halted) {
        base.results.push({ reviewer: row.reviewer, contactId: row.contactId, accountId: row.accountId, status: 'not_attempted_after_failure' });
        continue;
      }
      try {
        const fresh = await readAndPlan(row);
        if (fresh.action === 'noop') {
          base.results.push({ reviewer: row.reviewer, contactId: row.contactId, accountId: row.accountId, status: 'noop_already_linked' });
          continue;
        }
        if (fresh.action !== 'write') {
          base.results.push({ reviewer: row.reviewer, contactId: row.contactId, accountId: row.accountId, status: 'conflict', reason: fresh.reason });
          halted = true;
          continue;
        }
        await contactAdapter.updateFields(row.contactId, {
          [`${navigationProperty}@odata.bind`]: `/accounts(${row.accountId})`,
        }, { ifMatch: fresh.contact._etag });
        const after = await contactAdapter.getInstitutionById(row.contactId);
        if (!sameId(after?._parentcustomerid_value, row.accountId)) {
          throw new Error('post-write verification did not return the expected parent Account');
        }
        base.results.push({ reviewer: row.reviewer, contactId: row.contactId, accountId: row.accountId, status: 'written_and_verified' });
      } catch (error) {
        base.results.push({
          reviewer: row.reviewer,
          contactId: row.contactId,
          accountId: row.accountId,
          status: error?.status === 412 ? 'conflict' : 'failed',
          reason: error?.status === 412 ? 'etag_conflict' : (error?.message || String(error)),
        });
        halted = true;
      }
    }
    const written = base.results.filter((row) => row.status === 'written_and_verified').length;
    const noop = base.results.filter((row) => row.status === 'noop_already_linked').length;
    const conflicts = base.results.filter((row) => row.status === 'conflict').length;
    const failed = base.results.filter((row) => row.status === 'failed').length;
    const notAttempted = base.results.filter((row) => row.status === 'not_attempted_after_failure').length;
    base.summary = {
      ready: preflight.filter((row) => row.action === 'write').length,
      noop,
      conflicts,
      failed,
      notAttempted,
      written,
      success: written + noop === manifest.links.length && conflicts === 0 && failed === 0,
    };
    return base;
  });

  writeResult(resultPath, report);
  console.log(JSON.stringify({ resultPath, ...report.summary }, null, 2));
  if (report.summary.conflicts || report.summary.failed || report.summary.notAttempted) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
