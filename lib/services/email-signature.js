import { DatabaseService } from './database-service';
import { DynamicsService } from './dynamics-service';
import { resolveSystemUserToProfile } from './dataverse-identity-map';
import * as grantRequestAdapter from '../dataverse/adapters/grant-request.js';
import {
  PREFERENCE_KEYS,
  readEmailSignaturePreference,
} from '../../shared/config/reviewerFinderPreferences';

const FOUNDATION_LINE = 'W. M. Keck Foundation';
const REQUEST_SELECT = 'akoya_requestid,_wmkf_programdirector_value';
const SYSTEMUSER_SELECT = 'systemuserid,fullname,internalemailaddress,isdisabled';

function normalizeLine(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// True if any line already names the Keck Foundation (fuzzy: ignores spacing +
// punctuation so "W.M. Keck Foundation" matches "W. M. Keck Foundation").
function mentionsFoundation(lines) {
  return lines.some((l) => normalizeLine(l).replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').includes('keck foundation'));
}

function ensureFoundationLine(signature) {
  const lines = String(signature || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());

  if (lines.length === 0) return FOUNDATION_LINE;
  // Only add the Foundation line when the block doesn't ALREADY name it anywhere
  // (was: only-if-last-line — which duplicated when the org sat above e.g. a city).
  if (!mentionsFoundation(lines)) lines.push(FOUNDATION_LINE);
  return lines.join('\n');
}

function finalizeSignatureBlock(raw, fallback = {}) {
  const normalized = readEmailSignaturePreference({
    [PREFERENCE_KEYS.EMAIL_SIGNATURE]: raw,
  });
  const name = normalized.name || fallback.name || '';
  const email = normalized.email || fallback.email || '';

  // Ensure the Foundation line is present exactly once: a saved block that already
  // names the Foundation is used as-is; a bare name (or the no-block fallback) gets
  // the Foundation line appended.
  const signature = ensureFoundationLine(normalized.signature || name || '');

  return { signature, name, email };
}

export function resolveSignatureForProfile(preferences = {}) {
  return finalizeSignatureBlock(readEmailSignaturePreference(preferences));
}

export async function resolveSignatureForRequest(requestId) {
  try {
    const request = await grantRequestAdapter.getById(requestId, {
      select: REQUEST_SELECT,
    }).catch(() => null);
    const systemuserId = request?._wmkf_programdirector_value || null;
    if (!systemuserId) {
      return finalizeSignatureBlock(null);
    }

    // Not converted: the systemusers adapter (system-user.js) is not owned by
    // this conversion wave and its getById select ('systemuserid,internalemailaddress,
    // isdisabled') lacks the fullname field this caller needs — left raw.
    const pd = await DynamicsService.getRecord('systemusers', systemuserId, {
      select: SYSTEMUSER_SELECT,
    }).catch(() => null);
    const fallback = {
      name: pd?.fullname || '',
      email: pd?.internalemailaddress || '',
    };

    const profileId = await resolveSystemUserToProfile(systemuserId).catch(() => null);
    if (!profileId) {
      return finalizeSignatureBlock(null, fallback);
    }

    const preferences = await DatabaseService.getUserPreferences(profileId, false).catch(() => ({}));
    return finalizeSignatureBlock(readEmailSignaturePreference(preferences), fallback);
  } catch (error) {
    console.error('[email-signature] resolveSignatureForRequest error:', error.message);
    return finalizeSignatureBlock(null);
  }
}

export function appendSignatureBlock(bodyText, signatureBlock) {
  const body = String(bodyText || '').trimEnd();
  // signatureBlock.signature is already finalized by finalizeSignatureBlock — use
  // it as-is (do NOT re-run ensureFoundationLine; that double-appended the line).
  const signature = String(signatureBlock?.signature || signatureBlock?.name || '').trim();
  return `${body}\n\n${signature}`.trim();
}
